import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { renderDocx } from './docx.js';
import { extractDocxText, importCv } from './import.js';
import { buildVariant } from './variant.js';

const example = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../data/examples/master.json'), 'utf8'),
) as unknown;

describe('importCv', () => {
  it('reads a DOCX rendered by this package, one paragraph per line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-import-'));
    const path = join(dir, 'cv.docx');
    writeFileSync(path, await renderDocx(buildVariant(example).resume));

    const cv = await importCv(path);
    expect(cv.format).toBe('docx');
    const lines = cv.text.split('\n');
    expect(lines[0]).toBe('Sam Rivera');
    expect(lines).toContain('PROFESSIONAL EXPERIENCE');
    expect(cv.text).toContain('Built a multi-tenant scheduling product');
    expect(cv.text).toContain('Software Engineer | Example SaaS Ltd Jan 2024 – Present');
  });

  it('reads a PDF with page count', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page1 = doc.addPage();
    page1.drawText('Sam Rivera', { x: 50, y: 700, size: 18, font });
    page1.drawText('Software Engineer at Example SaaS', { x: 50, y: 670, size: 12, font });
    doc.addPage().drawText('Second page', { x: 50, y: 700, size: 12, font });
    const dir = mkdtempSync(join(tmpdir(), 'jh-import-'));
    const path = join(dir, 'cv.pdf');
    writeFileSync(path, await doc.save());

    const cv = await importCv(path);
    expect(cv.format).toBe('pdf');
    expect(cv.pages).toBe(2);
    expect(cv.text).toContain('Sam Rivera');
    expect(cv.text).toContain('Software Engineer at Example SaaS');
    expect(cv.text).toContain('Second page');
  });

  it('reads plain text and normalises whitespace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-import-'));
    const path = join(dir, 'cv.txt');
    writeFileSync(path, 'Sam Rivera  \r\n\r\n\r\n\r\nEngineer\t\tat   Acme\r\n');
    const cv = await importCv(path);
    expect(cv).toEqual({ format: 'txt', text: 'Sam Rivera\n\nEngineer at Acme' });
  });

  it('rejects unknown formats and non-DOCX zips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-import-'));
    const path = join(dir, 'cv.odt');
    writeFileSync(path, 'x');
    await expect(importCv(path)).rejects.toThrow(/Unsupported CV format "\.odt"/);
    expect(() =>
      extractDocxText(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])),
    ).toThrow(/word\/document\.xml/);
  });
});
