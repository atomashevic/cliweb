import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ControlError,
  isControlMethod,
  normalizeNavigationUrl,
  requireElementTarget,
} from './protocol';

describe('control protocol helpers', () => {
  test('normalizes supported URLs', () => {
    expect(normalizeNavigationUrl('example.com')).toBe('https://example.com/');
    expect(normalizeNavigationUrl('http://example.com/path')).toBe('http://example.com/path');
    expect(normalizeNavigationUrl(' file:///tmp/example.pdf ')).toBe('file:///tmp/example.pdf');
    expect(normalizeNavigationUrl('data:text/plain,hello')).toBe('data:text/plain,hello');
  });

  test('converts an existing local PDF path to a file URL', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-pdf-navigation-'));
    try {
      const pdfPath = path.join(root, 'paper #1.PDF');
      fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF\n');

      expect(normalizeNavigationUrl('paper #1.PDF', root)).toBe(pathToFileURL(pdfPath).href);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not reinterpret missing PDF paths as local files', () => {
    expect(normalizeNavigationUrl('missing.pdf', os.tmpdir())).toBe('https://missing.pdf/');
  });

  test('rejects unsupported URL protocols', () => {
    expect(() => normalizeNavigationUrl('javascript:alert(1)')).toThrow(ControlError);
  });

  test('requires exactly one element target', () => {
    expect(requireElementTarget({ ref: 'd1-n2' })).toEqual({ ref: 'd1-n2' });
    expect(requireElementTarget({ selector: '#submit' })).toEqual({ selector: '#submit' });
    expect(() => requireElementTarget({})).toThrow('Provide exactly one');
    expect(() => requireElementTarget({ ref: 'd1-n2', selector: '#submit' })).toThrow(
      'Provide exactly one',
    );
  });

  test('accepts the internal tmux visibility method', () => {
    expect(isControlMethod('visibility')).toBe(true);
  });

  test('accepts browser-data methods', () => {
    expect(isControlMethod('bookmark-toggle')).toBe(true);
    expect(isControlMethod('bookmarks')).toBe(true);
    expect(isControlMethod('history')).toBe(true);
    expect(isControlMethod('clear-history')).toBe(true);
    expect(isControlMethod('clear-site-data')).toBe(true);
    expect(isControlMethod('show-bookmarks')).toBe(true);
    expect(isControlMethod('show-history')).toBe(true);
    expect(isControlMethod('close-panel')).toBe(true);
  });
});
