/**
 * Style lint for generated application text: banned characters (em dashes by default) and
 * banned phrases from rules.style. Works on any text, so cover notes and packs use it too.
 */

export interface LintOptions {
  /** Default: the em dash. */
  bannedCharacters?: string[];
  bannedPhrases?: string[];
}

export interface LintIssue {
  kind: 'character' | 'phrase';
  /** The offending character or phrase as configured. */
  match: string;
  /** 1-based line number. */
  line: number;
  column: number;
  snippet: string;
}

export const EM_DASH = '—';

const CHARACTER_NAMES: Record<string, string> = {
  '—': 'em dash',
  '–': 'en dash',
  '‘': 'left single quote',
  '’': 'right single quote',
  '“': 'left double quote',
  '”': 'right double quote',
  '…': 'ellipsis',
  ' ': 'non-breaking space',
};

export function describeCharacter(ch: string): string {
  return (
    CHARACTER_NAMES[ch] ?? `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
  );
}

export function lintText(text: string, options: LintOptions = {}): LintIssue[] {
  const chars = options.bannedCharacters ?? [EM_DASH];
  const phrases = (options.bannedPhrases ?? []).filter((p) => p.trim().length > 0);
  const issues: LintIssue[] = [];

  text.split(/\r?\n/).forEach((line, i) => {
    for (const ch of chars) {
      let from = 0;
      for (;;) {
        const at = line.indexOf(ch, from);
        if (at < 0) break;
        issues.push({
          kind: 'character',
          match: ch,
          line: i + 1,
          column: at + 1,
          snippet: snippet(line, at),
        });
        from = at + ch.length;
      }
    }
    const lower = line.toLowerCase();
    for (const phrase of phrases) {
      const p = phrase.toLowerCase();
      let from = 0;
      for (;;) {
        const at = lower.indexOf(p, from);
        if (at < 0) break;
        const before = at === 0 ? ' ' : lower[at - 1]!;
        const after = lower[at + p.length] ?? ' ';
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          issues.push({
            kind: 'phrase',
            match: phrase,
            line: i + 1,
            column: at + 1,
            snippet: snippet(line, at),
          });
        }
        from = at + p.length;
      }
    }
  });

  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}

function snippet(line: string, at: number, radius = 30): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(line.length, at + radius);
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
}

export function formatIssue(issue: LintIssue): string {
  const what =
    issue.kind === 'character' ? describeCharacter(issue.match) : `phrase "${issue.match}"`;
  return `line ${issue.line}, col ${issue.column}: ${what}: ${issue.snippet}`;
}

/** Replaces banned characters with plain equivalents. Phrases are left for a human. */
export function fixCharacters(
  text: string,
  replacements: Record<string, string> = DEFAULT_REPLACEMENTS,
): string {
  let out = text;
  for (const [from, to] of Object.entries(replacements)) out = out.split(from).join(to);
  return out;
}

export const DEFAULT_REPLACEMENTS: Record<string, string> = {
  '—': ', ',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ' ': ' ',
};
