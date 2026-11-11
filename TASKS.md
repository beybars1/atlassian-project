# Backlog — ordered. The agent takes the first unchecked task whose "needs" are met.

Legend: `[owner]` = only the human can do it. Everything else is for the agent.

## Week 1 — setup (10–16 Nov)

- [x] T01 Scaffold repo: manifest, checks 1–4, orchestration, Forge clients, SQL repo, dashboard, tests, CI. *(done 2026-11-07 in chat)*
- [ ] T02 [owner] Create Atlassian developer account + Marketplace partner account; ask partner support whether payouts to a Kazakhstan-registered entity are supported. Record the answer in DEVLOG.
- [ ] T03 [owner] Read employment contract clauses on IP assignment and outside work. Record "clear / needs legal / blocked" in DEVLOG.
- [ ] T04 [owner] Create a free Confluence + Jira dev site; run `forge register` once locally (fills `app.id`); add `FORGE_EMAIL` and `FORGE_API_TOKEN` as GitHub Actions secrets. Commit the `app.id` change.
- [ ] T05 `forge lint` clean. needs: T04. *(partial 2026-11-11: manifest validates against the official JSON schema via `npm run validate:manifest`; `forge lint` itself needs a logged-in CLI)* Fix every manifest/module error it reports (module names, `sql`/`llm` syntax, resource paths). Record each fix in DEVLOG — this is where docs and reality meet.
- [ ] T06 First deploy to development; nightly trigger fires; dashboard renders. needs: T05. Verify each REST endpoint in `src/forge/*` against the dev site and fix drift. Record HTTP shapes that differed.
- [ ] T07 Seed script: create a test space with 200 pages and 20 planted faults from `test/fixtures` via the Confluence API (`scripts/seed.ts`, run locally with an API token — never committed). needs: T06.
- [x] T08 Mine 1–3★ Marketplace reviews of Better Content Archiving, Comala Document Management, FreshPage, Content Score → `notes/phrases.md` with 20 buyer phrases and the review they came from. (Agent can do this with web access.) *(done 2026-11-11 → `notes/phrases.md`; review pages are client-rendered, so phrases come from Community threads)*

## Week 2 — scanner core (17–23 Nov)

- [ ] T09 Incremental scan proven: second nightly run scans only changed pages (assert via `scan_runs`). needs: T07.
- [ ] T10 Rate-limit handling: back off on 429 from Confluence/Jira, respect `Retry-After`, cap concurrency per batch. needs: T06.
- [ ] T11 Jira ref drift: components and versions (archived/released/deleted) mentioned by name. Planted faults + tests. needs: T09.
- [ ] T12 Dead-link check for Confluence attachments and anchors within the same page. needs: T09.
- [ ] T13 Measured precision on the seeded space ≥ 90% for checks 1–4; false positives fixed or the pattern removed. needs: T09.

## Week 3 — LLM checks + UI (24–30 Nov)

- [x] T14 `src/llm/client.ts`: thin wrapper over `@forge/llm` with model constants, tool-calling helper, token logging. *(done 2026-11-11 against real `@forge/llm` types; wiring token totals into `scan_runs` moves to T17)*
- [ ] T15 Check 5 STALE_BY_TYPE: Haiku classifies page type once per version (runbook / how-to / onboarding / decision / meeting-notes / other) → threshold per type (admin-configurable, defaults in code). needs: T14.
- [ ] T16 Check 6 CONTRADICTION *(step 1 done 2026-11-11: `extractFacts` + `findConflicts` with tests; remaining: `facts` table, Sonnet adjudication, finding output)*: Haiku extracts `{entity, attribute, value, quote}` facts per page → stored in `facts` table → conflicts by `(entity, attribute)` across pages in a space → Sonnet adjudicates with page dates + Jira evidence. needs: T14.
- [ ] T17 Cost report: tokens and $ per scan run shown on the dashboard; alert in DEVLOG if a 2,000-page scan exceeds $10. needs: T15, T16.
- [ ] T18 Dashboard v1: per-space tabs, severity filter, "dismiss finding" (status → dismissed, persists across scans), link to page. needs: T16.
- [ ] T19 Byline item (`confluence:contentBylineItem`): "✓ verified" / "⚠ 2 issues" chip on each page. needs: T18. *(adds a module → check `forge lint`, major version)*

## Week 4 — listing (1–7 Dec)

- [ ] T20 [owner] Privacy & security questionnaire, support URL, EULA, app name decision (naming rules check).
- [ ] T21 Listing copy from `notes/phrases.md`: title, tagline, 3 highlights, 5 screenshots (agent drafts; owner uploads). needs: T08, T18.
- [ ] T22 `forge eligibility` reports Runs on Atlassian; data residency declared; no egress. needs: T19.
- [ ] T23 [owner] Submit free listing.

- [ ] T19a Rename propagation check: Jira component/version renamed (or service name changed in a page marked canonical) → list pages still using the old name. Source: `notes/phrases.md`. needs: T11.

## Later (not before week 5)

- [ ] T24 Slack/email digest of new findings (Forge-native only; no egress — use Confluence notifications or Jira issue creation).
- [ ] T25 Paid tier: `appIsLicensed` gating, "propose fix" (Sonnet diff → one-click apply via `write:page:confluence`).
- [ ] T26 Multi-space scheduling with per-space budgets.
