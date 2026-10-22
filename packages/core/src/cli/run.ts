/**
 * `pnpm jh <command>`: the deterministic side of JobHunt HQ.
 * `run()` is pure with respect to process state so tests can drive it with a temp database.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { findSoffice, importCv, Master } from '@jobhunt-hq/resume';

import { ConfigError, loadConfig, loadProfile, loadRules } from '../config.js';
import { openDb, type Tracker } from '../db/client.js';
import {
  addNote,
  getJob,
  getStats,
  insertJobs,
  listArtifacts,
  listEvents,
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
  show <id>                  one job with its events and artifacts
  stats                      funnel and follow-ups due
  export-csv [file]          export every job as CSV (stdout when no file)
  import-cv <file>           extract text from a DOCX, PDF or TXT CV into data/imports/
  doctor                     validate profile.yaml, rules.yaml and master.json; check DB and LibreOffice

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
  out: { type: 'string' },
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
  show,
  stats,
  'export-csv': exportCsv,
  'import-cv': importCvCmd,
  doctor,
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

// ---------------------------------------------------------------------------
// show, import-cv, doctor
// ---------------------------------------------------------------------------

function show(ctx: Ctx): void {
  const job = requireJob(ctx, ctx.positionals[0]);
  const { db } = ctx.tracker();
  const events = listEvents(db, job.id);
  const artifacts = listArtifacts(db, job.id);
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify({ job, events, artifacts }, null, 2));
    return;
  }
  const field = (k: string, v: string | number | boolean | null) => {
    if (v !== null && v !== '') ctx.io.out(`${k.padEnd(12)} ${String(v)}`);
  };
  ctx.io.out(`${job.company}: ${job.role}`);
  field('id', job.id);
  field('status', job.status);
  field('score', job.score.toFixed(1));
  field('location', `${job.location}${job.remote ? ' (remote)' : ''}`);
  field('region', job.region);
  field('url', job.url);
  field('apply', job.applyUrl);
  field('salary', job.salaryText);
  field('posted', job.postedAt);
  field('found', job.foundAt.slice(0, 10));
  field('applied', job.appliedAt);
  field('follow-up', job.followUpAt);
  field('source', `${job.source}${job.batch ? ` (${job.batch})` : ''}`);
  field('why', job.why);
  field('gaps', job.gaps);
  field('visa', job.visaNote);
  if (job.notes) {
    ctx.io.out('notes');
    for (const line of job.notes.split('\n')) ctx.io.out(`  ${line}`);
  }
  if (artifacts.length) {
    ctx.io.out('artifacts');
    for (const a of artifacts) {
      const verify = a.verifyItems.length ? ` (${a.verifyItems.length} to verify)` : '';
      ctx.io.out(`  ${a.createdAt.slice(0, 10)}  ${a.kind.padEnd(8)} ${a.path}${verify}`);
    }
  }
  if (events.length) {
    ctx.io.out('timeline');
    for (const e of events) {
      const p = e.payload;
      const detail =
        e.type === 'status_change'
          ? `${String(p['from'])} -> ${String(p['to'])}${p['note'] ? `: ${String(p['note'])}` : ''}`
          : e.type === 'note'
            ? String(p['note'] ?? '')
            : JSON.stringify(p);
      ctx.io.out(`  ${e.at.slice(0, 10)}  ${e.type.padEnd(13)} ${detail}`);
    }
  }
}

async function importCvCmd(ctx: Ctx): Promise<void> {
  const file = ctx.positionals[0];
  if (!file) throw new CliError('Usage: jh import-cv <file.docx|.pdf|.txt> [--out file.txt]', 2);
  const input = resolve(ctx.cwd, file);
  if (!existsSync(input)) throw new CliError(`File not found: ${input}`, 2);
  let imported;
  try {
    imported = await importCv(input);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), 1);
  }
  const out = resolve(
    ctx.cwd,
    ctx.values.out ?? join('data', 'imports', `${basename(input, extname(input))}.txt`),
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${imported.text}\n`, 'utf8');
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify({ ...imported, out }, null, 2));
    return;
  }
  const pages =
    imported.pages !== undefined
      ? `, ${imported.pages} page${imported.pages === 1 ? '' : 's'}`
      : '';
  ctx.io.err(
    `Read ${imported.format.toUpperCase()}${pages}, ${imported.text.length} characters. Wrote ${out}`,
  );
  ctx.io.out(imported.text);
}

function doctor(ctx: Ctx): void {
  const dir = resolve(ctx.cwd, ctx.values['config-dir'] ?? 'config');
  const masterPath = resolve(ctx.cwd, ctx.values.master ?? 'data/master.json');
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const tryCheck = (name: string, fn: () => string) => {
    try {
      checks.push({ name, ok: true, detail: fn() });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  tryCheck('config/profile.yaml', () => {
    const p = loadProfile(join(dir, 'profile.yaml'));
    return `${p.name}, ${p.yearsExperience} years, ${p.targetTitles.length} target titles`;
  });
  tryCheck('config/rules.yaml', () => {
    const r = loadRules(join(dir, 'rules.yaml'));
    return `years bar ${r.experience.maxYearsBar}, ${r.style.maxPages} pages, ${Object.keys(r.salary).length} salary bands`;
  });
  tryCheck('data/master.json', () => {
    if (!existsSync(masterPath)) {
      throw new Error(`${masterPath}: not found. Run /setup to draft it from your CV.`);
    }
    const result = Master.safeParse(JSON.parse(readFileSync(masterPath, 'utf8')));
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      throw new Error(`${masterPath}: invalid.\n${issues}`);
    }
    const m = result.data;
    return `${m.name}, ${m.experience.length} positions, ${m.projects.length} projects, ${m.skills.length} skill groups`;
  });
  tryCheck('database', () => {
    const t = ctx.tracker();
    return `${t.path} (${getStats(t.db, ctx.today).total} jobs)`;
  });
  tryCheck('LibreOffice', () => {
    const soffice = findSoffice();
    if (!soffice) {
      throw new Error(
        'soffice not found: install LibreOffice or set SOFFICE. PDF rendering will fail until then.',
      );
    }
    return soffice;
  });

  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(checks, null, 2));
  } else {
    for (const c of checks) {
      const [first, ...rest] = c.detail.split('\n');
      ctx.io.out(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(20)} ${first ?? ''}`);
      for (const line of rest) ctx.io.out(`     ${line}`);
    }
  }
  const failed = checks.filter((c) => !c.ok && c.name !== 'LibreOffice');
  if (failed.length) {
    throw new CliError(`${failed.length} check${failed.length === 1 ? '' : 's'} failed`, 1);
  }
}
