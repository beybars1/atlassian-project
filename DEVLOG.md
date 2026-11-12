# WikiVerify — devlog

Newest first. One entry per working session. Format: what was done · what was learned · what's next · hours spent.

---

## 2026-11-11 (Tue, night) — T10 rate-limit handling

**Done**
- `src/forge/rateLimit.ts` (pure, no `@forge/*`): `withRetry` retries 429/503 only, honours `Retry-After` as delay-seconds or HTTP-date, otherwise exponential backoff 500 ms → 10 s with 0.5x–1.5x jitter; 4 attempts, 30 s total wait budget per request. When the budget is exhausted the last response is returned, not thrown — callers already treat non-200 as "unknown, don't flag", so a rate-limit episode degrades to "no finding" (conservative). `createLimiter(n)`: FIFO semaphore.
- `src/forge/http.ts`: `confluenceGet` / `jiraGet` — the only callers of `api.asApp().request*`; limiter at 4 in-flight requests per invocation (= per batch) + the retry policy, retries logged with `console.warn`. `clients.ts` and `confluencePages.ts` now go through it; no behaviour change on the happy path.
- 17 new tests with a scripted fake fetch and a fake clock (sleep advances time). 34 total green; typecheck and manifest validation green.

**Learned**
- `Date.parse("-3")` is a valid year in V8, so a `Retry-After` parser must require letters before treating the value as an HTTP-date.
- The budget (30 s) is a guess at what fits inside the async-events consumer timeout; T06 must confirm the real limit and, if the consumer gets much more time, the budget can go up.

**Next**
- Agent (unblocked): T11 components/versions drift, T12 attachments/anchors, T15, T16 remaining steps.
- Added T10a (re-enqueue the unscanned remainder of a batch after an exhausted budget) — needs T06 for the real retry semantics.
- Owner: T02, T04 still block T05 → T06 → T07 → T09 → T13 (live rate-limit verification).

**Hours:** ~1

---

## 2026-11-11 (Tue) — T08 done, T14 done, manifest validated, T16 started

**Done**
- Manifest validated against the official Forge JSON schema (`@forge/manifest`), caught a real error: `confluence:globalPage` requires `route`. Added `scripts/validate-manifest.mjs` + `npm run validate:manifest` — runs without a Forge login, so CI can use it.
- `@forge/sql` and `@forge/llm` APIs confirmed from installed type definitions: SQL repo as written is correct; LLM is OpenAI-shaped chat with `tools` + `tool_choice`, usage in `input_tokens/output_tokens`.
- T14: `src/llm/client.ts` — tool-forcing wrapper, model resolution via `list()`, cost estimate.
- T16 step 1: `src/llm/extractFacts.ts` — fact extraction tool schema + conservative prompt, normalization, cross-page conflict detection. 6 new tests; 17 total green.
- T08: `notes/phrases.md` — 15 verbatim buyer phrases, competitive map of 7 apps.

**Learned**
- The "freshness / health score" niche is crowded with 2026 launches that have 1–143 installs (FreshPage 2, Content Score 3, Evergreen 1, Content Health 1, Pulse 143). Incumbent with traction: Better Content Archiving (1,083 installs, 4.8★/156). Nobody does Jira cross-check, contradictions with evidence, rename propagation or suggested fixes. Positioning must be "finds wrong pages, shows why" — never "score".
- `forge lint` cannot run without a logged-in CLI (keychain → `FORGE_EMAIL`/`FORGE_API_TOKEN` env works but needs a real account). Owner task T04 unblocks it.
- `gh repo create` is blocked in this environment by policy; the owner creates the repo, the agent pushes.
- Marketplace review pages are client-rendered and `/rest/2` is robots-blocked; written reviews need a browser session.

**Proposed to owner (needs a yes before the agent acts)**
1. Show the suggested fix text in the free tier; charge for one-click apply.
2. Add rename-propagation check (T19a added to backlog, unscheduled).

**Next**
- Owner: create GitHub repo `atlassian-project` (private), T02 partner account + payouts, T03 contract, T04 dev site + `forge register` + secrets.
- Agent (unblocked): T10 rate-limit handling, T11 components/versions drift, T16 remaining steps with fake LLM, T15 page-type classification.

**Hours:** ~2.5

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
