import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { BrowserController } from './browserController';
import { ControlError } from './protocol';
import type { WindowView } from '../windows';

function fixture() {
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
  const calls: Array<{ method: string; params: unknown }> = [];
  let attached = false;
  const debuggerEmitter = new EventEmitter() as EventEmitter & Record<string, any>;
  debuggerEmitter.isAttached = () => attached;
  debuggerEmitter.attach = () => {
    attached = true;
  };
  debuggerEmitter.sendCommand = async (method: string, params: unknown) => {
    calls.push({ method, params });
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
  emitter.getURL = () => 'https://example.test/';
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
