import { describe, expect, test } from 'bun:test';
import { findKittyContext, kittyLaunchArgs, parseKittyTree } from './kitty';

const tree = parseKittyTree(
  JSON.stringify([
    {
      id: 1,
      tabs: [
        {
          id: 11,
          title: 'Work',
          layout: 'splits',
          windows: [
            { id: 101, title: 'Codex', cwd: '/work/cliweb', is_self: true },
            { id: 102, title: 'Shell', cwd: '/work/cliweb' },
          ],
        },
      ],
    },
  ]),
);

describe('Kitty adapter', () => {
  test('finds the current window and containing tab', () => {
    const context = findKittyContext(tree, 101);
    expect(context?.osWindow.id).toBe(1);
    expect(context?.tab.id).toBe(11);
    expect(context?.window.id).toBe(101);
    expect(findKittyContext(tree)?.window.id).toBe(101);
  });

  test('builds a focused 50/50 vertical split launch', () => {
    const context = findKittyContext(tree, 101);
    if (!context) throw new Error('fixture window was not found');
    expect(kittyLaunchArgs(context, '/home/user/.local/bin/cliweb', 'example.com')).toEqual([
      'launch',
      '--match',
      'id:11',
      '--type=window',
      '--location=vsplit',
      '--next-to',
      'id:101',
      '--bias=50',
      '--keep-focus',
      '--cwd=current',
      '--copy-colors',
      '--title=cliweb-control',
      '--var',
      'cliweb_control=yes',
      '/home/user/.local/bin/cliweb',
      '--control',
      'https://example.com/',
    ]);
  });

  test('rejects malformed Kitty listings', () => {
    expect(() => parseKittyTree('{')).toThrow('invalid JSON');
    expect(() => parseKittyTree('{}')).toThrow('did not return a list');
  });
});
