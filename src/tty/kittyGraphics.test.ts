import { describe, expect, spyOn, test } from 'bun:test';
import type { ShmGraphicBuffer } from 'cliweb-native-rs';
import { ESC_CODE } from './escapeCodes';
import { paintInitialFrame } from './kittyGraphics';

describe('Kitty image placement', () => {
  test('anchors the initial frame at the terminal origin', () => {
    const chunks: string[] = [];
    const tmux = process.env.TMUX;
    delete process.env.TMUX;
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });

    try {
      const frame = paintInitialFrame({ nameBase64: 'test-buffer' } as ShmGraphicBuffer, {
        width: 10,
        height: 10,
      });
      expect(chunks[0]).toBe(`${ESC_CODE}[0;0H`);
      frame.free();
    } finally {
      write.mockRestore();
      if (tmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = tmux;
    }
  });
});
