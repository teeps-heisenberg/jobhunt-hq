/**
 * Search fan-out support (SPEC F2). The LLM does the searching; this module decides the source
 * groups from rules.sources and writes the brief each job-scout subagent receives, so every
 * scout gets the same rules, the same tracked ids and the same output contract.
 */
import type { JobKey } from './dedupe.js';
import { JOB_STATUSES, type JobSource, type Profile, type Rules } from './schema.js';

export interface SourceGroup {
  key: Exclude<JobSource, 'manual'>;
  label: string;
  enabled: boolean;
  /** Boards, sites or ATS names the scout should cover. */
  targets: string[];
  /** How to search this group. */
  method: string;
}

const BIG_TECH = [
  'careers.google.com',
  'metacareers.com',
  'amazon.jobs',
  'careers.microsoft.com',
  'jobs.apple.com',
  'jobs.netflix.com',
  'stripe.com/jobs',
  'shopify.com/careers',
  'cloudflare.com/careers',
  'databricks.com/company/careers',
];

const RESEARCH = [
  'cern.ch (careers)',
  'esa.int (careers)',
  'un.org/careers and unjobs.org',
  'ecb.europa.eu (careers)',
  'max planck society, fraunhofer, inria, cnrs',
  'alan turing institute, ai2, mila, vector institute',
];

export function sourceGroups(rules: Rules): SourceGroup[] {
  const s = rules.sources;
  return [
    {
      key: 'bigTech',
      label: 'Big tech careers sites',
      enabled: s.bigTech,
      targets: BIG_TECH,
      method:
        'Open each careers site and search for the target titles with the location filters. Prefer the site over aggregators.',
    },
    {
      key: 'ats',
      label: 'Startups via public ATS boards',
      enabled: s.ats.length > 0,
      targets: s.ats,
      method:
        'Web-search `site:boards.greenhouse.io`, `site:jobs.lever.co`, `site:jobs.ashbyhq.com`, `site:apply.workable.com` (as enabled) with the target titles and locations. Fetch each posting to confirm it is live.',
    },
    {
      key: 'remote',
      label: 'Remote job boards',
      enabled: s.remote.length > 0,
      targets: s.remote,
      method:
        'Browse each board for the target titles. Always follow through to the employer posting.',
    },
    {
      key: 'research',
      label: 'Research institutes and international organisations',
      enabled: s.research,
      targets: RESEARCH,
      method:
        'Check official careers pages only. Note nationality or language requirements carefully.',
    },
    {
      key: 'custom',
      label: 'User-added boards',
      enabled: s.custom.length > 0,
      targets: s.custom,
      method: 'Browse each board for the target titles.',
    },
  ];
}

export interface BriefInput {
  group: SourceGroup;
  profile: Profile;
  rules: Rules;
  tracked: readonly JobKey[];
  /** Optional focus from the user, e.g. "backend, fintech". */
  focus?: string | undefined;
  today: string;
  /** Scouts return at most this many rows. */
  maxRows?: number;
}

const list = (items: readonly string[]) => (items.length ? items.join(', ') : 'none');

/** The Markdown brief one job-scout subagent receives. */
export function scoutBrief(input: BriefInput): string {
  const { group, profile, rules, tracked, today } = input;
  const maxRows = input.maxRows ?? 15;
  const languages = profile.languages.map((l) => `${l.name} (${l.level})`);
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - rules.recencyDays);
  const sinceDate = since.toISOString().slice(0, 10);

  const trackedLines = tracked
    .map((j) => `- ${j.company} | ${j.role} | ${j.location} | ${j.url}`)
    .sort();

  return `# Job scout brief: ${group.label}

Date: ${today}. Source group key: \`${group.key}\`. Return at most ${maxRows} rows.
${input.focus ? `Focus for this run: ${input.focus}.\n` : ''}
## Where to look
${group.targets.map((t) => `- ${t}`).join('\n')}

${group.method}

## Candidate
- Target titles: ${list(profile.targetTitles)}
- Years of experience: ${profile.yearsExperience}
- Can work without sponsorship in: ${list(profile.citizenship)}
- Current location: ${profile.contact.location}
- Languages: ${list(languages)}

## Rules (apply strictly, in this order)
1. Posted on or after ${sinceDate} (rules.recencyDays = ${rules.recencyDays}). Skip older postings.
2. Location: remote from ${list(rules.locations.remoteFrom)}, or on-site/hybrid in ${list(rules.locations.relocate)}. Never: ${list(rules.locations.exclude)}.
3. Years: skip if the posting asks for more than ${rules.experience.maxYearsBar} years.
4. Hard blockers, skip and list under \`rejected\`: citizenship or nationality requirements the candidate does not meet, security clearance, ${rules.visa.skipIf.length ? `phrases such as ${list(rules.visa.skipIf.map((p) => `"${p}"`))}, ` : ''}fluency required in ${list(rules.hardBlockers.languagesRequired)}.
5. Sponsorship: the candidate needs a visa outside ${list(rules.visa.needsSponsorshipOutside)}. Say in \`visaNote\` whether the posting mentions sponsorship.
6. If the posting forbids AI-assisted applications, still report it but say so in \`visaNote\`.

## Already tracked (skip these; compare company + title + location, and ATS ids in the URL)
${trackedLines.length ? trackedLines.join('\n') : '- nothing tracked yet'}

## How to work
- Verify every posting is live by fetching it. Quote the minimum qualifications briefly in \`keyRequirements\`.
- Prefer the employer's own posting URL over aggregators. If you only saw a mirror, say so in \`gap\`.
- Never log in, never submit anything, never solve a CAPTCHA, never invent requirements or dates.
- Use plain ASCII punctuation in all text fields. No em dashes.

## Output: JSON only, nothing else
\`\`\`json
{
  "jobs": [
    {
      "company": "Acme",
      "role": "Backend Engineer",
      "location": "Lisbon, Portugal",
      "region": "EU",
      "remote": true,
      "visaNote": "EU citizens only; no sponsorship mentioned",
      "url": "https://boards.greenhouse.io/acme/jobs/123",
      "applyUrl": "https://boards.greenhouse.io/acme/jobs/123#app",
      "salaryText": "EUR 50-60K",
      "postedAt": "${today}",
      "minYears": 3,
      "keyRequirements": ["TypeScript", "PostgreSQL", "3+ years"],
      "why": "one line: evidence from the candidate profile that fits",
      "gap": "one line: the main gap, honestly",
      "suggestedScore": 4,
      "source": "${group.key}"
    }
  ],
  "rejected": [{ "title": "Acme Staff Engineer", "reason": "asks for 8 years" }]
}
\`\`\`
Field rules: \`url\` and \`applyUrl\` must be full URLs; \`postedAt\` is YYYY-MM-DD or omitted; \`minYears\` is a whole number or omitted; \`suggestedScore\` is 0 to 5; \`source\` is always \`${group.key}\`. Statuses are assigned later by the CLI (${JOB_STATUSES.slice(0, 3).join(', ')}, ...); do not include a status.
`;
}
