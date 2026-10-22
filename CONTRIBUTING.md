# Contributing to JobHunt HQ

Thanks for helping. This project is small and opinionated: it exists so that people can run an honest, local job search with Claude Code. Contributions that keep it honest, local and simple are welcome.

## Ground rules
- **The human submits.** No change may make the kit click Submit, Send or Apply, tick consent boxes, solve CAPTCHAs, log in to sites, or type passwords, IDs or payment details. Pull requests that add auto-apply or scraping behind logins will be closed.
- **No invented claims.** Anything that generates application text must trace every sentence to `data/master.json` or `config/profile.yaml`, or list it under "Verify before sending".
- **Local first.** Personal data stays in `config/`, `data/` and `output/`, which are git-ignored. Never commit real CVs, profiles or trackers, and keep examples fictional.
- **The CLI owns the database.** Skills and the dashboard go through `@jobhunt-hq/core`; nothing edits SQLite directly.

## Setup
```bash
pnpm install
pnpm check          # typecheck, lint, format check, unit tests, Playwright fixture test
pnpm demo           # dashboard on a seeded throwaway database
```
Node 22 and pnpm 12. LibreOffice is only needed for PDF rendering; tests skip it when `soffice` is missing. The Playwright test needs Chromium: `pnpm exec playwright install chromium`.

## Making a change
1. Open an issue first for anything beyond a bug fix or a doc tweak, so the design can be discussed.
2. Branch from `main`. Keep commits small, with conventional messages: `feat(core): ...`, `fix(resume): ...`, `docs: ...`.
3. Tests live next to the code (`*.test.ts`, Vitest). New scoring, dedupe or rendering behaviour needs a test; browser behaviour needs a fixture under `tests/apply`.
4. Run `pnpm check` before pushing. CI runs the same steps.
5. Update the README section that describes what you changed. The definition of done is: typecheck, lint and tests pass, and the docs match.

## Style
- TypeScript strict, ESM, zod at every boundary.
- No em dashes in generated application text; the style lint enforces it, and the docs follow the same rule.
- Skills are Markdown in `.claude/skills/<name>/SKILL.md`. Keep them procedural: numbered steps, the CLI commands to run, and the rules the step must respect.

## Reporting a problem
Use the issue templates. For a job site that stopped working, include the site, the source group (`bigTech`, `ats`, `remote`, `research`, `custom`) and what the scout returned, without any personal data.

## Code of conduct
This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
