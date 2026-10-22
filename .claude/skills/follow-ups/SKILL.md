---
name: follow-ups
description: List due follow-ups and draft short, polite follow-up messages. Never sends anything.
---
# Follow-ups
1. `pnpm jh list --follow-up-due`.
2. For each due role, draft a three- or four-sentence message: the role, the date applied, one line of fit, and a question about next steps. No em dashes.
3. Show the drafts. The user sends them. After they confirm, run `pnpm jh note <id> "follow-up sent"` and push follow_up_at forward per rules.
