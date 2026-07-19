import { describe, expect, test } from 'bun:test';
import { controlRoot, createDescriptor, createInstancePaths } from './registry';

describe('control registry paths', () => {
  test('uses XDG_RUNTIME_DIR on Unix', () => {
    expect(
      controlRoot({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/42' }, uid: 42 }),
    ).toBe('/run/user/42/cliweb');
  });

  test('uses a named pipe on Windows', () => {
    const paths = createInstancePaths({
      platform: 'win32',
      env: {},
      tmpdir: 'C:\\Temp',
      username: 'alex',
      instanceId: 'abc123',
    });
    expect(paths.transport).toBe('pipe');
    expect(paths.endpoint).toContain('\\\\.\\pipe\\cliweb-');
    expect(paths.endpoint).toEndWith('-abc123');
  });

  test('shortens long Unix socket paths', () => {
    const paths = createInstancePaths({
      platform: 'linux',
      env: {},
      root: `/tmp/${'x'.repeat(120)}`,
      tmpdir: '/short',
      uid: 42,
      instanceId: 'abc123',
    });
    expect(paths.endpoint).toBe('/short/cw-42-abc123.sock');
  });

  test('records Kitty window metadata from the launched process environment', () => {
    const paths = createInstancePaths({
      platform: 'linux',
      root: '/tmp/cliweb-control',
      instanceId: 'kitty-test',
    });
    const descriptor = createDescriptor('test', paths, {
      KITTY_WINDOW_ID: '42',
      KITTY_LISTEN_ON: 'unix:/tmp/kitty-control',
    });
    expect(descriptor.kittyWindowId).toBe(42);
    expect(descriptor.kittyListenOn).toBe('unix:/tmp/kitty-control');
  });
});
