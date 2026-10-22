/**
 * One tracker connection per server process. The dashboard reads and writes the same SQLite
 * file as `pnpm jh`, always through @jobhunt-hq/core.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { openDb, type Tracker } from '@jobhunt-hq/core';

declare global {
  var __jobhuntTracker: Tracker | undefined;
}

/** Nearest ancestor holding pnpm-workspace.yaml, so paths work from apps/dashboard. */
export function repoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function dbPath(): string {
  return resolve(repoRoot(), process.env['JH_DB'] ?? 'data/jobhunt.db');
}

export function getTracker(): Tracker {
  globalThis.__jobhuntTracker ??= openDb({ path: dbPath() });
  return globalThis.__jobhuntTracker;
}
