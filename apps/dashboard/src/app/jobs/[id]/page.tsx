import { getJob, JOB_STATUSES, listArtifacts, listEvents } from '@jobhunt-hq/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { addNoteForm, moveJobForm, setFollowUpForm } from '@/app/actions';
import { ScoreBadge, StatusBadge } from '@/components/badges';
import { getTracker } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ARTIFACT_LABEL: Record<string, string> = {
  cv_pdf: 'CV (PDF)',
  cv_docx: 'CV (DOCX)',
  cover: 'Cover letter',
  pack: 'Pack',
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = getTracker();
  const job = getJob(db, id);
  if (!job) notFound();
  const events = listEvents(db, id).reverse();
  const artifacts = listArtifacts(db, id);
  // The pack repeats the CV's items with a `cv.` prefix; show each claim once.
  const verify = [
    ...new Set(artifacts.flatMap((a) => a.verifyItems).map((v) => v.replace(/^cv\./, ''))),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="card">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grow">
              <h1 className="text-xl font-semibold">{job.role}</h1>
              <div className="text-slate-600">
                {job.company} · {job.location}
                {job.remote ? ' (remote)' : ''}
                {job.region ? ` · ${job.region}` : ''}
              </div>
            </div>
            <ScoreBadge score={job.score} />
            <StatusBadge status={job.status} />
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Field label="Posting">
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer"
                className="break-all text-[var(--accent)] hover:underline"
              >
                {job.url}
              </a>
            </Field>
            {job.applyUrl && (
              <Field label="Apply">
                <a
                  href={job.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[var(--accent)] hover:underline"
                >
                  {job.applyUrl}
                </a>
              </Field>
            )}
            <Field label="Why it fits">{job.why || <Muted>not written yet</Muted>}</Field>
            <Field label="Main gap">{job.gaps || <Muted>none noted</Muted>}</Field>
            <Field label="Visa">{job.visaNote || <Muted>not assessed</Muted>}</Field>
            <Field label="Salary">{job.salaryText || <Muted>not stated</Muted>}</Field>
            <Field label="Posted">{formatDate(job.postedAt) || <Muted>unknown</Muted>}</Field>
            <Field label="Found">
              {formatDate(job.foundAt)} via {job.source}
              {job.batch ? ` (${job.batch})` : ''}
            </Field>
            <Field label="Applied">{formatDate(job.appliedAt) || <Muted>not yet</Muted>}</Field>
            <Field label="Tracker id">
              <code className="text-xs">{job.id}</code>
            </Field>
          </dl>
        </div>

        <div className="card">
          <h2 className="font-semibold">Artifacts</h2>
          {artifacts.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              None yet. Run <code className="rounded bg-slate-100 px-1">/tailor {job.id}</code> in
              Claude Code.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {artifacts.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-2">
                  <span className="w-28 text-slate-500">{ARTIFACT_LABEL[a.kind] ?? a.kind}</span>
                  <code className="text-xs">{a.path}</code>
                  <span className="text-xs text-slate-400">{formatDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {verify.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <div className="font-medium text-amber-900">Verify before sending</div>
              <ul className="mt-1 list-disc pl-5 text-amber-900">
                {verify.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold">Timeline</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No events yet.</p>
          ) : (
            <ol className="mt-2 space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-slate-500">{formatDate(e.at)}</span>
                  <span>
                    {e.type === 'status_change' && (
                      <>
                        {String(e.payload['from'])} to <strong>{String(e.payload['to'])}</strong>
                        {e.payload['note'] ? `: ${String(e.payload['note'])}` : ''}
                      </>
                    )}
                    {e.type === 'note' && String(e.payload['note'] ?? '')}
                    {e.type === 'follow_up_sent' && `Follow-up sent ${JSON.stringify(e.payload)}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <form action={moveJobForm} className="card space-y-2">
          <input type="hidden" name="id" value={job.id} />
          <h2 className="font-semibold">Status</h2>
          <select name="status" defaultValue={job.status} className="input w-full">
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input name="note" placeholder="optional note" className="input w-full" />
          <button type="submit" className="btn btn-primary w-full">
            Update status
          </button>
        </form>

        <form action={setFollowUpForm} className="card space-y-2">
          <input type="hidden" name="id" value={job.id} />
          <h2 className="font-semibold">Follow-up</h2>
          <input
            name="followUpAt"
            type="date"
            defaultValue={job.followUpAt ?? ''}
            className="input w-full"
          />
          <button type="submit" className="btn w-full">
            Save date
          </button>
          <p className="text-xs text-slate-500">Leave empty to clear.</p>
        </form>

        <form action={addNoteForm} className="card space-y-2">
          <input type="hidden" name="id" value={job.id} />
          <h2 className="font-semibold">Notes</h2>
          {job.notes && (
            <pre className="whitespace-pre-wrap text-xs text-slate-700">{job.notes}</pre>
          )}
          <textarea name="text" rows={3} placeholder="Add a note" className="input w-full" />
          <button type="submit" className="btn w-full">
            Add note
          </button>
        </form>

        <Link href="/" className="block text-center text-sm text-slate-500 hover:underline">
          Back to table
        </Link>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-400">{children}</span>;
}
