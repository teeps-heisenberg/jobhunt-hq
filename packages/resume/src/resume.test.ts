import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { renderDocx, writeDocx } from './docx.js';
import { EM_DASH, fixCharacters, formatIssue, lintText } from './lint.js';
import { checkPages, convertToPdf, countPages, findSoffice, SofficeNotFoundError } from './pdf.js';
import { Master, VariantSpec } from './schema.js';
import { buildVariant, resumeToText } from './variant.js';

const examplePath = join(import.meta.dirname, '../../../data/examples/master.json');
const example = JSON.parse(readFileSync(examplePath, 'utf8')) as unknown;

function docxText(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const xml = strFromU8(files['word/document.xml']!);
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
}

describe('Master schema', () => {
  it('accepts data/examples/master.json and fills defaults', () => {
    const master = Master.parse(example);
    expect(master.name).toBe('Sam Rivera');
    expect(master.skills).toHaveLength(6);
    expect(master.summaries).toEqual({});
    expect(master.experience[0]?.bullets).toHaveLength(2);
  });

  it('rejects a CV without experience or with an empty bullet', () => {
    expect(Master.safeParse({ ...(example as object), experience: [] }).success).toBe(false);
    const bad = JSON.parse(JSON.stringify(example)) as { experience: Array<{ bullets: string[] }> };
    bad.experience[0]!.bullets.push('   ');
    expect(Master.safeParse(bad).success).toBe(false);
  });

  it('parses an empty variant spec with defaults', () => {
    expect(VariantSpec.parse({})).toEqual({
      skills: { order: [], overrides: {}, drop: [] },
      projects: { order: [], drop: [] },
      experience: [],
    });
  });
});

describe('buildVariant', () => {
  it('returns the master unchanged with no spec and no new claims', () => {
    const { resume, newClaims } = buildVariant(example);
    expect(newClaims).toEqual([]);
    expect(resume.title).toBe('Full Stack Engineer | TypeScript, React, Node.js | Applied AI');
    expect(resume.projects.map((p) => p.name.slice(0, 8))).toEqual([
      'ProjectA',
      'ProjectB',
      'ProjectC',
    ]);
    expect('summaries' in resume).toBe(false);
  });

  it('reorders skills and projects, drops and caps, keeping master order for the rest', () => {
    const { resume, newClaims } = buildVariant(example, {
      skills: { order: ['AI / ML', 'Backend'], drop: ['Practices'] },
      projects: { order: ['ProjectB'], drop: ['ProjectC'], max: 2 },
    });
    expect(resume.skills.map(([g]) => g)).toEqual([
      'AI / ML',
      'Backend',
      'Languages',
      'Frontend',
      'Data & Cloud',
    ]);
    expect(resume.projects.map((p) => p.name.slice(0, 8))).toEqual(['ProjectB', 'ProjectA']);
    expect(newClaims).toEqual([]);
  });

  it('applies a skills override and flags skills the master does not have', () => {
    const { resume, newClaims } = buildVariant(example, {
      skills: { overrides: { Backend: 'FastAPI, Node.js, Kubernetes' } },
    });
    expect(resume.skills.find(([g]) => g === 'Backend')?.[1]).toBe('FastAPI, Node.js, Kubernetes');
    expect(newClaims).toEqual([{ where: 'skills.Backend', text: 'Kubernetes' }]);
  });

  it('selects and reorders bullets per position and flags new bullets', () => {
    const master = Master.parse(example);
    const [b1, b2] = master.experience[0]!.bullets;
    const { resume, newClaims } = buildVariant(example, {
      experience: [
        { company: 'Example SaaS Ltd', bullets: [b2!, b1!] },
        {
          company: 'Example Agency',
          role: 'Junior Developer',
          bullets: ['Led a team of four engineers.'],
        },
      ],
    });
    expect(resume.experience[0]?.bullets).toEqual([b2, b1]);
    expect(resume.experience[1]?.bullets).toEqual(['Led a team of four engineers.']);
    expect(newClaims).toEqual([
      { where: 'experience.Example Agency', text: 'Led a team of four engineers.' },
    ]);
  });

  it('uses a keyed summary without a claim, and flags free-text title and summary', () => {
    const withSummaries = {
      ...(example as object),
      summaries: { ai: 'Engineer focused on applied AI.' },
    };
    expect(buildVariant(withSummaries, { summary: 'ai' })).toMatchObject({
      resume: { summary: 'Engineer focused on applied AI.' },
      newClaims: [],
    });
    const { resume, newClaims } = buildVariant(example, {
      title: 'AI Engineer',
      summary: 'Ten years of experience.',
      certifications: ['AWS Cloud Practitioner', 'CKA'],
    });
    expect(resume.title).toBe('AI Engineer');
    expect(newClaims).toEqual([
      { where: 'title', text: 'AI Engineer' },
      { where: 'summary', text: 'Ten years of experience.' },
      { where: 'certifications', text: 'CKA' },
    ]);
  });

  it('rejects an invalid spec', () => {
    expect(() => buildVariant(example, { projects: { max: -1 } })).toThrow();
  });

  it('renders plain text for linting and claim checks', () => {
    const text = resumeToText(buildVariant(example).resume);
    expect(text.split('\n')[0]).toBe('Sam Rivera');
    expect(text).toContain('Languages: TypeScript, JavaScript, Python, SQL');
    expect(text).toContain('Software Engineer | Example SaaS Ltd | Jan 2024 – Present');
    expect(text).toContain('BSc Computer Science | University of Lisbon | 2023');
  });
});

describe('renderDocx', () => {
  it('produces a DOCX containing every section of the example CV', async () => {
    const { resume } = buildVariant(example);
    const buffer = await renderDocx(resume);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const text = docxText(buffer);
    for (const expected of [
      'Sam Rivera',
      'PROFESSIONAL SUMMARY',
      'TECHNICAL SKILLS',
      'Languages:  TypeScript, JavaScript, Python, SQL',
      'PROFESSIONAL EXPERIENCE',
      'Software Engineer  |  Example SaaS Ltd\tJan 2024 – Present',
      'Built a multi-tenant scheduling product',
      'SELECTED PROJECTS',
      'ProjectB – Document AI: Extracts structured data',
      'EDUCATION',
      'BSc Computer Science  |  University of Lisbon\t2023',
      'CERTIFICATIONS',
      'AWS Cloud Practitioner',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('ADDITIONAL INFORMATION');
  });

  it('omits empty sections and writes to disk', async () => {
    const { resume } = buildVariant(example, { projects: { max: 0 }, certifications: [] });
    const dir = mkdtempSync(join(tmpdir(), 'jh-resume-'));
    const path = await writeDocx(resume, join(dir, 'cv.docx'));
    const text = docxText(readFileSync(path));
    expect(text).not.toContain('SELECTED PROJECTS');
    expect(text).not.toContain('CERTIFICATIONS');
  });
});

describe('page check', () => {
  async function pdfWithPages(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage();
    return doc.save();
  }

  it('counts pages and judges exact and max limits', async () => {
    expect(await countPages(await pdfWithPages(3))).toBe(3);
    expect(await checkPages(await pdfWithPages(2), 2)).toMatchObject({ pages: 2, ok: true });
    expect(await checkPages(await pdfWithPages(3), 2)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/over the limit/),
    });
    expect(await checkPages(await pdfWithPages(1), 2)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/under the target/),
    });
    expect(await checkPages(await pdfWithPages(1), 2, false)).toMatchObject({ ok: true });
  });

  it('reads a PDF from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-pdf-'));
    const path = join(dir, 'two.pdf');
    writeFileSync(path, await pdfWithPages(2));
    expect(await countPages(path)).toBe(2);
  });
});

describe('PDF conversion', () => {
  it('throws a clear error when soffice is missing', async () => {
    await expect(convertToPdf('cv.docx', { soffice: '' })).rejects.toBeInstanceOf(
      SofficeNotFoundError,
    );
  });

  it.skipIf(!findSoffice())(
    'renders the example CV to a two-page-or-less PDF with LibreOffice',
    async () => {
      const { resume } = buildVariant(example);
      const dir = mkdtempSync(join(tmpdir(), 'jh-soffice-'));
      const docx = await writeDocx(resume, join(dir, 'cv.docx'));
      const pdf = await convertToPdf(docx);
      expect(pdf.endsWith('cv.pdf')).toBe(true);
      const check = await checkPages(pdf, 2, false);
      expect(check.ok).toBe(true);
    },
    120_000,
  );
});

describe('lintText', () => {
  it('finds em dashes with positions, and nothing else by default', () => {
    const issues = lintText(`Line one\nBuilt ${EM_DASH} and shipped\nJan 2024 – Present`);
    expect(issues).toEqual([
      {
        kind: 'character',
        match: EM_DASH,
        line: 2,
        column: 7,
        snippet: `Built ${EM_DASH} and shipped`,
      },
    ]);
    expect(formatIssue(issues[0]!)).toBe(`line 2, col 7: em dash: Built ${EM_DASH} and shipped`);
  });

  it('finds banned phrases as whole words, case-insensitively', () => {
    const issues = lintText('A results-driven engineer. Synergy! Not synergistic.', {
      bannedCharacters: [],
      bannedPhrases: ['results-driven', 'synergy'],
    });
    expect(issues.map((i) => [i.match, i.column])).toEqual([
      ['results-driven', 3],
      ['synergy', 28],
    ]);
  });

  it('passes the example CV with the default rules', () => {
    expect(lintText(resumeToText(buildVariant(example).resume))).toEqual([]);
  });

  it('fixes characters but leaves phrases', () => {
    expect(fixCharacters(`Fast ${EM_DASH} reliable “quotes”…`)).toBe(
      'Fast ,  reliable "quotes"...',
    );
  });
});
