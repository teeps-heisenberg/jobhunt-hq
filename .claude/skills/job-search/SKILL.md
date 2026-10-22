---
name: job-search
description: Find new roles that fit the user's profile and rules, in parallel across source groups, deduped against the tracker. Use for "find jobs", "search", "pull new roles from big tech".
---
# Job search (`/search [focus]`)

The CLI decides the source groups and writes one brief per group; you fan out one `job-scout` subagent per brief, then hand the rows back to the CLI, which validates, dedupes, scores and stores them.

## 1. Prepare
1. Run `pnpm jh doctor`. If profile, rules or master do not validate, stop and suggest `/setup`.
2. Run `pnpm jh sources`. It lists the source groups with `enabled` from `rules.sources`. If the user named a group ("from big tech", "ATS only"), use only that one; otherwise use every enabled group.
3. For each chosen group run `pnpm jh scout-brief <group> [--focus "<focus>"]`. It writes `data/scout/<group>.md` (the brief: where to look, candidate summary, rules, tracked roles, output shape) and prints the path.

## 2. Fan out
Spawn one `job-scout` subagent per brief, all in the same message so they run in parallel. Each prompt is one line: "Read `<brief path>` and follow it. Return JSON only." Do not paste the rules into the prompt; the brief has them.

## 3. Collect and store
1. For each scout result, save the JSON as `data/scout/<group>.result.json`. If a result is not valid JSON, ask that scout once to return JSON only; if it still fails, record the group as a coverage gap and continue.
2. Run `pnpm jh add-jobs data/scout/<group>.result.json --focus "<focus>"` per group. The CLI validates rows against the Job schema (fix or drop rows it rejects; never hand-edit the database), dedupes against the tracker and within the file, scores each row, inserts it as Shortlisted, New or Skipped, and records the search run.
3. Keep the `rejected` lists from each result for the report.

## 4. Report
Run `pnpm jh list --status Shortlisted --status New --batch <today>-<group>` for each group, or `pnpm jh list --min-score 4` for the top picks, then tell the user:
- the top picks: score, role, company, location, why, gap, visa note (one line each)
- what was skipped and why: CLI blockers plus the scouts' `rejected` reasons (one line each)
- duplicates and regional variants the CLI reported
- coverage gaps: sites a scout could not read, groups that failed
- the next step: `/tailor <id>` for a pick, or `pnpm jh set-status <id> Skipped` to drop one

## Rules
- Never log in to a site, never solve a CAPTCHA, never use LinkedIn automation, never auto-apply.
- Do not change a score by hand. If a score looks wrong, say why; `pnpm jh score <id> --why ... --gap ...` re-runs the engine with better inputs.
- `data/scout/` is git-ignored working space; it is safe to overwrite on each run.
