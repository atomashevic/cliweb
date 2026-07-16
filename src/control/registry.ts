import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONTROL_PROTOCOL_VERSION,
  type ControlTransport,
  type InstanceDescriptor,
} from './protocol';

type RuntimeOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tmpdir?: string;
  uid?: number;
  username?: string;
};

function userKey(options: RuntimeOptions = {}): string {
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
  if (uid !== undefined) return String(uid);
  const username = options.username ?? os.userInfo().username;
  return createHash('sha256').update(username).digest('hex').slice(0, 12);
}

export function controlRoot(options: RuntimeOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.CLIWEB_CONTROL_DIR) return path.resolve(env.CLIWEB_CONTROL_DIR);
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' && env.XDG_RUNTIME_DIR) {
    return path.join(env.XDG_RUNTIME_DIR, 'cliweb');
  }
  return path.join(options.tmpdir ?? os.tmpdir(), `cliweb-${userKey(options)}`);
}

export function ensureControlRoot(root = controlRoot()): string {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  return root;
}

export type InstancePaths = {
  instanceId: string;
  transport: ControlTransport;
  endpoint: string;
  descriptorPath: string;
};

export function createInstancePaths(
  options: RuntimeOptions & { root?: string; instanceId?: string } = {},
): InstancePaths {
  const platform = options.platform ?? process.platform;
  const root = options.root ?? controlRoot(options);
  const instanceId = options.instanceId ?? randomBytes(8).toString('hex');
  const descriptorPath = path.join(root, `${instanceId}.json`);
  if (platform === 'win32') {
    return {
      instanceId,
      transport: 'pipe',
      endpoint: `\\\\.\\pipe\\cliweb-${userKey(options)}-${instanceId}`,
      descriptorPath,
    };
  }

  let endpoint = path.join(root, `${instanceId}.sock`);
  if (Buffer.byteLength(endpoint) > 96) {
    endpoint = path.join(
      options.tmpdir ?? os.tmpdir(),
      `cw-${userKey(options)}-${instanceId}.sock`,
    );
  }
  return { instanceId, transport: 'unix', endpoint, descriptorPath };
}

function tmuxMetadata(env = process.env): Partial<InstanceDescriptor> {
  const tmuxPane = env.TMUX_PANE;
  if (!tmuxPane) return {};
  try {
    const output = execFileSync(
      'tmux',
      ['display-message', '-p', '-t', tmuxPane, '#{session_name}\t#{window_id}'],
      { encoding: 'utf8', timeout: 1_000 },
    ).trim();
    const [tmuxSession, tmuxWindow] = output.split('\t');
    return { tmuxPane, tmuxSession, tmuxWindow };
  } catch {
    return { tmuxPane };
  }
}

function kittyMetadata(env = process.env): Partial<InstanceDescriptor> {
  const kittyWindowId = Number(env.KITTY_WINDOW_ID);
  if (!Number.isInteger(kittyWindowId) || kittyWindowId <= 0) return {};
  return {
    kittyWindowId,
    ...(env.KITTY_LISTEN_ON ? { kittyListenOn: env.KITTY_LISTEN_ON } : {}),
  };
}

export function createDescriptor(
  version: string,
  paths: InstancePaths,
  env = process.env,
): InstanceDescriptor {
  return {
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    instanceId: paths.instanceId,
    pid: process.pid,
    version,
    startedAt: new Date().toISOString(),
    transport: paths.transport,
    endpoint: paths.endpoint,
    token: randomBytes(32).toString('hex'),
    descriptorPath: paths.descriptorPath,
    ...tmuxMetadata(env),
    ...kittyMetadata(env),
  };
}

export function writeDescriptor(descriptor: InstanceDescriptor): void {
  const temporaryPath = `${descriptor.descriptorPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, descriptor.descriptorPath);
}

export function removeInstanceFiles(descriptor: InstanceDescriptor): void {
  for (const filePath of [
    descriptor.descriptorPath,
    descriptor.transport === 'unix' && descriptor.endpoint,
  ]) {
    if (!filePath) continue;
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readDescriptors(root = controlRoot()): InstanceDescriptor[] {
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const descriptors: InstanceDescriptor[] = [];
  for (const name of names) {
    const descriptorPath = path.join(root, name);
    try {
      const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) as InstanceDescriptor;
      if (
        descriptor.protocolVersion === CONTROL_PROTOCOL_VERSION &&
        typeof descriptor.instanceId === 'string' &&
        typeof descriptor.token === 'string' &&
        typeof descriptor.endpoint === 'string' &&
        typeof descriptor.pid === 'number'
      ) {
        descriptor.descriptorPath = descriptorPath;
        descriptors.push(descriptor);
      }
    } catch {
      // Ignore malformed descriptors. They may belong to a partial or newer installation.
    }
  }
  return descriptors.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
