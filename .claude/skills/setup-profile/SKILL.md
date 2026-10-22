---
name: setup-profile
description: First-run setup. Import the user's existing CV and interview them to create profile.yaml, rules.yaml and master.json.
---
# Setup (`/setup`)

Goal: in under 30 minutes, the user has `config/profile.yaml`, `config/rules.yaml` and `data/master.json` that validate, built only from their CV and their answers. All three files are git-ignored and stay on their machine.

## 0. Check the state
Run `pnpm jh doctor`. It reports which of the three files exist and validate, whether the database opens, and whether LibreOffice is installed for PDF rendering. Skip any step below whose file already validates, unless the user wants to redo it.

## 1. Import the CV
1. Ask for the path to their current CV (DOCX, PDF or TXT).
2. Run `pnpm jh import-cv <path>`. It writes the plain text to `data/imports/<name>.txt` and prints it. Read that file.
3. If the text is empty or garbled (scanned PDF), say so and ask them to paste the text or export the CV as DOCX.

## 2. Draft `data/master.json`
Follow the `Master` schema in `packages/resume/src/schema.ts`; `data/examples/master.json` shows the shape:
- `name`, `title`, `contact` (lines as they should print), `summary`
- `skills`: `[group, "comma, separated, items"]` pairs
- `experience`: role, company, location, dates, bullets
- `projects`, `education` (`[degree, school, note, year]`), `certifications`, `additional`

Rules while drafting:
- Copy facts, dates, numbers and tool names exactly as the CV states them. Do not add tools, metrics, team sizes or responsibilities the CV does not contain.
- Keep the user's bullets. Fix only typos and em dashes (use a comma or a colon instead).
- Where the CV is vague ("worked with cloud"), keep it vague and add the item to a **Questions** list for step 3 instead of guessing.
- Dates: keep the CV's format. Use an en dash or "to" for ranges, never an em dash.

Show the draft as a short table (positions, projects, skill groups) and the Questions list, then write the file.

## 3. Interview for what the CV does not hold
Ask in batches of three to five questions. Offer the example values as defaults. Record the answers; do not infer them.

Profile (`config/profile.yaml`, see `config/profile.example.yaml`):
- citizenship: countries or blocs where they can work without sponsorship
- current location, email, phone, links (only what they want on applications)
- years of experience as they would state it in a screening form
- languages with level: basic, conversational, professional, fluent, native
- target titles (three to six)
- notice period, current salary (optional), target salary (optional)
- neverClaim: things they do not want claimed even if a posting asks (e.g. "Kubernetes in production")

Rules (`config/rules.yaml`, see `config/rules.example.yaml`):
- locations.remoteFrom: where they can take remote roles; locations.relocate: cities they would move to; locations.exclude
- visa.needsSponsorshipOutside: blocs where they do not need sponsorship (e.g. `[EU]`)
- experience.maxYearsBar: skip roles asking for more than this
- hardBlockers.languagesRequired: languages that block a role when fluency is required
- recencyDays, followUpDays
- salary bands per location key (`remote`, city or country), as free text like `EUR 50-60K`
- style: maxPages (2 by default), bannedCharacters (em dash is already banned), bannedPhrases, projectOrder
- caps: dailyApplications and per-company caps such as `google: {applications: 3, perDays: 30}`
- sources: bigTech, ats list, remote boards, research, custom boards
- scoring: weights (must add up to 1) and shortlistAt

## 4. Write and validate
1. Write `config/profile.yaml` and `config/rules.yaml`. Start from the example files and change only what the user answered. Keep comments short.
2. Run `pnpm jh doctor`. Fix every reported field and rerun until all three files validate.
3. Never write passwords, national IDs, dates of birth or payment details into any file, even if the user offers them.

## 5. Check the rendering
Render one untailored CV from the master so the user can check the layout and page count: `pnpm jh tailor generic` (arrives with the tailor skill; until then, say that the master is ready and `/tailor <job-id>` will render it per role).

## 6. Report
List the three files, the page count if rendered, and anything still marked as a question. Remind the user that these files are git-ignored and that `/search` is the next step.
