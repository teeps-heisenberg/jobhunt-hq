import type { JobStatus } from '@jobhunt-hq/core';

import { scoreTone, STATUS_TONE } from '@/lib/format';

export function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-center text-xs font-semibold ${scoreTone(score)}`}
    >
      {score.toFixed(1)}
    </span>
  );
}

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}
    >
      {status}
    </span>
  );
}
