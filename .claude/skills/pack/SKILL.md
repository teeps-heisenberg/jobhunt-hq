---
name: pack
description: Write the application pack for one tracked job: cover note, why this role, screening answers from the rules, and the verify list, as output/<company>/<role>/pack.md plus cover.docx. Use after /tailor, or for "write the cover note for X".
---
# Application pack (`/pack <id>`)

The pack is what the user reads before they apply: a cover note to paste, the reasons the role fits, the screening answers, and every sentence they must verify first. The CLI fills in the facts that come from the rules; you write the prose, from `data/master.json` and the posting only.

## 1. Read
`pnpm jh show <id>` for the job, its artifacts (the tailored CV and its verify items) and notes. Fetch the posting if you have not already. Read `data/master.json` and `config/profile.yaml`.

If the posting says not to use AI for written answers, do not write the cover note or screening prose. Tell the user, and write a pack with `notes` explaining this and `coverNote` set to a single line: "Write by hand: the posting forbids AI-written answers."

## 2. Write `data/scout/<id>.pack.json`
```json
{
  "coverNote": ["<para 1: the role and the one strongest reason>", "<para 2: two pieces of evidence from master.json, named>", "<para 3: availability and a short close>"],
  "whyThisRole": ["<evidence line>", "<evidence line>", "<evidence line>"],
  "screening": [{ "question": "<question the form asks>", "answer": "<answer>", "source": "<master.json or profile field>" }],
  "notes": ["<a rule from the posting that matters at apply time>"],
  "verify": [{ "text": "<sentence or fragment>", "where": "cover.para 2", "reason": "<why it needs a look>" }],
  "to": "Hiring Team, <company>",
  "re": "<role as the posting names it>"
}
```
Rules:
- Cover note: three short paragraphs, under 180 words, in the posting's language. Every fact, tool and number comes from `master.json` as written there. No superlatives, no claims about the company you cannot see on the posting.
- `whyThisRole`: three to five lines, each pointing at a master entry (position, project or skill group).
- `screening`: only the questions the form actually asks, beyond the standard ones. The CLI adds years, salary (from `rules.salary` for the job's location, with "flexible"), notice period and work authorisation itself; add one of those only to override it, using the same question text.
- `notes`: what the user must know before clicking anything: a required cover letter, a forbidden-AI rule, a form that needs a portfolio link, a visa statement.
- `verify`: every sentence in your cover note or answers that is not word-for-word supported by `master.json` or `profile.yaml`, plus the claim-checker's `new` items from the tailor step. The CLI merges in what `jh tailor` flagged on the CV.
- Plain ASCII punctuation. No em dashes.

## 3. Render
`pnpm jh pack <id> --from data/scout/<id>.pack.json`

It writes `output/<company>/<role>/pack.md` and `cover.docx`, merges the screening answers, merges the verify list, lints the text with `rules.style`, records both files as artifacts, and prints the result. Fix any lint issue in the JSON and rerun until it prints `OK`.

## 4. Report
Paste the cover note, then list: the files, the screening answers with their sources, and **Verify before sending** in full. Remind the user that nothing has been sent and that `/apply <id>` fills the form but never submits.
