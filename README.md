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

## Status
Work in progress. See `docs/SPEC.md` and `docs/TASKS.md`.

## License
MIT
