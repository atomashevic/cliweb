import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { BrowserController, dispatchPdfClickAt } from './browserController';
import { ControlError } from './protocol';
import type { WindowView } from '../windows';

function fixture({
  url = 'https://example.test/',
  targetInfos = [],
}: {
  url?: string;
  targetInfos?: Array<{ targetId: string; type: string; url: string }>;
} = {}) {
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
  const calls: Array<{ method: string; params: unknown; sessionId?: string }> = [];
  let attached = false;
  const debuggerEmitter = new EventEmitter() as EventEmitter & Record<string, any>;
  debuggerEmitter.isAttached = () => attached;
  debuggerEmitter.attach = () => {
    attached = true;
  };
  debuggerEmitter.sendCommand = async (method: string, params: unknown, sessionId?: string) => {
    calls.push({ method, params, ...(sessionId ? { sessionId } : {}) });
    if (method === 'Target.getTargets') return { targetInfos };
    if (method === 'Target.attachToTarget') return { sessionId: 'pdf-session' };
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: 41 };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'resolved-node' } };
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [
          { nodeId: '1', ignored: true, childIds: ['2'] },
          {
            nodeId: '2',
            role: { value: 'RootWebArea' },
            name: { value: 'Fixture' },
            childIds: ['3'],
          },
          {
            nodeId: '3',
            role: { value: 'button' },
            name: { value: 'Submit' },
            backendDOMNodeId: 41,
          },
        ],
      };
    }
    if (method === 'DOM.getBoxModel') {
      return { model: { content: [0, 0, 20, 0, 20, 10, 0, 10] } };
    }
    return {};
  };
  emitter.debugger = debuggerEmitter;
  emitter.getURL = () => url;
  emitter.getTitle = () => 'Fixture';
  emitter.isLoading = () => false;
  const capturePage = async () => ({
    getSize: () => ({ width: 100, height: 50 }),
    toPNG: () => Buffer.from('png'),
  });
  emitter.capturePage = capturePage;
  emitter.navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
  };
  emitter.session = { isPersistent: () => true };
  let terminalVisible = true;
  let historyClears = 0;
  let siteDataClears = 0;
  const view = {
    toolbar: {
      webContents: { capturePage },
    },
    content: {
      webContents: emitter,
      getContentSize: () => [100, 50],
    },
    setTerminalVisible: (visible: boolean) => {
      terminalVisible = visible;
    },
    isTerminalVisible: () => terminalVisible,
    isPrivate: false,
    panelMode: null,
    showPanel: (mode: 'bookmarks' | 'history') => {
      view.panelMode = mode;
    },
    closePanel: () => {
      view.panelMode = null;
    },
    currentPageState: () => ({
      url: 'https://example.test/',
      title: 'Fixture',
      isBookmarked: false,
      isPrivate: false,
    }),
    toggleBookmark: () => ({ bookmarked: true }),
    queryPanel: (mode: 'bookmarks' | 'history') => ({ mode, items: [] }),
    clearHistory: () => ++historyClears,
    clearCurrentSiteData: async () => {
      siteDataClears++;
      return 'https://example.test';
    },
  } as unknown as WindowView;
  return {
    controller: new BrowserController(view),
    emitter,
    calls,
    getHistoryClears: () => historyClears,
    getSiteDataClears: () => siteDataClears,
  };
}

describe('browser controller', () => {
  test('creates semantic refs through ignored accessibility ancestors', async () => {
    const { controller } = fixture();
    const snapshot = (await controller.handle('snapshot')) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect(snapshot.nodes).toContainEqual({
      depth: 1,
      role: 'button',
      name: 'Submit',
      ref: 'd1-n41',
    });
  });

  test('dispatches a click to the center of an element box', async () => {
    const { controller, calls } = fixture();
    await controller.handle('click', { ref: 'd1-n41' });
    expect(calls).toContainEqual({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', x: 10, y: 5, button: 'left', clickCount: 1 },
    });
  });

  test('routes PDF keyboard input to Chromium\'s embedded viewer target', async () => {
    const { controller, calls } = fixture({
      url: 'file:///tmp/document.pdf',
      targetInfos: [
        {
          targetId: 'pdf-target',
          type: 'webview',
          url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
        },
      ],
    });

    await controller.handle('press', { key: 'Control+-' });

    expect(calls).toContainEqual({
      method: 'Target.attachToTarget',
      params: { targetId: 'pdf-target', flatten: true },
    });
    expect(calls).toContainEqual({
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyDown',
        key: '-',
        code: '-',
        windowsVirtualKeyCode: 45,
        nativeVirtualKeyCode: 45,
        modifiers: 2,
      },
      sessionId: 'pdf-session',
    });
  });

  test('activates PDF controls in the embedded viewer document', async () => {
    const { controller, calls } = fixture({
      url: 'file:///tmp/document.pdf',
      targetInfos: [
        {
          targetId: 'pdf-target',
          type: 'webview',
          url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
        },
      ],
    });

    await controller.handle('click', { ref: 'd1-n41' });

    expect(calls.find((call) => call.method === 'Runtime.callFunctionOn')).toMatchObject({
      method: 'Runtime.callFunctionOn',
      params: {
        objectId: 'resolved-node',
        userGesture: true,
        returnByValue: true,
      },
      sessionId: 'pdf-session',
    });
  });

  test('hit-tests physical PDF clicks in the embedded viewer', async () => {
    const { controller, emitter, calls } = fixture({
      url: 'file:///tmp/document.pdf',
      targetInfos: [
        {
          targetId: 'pdf-target',
          type: 'webview',
          url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
        },
      ],
    });
    expect(controller).toBeDefined();

    expect(dispatchPdfClickAt(emitter, 501, 28)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toContainEqual({
      method: 'DOM.getNodeForLocation',
      params: {
        x: 501,
        y: 28,
        includeUserAgentShadowDOM: true,
        ignorePointerEventsNone: true,
      },
      sessionId: 'pdf-session',
    });
    expect(calls.some((call) => call.method === 'Runtime.callFunctionOn')).toBe(true);
  });

  test('captures the trusted toolbar surface on request', async () => {
    const { controller } = fixture();
    expect(await controller.handle('screenshot', { surface: 'toolbar' })).toMatchObject({
      surface: 'toolbar',
      width: 100,
      height: 50,
    });
  });

  test('rejects refs after top-level navigation', async () => {
    const { controller, emitter } = fixture();
    emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await expect(controller.handle('click', { ref: 'd1-n41' })).rejects.toBeInstanceOf(
      ControlError,
    );
  });

  test('updates terminal visibility for tmux window changes', async () => {
    const { controller } = fixture();
    await expect(controller.handle('visibility', { visible: false })).resolves.toEqual({
      visible: false,
    });
    expect(controller.status()).toMatchObject({ visible: false });
  });

  test('exposes private and bookmark state in status', () => {
    const { controller } = fixture();
    expect(controller.status()).toMatchObject({
      private: false,
      persistentSession: true,
      bookmarked: false,
      panel: null,
    });
  });

  test('routes browser data and clearing methods through the view', async () => {
    const { controller, getHistoryClears, getSiteDataClears } = fixture();
    expect(await controller.handle('bookmark-toggle')).toEqual({ bookmarked: true });
    expect(await controller.handle('bookmarks')).toEqual({ mode: 'bookmarks', items: [] });
    expect(await controller.handle('history')).toEqual({ mode: 'history', items: [] });
    expect(await controller.handle('clear-history')).toEqual({ removed: 1 });
    expect(await controller.handle('clear-site-data')).toEqual({ origin: 'https://example.test' });
    expect(getHistoryClears()).toBe(1);
    expect(getSiteDataClears()).toBe(1);
  });

  test('opens and closes browser-data panels', async () => {
    const { controller } = fixture();
    expect(await controller.handle('show-bookmarks')).toEqual({ panel: 'bookmarks' });
    expect(controller.status()).toMatchObject({ panel: 'bookmarks' });
    expect(await controller.handle('show-history')).toEqual({ panel: 'history' });
    expect(await controller.handle('close-panel')).toEqual({ panel: null });
  });
});
