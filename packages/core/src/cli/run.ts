/**
 * `pnpm jh <command>`: the deterministic side of JobHunt HQ.
 * `run()` is pure with respect to process state so tests can drive it with a temp database.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { ConfigError, loadConfig } from '../config.js';
import { openDb, type Tracker } from '../db/client.js';
import {
  addNote,
  getJob,
  getStats,
  insertJobs,
  listJobKeys,
  listJobs,
  type NewJob,
  NotFoundError,
  recordSearch,
  setStatus,
  updateJob,
} from '../db/repo.js';
import { dedupeJobs, makeJobId } from '../dedupe.js';
import type { JobStatus } from '../schema.js';
import { JOB_STATUSES, type Job, type JobInput, ScoutOutput } from '../schema.js';
import { scoreJob } from '../scoring.js';
import { csv, table, truncate } from './format.js';
import { loadCandidateSkills } from './skills.js';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
  cwd?: string;
  today?: string;
}

export const USAGE = `jh: JobHunt HQ CLI

Usage: jh <command> [options]

Commands
  add-jobs <file.json>       validate, dedupe, score and insert scouted jobs
  list                       list tracked jobs (--status, --min-score, --company, --source,
                             --batch, --due, --limit, --format table|json|ids)
  set-status <id> <status>   change status (--note, --follow-up YYYY-MM-DD)
  note <id> <text>           add a dated note
  score <id>                 store why/gap text and re-score (--why, --gap, --visa-note,
                             --min-years, --requirements "a, b")
  stats                      funnel and follow-ups due
  export-csv [file]          export every job as CSV (stdout when no file)

Global options
  --db <path>                SQLite file (default: $JH_DB or data/jobhunt.db)
  --config-dir <dir>         profile.yaml and rules.yaml (default: config)
  --master <file>            master CV for skills matching (default: data/master.json)
  --dry-run                  add-jobs: report without writing
  --json                     machine-readable output
  -h, --help                 this text

Statuses: ${JOB_STATUSES.join(', ')}
`;

const GLOBAL_OPTIONS = {
  db: { type: 'string' },
  'config-dir': { type: 'string' },
  master: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  // per command
  status: { type: 'string', multiple: true },
  'min-score': { type: 'string' },
  company: { type: 'string' },
  source: { type: 'string' },
  batch: { type: 'string' },
  due: { type: 'boolean', default: false },
  limit: { type: 'string' },
  format: { type: 'string', default: 'table' },
  note: { type: 'string' },
  'follow-up': { type: 'string' },
  focus: { type: 'string' },
  why: { type: 'string' },
  gap: { type: 'string' },
  'visa-note': { type: 'string' },
  'min-years': { type: 'string' },
  requirements: { type: 'string' },
} as const;

class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}

type Values = ReturnType<
  typeof parseArgs<{ options: typeof GLOBAL_OPTIONS; allowPositionals: true }>
>['values'];

interface Ctx {
  values: Values;
  positionals: string[];
  io: Io;
  cwd: string;
  today: string;
  tracker: () => Tracker;
}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: GLOBAL_OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    io.out(USAGE);
    return command ? 0 : 2;
  }

  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const today = io.today ?? new Date().toISOString().slice(0, 10);
  let opened: Tracker | undefined;
  const ctx: Ctx = {
    values,
    positionals: rest,
    io,
    cwd,
    today,
    tracker: () => {
      opened ??= openDb({ path: resolve(cwd, values.db ?? env['JH_DB'] ?? 'data/jobhunt.db') });
      return opened;
    },
  };

  try {
    const handler = COMMANDS[command];
    if (!handler) throw new CliError(`Unknown command: ${command}\n\n${USAGE}`, 2);
    await handler(ctx);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return error.code;
    }
    if (error instanceof NotFoundError || error instanceof ConfigError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  } finally {
    opened?.close();
  }
}

type Handler = (ctx: Ctx) => void | Promise<void>;

const COMMANDS: Record<string, Handler> = {
  'add-jobs': addJobs,
  list,
  'set-status': setStatusCmd,
  note,
  score,
  stats,
  'export-csv': exportCsv,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(today: string): string {
  const now = new Date().toISOString();
  return now.startsWith(today) ? now : `${today}T12:00:00.000Z`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function loadRulesAndProfile(ctx: Ctx) {
  return loadConfig({ dir: resolve(ctx.cwd, ctx.values['config-dir'] ?? 'config') });
}

function parseStatus(s: string): JobStatus {
  const match = JOB_STATUSES.find((x) => x.toLowerCase() === s.toLowerCase());
  if (!match)
    throw new CliError(`Unknown status "${s}". Use one of: ${JOB_STATUSES.join(', ')}`, 2);
  return match;
}

function num(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new CliError(`--${name} must be a number`, 2);
  return n;
}

function requireJob(ctx: Ctx, id: string | undefined): Job {
  if (!id) throw new CliError('Missing <id>', 2);
  const job = getJob(ctx.tracker().db, id);
  if (!job) throw new NotFoundError('job', id);
  return job;
}

function jobRow(j: Job) {
  return [
    j.id,
    j.score.toFixed(1),
    j.status,
    truncate(j.company, 22),
    truncate(j.role, 34),
    truncate(j.location, 20),
    j.followUpAt ?? '',
  ];
}

const JOB_HEADERS = ['id', 'score', 'status', 'company', 'role', 'location', 'follow-up'];

// ---------------------------------------------------------------------------
// add-jobs
// ---------------------------------------------------------------------------

function readScoutFile(path: string): ScoutOutput {
  if (!existsSync(path)) throw new CliError(`File not found: ${path}`, 2);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CliError(
      `${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
      2,
    );
  }
  const shaped = Array.isArray(data) ? { jobs: data } : data;
  const result = ScoutOutput.safeParse(shaped);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new CliError(`${path}: rows do not match the Job schema.\n${issues}`, 2);
  }
  return result.data;
}

function addJobs(ctx: Ctx): void {
  const file = ctx.positionals[0];
  if (!file) throw new CliError('Usage: jh add-jobs <file.json>', 2);
  const scout = readScoutFile(resolve(ctx.cwd, file));
  const { profile, rules } = loadRulesAndProfile(ctx);
  const masterPath = resolve(ctx.cwd, ctx.values.master ?? 'data/master.json');
  const candidateSkills = loadCandidateSkills(masterPath);
  if (!candidateSkills)
    ctx.io.err(`warning: ${masterPath} not found, skills factor will be neutral`);

  const { db } = ctx.tracker();
  const existing = listJobKeys(db);
  const deduped = dedupeJobs(scout.jobs, existing);
  const taken = new Set(existing.map((j) => j.id));
  const at = nowIso(ctx.today);

  const rows: NewJob[] = [];
  const skipped: Array<{ input: JobInput; blockers: string[] }> = [];
  // dedupeJobs names earlier rows of the same batch `batch:<index>`; map those to real ids.
  const assigned = new Map<number, string>();
  const realId = (id: string) =>
    id.startsWith('batch:') ? (assigned.get(Number(id.slice(6))) ?? id) : id;
  for (const input of deduped.unique) {
    const result = scoreJob({
      job: input,
      profile,
      rules,
      candidateSkills: candidateSkills ?? [],
      today: ctx.today,
    });
    const id = makeJobId(input, taken);
    taken.add(id);
    assigned.set(scout.jobs.indexOf(input), id);
    rows.push({
      id,
      company: input.company,
      role: input.role,
      location: input.location,
      region: input.region ?? null,
      remote: input.remote,
      visaNote: input.visaNote || result.visaNote,
      url: input.url,
      applyUrl: input.applyUrl ?? null,
      salaryText: input.salaryText ?? null,
      score: result.score,
      status: result.status,
      postedAt: input.postedAt ?? null,
      why: input.why,
      gaps: result.blockers.length
        ? [input.gap, ...result.blockers].filter(Boolean).join(' | ')
        : input.gap,
      source: input.source,
      batch: input.batch ?? `${ctx.today}-${input.source}`,
    });
    if (result.status === 'Skipped') skipped.push({ input, blockers: result.blockers });
  }

  if (!ctx.values['dry-run']) {
    insertJobs(db, rows, at);
    recordSearch(
      db,
      {
        focus: ctx.values.focus ?? null,
        sources: [...new Set(scout.jobs.map((j) => j.source))],
        found: scout.jobs.length,
        new: rows.length - skipped.length,
        skipped: deduped.duplicates.length + skipped.length,
      },
      at,
    );
  }

  const summary = {
    dryRun: ctx.values['dry-run'],
    found: scout.jobs.length,
    inserted: rows.map((r) => ({ id: r.id, score: r.score, status: r.status })),
    duplicates: deduped.duplicates.map((d) => ({
      url: d.candidate.url,
      of: realId(d.match.existingId),
      reason: d.match.reason,
    })),
    variants: deduped.variants.map((v) => ({
      url: v.candidate.url,
      of: v.variants.map((x) => realId(x.existingId)),
    })),
    skipped: skipped.map((s) => ({ url: s.input.url, blockers: s.blockers })),
    rejectedByScout: scout.rejected,
  };

  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(summary, null, 2));
    return;
  }

  const verb = ctx.values['dry-run'] ? 'Would insert' : 'Inserted';
  ctx.io.out(
    `${verb} ${rows.length} of ${scout.jobs.length} (${deduped.duplicates.length} duplicates, ${skipped.length} skipped by rules)`,
  );
  if (rows.length) {
    const inserted = rows.map((r) => [
      r.id,
      r.score!.toFixed(1),
      r.status!,
      truncate(r.company, 22),
      truncate(r.role, 34),
      truncate(r.location, 20),
    ]);
    ctx.io.out('');
    ctx.io.out(table(['id', 'score', 'status', 'company', 'role', 'location'], inserted));
  }
  if (deduped.duplicates.length) {
    ctx.io.out('');
    ctx.io.out('Duplicates:');
    for (const d of deduped.duplicates)
      ctx.io.out(
        `  ${d.candidate.company}: ${d.candidate.role} = ${realId(d.match.existingId)} (${d.match.reason})`,
      );
  }
  if (deduped.variants.length) {
    ctx.io.out('');
    ctx.io.out('Regional variants of tracked roles (kept):');
    for (const v of deduped.variants)
      ctx.io.out(
        `  ${v.candidate.company}: ${v.candidate.role} in ${v.candidate.location}, see ${v.variants.map((x) => realId(x.existingId)).join(', ')}`,
      );
  }
  if (skipped.length) {
    ctx.io.out('');
    ctx.io.out('Skipped by rules:');
    for (const s of skipped)
      ctx.io.out(`  ${s.input.company}: ${s.input.role}: ${s.blockers.join('; ')}`);
  }
  if (scout.rejected.length) {
    ctx.io.out('');
    ctx.io.out('Rejected by the scout:');
    for (const r of scout.rejected) ctx.io.out(`  ${r.title}: ${r.reason}`);
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function list(ctx: Ctx): void {
  const v = ctx.values;
  const jobs = listJobs(ctx.tracker().db, {
    ...(v.status ? { status: v.status.map(parseStatus) } : {}),
    ...(v['min-score'] !== undefined ? { minScore: num(v['min-score'], 'min-score')! } : {}),
    ...(v.company ? { company: v.company } : {}),
    ...(v.source ? { source: v.source as Job['source'] } : {}),
    ...(v.batch ? { batch: v.batch } : {}),
    ...(v.due ? { followUpDue: ctx.today, status: ['Applied', 'Responded', 'Interview'] } : {}),
    ...(v.limit !== undefined ? { limit: num(v.limit, 'limit')! } : {}),
  });

  const format = v.json ? 'json' : v.format;
  switch (format) {
    case 'json':
      ctx.io.out(JSON.stringify(jobs, null, 2));
      return;
    case 'ids':
      ctx.io.out(
        JSON.stringify(
          jobs.map((j) => ({
            id: j.id,
            company: j.company,
            role: j.role,
            location: j.location,
            url: j.url,
          })),
          null,
          2,
        ),
      );
      return;
    case 'table':
      ctx.io.out(jobs.length ? table(JOB_HEADERS, jobs.map(jobRow)) : 'No jobs match.');
      return;
    default:
      throw new CliError(`Unknown --format "${format}". Use table, json or ids.`, 2);
  }
}

// ---------------------------------------------------------------------------
// set-status, note, score
// ---------------------------------------------------------------------------

function setStatusCmd(ctx: Ctx): void {
  const [id, statusArg] = ctx.positionals;
  if (!id || !statusArg)
    throw new CliError(
      'Usage: jh set-status <id> <status> [--note text] [--follow-up YYYY-MM-DD]',
      2,
    );
  const status = parseStatus(statusArg);
  const { db } = ctx.tracker();
  requireJob(ctx, id);

  let followUpAt: string | null | undefined = ctx.values['follow-up'];
  if (followUpAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(followUpAt)) {
    throw new CliError('--follow-up must be YYYY-MM-DD', 2);
  }
  if (followUpAt === undefined && status === 'Applied') {
    let days = 10;
    try {
      days = loadRulesAndProfile(ctx).rules.followUpDays;
    } catch {
      ctx.io.err(`warning: config not found, using a ${days}-day follow-up`);
    }
    followUpAt = addDays(ctx.today, days);
  }

  const job = setStatus(
    db,
    id,
    status,
    {
      ...(ctx.values.note ? { note: ctx.values.note } : {}),
      ...(followUpAt !== undefined ? { followUpAt } : {}),
    },
    nowIso(ctx.today),
  );
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(job, null, 2));
    return;
  }
  ctx.io.out(`${job.id}: ${job.status}${job.followUpAt ? `, follow up on ${job.followUpAt}` : ''}`);
}

function note(ctx: Ctx): void {
  const [id, ...words] = ctx.positionals;
  const text = words.join(' ').trim();
  if (!id || !text) throw new CliError('Usage: jh note <id> <text>', 2);
  requireJob(ctx, id);
  const job = addNote(ctx.tracker().db, id, text, nowIso(ctx.today));
  ctx.io.out(ctx.values.json ? JSON.stringify(job, null, 2) : `${job.id}: note added`);
}

function score(ctx: Ctx): void {
  const [id] = ctx.positionals;
  const job = requireJob(ctx, id);
  const { profile, rules } = loadRulesAndProfile(ctx);
  const candidateSkills =
    loadCandidateSkills(resolve(ctx.cwd, ctx.values.master ?? 'data/master.json')) ?? [];
  const requirements =
    ctx.values.requirements
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const minYears = num(ctx.values['min-years'], 'min-years');

  const result = scoreJob({
    job: {
      company: job.company,
      role: job.role,
      location: job.location,
      ...(job.region !== null ? { region: job.region } : {}),
      remote: job.remote,
      visaNote: ctx.values['visa-note'] ?? job.visaNote,
      ...(job.postedAt !== null ? { postedAt: job.postedAt } : {}),
      ...(minYears !== undefined ? { minYears } : {}),
      keyRequirements: requirements,
      ...(job.salaryText !== null ? { salaryText: job.salaryText } : {}),
    },
    profile,
    rules,
    candidateSkills,
    today: ctx.today,
  });

  const keepStatus = !['New', 'Shortlisted', 'Skipped'].includes(job.status);
  const updated = updateJob(
    ctx.tracker().db,
    job.id,
    {
      score: result.score,
      ...(keepStatus ? {} : { status: result.status }),
      ...(ctx.values.why !== undefined ? { why: ctx.values.why } : {}),
      gaps: ctx.values.gap ?? job.gaps,
      ...(result.blockers.length
        ? { gaps: [ctx.values.gap ?? job.gaps, ...result.blockers].filter(Boolean).join(' | ') }
        : {}),
      visaNote: (ctx.values['visa-note'] ?? job.visaNote) || result.visaNote,
    },
    nowIso(ctx.today),
  );

  if (ctx.values.json) {
    ctx.io.out(JSON.stringify({ job: updated, result }, null, 2));
    return;
  }
  ctx.io.out(`${updated.id}: score ${updated.score.toFixed(1)}, status ${updated.status}`);
  for (const [name, factor] of Object.entries(result.factors))
    ctx.io.out(`  ${name.padEnd(9)} ${factor.value.toFixed(2)}  ${factor.note}`);
  for (const b of result.blockers) ctx.io.out(`  blocker: ${b}`);
}

// ---------------------------------------------------------------------------
// stats, export-csv
// ---------------------------------------------------------------------------

function stats(ctx: Ctx): void {
  const s = getStats(ctx.tracker().db, ctx.today);
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(s, null, 2));
    return;
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  ctx.io.out(`Tracked: ${s.total} jobs at ${s.companies} companies`);
  ctx.io.out(
    table(
      ['status', 'count'],
      JOB_STATUSES.map((st) => [st, s.byStatus[st]]),
    ),
  );
  ctx.io.out('');
  ctx.io.out(
    `Applied: ${s.applied}  Responded: ${s.responded} (${pct(s.responded, s.applied)} of applied)  Follow-ups due: ${s.followUpsDue}`,
  );
}

function exportCsv(ctx: Ctx): void {
  const jobs = listJobs(ctx.tracker().db);
  const headers = Object.keys(jobs[0] ?? { id: '' }) as Array<keyof Job>;
  const text = csv(
    headers,
    jobs.map((j) => headers.map((h) => j[h])),
  );
  const file = ctx.positionals[0];
  if (file) {
    const path = resolve(ctx.cwd, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    ctx.io.out(`Wrote ${jobs.length} jobs to ${path}`);
  } else {
    ctx.io.out(text.trimEnd());
  }
}
