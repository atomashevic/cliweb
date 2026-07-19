import { describe, expect, test } from 'bun:test';
import type { InstanceDescriptor } from './protocol';
import {
  controlledSplitArgs,
  isCliwebPaneCommand,
  isDescriptorVisible,
  parsePaneList,
  rankedRightPanes,
  rightPaneDescriptor,
} from './tmux';

describe('tmux pane discovery', () => {
  const panes = parsePaneList(
    [
      '%0\t0\t0\t90\t40\tnode\t/home/aleksandar',
      '%1\t91\t0\t60\t40\tbash\t/home/aleksandar',
      '%2\t152\t0\t40\t20\tcliweb\t/home/aleksandar',
      '%3\t152\t21\t40\t19\tzsh\t/home/aleksandar',
    ].join('\n'),
  );

  test('parses pane geometry', () => {
    expect(panes[1]).toEqual({
      id: '%1',
      left: 91,
      top: 0,
      width: 60,
      height: 40,
      command: 'bash',
      path: '/home/aleksandar',
    });
  });

  test('ranks the closest overlapping right pane first', () => {
    expect(rankedRightPanes(panes[0], panes).map((pane) => pane.id)).toEqual(['%1', '%2', '%3']);
  });

  test('reuses the closest registered cliweb to the right', () => {
    const descriptors = [
      { tmuxPane: '%3', pid: process.pid },
      { tmuxPane: '%2', pid: process.pid },
    ] as InstanceDescriptor[];

    expect(rightPaneDescriptor(rankedRightPanes(panes[0], panes), descriptors)?.tmuxPane).toBe(
      '%2',
    );
  });

  test('starts a new controlled pane in the foreground for terminal capability detection', () => {
    const args = controlledSplitArgs(panes[0], 'https://example.com/a?x=1&y=2');

    expect(args).toEqual([
      'split-window',
      '-h',
      '-t',
      '%0',
      '-c',
      '/home/aleksandar',
      '-P',
      '-F',
      '#{pane_id}',
      'cliweb',
      '--control',
      'https://example.com/a?x=1&y=2',
    ]);
    expect(args).not.toContain('-d');
  });

  test('recognizes cliweb panes for graceful fallback shutdown', () => {
    expect(isCliwebPaneCommand('cliweb')).toBe(true);
    expect(isCliwebPaneCommand('node')).toBe(false);
    expect(isCliwebPaneCommand('bash')).toBe(false);
  });

  test('matches descriptors to the selected tmux window', () => {
    const descriptor = {
      tmuxSession: 'Work',
      tmuxWindow: '@3',
    } as InstanceDescriptor;
    expect(isDescriptorVisible(descriptor, 'Work', '@3')).toBe(true);
    expect(isDescriptorVisible(descriptor, 'Work', '@4')).toBe(false);
    expect(isDescriptorVisible(descriptor, 'Other', '@3')).toBe(false);
  });
});
