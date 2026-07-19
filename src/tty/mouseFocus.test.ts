import { describe, expect, test } from 'bun:test';
import { focusMouseTarget } from './mouseFocus';

describe('mouse focus routing', () => {
  test('focuses content before the first click crosses from the toolbar', () => {
    const calls: string[] = [];
    const toolbarContents = {};
    const contentContents = { focus: () => calls.push('content:web-focus') };
    const view = {
      toolbar: {
        webContents: { ...toolbarContents, focus: () => calls.push('toolbar:web-focus') },
        focus: () => calls.push('toolbar:window-focus'),
        blurWebView: () => calls.push('toolbar:blur'),
        focusOnWebView: () => calls.push('toolbar:focus'),
      },
      content: {
        webContents: contentContents,
        focus: () => calls.push('content:window-focus'),
        blurWebView: () => calls.push('content:blur'),
        focusOnWebView: () => calls.push('content:focus'),
      },
      focusedContent: toolbarContents,
    };

    focusMouseTarget(view, contentContents);

    expect(calls).toEqual([
      'toolbar:blur',
      'content:window-focus',
      'content:focus',
      'content:web-focus',
    ]);
    expect(view.focusedContent).toBe(contentContents);
  });

  test('refocuses the active surface before each click', () => {
    const calls: string[] = [];
    const contentContents = { focus: () => calls.push('content:web-focus') };
    const view = {
      toolbar: {
        webContents: { focus: () => calls.push('toolbar:web-focus') },
        focus: () => calls.push('toolbar:window-focus'),
        blurWebView: () => calls.push('toolbar:blur'),
        focusOnWebView: () => calls.push('toolbar:focus'),
      },
      content: {
        webContents: contentContents,
        focus: () => calls.push('content:window-focus'),
        blurWebView: () => calls.push('content:blur'),
        focusOnWebView: () => calls.push('content:focus'),
      },
      focusedContent: contentContents,
    };

    focusMouseTarget(view, contentContents);

    expect(calls).toEqual([
      'toolbar:blur',
      'content:window-focus',
      'content:focus',
      'content:web-focus',
    ]);
  });
});
