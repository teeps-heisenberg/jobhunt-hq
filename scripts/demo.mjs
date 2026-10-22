#!/usr/bin/env node
/**
 * `pnpm demo`: start the dashboard on a throwaway database seeded from data/examples.
 * Nothing here touches data/jobhunt.db or config/*.yaml. Pass --seed-only to skip the server.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = join(root, 'data', 'demo');
const configDir = join(demoDir, 'config');
const db = join(demoDir, 'jobhunt.db');
mkdirSync(configDir, { recursive: true });

for (const name of ['profile', 'rules']) {
  const target = join(configDir, `${name}.yaml`);
  if (!existsSync(target)) copyFileSync(join(root, 'config', `${name}.example.yaml`), target);
}

const pnpm = 'pnpm';
const jh = (...args) => {
  const result = spawnSync(
    pnpm,
    [
      '--filter',
      '@jobhunt-hq/core',
      'jh',
      ...args,
      '--db',
      db,
      '--config-dir',
      configDir,
      '--master',
      join(root, 'data', 'examples', 'master.json'),
    ],
    { cwd: root, stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.status !== 0 && !/duplicates/.test(result.stdout ?? '')) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }
  return result.stdout ?? '';
};

const added = jh('add-jobs', join(root, 'data', 'examples', 'jobs.json'), '--focus', 'demo');
const firstRun = /Inserted [1-9]/.test(added);
process.stdout.write(added.split('\n')[0] + '\n');

if (firstRun) {
  // A believable funnel for the screenshots.
  jh('set-status', 'acme-health-full-stack-engineer-eu', 'Applied', '--follow-up', '2026-10-21');
  jh('note', 'acme-health-full-stack-engineer-eu', 'Applied through Greenhouse; CV v2.');
  jh('set-status', 'globex-robotics-ai-engineer-berlin', 'Applied');
  jh(
    'set-status',
    'globex-robotics-ai-engineer-berlin',
    'Responded',
    '--note',
    'Recruiter call booked',
  );
  jh('set-status', 'hooli-software-engineer-applied-ai-amsterdam', 'Interview');
  jh(
    'set-status',
    'vandelay-research-research-software-engineer-lisbon',
    'Rejected',
    '--note',
    'Position filled',
  );
}

if (process.argv.includes('--seed-only')) {
  process.stdout.write(`Demo database ready at ${db}\n`);
  process.exit(0);
}

process.stdout.write(`Starting the dashboard on http://localhost:3000 with JH_DB=${db}\n`);
const server = spawnSync(pnpm, ['--filter', '@jobhunt-hq/dashboard', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, JH_DB: db },
});
process.exit(server.status ?? 0);
