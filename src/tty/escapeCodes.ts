type StringLike = string | { toString(): string };
export const ESC_CODE = '\x1B';

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

export function graphicsPassthrough(sequence: string, insideTmux = process.env.TMUX !== undefined) {
  return insideTmux ? wrapTmuxPassthrough(sequence) : sequence;
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
