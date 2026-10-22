import { getStats, JOB_STATUSES, listJobs } from '@jobhunt-hq/core';

import { NoJobsYet } from '@/components/empty';
import { getTracker } from '@/lib/db';
import { STATUS_TONE } from '@/lib/format';

export const dynamic = 'force-dynamic';

const RESPONDED = new Set(['Responded', 'Interview', 'Offer', 'Rejected']);
const APPLIED = new Set(['Applied', ...RESPONDED]);

export default function StatsPage() {
  const { db } = getTracker();
  const stats = getStats(db);
  if (stats.total === 0) return <NoJobsYet />;
  const jobs = listJobs(db);
  const max = Math.max(1, ...Object.values(stats.byStatus));

  const bySource = new Map<string, { found: number; applied: number; responded: number }>();
  for (const j of jobs) {
    const row = bySource.get(j.source) ?? { found: 0, applied: 0, responded: 0 };
    row.found++;
    if (APPLIED.has(j.status)) row.applied++;
    if (RESPONDED.has(j.status)) row.responded++;
    bySource.set(j.source, row);
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <h2 className="font-semibold">Funnel</h2>
        <p className="text-sm text-slate-500">
          {stats.total} jobs at {stats.companies} companies. Applied {stats.applied}, responded{' '}
          {stats.responded} ({pct(stats.responded, stats.applied)}), follow-ups due{' '}
          {stats.followUpsDue}.
        </p>
        <ul className="mt-3 space-y-1.5">
          {JOB_STATUSES.map((s) => (
            <li key={s} className="flex items-center gap-2 text-sm">
              <span
                className={`w-24 rounded px-1.5 py-0.5 text-center text-xs font-medium ${STATUS_TONE[s]}`}
              >
                {s}
              </span>
              <div className="h-4 grow rounded bg-slate-100">
                <div
                  className="h-4 rounded bg-[var(--accent)]"
                  style={{ width: `${(100 * stats.byStatus[s]) / max}%` }}
                />
              </div>
              <span className="w-8 text-right tabular-nums">{stats.byStatus[s]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="font-semibold">By source</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1">Source</th>
              <th className="py-1 text-right">Found</th>
              <th className="py-1 text-right">Applied</th>
              <th className="py-1 text-right">Responded</th>
              <th className="py-1 text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {[...bySource.entries()]
              .sort((a, b) => b[1].found - a[1].found)
              .map(([source, row]) => (
                <tr key={source} className="border-t border-slate-100">
                  <td className="py-1">{source}</td>
                  <td className="py-1 text-right tabular-nums">{row.found}</td>
                  <td className="py-1 text-right tabular-nums">{row.applied}</td>
                  <td className="py-1 text-right tabular-nums">{row.responded}</td>
                  <td className="py-1 text-right tabular-nums">
                    {pct(row.responded, row.applied)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
