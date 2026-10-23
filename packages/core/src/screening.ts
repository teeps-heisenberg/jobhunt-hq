/**
 * Standard screening answers (SPEC F6): years, salary and notice period, taken from
 * profile.yaml and rules.yaml so the pack never invents them. Each answer names its source.
 */
import type { Job, Profile, Rules } from './schema.js';
import { assessLocation, salaryBand } from './scoring.js';

export interface ScreeningAnswer {
  question: string;
  answer: string;
  source: string;
}

export function standardScreening(
  job: Pick<Job, 'location' | 'region' | 'remote'>,
  profile: Profile,
  rules: Rules,
): ScreeningAnswer[] {
  const answers: ScreeningAnswer[] = [
    {
      question: 'Years of professional experience',
      answer: String(profile.yearsExperience),
      source: 'profile.yearsExperience',
    },
  ];

  const location = assessLocation(
    { location: job.location, remote: job.remote, ...(job.region ? { region: job.region } : {}) },
    profile,
    rules,
  );
  const band = salaryBand(location, { location: job.location }, rules);
  if (band) {
    answers.push({
      question: 'Salary expectation',
      answer: `${band[1]}, flexible`,
      source: `rules.salary.${band[0]}`,
    });
  } else if (profile.targetSalary) {
    answers.push({
      question: 'Salary expectation',
      answer: `${profile.targetSalary}, flexible`,
      source: 'profile.targetSalary',
    });
  }

  if (profile.noticePeriod) {
    answers.push({
      question: 'Notice period',
      answer: profile.noticePeriod,
      source: 'profile.noticePeriod',
    });
  }

  // "Remote - EU" reads badly in a sentence: name the place, and say "remotely" instead.
  const remotePlace = job.location
    .replace(/^\s*remote\s*[-:(,]?\s*/i, '')
    .replace(/\)\s*$/, '')
    .trim();
  const where = job.remote
    ? `remotely from ${remotePlace || job.region || 'my current location'}`
    : `in ${job.location}`;
  answers.push({
    question: 'Work authorisation',
    answer: location.needsSponsorship
      ? `Needs visa sponsorship to work ${where}; can work without sponsorship in ${profile.citizenship.join(', ')}`
      : `Can work ${where} without sponsorship`,
    source: 'profile.citizenship, rules.visa',
  });

  return answers;
}
