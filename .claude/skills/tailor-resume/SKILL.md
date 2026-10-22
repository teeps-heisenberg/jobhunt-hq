---
name: tailor-resume
description: Build a truthful, tailored CV (DOCX + PDF) and cover note for one tracked job. Use for "make a CV for X", "tailor my resume".
---
# Tailor a CV (`/tailor <id>`)

Everything in the CV must come from `data/master.json`. You may reorder, select and re-phrase; you may not add tools, numbers, responsibilities or levels of experience. Whatever is new goes under **Verify before sending**, and the user decides.

## 1. Read
1. `pnpm jh show <id>`: company, role, location, url, why, gaps, visa note.
2. Fetch the posting. Note the must-haves, the language, and any rule such as "no AI-written applications". If the posting forbids AI assistance for the CV, stop and tell the user; render only the untailored master (`pnpm jh tailor <id>` without a spec) if they still want a file.
3. Read `data/master.json` and `config/rules.yaml` (style: maxPages, bannedCharacters, bannedPhrases, projectOrder).

## 2. Write the variant spec
Write `data/scout/<id>.variant.json` following `VariantSpec` in `packages/resume/src/schema.ts`:
```json
{
  "title": "Backend Engineer | TypeScript, Node.js, PostgreSQL",
  "summary": "ai",
  "skills": { "order": ["Backend", "Data & Cloud"], "overrides": { "Backend": "Node.js, NestJS, REST, GraphQL, FastAPI" } },
  "projects": { "order": ["ProjectA"], "max": 3 },
  "experience": [
    { "company": "Example SaaS Ltd", "bullets": ["<existing bullet, re-phrased toward the posting>", "<existing bullet>"] }
  ]
}
```
Rules:
- `title`: in the posting's language, built from the master title and skill names only.
- `summary`: a key of `master.summaries` when one fits; otherwise one or two sentences that lead with the closest evidence. Free text is reported as a claim.
- `skills.order`: the posting's stack first. `skills.overrides` may reorder or drop items inside a group; every item must exist somewhere in the master skills.
- `projects.order`: `rules.style.projectOrder` unless the posting clearly needs another; `max` to fit the page limit.
- `experience`: at most three bullets re-phrased toward the posting, keeping every fact, number and tool. Never merge two bullets into a stronger one. Keep the rest as they are (list them, in order).
- Plain ASCII punctuation. No em dashes.

## 3. Render and check
`pnpm jh tailor <id> --variant data/scout/<id>.variant.json`

It writes `output/<company>/<role>/cv.docx` and `cv.pdf`, checks the page count against `rules.style.maxPages` (exact), runs the style lint, records both files as artifacts with the verify list, and prints:
- `pages`: if over, shorten (fewer projects via `projects.max`, fewer bullets); if under, add a project or restore bullets; rerun.
- `lint`: fix every issue in the spec and rerun.
- `verify before sending`: the engine's list of text that is not in the master (title, summary, overrides, bullets).

Repeat until it prints `OK`. Without LibreOffice the PDF step is skipped and says so; tell the user.

## 4. Claim check
Run the `claim-checker` subagent with: the variant spec path, `data/master.json`, `config/profile.yaml`. It returns `{new: [...], rephrased: [...]}` for every sentence of the tailored text. For each `new` claim: either remove it from the spec and re-render, or keep it and add it to the verify list with the agent's suggestion. The engine's list and the agent's `new` list are merged into the final **Verify before sending**.

## 5. Cover note and pack
Continue with the `pack` step (`/pack <id>`): cover note, why this role, screening answers, and the merged verify list, written to `output/<company>/<role>/pack.md`.

## 6. Report
- the files, with the page count
- the three most important changes against the master (one line each)
- **Verify before sending**: every item, with where it appears
- anything the posting demands that the CV cannot honestly show (so the user can decide not to apply)
