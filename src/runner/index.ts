#!/usr/bin/env node

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { possibleOptions, options } from '../args';
import { getDisplayScale } from '../dpi';
import { DEFAULT_TOOLBAR_COLORS, queryColors, type Color } from './kittyColors';

const { stdout } = process;

const RESET = '\x1b[0m';
const DIM_WHITE = '\x1b[0;2m';
const BOLD_GREEN = '\x1b[1;32m';
const BOLD_WHITE = '\x1b[1m';

const root = resolve(__dirname, '../../');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
};

export function showHelp() {
  stdout.write(RESET);
  stdout.write(`Usage: ${BOLD_GREEN}cliweb${RESET} ${DIM_WHITE}[options] [url]${RESET}\n\n`);
  stdout.write('Options:\n');
  for (const [key, value] of Object.entries(possibleOptions)) {
    if ('arg' in value) {
      stdout.write(`  ${DIM_WHITE}[${key}]${RESET}: ${value.description}\n`);
    } else {
      stdout.write(
        `  ${BOLD_WHITE}-${value.short}${RESET}, ${BOLD_WHITE}--${key}${RESET}: ${value.description}\n`,
      );
    }
  }
}

if (options.help) {
  showHelp();
  process.exit(0);
}

if (options.version) {
  if (stdout.isTTY) {
    stdout.write(`${BOLD_GREEN}cliweb${RESET} ${packageJson.version}\n`);
  } else {
    stdout.write(packageJson.version);
  }
  process.exit(0);
}

async function readToolbarColors(): Promise<Color[]> {
  if (!process.stdin.isTTY) return [];

  const supportedNames = new Set(DEFAULT_TOOLBAR_COLORS.map(([name]) => name));
  for (let tries = 0; tries < 3; tries++) {
    try {
      const colors = await queryColors();
      if (colors) return colors.filter(([name]) => supportedNames.has(name));
    } catch {
      // Keep the packaged fallback palette when the terminal does not answer.
    }
  }

  return [];
}

function prepareConfigPath(): string {
  const packagedConfig = join(root, 'config.js');
  const configHome = process.env.XDG_CONFIG_HOME ??
    (process.env.HOME ? join(process.env.HOME, '.config') : undefined);
  if (!configHome) return packagedConfig;

  const configDirectory = join(configHome, 'cliweb');
  const userConfig = join(configDirectory, 'config.js');
  try {
    mkdirSync(configDirectory, { recursive: true });
    if (!existsSync(userConfig)) copyFileSync(packagedConfig, userConfig);
    return userConfig;
  } catch {
    console.warn(`Unable to prepare ${userConfig}; using the packaged defaults`);
    return packagedConfig;
  }
}

async function main() {
  const electronPath = require('electron') as string;
  const electronArgs = [join(root, 'dist/index.js'), '--high-dpi-support=1'];

  const forcedDisplayScale = getDisplayScale();
  if (forcedDisplayScale) {
    electronArgs.push(`--force-device-scale-factor=${forcedDisplayScale}`);
  }
  electronArgs.push(...process.argv.slice(2));

  const toolbarColors = await readToolbarColors();
  const child: ChildProcess = spawn(electronPath, electronArgs, {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      CLIWEB_CONFIG_PATH: prepareConfigPath(),
      CLIWEB_TOOLBAR_COLORS: JSON.stringify(toolbarColors),
    },
  });

  const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of forwardedSignals) {
    process.once(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }

  child.once('error', (error) => {
    console.error(`Failed to start Electron: ${error.message}`);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    for (const forwardedSignal of forwardedSignals) {
      process.removeAllListeners(forwardedSignal);
    }

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
