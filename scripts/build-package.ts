import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { colorsToTailwind, DEFAULT_TOOLBAR_COLORS } from '../src/runner/kittyColors';

const root = resolve(import.meta.dir, '..');
const dist = join(root, 'dist');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  version: string;
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'kitty.css'), colorsToTailwind(DEFAULT_TOOLBAR_COLORS));

await build({
  entryPoints: {
    index: join(root, 'src/index.ts'),
    preload: join(root, 'src/preload.js'),
    'control/cli': join(root, 'src/control/cli.ts'),
    'runner/index': join(root, 'src/runner/index.ts'),
  },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  external: [
    'cliweb-native-rs',
    'electron',
    'electron-chrome-extensions',
    'electron-chrome-web-store',
  ],
  sourcemap: false,
  define: {
    'import.meta.main': 'true',
    'process.env.NODE_ENV': '"production"',
  },
});

const vite = Bun.spawn(
  [process.execPath, join(root, 'node_modules/vite/bin/vite.js'), 'build'],
  {
    cwd: join(root, 'src/runner'),
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
if ((await vite.exited) !== 0) process.exit(1);

for (const cliPath of [join(dist, 'runner/index.js'), join(dist, 'control/cli.js')]) {
  const cli = await readFile(cliPath, 'utf8');
  if (!cli.startsWith('#!')) {
    await writeFile(cliPath, `#!/usr/bin/env node\n${cli}`);
  }
  await chmod(cliPath, 0o755);
}
await writeFile(join(dist, 'version'), packageJson.version);
