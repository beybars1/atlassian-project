# WikiVerify — devlog

Newest first. One entry per working session. Format: what was done · what was learned · what's next · hours spent.

---

## 2026-11-07 (Sat) — T01 scaffold

**Done**
- Repo scaffolded: manifest, checks 1–4 (dead links, owner gone, Jira ref drift, placeholders), storage-format parser, incremental orchestration + batching, Forge clients (Confluence v2 / Jira v3), Forge SQL repo + in-memory repo, UI Kit dashboard, CI + deploy-dev workflows, CLAUDE.md for the dev agent, TASKS.md backlog.
- 11 unit tests green on a seeded page with planted faults; typecheck green against real `@forge/*` 2026 packages.

**Learned (API drift vs docs)**
- `@forge/api` 8.x no longer exports `storage`; KVS lives in `@forge/kvs` (`import { kvs }`).
- `Queue.push` takes `{ body }`, not the raw event.
- `@forge/bridge` 7.x `invoke()` may return `{ body, metadata }`; unwrap once (helper in dashboard).
- `@forge/sql` API shape (`prepare().bindParams().execute()`, `migrationRunner`) is from memory — verify on first deploy (T05/T06).

**Next**
- Owner: T02 partner account + payouts question, T03 contract, T04 dev site + `forge register` + GitHub secrets.
- Agent: T05 `forge lint` clean, T06 first deploy, T08 review mining.

**Hours:** ~2 build

---

## 2026-11-06 (Fri) — decision and plan

**Done**
- Market research across YC/a16z theses, bootstrapped micro-SaaS data, platform marketplaces (Shopify vs Atlassian), and the Atlassian Marketplace AI category.
- Decision: build a Confluence verifier on Forge. Plan written (PLAN.md).

**Learned**
- Atlassian Marketplace: $7B lifetime sales, latest $1B in 9 months; 0% revenue share on first $1M lifetime Forge revenue from 1 Jan 2026 (16–17% after); Connect apps go to 20–25%.
- Forge LLMs API GA 29 Jul 2026: Claude Haiku 4.5 / Sonnet 4.5–5 / Opus 4.6–5 on Bedrock, text only, tool-calling supported, developer pays ($1/$5 Haiku, $3/$15 Sonnet, $5/$25 Opus per 1M in/out), no free quota. Apps on it can keep the Runs on Atlassian badge.
- AI category on the Marketplace: 64 curated apps; the biggest pure-AI app has ~1,700 installs; "AI assistant" apps are all under 750. Finished-job apps (release notes, standups, translation) get installs; chat boxes don't.
- Pain evidence: 40% of polled Confluence users name outdated content as their top problem; Rovo answers from stale pages; incumbents (FreshPage, Content Score, Better Content Archiving, Comala) do banners and rule scores, not verification.
- Admin config-audit space is already crowded: Scalpel (4 installs), HealthChecks (10), RuleSignal (3), Automation Usage Risk Analyzer (22, free). Avoid.
- Scheduled triggers: `hour`/`day`/`week`, per installation, may double-fire, no retry on error; function timeout 55 s default, up to 900 s.
- Runs on Atlassian badge is auto-detected: no egress in manifest = eligible. External link checking is therefore out of v0.

**Next (week 1, 10–16 Nov)**
- [ ] Create Marketplace partner account; ask partner support about payouts to a KZ entity
- [ ] Read employment contract clauses on IP and outside work
- [ ] Mine 1–3★ reviews of the four incumbents → 20 buyer phrases → `notes/phrases.md`
- [ ] `forge create` skeleton, deploy to dev site, confirm `llm` + `sql` + `scheduledTrigger` modules compile and `forge eligibility` reports Runs on Atlassian

**Hours:** 0 build / ~3 research
