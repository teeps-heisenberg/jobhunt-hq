# First prompt for the Claude Code session

Paste this into Claude Code after opening the folder:

> Read CLAUDE.md, docs/SPEC.md and docs/TASKS.md. We are building JobHunt HQ, an open-source Claude Code native job-search kit. Start with M1 task 1 only: set up the pnpm monorepo (packages/core, packages/resume, apps/dashboard), TypeScript strict, ESLint, Prettier, Vitest, a GitHub Actions CI workflow, and the .gitignore rules with a test that checks them. Show me the plan before writing files, then implement, run typecheck/lint/test, and stop with a summary. Do not touch anything outside this folder.

After each task: review the diff, commit, then ask for the next task by number ("do M1 task 2").

## Git setup (personal GitHub over SSH, as set up for Ajaia)
```powershell
cd <this folder>
git init -b main
git config user.name "Abdullah Malik"
git config user.email "<your personal GitHub email>"
git add . ; git commit -m "chore: spec, skills and example config"
# create an empty public repo named jobhunt-hq on GitHub first, then:
git remote add origin git@github-personal:<your-username>/jobhunt-hq.git
git push -u origin main
```
