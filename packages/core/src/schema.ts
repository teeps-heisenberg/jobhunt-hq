/**
 * Core schemas: every boundary (CLI input, skill output, DB rows, YAML config)
 * is validated with these. SPEC section 5 (data model) and section 6 (config files).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO 8601 date or datetime string, e.g. 2026-10-22 or 2026-10-22T09:00:00Z. */
export const IsoDate = z.iso.date().or(z.iso.datetime({ offset: true }));
export type IsoDate = z.infer<typeof IsoDate>;

/** Lowercase slug used for job ids, e.g. `acme-backend-engineer-lisbon`. */
export const Slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug (a-z, 0-9, single hyphens)');
export type Slug = z.infer<typeof Slug>;

/** Fit score from 0 (no fit) to 5 (strong fit). Hard blockers mean Skipped, not a low score. */
export const Score = z.number().min(0).max(5);
export type Score = z.infer<typeof Score>;

const NonEmpty = z.string().trim().min(1);
const Url = z.url();

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  'New',
  'Shortlisted',
  'Applied',
  'Responded',
  'Interview',
  'Offer',
  'Rejected',
  'Skipped',
] as const;

export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;

export const JOB_SOURCES = ['bigTech', 'ats', 'remote', 'research', 'custom', 'manual'] as const;
export const JobSource = z.enum(JOB_SOURCES);
export type JobSource = z.infer<typeof JobSource>;

/**
 * One row as returned by a job-scout subagent, before dedupe, scoring and insertion.
 * This is the shape `pnpm jh add-jobs <file.json>` accepts.
 */
export const JobInput = z.object({
  company: NonEmpty,
  role: NonEmpty,
  location: NonEmpty,
  region: NonEmpty.optional(),
  remote: z.boolean().default(false),
  visaNote: z.string().default(''),
  url: Url,
  applyUrl: Url.optional(),
  salaryText: z.string().optional(),
  postedAt: IsoDate.optional(),
  minYears: z.number().int().min(0).max(40).optional(),
  keyRequirements: z.array(NonEmpty).default([]),
  why: z.string().default(''),
  gap: z.string().default(''),
  suggestedScore: Score.optional(),
  source: JobSource.default('manual'),
  batch: z.string().optional(),
});
export type JobInput = z.infer<typeof JobInput>;

/** A rejected posting reported by a scout, kept for the search report only. */
export const RejectedPosting = z.object({
  title: NonEmpty,
  reason: NonEmpty,
});
export type RejectedPosting = z.infer<typeof RejectedPosting>;

/** Full output of one job-scout run. */
export const ScoutOutput = z.object({
  jobs: z.array(JobInput),
  rejected: z.array(RejectedPosting).default([]),
});
export type ScoutOutput = z.infer<typeof ScoutOutput>;

/** A tracked job: one row of the `jobs` table. */
export const Job = z.object({
  id: Slug,
  company: NonEmpty,
  role: NonEmpty,
  location: NonEmpty,
  region: z.string().nullable(),
  remote: z.boolean(),
  visaNote: z.string(),
  url: Url,
  applyUrl: Url.nullable(),
  salaryText: z.string().nullable(),
  score: Score,
  status: JobStatus,
  foundAt: IsoDate,
  postedAt: IsoDate.nullable(),
  why: z.string(),
  gaps: z.string(),
  source: JobSource,
  batch: z.string().nullable(),
  appliedAt: IsoDate.nullable(),
  followUpAt: IsoDate.nullable(),
  notes: z.string(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Job = z.infer<typeof Job>;

// ---------------------------------------------------------------------------
// Artifacts, events, search runs
// ---------------------------------------------------------------------------

export const ARTIFACT_KINDS = ['cv_pdf', 'cv_docx', 'cover', 'pack'] as const;
export const ArtifactKind = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/** A generated file for a job, with the claims the user must verify before sending. */
export const Artifact = z.object({
  id: z.number().int().positive(),
  jobId: Slug,
  kind: ArtifactKind,
  path: NonEmpty,
  createdAt: IsoDate,
  verifyItems: z.array(z.string()),
});
export type Artifact = z.infer<typeof Artifact>;

export const EVENT_TYPES = ['status_change', 'note', 'follow_up_sent'] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/** Audit trail entry; the dashboard timeline is built from these. */
export const Event = z.object({
  id: z.number().int().positive(),
  jobId: Slug,
  at: IsoDate,
  type: EventType,
  payload: z.record(z.string(), z.unknown()),
});
export type Event = z.infer<typeof Event>;

/** One `/search` run. */
export const SearchRun = z.object({
  id: z.number().int().positive(),
  at: IsoDate,
  focus: z.string().nullable(),
  sources: z.array(z.string()),
  found: z.number().int().min(0),
  new: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type SearchRun = z.infer<typeof SearchRun>;

// ---------------------------------------------------------------------------
// config/profile.yaml
// ---------------------------------------------------------------------------

export const LANGUAGE_LEVELS = [
  'basic',
  'conversational',
  'professional',
  'fluent',
  'native',
] as const;
export const LanguageLevel = z.enum(LANGUAGE_LEVELS);
export type LanguageLevel = z.infer<typeof LanguageLevel>;

export const Profile = z.object({
  name: NonEmpty,
  contact: z.object({
    email: z.email(),
    phone: z.string().optional(),
    location: NonEmpty,
    links: z.array(Url).default([]),
  }),
  /** Countries or blocs where the user can work without sponsorship. */
  citizenship: z.array(NonEmpty).min(1),
  yearsExperience: z.number().min(0).max(60),
  languages: z.array(z.object({ name: NonEmpty, level: LanguageLevel })).default([]),
  targetTitles: z.array(NonEmpty).min(1),
  noticePeriod: z.string().optional(),
  currentSalary: z.string().optional(),
  targetSalary: z.string().optional(),
  /** Things the user has decided never to claim, whatever a posting asks for. */
  neverClaim: z.array(NonEmpty).default([]),
});
export type Profile = z.infer<typeof Profile>;

// ---------------------------------------------------------------------------
// config/rules.yaml
// ---------------------------------------------------------------------------

export const ScoringWeights = z
  .object({
    skills: z.number().min(0).max(1),
    years: z.number().min(0).max(1),
    location: z.number().min(0).max(1),
    recency: z.number().min(0).max(1),
    salary: z.number().min(0).max(1),
  })
  .refine(
    (w) => Math.abs(w.skills + w.years + w.location + w.recency + w.salary - 1) < 1e-6,
    'scoring weights must add up to 1',
  );
export type ScoringWeights = z.infer<typeof ScoringWeights>;

export const ApplicationCap = z.object({
  applications: z.number().int().min(1),
  perDays: z.number().int().min(1),
});
export type ApplicationCap = z.infer<typeof ApplicationCap>;

const DEFAULT_WEIGHTS = { skills: 0.4, years: 0.2, location: 0.2, recency: 0.1, salary: 0.1 };
const DEFAULT_ATS = ['greenhouse', 'lever', 'ashby'];

export const Rules = z.object({
  locations: z.object({
    remoteFrom: z.array(NonEmpty).default([]),
    relocate: z.array(NonEmpty).default([]),
    exclude: z.array(NonEmpty).default([]),
  }),
  visa: z
    .object({
      needsSponsorshipOutside: z.array(NonEmpty).default([]),
      skipIf: z.array(NonEmpty).default([]),
    })
    .default({ needsSponsorshipOutside: [], skipIf: [] }),
  experience: z.object({
    maxYearsBar: z.number().int().min(0).max(40),
  }),
  hardBlockers: z
    .object({
      languagesRequired: z.array(NonEmpty).default([]),
    })
    .default({ languagesRequired: [] }),
  recencyDays: z.number().int().min(1).default(60),
  /** Salary answer per location key (`remote`, city, country). Free text, e.g. "EUR 50-60K". */
  salary: z.record(z.string(), NonEmpty).default({}),
  style: z.object({
    maxPages: z.number().int().min(1).max(5).default(2),
    bannedCharacters: z.array(z.string().min(1)).default(['—']),
    bannedPhrases: z.array(NonEmpty).default([]),
    projectOrder: z.array(NonEmpty).default([]),
  }),
  /**
   * In YAML: `dailyApplications: 10` plus per-company caps such as
   * `google: {applications: 3, perDays: 30}`. Parsed into `{ dailyApplications, perCompany }`.
   */
  caps: z
    .record(z.string(), z.union([z.number().int().min(1), ApplicationCap]))
    .default({})
    .transform((raw, ctx) => {
      const perCompany: Record<string, ApplicationCap> = {};
      let dailyApplications = 10;
      for (const [key, value] of Object.entries(raw)) {
        if (key === 'dailyApplications') {
          if (typeof value !== 'number') {
            ctx.addIssue({ code: 'custom', path: [key], message: 'must be a whole number' });
            continue;
          }
          dailyApplications = value;
        } else if (typeof value === 'number') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'expected {applications, perDays}',
          });
        } else {
          perCompany[key.toLowerCase()] = value;
        }
      }
      return { dailyApplications, perCompany };
    }),
  sources: z
    .object({
      bigTech: z.boolean().default(true),
      ats: z.array(NonEmpty).default(DEFAULT_ATS),
      remote: z.array(NonEmpty).default([]),
      research: z.boolean().default(false),
      custom: z.array(NonEmpty).default([]),
    })
    .default({ bigTech: true, ats: DEFAULT_ATS, remote: [], research: false, custom: [] }),
  scoring: z
    .object({
      weights: ScoringWeights.default(DEFAULT_WEIGHTS),
      /** Scores at or above this are suggested as Shortlisted; below, New. */
      shortlistAt: z.number().min(0).max(5).default(4),
    })
    .default({ weights: DEFAULT_WEIGHTS, shortlistAt: 4 }),
  followUpDays: z.number().int().min(1).default(10),
});
export type Rules = z.infer<typeof Rules>;
