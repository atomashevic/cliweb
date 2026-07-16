import { describe, expect, test } from 'bun:test';
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
    expect(normalizeNavigationUrl('data:text/plain,hello')).toBe('data:text/plain,hello');
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
