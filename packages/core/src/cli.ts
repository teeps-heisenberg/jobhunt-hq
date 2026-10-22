#!/usr/bin/env node
/** Entry point for `pnpm jh`. All logic lives in ./cli/run.ts so it can be tested. */
import { run } from './cli/run.js';

const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
process.exitCode = code;
