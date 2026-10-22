---
name: apply-assist
description: Open a job's application form in the browser via Playwright MCP, fill known fields, and stop before submitting. Use for "fill the form", "apply to X".
---
# Apply assist
1. `pnpm jh show <id>` for applyUrl, then load `config/profile.yaml` and `output/<company>/pack.md`.
2. Open applyUrl with Playwright MCP. If the site needs login, stop and ask the user to sign in themselves.
3. Fill from the profile and pack:
   - name, email, phone, location, links
   - years questions (answer truthfully from master.json)
   - salary (from rules)
   - notice period
   - work authorisation (from profile: never claim a right to work the user lacks)
   - cover note and free-text answers
4. **Never:**
   - upload files unless the user enables it
   - tick consent or terms boxes
   - type passwords, IDs or date of birth
   - solve CAPTCHAs
   - click Submit, Apply or Send
5. If the form or posting forbids AI-written answers, leave those fields empty and tell the user.
6. Print a checklist of what was filled and what the user must do (upload CV, consent, Submit). After they confirm submission, run `pnpm jh set-status <id> Applied`.
