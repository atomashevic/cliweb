import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { callControl, liveDescriptors } from './client';
import {
  ControlError,
  normalizeNavigationUrl,
  publicDescriptor,
  type InstanceDescriptor,
} from './protocol';
import { processExists } from './registry';

export type KittyWindow = {
  id: number;
  title?: string;
  cwd?: string;
  pid?: number;
  cmdline?: string[];
  is_self?: boolean;
};

export type KittyTab = {
  id: number;
  title?: string;
  layout?: string;
  windows: KittyWindow[];
};

export type KittyOsWindow = {
  id: number;
  tabs: KittyTab[];
};

export type KittyContext = {
  osWindow: KittyOsWindow;
  tab: KittyTab;
  window: KittyWindow;
};

type KittyRuntime = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

function runtimeEnv(runtime: KittyRuntime = {}): NodeJS.ProcessEnv {
  return runtime.env ?? process.env;
}

function reusableKittyAddress(value: string | undefined): string | undefined {
  return value && !value.startsWith('fd:') ? value : undefined;
}

function kittyRemote(
  args: string[],
  runtime: KittyRuntime & { to?: string; timeoutMs?: number } = {},
): string {
  const env = runtimeEnv(runtime);
  const binary = env.CLIWEB_KITTEN_BIN || 'kitten';
  const to =
    reusableKittyAddress(runtime.to) ??
    reusableKittyAddress(env.CLIWEB_KITTY_TO) ??
    reusableKittyAddress(env.KITTY_LISTEN_ON);
  const command = ['@', ...(to ? ['--to', to] : []), ...args];
  try {
    return execFileSync(binary, command, {
      encoding: 'utf8',
      timeout: runtime.timeoutMs ?? 5_000,
      cwd: runtime.cwd ?? process.cwd(),
      env,
    }).trim();
  } catch (error) {
    const detail =
      error instanceof Error && 'stderr' in error
        ? String((error as Error & { stderr?: unknown }).stderr || error.message).trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ControlError(
      'NO_TARGET',
      `Kitty remote control failed${detail ? `: ${detail}` : ''}. Enable allow_remote_control with a listen_on socket, or launch the Codex window with --allow-remote-control.`,
    );
  }
}

export function parseKittyTree(output: string): KittyOsWindow[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new ControlError('INTERNAL', 'Kitty ls returned invalid JSON');
  }
  if (!Array.isArray(value)) throw new ControlError('INTERNAL', 'Kitty ls did not return a list');
  return value as KittyOsWindow[];
}

function kittyTree(runtime: KittyRuntime & { to?: string } = {}): KittyOsWindow[] {
  return parseKittyTree(kittyRemote(['ls'], runtime));
}

export function findKittyContext(
  tree: KittyOsWindow[],
  currentWindowId?: number,
): KittyContext | undefined {
  for (const osWindow of tree) {
    for (const tab of osWindow.tabs ?? []) {
      for (const window of tab.windows ?? []) {
        if (window.id === currentWindowId || (currentWindowId === undefined && window.is_self)) {
          return { osWindow, tab, window };
        }
      }
    }
  }
  return undefined;
}

function currentKittyWindowId(env: NodeJS.ProcessEnv): number | undefined {
  const value = Number(env.CLIWEB_KITTY_WINDOW_ID ?? env.KITTY_WINDOW_ID);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function resolveExecutable(name: string, env: NodeJS.ProcessEnv): string {
  const explicit = env.CLIWEB_BIN;
  if (explicit) return explicit;
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return name;
}

export function kittyLaunchArgs(
  context: KittyContext,
  cliwebBinary: string,
  url?: string,
): string[] {
  return [
    'launch',
    '--match',
    `id:${context.tab.id}`,
    '--type=window',
    '--location=vsplit',
    '--next-to',
    `id:${context.window.id}`,
    '--bias=50',
    '--keep-focus',
    '--cwd=current',
    '--copy-colors',
    '--title=cliweb-control',
    '--var',
    'cliweb_control=yes',
    cliwebBinary,
    '--control',
    ...(url ? [normalizeNavigationUrl(url)] : []),
  ];
}

async function waitForKittyInstance(windowId: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptors = await liveDescriptors();
    const descriptor = descriptors.find((candidate) => candidate.kittyWindowId === windowId);
    if (descriptor) return descriptor;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ControlError('TIMEOUT', `cliweb did not expose control in Kitty window ${windowId}`);
}

function descriptorsInTab(descriptors: InstanceDescriptor[], tab: KittyTab) {
  const windowIds = new Set((tab.windows ?? []).map((window) => window.id));
  return descriptors.filter(
    (descriptor) =>
      descriptor.kittyWindowId !== undefined && windowIds.has(descriptor.kittyWindowId),
  );
}

export async function ensureKittyCliweb(url?: string, runtime: KittyRuntime = {}) {
  const env = runtimeEnv(runtime);
  const tree = kittyTree(runtime);
  const context = findKittyContext(tree, currentKittyWindowId(env));
  if (!context) {
    throw new ControlError(
      'NO_TARGET',
      'Could not identify the current Kitty window; run kitty ensure from the Codex window inside Kitty',
    );
  }

  const existing = descriptorsInTab(await liveDescriptors(), context.tab)[0];
  if (existing) {
    if (url) await callControl(existing, 'navigate', { url: normalizeNavigationUrl(url) });
    return publicDescriptor(existing);
  }

  if (!context.tab.layout?.startsWith('splits')) {
    kittyRemote(['goto-layout', '--match', `id:${context.tab.id}`, 'splits'], runtime);
  }

  const launched = kittyRemote(
    kittyLaunchArgs(context, resolveExecutable('cliweb', env), url),
    runtime,
  );
  const windowId = Number(launched);
  if (!Number.isInteger(windowId) || windowId <= 0) {
    throw new ControlError('INTERNAL', `Kitty launch returned an invalid window id: ${launched}`);
  }

  try {
    return publicDescriptor(await waitForKittyInstance(windowId));
  } catch (error) {
    try {
      kittyRemote(['close-window', '--match', `id:${windowId}`], runtime);
    } catch {}
    throw error;
  }
}

function kittyWindowExists(windowId: number, runtime: KittyRuntime & { to?: string } = {}) {
  return findKittyContext(kittyTree(runtime), windowId) !== undefined;
}

export async function gracefullyCloseKittyWindow(windowId: number, runtime: KittyRuntime = {}) {
  if (!Number.isInteger(windowId) || windowId <= 0) {
    throw new ControlError('INVALID_REQUEST', `Invalid Kitty window id: ${windowId}`);
  }
  const descriptor = (await liveDescriptors()).find(
    (candidate) => candidate.kittyWindowId === windowId,
  );
  const env = runtimeEnv(runtime);
  const to =
    env.CLIWEB_KITTY_TO ??
    reusableKittyAddress(env.KITTY_LISTEN_ON) ??
    reusableKittyAddress(descriptor?.kittyListenOn);
  let graceful = false;

  if (descriptor) {
    try {
      process.kill(descriptor.pid, 'SIGTERM');
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline && processExists(descriptor.pid)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      graceful = !processExists(descriptor.pid);
    } catch {}
  }

  if (kittyWindowExists(windowId, { ...runtime, to })) {
    kittyRemote(['close-window', '--match', `id:${windowId}`], { ...runtime, to });
  }
  return { window: windowId, controlled: descriptor !== undefined, graceful, closed: true };
}
