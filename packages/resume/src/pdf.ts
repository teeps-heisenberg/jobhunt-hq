/**
 * PDF via LibreOffice (`soffice --headless --convert-to pdf`) and page counting with pdf-lib.
 * LibreOffice is a documented requirement; `findSoffice()` lets callers degrade gracefully.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/local/bin/soffice',
  '/snap/bin/libreoffice',
];

/** The soffice binary: `$SOFFICE`, a known install path, or `soffice` on PATH. */
export function findSoffice(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env['SOFFICE'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const installed = CANDIDATES.find((p) => existsSync(p));
  if (installed) return installed;
  const dirs = (env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':');
  const names =
    process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice', 'libreoffice'];
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name);
      if (dir && existsSync(p)) return p;
    }
  }
  return undefined;
}

export class SofficeNotFoundError extends Error {
  override readonly name = 'SofficeNotFoundError';
  constructor() {
    super(
      'LibreOffice (soffice) not found. Install it or set SOFFICE to the binary. See README: PDF rendering.',
    );
  }
}

export interface ConvertOptions {
  soffice?: string;
  /** Defaults to the DOCX's folder. */
  outDir?: string;
  timeoutMs?: number;
}

/** Converts a DOCX to PDF next to it (or in `outDir`) and returns the PDF path. */
export async function convertToPdf(
  docxPath: string,
  options: ConvertOptions = {},
): Promise<string> {
  const soffice = options.soffice ?? findSoffice();
  if (!soffice) throw new SofficeNotFoundError();
  const input = resolve(docxPath);
  const outDir = resolve(options.outDir ?? dirname(input));
  await execFileAsync(
    soffice,
    ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, input],
    {
      timeout: options.timeoutMs ?? 120_000,
      windowsHide: true,
    },
  );
  const pdf = join(outDir, basename(input).replace(/\.docx$/i, '.pdf'));
  if (!existsSync(pdf)) throw new Error(`soffice reported success but ${pdf} was not written`);
  return pdf;
}

export async function countPages(pdf: string | Uint8Array): Promise<number> {
  const bytes = typeof pdf === 'string' ? readFileSync(pdf) : pdf;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPageCount();
}

export interface PageCheck {
  pages: number;
  maxPages: number;
  ok: boolean;
  message: string;
}

/** SPEC acceptance 3: the PDF must be exactly `maxPages` pages (fewer is also flagged). */
export async function checkPages(
  pdf: string | Uint8Array,
  maxPages: number,
  exact = true,
): Promise<PageCheck> {
  const pages = await countPages(pdf);
  const ok = exact ? pages === maxPages : pages <= maxPages;
  const message = ok
    ? `${pages} page${pages === 1 ? '' : 's'}, within the limit of ${maxPages}`
    : pages > maxPages
      ? `${pages} pages, over the limit of ${maxPages}: trim bullets or projects`
      : `${pages} page${pages === 1 ? '' : 's'}, under the target of ${maxPages}: add a project or bullets`;
  return { pages, maxPages, ok, message };
}
