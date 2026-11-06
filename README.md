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
npx forge lint    # after `forge register`
npx forge deploy -e development
```
