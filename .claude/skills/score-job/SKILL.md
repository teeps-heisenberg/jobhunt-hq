---
name: score-job
description: Score one posting against the user's master CV and rules, with why-it-fits and main-gap text. Use when adding a job manually or re-scoring.
---
# Score a job (`/score <id or URL>`)

The engine computes the number from `config/rules.yaml`; you supply the inputs it cannot read (requirements, years, salary, posting date) and the two lines a human reads (why, gap). Never set a score by hand.

## 1. Get the job into the tracker
- Tracked already (`pnpm jh show <id>` works): continue.
- A URL the user pasted: fetch the posting, then write one row in the scout JSON shape (see the output block in any `data/scout/<group>.md`, or the `JobInput` schema in `packages/core/src/schema.ts`) to `data/scout/manual.json` with `"source": "manual"`, and run `pnpm jh add-jobs data/scout/manual.json`. The CLI dedupes, scores a first time and prints the id. If it reports a duplicate, use the existing id instead.

## 2. Read the posting against the rules
Read the posting, `config/rules.yaml`, `config/profile.yaml` and `data/master.json`. Check the hard blockers first, in this order, quoting the posting:
1. citizenship, nationality or work-authorisation requirements the user does not meet
2. security clearance
3. fluency required in a language from `rules.hardBlockers.languagesRequired` that the profile lists below professional
4. minimum years above `rules.experience.maxYearsBar`
5. location not allowed (`rules.locations`)

Any of these means Skipped. Still run step 3 so the reason is stored.

## 3. Write the score file
Write `data/scout/<id>.score.json`:
```json
{
  "why": "one line: the closest evidence in master.json, named (project, position, tool)",
  "gap": "one line: the main gap, honestly; or the blocker, quoted",
  "visaNote": "what the posting says about sponsorship or eligibility, or 'not mentioned'",
  "minYears": 3,
  "keyRequirements": ["TypeScript", "PostgreSQL", "React"],
  "salaryText": "EUR 50-60K",
  "postedAt": "2026-10-20"
}
```
- `keyRequirements`: the must-haves as the posting names them, five to ten items. The engine matches them against the master skill names, so use the posting's own words (`PostgreSQL`, not `databases`).
- `minYears`: the stated minimum, or omit if the posting gives none. Do not guess.
- `salaryText` and `postedAt`: only if the posting states them.
- Plain ASCII punctuation. No em dashes.

## 4. Run the engine
`pnpm jh score <id> --from data/scout/<id>.score.json`

It prints the score, the status it suggests (Skipped, Shortlisted or New) and one line per factor (skills, years, location, recency, salary) with its note. A status the user set by hand (Applied, Interview, ...) is kept.

## 5. Report
One block, no more:
- score and status, with the blocker if any
- why and gap as stored
- the factor that cost the most points and what would change it (for example two missing requirements)
- visa note
- next step: `/tailor <id>` or `pnpm jh set-status <id> Skipped --note "..."`

If the user disagrees with the number, do not override it. Check the inputs: a requirement phrased differently from the master skill names, a wrong `minYears`, a missing salary band in `rules.salary`, or a weight in `rules.scoring.weights`. Fix the input or suggest the rules change, then re-run.
