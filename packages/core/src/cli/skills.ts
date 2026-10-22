/**
 * Reads skill names out of data/master.json for the scoring engine.
 * Tolerant of shape: the full master schema lands in packages/resume (M1 task 7).
 */
import { existsSync, readFileSync } from 'node:fs';

export function extractSkills(master: unknown): string[] {
  if (!master || typeof master !== 'object') return [];
  const skills = (master as { skills?: unknown }).skills;
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s !== 'string') return;
    for (const part of s.split(/[,;/]|\band\b/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  };
  if (Array.isArray(skills)) {
    for (const entry of skills) {
      if (typeof entry === 'string') push(entry);
      else if (Array.isArray(entry)) entry.slice(1).forEach(push);
      else if (entry && typeof entry === 'object') {
        const items =
          (entry as { items?: unknown; skills?: unknown }).items ??
          (entry as { skills?: unknown }).skills;
        if (Array.isArray(items)) items.forEach(push);
        else push(items);
      }
    }
  } else if (skills && typeof skills === 'object') {
    for (const value of Object.values(skills as Record<string, unknown>)) {
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    }
  }
  return [...new Set(out)];
}

export function loadCandidateSkills(path: string): string[] | undefined {
  if (!existsSync(path)) return undefined;
  return extractSkills(JSON.parse(readFileSync(path, 'utf8')));
}
