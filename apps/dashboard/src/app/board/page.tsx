import { JOB_STATUSES, listJobs } from '@jobhunt-hq/core';

import { NoJobsYet } from '@/components/empty';
import { Kanban } from '@/components/kanban';
import { getTracker } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function BoardPage() {
  const jobs = listJobs(getTracker().db);
  if (jobs.length === 0) return <NoJobsYet />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Drag a card to change its status. Each move is recorded in the job's timeline.
      </p>
      <Kanban jobs={jobs} statuses={JOB_STATUSES} />
    </div>
  );
}
