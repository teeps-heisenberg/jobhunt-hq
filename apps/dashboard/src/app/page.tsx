import { type Job, type JobStatus, listJobs } from '@jobhunt-hq/core';
import Link from 'next/link';

import { ScoreBadge, StatusBadge } from '@/components/badges';
import { NoJobsYet } from '@/components/empty';
import { Filters } from '@/components/filters';
import { getTracker } from '@/lib/db';
import { daysUntil, formatDate, param, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TablePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const values = {
    status: param(params, 'status'),
    minScore: param(params, 'minScore'),
    region: param(params, 'region'),
    remote: param(params, 'remote'),
    batch: param(params, 'batch'),
    q: param(params, 'q'),
    since: param(params, 'since'),
  };

  const { db } = getTracker();
  const all = listJobs(db);
  if (all.length === 0) return <NoJobsYet />;

  const q = values.q?.toLowerCase();
  const minScore = values.minScore ? Number(values.minScore) : undefined;
  const jobs = all.filter(
    (j) =>
      (!values.status || j.status === (values.status as JobStatus)) &&
      (minScore === undefined || j.score >= minScore) &&
      (!values.region || j.region === values.region) &&
      (!values.remote || j.remote === (values.remote === 'yes')) &&
      (!values.batch || j.batch === values.batch) &&
      (!values.since || j.foundAt.slice(0, 10) >= values.since) &&
      (!q || j.company.toLowerCase().includes(q) || j.role.toLowerCase().includes(q)),
  );

  const regions = [
    ...new Set(all.map((j) => j.region).filter((r): r is string => Boolean(r))),
  ].sort();
  const batches = [...new Set(all.map((j) => j.batch).filter((b): b is string => Boolean(b)))]
    .sort()
    .reverse();

  return (
    <div className="space-y-4">
      <Filters values={values} regions={regions} batches={batches} />
      <p className="text-sm text-slate-500">
        {jobs.length} of {all.length} jobs
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Found</th>
              <th className="px-3 py-2">Follow-up</th>
              <th className="px-3 py-2">Why / gap</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <Row key={j.id} job={j} />
            ))}
          </tbody>
        </table>
        {jobs.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">No jobs match these filters.</p>
        )}
      </div>
    </div>
  );
}

function Row({ job }: { job: Job }) {
  const due = daysUntil(job.followUpAt);
  return (
    <tr className="border-t border-slate-100 align-top hover:bg-slate-50">
      <td className="px-3 py-2">
        <ScoreBadge score={job.score} />
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-3 py-2 font-medium">{job.company}</td>
      <td className="px-3 py-2">
        <Link href={`/jobs/${job.id}`} className="text-[var(--accent)] hover:underline">
          {job.role}
        </Link>
      </td>
      <td className="px-3 py-2 text-slate-600">
        {job.location}
        {job.remote ? ' (remote)' : ''}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{formatDate(job.foundAt)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {job.followUpAt ? (
          <span
            className={due !== null && due <= 0 ? 'font-medium text-rose-700' : 'text-slate-600'}
          >
            {formatDate(job.followUpAt)}
          </span>
        ) : (
          <span className="text-slate-300">none</span>
        )}
      </td>
      <td className="max-w-md px-3 py-2 text-xs text-slate-600">
        {job.why && <div>{truncate(job.why, 120)}</div>}
        {job.gaps && <div className="text-rose-700">{truncate(job.gaps, 120)}</div>}
      </td>
    </tr>
  );
}
