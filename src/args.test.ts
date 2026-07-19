import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './args';

describe('command-line argument parsing', () => {
  test('opens an existing PDF positional argument as a local file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-pdf-args-'));
    try {
      const pdfPath = path.join(root, 'local paper.pdf');
      fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF\n');

      expect(parseArgs(['--control', pdfPath])).toEqual({
        control: true,
        url: pathToFileURL(pdfPath).href,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps ordinary host navigation behavior', () => {
    expect(parseArgs(['example.com'])).toEqual({ url: 'https://example.com/' });
  });
});
