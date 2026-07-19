import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type WebContents,
  ipcMain,
  screen,
} from 'electron';
import path from 'node:path';
import { registerPaintedContent, registerPaintedContentFallback } from './paint';
import { clearSiteData, sessionPromise } from './session';
import { extensionsPromise, installedExtensionsPromise } from './extensions';
import { paintInitialFrame } from './tty/kittyGraphics';
import { getWindowSize, ShmGraphicBuffer } from 'cliweb-native-rs';
import { options } from './args';
import { console_ } from './console';
import {
  layout,
  row,
  px,
  auto,
  calculateLayout,
  type LayoutContainer,
  type LayoutNode,
} from './layout';
import { getDisplayScale } from './dpi';
import { features } from './features';
import { updateCursor } from './tty/cursor';
import { debounce } from './debounce';
import { type BrowserDataStore, normalizeStoredUrl } from './browserData';
import type {
  BookmarkToggleResult,
  BrowserPanelData,
  BrowserPanelMode,
  CurrentPageState,
} from './browserDataTypes';
import { normalizeNavigationUrl } from './control/protocol';

export type Actions = {
  back: () => void;
  forward: () => void;
  refresh: () => void;
  setTerminalVisible: (visible: boolean) => void;
  isTerminalVisible: () => boolean;
};

export type WindowView = {
  toolbar: BrowserWindow;
  content: BrowserWindow;
  focusedContent: WebContents;
  layoutContainer: LayoutContainer;
  toolbarNode: LayoutNode;
  contentNode: LayoutNode;
  isPrivate: boolean;
  panelMode: BrowserPanelMode | null;
  currentPageState: () => CurrentPageState;
  toggleBookmark: () => BookmarkToggleResult;
  showPanel: (mode: BrowserPanelMode) => void;
  closePanel: () => void;
  queryPanel: (mode: BrowserPanelMode, query?: string, limit?: number) => BrowserPanelData;
  removeBookmark: (id: string) => boolean;
  openBrowserDataItem: (url: string) => Promise<void>;
  clearHistory: () => number;
  clearCurrentSiteData: () => Promise<string>;
} & Actions;

export const focusedView: {
  current: WindowView | null;
  previous: WindowView | null;
} = {
  current: null,
  previous: null,
};

export const windowViews = new WeakMap<BrowserWindow, WindowView>();

const TOOLBAR_HEIGHT = 40;

function applyToolbarColors(toolbar: BrowserWindow) {
  let colors: unknown = [];
  try {
    colors = JSON.parse(process.env.CLIWEB_TOOLBAR_COLORS ?? '[]');
  } catch {
    return;
  }
  if (!Array.isArray(colors)) return;

  const safeColors = colors.filter(
    (entry): entry is [string, string] =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      /^[a-z0-9-]+$/.test(entry[0]) &&
      typeof entry[1] === 'string' &&
      /^#[0-9a-f]{6}$/i.test(entry[1]),
  );
  if (safeColors.length === 0) return;

  toolbar.webContents.once('did-finish-load', () => {
    const script = `for (const [name, color] of ${JSON.stringify(safeColors)}) document.documentElement.style.setProperty('--cliweb-color-' + name, color);`;
    toolbar.webContents.executeJavaScript(script).catch((error) => {
      console_.error('Failed to apply terminal colors:', error);
    });
  });
}

/**
 * NOTE: the happens before load but after frame navigate
 * this is necessary because zoom can only be set when a URL is associated with the webContents
 *
 * This also prevents users from persisting zoom level which is bad, so we probably want
 * to store that somewhere if the user changes zoom and restore that number instead
 */
function resetForFrameQuirk(webContents: WebContents) {
  webContents.once('did-frame-navigate', () => {
    webContents.setZoomFactor(1);
  });
}

type Size = { width: number; height: number };
const HEADLESS_WINDOW_SIZE: Size = { width: 1280, height: 720 };

export function getBrowserWindowSize(): Size {
  return options['no-paint'] ? HEADLESS_WINDOW_SIZE : getWindowSize();
}

// this deals with the DPI scale rounding error causing the buffer to be too small
function padSize(size: Size): Size {
  return {
    width: size.width + 3,
    height: size.height + 3,
  };
}

export const managedViews: WindowView[] = [];
/**
 * Creates a new window with a toolbar and main content area
 * @param size Window size
 * @param initialUrl URL to load in the main content area
 * @returns The created window
 */
export async function createWindowWithToolbar(
  size: { width: number; height: number },
  initialUrl = 'https://github.com/atomashevic/cliweb',
  browserData: BrowserDataStore,
): Promise<WindowView> {
  console_.error('size', size);
  // Create layout container with device pixel dimensions
  const layoutContainer = layout(
    size.width,
    size.height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  // Create layout nodes for toolbar and content
  const toolbarNode = row({ height: px(TOOLBAR_HEIGHT), tag: 'toolbar' });
  const contentNode = row({ height: auto(), tag: 'content' });

  const hasAnimation = features.current?.loadFrame && features.current.compositeFrame;

  // Calculate layout
  calculateLayout(layoutContainer, [toolbarNode, contentNode]);

  const transparentWindowSettings = {
    transparent: true,
    backgroundColor: '#00000000',
  };

  const sharedConstructorOptions: BrowserWindowConstructorOptions = {
    useContentSize: true,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
    hiddenInMissionControl: true,
    acceptFirstMouse: true,
    skipTaskbar: true,
    fullscreenable: false,
    resizable: false,
  };

  const toolbar = new BrowserWindow({
    ...sharedConstructorOptions,
    ...toolbarNode.computedLayout,

    webPreferences: {
      zoomFactor: 1,
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,

      preload: path.resolve(__dirname, 'preload.js'),
    },
  });

  const content = new BrowserWindow({
    ...sharedConstructorOptions,
    ...contentNode.computedLayout,

    ...(options.transparent ? transparentWindowSettings : {}),

    webPreferences: {
      zoomFactor: 1,
      session: await sessionPromise,

      sandbox: true,
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      disableDialogs: true,
    },
  });

  const destructors: Array<() => void> = [];
  let terminalVisible = true;

  function unregisterPaints() {
    for (const destructor of destructors) {
      destructor();
    }
    destructors.length = 0;
  }

  function registerPaints(size: Size) {
    if (options['no-paint']) return;
    if (hasAnimation) {
      const containerBuffer = new ShmGraphicBuffer(size.width * size.height * 4);
      containerBuffer.writeEmpty();
      const containerFrame = paintInitialFrame(containerBuffer, size);
      destructors.push(
        containerFrame.free,
        registerPaintedContent(containerFrame, toolbar, toolbarNode).destroy,
        registerPaintedContent(containerFrame, content, contentNode).destroy,
      );
    } else {
      destructors.push(
        registerPaintedContentFallback(toolbar, toolbarNode).destroy,
        registerPaintedContentFallback(content, contentNode).destroy,
      );
    }
  }

  registerPaints(padSize(size));

  // Add to extensions
  extensionsPromise.then((extensions) => {
    extensions.addTab(content.webContents, content);
  });
  await installedExtensionsPromise;

  applyToolbarColors(toolbar);
  resetForFrameQuirk(toolbar.webContents);
  toolbar.webContents.loadFile(path.resolve(__dirname, 'toolbar/index.html'));

  toolbar.webContents.on('cursor-changed', updateCursor);
  content.webContents.on('cursor-changed', updateCursor);

  let view: WindowView;

  const setPanelMode = (mode: BrowserPanelMode | null) => {
    view.panelMode = mode;
    toolbarNode.height = mode ? auto() : px(TOOLBAR_HEIGHT);
    // Keep a tiny content surface because Electron rejects zero-sized BrowserWindows.
    contentNode.height = mode ? px(1) : auto();
    if (terminalVisible) unregisterPaints();
    const currentSize = getBrowserWindowSize();
    updateViewSizes(view, currentSize);
    if (terminalVisible) {
      registerPaints(padSize(currentSize));
      toolbar.webContents.invalidate();
      content.webContents.invalidate();
    }
    toolbar.webContents.send('browser-data:panel-mode-changed', mode);

    if (mode) {
      content.blurWebView();
      toolbar.focusOnWebView();
      view.focusedContent = toolbar.webContents;
    } else {
      toolbar.blurWebView();
      content.focusOnWebView();
      view.focusedContent = content.webContents;
    }
  };

  const sendBookmarkState = () => {
    toolbar.webContents.send(
      'browser-data:bookmark-state-changed',
      browserData.isBookmarked(content.webContents.getURL()),
    );
  };

  view = {
    toolbar,
    content,
    focusedContent: content.webContents,
    layoutContainer,
    toolbarNode,
    contentNode,
    isPrivate: Boolean(options.private),
    panelMode: null,
    back: () => {
      content.webContents.goBack();
    },
    forward: () => {
      content.webContents.goForward();
    },
    refresh: () => {
      content.webContents.reload();
    },
    currentPageState: () => ({
      url: content.webContents.getURL(),
      title: content.webContents.getTitle(),
      isBookmarked: browserData.isBookmarked(content.webContents.getURL()),
      isPrivate: Boolean(options.private),
    }),
    toggleBookmark: () => {
      const result = browserData.toggleBookmark(
        content.webContents.getURL(),
        content.webContents.getTitle(),
      );
      sendBookmarkState();
      toolbar.webContents.send('browser-data:data-changed', 'bookmarks');
      return result;
    },
    showPanel: (mode) => setPanelMode(mode),
    closePanel: () => setPanelMode(null),
    queryPanel: (mode, query, limit) => browserData.queryPanel(mode, query, limit),
    removeBookmark: (id) => {
      const removed = browserData.removeBookmark(id);
      if (removed) {
        sendBookmarkState();
        toolbar.webContents.send('browser-data:data-changed', 'bookmarks');
      }
      return removed;
    },
    openBrowserDataItem: async (rawUrl) => {
      const url = normalizeStoredUrl(rawUrl);
      if (!url) throw new Error('Only HTTP and HTTPS browser-data URLs can be opened');
      setPanelMode(null);
      await content.webContents.loadURL(url);
    },
    clearHistory: () => {
      const removed = browserData.clearHistory();
      toolbar.webContents.send('browser-data:data-changed', 'history');
      return removed;
    },
    clearCurrentSiteData: async () => {
      const origin = await clearSiteData(content.webContents.getURL());
      content.webContents.reload();
      return origin;
    },
    setTerminalVisible: (visible) => {
      if (visible === terminalVisible) return;
      terminalVisible = visible;
      if (!visible) {
        unregisterPaints();
        return;
      }

      const size = getBrowserWindowSize();
      updateViewSizes(view, size);
      registerPaints(padSize(size));
      toolbar.webContents.invalidate();
      content.webContents.invalidate();
    },
    isTerminalVisible: () => terminalVisible,
  };

  // Add to managed windows
  managedViews.push(view);
  focusedView.current = view;

  // Set up IPC for toolbar interactions
  setupToolbarIPC(view, browserData);

  resetForFrameQuirk(content.webContents);
  content.webContents.loadURL(initialUrl);

  process.on(
    'SIGWINCH',
    debounce(100, () => {
      if (!terminalVisible) return;
      unregisterPaints();

      const size = getBrowserWindowSize();
      console_.error('resize', size);
      updateViewSizes(view, size);
      registerPaints(padSize(size));
      toolbar.webContents.invalidate();
      content.webContents.invalidate();
    }),
  );

  return view;
}

function updateViewSizes(view: WindowView, { width, height }: Size) {
  const { toolbar, content, toolbarNode, contentNode } = view;
  view.layoutContainer = layout(
    width,
    height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  calculateLayout(view.layoutContainer, [toolbarNode, contentNode]);

  // Update window sizes based on layout
  toolbar.setContentSize(toolbarNode.computedLayout.width, toolbarNode.computedLayout.height);
  content.setContentSize(contentNode.computedLayout.width, contentNode.computedLayout.height);
}

function setupToolbarIPC(view: WindowView, browserData: BrowserDataStore) {
  const toolbarContents = view.toolbar.webContents;
  const contentContents = view.content.webContents;

  const requireToolbarSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    if (event.sender !== toolbarContents) throw new Error('Rejected IPC from non-toolbar renderer');
  };

  ipcMain.on('toolbar:navigate-back', (event) => {
    requireToolbarSender(event);
    if (contentContents.navigationHistory.canGoBack()) {
      contentContents.navigationHistory.goBack();
    }
  });

  ipcMain.on('toolbar:navigate-forward', (event) => {
    requireToolbarSender(event);
    if (contentContents.navigationHistory.canGoForward()) {
      contentContents.navigationHistory.goForward();
    }
  });

  ipcMain.on('toolbar:navigate-refresh', (event) => {
    requireToolbarSender(event);
    contentContents.reload();
  });

  ipcMain.handle('toolbar:navigate-to', async (event, target: string) => {
    requireToolbarSender(event);
    if (typeof target !== 'string') throw new Error('Invalid navigation target');
    await contentContents.loadURL(normalizeNavigationUrl(target));
  });

  ipcMain.handle('browser-data:get-current', (event) => {
    requireToolbarSender(event);
    return view.currentPageState();
  });

  ipcMain.handle('browser-data:toggle-bookmark', (event) => {
    requireToolbarSender(event);
    return view.toggleBookmark();
  });

  ipcMain.handle('browser-data:set-panel-mode', (event, mode: BrowserPanelMode | null) => {
    requireToolbarSender(event);
    if (mode !== null && !['bookmarks', 'history'].includes(mode)) {
      throw new Error(`Unsupported browser panel: ${String(mode)}`);
    }
    if (mode) view.showPanel(mode);
    else view.closePanel();
    return view.panelMode;
  });

  ipcMain.handle(
    'browser-data:query-panel',
    (event, mode: BrowserPanelMode, query?: string, limit?: number) => {
      requireToolbarSender(event);
      if (!['bookmarks', 'history'].includes(mode)) {
        throw new Error(`Unsupported browser panel: ${String(mode)}`);
      }
      return view.queryPanel(mode, query, limit);
    },
  );

  ipcMain.handle('browser-data:remove-bookmark', (event, id: string) => {
    requireToolbarSender(event);
    if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid bookmark id');
    return view.removeBookmark(id);
  });

  ipcMain.handle('browser-data:open-item', async (event, url: string) => {
    requireToolbarSender(event);
    await view.openBrowserDataItem(url);
  });

  ipcMain.handle('browser-data:clear-history', (event) => {
    requireToolbarSender(event);
    return view.clearHistory();
  });

  ipcMain.handle('browser-data:clear-site-data', async (event) => {
    requireToolbarSender(event);
    return view.clearCurrentSiteData();
  });

  contentContents.on('did-start-loading', () => {
    toolbarContents.send('content:loading-started');
  });

  contentContents.on('did-stop-loading', () => {
    toolbarContents.send('content:loading-stopped');
    sendCurrentPageState();
  });

  const sendNavigationState = () => {
    toolbarContents.send('content:navigation-state-changed', {
      canGoBack: contentContents.navigationHistory.canGoBack(),
      canGoForward: contentContents.navigationHistory.canGoForward(),
    });
  };

  const sendCurrentPageState = () => {
    toolbarContents.send('content:url-changed', contentContents.getURL());
    toolbarContents.send('browser-data:current-page-changed', view.currentPageState());
    sendNavigationState();
  };

  const recordNavigation = (url: string) => {
    if (!view.isPrivate) browserData.recordVisit(url, contentContents.getTitle());
    sendCurrentPageState();
  };

  contentContents.on('did-navigate', (_event, url) => recordNavigation(url));

  contentContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) recordNavigation(url);
  });

  contentContents.on('page-title-updated', (_event, title) => {
    if (!view.isPrivate) browserData.updateLatestHistoryTitle(contentContents.getURL(), title);
    sendCurrentPageState();
  });

  toolbarContents.on('did-finish-load', sendCurrentPageState);
}
