import { normalizeNavigationUrl } from './control/protocol';

export const rawArgs = process.argv.slice(2);

export const possibleOptions = {
  url: { short: 'u', description: 'Set the initial URL', string: true, arg: true },

  help: { short: 'h', description: 'Show help' },
  version: { short: 'v', description: 'Show version' },
  control: { short: 'c', description: 'Enable authenticated local browser control' },
  private: { short: 'I', description: 'Use a temporary private browsing session' },
  'no-paint': { short: 'n', description: 'Disable painting' },
  transparent: { short: 't', description: 'Make the window transparent' },
  'debug-paint': { short: 'p', description: 'Debug paint' },
} as const;

export type Option = keyof typeof possibleOptions;
type ShortOption = (typeof possibleOptions)[Option]['short'];

const shortOptions = Object.fromEntries(
  Object.entries(possibleOptions).map(([key, value]) => [value.short, key]),
) as {
  [K in ShortOption]: Option;
};

export type Options = {
  [K in Option]?: (typeof possibleOptions)[K] extends { string: true } ? string : boolean;
};

export function parseArgs(args: string[]): Options {
  const parsed: Options = {};

  for (const arg of args) {
    if (arg.startsWith('-')) {
      const [rawKey, value] = arg.slice(arg.startsWith('--') ? 2 : 1).split('=');

      if (!(rawKey in possibleOptions) && !(rawKey in shortOptions)) {
        continue;
      }

      const key = shortOptions[rawKey as ShortOption] ?? rawKey;
      parsed[key] = 'string' in possibleOptions[key] ? (value as any) : true;
    } else {
      parsed.url = arg;
    }
  }

  if (typeof parsed.url === 'string') parsed.url = normalizeNavigationUrl(parsed.url);
  return parsed;
}

export const options = parseArgs(rawArgs);
