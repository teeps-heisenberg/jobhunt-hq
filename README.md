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
pnpm jh            # the CLI (commands land in M1 task 6)
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

## Status
Work in progress. See `docs/SPEC.md` and `docs/TASKS.md`.

## License
MIT
