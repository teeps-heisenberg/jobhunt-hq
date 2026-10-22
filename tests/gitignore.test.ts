/**
 * Guards the "local first" principle (SPEC section 2 and acceptance criterion 5):
 * personal config, data and generated output must never be tracked by git.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ignore from 'ignore';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(resolve(repoRoot, '.gitignore'), 'utf8');
const ig = ignore().add(rules);

const mustBeIgnored = [
  'config/profile.yaml',
  'config/rules.yaml',
  'config/anything.yml',
  'data/master.json',
  'data/jobhunt.db',
  'data/jobhunt.db-journal',
  'data/imports/cv.pdf',
  'output/acme/cv.pdf',
  'output/acme/backend-engineer/pack.md',
  'packages/core/test.db',
  '.env',
  '.env.local',
  'node_modules/zod/index.js',
  'packages/core/dist/index.js',
  'apps/dashboard/.next/build-manifest.json',
];

const mustBeTracked = [
  'config/profile.example.yaml',
  'config/rules.example.yml',
  'config/rules.example.yaml',
  'data/examples/master.json',
  'packages/core/src/index.ts',
  'apps/dashboard/src/index.ts',
  'docs/SPEC.md',
  '.github/workflows/ci.yml',
];

describe('.gitignore keeps personal data local', () => {
  it.each(mustBeIgnored)('ignores %s', (path) => {
    expect(ig.ignores(path)).toBe(true);
  });

  it.each(mustBeTracked)('tracks %s', (path) => {
    expect(ig.ignores(path)).toBe(false);
  });
});
