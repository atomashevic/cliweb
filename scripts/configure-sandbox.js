#!/usr/bin/env node

const { accessSync, constants, statSync, symlinkSync, unlinkSync } = require('node:fs');
const { dirname, join } = require('node:path');

const SYSTEM_SANDBOXES = [
  '/opt/google/chrome/chrome-sandbox',
  '/usr/lib/claude-desktop/chrome-sandbox',
  '/usr/lib/chromium/chrome-sandbox',
  '/usr/lib/chromium-browser/chrome-sandbox',
];

function isUsableSandbox(file) {
  try {
    accessSync(file, constants.X_OK);
    const stat = statSync(file);
    return stat.uid === 0 && (stat.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

function configureSandbox(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') return false;

  let electronRoot = options.electronRoot;
  if (!electronRoot) {
    try {
      electronRoot = dirname(require.resolve('electron/package.json'));
    } catch {
      return false;
    }
  }

  const usable = options.isUsableSandbox ?? isUsableSandbox;
  const electronSandbox = join(electronRoot, 'dist', 'chrome-sandbox');
  if (usable(electronSandbox)) return true;

  const systemSandbox = (options.candidates ?? SYSTEM_SANDBOXES).find(usable);
  if (!systemSandbox) {
    console.warn('cliweb: no root-owned setuid Chromium sandbox was found');
    return false;
  }

  try {
    unlinkSync(electronSandbox);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`cliweb: unable to replace the Chromium sandbox: ${error.message}`);
      return false;
    }
  }

  try {
    symlinkSync(systemSandbox, electronSandbox);
    return true;
  } catch (error) {
    console.warn(`cliweb: unable to configure the Chromium sandbox: ${error.message}`);
    return false;
  }
}

module.exports = { configureSandbox, isUsableSandbox };

if (require.main === module) configureSandbox();
