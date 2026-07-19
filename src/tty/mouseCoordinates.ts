export type MousePoint = { x: number; y: number };

export type MouseCoordinateSpace =
  | { unit: 'pixels' }
  | {
      unit: 'cells';
      columns: number;
      rows: number;
      deviceWidth: number;
      deviceHeight: number;
    };

function validExtent(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function cellCenterInPixels(cell: number, cells: number, pixels: number): number {
  const center = (cell + 0.5) * (pixels / cells);
  return Math.min(Math.max(center, 0), Math.max(pixels - 1, 0));
}

/**
 * Convert terminal mouse coordinates into the device-pixel coordinate space
 * used by the offscreen Electron windows.
 *
 * Terminals that support SGR-Pixels (1016) already report pixels. tmux 3.x
 * accepts cliweb's mouse tracking request but forwards pane-relative SGR
 * coordinates in character cells, so those coordinates must be expanded back
 * to the center of the corresponding terminal cell.
 */
export function mousePointInDevicePixels(
  point: MousePoint,
  space: MouseCoordinateSpace,
): MousePoint {
  if (space.unit === 'pixels') return point;

  const { columns, rows, deviceWidth, deviceHeight } = space;
  if (
    !validExtent(columns) ||
    !validExtent(rows) ||
    !validExtent(deviceWidth) ||
    !validExtent(deviceHeight)
  ) {
    return point;
  }

  return {
    x: cellCenterInPixels(point.x, columns, deviceWidth),
    y: cellCenterInPixels(point.y, rows, deviceHeight),
  };
}
