/**
 * Repository functions over the tracker database. Every row that leaves this module is
 * validated against the zod schemas, so callers always get well-formed data.
 */
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

import {
  Artifact,
  type ArtifactKind,
  Event,
  JOB_STATUSES,
  Job,
  type JobSource,
  type JobStatus,
  SearchRun,
} from '../schema.js';
import type { Db } from './client.js';
import { artifacts, events, jobs, searches } from './tables.js';

export const nowIso = (): string => new Date().toISOString();

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Fields a caller supplies when inserting; timestamps and bookkeeping get defaults. */
export type NewJob = Omit<
  Job,
  | 'region'
  | 'applyUrl'
  | 'salaryText'
  | 'postedAt'
  | 'batch'
  | 'appliedAt'
  | 'followUpAt'
  | 'notes'
  | 'foundAt'
  | 'createdAt'
  | 'updatedAt'
  | 'status'
  | 'score'
  | 'why'
  | 'gaps'
  | 'visaNote'
> &
  Partial<
    Pick<
      Job,
      | 'region'
      | 'applyUrl'
      | 'salaryText'
      | 'postedAt'
      | 'batch'
      | 'appliedAt'
      | 'followUpAt'
      | 'notes'
      | 'foundAt'
      | 'status'
      | 'score'
      | 'why'
      | 'gaps'
      | 'visaNote'
    >
  >;

export function insertJob(db: Db, input: NewJob, at = nowIso()): Job {
  const row = Job.parse({
    region: null,
    applyUrl: null,
    salaryText: null,
    postedAt: null,
    batch: null,
    appliedAt: null,
    followUpAt: null,
    notes: '',
    visaNote: '',
    why: '',
    gaps: '',
    score: 0,
    status: 'New',
    foundAt: at,
    createdAt: at,
    updatedAt: at,
    ...input,
  });
  db.insert(jobs).values(row).run();
  return row;
}

export function insertJobs(db: Db, inputs: NewJob[], at = nowIso()): Job[] {
  return db.transaction((tx) => inputs.map((input) => insertJob(tx, input, at)));
}

export function getJob(db: Db, id: string): Job | undefined {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  return row ? Job.parse(row) : undefined;
}

export interface JobFilter {
  status?: JobStatus | JobStatus[];
  minScore?: number;
  maxScore?: number;
  company?: string;
  source?: JobSource;
  batch?: string;
  remote?: boolean;
  region?: string;
  /** Jobs whose follow-up date is on or before this ISO date. */
  followUpDue?: string;
  limit?: number;
}

export function listJobs(db: Db, filter: JobFilter = {}): Job[] {
  const where = [];
  if (filter.status !== undefined) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    where.push(
      sql`${jobs.status} in (${sql.join(
        statuses.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }
  if (filter.minScore !== undefined) where.push(gte(jobs.score, filter.minScore));
  if (filter.maxScore !== undefined) where.push(lte(jobs.score, filter.maxScore));
  if (filter.company !== undefined) {
    where.push(sql`lower(${jobs.company}) = ${filter.company.toLowerCase()}`);
  }
  if (filter.source !== undefined) where.push(eq(jobs.source, filter.source));
  if (filter.batch !== undefined) where.push(eq(jobs.batch, filter.batch));
  if (filter.remote !== undefined) where.push(eq(jobs.remote, filter.remote));
  if (filter.region !== undefined) where.push(eq(jobs.region, filter.region));
  if (filter.followUpDue !== undefined) where.push(lte(jobs.followUpAt, filter.followUpDue));

  let query = db
    .select()
    .from(jobs)
    .where(and(...where))
    .orderBy(desc(jobs.score), desc(jobs.foundAt), asc(jobs.company))
    .$dynamic();
  if (filter.limit !== undefined) query = query.limit(filter.limit);

  return query.all().map((row) => Job.parse(row));
}

/** Every tracked id plus the URL, for dedupe before a search. */
export function listJobKeys(
  db: Db,
): Array<Pick<Job, 'id' | 'company' | 'role' | 'location' | 'url'>> {
  return db
    .select({
      id: jobs.id,
      company: jobs.company,
      role: jobs.role,
      location: jobs.location,
      url: jobs.url,
    })
    .from(jobs)
    .all();
}

export type JobPatch = Partial<Omit<Job, 'id' | 'createdAt' | 'updatedAt'>>;

export function updateJob(db: Db, id: string, patch: JobPatch, at = nowIso()): Job {
  const current = getJob(db, id);
  if (!current) throw new NotFoundError('job', id);
  const next = Job.parse({ ...current, ...patch, updatedAt: at });
  db.update(jobs).set(next).where(eq(jobs.id, id)).run();
  return next;
}

export interface SetStatusOptions {
  note?: string;
  /** Set when moving to Applied; defaults to `at`. */
  appliedAt?: string;
  /** Next follow-up date; the CLI derives it from rules.followUpDays. */
  followUpAt?: string | null;
}

/** Changes status, records a status_change event and keeps appliedAt/followUpAt in step. */
export function setStatus(
  db: Db,
  id: string,
  status: JobStatus,
  options: SetStatusOptions = {},
  at = nowIso(),
): Job {
  if (!JOB_STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  return db.transaction((tx) => {
    const current = getJob(tx, id);
    if (!current) throw new NotFoundError('job', id);

    const patch: JobPatch = { status };
    if (status === 'Applied') patch.appliedAt = options.appliedAt ?? at;
    if (options.followUpAt !== undefined) patch.followUpAt = options.followUpAt;
    if (['Offer', 'Rejected', 'Skipped'].includes(status) && options.followUpAt === undefined) {
      patch.followUpAt = null;
    }

    const payload: Record<string, unknown> = { from: current.status, to: status };
    if (options.note) payload['note'] = options.note;
    tx.insert(events).values({ jobId: id, at, type: 'status_change', payload }).run();

    return updateJob(tx, id, patch, at);
  });
}

/** Appends a dated line to the job's notes and records a note event. */
export function addNote(db: Db, id: string, text: string, at = nowIso()): Job {
  const note = text.trim();
  if (!note) throw new Error('Note text is empty');
  return db.transaction((tx) => {
    const current = getJob(tx, id);
    if (!current) throw new NotFoundError('job', id);
    const line = `${at.slice(0, 10)}: ${note}`;
    const notes = current.notes ? `${current.notes}\n${line}` : line;
    tx.insert(events).values({ jobId: id, at, type: 'note', payload: { note } }).run();
    return updateJob(tx, id, { notes }, at);
  });
}

export function deleteJob(db: Db, id: string): boolean {
  const result = db.delete(jobs).where(eq(jobs.id, id)).run();
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export interface NewArtifact {
  jobId: string;
  kind: ArtifactKind;
  path: string;
  verifyItems?: string[];
}

export function addArtifact(db: Db, input: NewArtifact, at = nowIso()): Artifact {
  if (!getJob(db, input.jobId)) throw new NotFoundError('job', input.jobId);
  const row = db
    .insert(artifacts)
    .values({
      jobId: input.jobId,
      kind: input.kind,
      path: input.path,
      createdAt: at,
      verifyItems: input.verifyItems ?? [],
    })
    .returning()
    .get();
  return Artifact.parse(row);
}

export function listArtifacts(db: Db, jobId: string): Artifact[] {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.jobId, jobId))
    .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
    .all()
    .map((row) => Artifact.parse(row));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function listEvents(db: Db, jobId: string): Event[] {
  return db
    .select()
    .from(events)
    .where(eq(events.jobId, jobId))
    .orderBy(asc(events.at), asc(events.id))
    .all()
    .map((row) => Event.parse(row));
}

export function addEvent(
  db: Db,
  jobId: string,
  type: Event['type'],
  payload: Record<string, unknown> = {},
  at = nowIso(),
): Event {
  if (!getJob(db, jobId)) throw new NotFoundError('job', jobId);
  const row = db.insert(events).values({ jobId, at, type, payload }).returning().get();
  return Event.parse(row);
}

// ---------------------------------------------------------------------------
// Searches
// ---------------------------------------------------------------------------

export interface NewSearchRun {
  focus?: string | null;
  sources: string[];
  found: number;
  new: number;
  skipped: number;
}

export function recordSearch(db: Db, input: NewSearchRun, at = nowIso()): SearchRun {
  const row = db
    .insert(searches)
    .values({ ...input, focus: input.focus ?? null, at })
    .returning()
    .get();
  return SearchRun.parse(row);
}

export function listSearches(db: Db, limit = 50): SearchRun[] {
  return db
    .select()
    .from(searches)
    .orderBy(desc(searches.at), desc(searches.id))
    .limit(limit)
    .all()
    .map((row) => SearchRun.parse(row));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface Stats {
  total: number;
  byStatus: Record<JobStatus, number>;
  companies: number;
  /** Applied or beyond (Applied, Responded, Interview, Offer, Rejected). */
  applied: number;
  /** Responded or beyond (Responded, Interview, Offer). Rejected counts as a response too. */
  responded: number;
  followUpsDue: number;
}

export function getStats(db: Db, today = nowIso().slice(0, 10)): Stats {
  const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  const rows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  for (const row of rows) {
    if (row.status in byStatus) byStatus[row.status as JobStatus] = row.count;
  }

  const companies = db
    .select({ count: sql<number>`count(distinct lower(${jobs.company}))` })
    .from(jobs)
    .get();

  const followUpsDue = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        lte(jobs.followUpAt, today),
        sql`${jobs.status} in ('Applied', 'Responded', 'Interview')`,
      ),
    )
    .get();

  const responded = byStatus.Responded + byStatus.Interview + byStatus.Offer + byStatus.Rejected;
  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    companies: companies?.count ?? 0,
    applied: byStatus.Applied + responded,
    responded,
    followUpsDue: followUpsDue?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`No ${kind} with id "${id}"`);
  }
}
