import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildApplyPlan, isForbidden, matchField, NEVER_PATTERNS } from './apply.js';
import { loadProfile, loadRules } from './config.js';

const dir = join(import.meta.dirname, '../../../config');
const profile = loadProfile(join(dir, 'profile.example.yaml'));
const rules = loadRules(join(dir, 'rules.example.yaml'));

const job = {
  id: 'acme-full-stack-engineer-eu',
  company: 'Acme',
  role: 'Full Stack Engineer',
  location: 'Remote - EU',
  region: 'EU',
  remote: true,
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  applyUrl: 'https://boards.greenhouse.io/acme/jobs/1#app',
};

describe('buildApplyPlan', () => {
  const plan = buildApplyPlan({
    job,
    profile,
    rules,
    coverNote: ['Para one.', 'Para two.'],
    screening: [{ question: 'Why Acme?', answer: 'Because of the scheduling product.' }],
    cvPath: 'output/acme/full-stack-engineer/cv.pdf',
  });
  const byKey = Object.fromEntries(plan.fields.map((f) => [f.key, f]));

  it('maps profile facts to fields with sources', () => {
    expect(plan.applyUrl).toBe(job.applyUrl);
    expect(byKey['firstName']).toMatchObject({ value: 'Sam', source: 'profile.name' });
    expect(byKey['lastName']).toMatchObject({ value: 'Rivera' });
    expect(byKey['email']).toMatchObject({ value: 'sam@example.com', kind: 'email' });
    expect(byKey['phone']).toMatchObject({ value: '+1 555 0100', kind: 'tel' });
    expect(byKey['linkedin']?.value).toBe('https://linkedin.com/in/samrivera');
    expect(byKey['github']?.value).toBe('https://github.com/samrivera');
    expect(byKey['website']).toBeUndefined();
  });

  it('adds screening answers from the rules and the pack', () => {
    expect(byKey['years']).toMatchObject({ value: '3', source: 'profile.yearsExperience' });
    expect(byKey['salary']).toMatchObject({
      value: 'USD 2,500-3,500/month, flexible',
      source: 'rules.salary.remote',
    });
    expect(byKey['notice']).toMatchObject({ value: '1 month' });
    expect(byKey['authorisation']?.value).toMatch(/without sponsorship/);
    expect(byKey['screening:Why Acme?']).toMatchObject({
      value: 'Because of the scheduling product.',
      kind: 'textarea',
    });
    expect(byKey['coverLetter']?.value).toBe('Para one.\n\nPara two.');
  });

  it('lists uploads for the human and the never list', () => {
    expect(plan.uploads).toEqual([
      {
        key: 'cv',
        match: ['resume', 'cv', 'curriculum'],
        path: 'output/acme/full-stack-engineer/cv.pdf',
        source: 'artifact cv_pdf',
      },
    ]);
    expect(plan.never).toBe(NEVER_PATTERNS);
    expect(plan.stopBefore).toHaveLength(3);
  });

  it('omits fields the profile does not have', () => {
    const minimal = buildApplyPlan({
      job,
      profile: {
        ...profile,
        contact: { ...profile.contact, links: [] },
        noticePeriod: undefined,
      } as typeof profile,
      rules,
    });
    const keys = minimal.fields.map((f) => f.key);
    expect(keys).not.toContain('linkedin');
    expect(keys).not.toContain('notice');
    expect(keys).not.toContain('coverLetter');
  });
});

describe('matchField and isForbidden', () => {
  const { fields } = buildApplyPlan({ job, profile, rules, coverNote: ['x'] });

  it.each([
    ['First Name *', 'firstName'],
    ['job_application[last_name]', 'lastName'],
    ['Email address', 'email'],
    ['Phone number (optional)', 'phone'],
    ['LinkedIn Profile', 'linkedin'],
    ['Cover Letter', 'coverLetter'],
    ['How many years of experience do you have with TypeScript?', 'years'],
    ['Are you authorized to work in the EU?', 'authorisation'],
    ['Name', 'fullName'],
  ])('%s -> %s', (descriptor, key) => {
    expect(matchField(descriptor, fields)?.key).toBe(key);
  });

  it('returns nothing for unknown fields', () => {
    expect(matchField('Favourite colour', fields)).toBeUndefined();
    expect(matchField('Username', fields)).toBeUndefined();
  });

  it('flags controls the kit must never touch', () => {
    for (const d of [
      'Submit application',
      'I agree to the terms',
      'GDPR consent',
      'Password',
      'Date of birth',
      'National ID number',
      'type=submit',
    ]) {
      expect(isForbidden(d), d).toBe(true);
    }
    expect(isForbidden('First name')).toBe(false);
  });
});
