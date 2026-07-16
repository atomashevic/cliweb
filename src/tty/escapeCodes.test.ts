import { describe, expect, test } from 'bun:test';
import { ESC_CODE, graphicsPassthrough, wrapTmuxPassthrough } from './escapeCodes';

describe('tmux graphics passthrough', () => {
  const graphicsSequence = `${ESC_CODE}_Ga=q,i=7;AAAA${ESC_CODE}\\`;

  test('leaves graphics sequences unchanged outside tmux', () => {
    expect(graphicsPassthrough(graphicsSequence, false)).toBe(graphicsSequence);
  });

  test('wraps graphics sequences and doubles inner escape bytes inside tmux', () => {
    expect(graphicsPassthrough(graphicsSequence, true)).toBe(
      `${ESC_CODE}Ptmux;${ESC_CODE}${ESC_CODE}_Ga=q,i=7;AAAA${ESC_CODE}${ESC_CODE}\\${ESC_CODE}\\`,
    );
  });

  test('wraps arbitrary terminal escape sequences consistently', () => {
    const sequence = `${ESC_CODE}]11;?${ESC_CODE}\\`;
    expect(wrapTmuxPassthrough(sequence)).toBe(
      `${ESC_CODE}Ptmux;${ESC_CODE}${ESC_CODE}]11;?${ESC_CODE}${ESC_CODE}\\${ESC_CODE}\\`,
    );
  });
});
