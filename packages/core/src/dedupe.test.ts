import { describe, expect, it } from 'vitest';

import {
  dedupeJobs,
  extractAtsRef,
  findDuplicate,
  findRegionalVariants,
  type JobKey,
  makeJobId,
  normalizeCompany,
  normalizeLocation,
  normalizeTitle,
  normalizeUrl,
  sameLocation,
  titleSimilarity,
} from './dedupe.js';

describe('normalizeCompany', () => {
  it.each([
    ['Acme, Inc.', 'acme'],
    ['ACME Inc', 'acme'],
    ['Globex GmbH', 'globex'],
    ['Initech Technologies Ltd.', 'initech'],
    ['Umbrella Corp (Europe)', 'umbrella'],
    ['Stark & Wayne LLC', 'stark and wayne'],
    ['Société Générale', 'societe generale'],
    ['SE', 'se'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeCompany(input)).toBe(expected);
  });
});

describe('normalizeTitle', () => {
  it.each([
    ['Backend Engineer', 'back end engineer'],
    ['Sr. Backend Developer (Remote) - EMEA, Job ID 12345', 'senior back end engineer'],
    ['Software Engineer, Backend (m/f/d)', 'software engineer back end'],
    ['Full-Stack Engineer | Remote - US', 'full stack engineer'],
    ['Senior Software Engineer - Payments', 'senior software engineer payments'],
    ['AI Engineer #4521', 'ai engineer'],
    ['Software Engineer II (JR-203948)', 'software engineer ii'],
    ['Machine Learning Engineer [Remote]', 'machine learning engineer'],
    ['Fullstack Developer – Lisbon Hub', 'full stack engineer lisbon hub'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it('keeps seniority apart', () => {
    expect(normalizeTitle('Senior Backend Engineer')).not.toBe(
      normalizeTitle('Junior Backend Engineer'),
    );
  });
});

describe('locations', () => {
  it.each([
    ['Lisbon, Portugal (Remote)', 'lisbon portugal'],
    ['Remote - EU', 'eu'],
    ['Remote', 'remote'],
    ['Anywhere', 'remote'],
    ['Greater London Area, UK', 'london uk'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeLocation(input)).toBe(expected);
  });

  it('matches a city against city-plus-country and remote against remote', () => {
    expect(sameLocation('Lisbon', 'Lisbon, Portugal')).toBe(true);
    expect(sameLocation('Remote', 'Remote (Anywhere)')).toBe(true);
    expect(sameLocation('Lisbon, Portugal', 'Porto, Portugal')).toBe(false);
    expect(sameLocation('Remote', 'Lisbon, Portugal')).toBe(false);
    expect(sameLocation('Remote - EU', 'Remote - US')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('drops tracking, fragments, trailing slashes and the apply suffix', () => {
    expect(normalizeUrl('https://WWW.Acme.com/careers/123/?utm_source=x&gh_src=abc#top')).toBe(
      'https://acme.com/careers/123',
    );
    expect(normalizeUrl('https://jobs.lever.co/acme/uuid-1/apply')).toBe(
      'https://jobs.lever.co/acme/uuid-1',
    );
    expect(normalizeUrl('https://acme.com/jobs?b=2&a=1')).toBe('https://acme.com/jobs?a=1&b=2');
  });

  it('keeps meaningful query params such as gh_jid', () => {
    expect(normalizeUrl('https://acme.com/careers?gh_jid=555&utm_medium=email')).toBe(
      'https://acme.com/careers?gh_jid=555',
    );
  });

  it('falls back to a lowercased string for junk', () => {
    expect(normalizeUrl(' Not A Url ')).toBe('not a url');
  });
});

describe('extractAtsRef', () => {
  it.each([
    [
      'https://boards.greenhouse.io/acme/jobs/4567890',
      { ats: 'greenhouse', board: 'acme', id: '4567890' },
    ],
    [
      'https://job-boards.greenhouse.io/acme/jobs/4567890?gh_src=x',
      { ats: 'greenhouse', board: 'acme', id: '4567890' },
    ],
    ['https://acme.com/careers/open?gh_jid=4567890', { ats: 'greenhouse', id: '4567890' }],
    [
      'https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb-cccc-123456789abc/apply',
      { ats: 'lever', board: 'acme', id: '0f1e2d3c-aaaa-bbbb-cccc-123456789abc' },
    ],
    [
      'https://jobs.ashbyhq.com/Acme/9a8b7c6d-1111-2222-3333-444455556666',
      { ats: 'ashby', board: 'acme', id: '9a8b7c6d-1111-2222-3333-444455556666' },
    ],
    [
      'https://apply.workable.com/acme/j/AB12CD34EF/',
      { ats: 'workable', board: 'acme', id: 'AB12CD34EF' },
    ],
    [
      'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Lisbon/Backend-Engineer_JR-203948',
      { ats: 'workday', board: 'acme', id: 'JR-203948' },
    ],
    [
      'https://jobs.smartrecruiters.com/Acme/743999912345678-backend-engineer',
      { ats: 'smartrecruiters', board: 'acme', id: '743999912345678' },
    ],
  ])('parses %s', (url, expected) => {
    expect(extractAtsRef(url)).toEqual(expected);
  });

  it('returns undefined for unknown careers pages and junk', () => {
    expect(extractAtsRef('https://acme.com/careers/backend-engineer')).toBeUndefined();
    expect(extractAtsRef('nope')).toBeUndefined();
  });
});

describe('titleSimilarity', () => {
  it('is 1 for normalised equals and high for small wording changes', () => {
    expect(titleSimilarity('Backend Engineer', 'Back-End Developer')).toBe(1);
    expect(
      titleSimilarity('Senior Backend Engineer', 'Senior Backend Engineer, Platform'),
    ).toBeGreaterThan(0.85);
    expect(titleSimilarity('Backend Engineer', 'Product Designer')).toBeLessThan(0.5);
    expect(titleSimilarity('Senior Backend Engineer', 'Backend Engineer')).toBe(0);
    expect(titleSimilarity('Software Engineer II', 'Software Engineer III')).toBe(0);
  });
});

const tracked: JobKey[] = [
  {
    id: 'acme-back-end-engineer-lisbon',
    company: 'Acme, Inc.',
    role: 'Backend Engineer',
    location: 'Lisbon, Portugal',
    url: 'https://boards.greenhouse.io/acme/jobs/111',
  },
  {
    id: 'acme-back-end-engineer-remote',
    company: 'Acme',
    role: 'Backend Engineer (Remote - EU)',
    location: 'Remote - EU',
    url: 'https://boards.greenhouse.io/acme/jobs/222',
  },
  {
    id: 'globex-ai-engineer-london',
    company: 'Globex GmbH',
    role: 'AI Engineer',
    location: 'London, UK',
    url: 'https://globex.com/careers/ai-engineer',
  },
];

describe('findDuplicate', () => {
  it('matches the same Greenhouse id reached through a different URL', () => {
    const match = findDuplicate(
      {
        company: 'ACME Incorporated',
        role: 'Totally Different Title',
        location: 'Mars',
        url: 'https://acme.com/careers?gh_jid=111',
      },
      tracked,
    );
    expect(match).toEqual({
      existingId: 'acme-back-end-engineer-lisbon',
      reason: 'ats-id',
      similarity: 1,
    });
  });

  it('matches the apply URL as well as the posting URL', () => {
    const match = findDuplicate(
      {
        company: 'Globex',
        role: 'Something',
        location: 'Berlin',
        url: 'https://linkedin.example/view/1',
        applyUrl: 'https://www.globex.com/careers/ai-engineer/?utm_source=li',
      },
      tracked,
    );
    expect(match?.reason).toBe('url');
    expect(match?.existingId).toBe('globex-ai-engineer-london');
  });

  it('catches a repost: new id, same company, title and city', () => {
    const match = findDuplicate(
      {
        company: 'Acme Inc',
        role: 'Back End Developer',
        location: 'Lisbon',
        url: 'https://boards.greenhouse.io/acme/jobs/333',
      },
      tracked,
    );
    expect(match).toEqual({
      existingId: 'acme-back-end-engineer-lisbon',
      reason: 'exact',
      similarity: 1,
    });
  });

  it('catches a repost with small wording changes via fuzzy title', () => {
    const match = findDuplicate(
      {
        company: 'Acme',
        role: 'Backend Software Engineer',
        location: 'Lisbon, Portugal',
        url: 'https://boards.greenhouse.io/acme/jobs/444',
      },
      tracked,
    );
    expect(match?.reason).toBe('fuzzy-title');
    expect(match?.existingId).toBe('acme-back-end-engineer-lisbon');
    expect(match?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('does not merge a different seniority in the same team', () => {
    const match = findDuplicate(
      {
        company: 'Acme',
        role: 'Senior Backend Engineer',
        location: 'Lisbon, Portugal',
        url: 'https://boards.greenhouse.io/acme/jobs/555',
      },
      tracked,
    );
    expect(match).toBeUndefined();
  });

  it('does not merge the same role in another region: that is a variant', () => {
    const porto = {
      company: 'Acme',
      role: 'Backend Engineer',
      location: 'Porto, Portugal',
      url: 'https://boards.greenhouse.io/acme/jobs/666',
    };
    expect(findDuplicate(porto, tracked)).toBeUndefined();
    expect(findRegionalVariants(porto, tracked).map((v) => v.existingId)).toEqual([
      'acme-back-end-engineer-lisbon',
      'acme-back-end-engineer-remote',
    ]);
  });

  it('respects a stricter fuzzy threshold', () => {
    const candidate = {
      company: 'Acme',
      role: 'Backend Software Engineer',
      location: 'Lisbon, Portugal',
      url: 'https://boards.greenhouse.io/acme/jobs/444',
    };
    expect(findDuplicate(candidate, tracked, { fuzzyThreshold: 0.99 })).toBeUndefined();
  });
});

describe('dedupeJobs', () => {
  it('splits a batch against the tracker and against itself', () => {
    const batch = [
      {
        company: 'Acme',
        role: 'Backend Engineer',
        location: 'Lisbon',
        url: 'https://boards.greenhouse.io/acme/jobs/111',
      },
      {
        company: 'Initech',
        role: 'Platform Engineer',
        location: 'Remote',
        url: 'https://jobs.lever.co/initech/aaa',
      },
      {
        company: 'Initech Ltd',
        role: 'Platform Engineer (Remote)',
        location: 'Remote (Anywhere)',
        url: 'https://jobs.lever.co/initech/bbb',
      },
      {
        company: 'Globex',
        role: 'AI Engineer',
        location: 'Berlin, Germany',
        url: 'https://globex.com/careers/ai-engineer-berlin',
      },
    ];
    const result = dedupeJobs(batch, tracked);

    expect(result.unique.map((j) => j.url)).toEqual([
      'https://jobs.lever.co/initech/aaa',
      'https://globex.com/careers/ai-engineer-berlin',
    ]);
    expect(
      result.duplicates.map((d) => [d.candidate.url, d.match.reason, d.match.existingId]),
    ).toEqual([
      ['https://boards.greenhouse.io/acme/jobs/111', 'ats-id', 'acme-back-end-engineer-lisbon'],
      ['https://jobs.lever.co/initech/bbb', 'exact', 'batch:1'],
    ]);
    expect(result.variants).toEqual([
      {
        candidate: batch[3],
        variants: [{ existingId: 'globex-ai-engineer-london', existingLocation: 'London, UK' }],
      },
    ]);
  });
});

describe('makeJobId', () => {
  it('builds company-title-city slugs and avoids collisions', () => {
    const job = {
      company: 'Acme, Inc.',
      role: 'Sr. Backend Developer (Remote)',
      location: 'Lisbon, Portugal',
    };
    expect(makeJobId(job)).toBe('acme-senior-back-end-engineer-lisbon');
    expect(makeJobId(job, ['acme-senior-back-end-engineer-lisbon'])).toBe(
      'acme-senior-back-end-engineer-lisbon-2',
    );
    expect(
      makeJobId(job, [
        'acme-senior-back-end-engineer-lisbon',
        'acme-senior-back-end-engineer-lisbon-2',
      ]),
    ).toBe('acme-senior-back-end-engineer-lisbon-3');
  });

  it('uses remote as the city for remote roles and never returns an empty id', () => {
    expect(makeJobId({ company: 'Globex', role: 'AI Engineer', location: 'Remote - EU' })).toBe(
      'globex-ai-engineer-eu',
    );
    expect(makeJobId({ company: 'Globex', role: 'AI Engineer', location: 'Remote' })).toBe(
      'globex-ai-engineer-remote',
    );
    expect(makeJobId({ company: '???', role: '!!!', location: '' })).toBe('remote');
  });
});
