/**
 * Opens the tracker database and applies pending migrations from ../../drizzle.
 * The CLI and the dashboard both go through this; nothing else touches SQLite.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { tables } from './tables.js';

export const DEFAULT_DB_PATH = 'data/jobhunt.db';
export const IN_MEMORY = ':memory:';

/** `packages/core/drizzle`, whether running from src (tsx, vitest) or dist. */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The database or a transaction on it; repository functions accept either. */
export type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof tables>;

function createDrizzle(sqlite: Database.Database) {
  return drizzle(sqlite, { schema: tables });
}

export interface OpenDbOptions {
  /** File path, or `:memory:` for tests. Defaults to `JH_DB` or `data/jobhunt.db`. */
  path?: string;
}

export interface Tracker {
  db: Db;
  path: string;
  close(): void;
}

/** Opens (creating if needed) the SQLite file, enables foreign keys and runs migrations. */
export function openDb(options: OpenDbOptions = {}): Tracker {
  const path = options.path ?? process.env['JH_DB'] ?? DEFAULT_DB_PATH;
  const location = path === IN_MEMORY ? path : resolve(path);
  if (location !== IN_MEMORY) mkdirSync(dirname(location), { recursive: true });

  const sqlite = new Database(location);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = createDrizzle(sqlite);
  migrate(db, { migrationsFolder });

  return {
    db,
    path: location,
    close: () => sqlite.close(),
  };
}
