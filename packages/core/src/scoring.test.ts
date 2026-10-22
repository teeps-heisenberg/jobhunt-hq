import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadProfile, loadRules } from './config.js';
import { Profile, Rules } from './schema.js';
import { assessLocation, findBlockers, parseMoney, scoreJob, type ScoreInput } from './scoring.js';

const profile = Profile.parse({
  name: 'Sam Rivera',
  contact: { email: 'sam@example.com', location: 'Lisbon, Portugal' },
  citizenship: ['Portugal'],
  yearsExperience: 3,
  languages: [
    { name: 'English', level: 'fluent' },
    { name: 'Portuguese', level: 'native' },
    { name: 'German', level: 'basic' },
  ],
  targetTitles: ['Full Stack Engineer'],
});

const rawRules = {
  locations: {
    remoteFrom: ['Portugal', 'EU'],
    relocate: ['London', 'Dublin', 'Amsterdam', 'Berlin', 'Toronto'],
    exclude: ['India'],
  },
  visa: {
    needsSponsorshipOutside: ['EU'],
    skipIf: ['citizenship required', 'security clearance', 'national of'],
  },
  experience: { maxYearsBar: 4 },
  hardBlockers: { languagesRequired: ['German', 'French'] },
  recencyDays: 60,
  salary: { remote: 'USD 2,500-3,500/month', London: 'GBP 45-55K', Dublin: 'EUR 50-60K' },
  style: {},
};
const rules = Rules.parse(rawRules);

const skills = ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker', 'Python'];

const base: ScoreInput['job'] = {
  company: 'Acme',
  role: 'Full Stack Engineer',
  location: 'Remote - EU',
  remote: true,
  visaNote: '',
  postedAt: '2026-10-20',
  minYears: 3,
  keyRequirements: ['TypeScript', 'React', 'PostgreSQL'],
};

const TODAY = '2026-10-22';

function score(job: Partial<ScoreInput['job']>, overrides: Partial<ScoreInput> = {}) {
  return scoreJob({
    job: { ...base, ...job },
    profile,
    rules,
    candidateSkills: skills,
    today: TODAY,
    ...overrides,
  });
}

describe('assessLocation', () => {
  it.each([
    [{ location: 'Remote - EU', remote: true }, 'remote', false],
    [{ location: 'Remote', remote: true }, 'remote', false],
    [{ location: 'Lisbon, Portugal', remote: false }, 'unknown', false],
    [{ location: 'London, UK', remote: false }, 'relocate', true],
    [{ location: 'Dublin, Ireland', remote: false }, 'relocate', false],
    [{ location: 'Berlin', remote: false }, 'relocate', false],
    [{ location: 'Toronto, Canada', remote: false }, 'relocate', true],
    [{ location: 'Remote - US only', remote: true }, 'unknown', false],
    [{ location: 'Bangalore, India', remote: false }, 'excluded', false],
    [{ location: 'Remote - India', remote: true }, 'excluded', false],
    [{ location: 'Tokyo, Japan', remote: false }, 'unknown', true],
  ] as const)('%o -> %s (sponsorship %s)', (job, fit, sponsorship) => {
    const a = assessLocation({ ...job }, profile, rules);
    expect(a.fit).toBe(fit);
    expect(a.needsSponsorship).toBe(sponsorship);
  });
});

describe('findBlockers', () => {
  const blockers = (job: Partial<ScoreInput['job']>) =>
    findBlockers({
      job: { ...base, ...job },
      profile,
      rules,
      candidateSkills: skills,
      today: TODAY,
    });

  it('is empty for a clean posting', () => {
    expect(blockers({})).toEqual([]);
  });

  it('blocks a years bar above the rules', () => {
    expect(blockers({ minYears: 5 })).toEqual([
      'asks for 5+ years, rules.experience.maxYearsBar is 4',
    ]);
    expect(blockers({ minYears: 4 })).toEqual([]);
  });

  it('blocks clearance and citizenship requirements', () => {
    expect(blockers({ keyRequirements: ['Active security clearance required'] })[0]).toMatch(
      /clearance/,
    );
    expect(blockers({ keyRequirements: ['Must be a US citizen'] })[0]).toMatch(/citizenship/);
    expect(blockers({ visaNote: 'National of a Five Eyes country' })[0]).toMatch(/citizenship/);
    expect(
      blockers({
        visaNote: 'Must be authorized to work in the United States without sponsorship',
      })[0],
    ).toMatch(/citizenship/);
  });

  it('does not block a citizenship rule the user satisfies', () => {
    expect(blockers({ visaNote: 'EU citizens only, no sponsorship' })).toEqual([]);
    expect(blockers({ visaNote: 'Must have the right to work in Portugal' })).toEqual([]);
  });

  it('blocks a work-authorisation rule for a relocation hub where sponsorship is needed', () => {
    expect(
      blockers({
        location: 'London, UK',
        remote: false,
        visaNote: 'Must have the right to work in the UK, no sponsorship',
      }),
    ).toEqual([
      'citizenship or work authorisation: "Must have the right to work in the UK, no sponsorship"',
    ]);
  });

  it('blocks a required language the user lacks, but not one they have', () => {
    expect(blockers({ keyRequirements: ['Fluent German required'] })).toEqual([
      'requires German: "Fluent German required"',
    ]);
    expect(blockers({ keyRequirements: ['German is a plus'] })).toEqual([]);
    expect(blockers({ keyRequirements: ['Fluent English required'] })).toEqual([]);
  });

  it('blocks excluded locations', () => {
    expect(blockers({ location: 'Hyderabad, India', remote: false })).toEqual([
      'location excluded by rules: Hyderabad, India',
    ]);
  });

  it('lists several blockers at once, without duplicates', () => {
    const result = blockers({
      minYears: 8,
      keyRequirements: ['TS/SCI clearance', 'TS/SCI clearance'],
    });
    expect(result).toHaveLength(2);
  });
});

describe('parseMoney', () => {
  it.each([
    ['EUR 50-60K', { currency: 'EUR', min: 50_000, max: 60_000 }],
    ['GBP 45-55K', { currency: 'GBP', min: 45_000, max: 55_000 }],
    ['$120,000 - $150,000 per year', { currency: 'USD', min: 120_000, max: 150_000 }],
    ['USD 2,500-3,500/month', { currency: 'USD', min: 30_000, max: 42_000 }],
    ['€65k', { currency: 'EUR', min: 65_000, max: 65_000 }],
    ['Competitive', undefined],
    [undefined, undefined],
  ])('%s', (text, expected) => {
    expect(parseMoney(text)).toEqual(expected);
  });
});

describe('scoreJob', () => {
  it('scores a strong remote match as Shortlisted with all factors explained', () => {
    const result = score({});
    expect(result.status).toBe('Shortlisted');
    expect(result.blockers).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.factors.skills).toEqual({ value: 1, note: 'all 3 requirements matched' });
    expect(result.factors.years.value).toBe(1);
    expect(result.factors.location.value).toBe(1);
    expect(result.factors.recency.value).toBe(1);
    expect(result.factors.salary.note).toBe('no salary stated');
    expect(result.needsSponsorship).toBe(false);
  });

  it('returns 0 and Skipped when a blocker is present, whatever the factors say', () => {
    const result = score({ keyRequirements: ['TypeScript', 'Security clearance required'] });
    expect(result).toMatchObject({ score: 0, status: 'Skipped' });
    expect(result.blockers).toHaveLength(1);
  });

  it('lowers the score for missing skills and a years gap, and names them', () => {
    const result = score({ keyRequirements: ['Rust', 'Kubernetes', 'TypeScript'], minYears: 4 });
    expect(result.factors.skills.value).toBeCloseTo(1 / 3);
    expect(result.factors.skills.note).toBe('1/3 matched; missing: Rust, Kubernetes');
    expect(result.factors.years.value).toBeCloseTo(0.75);
    expect(result.status).toBe('New');
    expect(result.score).toBeLessThan(4);
  });

  it('decays recency inside the window and floors it outside', () => {
    expect(score({ postedAt: '2026-09-20' }).factors.recency.value).toBeLessThan(1);
    expect(score({ postedAt: '2026-09-20' }).factors.recency.value).toBeGreaterThan(0.4);
    expect(score({ postedAt: '2026-06-01' }).factors.recency.value).toBe(0.1);
    expect(score({ postedAt: undefined }).factors.recency.value).toBe(0.5);
  });

  it('compares salary with the band for the location', () => {
    expect(score({ salaryText: 'USD 3,000-4,000/month' }).factors.salary.value).toBe(1);
    expect(score({ salaryText: 'USD 1,000-1,500/month' }).factors.salary.value).toBe(0.15);
    const london = score({ location: 'London, UK', remote: false, salaryText: 'GBP 40-48K' });
    expect(london.factors.salary.value).toBe(0.85);
    expect(london.needsSponsorship).toBe(true);
    expect(london.visaNote).toMatch(/needs visa sponsorship/);
    expect(
      score({ location: 'Dublin', remote: false, salaryText: '$90k' }).factors.salary.note,
    ).toMatch(/salary in USD, your band is in EUR/);
  });

  it('keeps a user-supplied visa note', () => {
    expect(score({ visaNote: 'Sponsorship available' }).visaNote).toBe('Sponsorship available');
  });

  it('respects a custom shortlist threshold and weights', () => {
    const strict = Rules.parse({
      ...rawRules,
      scoring: {
        weights: { skills: 1, years: 0, location: 0, recency: 0, salary: 0 },
        shortlistAt: 4.9,
      },
    });
    const result = score({ keyRequirements: ['TypeScript', 'Rust'] }, { rules: strict });
    expect(result.score).toBe(2.5);
    expect(result.status).toBe('New');
  });

  it('works with the shipped example config', () => {
    const dir = join(import.meta.dirname, '../../../config');
    const result = scoreJob({
      job: base,
      profile: loadProfile(join(dir, 'profile.example.yaml')),
      rules: loadRules(join(dir, 'rules.example.yaml')),
      candidateSkills: skills,
      today: TODAY,
    });
    expect(result.status).toBe('Shortlisted');
  });
});
