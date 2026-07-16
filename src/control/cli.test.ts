import { describe, expect, spyOn, test } from 'bun:test';
import { parseArgs, run } from './cli';

describe('cliwebctl argument parsing', () => {
  test('allows target options before a command', () => {
    const parsed = parseArgs(['--instance', 'abc123', 'click', '--ref', 'd1-n2', '--pretty']);
    expect(parsed.positionals).toEqual(['click']);
    expect(parsed.options.get('instance')).toBe('abc123');
    expect(parsed.options.get('ref')).toBe('d1-n2');
    expect(parsed.options.get('pretty')).toBe(true);
  });

  test('preserves empty option values', () => {
    const parsed = parseArgs(['fill', '--selector=#name', '--text', '']);
    expect(parsed.options.get('selector')).toBe('#name');
    expect(parsed.options.get('text')).toBe('');
  });

  test('prints help without starting a tmux browser', async () => {
    const chunks: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });

    try {
      await run(['tmux', 'ensure', '--help']);
    } finally {
      write.mockRestore();
    }

    expect(chunks.join('')).toContain('cliwebctl tmux ensure [url]');
  });

  test('documents bookmark, history, and clearing commands', async () => {
    const chunks: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });

    try {
      await run(['--help']);
    } finally {
      write.mockRestore();
    }

    const help = chunks.join('');
    expect(help).toContain('bookmark-toggle');
    expect(help).toContain('bookmarks|history');
    expect(help).toContain('clear-history|clear-site-data');
    expect(help).toContain('show-bookmarks|show-history|close-panel');
  });

  test('documents the native Kitty adapter', async () => {
    const chunks: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });

    try {
      await run(['--help']);
    } finally {
      write.mockRestore();
    }

    const output = chunks.join('');
    expect(output).toContain('cliwebctl kitty ensure [url]');
    expect(output).toContain('cliwebctl kitty close --window id');
    expect(output).toContain('--kitty-window id');
  });
});
