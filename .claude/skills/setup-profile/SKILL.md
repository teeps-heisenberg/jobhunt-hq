---
name: setup-profile
description: First-run setup. Import the user's existing CV and interview them to create profile.yaml, rules.yaml and master.json.
---
# Setup
1. Ask for their current CV (DOCX or PDF path) and extract the text.
2. Draft `data/master.json` from it, following the schema in packages/resume. Do not embellish: copy facts and metrics exactly.
3. Interview for what the CV does not hold, in short batches of questions:
   - citizenship and where they can work without sponsorship
   - target locations and remote preferences
   - years of experience
   - target titles
   - notice period
   - salary bands by location
   - hard limits (never relocate to X, no on-call, and so on)
   - style preferences (max pages, project order)
   - the "never claim" list
4. Write `config/profile.yaml` and `config/rules.yaml` from the examples, then validate with `pnpm jh doctor`.
5. Build one generic CV with `/tailor generic` so they can check the rendering.
