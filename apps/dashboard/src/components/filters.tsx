import { JOB_STATUSES } from '@jobhunt-hq/core';

export interface FilterValues {
  status?: string | undefined;
  minScore?: string | undefined;
  region?: string | undefined;
  remote?: string | undefined;
  batch?: string | undefined;
  q?: string | undefined;
  since?: string | undefined;
}

export function Filters({
  values,
  regions,
  batches,
}: {
  values: FilterValues;
  regions: string[];
  batches: string[];
}) {
  return (
    <form method="get" className="card flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-600">
        Search
        <input
          name="q"
          defaultValue={values.q ?? ''}
          placeholder="company or role"
          className="input mt-1 block w-44"
        />
      </label>
      <label className="text-xs text-slate-600">
        Status
        <select name="status" defaultValue={values.status ?? ''} className="input mt-1 block">
          <option value="">any</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Min score
        <input
          name="minScore"
          type="number"
          min={0}
          max={5}
          step={0.5}
          defaultValue={values.minScore ?? ''}
          className="input mt-1 block w-20"
        />
      </label>
      <label className="text-xs text-slate-600">
        Region
        <select name="region" defaultValue={values.region ?? ''} className="input mt-1 block">
          <option value="">any</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Remote
        <select name="remote" defaultValue={values.remote ?? ''} className="input mt-1 block">
          <option value="">any</option>
          <option value="yes">remote</option>
          <option value="no">on-site</option>
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Batch
        <select name="batch" defaultValue={values.batch ?? ''} className="input mt-1 block">
          <option value="">any</option>
          {batches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Found since
        <input
          name="since"
          type="date"
          defaultValue={values.since ?? ''}
          className="input mt-1 block"
        />
      </label>
      <button type="submit" className="btn btn-primary">
        Filter
      </button>
      <a href="/" className="btn">
        Reset
      </a>
    </form>
  );
}
