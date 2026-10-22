import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadProfile, loadRules } from './config.js';
import { Profile } from './schema.js';
import { standardScreening } from './screening.js';

const dir = join(import.meta.dirname, '../../../config');
const profile = loadProfile(join(dir, 'profile.example.yaml'));
const rules = loadRules(join(dir, 'rules.example.yaml'));

describe('standardScreening', () => {
  it('answers years, salary for the location band, notice and authorisation', () => {
    const answers = standardScreening(
      { location: 'London, UK', region: 'UK', remote: false },
      profile,
      rules,
    );
    expect(answers).toEqual([
      {
        question: 'Years of professional experience',
        answer: '3',
        source: 'profile.yearsExperience',
      },
      {
        question: 'Salary expectation',
        answer: 'GBP 45-55K, flexible',
        source: 'rules.salary.London',
      },
      { question: 'Notice period', answer: '1 month', source: 'profile.noticePeriod' },
      {
        question: 'Work authorisation',
        answer: 'Needs visa sponsorship for London, UK; can work without sponsorship in Portugal',
        source: 'profile.citizenship, rules.visa',
      },
    ]);
  });

  it('uses the remote band for remote roles and the profile target when no band matches', () => {
    expect(
      standardScreening({ location: 'Remote - EU', region: null, remote: true }, profile, rules)[1],
    ).toEqual({
      question: 'Salary expectation',
      answer: 'USD 2,500-3,500/month, flexible',
      source: 'rules.salary.remote',
    });
    const withTarget = Profile.parse({ ...profile, targetSalary: 'EUR 55K' });
    const tokyo = standardScreening(
      { location: 'Tokyo, Japan', region: null, remote: false },
      withTarget,
      rules,
    );
    expect(tokyo[1]).toEqual({
      question: 'Salary expectation',
      answer: 'EUR 55K, flexible',
      source: 'profile.targetSalary',
    });
    expect(
      standardScreening(
        { location: 'Tokyo, Japan', region: null, remote: false },
        profile,
        rules,
      ).map((a) => a.question),
    ).not.toContain('Salary expectation');
  });
});
