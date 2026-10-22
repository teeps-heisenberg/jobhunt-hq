/**
 * Apply assist (SPEC F7): the deterministic half. Builds the list of form fields the kit may
 * fill for a job, from profile.yaml, rules.yaml and the pack. The browser side (Playwright)
 * matches these entries to inputs by label, name or placeholder, fills them, and stops.
 *
 * Hard rules live here as data so every filler shares them: never a submit, consent, password,
 * national id, date of birth or payment field, and uploads stay manual by default.
 */
import type { Job, Profile, Rules } from './schema.js';
import { standardScreening } from './screening.js';

export type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select';

export interface PlanField {
  /** Stable key, e.g. `firstName`. */
  key: string;
  /** Case-insensitive patterns matched against the label, name, id, placeholder or aria-label. */
  match: string[];
  value: string;
  kind: FieldKind;
  /** Where the value comes from. */
  source: string;
}

export interface PlanUpload {
  key: string;
  match: string[];
  path: string;
  source: string;
}

export interface ApplyPlan {
  jobId: string;
  applyUrl: string;
  fields: PlanField[];
  /** Files the user attaches by hand (paths for convenience). */
  uploads: PlanUpload[];
  /** Field patterns that must never be filled or clicked. */
  never: string[];
  /** What the human does after the fill. */
  stopBefore: string[];
}

/** Patterns for controls the kit never touches. Matched against label, name, id, type. */
export const NEVER_PATTERNS = [
  'submit',
  'send application',
  'apply now',
  'consent',
  'agree',
  'terms',
  'privacy',
  'gdpr',
  'password',
  'passport',
  'national id',
  'social security',
  'ssn',
  'tax id',
  'date of birth',
  'birth',
  'card number',
  'iban',
  'bank',
  'captcha',
  'signature',
];

export const STOP_BEFORE = [
  'Attach the CV and any other uploads yourself.',
  'Tick consent or terms boxes yourself, after reading them.',
  'Review every filled field, then click Submit yourself.',
];

export interface ApplyPlanInput {
  job: Pick<Job, 'id' | 'company' | 'role' | 'location' | 'region' | 'remote' | 'url' | 'applyUrl'>;
  profile: Profile;
  rules: Rules;
  /** Cover note paragraphs from the pack, if written. */
  coverNote?: string[] | undefined;
  /** Extra screening answers from the pack: question -> answer. */
  screening?: Array<{ question: string; answer: string }> | undefined;
  cvPath?: string | undefined;
  coverPath?: string | undefined;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

function linkOf(links: string[], host: string): string | undefined {
  return links.find((l) => l.toLowerCase().includes(host));
}

export function buildApplyPlan(input: ApplyPlanInput): ApplyPlan {
  const { job, profile, rules } = input;
  const { first, last } = splitName(profile.name);
  const links = profile.contact.links;
  const fields: PlanField[] = [];

  const add = (
    key: string,
    match: string[],
    value: string | undefined,
    kind: FieldKind,
    source: string,
  ) => {
    if (value && value.trim()) fields.push({ key, match, value: value.trim(), kind, source });
  };

  add(
    'firstName',
    ['first name', 'first_name', 'firstname', 'given name'],
    first,
    'text',
    'profile.name',
  );
  add(
    'lastName',
    ['last name', 'last_name', 'lastname', 'surname', 'family name'],
    last,
    'text',
    'profile.name',
  );
  add('fullName', ['full name', 'your name', '^name$'], profile.name, 'text', 'profile.name');
  add('email', ['email', 'e-mail'], profile.contact.email, 'email', 'profile.contact.email');
  add(
    'phone',
    ['phone', 'mobile', 'telephone'],
    profile.contact.phone,
    'tel',
    'profile.contact.phone',
  );
  add(
    'location',
    ['location', 'city', 'where are you based', 'current location'],
    profile.contact.location,
    'text',
    'profile.contact.location',
  );
  add('linkedin', ['linkedin'], linkOf(links, 'linkedin.com'), 'url', 'profile.contact.links');
  add('github', ['github'], linkOf(links, 'github.com'), 'url', 'profile.contact.links');
  add(
    'website',
    ['website', 'portfolio', 'personal site', 'url'],
    links.find((l) => !/linkedin\.com|github\.com/i.test(l)),
    'url',
    'profile.contact.links',
  );

  const standard = standardScreening(job, profile, rules);
  const years = standard.find((s) => s.question.startsWith('Years'));
  const salary = standard.find((s) => s.question.startsWith('Salary'));
  const notice = standard.find((s) => s.question.startsWith('Notice'));
  const auth = standard.find((s) => s.question.startsWith('Work authorisation'));
  add(
    'years',
    ['years of experience', 'years experience', 'how many years'],
    years?.answer,
    'text',
    years?.source ?? '',
  );
  add(
    'salary',
    ['salary', 'compensation', 'expected pay', 'rate'],
    salary?.answer,
    'text',
    salary?.source ?? '',
  );
  add(
    'notice',
    ['notice period', 'availability', 'start date', 'earliest start'],
    notice?.answer,
    'text',
    notice?.source ?? '',
  );
  add(
    'authorisation',
    ['authori[sz]ed to work', 'work authori[sz]ation', 'right to work', 'sponsorship', 'visa'],
    auth?.answer,
    'textarea',
    auth?.source ?? '',
  );

  for (const extra of input.screening ?? []) {
    add(
      `screening:${extra.question}`,
      [extra.question],
      extra.answer,
      'textarea',
      'pack.screening',
    );
  }

  if (input.coverNote?.length) {
    add(
      'coverLetter',
      [
        'cover letter',
        'cover note',
        'why do you want',
        'message to the hiring',
        'additional information',
      ],
      input.coverNote.join('\n\n'),
      'textarea',
      'pack.coverNote',
    );
  }

  const uploads: PlanUpload[] = [];
  if (input.cvPath)
    uploads.push({
      key: 'cv',
      match: ['resume', 'cv', 'curriculum'],
      path: input.cvPath,
      source: 'artifact cv_pdf',
    });
  if (input.coverPath)
    uploads.push({
      key: 'coverLetterFile',
      match: ['cover letter'],
      path: input.coverPath,
      source: 'artifact cover',
    });

  return {
    jobId: job.id,
    applyUrl: job.applyUrl ?? job.url,
    fields,
    uploads,
    never: NEVER_PATTERNS,
    stopBefore: STOP_BEFORE,
  };
}

/** True when a control's label, name, id or type matches a never-touch pattern. */
export function isForbidden(
  descriptor: string,
  never: readonly string[] = NEVER_PATTERNS,
): boolean {
  const d = descriptor.toLowerCase();
  return never.some((p) => d.includes(p));
}

/** Finds the plan field for a control described by its label, name, id, placeholder, aria-label. */
export function matchField(
  descriptor: string,
  fields: readonly PlanField[],
): PlanField | undefined {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[*\u2731:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const whole = clean(descriptor);
  // Parts are the label, placeholder, name, id, ... joined with " | " by the caller.
  const parts = descriptor.split(' | ').map(clean).filter(Boolean);
  return fields.find((f) =>
    f.match.some((pattern) => {
      const p = pattern.toLowerCase().replace(/[_-]+/g, ' ');
      if (p.startsWith('^') || p.includes('[')) {
        const re = new RegExp(p, 'i');
        return parts.some((part) => re.test(part));
      }
      return whole.includes(p);
    }),
  );
}
