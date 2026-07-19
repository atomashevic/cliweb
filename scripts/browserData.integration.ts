import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserDataStore, normalizeStoredUrl } from '../src/browserData';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliweb-browser-data-'));
const databasePath = path.join(root, 'browser-data.sqlite3');
const store = new BrowserDataStore(databasePath);

try {
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600);
  }
  assert.equal(
    normalizeStoredUrl('https://user:secret@example.com/path'),
    'https://example.com/path',
  );
  assert.equal(normalizeStoredUrl('data:text/plain,secret'), undefined);

  const added = store.toggleBookmark('https://example.com/docs', '  Example   Docs  ');
  assert.equal(added.bookmarked, true);
  assert.equal(store.isBookmarked('https://example.com/docs'), true);
  assert.equal(store.queryPanel('bookmarks').items[0]?.title, 'Example Docs');
  assert.equal(store.queryPanel('bookmarks', '%').items.length, 0);

  const removed = store.toggleBookmark('https://example.com/docs', 'Example Docs');
  assert.equal(removed.bookmarked, false);
  assert.equal(store.isBookmarked('https://example.com/docs'), false);

  store.recordVisit('https://example.com/one', 'Loading', 100);
  store.updateLatestHistoryTitle('https://example.com/one', 'Page One');
  store.recordVisit('https://example.com/two', 'Page Two', 200);
  const history = store.queryPanel('history').items;
  assert.deepEqual(
    history.map((item) => item.title),
    ['Page Two', 'Page One'],
  );
  assert.equal(store.clearHistory(), 2);
  assert.equal(store.queryPanel('history').items.length, 0);
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write('browser data integration test passed\n');
