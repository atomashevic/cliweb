import { describe, expect, test } from 'bun:test';
import { ESC_CODE } from '../tty/escapeCodes';
import { parseColorResponse } from './kittyColors';

describe('Kitty color responses', () => {
  test('ignores malformed fields and normalizes 8-bit and 16-bit RGB values', () => {
    const response = `${ESC_CODE}]21;foreground=rgb:d8/d8/d8;malformed;255=rgb:eeee/eeee/eeee${ESC_CODE}\\`;
    expect(parseColorResponse(response)).toEqual([
      ['kitty-fg', '#d8d8d8'],
      ['c255', '#eeeeee'],
    ]);
  });

  test('ignores unrelated terminal input', () => {
    expect(parseColorResponse('keyboard input')).toEqual([]);
  });
});
