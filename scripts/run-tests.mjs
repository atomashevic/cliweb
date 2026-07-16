import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
const bun = [
  path.join(root, 'node_modules', '.bin', executable),
  path.join(root, '.bun', 'bin', executable),
  ...((process.env.PATH ?? '').split(path.delimiter).map((directory) => path.join(directory, executable))),
].find(fs.existsSync);

if (!bun) {
  process.stderr.write('Unable to run tests: Bun is not installed\n');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(bun, ['test']);
run(process.execPath, [path.join(root, 'scripts', 'run-browser-data-test.mjs')]);
