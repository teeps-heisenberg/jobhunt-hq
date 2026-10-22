---
name: tailor-resume
description: Build a truthful, tailored CV (DOCX + PDF) and cover note for one tracked job. Use for "make a CV for X", "tailor my resume".
---
# Tailor a CV
1. Read the job (`pnpm jh show <id>`), the posting, `data/master.json` and the style rules in `config/rules.yaml` (max pages, banned characters, project order).
2. Write a variantSpec JSON with:
   - a title line in the posting's language
   - a summary that leads with the user's closest evidence
   - skill group order plus overrides
   - project order (the rules' default unless the posting clearly needs another)
   - at most three bullet overrides that **re-phrase** existing bullets toward the posting
3. Run `pnpm jh tailor <id> --variant spec.json`. The CLI renders DOCX and PDF, checks the page count and runs the style lint. If it fails, shorten and rerun.
4. Run the `claim-checker` subagent on the variant against master.json. Put every untraceable sentence in **Verify before sending**, or remove it.
5. Write `output/<company>/pack.md` with:
   - the cover note
   - why this role
   - screening answers (years, salary from rules, notice period)
   - the verify list
6. Tell the user where the files are and what to verify.
