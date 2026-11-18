# Backlog — ordered. The agent takes the first unchecked task whose "needs" are met.

Legend: `[owner]` = only the human can do it. Everything else is for the agent.

## Week 1 — setup (10–16 Nov)

- [x] T01 Scaffold repo: manifest, checks 1–4, orchestration, Forge clients, SQL repo, dashboard, tests, CI. *(done 2026-11-07 in chat)*
- [x] T02 [owner] Create Atlassian developer account + Marketplace partner account; ask partner support whether payouts to a Kazakhstan-registered entity are supported. Record the answer in DEVLOG.
- [x] T04 [owner] Create a free Confluence + Jira dev site; run `forge register` once locally (fills `app.id`); add `FORGE_EMAIL` and `FORGE_API_TOKEN` as GitHub Actions secrets. Commit the `app.id` change.
- [x] T05 `forge lint` clean. needs: T04. *(partial 2026-11-11: manifest validates against the official JSON schema via `npm run validate:manifest`; `forge lint` itself needs a logged-in CLI)* Fix every manifest/module error it reports (module names, `sql`/`llm` syntax, resource paths). Record each fix in DEVLOG — this is where docs and reality meet.
- [ ] T06 First deploy to development; nightly trigger fires; dashboard renders. needs: T05. *(2026-11-12: deployed + installed on the dev site via forge-bootstrap; remaining: verify dashboard renders, trigger fires, and REST endpoints in src/forge/* against the live site — find the site with `npx forge install list`, never commit it)* Verify each REST endpoint in `src/forge/*` against the dev site and fix drift. Record HTTP shapes that differed.
- [ ] T07 Seed script: create a test space with 200 pages and 20 planted faults from `test/fixtures` via the Confluence API (`scripts/seed.ts`, run locally with an API token — never committed). needs: T06.
- [x] T08 Mine 1–3★ Marketplace reviews of Better Content Archiving, Comala Document Management, FreshPage, Content Score → `notes/phrases.md` with 20 buyer phrases and the review they came from. (Agent can do this with web access.) *(done 2026-11-11 → `notes/phrases.md`; review pages are client-rendered, so phrases come from Community threads)*

## Week 2 — scanner core (17–23 Nov)

- [ ] T09 Incremental scan proven: second nightly run scans only changed pages (assert via `scan_runs`). needs: T07.
- [x] T10 Rate-limit handling: back off on 429 from Confluence/Jira, respect `Retry-After`, cap concurrency per batch. Code-only with a fake fetch in tests; live verification is part of T13. needs: T01. *(done 2026-11-11 → `src/forge/rateLimit.ts` + `src/forge/http.ts`; 17 tests)*
- [ ] T10a Batch resumption after an exhausted rate-limit budget: when `fetchPage` still gets 429/503 after retries, re-enqueue the unscanned remainder of the batch (Forge async events retry / a follow-up `queue.push`) instead of skipping those pages until the next night. needs: T06 (needs the real consumer timeout and retry semantics).
- [x] T11 Jira ref drift: components and versions (archived/released/deleted) mentioned by name. Planted faults + tests. needs: T01. *(done 2026-11-12 → `src/checks/jiraNameDrift.ts`; archived + released-as-upcoming only — deleted names are not listed by Jira, so they are not detectable; 10 tests)*
- [x] T12 Dead-link check for Confluence attachments and anchors within the same page. needs: T01. *(done 2026-11-13 → `src/checks/deadAttachments.ts`, `src/checks/deadAnchors.ts`; attachment part is silent until the owner adds the `read:attachment:confluence` scope — see T12a; 14 tests)*
- [ ] T12a [owner] Decide on the `read:attachment:confluence` scope: adding it to `manifest.yml` turns on the attachment half of T12 (v2 `GET /pages/{id}/attachments` answers 403 without it). Scope change → major version, users must re-consent. needs: T12.
- [ ] T13 Measured precision on the seeded space ≥ 90% for checks 1–4; false positives fixed or the pattern removed. needs: T09.

## Week 3 — LLM checks + UI (24–30 Nov)

- [x] T14 `src/llm/client.ts`: thin wrapper over `@forge/llm` with model constants, tool-calling helper, token logging. *(done 2026-11-11 against real `@forge/llm` types; wiring token totals into `scan_runs` moves to T17)*
- [x] T15 Check 5 STALE_BY_TYPE: Haiku classifies page type once per version (runbook / how-to / onboarding / decision / meeting-notes / other) → threshold per type (admin-configurable, defaults in code). needs: T14. *(done 2026-11-14 → `src/llm/classifyPage.ts`, `src/checks/staleByType.ts`; labels and titles decide before Haiku; type cached in `pages.page_type` (migration v002); thresholds on the dashboard; 22 tests)*
- [ ] T15a Verify check 5 on the dev site: Haiku classification quality on ~30 real pages (precision of `runbook` / `how-to` / `onboarding` labels), real token cost per classification, and that migration `v002_pages_page_type` applies on an installed site. needs: T06.
- [x] T16 Check 6 CONTRADICTION: Haiku extracts `{entity, attribute, value, quote}` facts per page → stored in `facts` table → conflicts by `(entity, attribute)` across pages in a space → Sonnet adjudicates with page dates + Jira evidence. needs: T14. *(done 2026-11-15 → `src/llm/adjudicate.ts`, `src/checks/contradiction.ts`, migration v003; adjudication uses page dates + quotes — Jira evidence and chunking of long pages split into T16a; 14 tests)*
- [x] T16a Check 6 follow-ups: pass Jira evidence to the adjudicator (issue status / fix version for keys quoted next to the claim), chunk pages longer than `MAX_PAGE_CHARS` instead of truncating, and a dashboard label for contradiction findings that names the other page. needs: T16. *(done 2026-11-16 → `facts.issue_keys` + `findings.related_page_*` (migration v004), `src/ui/findingLabel.ts`; up to 4 Haiku chunks per page; 15 tests)*
- [ ] T16b Verify check 6 on the dev site: extraction precision on ~30 real pages (are the facts real, are the quotes verbatim), adjudication precision on the planted contradiction fixtures, Sonnet cost per conflict, and that migration v003 applies on an installed site. needs: T06, T07.
- [x] T17 Cost report: tokens and $ per scan run shown on the dashboard; alert in DEVLOG if a 2,000-page scan exceeds $10. needs: T15, T16. *(done 2026-11-17 → `src/llm/cost.ts`, `src/ui/costReport.ts`, migration v005; tokens per tier on `scan_runs`, dashboard table with a per-2,000-pages projection, worker warns once per run over $10; the measured figure for DEVLOG waits for a real scan — T17a; 10 tests)*
- [ ] T17a Measure the cost of a full scan on the seeded space (dashboard "Scan cost" table, log line `cost alert` in the worker); write the $ per 2,000 pages into DEVLOG and, if over $10, cut the Haiku prompt (page text cap, facts cap) before anything else. needs: T07.
- [ ] T17b `scan_runs` row per day: a second `startRun` for the same `<date>:<space>` id (double-fired trigger, or "Scan now" on the dashboard after the nightly) hits the primary key and throws in Forge SQL, so the manual run never enqueues. Decide: reuse the row (and accept double-counted pages) or key manual runs separately. needs: T06.
- [ ] T18 Dashboard v1: per-space tabs, severity filter, "dismiss finding" (status → dismissed, persists across scans), link to page. needs: T16.
- [ ] T19 Byline item (`confluence:contentBylineItem`): "✓ verified" / "⚠ 2 issues" chip on each page. needs: T18. *(adds a module → check `forge lint`, major version)*

## Week 4 — listing (1–7 Dec)

- [ ] T20 [owner] Privacy & security questionnaire, support URL, EULA, app name decision (naming rules check).
- [ ] T21 Listing copy from `notes/phrases.md`: title, tagline, 3 highlights, 5 screenshots (agent drafts; owner uploads). needs: T08, T18.
- [ ] T22 `forge eligibility` reports Runs on Atlassian; data residency declared; no egress. needs: T19.
- [ ] T23 [owner] Submit free listing.

- [ ] T19a Rename propagation check (approved 2026-11-12): Jira component/version renamed → list pages still using the old name. Uses Jira changelog of component/version names (last 180 days) + text search across scanned pages. needs: T11.
- [ ] T19b Suggested-fix preview in free tier (approved 2026-11-12): Sonnet drafts the fix text for findings of checks 3, 4, 6 (`suggestion` field becomes concrete: old → new). Read-only; apply stays in T25. needs: T16.

## Later (not before week 5)

- [ ] T24 Slack/email digest of new findings (Forge-native only; no egress — use Confluence notifications or Jira issue creation).
- [ ] T25 Paid tier: `appIsLicensed` gating, one-click *apply* of the suggested fix via `write:page:confluence` (adds scope → major version).
- [ ] T26 Multi-space scheduling with per-space budgets.
