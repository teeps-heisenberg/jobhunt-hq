/**
 * DOCX renderer, ported from scripts/resume/build-docx.js.
 * Letter size, Arial 10.5pt, navy section headings with a rule, 1.1 line spacing.
 */
import { writeFileSync } from 'node:fs';

import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from 'docx';

import type { Resume } from './schema.js';

export interface DocxTheme {
  font: string;
  /** Body size in half-points (21 = 10.5pt). */
  size: number;
  accent: string;
  muted: string;
  /** Twentieths of a point. */
  pageWidth: number;
  pageHeight: number;
  sideMargin: number;
  topMargin: number;
  bottomMargin: number;
  /** 240 = single spacing. */
  lineSpacing: number;
}

export const DEFAULT_THEME: DocxTheme = {
  font: 'Arial',
  size: 21,
  accent: '1F3864',
  muted: '444444',
  pageWidth: 12240,
  pageHeight: 15840,
  sideMargin: 864,
  topMargin: 640,
  bottomMargin: 560,
  lineSpacing: 254,
};

interface RunOptions {
  size?: number;
  bold?: boolean;
  italics?: boolean;
  color?: string;
}

export function buildDocument(resume: Resume, theme: DocxTheme = DEFAULT_THEME): Document {
  const { font, size, accent, muted, lineSpacing: LINE } = theme;
  const contentWidth = theme.pageWidth - 2 * theme.sideMargin;

  const run = (text: string, o: RunOptions = {}) =>
    new TextRun({
      text,
      font,
      size: o.size ?? size,
      ...(o.bold !== undefined ? { bold: o.bold } : {}),
      ...(o.italics !== undefined ? { italics: o.italics } : {}),
      ...(o.color !== undefined ? { color: o.color } : {}),
    });
  const tab = () => new TextRun({ children: [new Tab()], font, size });

  const para = (
    children: ParagraphChild[],
    o: {
      before?: number;
      after?: number;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
      keepNext?: boolean;
    } = {},
  ) =>
    new Paragraph({
      children,
      spacing: { line: LINE, before: o.before ?? 0, after: o.after ?? 40 },
      ...(o.align !== undefined ? { alignment: o.align } : {}),
      ...(o.keepNext !== undefined ? { keepNext: o.keepNext } : {}),
    });

  const heading = (text: string) =>
    new Paragraph({
      spacing: { line: LINE, before: 150, after: 40 },
      keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: accent, space: 2 } },
      children: [run(text.toUpperCase(), { bold: true, size: 23, color: accent })],
    });

  const bullet = (children: ParagraphChild[], after = 20) =>
    new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      spacing: { line: LINE, after },
      children,
    });

  const rightTabLine = (children: ParagraphChild[], o: { before: number; keepNext?: boolean }) =>
    new Paragraph({
      ...(o.keepNext !== undefined ? { keepNext: o.keepNext } : {}),
      spacing: { line: LINE, before: o.before, after: 0 },
      tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
      children,
    });

  const kids: Paragraph[] = [];

  // Header
  kids.push(
    para([run(resume.name, { bold: true, size: 36, color: accent })], {
      align: AlignmentType.CENTER,
      after: 20,
    }),
  );
  kids.push(
    para([run(resume.title, { bold: true, size: 23 })], { align: AlignmentType.CENTER, after: 40 }),
  );
  for (const line of resume.contact)
    kids.push(para([run(line, { size: 19 })], { align: AlignmentType.CENTER, after: 0 }));

  // Summary
  kids.push(heading('Professional Summary'));
  kids.push(para([run(resume.summary)], { after: 0 }));

  // Skills
  kids.push(heading('Technical Skills'));
  for (const [group, text] of resume.skills)
    kids.push(para([run(`${group}:  `, { bold: true }), run(text)], { after: 30 }));

  // Experience
  kids.push(heading('Professional Experience'));
  resume.experience.forEach((e, i) => {
    kids.push(
      rightTabLine(
        [
          run(e.role, { bold: true }),
          run(`  |  ${e.company}`, { bold: true }),
          tab(),
          run(e.dates, { bold: true }),
        ],
        { before: i ? 120 : 40, keepNext: true },
      ),
    );
    if (e.location)
      kids.push(
        para([run(e.location, { italics: true, color: muted })], { keepNext: true, after: 40 }),
      );
    for (const b of e.bullets) kids.push(bullet([run(b)]));
  });

  // Projects
  if (resume.projects.length) {
    kids.push(heading('Selected Projects'));
    for (const p of resume.projects) {
      const children = [run(p.name, { bold: true }), run(`: ${p.desc}`)];
      if (p.tech) children.push(run(`  (${p.tech})`, { italics: true, color: muted }));
      kids.push(bullet(children, 50));
    }
  }

  // Education
  if (resume.education.length) {
    kids.push(heading('Education'));
    for (const [degree, school, note, year] of resume.education) {
      kids.push(
        rightTabLine(
          [run(degree, { bold: true }), run(`  |  ${school}`), tab(), run(year, { bold: true })],
          { before: 0 },
        ),
      );
      if (note) kids.push(para([run(note, { italics: true, color: muted })], { after: 0 }));
    }
  }

  // Certifications
  if (resume.certifications.length) {
    kids.push(heading('Certifications'));
    for (const c of resume.certifications) kids.push(bullet([run(c)]));
  }

  // Additional
  if (resume.additional.length) {
    kids.push(heading('Additional Information'));
    for (const a of resume.additional) kids.push(bullet([run(a)]));
  }

  return new Document({
    creator: resume.name,
    title: `${resume.name} Resume`,
    styles: { default: { document: { run: { font, size } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 340, hanging: 230 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: theme.pageWidth, height: theme.pageHeight },
            margin: {
              top: theme.topMargin,
              bottom: theme.bottomMargin,
              left: theme.sideMargin,
              right: theme.sideMargin,
            },
          },
        },
        children: kids,
      },
    ],
  });
}

export async function renderDocx(
  resume: Resume,
  theme: DocxTheme = DEFAULT_THEME,
): Promise<Buffer> {
  return Packer.toBuffer(buildDocument(resume, theme));
}

export async function writeDocx(
  resume: Resume,
  path: string,
  theme: DocxTheme = DEFAULT_THEME,
): Promise<string> {
  writeFileSync(path, await renderDocx(resume, theme));
  return path;
}
