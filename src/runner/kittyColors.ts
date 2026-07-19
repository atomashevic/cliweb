import { ESC_CODE, OSC } from '../tty/escapeCodes';

function toKebabCase(str: string): string {
  return str
    .replace(/^(\d+)$/, 'c$1')
    .replace(/_color$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

const replacements: Record<string, string> = {
  foreground: 'kitty-fg',
  background: 'kitty-bg',
};

export type Color = [name: string, color: string];
type QueryResponse = Array<Color> | undefined;
const COLOR_RESPONSE_PREFIX = `${ESC_CODE}]21;`;

export const DEFAULT_TOOLBAR_COLORS: Color[] = [
  ['kitty-fg', '#d8dee9'],
  ['kitty-bg', '#1e222a'],
  ['active-border', '#5e81ac'],
  ['selection-background', '#4c566a'],
  ['selection-foreground', '#eceff4'],
];

function normalizeRgbColor(value: string): string | undefined {
  const match = /^rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})$/i.exec(value);
  if (!match) return undefined;
  const channels = match
    .slice(1)
    .map((channel) => (channel.length === 1 ? channel.repeat(2) : channel.slice(0, 2)));
  return `#${channels.join('')}`;
}

export function parseColorResponse(response: string): Color[] {
  const start = response.indexOf(COLOR_RESPONSE_PREFIX);
  if (start < 0) return [];
  const payloadStart = start + COLOR_RESPONSE_PREFIX.length;
  const stringTerminator = response.indexOf(`${ESC_CODE}\\`, payloadStart);
  const bellTerminator = response.indexOf('\x07', payloadStart);
  const endings = [stringTerminator, bellTerminator].filter((index) => index >= 0);
  const payloadEnd = endings.length > 0 ? Math.min(...endings) : response.length;

  return response
    .slice(payloadStart, payloadEnd)
    .split(';')
    .flatMap<Color>((entry) => {
      const separator = entry.indexOf('=');
      if (separator <= 0) return [];
      const name = entry.slice(0, separator);
      const color = normalizeRgbColor(entry.slice(separator + 1));
      if (!color) return [];
      return [[replacements[name] ?? toKebabCase(name), color]];
    });
}

export function queryColors(): Promise<QueryResponse> {
  const { promise, resolve } = Promise.withResolvers<QueryResponse>();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let color_query = '';
  for (let i = 0; i <= 255; i++) {
    color_query += `;${i}=?`;
  }

  process.stdout.write(
    OSC`21;foreground=?;background=?;active_border_color=?;selection_background=?;selection_foreground=?;cursor=?;cursor_text=?${color_query}`,
  );

  let buffer = '';
  let settled = false;
  const finish = (value: QueryResponse) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    process.stdin.off('data', handler);
    process.stdin.pause();
    process.stdin.setRawMode(false);
    resolve(value);
  };
  const handler = (chunk: string) => {
    buffer += chunk;
    const start = buffer.indexOf(COLOR_RESPONSE_PREFIX);
    if (start < 0) {
      buffer = buffer.slice(-COLOR_RESPONSE_PREFIX.length);
      return;
    }
    const response = buffer.slice(start);
    if (!response.includes(`${ESC_CODE}\\`) && !response.includes('\x07')) return;
    finish(parseColorResponse(response));
  };
  process.stdin.on('data', handler);

  const timeout = setTimeout(() => finish(undefined), 100);

  return promise;
}

export function colorsToTailwind(colors: Color[]) {
  return `@theme {
${colors.map(([name_, color]) => `  --color-${name_}: var(--cliweb-color-${name_}, ${color});`).join('\n')}
}`;
}
