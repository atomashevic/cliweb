#!/usr/bin/env node

if (process.platform !== 'linux') process.exit(0);

const { accessSync, constants, statSync, symlinkSync, unlinkSync } = require('node:fs');
const { dirname, join } = require('node:path');

function isUsableSandbox(file) {
  try {
    accessSync(file, constants.X_OK);
    const stat = statSync(file);
    return stat.uid === 0 && (stat.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

let electronRoot;
try {
  electronRoot = dirname(require.resolve('electron/package.json'));
} catch {
  process.exit(0);
}

const electronSandbox = join(electronRoot, 'dist', 'chrome-sandbox');
if (isUsableSandbox(electronSandbox)) process.exit(0);

const candidates = [
  '/opt/google/chrome/chrome-sandbox',
  '/usr/lib/claude-desktop/chrome-sandbox',
  '/usr/lib/chromium/chrome-sandbox',
  '/usr/lib/chromium-browser/chrome-sandbox',
];
const systemSandbox = candidates.find(isUsableSandbox);
if (!systemSandbox) {
  console.warn('cliweb: no root-owned setuid Chromium sandbox was found');
  process.exit(0);
}

try {
  unlinkSync(electronSandbox);
  symlinkSync(systemSandbox, electronSandbox);
} catch (error) {
  console.warn(`cliweb: unable to configure the Chromium sandbox: ${error.message}`);
}
