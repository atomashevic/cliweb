import { describe, expect, test } from 'bun:test';
import { ImageIdRegistry } from './imageIds';

describe('ImageIdRegistry', () => {
  test('tracks allocated and released image IDs', () => {
    const candidates = [41, 42];
    const registry = new ImageIdRegistry(() => candidates.shift() ?? 43);

    const first = registry.allocate();
    const second = registry.allocate();

    expect(registry.activeIds()).toEqual([first, second]);
    expect(registry.release(first)).toBe(true);
    expect(registry.release(first)).toBe(false);
    expect(registry.activeIds()).toEqual([second]);
  });

  test('retries when a generated ID is already active', () => {
    const candidates = [7, 7, 8];
    const registry = new ImageIdRegistry(() => candidates.shift() ?? 9);

    expect(registry.allocate()).toBe(7);
    expect(registry.allocate()).toBe(8);
  });

  test('rejects IDs outside the application namespace', () => {
    expect(() => new ImageIdRegistry(() => 0).allocate()).toThrow(RangeError);
    expect(() => new ImageIdRegistry(() => 0x80000000).allocate()).toThrow(RangeError);
  });
});
