import { describe, expect, test } from 'bun:test';
import { mousePointInDevicePixels } from './mouseCoordinates';

describe('terminal mouse coordinates', () => {
  test('keeps native SGR-Pixels coordinates unchanged', () => {
    expect(mousePointInDevicePixels({ x: 495, y: 517 }, { unit: 'pixels' })).toEqual({
      x: 495,
      y: 517,
    });
  });

  test('expands tmux cell coordinates to device-pixel cell centers', () => {
    expect(
      mousePointInDevicePixels(
        { x: 49, y: 23 },
        {
          unit: 'cells',
          columns: 98,
          rows: 46,
          deviceWidth: 980,
          deviceHeight: 1012,
        },
      ),
    ).toEqual({ x: 495, y: 517 });
  });

  test('keeps toolbar and content rows on the correct side of the 40px boundary', () => {
    const space = {
      unit: 'cells' as const,
      columns: 98,
      rows: 46,
      deviceWidth: 980,
      deviceHeight: 1012,
    };

    expect(mousePointInDevicePixels({ x: 5, y: 1 }, space).y).toBe(33);
    expect(mousePointInDevicePixels({ x: 5, y: 2 }, space).y).toBe(55);
  });

  test('clamps out-of-range cell coordinates to the rendered surface', () => {
    expect(
      mousePointInDevicePixels(
        { x: 98, y: 46 },
        {
          unit: 'cells',
          columns: 98,
          rows: 46,
          deviceWidth: 980,
          deviceHeight: 1012,
        },
      ),
    ).toEqual({ x: 979, y: 1011 });
  });

  test('falls back to the original coordinates for an invalid terminal grid', () => {
    expect(
      mousePointInDevicePixels(
        { x: 12, y: 8 },
        {
          unit: 'cells',
          columns: 0,
          rows: 0,
          deviceWidth: 0,
          deviceHeight: 0,
        },
      ),
    ).toEqual({ x: 12, y: 8 });
  });
});
