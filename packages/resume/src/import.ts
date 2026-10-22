/**
 * CV import for /setup: turns an existing DOCX or PDF into plain text so the setup skill can
 * draft data/master.json from it. Text only; nothing is uploaded anywhere.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';

export type CvFormat = 'docx' | 'pdf' | 'txt';

export interface ImportedCv {
  format: CvFormat;
  text: string;
  /** PDF page count, when known. */
  pages?: number;
}

/** DOCX: concatenates paragraph text from word/document.xml, one paragraph per line. */
export function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Not a DOCX file: word/document.xml is missing');
  return cleanText(
    strFromU8(xml)
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
}

/** PDF: text per page via unpdf (pdf.js), pages separated by a blank line. */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return { text: cleanText(pages.join('\n\n')), pages: totalPages };
}

export async function importCv(path: string): Promise<ImportedCv> {
  const ext = extname(path).toLowerCase();
  const bytes = new Uint8Array(readFileSync(path));
  switch (ext) {
    case '.docx':
      return { format: 'docx', text: extractDocxText(bytes) };
    case '.pdf': {
      const { text, pages } = await extractPdfText(bytes);
      return { format: 'pdf', text, pages };
    }
    case '.txt':
    case '.md':
      return { format: 'txt', text: cleanText(Buffer.from(bytes).toString('utf8')) };
    default:
      throw new Error(`Unsupported CV format "${ext || '(none)'}". Use .docx, .pdf or .txt.`);
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(new RegExp(String.fromCharCode(0xa0), 'g'), ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
