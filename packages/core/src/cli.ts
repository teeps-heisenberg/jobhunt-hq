#!/usr/bin/env node
/** Entry point for `pnpm jh`. All logic lives in ./cli/run.ts so it can be tested. */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { run } from './cli/run.js';

/**
 * `pnpm jh` runs this script inside packages/core, so relative paths such as config/ and data/
 * must be resolved from the repo root: the nearest ancestor of the caller's directory (pnpm
 * sets INIT_CWD) that holds pnpm-workspace.yaml.
 */
function repoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  cwd: repoRoot(process.env['INIT_CWD'] ?? process.cwd()),
});
process.exitCode = code;
