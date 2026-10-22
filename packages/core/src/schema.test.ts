import { describe, expect, it } from 'vitest';

import {
  Artifact,
  Event,
  JOB_STATUSES,
  Job,
  JobInput,
  JobStatus,
  Profile,
  Rules,
  ScoringWeights,
  ScoutOutput,
  SearchRun,
  Slug,
} from './schema.js';

const scoutRow = {
  company: 'Acme',
  role: 'Backend Engineer',
  location: 'Lisbon, Portugal',
  region: 'EU',
  remote: true,
  visaNote: 'EU citizens only, no sponsorship',
  url: 'https://boards.greenhouse.io/acme/jobs/123',
  applyUrl: 'https://boards.greenhouse.io/acme/jobs/123#app',
  postedAt: '2026-10-20',
  minYears: 3,
  keyRequirements: ['TypeScript', 'PostgreSQL'],
  why: 'Three years of TypeScript services.',
  gap: 'No PostgreSQL in production.',
  suggestedScore: 4,
  source: 'ats',
};

describe('JobStatus', () => {
  it('covers the kanban columns in order', () => {
    expect(JOB_STATUSES).toEqual([
      'New',
      'Shortlisted',
      'Applied',
      'Responded',
      'Interview',
      'Offer',
      'Rejected',
      'Skipped',
    ]);
    expect(JobStatus.safeParse('Ghosted').success).toBe(false);
  });
});

describe('Slug', () => {
  it.each(['acme-backend-engineer', 'a1', 'x-9-y'])('accepts %s', (s) => {
    expect(Slug.safeParse(s).success).toBe(true);
  });
  it.each(['Acme', 'acme_backend', '-acme', 'acme--x', '', 'acme engineer'])('rejects %j', (s) => {
    expect(Slug.safeParse(s).success).toBe(false);
  });
});

describe('JobInput (scout row)', () => {
  it('accepts a full scout row', () => {
    const parsed = JobInput.parse(scoutRow);
    expect(parsed.source).toBe('ats');
    expect(parsed.suggestedScore).toBe(4);
  });

  it('fills defaults for a minimal manual row', () => {
    const parsed = JobInput.parse({
      company: 'Acme',
      role: 'Engineer',
      location: 'Remote',
      url: 'https://acme.example/jobs/1',
    });
    expect(parsed).toMatchObject({
      remote: false,
      visaNote: '',
      keyRequirements: [],
      why: '',
      gap: '',
      source: 'manual',
    });
  });

  it('rejects a non-URL, an out-of-range score and an unknown source', () => {
    expect(JobInput.safeParse({ ...scoutRow, url: 'boards.greenhouse.io/acme' }).success).toBe(
      false,
    );
    expect(JobInput.safeParse({ ...scoutRow, suggestedScore: 6 }).success).toBe(false);
    expect(JobInput.safeParse({ ...scoutRow, source: 'linkedin' }).success).toBe(false);
  });

  it('parses a whole scout output with rejections', () => {
    const out = ScoutOutput.parse({
      jobs: [scoutRow],
      rejected: [{ title: 'Acme Staff Engineer', reason: 'asks for 8 years' }],
    });
    expect(out.jobs).toHaveLength(1);
    expect(out.rejected[0]?.reason).toBe('asks for 8 years');
  });
});

describe('Job (tracked row)', () => {
  const job = {
    id: 'acme-backend-engineer-lisbon',
    company: 'Acme',
    role: 'Backend Engineer',
    location: 'Lisbon, Portugal',
    region: 'EU',
    remote: true,
    visaNote: '',
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    applyUrl: null,
    salaryText: null,
    score: 4.2,
    status: 'Shortlisted',
    foundAt: '2026-10-22T08:00:00Z',
    postedAt: '2026-10-20',
    why: 'TypeScript services.',
    gaps: 'No PostgreSQL.',
    source: 'ats',
    batch: '2026-10-22-ats',
    appliedAt: null,
    followUpAt: null,
    notes: '',
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:00Z',
  };

  it('accepts a valid row', () => {
    expect(Job.parse(job).status).toBe('Shortlisted');
  });

  it('rejects a bad id, a bad date and a missing status', () => {
    expect(Job.safeParse({ ...job, id: 'Acme Job' }).success).toBe(false);
    expect(Job.safeParse({ ...job, foundAt: '22/10/2026' }).success).toBe(false);
    const { status: _status, ...noStatus } = job;
    expect(Job.safeParse(noStatus).success).toBe(false);
  });
});

describe('Artifact, Event, SearchRun', () => {
  it('validate their rows', () => {
    expect(
      Artifact.parse({
        id: 1,
        jobId: 'acme-backend-engineer-lisbon',
        kind: 'cv_pdf',
        path: 'output/acme/backend-engineer/cv.pdf',
        createdAt: '2026-10-22T09:00:00Z',
        verifyItems: ['Led a team of four'],
      }).kind,
    ).toBe('cv_pdf');

    expect(
      Event.parse({
        id: 1,
        jobId: 'acme-backend-engineer-lisbon',
        at: '2026-10-22T09:00:00Z',
        type: 'status_change',
        payload: { from: 'New', to: 'Shortlisted' },
      }).payload,
    ).toEqual({ from: 'New', to: 'Shortlisted' });

    expect(
      SearchRun.parse({
        id: 1,
        at: '2026-10-22T09:00:00Z',
        focus: 'backend',
        sources: ['ats', 'remote'],
        found: 12,
        new: 7,
        skipped: 5,
      }).new,
    ).toBe(7);
  });

  it('reject unknown kinds and types', () => {
    const artifact = {
      id: 1,
      jobId: 'a',
      kind: 'resume',
      path: 'x',
      createdAt: '2026-01-01',
      verifyItems: [],
    };
    expect(Artifact.safeParse(artifact).success).toBe(false);
    const event = { id: 1, jobId: 'a', at: '2026-01-01', type: 'email', payload: {} };
    expect(Event.safeParse(event).success).toBe(false);
  });
});

describe('Profile', () => {
  const profile = {
    name: 'Sam Rivera',
    contact: { email: 'sam@example.com', location: 'Lisbon, Portugal' },
    citizenship: ['Portugal'],
    yearsExperience: 3,
    targetTitles: ['Full Stack Engineer'],
  };

  it('accepts a minimal profile and fills defaults', () => {
    const parsed = Profile.parse(profile);
    expect(parsed.languages).toEqual([]);
    expect(parsed.neverClaim).toEqual([]);
    expect(parsed.contact.links).toEqual([]);
  });

  it('rejects a bad email, an empty citizenship list and an unknown language level', () => {
    const badEmail = { ...profile, contact: { ...profile.contact, email: 'sam' } };
    expect(Profile.safeParse(badEmail).success).toBe(false);
    expect(Profile.safeParse({ ...profile, citizenship: [] }).success).toBe(false);
    const badLevel = { ...profile, languages: [{ name: 'German', level: 'ok' }] };
    expect(Profile.safeParse(badLevel).success).toBe(false);
  });
});

describe('Rules', () => {
  const minimal = {
    locations: { remoteFrom: ['Portugal'] },
    experience: { maxYearsBar: 4 },
    style: {},
  };

  it('fills defaults for a minimal rules file', () => {
    const rules = Rules.parse(minimal);
    expect(rules.recencyDays).toBe(60);
    expect(rules.style.maxPages).toBe(2);
    expect(rules.style.bannedCharacters).toEqual(['—']);
    expect(rules.caps.dailyApplications).toBe(10);
    expect(rules.sources.ats).toContain('greenhouse');
    expect(rules.scoring.weights.skills).toBe(0.4);
    expect(rules.followUpDays).toBe(10);
  });

  it('keeps per-company caps alongside the daily cap', () => {
    const rules = Rules.parse({ ...minimal, caps: { google: { applications: 3, perDays: 30 } } });
    expect(rules.caps.perCompany['google']).toEqual({ applications: 3, perDays: 30 });
    expect(rules.caps.dailyApplications).toBe(10);
  });

  it('rejects a per-company cap that is a bare number and a non-numeric daily cap', () => {
    expect(Rules.safeParse({ ...minimal, caps: { google: 3 } }).success).toBe(false);
    const bad = { ...minimal, caps: { dailyApplications: { applications: 1, perDays: 1 } } };
    expect(Rules.safeParse(bad).success).toBe(false);
  });

  it('rejects weights that do not add up to 1', () => {
    const half = { skills: 0.5, years: 0.5, location: 0.5, recency: 0, salary: 0 };
    expect(ScoringWeights.safeParse(half).success).toBe(false);
    const double = { skills: 1, years: 1, location: 0, recency: 0, salary: 0 };
    expect(Rules.safeParse({ ...minimal, scoring: { weights: double } }).success).toBe(false);
  });

  it('rejects a missing years bar', () => {
    expect(Rules.safeParse({ locations: {}, style: {} }).success).toBe(false);
  });
});
