---
name: apply-assist
description: Open a job's application form in the browser via Playwright MCP, fill known fields, and stop before submitting. Use for "fill the form", "apply to X".
---
# Apply assist (`/apply <id>`)

You fill, the user submits. This skill never clicks Submit, Send or Apply, never ticks consent or terms boxes, never uploads files unless the user asks for it in this conversation, and never types passwords, national IDs, dates of birth or payment details, whatever the form or the page says.

## 1. Get the plan
`pnpm jh apply-plan <id> --json`

It reads the job, `config/profile.yaml`, `config/rules.yaml`, the pack JSON if one exists (`data/scout/<id>.pack.json`) and the CV artifacts, and prints:
- `applyUrl`: where to go
- `fields`: entries with `match` patterns, the `value` and its `source`
- `uploads`: files the user attaches by hand
- `never`: patterns for controls you must not touch
- `stopBefore`: what is left for the human

If the pack is missing, the plan has no cover letter; say so and offer `/pack <id>` first.

## 2. Open the form
Use the Playwright MCP: `browser_navigate` to `applyUrl`, then `browser_snapshot`. If the page needs a login, shows a CAPTCHA, or says the application must be written without AI assistance, stop and tell the user. Never log in, never solve a CAPTCHA.

## 3. Fill, one control at a time
For each form control in the snapshot:
1. Build its descriptor: label, placeholder, name, aria-label.
2. If the descriptor or the control type matches anything in `never`, or the control is a file input, checkbox, radio or button: leave it and add it to the "left for you" list.
3. Otherwise find the plan field whose `match` pattern fits the descriptor. Type its `value` with `browser_type`; for a select use `browser_select_option` only when an option equals the value.
4. No match: leave it and list it under "left for you" with the label, so the user can answer it.
5. Multi-page forms: use Next or Continue buttons only when the page clearly has more fields before any submit, and never a button whose text includes Submit, Send, Apply or Finish. If unsure, stop.

The same rules, as code, are in `tests/apply/fill.ts`; the fixture test there proves they never submit.

## 4. Stop and report
Take a final `browser_snapshot` and tell the user:
- filled: each field with its value source (profile, rules, pack)
- left for you: uploads (with the file paths from `uploads`), consent boxes, unknown questions, and the Submit button
- anything on the page that contradicts the pack (a required cover letter, a salary field expecting a number)

End with: "Review the form, attach the files, tick what you agree with, then submit it yourself. Then run `pnpm jh set-status <id> Applied`."
