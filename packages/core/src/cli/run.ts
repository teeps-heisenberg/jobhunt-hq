/**
 * `pnpm jh <command>`: the deterministic side of JobHunt HQ.
 * `run()` is pure with respect to process state so tests can drive it with a temp database.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import {
  buildVariant,
  checkPages,
  convertToPdf,
  type CoverLetter,
  findSoffice,
  formatIssue,
  importCv,
  lintText,
  Master,
  Pack,
  packFolder,
  packToText,
  type PageCheck,
  renderPackMarkdown,
  resumeToText,
  writeCoverLetterDocx,
  writeDocx,
} from '@jobhunt-hq/resume';

import { buildApplyPlan } from '../apply.js';
import { ConfigError, loadConfig, loadProfile, loadRules } from '../config.js';
import { openDb, type Tracker } from '../db/client.js';
import {
  addArtifact,
  addEvent,
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
import {
  IsoDate,
  JOB_STATUSES,
  type Job,
  type JobInput,
  type JobStatus,
  ScoutOutput,
} from '../schema.js';
import { scoreJob } from '../scoring.js';
import { standardScreening } from '../screening.js';
import { scoutBrief, sourceGroups } from '../search.js';
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
  score <id>                 store why/gap text and re-score (--from file.json, or --why,
                             --gap, --visa-note, --min-years, --requirements "a, b")
  show <id>                  one job with its events and artifacts
  tailor <id|generic>        render the CV for a job: DOCX, PDF, page check, style lint
                             (--variant spec.json, --no-pdf)
  pack <id> --from pack.json write output/<company>/<role>/pack.md and cover.docx with
                             screening answers from the rules and the verify list
  apply-plan <id>            fields the apply-assist skill may fill, with values and sources
                             (--from pack.json, --json)
  followups                  follow-ups due today (--days N for the coming days, --json)
  followup-sent <id>         record a sent follow-up and set the next date (--follow-up, --note,
                             --channel)
  stats                      funnel and follow-ups due
  export-csv [file]          export every job as CSV (stdout when no file)
  import-cv <file>           extract text from a DOCX, PDF or TXT CV into data/imports/
  sources                    source groups for /search, from rules.sources
  scout-brief <group>        write the brief one job-scout receives (--focus, --out)
  doctor                     validate profile.yaml, rules.yaml and master.json; check DB and LibreOffice

Global options
  --db <path>                SQLite file (default: $JH_DB or data/jobhunt.db)
  --config-dir <dir>         profile.yaml and rules.yaml (default: config)
  --master <file>            master CV for skills matching (default: data/master.json)
  --dry-run                  add-jobs: report without writing
  --no-pdf                   tailor: skip the LibreOffice PDF step
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
  from: { type: 'string' },
  variant: { type: 'string' },
  'no-pdf': { type: 'boolean', default: false },
  days: { type: 'string' },
  channel: { type: 'string' },
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
  tailor,
  pack,
  'apply-plan': applyPlan,
  followups,
  'followup-sent': followupSent,
  stats,
  'export-csv': exportCsv,
  'import-cv': importCvCmd,
  doctor,
  sources,
  'scout-brief': scoutBriefCmd,
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

/** Fields `jh score --from <file.json>` accepts; command-line flags override them. */
const ScoreFile = z.object({
  why: z.string().optional(),
  gap: z.string().optional(),
  visaNote: z.string().optional(),
  minYears: z.number().int().min(0).max(40).optional(),
  keyRequirements: z.array(z.string().trim().min(1)).optional(),
  salaryText: z.string().optional(),
  postedAt: IsoDate.optional(),
  remote: z.boolean().optional(),
});

function score(ctx: Ctx): void {
  const [id] = ctx.positionals;
  const job = requireJob(ctx, id);
  const { profile, rules } = loadRulesAndProfile(ctx);
  const candidateSkills =
    loadCandidateSkills(resolve(ctx.cwd, ctx.values.master ?? 'data/master.json')) ?? [];

  let fromFile: z.infer<typeof ScoreFile> = {};
  if (ctx.values.from) {
    const path = resolve(ctx.cwd, ctx.values.from);
    if (!existsSync(path)) throw new CliError(`File not found: ${path}`, 2);
    const parsed = ScoreFile.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      throw new CliError(`${path}: invalid score file.\n${issues}`, 2);
    }
    fromFile = parsed.data;
  }

  const flagRequirements = ctx.values.requirements
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const requirements = flagRequirements ?? fromFile.keyRequirements ?? [];
  const minYears = num(ctx.values['min-years'], 'min-years') ?? fromFile.minYears;
  const why = ctx.values.why ?? fromFile.why;
  const gap = ctx.values.gap ?? fromFile.gap;
  const visaNote = ctx.values['visa-note'] ?? fromFile.visaNote;
  const salaryText = fromFile.salaryText ?? job.salaryText;
  const postedAt = fromFile.postedAt ?? job.postedAt;
  const remote = fromFile.remote ?? job.remote;

  const result = scoreJob({
    job: {
      company: job.company,
      role: job.role,
      location: job.location,
      ...(job.region !== null ? { region: job.region } : {}),
      remote,
      visaNote: visaNote ?? job.visaNote,
      ...(postedAt !== null ? { postedAt } : {}),
      ...(minYears !== undefined ? { minYears } : {}),
      keyRequirements: requirements,
      ...(salaryText !== null ? { salaryText } : {}),
    },
    profile,
    rules,
    candidateSkills,
    today: ctx.today,
  });

  const keepStatus = !['New', 'Shortlisted', 'Skipped'].includes(job.status);
  const gaps = gap ?? job.gaps;
  const updated = updateJob(
    ctx.tracker().db,
    job.id,
    {
      score: result.score,
      ...(keepStatus ? {} : { status: result.status }),
      ...(why !== undefined ? { why } : {}),
      gaps: result.blockers.length ? [gaps, ...result.blockers].filter(Boolean).join(' | ') : gaps,
      visaNote: (visaNote ?? job.visaNote) || result.visaNote,
      salaryText,
      postedAt,
      remote,
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
  if (failed.length && !ctx.values.json) {
    const setupMissing = failed.some(
      (c) => c.name.startsWith('config/') || c.name === 'data/master.json',
    );
    ctx.io.out('');
    ctx.io.out(
      setupMissing
        ? 'Next: open Claude Code in this folder and run /setup. It imports your CV and writes these files.'
        : 'Next: fix the fields listed above, then run pnpm jh doctor again.',
    );
    ctx.io.out('Just looking? pnpm demo starts the dashboard on fictional example data.');
  }
  if (failed.length) {
    throw new CliError(`${failed.length} check${failed.length === 1 ? '' : 's'} failed`, 1);
  }
}

// ---------------------------------------------------------------------------
// sources, scout-brief
// ---------------------------------------------------------------------------

function sources(ctx: Ctx): void {
  const { rules } = loadRulesAndProfile(ctx);
  const groups = sourceGroups(rules);
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(groups, null, 2));
    return;
  }
  ctx.io.out(
    table(
      ['group', 'enabled', 'label', 'targets'],
      groups.map((g) => [
        g.key,
        g.enabled ? 'yes' : 'no',
        g.label,
        truncate(g.targets.join(', '), 60),
      ]),
    ),
  );
}

function scoutBriefCmd(ctx: Ctx): void {
  const key = ctx.positionals[0];
  const { profile, rules } = loadRulesAndProfile(ctx);
  const groups = sourceGroups(rules);
  const group = groups.find((g) => g.key.toLowerCase() === key?.toLowerCase());
  if (!group) {
    throw new CliError(
      `Usage: jh scout-brief <group> [--focus text] [--out file]. Groups: ${groups.map((g) => g.key).join(', ')}`,
      2,
    );
  }
  if (!group.enabled) ctx.io.err(`warning: ${group.key} is disabled in rules.sources`);
  const tracked = listJobKeys(ctx.tracker().db);
  const brief = scoutBrief({
    group,
    profile,
    rules,
    tracked,
    focus: ctx.values.focus,
    today: ctx.today,
  });
  const out = resolve(ctx.cwd, ctx.values.out ?? join('data', 'scout', `${group.key}.md`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, brief, 'utf8');
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify({ group: group.key, out, tracked: tracked.length }, null, 2));
    return;
  }
  ctx.io.out(out);
}

// ---------------------------------------------------------------------------
// tailor
// ---------------------------------------------------------------------------

async function tailor(ctx: Ctx): Promise<void> {
  const [target] = ctx.positionals;
  if (!target) {
    throw new CliError(
      'Usage: jh tailor <id|generic> [--variant spec.json] [--no-pdf] [--json]',
      2,
    );
  }
  const { rules } = loadRulesAndProfile(ctx);
  const masterPath = resolve(ctx.cwd, ctx.values.master ?? 'data/master.json');
  if (!existsSync(masterPath)) {
    throw new CliError(`${masterPath}: not found. Run /setup to draft it from your CV.`, 1);
  }
  const master = JSON.parse(readFileSync(masterPath, 'utf8')) as unknown;

  let spec: unknown = {};
  if (ctx.values.variant) {
    const path = resolve(ctx.cwd, ctx.values.variant);
    if (!existsSync(path)) throw new CliError(`File not found: ${path}`, 2);
    spec = JSON.parse(readFileSync(path, 'utf8'));
  }

  const job = target === 'generic' ? undefined : requireJob(ctx, target);
  const folder = resolve(
    ctx.cwd,
    job ? packFolder(job.company, job.role) : join('output', 'generic'),
  );
  mkdirSync(folder, { recursive: true });

  let variant;
  try {
    variant = buildVariant(master, spec);
  } catch (error) {
    throw new CliError(
      `Variant could not be built: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  const { resume, newClaims } = variant;

  const docxPath = await writeDocx(resume, join(folder, 'cv.docx'));
  const style = rules.style;
  const lintIssues = lintText(resumeToText(resume), {
    bannedCharacters: style.bannedCharacters,
    bannedPhrases: style.bannedPhrases,
  });

  let pdfPath: string | undefined;
  let pages: PageCheck | undefined;
  let pdfNote: string | undefined;
  if (ctx.values['no-pdf']) {
    pdfNote = 'skipped (--no-pdf)';
  } else if (!findSoffice()) {
    pdfNote = 'skipped: LibreOffice (soffice) not found; install it or set SOFFICE';
  } else {
    pdfPath = await convertToPdf(docxPath);
    pages = await checkPages(pdfPath, style.maxPages);
  }

  const verifyItems = newClaims.map((c) => `${c.where}: ${c.text}`);
  const at = nowIso(ctx.today);
  if (job) {
    const { db } = ctx.tracker();
    addArtifact(
      db,
      { jobId: job.id, kind: 'cv_docx', path: rel(ctx.cwd, docxPath), verifyItems },
      at,
    );
    if (pdfPath) {
      addArtifact(
        db,
        { jobId: job.id, kind: 'cv_pdf', path: rel(ctx.cwd, pdfPath), verifyItems },
        at,
      );
    }
  }

  const ok = lintIssues.length === 0 && (pages?.ok ?? true);
  const summary = {
    job: job?.id ?? 'generic',
    folder: rel(ctx.cwd, folder),
    docx: rel(ctx.cwd, docxPath),
    pdf: pdfPath ? rel(ctx.cwd, pdfPath) : null,
    pdfNote: pdfNote ?? null,
    pages: pages ?? null,
    lint: lintIssues.map(formatIssue),
    newClaims,
    ok,
  };

  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(summary, null, 2));
  } else {
    ctx.io.out(`${summary.job}: ${ok ? 'OK' : 'NEEDS WORK'}`);
    ctx.io.out(`  docx   ${summary.docx}`);
    ctx.io.out(`  pdf    ${summary.pdf ?? pdfNote ?? ''}`);
    if (pages) ctx.io.out(`  pages  ${pages.message}`);
    ctx.io.out(
      lintIssues.length
        ? `  lint   ${lintIssues.length} issue${lintIssues.length === 1 ? '' : 's'}`
        : '  lint   clean',
    );
    for (const issue of lintIssues) ctx.io.out(`    ${formatIssue(issue)}`);
    if (newClaims.length) {
      ctx.io.out(`  verify before sending (${newClaims.length}, not in master.json):`);
      for (const c of newClaims) ctx.io.out(`    - ${c.where}: ${c.text}`);
    } else {
      ctx.io.out('  verify before sending: nothing, every sentence is in master.json');
    }
  }
  if (!ok) throw new CliError(pages && !pages.ok ? pages.message : 'style lint failed', 1);
}

function rel(cwd: string, path: string): string {
  return relative(cwd, path).split('\\').join('/');
}

// ---------------------------------------------------------------------------
// pack
// ---------------------------------------------------------------------------

/** What the pack skill writes; the CLI fills the job, files, date and standard screening. */
const PackInput = z.object({
  coverNote: z.array(z.string().trim().min(1)).min(1),
  whyThisRole: z.array(z.string().trim().min(1)).default([]),
  screening: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
        source: z.string().optional(),
      }),
    )
    .default([]),
  notes: z.array(z.string().trim().min(1)).default([]),
  verify: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        where: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
  /** Cover letter addressee and subject; default to the hiring team and the role. */
  to: z.string().trim().min(1).optional(),
  re: z.string().trim().min(1).optional(),
});

async function pack(ctx: Ctx): Promise<void> {
  const [id] = ctx.positionals;
  if (!id || !ctx.values.from) {
    throw new CliError('Usage: jh pack <id> --from pack.json [--json]', 2);
  }
  const job = requireJob(ctx, id);
  const { profile, rules } = loadRulesAndProfile(ctx);

  const path = resolve(ctx.cwd, ctx.values.from);
  if (!existsSync(path)) throw new CliError(`File not found: ${path}`, 2);
  const parsed = PackInput.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new CliError(`${path}: invalid pack file.\n${issues}`, 2);
  }
  const input = parsed.data;

  const { db } = ctx.tracker();
  const artifacts = listArtifacts(db, job.id);
  const latest = (kind: string) => artifacts.find((a) => a.kind === kind)?.path;
  const folder = resolve(ctx.cwd, packFolder(job.company, job.role));
  mkdirSync(folder, { recursive: true });

  // Standard answers from profile and rules; the skill's answers win on the same question.
  const provided = new Set(input.screening.map((s) => s.question.toLowerCase()));
  const screening = [
    ...standardScreening(job, profile, rules).filter(
      (s) => !provided.has(s.question.toLowerCase()),
    ),
    ...input.screening,
  ];

  // Verify list: the skill's items plus anything the CV artifacts flagged.
  const seen = new Set(input.verify.map((v) => v.text.toLowerCase()));
  const verify = [...input.verify];
  for (const item of artifacts.find((a) => a.kind === 'cv_docx')?.verifyItems ?? []) {
    const [where, ...rest] = item.split(': ');
    const text = rest.join(': ') || item;
    if (!seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      verify.push({ text, where: `cv.${where}`, reason: 'not in master.json' });
    }
  }

  const coverPath = join(folder, 'cover.docx');
  const letter: CoverLetter = {
    from: {
      name: profile.name,
      contact: [profile.contact.location, profile.contact.email, profile.contact.phone]
        .filter((s): s is string => Boolean(s))
        .join(' | '),
    },
    date: longDate(ctx.today),
    to: input.to ?? `Hiring Team, ${job.company}`,
    re: input.re ?? job.role,
    paras: input.coverNote,
    closing: 'Kind regards,',
  };
  await writeCoverLetterDocx(letter, coverPath);

  const cvPdf = latest('cv_pdf');
  const cvDocx = latest('cv_docx');
  const packData: Pack = Pack.parse({
    job: {
      id: job.id,
      company: job.company,
      role: job.role,
      location: job.location,
      url: job.url,
      ...(job.applyUrl ? { applyUrl: job.applyUrl } : {}),
    },
    generatedAt: ctx.today,
    coverNote: input.coverNote,
    whyThisRole: input.whyThisRole,
    screening,
    notes: input.notes,
    verify,
    files: {
      ...(cvPdf ? { cvPdf } : {}),
      ...(cvDocx ? { cvDocx } : {}),
      coverDocx: rel(ctx.cwd, coverPath),
    },
  });
  const markdown = renderPackMarkdown(packData);
  const packPath = join(folder, 'pack.md');
  writeFileSync(packPath, markdown, 'utf8');

  const lintIssues = lintText(packToText(packData), {
    bannedCharacters: rules.style.bannedCharacters,
    bannedPhrases: rules.style.bannedPhrases,
  });

  const verifyItems = verify.map((v) => (v.where ? `${v.where}: ${v.text}` : v.text));
  const at = nowIso(ctx.today);
  addArtifact(db, { jobId: job.id, kind: 'cover', path: rel(ctx.cwd, coverPath), verifyItems }, at);
  addArtifact(db, { jobId: job.id, kind: 'pack', path: rel(ctx.cwd, packPath), verifyItems }, at);

  const ok = lintIssues.length === 0;
  const summary = {
    job: job.id,
    pack: rel(ctx.cwd, packPath),
    cover: rel(ctx.cwd, coverPath),
    cv: { pdf: cvPdf ?? null, docx: cvDocx ?? null },
    screening,
    verify,
    lint: lintIssues.map(formatIssue),
    ok,
  };
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(summary, null, 2));
  } else {
    ctx.io.out(`${job.id}: ${ok ? 'OK' : 'NEEDS WORK'}`);
    ctx.io.out(`  pack   ${summary.pack}`);
    ctx.io.out(`  cover  ${summary.cover}`);
    ctx.io.out(`  cv     ${cvPdf ?? cvDocx ?? 'none yet: run jh tailor first'}`);
    ctx.io.out(
      lintIssues.length
        ? `  lint   ${lintIssues.length} issue${lintIssues.length === 1 ? '' : 's'}`
        : '  lint   clean',
    );
    for (const issue of lintIssues) ctx.io.out(`    ${formatIssue(issue)}`);
    ctx.io.out(`  screening answers: ${screening.length}`);
    for (const s of screening)
      ctx.io.out(`    - ${s.question}: ${s.answer}${s.source ? ` (${s.source})` : ''}`);
    ctx.io.out(
      verify.length
        ? `  verify before sending (${verify.length}):`
        : '  verify before sending: nothing flagged',
    );
    for (const v of verify) ctx.io.out(`    - ${v.text}${v.where ? ` (${v.where})` : ''}`);
  }
  if (!ok) throw new CliError('style lint failed', 1);
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ---------------------------------------------------------------------------
// apply-plan
// ---------------------------------------------------------------------------

const PackHints = z
  .object({
    coverNote: z.array(z.string()).optional(),
    screening: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  })
  .passthrough();

function applyPlan(ctx: Ctx): void {
  const [id] = ctx.positionals;
  const job = requireJob(ctx, id);
  const { profile, rules } = loadRulesAndProfile(ctx);
  const artifacts = listArtifacts(ctx.tracker().db, job.id);
  const latest = (kind: string) => artifacts.find((a) => a.kind === kind)?.path;

  let hints: z.infer<typeof PackHints> = {};
  const packPath = resolve(
    ctx.cwd,
    ctx.values.from ?? join('data', 'scout', `${job.id}.pack.json`),
  );
  if (existsSync(packPath)) {
    const parsed = PackHints.safeParse(JSON.parse(readFileSync(packPath, 'utf8')));
    if (parsed.success) hints = parsed.data;
    else ctx.io.err(`warning: ${packPath} is not a pack file, ignoring it`);
  } else if (ctx.values.from) {
    throw new CliError(`File not found: ${packPath}`, 2);
  }

  const plan = buildApplyPlan({
    job,
    profile,
    rules,
    coverNote: hints.coverNote,
    screening: hints.screening,
    cvPath: latest('cv_pdf') ?? latest('cv_docx'),
    coverPath: latest('cover'),
  });

  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(plan, null, 2));
    return;
  }
  ctx.io.out(`${job.id}: ${plan.applyUrl}`);
  ctx.io.out(`  fields (${plan.fields.length}):`);
  for (const f of plan.fields) {
    const value = f.value.includes('\n') ? `${f.value.split('\n')[0]}...` : f.value;
    ctx.io.out(`    ${f.key.padEnd(16)} ${truncate(value, 60).padEnd(60)} ${f.source}`);
  }
  ctx.io.out(
    plan.uploads.length
      ? '  uploads (attach yourself):'
      : '  uploads: none recorded, run jh tailor first',
  );
  for (const u of plan.uploads) ctx.io.out(`    ${u.key.padEnd(16)} ${u.path}`);
  ctx.io.out('  left for you:');
  for (const s of plan.stopBefore) ctx.io.out(`    - ${s}`);
}

// ---------------------------------------------------------------------------
// followups, followup-sent
// ---------------------------------------------------------------------------

const FOLLOW_UP_STATUSES: JobStatus[] = ['Applied', 'Responded', 'Interview'];

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

function followups(ctx: Ctx): void {
  const horizon = num(ctx.values.days, 'days') ?? 0;
  const until = addDays(ctx.today, horizon);
  const { db } = ctx.tracker();
  const rows = listJobs(db, { status: FOLLOW_UP_STATUSES, followUpDue: until }).map((job) => {
    const events = listEvents(db, job.id);
    const sent = events.filter((e) => e.type === 'follow_up_sent');
    const last = events[events.length - 1];
    return {
      id: job.id,
      company: job.company,
      role: job.role,
      status: job.status,
      url: job.url,
      appliedAt: job.appliedAt,
      followUpAt: job.followUpAt,
      overdueDays: job.followUpAt ? daysBetween(job.followUpAt, ctx.today) : 0,
      daysSinceApplied: job.appliedAt ? daysBetween(job.appliedAt, ctx.today) : null,
      followUpsSent: sent.length,
      lastEvent: last ? { at: last.at, type: last.type, payload: last.payload } : null,
      notes: job.notes,
    };
  });
  rows.sort((a, b) => b.overdueDays - a.overdueDays);

  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    ctx.io.out(horizon ? `No follow-ups due within ${horizon} days.` : 'No follow-ups due today.');
    return;
  }
  ctx.io.out(
    table(
      ['id', 'status', 'company', 'role', 'applied', 'follow-up', 'overdue', 'sent'],
      rows.map((r) => [
        r.id,
        r.status,
        truncate(r.company, 22),
        truncate(r.role, 30),
        r.appliedAt?.slice(0, 10) ?? '',
        r.followUpAt ?? '',
        r.overdueDays > 0
          ? `${r.overdueDays}d`
          : r.overdueDays === 0
            ? 'today'
            : `in ${-r.overdueDays}d`,
        r.followUpsSent,
      ]),
    ),
  );
}

function followupSent(ctx: Ctx): void {
  const [id] = ctx.positionals;
  const job = requireJob(ctx, id);
  let days = 10;
  try {
    days = loadRulesAndProfile(ctx).rules.followUpDays;
  } catch {
    ctx.io.err(`warning: config not found, using a ${days}-day follow-up`);
  }
  const next = ctx.values['follow-up'] ?? addDays(ctx.today, days);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new CliError('--follow-up must be YYYY-MM-DD', 2);
  const at = nowIso(ctx.today);
  const { db } = ctx.tracker();
  const payload: Record<string, unknown> = { channel: ctx.values.channel ?? 'email' };
  if (ctx.values.note) payload['note'] = ctx.values.note;
  addEvent(db, job.id, 'follow_up_sent', payload, at);
  const updated = updateJob(db, job.id, { followUpAt: next }, at);
  if (ctx.values.json) {
    ctx.io.out(JSON.stringify(updated, null, 2));
    return;
  }
  ctx.io.out(`${updated.id}: follow-up recorded, next on ${next}`);
}
