import type { ReactNode } from 'react';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card mx-auto mt-10 max-w-xl text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 text-sm text-slate-600">{children}</div>
    </div>
  );
}

export function NoJobsYet() {
  return (
    <EmptyState title="No jobs tracked yet">
      <p>
        Open Claude Code in this folder and run{' '}
        <code className="rounded bg-slate-100 px-1">/setup</code> once, then{' '}
        <code className="rounded bg-slate-100 px-1">/search</code>. Rows appear here as the CLI
        inserts them.
      </p>
      <p className="mt-2">
        Just looking? Start the dashboard with{' '}
        <code className="rounded bg-slate-100 px-1">pnpm demo</code> to see it filled with fictional
        example data.
      </p>
    </EmptyState>
  );
}
