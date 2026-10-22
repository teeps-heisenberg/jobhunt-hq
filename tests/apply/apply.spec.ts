/**
 * SPEC acceptance 4: the filler fills Greenhouse, Lever and Ashby style forms and never
 * submits. The fixtures set window flags when Submit or a consent box is clicked.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

import { buildApplyPlan, loadProfile, loadRules } from '@jobhunt-hq/core';

import { fillForm } from './fill.js';

const root = join(import.meta.dirname, '../..');
const profile = loadProfile(join(root, 'config/profile.example.yaml'));
const rules = loadRules(join(root, 'config/rules.example.yaml'));

const plan = buildApplyPlan({
  job: {
    id: 'acme-full-stack-engineer-eu',
    company: 'Acme',
    role: 'Full Stack Engineer',
    location: 'Remote - EU',
    region: 'EU',
    remote: true,
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    applyUrl: null,
  },
  profile,
  rules,
  coverNote: ['I am applying for the Full Stack Engineer role.', 'Thank you for your time.'],
  screening: [
    {
      question: 'Why do you want to work here?',
      answer: 'The scheduling product matches my work at Example SaaS.',
    },
  ],
  cvPath: 'output/acme/full-stack-engineer/cv.pdf',
});

const fixtures = [
  {
    name: 'greenhouse',
    filled: [
      'firstName',
      'lastName',
      'email',
      'phone',
      'coverLetter',
      'linkedin',
      'years',
      'authorisation',
    ],
    untouched: ['#dob', '#resume'],
  },
  {
    name: 'lever',
    filled: [
      'fullName',
      'email',
      'phone',
      'location',
      'linkedin',
      'github',
      'coverLetter',
      'salary',
    ],
    untouched: ['input[name="password"]', 'input[name="resume"]'],
  },
  {
    name: 'ashby',
    filled: [
      'fullName',
      'email',
      'screening:Why do you want to work here?',
      'notice',
      'authorisation',
      'years',
    ],
    untouched: ['#q6', '#_systemfield_resume'],
  },
];

for (const fixture of fixtures) {
  test(`${fixture.name}: fills known fields and never submits`, async ({ page }) => {
    await page.goto(pathToFileURL(join(root, 'tests/apply/fixtures', `${fixture.name}.html`)).href);

    const report = await fillForm(page, plan);

    expect(report.filled.map((f) => f.key).sort()).toEqual([...fixture.filled].sort());
    for (const selector of fixture.untouched) {
      await expect(page.locator(selector)).toHaveValue('');
    }
    for (const box of await page.locator('input[type="checkbox"]').all()) {
      await expect(box).not.toBeChecked();
    }

    const flags = await page.evaluate(() => ({
      submitted: Boolean((window as unknown as Record<string, unknown>)['__submitted']),
      submitClicked: Boolean((window as unknown as Record<string, unknown>)['__submitClicked']),
      consentClicked: Boolean((window as unknown as Record<string, unknown>)['__consentClicked']),
    }));
    expect(flags).toEqual({ submitted: false, submitClicked: false, consentClicked: false });

    const reasons = report.remaining.map((r) => r.reason);
    expect(reasons).toContain('button: never clicked');
    expect(reasons).toContain('upload: attach yourself');
    expect(reasons).toContain('choice: tick yourself');
  });
}

test('the plan itself carries the stop rules', () => {
  expect(plan.stopBefore.join(' ')).toMatch(/click Submit yourself/);
  expect(plan.never).toContain('consent');
  expect(plan.never).toContain('password');
});
