# JobHunt HQ

**An open-source, Claude Code native job-search kit.** Describe yourself once. Claude Code finds roles you can realistically get, scores them honestly, tailors a truthful two-page CV and note for each, helps fill application forms (without ever submitting), and tracks everything in a local dashboard.

> Built from a real three-week test run: 509 roles tracked across 378 companies, 132 tailored CVs, 53 applications, 8 responses.

## Why
Most job tools match keywords. JobHunt HQ filters for what actually blocks you (visa, location, years bar, language) and tells you the gap before you spend an hour on an application.

## How it works
```
/setup  →  profile.yaml + rules.yaml + master.json
/search →  parallel job-scout agents → dedupe → score → tracker (SQLite)
/tailor →  variant from master.json → DOCX + PDF → page check → claim check → pack.md
/apply  →  Playwright fills the form → stops before Submit → you review and submit
dashboard (localhost:3000) → table, kanban, follow-ups, stats
```

## Safety principles
- **You submit.** It never clicks Submit, ticks consent boxes, or types passwords or IDs.
- **No invented claims.** Every new sentence is listed for you to verify.
- **Local first.** Your profile, CVs and tracker never leave your machine.
- **Plays fair.** Official careers pages and public ATS boards only. No login-walled scraping, no CAPTCHA solving, no LinkedIn automation.

## Quick start
_Coming in v0.1.0._ Clone the repo, run `pnpm install`, open Claude Code in the folder, and run `/setup`.

## Development
pnpm workspaces: `packages/core`, `packages/resume`, `apps/dashboard`. Node 22 and pnpm 12.

```
pnpm install
pnpm typecheck     # tsc -b across every workspace
pnpm lint          # ESLint (flat config, typescript-eslint)
pnpm format:check  # Prettier, code files only
pnpm test          # Vitest, including the .gitignore guard in tests/
pnpm check         # all of the above, same as CI
pnpm jh            # the CLI, see below
```

CI runs the same four checks on every push and pull request (`.github/workflows/ci.yml`).

### Core package
`packages/core/src/schema.ts` holds the zod schemas for every boundary: `JobInput` (what a job-scout returns and `jh add-jobs` accepts), `Job`, `JobStatus`, `Artifact`, `Event`, `SearchRun`, `Profile` and `Rules`. `loadConfig()` in `config.ts` reads `config/profile.yaml` and `config/rules.yaml`, fills defaults, and throws a `ConfigError` that names the file and every invalid field. The example files in `config/` are validated in tests.

### Tracker database
SQLite via Drizzle and better-sqlite3, at `data/jobhunt.db` (override with `JH_DB`). `openDb()` in `packages/core/src/db/client.ts` creates the file and applies the SQL migrations in `packages/core/drizzle/` on every open. Tables: `jobs`, `artifacts`, `events` (the audit trail), `searches`. Repository functions in `db/repo.ts` (`insertJobs`, `listJobs`, `setStatus`, `addNote`, `addArtifact`, `recordSearch`, `getStats`) validate every row with zod on the way out. After changing `db/tables.ts`, run `pnpm --filter @jobhunt-hq/core db:generate` and commit the new migration.

### Dedupe
`packages/core/src/dedupe.ts` decides whether a scouted posting is already tracked, strongest evidence first: the same ATS job id (Greenhouse, Lever, Ashby, Workable, Workday, SmartRecruiters), the same normalised URL, the same normalised company + title + location, then a fuzzy title match at the same company and location (reposts with small wording changes). Seniority words never merge. The same title at the same company in another location is reported as a regional variant, not dropped. `makeJobId()` builds the `company-title-city` slug used as the tracker id.

### Scoring
`packages/core/src/scoring.ts` computes the number; the LLM writes the why and gap text. `findBlockers()` returns a reason for each hard blocker (years above `rules.experience.maxYearsBar`, excluded location, security clearance, citizenship or work authorisation the user lacks, a required language below professional level); any blocker means `Skipped` with score 0. Otherwise five factors (skills overlap with the master CV, years fit, location and visa, recency, salary against `rules.salary`) are weighted by `rules.scoring.weights` into a 0 to 5 score, and `rules.scoring.shortlistAt` (default 4) decides between `Shortlisted` and `New`. Every factor carries a one-line note so the dashboard can explain the number.

### CLI (`pnpm jh`)
Skills call these; nothing else writes to the database.

```
pnpm jh add-jobs <file.json> [--focus text] [--dry-run] [--json]
pnpm jh list [--status S]... [--min-score N] [--company C] [--source S] [--batch B] [--due] [--limit N] [--format table|json|ids]
pnpm jh set-status <id> <status> [--note text] [--follow-up YYYY-MM-DD]
pnpm jh note <id> <text>
pnpm jh score <id> [--from file.json] [--why text] [--gap text] [--visa-note text] [--min-years N] [--requirements "a, b"]
pnpm jh show <id> [--json]
pnpm jh stats [--json]
pnpm jh export-csv [file]
pnpm jh import-cv <file.docx|.pdf|.txt> [--out file.txt]
pnpm jh doctor [--json]
pnpm jh sources [--json]
pnpm jh scout-brief <group> [--focus text] [--out file]
```

`add-jobs` accepts a JSON array of scout rows or `{jobs, rejected}`, validates them against `JobInput`, dedupes against the tracker and within the batch, scores each new row with the rules and `data/master.json`, and records a search run. Moving a job to `Applied` sets the follow-up date from `rules.followUpDays` unless `--follow-up` is given. Global options: `--db <path>` (or `JH_DB`), `--config-dir <dir>`, `--master <file>`.

### Resume package
`packages/resume` turns `data/master.json` into a tailored CV without inventing anything:
- `Master` (zod) is the master CV schema; `data/examples/master.json` is a fictional example.
- `buildVariant(master, spec)` applies a `VariantSpec` (title, summary by key or text, skill order and overrides, project order and cap, bullets per position) and returns the resume plus `newClaims`: every piece of text that is not in the master, for the "Verify before sending" list.
- `renderDocx(resume)` is the prototype `scripts/resume/build-docx.js` ported to TypeScript (Letter, Arial, navy headings).
- `convertToPdf(docx)` runs `soffice --headless --convert-to pdf`. It needs LibreOffice: install it or set `SOFFICE` to the binary. `checkPages(pdf, rules.style.maxPages)` counts pages with pdf-lib and insists on the exact count.
- `lintText(text, { bannedCharacters, bannedPhrases })` flags em dashes by default plus anything from `rules.style`, with line and column.
- `renderCoverLetterDocx(letter)` and `renderDocumentDocx(doc)` are the other two prototype renderers ported: a one-page cover letter and a generic title, sections, bullets and key-value document. `documentToMarkdown` renders the same document as Markdown.
- `renderPackMarkdown(pack)` is the `pack.md` template (SPEC F6): posting links and file paths, posting rules to read first, the cover note, why this role, screening answers with their source, and the "Verify before sending" list. `packFolder(company, role)` gives `output/<company>/<role>`.

### Setup skill (`/setup`)
`.claude/skills/setup-profile/SKILL.md` walks a new user from an existing CV to validated config: `pnpm jh import-cv <cv>` extracts the text (DOCX via the zip, PDF via pdf.js) into `data/imports/`, Claude drafts `data/master.json` from it without embellishing, interviews for what the CV does not hold, writes `config/profile.yaml` and `config/rules.yaml` from the examples, and `pnpm jh doctor` validates all three files, opens the database and checks for LibreOffice.

### Search skill (`/search`)
`.claude/skills/job-search/SKILL.md` fans out one `job-scout` subagent per source group. `pnpm jh sources` lists the groups (`bigTech`, `ats`, `remote`, `research`, `custom`) with their enabled state from `rules.sources`; `pnpm jh scout-brief <group>` writes `data/scout/<group>.md`, the brief every scout reads: where to look, the candidate summary, the rules in priority order with the recency cut-off date, every tracked role to skip, and the exact JSON output shape. Scouts return JSON only; `pnpm jh add-jobs` validates, dedupes, scores and stores it.

### Score skill (`/score`)
`.claude/skills/score-job/SKILL.md` adds a pasted URL through `jh add-jobs` when needed, reads the posting against the rules with the hard blockers first, writes `data/scout/<id>.score.json` (why, gap, visa note, the posting's must-haves as it names them, minimum years, salary, posting date) and runs `pnpm jh score <id> --from <that file>`. The engine computes the number and suggests the status; the skill never sets a score by hand, and a disputed number is fixed by correcting the inputs or the rules.

## Status
Work in progress. See `docs/SPEC.md` and `docs/TASKS.md`.

## License
MIT
