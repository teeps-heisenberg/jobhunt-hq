/**
 * Generic document renderer, ported from scripts/resume/build-document.js.
 * A title, optional subtitle, and sections of paragraphs, bullets and key-value lines.
 * Renders to DOCX (A4) and to Markdown; the application pack uses both.
 */
import { writeFileSync } from 'node:fs';

import { Document, Packer, Paragraph, TextRun } from 'docx';
import { z } from 'zod';

const Line = z.string().trim().min(1);

export const Block = z.union([
  Line,
  z.object({ bullet: Line }),
  z.object({ kv: z.tuple([Line, z.string()]) }),
]);
export type Block = z.infer<typeof Block>;

export const Section = z.object({
  /** Heading; omit for an unheaded block of paragraphs. */
  h: Line.optional(),
  p: z.array(Block).default([]),
});
export type Section = z.infer<typeof Section>;

export const GenericDocument = z.object({
  title: Line,
  subtitle: Line.optional(),
  sections: z.array(Section).default([]),
});
export type GenericDocument = z.infer<typeof GenericDocument>;

const FONT = 'Arial';
const SIZE = 21;
const LINE = 264;
const ACCENT = '1F3864';
const MUTED = '555555';

export function buildGenericDocument(input: GenericDocument): Document {
  const doc = GenericDocument.parse(input);
  const run = (
    text: string,
    o: { size?: number; bold?: boolean; italics?: boolean; color?: string } = {},
  ) =>
    new TextRun({
      text,
      font: FONT,
      size: o.size ?? SIZE,
      ...(o.bold !== undefined ? { bold: o.bold } : {}),
      ...(o.italics !== undefined ? { italics: o.italics } : {}),
      ...(o.color !== undefined ? { color: o.color } : {}),
    });
  const para = (children: TextRun[], o: { before?: number; after?: number } = {}) =>
    new Paragraph({
      spacing: { line: LINE, before: o.before ?? 0, after: o.after ?? 140 },
      children,
    });

  const kids: Paragraph[] = [];
  kids.push(
    new Paragraph({ spacing: { after: 60 }, children: [run(doc.title, { bold: true, size: 30 })] }),
  );
  if (doc.subtitle)
    kids.push(para([run(doc.subtitle, { italics: true, color: MUTED })], { after: 260 }));

  for (const section of doc.sections) {
    if (section.h) {
      kids.push(
        new Paragraph({
          spacing: { before: 220, after: 80 },
          children: [run(section.h, { bold: true, size: 24, color: ACCENT })],
        }),
      );
    }
    for (const block of section.p) {
      if (typeof block === 'string') kids.push(para([run(block)]));
      else if ('bullet' in block) {
        kids.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { line: LINE, after: 80 },
            children: [run(block.bullet)],
          }),
        );
      } else {
        kids.push(para([run(`${block.kv[0]}: `, { bold: true }), run(block.kv[1])], { after: 60 }));
      }
    }
  }

  return new Document({
    title: doc.title,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1100, bottom: 1000, left: 1200, right: 1200 },
          },
        },
        children: kids,
      },
    ],
  });
}

export async function renderDocumentDocx(doc: GenericDocument): Promise<Buffer> {
  return Packer.toBuffer(buildGenericDocument(doc));
}

export async function writeDocumentDocx(doc: GenericDocument, path: string): Promise<string> {
  writeFileSync(path, await renderDocumentDocx(doc));
  return path;
}

/** The same document as Markdown. */
export function documentToMarkdown(input: GenericDocument): string {
  const doc = GenericDocument.parse(input);
  const lines: string[] = [`# ${doc.title}`];
  if (doc.subtitle) lines.push('', `_${doc.subtitle}_`);
  for (const section of doc.sections) {
    if (section.h) lines.push('', `## ${section.h}`);
    let previousWasBullet = false;
    for (const block of section.p) {
      if (typeof block === 'string') {
        lines.push('', block);
        previousWasBullet = false;
      } else if ('bullet' in block) {
        if (!previousWasBullet) lines.push('');
        lines.push(`- ${block.bullet}`);
        previousWasBullet = true;
      } else {
        if (!previousWasBullet) lines.push('');
        lines.push(`- **${block.kv[0]}:** ${block.kv[1]}`);
        previousWasBullet = true;
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Plain text (no Markdown markers), for linting. */
export function documentToText(input: GenericDocument): string {
  const doc = GenericDocument.parse(input);
  const lines: string[] = [doc.title];
  if (doc.subtitle) lines.push(doc.subtitle);
  for (const section of doc.sections) {
    if (section.h) lines.push(section.h);
    for (const block of section.p) {
      if (typeof block === 'string') lines.push(block);
      else if ('bullet' in block) lines.push(block.bullet);
      else lines.push(`${block.kv[0]}: ${block.kv[1]}`);
    }
  }
  return lines.join('\n');
}
