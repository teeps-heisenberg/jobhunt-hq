import type { JobStatus } from '@jobhunt-hq/core';

/** `2026-10-22T08:00:00.000Z` -> `22 Oct 2026`; null -> ''. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Days from `today` to `iso` (negative when overdue). */
export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const base = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - base) / 86_400_000);
}

export function scoreTone(score: number): string {
  if (score >= 4) return 'bg-emerald-100 text-emerald-800';
  if (score >= 3) return 'bg-amber-100 text-amber-800';
  if (score > 0) return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-500';
}

export const STATUS_TONE: Record<JobStatus, string> = {
  New: 'bg-slate-100 text-slate-700',
  Shortlisted: 'bg-blue-100 text-blue-800',
  Applied: 'bg-indigo-100 text-indigo-800',
  Responded: 'bg-violet-100 text-violet-800',
  Interview: 'bg-amber-100 text-amber-800',
  Offer: 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-rose-100 text-rose-800',
  Skipped: 'bg-slate-100 text-slate-500',
};

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Reads a string search param, ignoring arrays and empties. */
export function param(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
