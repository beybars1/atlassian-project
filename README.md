# WikiVerify

Nightly verification of Confluence pages against Jira and the rest of the wiki. Atlassian Forge app, no data egress.

- `PLAN.md` — what we build and why, milestones, kill criteria
- `TASKS.md` — ordered backlog (the agent works top-down)
- `DEVLOG.md` — session log, newest first
- `CLAUDE.md` — how the development agent works in this repo

## Local

```
npm ci
npm run typecheck
npm test          # pure checks, no Forge runtime needed
npm run validate:manifest   # manifest schema + "Runs on Atlassian" no-egress guard
npx forge lint    # after `forge register`
npx forge deploy -e development
```

## Runs on Atlassian

Every merge to `main` deploys to the Forge development environment (`deploy-dev` workflow) and runs `forge eligibility` there; the verdict is in that job's log. Last read 2026-11-27: version 2.16.0 **eligible** (DEVLOG). Data residency is handled by the platform — all app data lives in Forge SQL, which is realm-pinned with the host site; the listing's data-residency answer is entered by the owner (T20).
