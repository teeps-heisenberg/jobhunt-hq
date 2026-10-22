'use client';

import type { Job, JobStatus } from '@jobhunt-hq/core';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { moveJob } from '@/app/actions';
import { ScoreBadge } from '@/components/badges';
import { STATUS_TONE } from '@/lib/format';

export function Kanban({ jobs, statuses }: { jobs: Job[]; statuses: readonly JobStatus[] }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<JobStatus | null>(null);
  const [pending, start] = useTransition();

  const drop = (status: JobStatus) => {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status === status) return;
    start(() => moveJob(id, status));
  };

  return (
    <div className={`flex gap-3 overflow-x-auto pb-4 ${pending ? 'opacity-70' : ''}`}>
      {statuses.map((status) => {
        const column = jobs.filter((j) => j.status === status);
        return (
          <section
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== status) setOver(status);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              drop(status);
            }}
            className={`flex w-60 shrink-0 flex-col rounded-lg border bg-slate-100/60 p-2 ${
              over === status ? 'border-[var(--accent)]' : 'border-slate-200'
            }`}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
                {status}
              </span>
              <span className="text-xs text-slate-500">{column.length}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2">
              {column.map((job) => (
                <article
                  key={job.id}
                  draggable
                  onDragStart={() => setDragging(job.id)}
                  onDragEnd={() => setDragging(null)}
                  className={`card cursor-grab p-3 text-sm ${dragging === job.id ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium leading-tight hover:underline"
                    >
                      {job.role}
                    </Link>
                    <ScoreBadge score={job.score} />
                  </div>
                  <div className="mt-1 text-xs text-slate-600">{job.company}</div>
                  <div className="text-xs text-slate-500">
                    {job.location}
                    {job.remote ? ' (remote)' : ''}
                  </div>
                  {job.followUpAt && (
                    <div className="mt-1 text-xs text-slate-500">Follow up {job.followUpAt}</div>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
