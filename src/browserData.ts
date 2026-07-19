import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  BookmarkToggleResult,
  BrowserDataItem,
  BrowserPanelData,
  BrowserPanelMode,
} from './browserDataTypes';

const DEFAULT_RESULT_LIMIT = 500;
export const MAX_HISTORY_ENTRIES = 10_000;
const MAX_TITLE_LENGTH = 1_024;
const MAX_URL_LENGTH = 32_768;

type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  created_at: number;
};

type HistoryRow = {
  id: number;
  url: string;
  title: string;
  visited_at: number;
};

function cleanTitle(title: string, fallback: string): string {
  const cleaned = title.replaceAll(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, MAX_TITLE_LENGTH);
}

/**
 * Return a storable browser URL. Credentials are always removed and privileged or
 * inline schemes are never written to bookmarks/history.
 */
export function normalizeStoredUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
  parsed.username = '';
  parsed.password = '';
  const normalized = parsed.href;
  return normalized.length <= MAX_URL_LENGTH ? normalized : undefined;
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_RESULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), 2_000));
}

function bookmarkItem(row: BookmarkRow): BrowserDataItem {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    timestamp: row.created_at,
  };
}

function historyItem(row: HistoryRow): BrowserDataItem {
  return {
    id: String(row.id),
    url: row.url,
    title: row.title,
    timestamp: row.visited_at,
  };
}

export class BrowserDataStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    const dataDirectory = path.dirname(databasePath);
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(dataDirectory, 0o700);
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        visited_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_visited_at_idx
        ON history (visited_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS history_url_idx
        ON history (url);
      PRAGMA user_version = 1;
    `);
    for (const sqlitePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (fs.existsSync(sqlitePath)) fs.chmodSync(sqlitePath, 0o600);
    }
  }

  close(): void {
    this.database.close();
  }

  isBookmarked(rawUrl: string): boolean {
    const url = normalizeStoredUrl(rawUrl);
    if (!url) return false;
    const row = this.database.prepare('SELECT 1 AS found FROM bookmarks WHERE url = ?').get(url);
    return row !== undefined;
  }

  toggleBookmark(rawUrl: string, rawTitle: string): BookmarkToggleResult {
    const url = normalizeStoredUrl(rawUrl);
    if (!url) throw new Error('Only HTTP and HTTPS pages can be bookmarked');

    const existing = this.database
      .prepare('SELECT id, url, title, created_at FROM bookmarks WHERE url = ?')
      .get(url) as BookmarkRow | undefined;
    if (existing) {
      this.database.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
      return { bookmarked: false };
    }

    const item: BrowserDataItem = {
      id: randomUUID(),
      url,
      title: cleanTitle(rawTitle, url),
      timestamp: Date.now(),
    };
    this.database
      .prepare('INSERT INTO bookmarks (id, url, title, created_at) VALUES (?, ?, ?, ?)')
      .run(item.id, item.url, item.title, item.timestamp);
    return { bookmarked: true, item };
  }

  removeBookmark(id: string): boolean {
    const result = this.database.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  recordVisit(
    rawUrl: string,
    rawTitle: string,
    visitedAt = Date.now(),
  ): BrowserDataItem | undefined {
    const url = normalizeStoredUrl(rawUrl);
    if (!url) return undefined;
    const title = cleanTitle(rawTitle, url);
    const result = this.database
      .prepare('INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)')
      .run(url, title, visitedAt);
    this.database
      .prepare(`
        DELETE FROM history
        WHERE id IN (
          SELECT id FROM history
          ORDER BY visited_at DESC, id DESC
          LIMIT -1 OFFSET ?
        )
      `)
      .run(MAX_HISTORY_ENTRIES);
    return { id: String(result.lastInsertRowid), url, title, timestamp: visitedAt };
  }

  updateLatestHistoryTitle(rawUrl: string, rawTitle: string): boolean {
    const url = normalizeStoredUrl(rawUrl);
    if (!url) return false;
    const title = cleanTitle(rawTitle, url);
    const result = this.database
      .prepare(`
        UPDATE history SET title = ?
        WHERE id = (
          SELECT id FROM history WHERE url = ?
          ORDER BY visited_at DESC, id DESC LIMIT 1
        )
      `)
      .run(title, url);
    return result.changes > 0;
  }

  clearHistory(): number {
    return Number(this.database.prepare('DELETE FROM history').run().changes);
  }

  queryPanel(mode: BrowserPanelMode, query = '', limit = DEFAULT_RESULT_LIMIT): BrowserPanelData {
    const pattern = `%${escapeLike(query.trim())}%`;
    const resultLimit = clampLimit(limit);
    if (mode === 'bookmarks') {
      const rows = this.database
        .prepare(`
          SELECT id, url, title, created_at FROM bookmarks
          WHERE title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(pattern, pattern, resultLimit) as BookmarkRow[];
      return { mode, items: rows.map(bookmarkItem) };
    }

    const rows = this.database
      .prepare(`
        SELECT id, url, title, visited_at FROM history
        WHERE title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'
        ORDER BY visited_at DESC, id DESC
        LIMIT ?
      `)
      .all(pattern, pattern, resultLimit) as HistoryRow[];
    return { mode, items: rows.map(historyItem) };
  }
}
