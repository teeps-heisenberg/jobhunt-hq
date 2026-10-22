/**
 * Cover letter renderer, ported from scripts/resume/build-cover-letter.js.
 * Letter size, Arial 10.5pt, generous margins.
 */
import { writeFileSync } from 'node:fs';

import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { z } from 'zod';

const Line = z.string().trim().min(1);

export const CoverLetter = z.object({
  from: z.object({
    name: Line,
    /** One line, e.g. `Lisbon, Portugal | sam@example.com | +1 555 0100`. */
    contact: Line,
  }),
  /** As it should print, e.g. `22 October 2026`. */
  date: Line,
  /** Addressee, e.g. `Hiring Team, Acme`. */
  to: Line,
  /** Subject, printed as `Re: ...`. */
  re: Line,
  paras: z.array(Line).min(1),
  closing: z.string().default('Kind regards,'),
});
export type CoverLetter = z.infer<typeof CoverLetter>;

const FONT = 'Arial';
const SIZE = 21;
const LINE = 264;

export function buildCoverLetterDocument(input: CoverLetter): Document {
  const letter = CoverLetter.parse(input);
  const run = (text: string, o: { bold?: boolean } = {}) =>
    new TextRun({
      text,
      font: FONT,
      size: SIZE,
      ...(o.bold !== undefined ? { bold: o.bold } : {}),
    });
  const para = (text: string, o: { bold?: boolean; after?: number } = {}) =>
    new Paragraph({
      spacing: { line: LINE, after: o.after ?? 140 },
      children: [run(text, { ...(o.bold !== undefined ? { bold: o.bold } : {}) })],
    });

  const children = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
      children: [run(letter.from.name, { bold: true })],
    }),
    para(letter.from.contact, { after: 240 }),
    para(letter.date, { after: 240 }),
    para(letter.to, { after: 240 }),
    para(`Re: ${letter.re}`, { bold: true, after: 240 }),
    ...letter.paras.map((p) => para(p)),
    para(letter.closing, { after: 40 }),
    para(letter.from.name),
  ];

  return new Document({
    creator: letter.from.name,
    title: `Cover letter: ${letter.re}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1200, bottom: 1000, left: 1200, right: 1200 },
          },
        },
        children,
      },
    ],
  });
}

export async function renderCoverLetterDocx(letter: CoverLetter): Promise<Buffer> {
  return Packer.toBuffer(buildCoverLetterDocument(letter));
}

export async function writeCoverLetterDocx(letter: CoverLetter, path: string): Promise<string> {
  writeFileSync(path, await renderCoverLetterDocx(letter));
  return path;
}

/** Plain text, for linting and the pack. */
export function coverLetterToText(input: CoverLetter): string {
  const letter = CoverLetter.parse(input);
  return [
    letter.from.name,
    letter.from.contact,
    '',
    letter.date,
    '',
    letter.to,
    '',
    `Re: ${letter.re}`,
    '',
    ...letter.paras.flatMap((p) => [p, '']),
    letter.closing,
    letter.from.name,
  ].join('\n');
}
