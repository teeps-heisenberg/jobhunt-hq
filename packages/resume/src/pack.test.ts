import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { CoverLetter, coverLetterToText, renderCoverLetterDocx } from './cover.js';
import {
  documentToMarkdown,
  documentToText,
  GenericDocument,
  renderDocumentDocx,
} from './document.js';
import { lintText } from './lint.js';
import { Pack, packFolder, packToDocument, packToText, renderPackMarkdown } from './pack.js';

function docxText(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  return strFromU8(files['word/document.xml']!)
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
}

const letter: CoverLetter = {
  from: { name: 'Sam Rivera', contact: 'Lisbon, Portugal | sam@example.com | +1 555 0100' },
  date: '22 October 2026',
  to: 'Hiring Team, Acme',
  re: 'Full Stack Engineer (Remote, EU)',
  paras: [
    'I am applying for the Full Stack Engineer role at Acme.',
    'At Example SaaS I built a multi-tenant scheduling product on Next.js, NestJS and PostgreSQL used by 200 clinics.',
    'I would welcome a conversation about the role.',
  ],
  closing: 'Kind regards,',
};

describe('cover letter', () => {
  it('renders every part in order', async () => {
    const text = docxText(await renderCoverLetterDocx(letter));
    const order = [
      'Sam Rivera',
      'Lisbon, Portugal',
      '22 October 2026',
      'Hiring Team, Acme',
      'Re: Full Stack Engineer',
      'I am applying',
      '200 clinics',
      'Kind regards,',
      'Sam Rivera',
    ];
    let at = -1;
    for (const part of order) {
      const next = text.indexOf(part, at + 1);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
  });

  it('defaults the closing and produces plain text', () => {
    const { closing: _closing, ...noClosing } = letter;
    const text = coverLetterToText(CoverLetter.parse(noClosing));
    expect(text.split('\n').slice(0, 2)).toEqual([
      'Sam Rivera',
      'Lisbon, Portugal | sam@example.com | +1 555 0100',
    ]);
    expect(text).toContain('\nRe: Full Stack Engineer (Remote, EU)\n');
    expect(text.endsWith('Kind regards,\nSam Rivera')).toBe(true);
  });

  it('rejects an empty letter', () => {
    expect(CoverLetter.safeParse({ ...letter, paras: [] }).success).toBe(false);
  });
});

const doc: GenericDocument = {
  title: 'Why Acme',
  subtitle: 'Notes for the call',
  sections: [
    { p: ['Intro paragraph.'] },
    {
      h: 'Fit',
      p: [{ bullet: 'TypeScript since 2023' }, { bullet: 'LLM features in production' }],
    },
    {
      h: 'Facts',
      p: [
        { kv: ['Notice', '1 month'] },
        { kv: ['Salary', 'EUR 50-60K, flexible'] },
        'Closing line.',
      ],
    },
  ],
};

describe('generic document', () => {
  it('renders title, subtitle, headings, bullets and key-values to DOCX', async () => {
    const text = docxText(await renderDocumentDocx(doc));
    for (const part of [
      'Why Acme',
      'Notes for the call',
      'Intro paragraph.',
      'Fit',
      'TypeScript since 2023',
      'Facts',
      'Notice: 1 month',
      'Salary: EUR 50-60K, flexible',
      'Closing line.',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('renders Markdown with blank lines between blocks and none inside lists', () => {
    expect(documentToMarkdown(doc)).toBe(
      [
        '# Why Acme',
        '',
        '_Notes for the call_',
        '',
        'Intro paragraph.',
        '',
        '## Fit',
        '',
        '- TypeScript since 2023',
        '- LLM features in production',
        '',
        '## Facts',
        '',
        '- **Notice:** 1 month',
        '- **Salary:** EUR 50-60K, flexible',
        '',
        'Closing line.',
        '',
      ].join('\n'),
    );
  });

  it('renders plain text', () => {
    expect(documentToText(doc).split('\n')).toEqual([
      'Why Acme',
      'Notes for the call',
      'Intro paragraph.',
      'Fit',
      'TypeScript since 2023',
      'LLM features in production',
      'Facts',
      'Notice: 1 month',
      'Salary: EUR 50-60K, flexible',
      'Closing line.',
    ]);
  });

  it('rejects unknown block shapes', () => {
    expect(
      GenericDocument.safeParse({ title: 'X', sections: [{ p: [{ image: 'x.png' }] }] }).success,
    ).toBe(false);
  });
});

const pack: Pack = {
  job: {
    id: 'acme-full-stack-engineer-eu',
    company: 'Acme',
    role: 'Full Stack Engineer',
    location: 'Remote - EU',
    url: 'https://boards.greenhouse.io/acme/jobs/111',
    applyUrl: 'https://boards.greenhouse.io/acme/jobs/111#app',
  },
  generatedAt: '2026-10-22',
  coverNote: letter.paras,
  whyThisRole: [
    'Next.js, NestJS and PostgreSQL match the stack in the posting.',
    'LLM summarisation feature shipped with an evaluation set.',
  ],
  screening: [
    {
      question: 'Years of experience with TypeScript',
      answer: '3',
      source: 'profile.yearsExperience',
    },
    {
      question: 'Salary expectation',
      answer: 'USD 2,500-3,500/month, flexible',
      source: 'rules.salary.remote',
    },
    { question: 'Notice period', answer: '1 month' },
  ],
  notes: ['The posting asks for a cover letter: use the cover note below.'],
  verify: [
    { text: 'used by 200 clinics', where: 'cover.para 2', reason: 'number not in master.json' },
    { text: 'Kubernetes' },
  ],
  files: {
    cvPdf: 'output/acme/full-stack-engineer/cv.pdf',
    cvDocx: 'output/acme/full-stack-engineer/cv.docx',
  },
};

describe('pack', () => {
  it('renders the pack.md template', () => {
    expect(renderPackMarkdown(pack)).toBe(
      [
        '# Acme: Full Stack Engineer',
        '',
        '_Application pack. You submit; nothing here is sent automatically._',
        '',
        '- **Posting:** https://boards.greenhouse.io/acme/jobs/111',
        '- **Apply:** https://boards.greenhouse.io/acme/jobs/111#app',
        '- **Location:** Remote - EU',
        '- **Tracker id:** acme-full-stack-engineer-eu',
        '- **Generated:** 2026-10-22',
        '- **CV (PDF):** output/acme/full-stack-engineer/cv.pdf',
        '- **CV (DOCX):** output/acme/full-stack-engineer/cv.docx',
        '',
        '## Read before applying',
        '',
        '- The posting asks for a cover letter: use the cover note below.',
        '',
        '## Cover note',
        '',
        'I am applying for the Full Stack Engineer role at Acme.',
        '',
        'At Example SaaS I built a multi-tenant scheduling product on Next.js, NestJS and PostgreSQL used by 200 clinics.',
        '',
        'I would welcome a conversation about the role.',
        '',
        '## Why this role',
        '',
        '- Next.js, NestJS and PostgreSQL match the stack in the posting.',
        '- LLM summarisation feature shipped with an evaluation set.',
        '',
        '## Screening answers',
        '',
        '- **Years of experience with TypeScript:** 3 (from profile.yearsExperience)',
        '- **Salary expectation:** USD 2,500-3,500/month, flexible (from rules.salary.remote)',
        '- **Notice period:** 1 month',
        '',
        '## Verify before sending',
        '',
        '- used by 200 clinics (cover.para 2) : number not in master.json',
        '- Kubernetes',
        '',
      ].join('\n'),
    );
  });

  it('says so when nothing needs verifying and skips empty sections', () => {
    const minimal = Pack.parse({
      job: { id: 'x', company: 'Globex', role: 'AI Engineer' },
      coverNote: ['Hello.'],
    });
    const md = renderPackMarkdown(minimal);
    expect(md).toContain(
      '\nNothing flagged: every sentence traces back to master.json and profile.yaml.',
    );
    expect(md).not.toContain('## Why this role');
    expect(md).not.toContain('## Screening answers');
    expect(md).not.toContain('## Read before applying');
    expect(md).toContain('- **Posting:** n/a');
    expect(minimal.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('passes the default style lint and exposes a document for DOCX', () => {
    expect(lintText(packToText(pack))).toEqual([]);
    expect(packToDocument(pack).sections.map((s) => s.h)).toEqual([
      undefined,
      'Read before applying',
      'Cover note',
      'Why this role',
      'Screening answers',
      'Verify before sending',
    ]);
  });

  it('builds the output folder from company and role', () => {
    expect(packFolder('Acme, Inc.', 'Full Stack Engineer (Remote)')).toBe(
      'output/acme-inc/full-stack-engineer-remote',
    );
    expect(packFolder('Société Générale', '???')).toBe('output/societe-generale/untitled');
  });
});
