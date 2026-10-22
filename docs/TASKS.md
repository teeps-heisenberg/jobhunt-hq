# Build plan for a Claude Code session

Work through these in order. Each task is one or two commits. After each one, run `pnpm typecheck && pnpm lint && pnpm test` and stop to show the diff summary.

## M1: foundation
1. **Monorepo:** pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest, GitHub Actions CI (typecheck, lint, test). `.gitignore` covering `config/*.yaml` (except `*.example.yaml`), `data/*` (except `data/examples`), `output/`, `*.db`. Add a test asserting these ignore rules.
2. **Core schemas** (`packages/core/src/schema.ts`): Job, JobStatus, Artifact, Event, SearchRun, Profile, Rules, with zod. Load and validate the YAML config.
3. **Tracker DB:** Drizzle and better-sqlite3, migrations for jobs, artifacts, events and searches. Repository functions with tests.
4. **Dedupe:** normalise company and title, compare URL and ATS job IDs, fuzzy-match title within the same company and location. Tests with tricky cases: the same role under different regional IDs, and reposts.
5. **Scoring:** a rules engine for hard blockers (citizenship, clearance, language, years far above the user's) that outputs Skipped with a reason, plus weighted factors (skills overlap, years fit, location/visa, recency, salary). The LLM supplies the why and gap text; the engine supplies the number. Tests.
6. **CLI** (`pnpm jh`): `add-jobs`, `list`, `set-status`, `note`, `stats`, `export-csv`.
7. **Resume package:** port `scripts/resume/build-docx.js` to TypeScript. Add:
   - a master.json schema
   - `buildVariant(master, variantSpec)`: title, summary, skill order and overrides, project order, bullet overrides
   - DOCX render
   - PDF via `soffice --headless`
   - a page counter (pdf-lib)
   - a style lint (banned characters and phrases from rules)

   Golden tests use `data/examples/master.json`.
8. **Cover letter and pack renderers:** port `build-cover-letter.js` and `build-document.js`. `pack.md` template.

## M2: agent workflows
9. `setup-profile` skill: import an existing CV (DOCX or PDF to text), interview for gaps, then write the three config files and validate them with the CLI.
10. `job-scout` subagent and `job-search` skill: source groups, parallel fan-out, JSON output validated against the Job schema, then `pnpm jh add-jobs`.
11. `score-job` skill: reads the posting and the rules, writes why, gap and visa note, and calls the engine for the number.
12. `tailor-resume` skill and `claim-checker` subagent: produce variantSpec, render, and check that every sentence is traceable to master.json; emit the verify list.
13. `pack` step: cover note, why-this-role, screening answers per rules.

## M3: dashboard
14. Next.js 15 app router, Tailwind, server actions reading and writing through `packages/core`.
15. Views:
    - table with filters (status, score, region, remote, batch, date)
    - kanban drag between statuses
    - job drawer with posting link, why/gap, artifacts, timeline from events, follow-up date
    - stats page (funnel, responses by source)
16. Empty states and a demo mode seeded from `data/examples`.

## M4: apply assist and release
17. `apply-assist` skill using Playwright MCP:
    - map form fields from the profile and pack
    - upload stays manual by default
    - stop before Submit, then print what was filled and what is left

    Add a Playwright test against local fixture forms (Greenhouse, Lever and Ashby clones) asserting Submit is never clicked.
18. `follow-ups` skill: list due follow-ups and draft messages without sending them.
19. README:
    - hero GIF
    - quick start
    - how it works (diagram)
    - safety principles
    - configuration reference
    - FAQ
    - contributing

    Then add CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates and LICENSE (MIT).
20. Tag v0.1.0 and publish the GitHub release with notes.
