---
name: score-job
description: Score one posting against the user's master CV and rules, with why-it-fits and main-gap text. Use when adding a job manually or re-scoring.
---
# Score a job
1. Read the posting, `data/master.json` and `config/rules.yaml`.
2. Check the hard blockers first: citizenship or nationality, clearance, a required language the user lacks, minimum years more than the rules' max bar, location not allowed. Any of these means the status is Skipped, with the reason.
3. Otherwise, write:
   - **why**: one line, evidence from the master CV
   - **gap**: one line, honest
   - **visaNote**
4. Run `pnpm jh score <id> --why ... --gap ...`. The engine computes the number from rules weights; never make the score up.
