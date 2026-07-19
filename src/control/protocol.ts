import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTROL_PROTOCOL_VERSION = 1;
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SNAPSHOT_NODES = 2_000;
export const MAX_SNAPSHOT_NODES = 5_000;

export type ControlErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_REQUEST'
  | 'NO_TARGET'
  | 'AMBIGUOUS_TARGET'
  | 'STALE_REF'
  | 'NOT_FOUND'
  | 'DEBUGGER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL';

export class ControlError extends Error {
  constructor(
    public readonly code: ControlErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}

export type ControlMethod =
  | 'status'
  | 'snapshot'
  | 'screenshot'
  | 'navigate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'bookmark-toggle'
  | 'bookmarks'
  | 'history'
  | 'clear-history'
  | 'clear-site-data'
  | 'show-bookmarks'
  | 'show-history'
  | 'close-panel'
  | 'click'
  | 'fill'
  | 'press'
  | 'scroll'
  | 'wait'
  | 'visibility';

export type ControlRequest = {
  v: typeof CONTROL_PROTOCOL_VERSION;
  id: string;
  token: string;
  method: ControlMethod;
  params?: Record<string, unknown>;
};

export type ControlResponse =
  | {
      v: typeof CONTROL_PROTOCOL_VERSION;
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      v: typeof CONTROL_PROTOCOL_VERSION;
      id: string;
      ok: false;
      error: {
        code: ControlErrorCode;
        message: string;
        details?: unknown;
      };
    };

export type ControlTransport = 'unix' | 'pipe';

export type InstanceDescriptor = {
  protocolVersion: typeof CONTROL_PROTOCOL_VERSION;
  instanceId: string;
  pid: number;
  version: string;
  startedAt: string;
  transport: ControlTransport;
  endpoint: string;
  token: string;
  descriptorPath: string;
  tmuxPane?: string;
  tmuxSession?: string;
  tmuxWindow?: string;
  kittyWindowId?: number;
  kittyListenOn?: string;
};

export type PublicInstanceDescriptor = Omit<InstanceDescriptor, 'token' | 'descriptorPath'>;

export type ElementTarget = {
  ref?: string;
  selector?: string;
};

export function publicDescriptor(descriptor: InstanceDescriptor): PublicInstanceDescriptor {
  const { token: _token, descriptorPath: _descriptorPath, ...result } = descriptor;
  return result;
}

export function isControlMethod(value: unknown): value is ControlMethod {
  return (
    typeof value === 'string' &&
    [
      'status',
      'snapshot',
      'screenshot',
      'navigate',
      'back',
      'forward',
      'reload',
      'bookmark-toggle',
      'bookmarks',
      'history',
      'clear-history',
      'clear-site-data',
      'show-bookmarks',
      'show-history',
      'close-panel',
      'click',
      'fill',
      'press',
      'scroll',
      'wait',
      'visibility',
    ].includes(value)
  );
}

export function requireString(
  params: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = params[key];
  if (typeof value !== 'string' || (!options.allowEmpty && value.length === 0)) {
    throw new ControlError('INVALID_REQUEST', `Expected ${key} to be a string`);
  }
  return value;
}

export function optionalNumber(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ControlError('INVALID_REQUEST', `Expected ${key} to be a finite number`);
  }
  return value;
}

export function requireElementTarget(params: Record<string, unknown>): ElementTarget {
  const ref = params.ref;
  const selector = params.selector;
  if ((typeof ref === 'string') === (typeof selector === 'string')) {
    throw new ControlError('INVALID_REQUEST', 'Provide exactly one of ref or selector');
  }
  if (typeof ref === 'string' && ref.length > 0) return { ref };
  if (typeof selector === 'string' && selector.length > 0) return { selector };
  throw new ControlError('INVALID_REQUEST', 'Element target cannot be empty');
}

export function normalizeNavigationUrl(value: string, baseDirectory = process.cwd()): string {
  const target = value.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(target);

  if (!hasScheme && /\.pdf$/i.test(target)) {
    const localPath = path.resolve(baseDirectory, target);
    try {
      if (fs.statSync(localPath).isFile()) return pathToFileURL(localPath).href;
    } catch {
      // Preserve normal web navigation for non-existent or inaccessible paths.
    }
  }

  const normalized = hasScheme ? target : `https://${target}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ControlError('INVALID_REQUEST', `Invalid URL: ${value}`);
  }
  if (!['http:', 'https:', 'file:', 'data:'].includes(parsed.protocol)) {
    throw new ControlError('INVALID_REQUEST', `Unsupported URL protocol: ${parsed.protocol}`);
  }
  return parsed.href;
}
