/**
 * `pnpm jh <command>`: the deterministic side of JobHunt HQ.
 * Commands arrive in M1 task 6. Until then this prints the planned usage.
 */
const USAGE = `jh: JobHunt HQ CLI (commands arrive in M1 task 6)

  jh add-jobs <file.json>              validate, dedupe and insert scored jobs
  jh list [--status S] [--min-score N] list tracked jobs
  jh set-status <id> <status> [--note] change a job's status
  jh note <id> "<text>"                add a note to a job
  jh stats                             funnel and response stats
  jh export-csv [file]                 export the tracker
`;

process.stdout.write(USAGE);
