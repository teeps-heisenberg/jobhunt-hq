# JobHunt HQ: product spec (v0.1)

An open-source, Claude Code native job-search kit. You describe yourself once (profile, rules, master résumé). Claude Code then finds roles that fit, scores them honestly, tailors a two-page résumé and cover note per role, helps fill application forms in a browser **without ever submitting**, and tracks everything in a local dashboard.

It grew out of a personal test run (29 Sep to 21 Oct 2026): 509 roles tracked across 378 companies, 132 tailored CVs, 53 applications, 8 responses. This repo turns that workflow into something anyone can run with their own preferences.

## 1. Users and jobs to be done
- **Primary:** software engineers (and other knowledge workers) running an active search, especially people who apply across borders and need to filter for visa sponsorship, remote eligibility and years-of-experience bars.
- **Jobs to be done:**
  1. Find roles I can realistically get, not just roles that match keywords.
  2. Spend my time only on the best ones: score, explain fit, show the gap.
  3. Produce a tailored, truthful CV and note per role in minutes.
  4. Get through long application forms quickly, keeping control of what is sent.
  5. Never lose track of what I applied to, when to follow up, and what each recruiter said.

## 2. Principles (non-negotiable)
1. **Human submits.** The kit never clicks Submit, Send or Apply, never accepts terms or consent boxes, and never types passwords, IDs or payment details. It fills fields and stops.
2. **No invented claims.** Every CV and note is generated only from `data/master.json` and `config/profile.yaml`. Any sentence that is new relative to the master file is listed in a "verify before sending" block.
3. **Respect sites.** Use official careers pages, public ATS endpoints (Greenhouse, Lever, Ashby, Workday) and normal search. No scraping behind logins, no CAPTCHA solving, no bulk auto-apply, no LinkedIn automation that breaks its terms.
4. **Local first.** All personal data stays on the user's machine (`data/` is git-ignored). Nothing is uploaded except what the user sends to employers.
5. **Honest scoring.** A score always comes with "why it fits" and "main gap". Hard blockers (citizenship, clearance, language, years far above the user's) mean Skip, not a low score.
6. **Respect employers' AI rules.** If a posting or form says not to use AI for answers, the kit flags it and does not write those answers.

## 3. MVP scope
| # | Feature | Notes |
|---|---------|-------|
| F1 | **Setup** (`/setup`) | Interview-style skill that writes `config/profile.yaml`, `config/rules.yaml` and `data/master.json` from the user's existing CV (PDF/DOCX import) plus answers. |
| F2 | **Search** (`/search [focus]`) | Spawns parallel `job-scout` subagents, one per source group (big tech, startups via ATS, remote boards, research institutes, user-added boards). Dedupes against the tracker; returns structured rows. |
| F3 | **Score** | Rules-driven: location/visa eligibility, years bar, must-haves vs the master CV, salary band, recency. Output: score 0–5, why, gap, visa note, status suggestion (Shortlisted / New / Skipped). |
| F4 | **Tracker** | SQLite database (`data/jobhunt.db`) with a Next.js dashboard at `localhost:3000`: table and kanban (New → Shortlisted → Applied → Responded → Interview → Offer / Rejected / Skipped), filters, follow-up dates, links to generated files. |
| F5 | **Tailor** (`/tailor <job-id>`) | Builds a variant from `master.json` (title, summary, skill order, project order, bullet emphasis), renders DOCX with `docx` and PDF with LibreOffice, checks the page count, runs style rules (e.g. no em dashes), runs the `claim-checker` subagent, and saves to `output/<company>/`. |
| F6 | **Pack** | Per role: cover note, "why this role", screening answers (years, salary per rules, notice), a verify list. Markdown in `output/<company>/pack.md`. |
| F7 | **Apply assist** (`/apply <job-id>`) | Uses Playwright MCP to open the form, fill known fields from profile and pack, and stop. Prints what was filled and what is left (uploads, consent, Submit). |
| F8 | **Follow-ups** (`/followups`) | Lists due follow-ups and drafts short, polite messages. Never sends them. |
| F9 | **Status updates** | `/applied <job-id>`, `/responded <job-id> "note"`: one-line status changes from the terminal. |

**Out of MVP:** hosted multi-user web app, email-inbox parsing, auto-submission of any kind, LinkedIn Easy Apply automation, browser extension.

## 4. Architecture
```
Claude Code (user's terminal)
  ├─ CLAUDE.md, .claude/skills/*, .claude/agents/*    ← the "brain": workflows and rules
  ├─ MCP: Playwright (forms), optional filesystem/fetch
  └─ calls local CLI:  pnpm jh <command>             ← deterministic work
        ├─ packages/core   (TypeScript): schema (zod), scoring, dedupe, tracker DB (SQLite via Drizzle)
        ├─ packages/resume (TypeScript): variant builder, DOCX render (docx), PDF (LibreOffice), page check, style lint
        └─ apps/dashboard  (Next.js 15, React, Tailwind): reads/writes the same SQLite DB
config/   profile.yaml, rules.yaml        (user, git-ignored; *.example.yaml committed)
data/     master.json, jobhunt.db         (user, git-ignored)
output/   <company>/<role>/cv.pdf, cv.docx, pack.md   (git-ignored)
```
**Split of responsibilities:** the LLM does judgment (reading postings, scoring rationale, writing summaries and notes). The TypeScript CLI does everything that must be exact and repeatable: schema validation, dedupe, DB writes, rendering, page counts, style lint. Skills call the CLI; they never hand-edit the DB.

## 5. Data model (SQLite, Drizzle)
- `jobs`: id (slug), company, role, location, region, remote (bool), visa_note, url, apply_url, salary_text, score (real), status, found_at, posted_at, why, gaps, source, batch, applied_at, follow_up_at, notes, created_at, updated_at.
- `artifacts`: id, job_id, kind (cv_pdf, cv_docx, cover, pack), path, created_at, verify_items (json).
- `events`: id, job_id, at, type (status_change, note, follow_up_sent), payload (json). This is the audit trail for the dashboard timeline.
- `searches`: id, at, focus, sources (json), found, new, skipped.

## 6. Config files (examples ship in the repo)
- `profile.yaml`: name, contact, links, citizenship, current location, years of experience, languages, target titles, notice period, current and target salary, "never claim" list.
- `rules.yaml`: locations allowed (remote-from-country, relocation hubs), visa rules per country, max years bar, hard blockers, salary bands per country/remote, style rules (no em dashes, CV max pages, project order), sources to include and exclude, Google-style application caps.
- `master.json`: the single source of truth CV: contact, summary variants, skills by group, experience with bullets, projects, education, certifications. JSON schema in `packages/resume/schema.ts`.

## 7. Commands (Claude Code slash commands via skills)
`/setup`, `/search [focus]`, `/shortlist`, `/tailor <id>`, `/pack <id>`, `/apply <id>`, `/applied <id>`, `/responded <id> "note"`, `/followups`, `/stats`.

## 8. Acceptance criteria (MVP)
1. A new user can go from clone to first tailored CV in under 30 minutes using `/setup` with their own CV.
2. `/search` with three parallel scouts returns deduped, scored rows into the DB, and the dashboard shows them without a refresh hack.
3. `/tailor` produces DOCX and PDF that are exactly `rules.maxPages` pages, contain no banned characters, and list every new claim under "verify".
4. `/apply` fills a Greenhouse, a Lever and an Ashby test form and stops before Submit. A Playwright test asserts that Submit was never clicked.
5. No file under `config/`, `data/` or `output/` is tracked by git (a test checks `.gitignore`).
6. Unit tests: scoring rules, dedupe, variant builder, page check, style lint. CI on GitHub Actions: typecheck, lint, test.

## 9. Milestones
- **M1 (day 1–2):** monorepo, core schema, DB and CLI, resume package ported from the prototype scripts, examples, tests.
- **M2 (day 3):** skills and subagents (setup, search, score, tailor, pack), claim checker.
- **M3 (day 4):** dashboard (table, kanban, job drawer with artifacts and timeline).
- **M4 (day 5):** apply-assist with Playwright MCP, follow-ups, README with GIFs, v0.1.0 release.

## 10. Risks
- **Job sites change:** keep sources pluggable and prefer ATS JSON endpoints.
- **Hallucinated claims:** claim-checker subagent plus the verify list, and the human reads before sending.
- **Misuse as a spam bot:** no auto-submit; a daily application cap in rules; the README states the intended use.
- **PDF rendering differences:** document the LibreOffice requirement and add a Docker option.
