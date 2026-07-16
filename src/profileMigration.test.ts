import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyPartition } from './profileMigration';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('profile migration', () => {
  test('copies a legacy partition once without replacing a completed target', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-profile-test-'));
    temporaryDirectories.push(root);
    const legacy = path.join(root, 'Electron', 'Partitions', 'custom-cliweb');
    const target = path.join(root, 'cliweb', 'Partitions', 'custom-cliweb');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'Cookies'), 'legacy');

    expect(migrateLegacyPartition(legacy, target)).toBe(true);
    expect(fs.readFileSync(path.join(target, 'Cookies'), 'utf8')).toBe('legacy');

    fs.writeFileSync(path.join(legacy, 'Cookies'), 'changed');
    expect(migrateLegacyPartition(legacy, target)).toBe(false);
    expect(fs.readFileSync(path.join(target, 'Cookies'), 'utf8')).toBe('legacy');
  });
});
