---
name: follow-ups
description: List due follow-ups and draft short, polite follow-up messages. Never sends anything.
---
# Follow-ups (`/followups`)

You draft; the user sends. Nothing in this skill emails, messages or posts anything.

## 1. List
`pnpm jh followups --json` (add `--days 7` to include the coming week). Each row has the job, status, applied date, follow-up date, days overdue, how many follow-ups were already sent, the last event and the notes. If the list is empty, say so and stop.

## 2. Draft, one message per due job
Read `pnpm jh show <id>` for the context (why it fits, notes, timeline), then write a message of three or four sentences, in the posting's language:
1. the role and the date applied (from `appliedAt`)
2. one line of fit, taken from the job's `why` or `data/master.json`, no new claims
3. a question about next steps or the timeline
4. thanks and the name from `config/profile.yaml`

Rules:
- Subject line first, then the body. Under 90 words.
- Second follow-up (`followUpsSent` is 1): shorter, acknowledge the earlier message, no pressure. Third or more: suggest moving the job to Rejected instead of writing again, unless the user wants one last note.
- If the last event is a `note` from the user (for example "recruiter said two weeks"), respect it: say that the date may be too early and offer to push the follow-up instead.
- Plain ASCII punctuation. No em dashes.

## 3. Show and wait
Show every draft with its job id. Do not send, do not open an email client, do not record anything yet.

## 4. After the user confirms they sent one
`pnpm jh followup-sent <id> [--channel email|linkedin|portal] [--note "..."]`

It records a `follow_up_sent` event and sets the next follow-up date from `rules.followUpDays` (or `--follow-up YYYY-MM-DD`). If the user got a reply instead, use `pnpm jh set-status <id> Responded --note "..."`.
