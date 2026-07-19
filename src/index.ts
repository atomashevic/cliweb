import { app, dialog, ipcMain } from 'electron';
import {
  termEnableFeatures,
  listenForInput,
  type TermEvent,
  termDisableFeatures,
} from 'cliweb-native-rs';
import * as out from './tty/output';
import { handleInput, invalidateMouseCoordinateCache } from './inputHandler';
import { createWindowWithToolbar, getBrowserWindowSize } from './windows';
import { console_ } from './console';
import { options } from './args';
import { features } from './features';
import { clearPlacements } from './tty/kittyGraphics';
import { invalidateTmuxPaneOrigin } from './tty/escapeCodes';
import { loadKeyBindings } from './keybindings';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserController } from './control/browserController';
import { startControlServer, type ControlServerHandle } from './control/server';
import { configureProfile } from './profile';
import { BrowserDataStore } from './browserData';
import { flushSessionCookies } from './session';

const profilePaths = configureProfile();

let homepage = 'https://github.com/atomashevic/cliweb';

function loadConfig(config: typeof import('../config.js')) {
  if (config.homepage) homepage = config.homepage;
  if (config.keybindings) {
    if (process.platform === 'darwin') {
      Object.assign(config.keybindings, config.keybindings.mac);
      config.keybindings.linux = undefined;
    } else {
      Object.assign(config.keybindings, config.keybindings.linux);
      config.keybindings.mac = undefined;
    }
    loadKeyBindings(config);
  }
}

const CONFIG_PATH_RESOLVED =
  process.env.CLIWEB_CONFIG_PATH ?? path.resolve(__dirname, '../config.js');
const PACKAGE_VERSION = require(path.resolve(__dirname, '../package.json')).version as string;
loadConfig(require(CONFIG_PATH_RESOLVED));

fs.watchFile(CONFIG_PATH_RESOLVED, { interval: 200 }, (curr, prev) => {
  if (curr.mtime <= prev.mtime) return;
  const oldConfig = require(CONFIG_PATH_RESOLVED);
  require.cache[CONFIG_PATH_RESOLVED] = undefined;

  try {
    const newConfig = require(CONFIG_PATH_RESOLVED);
    loadConfig(newConfig);
  } catch (e) {
    console_.error('Error loading config:', e);
    // Restore old config if new one fails
    try {
      loadConfig(oldConfig);
    } catch (e) {
      console_.error('Error restoring old config:', e);
    }
  }
});

// Don't show a dialog box on uncaught errors
dialog.showErrorBox = (title, content) => {
  console_.error(title, content);
};

const INITIAL_URL = options.url || homepage;

let exiting = false;
let quitListening = () => {};
let controlServer: ControlServerHandle | undefined;
let browserData: BrowserDataStore | undefined;

const cleanup = (signum = 1, reason?: string) => {
  if (exiting) return;
  exiting = true;
  controlServer?.disposeSync();
  quitListening();
  if (!options['no-paint']) {
    clearPlacements();
    out.cleanup();
    if (features.current) termDisableFeatures(features.current);
  }
  void (async () => {
    try {
      await Promise.race([
        flushSessionCookies(),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    } catch (error) {
      console_.error('Could not flush cookies:', error);
    }
    try {
      browserData?.close();
    } catch (error) {
      console_.error('Could not close browser data:', error);
    }
    if (reason) console_.log(reason);
    process.exit(signum);
  })();
};

function inputHandler(evt: TermEvent) {
  // Graphics protocol events now come through graphics events
  if (options['debug-paint'] && evt.eventType === 'graphics') {
    console_.error('Graphics protocol: ', evt.graphics);
  }

  handleInput(evt);
}

function setup() {
  const cleanup_ = () => cleanup();
  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', cleanup_);
  process.on('SIGHUP', cleanup_);
  process.on('SIGABRT', cleanup_);
  process.on('SIGWINCH', () => {
    invalidateTmuxPaneOrigin();
    invalidateMouseCoordinateCache();
  });

  const controlOnly = Boolean(options.control && options['no-paint']);
  if (controlOnly) return;

  out.setup();
  features.current = termEnableFeatures();
  const { keyboard, images } = features.current;
  if (!keyboard) {
    cleanup(1, 'Extended keyboard support is required');
  }
  if (!images) {
    const tmuxHint = process.env.TMUX
      ? '; inside tmux, add `set -g allow-passthrough on` to tmux.conf'
      : '';
    cleanup(1, `Basic Kitty graphics protocol support is required${tmuxHint}`);
  }

  quitListening = listenForInput(inputHandler, 200);

  out.clearScreen();
  out.placeCursor({ x: 0, y: 0 });
}

setup();

// Disable Electron's stdout logging
app.commandLine.appendSwitch('log-level', '0');
app.commandLine.appendSwitch('disable-logging');
// Disable Chrome DevTools logging
app.commandLine.appendSwitch('silent-debugger-extension-api');

// Prevent sysctlbyname crash: https://github.com/electron/electron/issues/45653#issuecomment-2663510200
app.commandLine.appendSwitch('disable-features', 'UseBrowserCalculatedOrigin');

app.whenReady().then(async () => {
  browserData = new BrowserDataStore(path.join(profilePaths.userData, 'browser-data.sqlite3'));
  const window = await createWindowWithToolbar(getBrowserWindowSize(), INITIAL_URL, browserData);
  const browserController = new BrowserController(window);

  if (options.control) {
    try {
      controlServer = await startControlServer(browserController, PACKAGE_VERSION);
    } catch (error) {
      cleanup(
        1,
        `Could not start cliweb control: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }

  ipcMain.handle('findInPage', (_, text: string, opts) => {
    window.content.webContents.findInPage(text, opts);
  });

  ipcMain.handle('stopFindInPage', () => {
    window.content.webContents.stopFindInPage('clearSelection');
    window.toolbar.blurWebView();
    window.content.focusOnWebView();
    window.focusedContent = window.content.webContents;
  });
});

app.on('before-quit', (event) => {
  if (exiting) return;
  event.preventDefault();
  cleanup(0);
});
