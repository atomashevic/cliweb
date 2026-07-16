import fs from 'node:fs';
import net from 'node:net';
import type { BrowserController } from './browserController';
import {
  CONTROL_PROTOCOL_VERSION,
  ControlError,
  DEFAULT_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  isControlMethod,
  publicDescriptor,
  type ControlRequest,
  type ControlResponse,
  type InstanceDescriptor,
} from './protocol';
import {
  createDescriptor,
  createInstancePaths,
  ensureControlRoot,
  removeInstanceFiles,
  writeDescriptor,
} from './registry';

export type ControlServerHandle = {
  descriptor: InstanceDescriptor;
  close(): Promise<void>;
  disposeSync(): void;
};

function errorResponse(id: string, error: unknown): ControlResponse {
  const normalized =
    error instanceof ControlError
      ? error
      : new ControlError('INTERNAL', error instanceof Error ? error.message : String(error));
  return {
    v: CONTROL_PROTOCOL_VERSION,
    id,
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
    },
  };
}

function validateRequest(value: unknown): ControlRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ControlError('INVALID_REQUEST', 'Request must be a JSON object');
  }
  const request = value as Partial<ControlRequest>;
  if (request.v !== CONTROL_PROTOCOL_VERSION) {
    throw new ControlError('INVALID_REQUEST', `Unsupported protocol version: ${request.v}`);
  }
  if (typeof request.id !== 'string' || request.id.length === 0) {
    throw new ControlError('INVALID_REQUEST', 'Request id must be a non-empty string');
  }
  if (typeof request.token !== 'string') {
    throw new ControlError('UNAUTHORIZED', 'Missing control token');
  }
  if (!isControlMethod(request.method)) {
    throw new ControlError('INVALID_REQUEST', `Unknown control method: ${request.method}`);
  }
  if (
    request.params !== undefined &&
    (typeof request.params !== 'object' || request.params === null || Array.isArray(request.params))
  ) {
    throw new ControlError('INVALID_REQUEST', 'params must be an object');
  }
  return request as ControlRequest;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ControlError('TIMEOUT', `Control request exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function startControlServer(
  controller: BrowserController,
  version: string,
): Promise<ControlServerHandle> {
  const root = ensureControlRoot();
  const paths = createInstancePaths({ root });
  const descriptor = createDescriptor(version, paths);
  if (descriptor.transport === 'unix') {
    try {
      fs.unlinkSync(descriptor.endpoint);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  let queue = Promise.resolve();
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
        socket.end(
          `${JSON.stringify(errorResponse('unknown', new ControlError('INVALID_REQUEST', 'Request is too large')))}\n`,
        );
        return;
      }

      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        queue = queue.then(async () => {
          let id = 'unknown';
          let response: ControlResponse;
          try {
            const parsed = JSON.parse(line) as unknown;
            if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
              const parsedId = (parsed as { id?: unknown }).id;
              if (typeof parsedId === 'string') id = parsedId;
            }
            const request = validateRequest(parsed);
            id = request.id;
            if (request.token !== descriptor.token) {
              throw new ControlError('UNAUTHORIZED', 'Invalid control token');
            }
            let result = await withTimeout(controller.handle(request.method, request.params ?? {}));
            if (request.method === 'status' || request.method === 'wait') {
              result = { ...(result as object), instance: publicDescriptor(descriptor) };
            }
            response = { v: CONTROL_PROTOCOL_VERSION, id, ok: true, result };
          } catch (error) {
            response = errorResponse(id, error);
          }
          if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(descriptor.endpoint);
  });

  if (descriptor.transport === 'unix') fs.chmodSync(descriptor.endpoint, 0o600);
  writeDescriptor(descriptor);

  let disposed = false;
  const disposeSync = () => {
    if (disposed) return;
    disposed = true;
    server.close();
    removeInstanceFiles(descriptor);
  };

  return {
    descriptor,
    disposeSync,
    async close() {
      if (disposed) return;
      disposed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      removeInstanceFiles(descriptor);
    },
  };
}
