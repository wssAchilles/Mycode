/**
 * FTS5 search — full-text search using SQLite FTS5 virtual tables.
 *
 * Single responsibility: FTS5 index management and search queries.
 * No persistence writes, no sync logic, no message processing.
 */

import type { Message } from '../../../types/chat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Fts5SearchResult {
  id: string;
  chatId: string;
  rank: number;
}

export interface Fts5SearchOptions {
  limit: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// FTS5 SQL statements
// ---------------------------------------------------------------------------

export const FTS5_CREATE_TABLE = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    chat_id,
    tokenize='unicode61'
  );
`;

export const FTS5_CREATE_TRIGGERS = `
  -- Trigger: insert message into FTS5
  CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, chat_id)
    VALUES (NEW.rowid, NEW.content, NEW.chat_id);
  END;

  -- Trigger: update message in FTS5
  CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, chat_id)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.chat_id);
    INSERT INTO messages_fts(rowid, content, chat_id)
    VALUES (NEW.rowid, NEW.content, NEW.chat_id);
  END;

  -- Trigger: delete message from FTS5
  CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, chat_id)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.chat_id);
  END;
`;

// ---------------------------------------------------------------------------
// FTS5 search queries
// ---------------------------------------------------------------------------

export function buildFts5SearchQuery(chatId: string, query: string, options: Fts5SearchOptions): string {
  const limit = Math.max(1, Math.min(200, options.limit));
  const offset = options.offset ?? 0;

  // Escape FTS5 special characters
  const sanitizedQuery = query
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitizedQuery) {
    return '';
  }

  // Use MATCH with column filter for chatId
  return `
    SELECT
      m.id,
      m.chat_id,
      fts.rank
    FROM messages_fts fts
    JOIN messages m ON m.rowid = fts.rowid
    WHERE messages_fts MATCH '${sanitizedQuery}'
      AND m.chat_id = '${chatId}'
    ORDER BY fts.rank
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export function buildFts5CountQuery(chatId: string, query: string): string {
  const sanitizedQuery = query
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitizedQuery) {
    return 'SELECT 0';
  }

  return `
    SELECT COUNT(*)
    FROM messages_fts fts
    JOIN messages m ON m.rowid = fts.rowid
    WHERE messages_fts MATCH '${sanitizedQuery}'
      AND m.chat_id = '${chatId}'
  `;
}

// ---------------------------------------------------------------------------
// FTS5 initialization
// ---------------------------------------------------------------------------

export function getFts5InitStatements(): string[] {
  return [
    FTS5_CREATE_TABLE,
    FTS5_CREATE_TRIGGERS,
  ];
}

// ---------------------------------------------------------------------------
// FTS5 rebuild (for existing databases)
// ---------------------------------------------------------------------------

export function getFts5RebuildStatement(): string {
  return `
    INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
  `;
}

// ---------------------------------------------------------------------------
// FTS5 search helper
// ---------------------------------------------------------------------------

export function parseFts5SearchResults(rows: Array<{ id: string; chat_id: string; rank: number }>): Fts5SearchResult[] {
  return rows.map(row => ({
    id: row.id,
    chatId: row.chat_id,
    rank: row.rank,
  }));
}
