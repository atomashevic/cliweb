import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-browser-data-build-'));
const output = path.join(temporaryDirectory, 'browser-data-test.cjs');
const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
const bun = [
  path.join(root, 'node_modules', '.bin', executable),
  path.join(root, '.bun', 'bin', executable),
  ...((process.env.PATH ?? '').split(path.delimiter).map((directory) => path.join(directory, executable))),
].find(fs.existsSync);
const electron = createRequire(import.meta.url)('electron');

if (!bun) {
  process.stderr.write('Unable to test browser data: Bun is not installed\n');
  process.exit(1);
}

try {
  const build = spawnSync(
    bun,
    [
      'build',
      path.join(root, 'scripts', 'browserData.integration.ts'),
      '--target=node',
      '--format=cjs',
      `--outfile=${output}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (build.status !== 0) {
    process.stderr.write(build.stdout);
    process.stderr.write(build.stderr);
    process.exit(build.status ?? 1);
  }

  const test = spawnSync(electron, [output], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' },
  });
  process.stdout.write(test.stdout);
  process.stderr.write(test.stderr);
  if (test.status !== 0) process.exit(test.status ?? 1);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
