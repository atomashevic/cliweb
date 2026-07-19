import { randomUUID } from 'node:crypto';
import net from 'node:net';
import {
  CONTROL_PROTOCOL_VERSION,
  ControlError,
  DEFAULT_TIMEOUT_MS,
  publicDescriptor,
  type ControlMethod,
  type ControlRequest,
  type ControlResponse,
  type InstanceDescriptor,
} from './protocol';
import { processExists, readDescriptors, removeInstanceFiles } from './registry';

export async function callControl(
  descriptor: InstanceDescriptor,
  method: ControlMethod,
  params: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const request: ControlRequest = {
    v: CONTROL_PROTOCOL_VERSION,
    id: randomUUID(),
    token: descriptor.token,
    method,
    params,
  };

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.endpoint);
    socket.setEncoding('utf8');
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new ControlError('TIMEOUT', `Could not complete ${method} within ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.end();
      callback();
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as ControlResponse;
        if (response.id !== request.id) {
          throw new ControlError('INTERNAL', 'Control response id did not match request');
        }
        if (!response.ok) {
          throw new ControlError(
            response.error.code,
            response.error.message,
            response.error.details,
          );
        }
        finish(() => resolve(response.result));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    socket.on('error', (error) => {
      finish(() => reject(error));
    });
    socket.on('end', () => {
      if (buffer.indexOf('\n') < 0) {
        finish(() =>
          reject(new ControlError('INTERNAL', 'Control connection closed without a response')),
        );
      }
    });
  });
}

export async function liveDescriptors(): Promise<InstanceDescriptor[]> {
  const descriptors = readDescriptors();
  const live: InstanceDescriptor[] = [];
  for (const descriptor of descriptors) {
    if (!processExists(descriptor.pid)) {
      try {
        removeInstanceFiles(descriptor);
      } catch {}
      continue;
    }
    try {
      await callControl(descriptor, 'status', {}, 1_500);
      live.push(descriptor);
    } catch {
      // A live process may still be starting. Do not prune its descriptor.
    }
  }
  return live;
}

export async function resolveDescriptor(options: {
  instanceId?: string;
  tmuxPane?: string;
  kittyWindowId?: number;
}): Promise<InstanceDescriptor> {
  const descriptors = await liveDescriptors();
  let matches = descriptors;
  if (options.instanceId) {
    matches = matches.filter((descriptor) => descriptor.instanceId === options.instanceId);
  }
  if (options.tmuxPane) {
    matches = matches.filter((descriptor) => descriptor.tmuxPane === options.tmuxPane);
  }
  if (options.kittyWindowId !== undefined) {
    matches = matches.filter((descriptor) => descriptor.kittyWindowId === options.kittyWindowId);
  }
  if (matches.length === 0) {
    throw new ControlError('NO_TARGET', 'No matching controlled cliweb instance is available');
  }
  if (
    matches.length > 1 &&
    !options.instanceId &&
    !options.tmuxPane &&
    options.kittyWindowId === undefined
  ) {
    throw new ControlError(
      'AMBIGUOUS_TARGET',
      'More than one controlled cliweb instance is available; specify --instance or --pane',
      matches.map(publicDescriptor),
    );
  }
  return matches[0];
}
