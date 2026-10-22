/**
 * The application pack (SPEC F6): per role, a cover note, why this role, screening answers and
 * the verify list, saved as output/<company>/<role>/pack.md. Built on the generic document so
 * the same content can also go to DOCX.
 */
import { z } from 'zod';

import {
  type Block,
  type GenericDocument,
  documentToMarkdown,
  documentToText,
} from './document.js';

const Line = z.string().trim().min(1);

export const ScreeningAnswer = z.object({
  question: Line,
  answer: Line,
  /** Where the answer comes from, e.g. `rules.salary.London` or `profile.noticePeriod`. */
  source: z.string().optional(),
});
export type ScreeningAnswer = z.infer<typeof ScreeningAnswer>;

export const VerifyItem = z.object({
  text: Line,
  /** Where it appears: `cv.summary`, `cover.para 2`, ... */
  where: z.string().optional(),
  /** Why it needs a look, e.g. `not in master.json`. */
  reason: z.string().optional(),
});
export type VerifyItem = z.infer<typeof VerifyItem>;

export const Pack = z.object({
  job: z.object({
    id: Line,
    company: Line,
    role: Line,
    location: z.string().default(''),
    url: z.string().default(''),
    applyUrl: z.string().optional(),
  }),
  /** ISO date the pack was generated. */
  generatedAt: z.string().default(() => new Date().toISOString().slice(0, 10)),
  /** Cover note paragraphs, ready to paste. */
  coverNote: z.array(Line).min(1),
  /** Short bullets: evidence from the master CV that fits this posting. */
  whyThisRole: z.array(Line).default([]),
  screening: z.array(ScreeningAnswer).default([]),
  /** Posting rules that matter at apply time: AI-written answers forbidden, cover letter required, ... */
  notes: z.array(Line).default([]),
  verify: z.array(VerifyItem).default([]),
  files: z
    .object({
      cvPdf: z.string().optional(),
      cvDocx: z.string().optional(),
      coverDocx: z.string().optional(),
    })
    .default({}),
});
export type Pack = z.infer<typeof Pack>;

/** The pack as a generic document: one template for Markdown and DOCX. */
export function packToDocument(input: Pack): GenericDocument {
  const pack = Pack.parse(input);
  const { job } = pack;
  const sections: GenericDocument['sections'] = [];

  const meta: Block[] = [
    { kv: ['Posting', job.url || 'n/a'] },
    ...(job.applyUrl ? [{ kv: ['Apply', job.applyUrl] as [string, string] }] : []),
    { kv: ['Location', job.location || 'n/a'] },
    { kv: ['Tracker id', job.id] },
    { kv: ['Generated', pack.generatedAt] },
  ];
  if (pack.files.cvPdf) meta.push({ kv: ['CV (PDF)', pack.files.cvPdf] });
  if (pack.files.cvDocx) meta.push({ kv: ['CV (DOCX)', pack.files.cvDocx] });
  if (pack.files.coverDocx) meta.push({ kv: ['Cover letter (DOCX)', pack.files.coverDocx] });
  sections.push({ p: meta });

  if (pack.notes.length) {
    sections.push({ h: 'Read before applying', p: pack.notes.map((n) => ({ bullet: n })) });
  }

  sections.push({ h: 'Cover note', p: pack.coverNote });

  if (pack.whyThisRole.length) {
    sections.push({ h: 'Why this role', p: pack.whyThisRole.map((w) => ({ bullet: w })) });
  }

  if (pack.screening.length) {
    sections.push({
      h: 'Screening answers',
      p: pack.screening.map((s) => ({
        kv: [s.question, s.source ? `${s.answer} (from ${s.source})` : s.answer] as [
          string,
          string,
        ],
      })),
    });
  }

  sections.push({
    h: 'Verify before sending',
    p: pack.verify.length
      ? pack.verify.map((v) => ({
          bullet: [v.text, v.where ? `(${v.where})` : '', v.reason ? `: ${v.reason}` : '']
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
      : ['Nothing flagged: every sentence traces back to master.json and profile.yaml.'],
  });

  return {
    title: `${job.company}: ${job.role}`,
    subtitle: 'Application pack. You submit; nothing here is sent automatically.',
    sections,
  };
}

/** `output/<company>/<role>/pack.md` content. */
export function renderPackMarkdown(pack: Pack): string {
  return documentToMarkdown(packToDocument(pack));
}

/** Plain text of the pack for the style lint. */
export function packToText(pack: Pack): string {
  return documentToText(packToDocument(pack));
}

/** `output/<company-slug>/<role-slug>` relative folder for a job's files. */
export function packFolder(company: string, role: string): string {
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'untitled';
  return `output/${slug(company)}/${slug(role)}`;
}
