---
name: job-search
description: Find new roles that fit the user's profile and rules, in parallel across source groups, deduped against the tracker. Use for "find jobs", "search", "pull new roles from big tech".
---
# Job search
1. Load `config/profile.yaml` and `config/rules.yaml`. Run `pnpm jh list --format ids` to get what is already tracked.
2. Pick source groups for the request (default: all enabled in rules.sources):
   - big tech careers sites (Google, Meta, Amazon, Microsoft, etc.)
   - startups via public ATS boards (Greenhouse, Lever, Ashby, Workable)
   - remote boards (rules.sources.remote)
   - research institutes and international organisations (if rules.includeResearch)
   - user-added boards (rules.sources.custom)
3. Spawn one `job-scout` subagent per group **in parallel**. Give each the profile summary, the rules, the tracked IDs file and its group.
4. Collect the rows, validate them against the Job schema, then write them with `pnpm jh add-jobs <tmp.json>`. The CLI dedupes and scores.
5. Report to the user:
   - the top picks (score, role, where, why, gap)
   - what was skipped and why (one line each)
   - coverage gaps, i.e. sources that could not be read

Never log in to a site, never solve a CAPTCHA, never use LinkedIn automation.
