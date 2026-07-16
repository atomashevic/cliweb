import type { WebContents } from 'electron';
import type { WindowView } from '../windows';
import {
  ControlError,
  DEFAULT_SNAPSHOT_NODES,
  DEFAULT_TIMEOUT_MS,
  MAX_SNAPSHOT_NODES,
  normalizeNavigationUrl,
  optionalNumber,
  requireElementTarget,
  requireString,
  type ControlMethod,
  type ElementTarget,
} from './protocol';

type CdpNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  description?: { value?: unknown };
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
};

const ACTIONABLE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

const KEY_DEFINITIONS: Record<string, { key: string; code: string; virtualKeyCode: number }> = {
  enter: { key: 'Enter', code: 'Enter', virtualKeyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', virtualKeyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', virtualKeyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', virtualKeyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', virtualKeyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', virtualKeyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', virtualKeyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', virtualKeyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', virtualKeyCode: 39 },
  home: { key: 'Home', code: 'Home', virtualKeyCode: 36 },
  end: { key: 'End', code: 'End', virtualKeyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', virtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', virtualKeyCode: 34 },
  space: { key: ' ', code: 'Space', virtualKeyCode: 32 },
};

function scalar(value: unknown): string | number | boolean | undefined {
  return ['string', 'number', 'boolean'].includes(typeof value)
    ? (value as string | number | boolean)
    : undefined;
}

function timeoutError(timeoutMs: number): ControlError {
  return new ControlError('TIMEOUT', `Browser operation exceeded ${timeoutMs}ms`);
}

export class BrowserController {
  private documentEpoch = 1;
  private debuggerInitialized = false;

  constructor(private readonly view: WindowView) {
    const contents = this.contents;
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.documentEpoch++;
    });
    contents.debugger.on('detach', () => {
      this.debuggerInitialized = false;
    });
  }

  private get contents(): WebContents {
    return this.view.content.webContents;
  }

  async handle(method: ControlMethod, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case 'status':
        return this.status();
      case 'snapshot':
        return this.snapshot(params);
      case 'screenshot':
        return this.screenshot(params);
      case 'navigate':
        return this.navigate(requireString(params, 'url'));
      case 'back':
        return this.back();
      case 'forward':
        return this.forward();
      case 'reload':
        return this.reload();
      case 'bookmark-toggle':
        return this.view.toggleBookmark();
      case 'bookmarks':
        return this.view.queryPanel(
          'bookmarks',
          typeof params.query === 'string' ? params.query : '',
          optionalNumber(params, 'limit', 500),
        );
      case 'history':
        return this.view.queryPanel(
          'history',
          typeof params.query === 'string' ? params.query : '',
          optionalNumber(params, 'limit', 500),
        );
      case 'clear-history':
        return { removed: this.view.clearHistory() };
      case 'clear-site-data':
        return { origin: await this.view.clearCurrentSiteData() };
      case 'show-bookmarks':
        this.view.showPanel('bookmarks');
        return { panel: this.view.panelMode };
      case 'show-history':
        this.view.showPanel('history');
        return { panel: this.view.panelMode };
      case 'close-panel':
        this.view.closePanel();
        return { panel: this.view.panelMode };
      case 'click':
        return this.click(requireElementTarget(params));
      case 'fill':
        return this.fill(
          requireElementTarget(params),
          requireString(params, 'text', { allowEmpty: true }),
        );
      case 'press':
        return this.press(params);
      case 'scroll':
        return this.scroll(params);
      case 'wait':
        return this.waitForIdle(optionalNumber(params, 'timeoutMs', DEFAULT_TIMEOUT_MS));
      case 'visibility': {
        if (typeof params.visible !== 'boolean') {
          throw new ControlError('INVALID_REQUEST', 'Expected visible to be a boolean');
        }
        this.view.setTerminalVisible(params.visible);
        return { visible: this.view.isTerminalVisible() };
      }
    }
  }

  status() {
    const [width, height] = this.view.content.getContentSize();
    return {
      url: this.contents.getURL(),
      title: this.contents.getTitle(),
      loading: this.contents.isLoading(),
      viewport: { width, height },
      history: {
        canGoBack: this.contents.navigationHistory.canGoBack(),
        canGoForward: this.contents.navigationHistory.canGoForward(),
      },
      private: this.view.isPrivate,
      persistentSession: this.contents.session.isPersistent(),
      bookmarked: this.view.currentPageState().isBookmarked,
      panel: this.view.panelMode,
      documentEpoch: this.documentEpoch,
      visible: this.view.isTerminalVisible(),
    };
  }

  private async ensureDebugger(): Promise<void> {
    try {
      if (!this.contents.debugger.isAttached()) this.contents.debugger.attach('1.3');
      if (!this.debuggerInitialized) {
        await this.contents.debugger.sendCommand('DOM.enable');
        await this.contents.debugger.sendCommand('Accessibility.enable');
        this.debuggerInitialized = true;
      }
    } catch (error) {
      throw new ControlError(
        'DEBUGGER_UNAVAILABLE',
        `Could not attach to cliweb content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cdp(method: string, params?: Record<string, unknown>): Promise<any> {
    await this.ensureDebugger();
    try {
      return await this.contents.debugger.sendCommand(method, params);
    } catch (error) {
      throw new ControlError(
        'INTERNAL',
        `${method} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async snapshot(params: Record<string, unknown>) {
    const requested = Math.floor(optionalNumber(params, 'maxNodes', DEFAULT_SNAPSHOT_NODES));
    const maxNodes = Math.min(Math.max(requested, 1), MAX_SNAPSHOT_NODES);
    const response = (await this.cdp('Accessibility.getFullAXTree')) as { nodes?: CdpNode[] };
    const rawNodes = response.nodes ?? [];
    const byId = new Map(rawNodes.map((node) => [node.nodeId, node]));
    const childIds = new Set(rawNodes.flatMap((node) => node.childIds ?? []));
    const roots = rawNodes.filter((node) => !childIds.has(node.nodeId));
    const nodes: Array<Record<string, unknown>> = [];
    let availableNodes = 0;

    const visit = (node: CdpNode, depth: number) => {
      if (node.ignored) {
        for (const childId of node.childIds ?? []) {
          const child = byId.get(childId);
          if (child) visit(child, depth);
        }
        return;
      }
      const role = scalar(node.role?.value) ?? 'unknown';
      const name = scalar(node.name?.value);
      const value = scalar(node.value?.value);
      const description = scalar(node.description?.value);
      const properties = Object.fromEntries(
        (node.properties ?? [])
          .map((property) => [property.name, scalar(property.value?.value)] as const)
          .filter((entry) => entry[1] !== undefined),
      );
      const meaningful =
        role !== 'none' &&
        (role !== 'generic' ||
          name !== undefined ||
          value !== undefined ||
          description !== undefined);

      if (meaningful) {
        availableNodes++;
        if (nodes.length < maxNodes) {
          const actionable =
            typeof role === 'string' &&
            (ACTIONABLE_ROLES.has(role) ||
              properties.focusable === true ||
              properties.clickable === true);
          nodes.push({
            depth,
            role,
            ...(name !== undefined ? { name } : {}),
            ...(value !== undefined ? { value } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(Object.keys(properties).length > 0 ? { properties } : {}),
            ...(actionable && node.backendDOMNodeId !== undefined
              ? { ref: `d${this.documentEpoch}-n${node.backendDOMNodeId}` }
              : {}),
          });
        }
      }

      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) visit(child, meaningful ? depth + 1 : depth);
      }
    };

    for (const root of roots) visit(root, 0);
    return {
      snapshotId: `d${this.documentEpoch}-${Date.now().toString(36)}`,
      url: this.contents.getURL(),
      title: this.contents.getTitle(),
      nodes,
      truncated: availableNodes > nodes.length,
      availableNodes,
    };
  }

  private async screenshot(params: Record<string, unknown>) {
    const surface = params.surface ?? 'content';
    if (!['content', 'toolbar'].includes(surface as string)) {
      throw new ControlError('INVALID_REQUEST', `Unknown screenshot surface: ${String(surface)}`);
    }
    const contents = surface === 'toolbar' ? this.view.toolbar.webContents : this.contents;
    const image = await contents.capturePage(undefined, { stayHidden: true });
    const size = image.getSize();
    return {
      surface,
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
      dataBase64: image.toPNG().toString('base64'),
    };
  }

  private async navigate(value: string) {
    await this.contents.loadURL(normalizeNavigationUrl(value));
    return this.waitForIdle(DEFAULT_TIMEOUT_MS);
  }

  private async back() {
    if (!this.contents.navigationHistory.canGoBack()) {
      throw new ControlError('INVALID_REQUEST', 'No previous history entry');
    }
    this.contents.navigationHistory.goBack();
    return this.waitForIdle(DEFAULT_TIMEOUT_MS);
  }

  private async forward() {
    if (!this.contents.navigationHistory.canGoForward()) {
      throw new ControlError('INVALID_REQUEST', 'No forward history entry');
    }
    this.contents.navigationHistory.goForward();
    return this.waitForIdle(DEFAULT_TIMEOUT_MS);
  }

  private async reload() {
    this.contents.reload();
    return this.waitForIdle(DEFAULT_TIMEOUT_MS);
  }

  private async resolveTarget(target: ElementTarget): Promise<number> {
    if (target.ref) {
      const match = /^d(\d+)-n(\d+)$/.exec(target.ref);
      if (!match) throw new ControlError('INVALID_REQUEST', `Invalid element ref: ${target.ref}`);
      if (Number(match[1]) !== this.documentEpoch) {
        throw new ControlError(
          'STALE_REF',
          `Element ref ${target.ref} belongs to an older document`,
        );
      }
      return Number(match[2]);
    }

    const document = await this.cdp('DOM.getDocument', { depth: 0, pierce: false });
    const result = await this.cdp('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: target.selector,
    });
    if (!result.nodeId)
      throw new ControlError('NOT_FOUND', `No element matches ${target.selector}`);
    const described = await this.cdp('DOM.describeNode', { nodeId: result.nodeId });
    const backendNodeId = described.node?.backendNodeId;
    if (typeof backendNodeId !== 'number') {
      throw new ControlError('NOT_FOUND', `Could not resolve ${target.selector}`);
    }
    return backendNodeId;
  }

  private async focusTarget(target: ElementTarget): Promise<number> {
    const backendNodeId = await this.resolveTarget(target);
    try {
      await this.cdp('DOM.scrollIntoViewIfNeeded', { backendNodeId });
    } catch {
      // Some non-layout nodes cannot be scrolled but may still be focusable.
    }
    await this.cdp('DOM.focus', { backendNodeId });
    return backendNodeId;
  }

  private async click(target: ElementTarget) {
    const backendNodeId = await this.resolveTarget(target);
    try {
      await this.cdp('DOM.scrollIntoViewIfNeeded', { backendNodeId });
    } catch {}
    const response = await this.cdp('DOM.getBoxModel', { backendNodeId });
    const quad = response.model?.content ?? response.model?.border;
    if (!Array.isArray(quad) || quad.length !== 8) {
      throw new ControlError('NOT_FOUND', 'Element has no clickable box');
    }
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    return {
      clicked: true,
      ref: target.ref,
      selector: target.selector,
      url: this.contents.getURL(),
    };
  }

  private async fill(target: ElementTarget, text: string) {
    await this.focusTarget(target);
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await this.dispatchKey({ key: 'a', code: 'KeyA', virtualKeyCode: 65 }, modifiers);
    await this.dispatchKey(KEY_DEFINITIONS.backspace, 0);
    if (text.length > 0) await this.cdp('Input.insertText', { text });
    return { filled: true, ref: target.ref, selector: target.selector, length: text.length };
  }

  private async press(params: Record<string, unknown>) {
    const keySpec = requireString(params, 'key');
    const hasTarget = typeof params.ref === 'string' || typeof params.selector === 'string';
    if (hasTarget) await this.focusTarget(requireElementTarget(params));
    const parts = keySpec.split('+').filter(Boolean);
    const keyName = parts.pop();
    if (!keyName) throw new ControlError('INVALID_REQUEST', 'Key cannot be empty');
    let modifiers = 0;
    for (const modifier of parts) {
      switch (modifier.toLowerCase()) {
        case 'alt':
          modifiers |= 1;
          break;
        case 'control':
        case 'ctrl':
          modifiers |= 2;
          break;
        case 'meta':
        case 'cmd':
          modifiers |= 4;
          break;
        case 'shift':
          modifiers |= 8;
          break;
        default:
          throw new ControlError('INVALID_REQUEST', `Unknown key modifier: ${modifier}`);
      }
    }

    const definition = KEY_DEFINITIONS[keyName.toLowerCase()] ?? this.characterKey(keyName);
    await this.dispatchKey(
      definition,
      modifiers,
      keyName.length === 1 && modifiers === 0 ? keyName : undefined,
    );
    return { pressed: keySpec };
  }

  private characterKey(value: string) {
    if (value.length !== 1) throw new ControlError('INVALID_REQUEST', `Unknown key: ${value}`);
    const upper = value.toUpperCase();
    return {
      key: value,
      code: /[A-Z]/.test(upper) ? `Key${upper}` : value,
      virtualKeyCode: upper.charCodeAt(0),
    };
  }

  private async dispatchKey(
    definition: { key: string; code: string; virtualKeyCode: number },
    modifiers: number,
    text?: string,
  ) {
    const common = {
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.virtualKeyCode,
      nativeVirtualKeyCode: definition.virtualKeyCode,
      modifiers,
    };
    await this.cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...common,
      ...(text ? { text } : {}),
    });
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  private async scroll(params: Record<string, unknown>) {
    const deltaX = optionalNumber(params, 'deltaX', 0);
    const deltaY = optionalNumber(params, 'deltaY', 0);
    const [width, height] = this.view.content.getContentSize();
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: width / 2,
      y: height / 2,
      deltaX,
      deltaY,
    });
    return { scrolled: true, deltaX, deltaY };
  }

  async waitForIdle(timeoutMs: number) {
    if (timeoutMs <= 0 || timeoutMs > 120_000) {
      throw new ControlError('INVALID_REQUEST', 'timeoutMs must be between 1 and 120000');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!this.contents.isLoading()) return this.status();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(timeoutError(timeoutMs));
      }, timeoutMs);
      const complete = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.contents.off('did-stop-loading', complete);
        this.contents.off('did-fail-load', complete);
      };
      this.contents.once('did-stop-loading', complete);
      this.contents.once('did-fail-load', complete);
    });
    return this.status();
  }
}
