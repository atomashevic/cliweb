#!/usr/bin/env node

const { existsSync } = require('node:fs');
const { delimiter, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = join(__dirname, '..');
const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
const candidates = [
  join(root, '.bun', 'bin', executable),
  join(root, 'node_modules', '.bin', executable),
];

for (const directory of (process.env.PATH ?? '').split(delimiter)) {
  if (directory) candidates.push(join(directory, executable));
}

const bun = candidates.find(existsSync);
if (!bun) {
  console.error('Unable to build cliweb: Bun is not installed');
  process.exit(1);
}

const result = spawnSync(bun, ['run', 'scripts/build-package.ts'], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
