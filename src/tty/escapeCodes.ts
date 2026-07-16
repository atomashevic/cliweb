import { execFileSync } from 'node:child_process';

type StringLike = string | { toString(): string };
export const ESC_CODE = '\x1B';

type Point = { x: number; y: number };
export type TmuxPaneOrigin = { left: number; top: number };

let graphicsCursor: Point = { x: 0, y: 0 };
let tmuxPaneOrigin: TmuxPaneOrigin | null | undefined;

export function setGraphicsCursor(point: Point) {
  graphicsCursor = point;
}

export function parseTmuxPaneOrigin(output: string): TmuxPaneOrigin | null {
  const [leftValue, topValue, statusValue, statusPosition] = output.trim().split('\t');
  const left = Number(leftValue);
  const paneTop = Number(topValue);
  if (!Number.isFinite(left) || !Number.isFinite(paneTop)) return null;

  const statusRows =
    statusValue === 'off' ? 0 : statusValue === 'on' ? 1 : Number(statusValue) || 1;
  const top = paneTop + (statusPosition === 'top' ? statusRows : 0);
  return { left, top };
}

function getTmuxPaneOrigin(): TmuxPaneOrigin | null {
  if (tmuxPaneOrigin !== undefined) return tmuxPaneOrigin;
  const pane = process.env.TMUX_PANE;
  if (!pane) {
    tmuxPaneOrigin = null;
    return tmuxPaneOrigin;
  }

  try {
    const output = execFileSync(
      'tmux',
      [
        'display-message',
        '-p',
        '-t',
        pane,
        '#{pane_left}\t#{pane_top}\t#{status}\t#{status-position}',
      ],
      { encoding: 'utf8', timeout: 1_000 },
    );
    tmuxPaneOrigin = parseTmuxPaneOrigin(output);
    return tmuxPaneOrigin;
  } catch {
    tmuxPaneOrigin = null;
    return tmuxPaneOrigin;
  }
}

export function invalidateTmuxPaneOrigin() {
  tmuxPaneOrigin = undefined;
}

/**
 * Wrap an escape sequence in tmux's DCS passthrough envelope.
 *
 * tmux requires every ESC byte in the inner sequence to be doubled. The outer
 * DCS sequence is intentionally not applied to normal terminal controls: tmux
 * must continue to handle cursor, keyboard, mouse, and screen state itself.
 */
export function wrapTmuxPassthrough(sequence: string) {
  const escapedSequence = sequence.replaceAll(ESC_CODE, ESC_CODE + ESC_CODE);
  return `${ESC_CODE}Ptmux;${escapedSequence}${ESC_CODE}\\`;
}

export function anchorTmuxGraphics(sequence: string, origin: TmuxPaneOrigin, cursor: Point) {
  const column = origin.left + Math.max(1, cursor.x);
  const row = origin.top + Math.max(1, cursor.y);
  return wrapTmuxPassthrough(`${ESC_CODE}7${ESC_CODE}[${row};${column}H${sequence}${ESC_CODE}8`);
}

export function graphicsPassthrough(sequence: string, insideTmux = process.env.TMUX !== undefined) {
  if (!insideTmux) return sequence;
  const origin = getTmuxPaneOrigin();
  return origin
    ? anchorTmuxGraphics(sequence, origin, graphicsCursor)
    : wrapTmuxPassthrough(sequence);
}

export function ESC(strings: TemplateStringsArray, ...args: StringLike[]) {
  let ret = ESC_CODE;
  for (let n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  return ret;
}

export function CSI(strings: TemplateStringsArray, ...args: StringLike[]) {
  let ret = `${ESC_CODE}[`;
  for (let n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  return ret;
}

export function GFX(strings: TemplateStringsArray, ...args: StringLike[]) {
  let ret = `${ESC_CODE}_G`;
  for (let n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  return graphicsPassthrough(ret + `${ESC_CODE}\\`);
}

export function ParseGFXStatus(str: string) {
  // Match on Gi=<id>;OK or Gi=<id>;ENOENT:<some detailed error msg>
  const match = str.match(/Gi=([^;]+);(OK|ENOENT:(.+))$/);
  if (!match) return null;

  return {
    id: match[1],
    ok: match[2] === 'OK',
    error: match[2].startsWith('ENOENT:') ? match[3] : null,
  };
}

export function OSC(strings: TemplateStringsArray, ...args: StringLike[]) {
  let ret = `${ESC_CODE}]`;
  for (let n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  ret += `${ESC_CODE}\\`;
  return ret;
}

export const MODE = '?'; // DEC private mode
export const S7C1T = ESC` F`;
export const SAVE_CURSOR = ESC`7`;
export const RESTORE_CURSOR = ESC`8`;
export const SAVE_PRIVATE_MODE_VALUES = CSI`?s`;
export const RESTORE_PRIVATE_MODE_VALUES = CSI`?r`;
export const SAVE_COLORS = CSI`#P`;
export const RESTORE_COLORS = CSI`#Q`;
export const DECSACE_DEFAULT_REGION_SELECT = CSI`*x`;
export const CLEAR_SCREEN = CSI`H` + CSI`2J`;
export const RESET_IRM = CSI`4l`;
