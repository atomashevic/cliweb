import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { configureSandbox } = require('./configure-sandbox.js') as {
  configureSandbox: (options?: {
    candidates?: string[];
    electronRoot?: string;
    isUsableSandbox?: (file: string) => boolean;
    platform?: string;
  }) => boolean;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Chromium sandbox configuration', () => {
  test('skips non-Linux platforms', () => {
    expect(configureSandbox({ platform: 'darwin' })).toBe(false);
  });

  test('replaces Electron helper after its postinstall completes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-sandbox-test-'));
    temporaryDirectories.push(root);
    const electronRoot = path.join(root, 'electron');
    const electronSandbox = path.join(electronRoot, 'dist', 'chrome-sandbox');
    const systemSandbox = path.join(root, 'system-chrome-sandbox');
    fs.mkdirSync(path.dirname(electronSandbox), { recursive: true });
    fs.writeFileSync(electronSandbox, 'electron helper');
    fs.writeFileSync(systemSandbox, 'system helper');

    expect(
      configureSandbox({
        candidates: [systemSandbox],
        electronRoot,
        isUsableSandbox: (file) => file === systemSandbox,
        platform: 'linux',
      }),
    ).toBe(true);
    expect(fs.readlinkSync(electronSandbox)).toBe(systemSandbox);
  });
});
