# JobHunt HQ: instructions for Claude Code

You are working in an open-source job-search kit. There are two kinds of work here:
1. **Building the kit itself** (TypeScript monorepo, Next.js dashboard). Follow `docs/SPEC.md` and `docs/TASKS.md`.
2. **Running the kit for a user** (skills in `.claude/skills/`). Follow the hard rules below every time.

## Hard rules when running the kit
- Never click Submit, Send, Apply, Accept or any consent checkbox. Never type passwords, national IDs, dates of birth or payment details. Fill fields, then stop and list what is left.
- Never invent experience. Generate only from `data/master.json` and `config/profile.yaml`. Every sentence that adds a fact not in those files goes in a **Verify before sending** list.
- Respect `config/rules.yaml` (locations, visa rules, years bar, salary bands, style rules, caps). If a rule and a user request conflict, ask.
- If a posting or form forbids AI-written answers, say so and do not write those answers.
- Use official careers pages and public ATS endpoints. No login-walled scraping, no CAPTCHA solving, no LinkedIn automation.
- Write to the database only through the CLI (`pnpm jh ...`), never by editing SQLite directly.
- Keep personal data local: `config/*.yaml` (except `*.example.yaml`), `data/` and `output/` are git-ignored. Never commit them.

## Repo layout
```
packages/core      zod schemas, scoring, dedupe, Drizzle + SQLite tracker, CLI (pnpm jh)
packages/resume    master.json schema, variant builder, DOCX render, PDF via LibreOffice, page check, style lint
apps/dashboard     Next.js 15 + Tailwind dashboard on the same SQLite DB
.claude/skills     workflows: setup-profile, job-search, score-job, tailor-resume, pack, apply-assist, follow-ups
.claude/agents     subagents: job-scout, claim-checker
config/            *.example.yaml committed; user copies are ignored
data/examples      a fictional master.json for tests and demos
scripts/resume     prototype JS renderers to port into packages/resume
```

## Conventions
- TypeScript strict, ESM, pnpm workspaces. zod at every boundary (CLI input, skill output, DB rows).
- Small commits with conventional messages (`feat(core): ...`). Tests next to code (`*.test.ts`, Vitest).
- No em dashes in any generated application text (style lint enforces it).
- The definition of done for a task: typecheck, lint and tests pass; the relevant README section is updated.

## Useful commands (once M1 is done)
- `pnpm jh add-jobs <file.json>`: validate, dedupe and insert scored jobs
- `pnpm jh set-status <id> <status> [--note ...]`
- `pnpm jh tailor <id> --variant <variant.json>`: render CV DOCX and PDF, check pages, lint style
- `pnpm jh list --status Shortlisted --min-score 4`
- `pnpm dev`: dashboard on http://localhost:3000
