import fs from 'node:fs';
import { callControl, liveDescriptors, resolveDescriptor } from './client';
import {
  ControlError,
  normalizeNavigationUrl,
  publicDescriptor,
  type ControlMethod,
} from './protocol';
import { GFX } from '../tty/escapeCodes';
import {
  clearTmuxTerminalImages,
  ensureTmuxCliweb,
  gracefullyCloseTmuxPane,
  syncTmuxWindowVisibility,
} from './tmux';
import { ensureKittyCliweb, gracefullyCloseKittyWindow } from './kitty';

type ParsedArgs = {
  positionals: string[];
  options: Map<string, string | true>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals > 2) {
      options.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options.set(key, next);
      index++;
    } else {
      options.set(key, true);
    }
  }
  return { positionals, options };
}

function optionString(parsed: ParsedArgs, key: string, required = false): string | undefined {
  const value = parsed.options.get(key);
  if (typeof value === 'string') return value;
  if (required) throw new ControlError('INVALID_REQUEST', `Missing --${key}`);
  return undefined;
}

function optionNumber(parsed: ParsedArgs, key: string, fallback: number): number {
  const value = optionString(parsed, key);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new ControlError('INVALID_REQUEST', `Invalid --${key}: ${value}`);
  return number;
}

function optionInteger(parsed: ParsedArgs, key: string, required = false): number | undefined {
  const value = optionString(parsed, key, required);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new ControlError('INVALID_REQUEST', `Invalid --${key}: ${value}`);
  }
  return number;
}

function elementParams(parsed: ParsedArgs) {
  const ref = optionString(parsed, 'ref');
  const selector = optionString(parsed, 'selector');
  if ((ref === undefined) === (selector === undefined)) {
    throw new ControlError('INVALID_REQUEST', 'Provide exactly one of --ref or --selector');
  }
  return ref ? { ref } : { selector };
}

function print(value: unknown, pretty: boolean, stream: NodeJS.WriteStream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  cliwebctl instances [--pretty]
  cliwebctl tmux ensure [url] [--pretty]
  cliwebctl tmux close --pane %N [--pretty]
  cliwebctl tmux clear-images [--pretty]
  cliwebctl tmux sync --session name --window @N [--pretty]
  cliwebctl kitty ensure [url] [--pretty]
  cliwebctl kitty close --window id [--pretty]
  cliwebctl [--instance id | --pane %N | --kitty-window id] status|snapshot|wait|back|forward|reload
  cliwebctl [target] bookmark-toggle
  cliwebctl [target] bookmarks|history [--query text] [--limit count]
  cliwebctl [target] clear-history|clear-site-data
  cliwebctl [target] show-bookmarks|show-history|close-panel
  cliwebctl [target] screenshot [--toolbar] --output file.png
  cliwebctl [target] navigate url
  cliwebctl [target] click (--ref ref | --selector css)
  cliwebctl [target] fill (--ref ref | --selector css) --text text
  cliwebctl [target] press [--ref ref | --selector css] --key key
  cliwebctl [target] scroll [--dx pixels] [--dy pixels]
`);
}

async function run(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const parsed = parseArgs(argv);
  const pretty = parsed.options.has('pretty');
  const [command, subcommand, ...rest] = parsed.positionals;

  if (!command || command === 'help') {
    usage();
    return;
  }
  if (command === 'instances') {
    print((await liveDescriptors()).map(publicDescriptor), pretty);
    return;
  }
  if (command === 'tmux' && subcommand === 'ensure') {
    print(await ensureTmuxCliweb(rest[0]), pretty);
    return;
  }
  if (command === 'tmux' && subcommand === 'close') {
    print(await gracefullyCloseTmuxPane(optionString(parsed, 'pane', true) as string), pretty);
    return;
  }
  if (command === 'tmux' && subcommand === 'clear-images') {
    print(await clearTmuxTerminalImages(), pretty);
    return;
  }
  if (command === 'tmux' && subcommand === 'sync') {
    print(
      await syncTmuxWindowVisibility(
        optionString(parsed, 'session', true) as string,
        optionString(parsed, 'window', true) as string,
      ),
      pretty,
    );
    return;
  }
  if (command === 'tmux' && subcommand === 'emit-clear-images') {
    process.stdout.write(GFX`a=d,d=A`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return;
  }
  if (command === 'kitty' && subcommand === 'ensure') {
    print(await ensureKittyCliweb(rest[0]), pretty);
    return;
  }
  if (command === 'kitty' && subcommand === 'close') {
    print(
      await gracefullyCloseKittyWindow(optionInteger(parsed, 'window', true) as number),
      pretty,
    );
    return;
  }

  const descriptor = await resolveDescriptor({
    instanceId: optionString(parsed, 'instance'),
    tmuxPane: optionString(parsed, 'pane'),
    kittyWindowId: optionInteger(parsed, 'kitty-window'),
  });
  const method = command as ControlMethod;
  let params: Record<string, unknown> = {};

  switch (command) {
    case 'status':
    case 'back':
    case 'forward':
    case 'reload':
    case 'bookmark-toggle':
    case 'clear-history':
    case 'clear-site-data':
    case 'show-bookmarks':
    case 'show-history':
    case 'close-panel':
      break;
    case 'bookmarks':
    case 'history':
      params = {
        query: optionString(parsed, 'query') ?? '',
        limit: optionNumber(parsed, 'limit', 500),
      };
      break;
    case 'snapshot':
      params = { maxNodes: optionNumber(parsed, 'max-nodes', 2_000) };
      break;
    case 'wait':
      params = { timeoutMs: optionNumber(parsed, 'timeout', 30_000) };
      break;
    case 'navigate': {
      const url = subcommand;
      if (!url) throw new ControlError('INVALID_REQUEST', 'navigate requires a URL');
      params = { url: normalizeNavigationUrl(url) };
      break;
    }
    case 'click':
      params = elementParams(parsed);
      break;
    case 'fill':
      params = { ...elementParams(parsed), text: optionString(parsed, 'text', true) ?? '' };
      break;
    case 'press': {
      const target =
        parsed.options.has('ref') || parsed.options.has('selector') ? elementParams(parsed) : {};
      params = { ...target, key: optionString(parsed, 'key', true) };
      break;
    }
    case 'scroll':
      params = {
        deltaX: optionNumber(parsed, 'dx', 0),
        deltaY: optionNumber(parsed, 'dy', 0),
      };
      break;
    case 'screenshot': {
      const result = (await callControl(descriptor, 'screenshot', {
        surface: parsed.options.has('toolbar') ? 'toolbar' : 'content',
      })) as {
        surface: 'content' | 'toolbar';
        dataBase64: string;
        mimeType: string;
        width: number;
        height: number;
      };
      const output = optionString(parsed, 'output', true) as string;
      fs.writeFileSync(output, Buffer.from(result.dataBase64, 'base64'));
      print(
        {
          output,
          surface: result.surface,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
        },
        pretty,
      );
      return;
    }
    default:
      throw new ControlError('INVALID_REQUEST', `Unknown command: ${command}`);
  }

  print(await callControl(descriptor, method, params), pretty);
}

if (import.meta.main) {
  run(process.argv.slice(2)).catch((error) => {
    const normalized =
      error instanceof ControlError
        ? error
        : new ControlError('INTERNAL', error instanceof Error ? error.message : String(error));
    print(
      {
        ok: false,
        error: { code: normalized.code, message: normalized.message, details: normalized.details },
      },
      false,
      process.stderr,
    );
    process.exitCode = 1;
  });
}

export { parseArgs, run };
