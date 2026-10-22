/**
 * The master CV (`data/master.json`) is the single source of truth. Every tailored variant is
 * derived from it, and anything that is not in it must be verified before sending (SPEC
 * principle 2). The shape matches scripts/resume/build-docx.js and data/examples/master.json.
 */
import { z } from 'zod';

const Line = z.string().trim().min(1);

/** `["Languages", "TypeScript, Python"]` */
export const SkillGroup = z.tuple([Line, Line]);
export type SkillGroup = z.infer<typeof SkillGroup>;

export const Experience = z.object({
  role: Line,
  company: Line,
  location: z.string().default(''),
  dates: Line,
  bullets: z.array(Line).default([]),
});
export type Experience = z.infer<typeof Experience>;

export const Project = z.object({
  name: Line,
  tech: z.string().default(''),
  desc: Line,
});
export type Project = z.infer<typeof Project>;

/** `["BSc Computer Science", "University of Lisbon", "GPA or note", "2023"]` */
export const Education = z.tuple([Line, Line, z.string(), z.string()]);
export type Education = z.infer<typeof Education>;

export const Master = z.object({
  name: Line,
  title: Line,
  contact: z.array(Line).min(1),
  summary: Line,
  /** Optional alternative summaries a variant can pick by key. */
  summaries: z.record(z.string(), Line).default({}),
  skills: z.array(SkillGroup).min(1),
  experience: z.array(Experience).min(1),
  projects: z.array(Project).default([]),
  education: z.array(Education).default([]),
  certifications: z.array(Line).default([]),
  additional: z.array(Line).default([]),
});
export type Master = z.infer<typeof Master>;

/** A rendered CV: the master shape without the alternative summaries. */
export const Resume = Master.omit({ summaries: true });
export type Resume = z.infer<typeof Resume>;

// ---------------------------------------------------------------------------
// Variant spec: what the tailor skill may change for one role
// ---------------------------------------------------------------------------

export const VariantSpec = z.object({
  /** Headline under the name. */
  title: z.string().trim().min(1).optional(),
  /** A key of `master.summaries` or new summary text (new text is a claim to verify). */
  summary: z.string().trim().min(1).optional(),
  skills: z
    .object({
      /** Group names to put first, in this order. Unlisted groups follow in master order. */
      order: z.array(Line).default([]),
      /** Replacement text per group, e.g. to lead with the role's stack. */
      overrides: z.record(z.string(), Line).default({}),
      drop: z.array(Line).default([]),
    })
    .default({ order: [], overrides: {}, drop: [] }),
  projects: z
    .object({
      /** Project names (or unique prefixes) to put first. */
      order: z.array(Line).default([]),
      drop: z.array(Line).default([]),
      /** Keep at most this many projects after ordering. */
      max: z.number().int().min(0).optional(),
    })
    .default({ order: [], drop: [] }),
  /** Per-position bullet selection and order. Positions not listed keep master bullets. */
  experience: z
    .array(
      z.object({
        company: Line,
        /** Disambiguates two positions at the same company. */
        role: Line.optional(),
        /** Bullets in the order to show. Text not in the master is a claim to verify. */
        bullets: z.array(Line),
      }),
    )
    .default([]),
  certifications: z.array(Line).optional(),
  additional: z.array(Line).optional(),
});
export type VariantSpec = z.infer<typeof VariantSpec>;
