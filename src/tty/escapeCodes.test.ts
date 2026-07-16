import { describe, expect, test } from 'bun:test';
import {
  anchorTmuxGraphics,
  ESC_CODE,
  graphicsPassthrough,
  parseTmuxPaneOrigin,
  wrapTmuxPassthrough,
} from './escapeCodes';

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

  test('accounts for a top tmux status line in the physical pane origin', () => {
    expect(parseTmuxPaneOrigin('95\t0\ton\ttop\n')).toEqual({ left: 95, top: 1 });
    expect(parseTmuxPaneOrigin('0\t4\toff\tbottom\n')).toEqual({ left: 0, top: 4 });
  });

  test('anchors background-pane graphics while preserving the physical cursor', () => {
    expect(anchorTmuxGraphics(graphicsSequence, { left: 95, top: 1 }, { x: 0, y: 2 })).toBe(
      `${ESC_CODE}Ptmux;${ESC_CODE}${ESC_CODE}7${ESC_CODE}${ESC_CODE}[3;96H` +
        `${ESC_CODE}${ESC_CODE}_Ga=q,i=7;AAAA${ESC_CODE}${ESC_CODE}\\` +
        `${ESC_CODE}${ESC_CODE}8${ESC_CODE}\\`,
    );
  });
});
