import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Job } from '../schema.js';
import { IN_MEMORY, openDb, type Tracker } from './client.js';
import {
  addArtifact,
  addEvent,
  addNote,
  deleteJob,
  getJob,
  getStats,
  insertJob,
  insertJobs,
  listArtifacts,
  listEvents,
  listJobKeys,
  listJobs,
  listSearches,
  NotFoundError,
  recordSearch,
  setStatus,
  updateJob,
} from './repo.js';

const T0 = '2026-10-22T08:00:00.000Z';
const T1 = '2026-10-23T09:00:00.000Z';

const acme = {
  id: 'acme-backend-engineer-lisbon',
  company: 'Acme',
  role: 'Backend Engineer',
  location: 'Lisbon, Portugal',
  region: 'EU',
  remote: true,
  url: 'https://boards.greenhouse.io/acme/jobs/123',
  source: 'ats' as const,
  score: 4.2,
  why: 'TypeScript services.',
  gaps: 'No PostgreSQL.',
};

const globex = {
  id: 'globex-ai-engineer-london',
  company: 'Globex',
  role: 'AI Engineer',
  location: 'London, UK',
  region: 'UK',
  remote: false,
  url: 'https://jobs.lever.co/globex/abc',
  source: 'bigTech' as const,
  score: 3.1,
  batch: 'b1',
};

let tracker: Tracker;
beforeEach(() => {
  tracker = openDb({ path: IN_MEMORY });
});
afterEach(() => tracker.close());

describe('openDb', () => {
  it('creates the file, its folder and the tables, and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-db-'));
    const path = join(dir, 'nested', 'jobhunt.db');
    const first = openDb({ path });
    insertJob(first.db, acme, T0);
    first.close();

    const second = openDb({ path });
    expect(getJob(second.db, acme.id)?.company).toBe('Acme');
    expect(second.path).toBe(path);
    second.close();
  });
});

describe('jobs', () => {
  it('inserts with defaults and returns a schema-valid row', () => {
    const job = insertJob(tracker.db, acme, T0);
    expect(job).toMatchObject({
      status: 'New',
      visaNote: '',
      applyUrl: null,
      notes: '',
      foundAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(Job.safeParse(getJob(tracker.db, acme.id)).success).toBe(true);
  });

  it('rejects an invalid row before touching the database', () => {
    expect(() => insertJob(tracker.db, { ...acme, id: 'Not A Slug' })).toThrow();
    expect(getJob(tracker.db, 'Not A Slug')).toBeUndefined();
  });

  it('rejects a duplicate id', () => {
    insertJob(tracker.db, acme);
    expect(() => insertJob(tracker.db, acme)).toThrow(/UNIQUE/);
  });

  it('inserts many in one transaction and rolls back on failure', () => {
    expect(() => insertJobs(tracker.db, [globex, { ...acme, url: 'nope' }])).toThrow();
    expect(listJobs(tracker.db)).toHaveLength(0);
    expect(insertJobs(tracker.db, [acme, globex])).toHaveLength(2);
  });

  it('lists by score then found date, and filters', () => {
    insertJobs(tracker.db, [acme, globex], T0);
    setStatus(tracker.db, globex.id, 'Shortlisted', {}, T1);

    expect(listJobs(tracker.db).map((j) => j.id)).toEqual([acme.id, globex.id]);
    expect(listJobs(tracker.db, { status: 'Shortlisted' }).map((j) => j.id)).toEqual([globex.id]);
    expect(listJobs(tracker.db, { status: ['New', 'Shortlisted'] })).toHaveLength(2);
    expect(listJobs(tracker.db, { minScore: 4 }).map((j) => j.id)).toEqual([acme.id]);
    expect(listJobs(tracker.db, { company: 'globex' }).map((j) => j.id)).toEqual([globex.id]);
    expect(listJobs(tracker.db, { remote: true }).map((j) => j.id)).toEqual([acme.id]);
    expect(listJobs(tracker.db, { region: 'UK' }).map((j) => j.id)).toEqual([globex.id]);
    expect(listJobs(tracker.db, { source: 'ats' }).map((j) => j.id)).toEqual([acme.id]);
    expect(listJobs(tracker.db, { batch: 'b1' }).map((j) => j.id)).toEqual([globex.id]);
    expect(listJobs(tracker.db, { limit: 1 })).toHaveLength(1);
  });

  it('exposes dedupe keys', () => {
    insertJobs(tracker.db, [acme, globex]);
    expect(listJobKeys(tracker.db)).toEqual(
      expect.arrayContaining([
        {
          id: acme.id,
          company: 'Acme',
          role: 'Backend Engineer',
          location: acme.location,
          url: acme.url,
        },
      ]),
    );
  });

  it('updates fields and bumps updatedAt', () => {
    insertJob(tracker.db, acme, T0);
    const job = updateJob(tracker.db, acme.id, { score: 5, why: 'Perfect.' }, T1);
    expect(job.score).toBe(5);
    expect(job.updatedAt).toBe(T1);
    expect(job.createdAt).toBe(T0);
    expect(() => updateJob(tracker.db, 'missing', { score: 1 })).toThrow(NotFoundError);
  });

  it('deletes a job and cascades to artifacts and events', () => {
    insertJob(tracker.db, acme);
    addArtifact(tracker.db, { jobId: acme.id, kind: 'pack', path: 'output/acme/pack.md' });
    addNote(tracker.db, acme.id, 'hello');
    expect(deleteJob(tracker.db, acme.id)).toBe(true);
    expect(deleteJob(tracker.db, acme.id)).toBe(false);
    expect(listArtifacts(tracker.db, acme.id)).toEqual([]);
    expect(listEvents(tracker.db, acme.id)).toEqual([]);
  });
});

describe('setStatus', () => {
  it('records an event and stamps appliedAt and followUpAt', () => {
    insertJob(tracker.db, acme, T0);
    const job = setStatus(
      tracker.db,
      acme.id,
      'Applied',
      { note: 'via Greenhouse', followUpAt: '2026-11-02' },
      T1,
    );
    expect(job).toMatchObject({ status: 'Applied', appliedAt: T1, followUpAt: '2026-11-02' });

    const [event] = listEvents(tracker.db, acme.id);
    expect(event).toMatchObject({
      type: 'status_change',
      at: T1,
      payload: { from: 'New', to: 'Applied', note: 'via Greenhouse' },
    });
  });

  it('clears the follow-up on terminal statuses', () => {
    insertJob(tracker.db, acme);
    setStatus(tracker.db, acme.id, 'Applied', { followUpAt: '2026-11-02' });
    expect(setStatus(tracker.db, acme.id, 'Rejected').followUpAt).toBeNull();
    expect(listEvents(tracker.db, acme.id)).toHaveLength(2);
  });

  it('refuses an unknown status or job', () => {
    insertJob(tracker.db, acme);
    expect(() => setStatus(tracker.db, acme.id, 'Ghosted' as never)).toThrow(/Unknown status/);
    expect(() => setStatus(tracker.db, 'missing', 'Applied')).toThrow(NotFoundError);
    expect(listEvents(tracker.db, acme.id)).toEqual([]);
  });
});

describe('notes and events', () => {
  it('appends dated note lines and events', () => {
    insertJob(tracker.db, acme);
    addNote(tracker.db, acme.id, 'Recruiter replied', T0);
    const job = addNote(tracker.db, acme.id, '  Call on Friday ', T1);
    expect(job.notes).toBe('2026-10-22: Recruiter replied\n2026-10-23: Call on Friday');
    expect(listEvents(tracker.db, acme.id).map((e) => e.payload)).toEqual([
      { note: 'Recruiter replied' },
      { note: 'Call on Friday' },
    ]);
    expect(() => addNote(tracker.db, acme.id, '   ')).toThrow(/empty/);
  });

  it('adds arbitrary events in order', () => {
    insertJob(tracker.db, acme);
    addEvent(tracker.db, acme.id, 'follow_up_sent', { channel: 'email' }, T1);
    addEvent(tracker.db, acme.id, 'note', { note: 'earlier' }, T0);
    expect(listEvents(tracker.db, acme.id).map((e) => e.type)).toEqual(['note', 'follow_up_sent']);
    expect(() => addEvent(tracker.db, 'missing', 'note')).toThrow(NotFoundError);
  });
});

describe('artifacts', () => {
  it('stores verify items as JSON and lists newest first', () => {
    insertJob(tracker.db, acme);
    addArtifact(tracker.db, { jobId: acme.id, kind: 'cv_docx', path: 'output/acme/cv.docx' }, T0);
    const pdf = addArtifact(
      tracker.db,
      {
        jobId: acme.id,
        kind: 'cv_pdf',
        path: 'output/acme/cv.pdf',
        verifyItems: ['Led a team of four'],
      },
      T1,
    );
    expect(pdf.verifyItems).toEqual(['Led a team of four']);
    const listed = listArtifacts(tracker.db, acme.id);
    expect(listed.map((a) => a.kind)).toEqual(['cv_pdf', 'cv_docx']);
    expect(listed[1]?.verifyItems).toEqual([]);
    expect(() => addArtifact(tracker.db, { jobId: 'x', kind: 'pack', path: 'p' })).toThrow(
      NotFoundError,
    );
  });
});

describe('searches', () => {
  it('records and lists runs newest first', () => {
    recordSearch(
      tracker.db,
      { focus: 'backend', sources: ['ats'], found: 10, new: 6, skipped: 4 },
      T0,
    );
    recordSearch(tracker.db, { sources: ['remote', 'bigTech'], found: 3, new: 3, skipped: 0 }, T1);
    const runs = listSearches(tracker.db);
    expect(runs.map((r) => r.focus)).toEqual([null, 'backend']);
    expect(runs[1]).toMatchObject({ sources: ['ats'], found: 10, new: 6, skipped: 4 });
  });
});

describe('getStats', () => {
  it('counts statuses, companies, applications and due follow-ups', () => {
    insertJobs(tracker.db, [
      acme,
      globex,
      { ...acme, id: 'acme-two', company: 'ACME', url: 'https://acme.example/2' },
      { ...acme, id: 'initech', company: 'Initech', url: 'https://initech.example/1' },
    ]);
    setStatus(tracker.db, acme.id, 'Applied', { followUpAt: '2026-10-30' });
    setStatus(tracker.db, globex.id, 'Applied', { followUpAt: '2026-11-15' });
    setStatus(tracker.db, globex.id, 'Responded');
    setStatus(tracker.db, 'initech', 'Skipped');

    const stats = getStats(tracker.db, '2026-10-30');
    expect(stats.total).toBe(4);
    expect(stats.companies).toBe(3);
    expect(stats.byStatus).toMatchObject({ New: 1, Applied: 1, Responded: 1, Skipped: 1 });
    expect(stats.applied).toBe(2);
    expect(stats.responded).toBe(1);
    expect(stats.followUpsDue).toBe(1);
  });

  it('is all zeros on an empty tracker', () => {
    const stats = getStats(tracker.db);
    expect(stats.total).toBe(0);
    expect(stats.companies).toBe(0);
    expect(stats.followUpsDue).toBe(0);
  });
});
