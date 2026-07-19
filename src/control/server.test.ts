import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callControl } from './client';
import { startControlServer, type ControlServerHandle } from './server';
import type { BrowserController } from './browserController';

let handle: ControlServerHandle | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
  delete process.env.CLIWEB_CONTROL_DIR;
});

describe('control server', () => {
  test('authenticates and returns a status response', async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-control-test-'));
    process.env.CLIWEB_CONTROL_DIR = temporaryDirectory;
    const controller = {
      handle: async () => ({ url: 'https://example.test/', loading: false }),
    } as unknown as BrowserController;
    handle = await startControlServer(controller, 'test');

    const result = (await callControl(handle.descriptor, 'status')) as Record<string, unknown>;
    expect(result.url).toBe('https://example.test/');
    expect(result.instance).toBeDefined();
    expect(fs.existsSync(handle.descriptor.descriptorPath)).toBe(true);
  });

  test('rejects an invalid token', async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-control-test-'));
    process.env.CLIWEB_CONTROL_DIR = temporaryDirectory;
    const controller = { handle: async () => ({}) } as unknown as BrowserController;
    handle = await startControlServer(controller, 'test');

    await expect(
      callControl({ ...handle.descriptor, token: 'wrong' }, 'status'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
