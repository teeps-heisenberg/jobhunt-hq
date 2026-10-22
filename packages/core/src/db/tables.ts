/**
 * Drizzle table definitions for the tracker (SPEC section 5).
 * Column names are snake_case in SQLite; TypeScript keys match the zod schemas in ../schema.ts.
 * Dates are ISO 8601 text. JSON columns are stored as text.
 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    company: text('company').notNull(),
    role: text('role').notNull(),
    location: text('location').notNull(),
    region: text('region'),
    remote: integer('remote', { mode: 'boolean' }).notNull().default(false),
    visaNote: text('visa_note').notNull().default(''),
    url: text('url').notNull(),
    applyUrl: text('apply_url'),
    salaryText: text('salary_text'),
    score: real('score').notNull().default(0),
    status: text('status').notNull().default('New'),
    foundAt: text('found_at').notNull(),
    postedAt: text('posted_at'),
    why: text('why').notNull().default(''),
    gaps: text('gaps').notNull().default(''),
    source: text('source').notNull().default('manual'),
    batch: text('batch'),
    appliedAt: text('applied_at'),
    followUpAt: text('follow_up_at'),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('jobs_status_idx').on(t.status),
    index('jobs_company_idx').on(t.company),
    index('jobs_url_idx').on(t.url),
    index('jobs_follow_up_idx').on(t.followUpAt),
  ],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    path: text('path').notNull(),
    createdAt: text('created_at').notNull(),
    verifyItems: text('verify_items', { mode: 'json' }).$type<string[]>().notNull().default([]),
  },
  (t) => [index('artifacts_job_idx').on(t.jobId)],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [index('events_job_idx').on(t.jobId)],
);

export const searches = sqliteTable('searches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  focus: text('focus'),
  sources: text('sources', { mode: 'json' }).$type<string[]>().notNull().default([]),
  found: integer('found_count').notNull().default(0),
  new: integer('new_count').notNull().default(0),
  skipped: integer('skipped_count').notNull().default(0),
});

export const tables = { jobs, artifacts, events, searches };
