import { execFileSync } from 'node:child_process';
import { callControl, liveDescriptors } from './client';
import {
  ControlError,
  normalizeNavigationUrl,
  publicDescriptor,
  type InstanceDescriptor,
} from './protocol';
import { processExists, readDescriptors } from './registry';

export type TmuxPane = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  command: string;
  path: string;
};

const IDLE_SHELLS = new Set(['bash', 'dash', 'fish', 'nu', 'sh', 'tcsh', 'zsh']);
const CODEX_COMMANDS = new Set(['codex', 'node']);
const PANE_FORMAT =
  '#{pane_id}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{pane_current_command}\t#{pane_current_path}';

function tmux(args: string[], timeout = 5_000): string {
  try {
    return execFileSync('tmux', args, { encoding: 'utf8', timeout }).trim();
  } catch (error) {
    throw new ControlError(
      'NO_TARGET',
      `tmux command failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function tmuxPaneExists(paneId: string): boolean {
  try {
    return tmux(['display-message', '-p', '-t', paneId, '#{pane_id}']) === paneId;
  } catch {
    return false;
  }
}

async function waitForPaneExit(paneId: string, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!tmuxPaneExists(paneId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !tmuxPaneExists(paneId);
}

export function parsePaneList(output: string): TmuxPane[] {
  if (!output.trim()) return [];
  return output.split('\n').map((line) => {
    const [id, left, top, width, height, command, panePath] = line.split('\t');
    return {
      id,
      left: Number(left),
      top: Number(top),
      width: Number(width),
      height: Number(height),
      command,
      path: panePath,
    };
  });
}

export function rankedRightPanes(current: TmuxPane, panes: TmuxPane[]): TmuxPane[] {
  const currentRight = current.left + current.width;
  return panes
    .filter((pane) => {
      if (pane.id === current.id || pane.left < currentRight) return false;
      const overlap =
        Math.min(current.top + current.height, pane.top + pane.height) -
        Math.max(current.top, pane.top);
      return overlap > 0;
    })
    .sort((a, b) => {
      const gapA = a.left - currentRight;
      const gapB = b.left - currentRight;
      if (gapA !== gapB) return gapA - gapB;
      const overlapA =
        Math.min(current.top + current.height, a.top + a.height) - Math.max(current.top, a.top);
      const overlapB =
        Math.min(current.top + current.height, b.top + b.height) - Math.max(current.top, b.top);
      return overlapB - overlapA;
    });
}

export function rightPaneDescriptor(
  rightPanes: TmuxPane[],
  descriptors: InstanceDescriptor[],
): InstanceDescriptor | undefined {
  for (const pane of rightPanes) {
    const descriptor = descriptors.find(
      (candidate) => candidate.tmuxPane === pane.id && processExists(candidate.pid),
    );
    if (descriptor) return descriptor;
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function controlledCliwebArgs(url?: string): string[] {
  return ['cliweb', '--control', ...(url ? [normalizeNavigationUrl(url)] : [])];
}

export function controlledSplitArgs(current: TmuxPane, url?: string): string[] {
  return [
    'split-window',
    '-h',
    '-t',
    current.id,
    '-c',
    current.path,
    '-P',
    '-F',
    '#{pane_id}',
    ...controlledCliwebArgs(url),
  ];
}

function listPanes(currentPane: string): TmuxPane[] {
  const output = tmux(['list-panes', '-t', currentPane, '-F', PANE_FORMAT]);
  return parsePaneList(output);
}

function discoverCurrentPane(): string {
  const explicit = process.env.CLIWEB_TMUX_PANE ?? process.env.TMUX_PANE;
  if (explicit) return explicit;

  const activePane = tmux(['display-message', '-p', '#{pane_id}']);
  const candidates = parsePaneList(tmux(['list-panes', '-a', '-F', PANE_FORMAT])).filter(
    (pane) => pane.path === process.cwd() && CODEX_COMMANDS.has(pane.command),
  );
  if (candidates.some((pane) => pane.id === activePane)) return activePane;
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length > 1) {
    throw new ControlError(
      'AMBIGUOUS_TARGET',
      'Multiple Codex-like tmux panes match this working directory; set CLIWEB_TMUX_PANE',
      candidates.map((pane) => pane.id),
    );
  }
  return activePane;
}

export function isCliwebPaneCommand(command: string): boolean {
  return command === 'cliweb';
}

export function isDescriptorVisible(
  descriptor: InstanceDescriptor,
  sessionName: string,
  windowId: string,
): boolean {
  return descriptor.tmuxSession === sessionName && descriptor.tmuxWindow === windowId;
}

export async function syncTmuxWindowVisibility(sessionName: string, windowId: string) {
  const descriptors = await liveDescriptors();
  const ordered = [...descriptors].sort(
    (a, b) =>
      Number(isDescriptorVisible(a, sessionName, windowId)) -
      Number(isDescriptorVisible(b, sessionName, windowId)),
  );
  const results = [];
  for (const descriptor of ordered) {
    const visible = isDescriptorVisible(descriptor, sessionName, windowId);
    try {
      await callControl(descriptor, 'visibility', { visible }, 3_000);
      results.push({ instanceId: descriptor.instanceId, visible, ok: true });
    } catch (error) {
      results.push({
        instanceId: descriptor.instanceId,
        visible,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { session: sessionName, window: windowId, instances: results };
}

export async function clearTmuxTerminalImages() {
  const currentPaneId = discoverCurrentPane();
  tmux(['split-window', '-h', '-t', currentPaneId, 'cliwebctl tmux emit-clear-images']);
  return { cleared: true };
}

export async function gracefullyCloseTmuxPane(paneId: string) {
  if (!paneId.startsWith('%')) {
    throw new ControlError('INVALID_REQUEST', `Invalid tmux pane id: ${paneId}`);
  }
  if (!tmuxPaneExists(paneId)) {
    return { pane: paneId, controlled: false, graceful: true, closed: true };
  }

  const descriptors = await liveDescriptors();
  const descriptor = descriptors.find((candidate) => candidate.tmuxPane === paneId);
  const paneCommand = tmux(['display-message', '-p', '-t', paneId, '#{pane_current_command}']);
  let attemptedGracefulClose = false;

  if (descriptor) {
    attemptedGracefulClose = true;
    try {
      process.kill(descriptor.pid, 'SIGTERM');
    } catch {}
  } else if (isCliwebPaneCommand(paneCommand)) {
    attemptedGracefulClose = true;
    tmux(['send-keys', '-t', paneId, 'C-c']);
  }

  const graceful = attemptedGracefulClose && (await waitForPaneExit(paneId));
  if (tmuxPaneExists(paneId)) {
    tmux(['kill-pane', '-t', paneId]);
  }

  return { pane: paneId, controlled: descriptor !== undefined, graceful, closed: true };
}

async function waitForPaneInstance(paneId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptors = await liveDescriptors();
    const descriptor = descriptors.find((candidate) => candidate.tmuxPane === paneId);
    if (descriptor) return descriptor;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ControlError('TIMEOUT', `cliweb did not expose control in pane ${paneId}`);
}

async function useExistingPaneInstance(
  descriptor: InstanceDescriptor,
  url?: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (url) {
        await callControl(descriptor, 'navigate', { url: normalizeNavigationUrl(url) });
      } else {
        await callControl(descriptor, 'status');
      }
      return publicDescriptor(descriptor);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new ControlError(
    'TIMEOUT',
    `Existing cliweb in right pane ${descriptor.tmuxPane ?? 'unknown'} did not accept control`,
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

function launchInPane(paneId: string, url?: string): void {
  const command = controlledCliwebArgs(url).map(shellQuote).join(' ');
  tmux(['send-keys', '-t', paneId, '-l', '--', command]);
  tmux(['send-keys', '-t', paneId, 'Enter']);
}

export async function ensureTmuxCliweb(url?: string) {
  const currentPaneId = discoverCurrentPane();
  if (!currentPaneId)
    throw new ControlError('NO_TARGET', 'Could not determine the current tmux pane');

  // Commands can be issued from a Codex pane whose tmux window is not the
  // attached client's currently displayed window. cliweb's graphics handshake
  // requires the destination pane to be visible, so bring Codex's own window
  // forward before discovering or creating its right-hand sidecar.
  tmux(['select-window', '-t', currentPaneId]);
  tmux(['select-pane', '-t', currentPaneId]);

  const panes = listPanes(currentPaneId);
  const current = panes.find((pane) => pane.id === currentPaneId);
  if (!current) throw new ControlError('NO_TARGET', `Could not find current pane ${currentPaneId}`);
  const rightPanes = rankedRightPanes(current, panes);
  const descriptors = await liveDescriptors();

  const liveRightDescriptor = rightPaneDescriptor(rightPanes, descriptors);
  if (liveRightDescriptor) {
    return await useExistingPaneInstance(liveRightDescriptor, url);
  }

  // A control socket can be briefly unavailable while the existing browser is
  // navigating or repainting. The descriptor still identifies the intended
  // sidecar pane, so retry that pane instead of creating a second right split.
  const registeredRightDescriptor = rightPaneDescriptor(rightPanes, readDescriptors());
  if (registeredRightDescriptor) {
    return await useExistingPaneInstance(registeredRightDescriptor, url);
  }

  const idlePane = rightPanes.find((pane) => IDLE_SHELLS.has(pane.command));
  let targetPaneId: string;
  let createdPane = false;
  if (idlePane) {
    targetPaneId = idlePane.id;
    // cliweb's terminal capability handshake needs the target pane to be visible.
    tmux(['select-pane', '-t', targetPaneId]);
    launchInPane(targetPaneId, url);
  } else {
    // Do not use split-window -d here. An inactive pane cannot complete cliweb's
    // Kitty graphics handshake, so it exits before exposing the control socket.
    targetPaneId = tmux(controlledSplitArgs(current, url));
    createdPane = true;
  }

  try {
    const descriptor = await waitForPaneInstance(targetPaneId);
    return publicDescriptor(descriptor);
  } catch (error) {
    if (createdPane) {
      try {
        tmux(['kill-pane', '-t', targetPaneId]);
      } catch {}
    }
    throw error;
  } finally {
    // Hand control back to Codex after cliweb has completed terminal setup.
    try {
      tmux(['select-pane', '-t', currentPaneId]);
    } catch {}
  }
}
