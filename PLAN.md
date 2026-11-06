# WikiVerify — implementation plan

Working name: **WikiVerify** (codename `wikiverify`; final name must pass Atlassian's app-naming rules — "X for Confluence" is allowed, "Confluence X" is not).

Owner: Bibarys · Started: 2026-11-06 · Status: approved, pre-build

---

## 1. What we are building

A Forge app for Confluence Cloud that runs nightly, cross-checks wiki pages against Jira and the rest of the wiki, and produces a ranked list of pages that are wrong — each with the reason and a proposed fix the page owner approves in one click.

**v0 (free, the test):** read-only scanner. One space per run. Output: top 20 problem pages with reasons. No fix action.
**v1 (paid):** "Propose fix" + Jira cross-check + multi-space + Slack/email digest.

**Why it works on this platform:** 0% revenue share to $1M lifetime, Atlassian hosts the code (Forge), Claude runs inside Atlassian's cloud (Forge LLMs API, GA July 2026) so the app qualifies for the "Runs on Atlassian" badge with no security review on the customer side.

## 2. Success criteria

| Gate | Target | Deadline |
|---|---|---|
| Free scanner listed on Marketplace | approved listing, Runs on Atlassian badge | end of week 4 |
| Distribution test | 150 installs | 60 days after listing |
| Problem validation | 3 of 10 interviewed admins would pay $1/user/month | end of week 6 |
| Monetization test | free→paid ≥ 3% at day 30 of paid tier | week 8 + 30 days |
| Commit gate | 10 paying sites or $1k MRR | month 4 |

Any gate missed → stop or pivot (see §9). Budget cap: $3k. Time: 10–15 h/week.

## 3. What "wrong page" means (the checks)

Ordered by signal-to-noise. v0 ships checks 1–6; v1 adds 7–9.

| # | Check | How | LLM needed |
|---|---|---|---|
| 1 | Dead links | HEAD/GET internal Confluence/Jira links; external links only if no-egress rule allows (it doesn't — skip external in v0) | no |
| 2 | Owner gone | page owner/last editor is deactivated or not in site | no |
| 3 | Jira reference drift | page mentions issue keys / component / version names that are closed, renamed, archived or deleted | no |
| 4 | Placeholder & TODO text | "TBD", "TODO", "lorem", "[insert", empty headings, unfilled templates | regex |
| 5 | Stale by type | runbooks/onboarding/how-to older than N days (threshold per label, admin-configurable); page type inferred once by LLM, cached | Haiku, once per page |
| 6 | Self-contradiction within a space | two pages state different values for the same fact (owner, URL, port, SLA, step order) | Haiku extract → Sonnet adjudicate |
| 7 | Code/infra drift (v1) | service names, env vars, endpoints on the page vs repo manifests — requires egress (GitHub) or Bitbucket Cloud API; may cost the badge; decide at v1 | Haiku |
| 8 | Proposed fix (v1) | diff suggestion for 3, 4, 6; owner approves in page byline | Sonnet |
| 9 | "Questions the wiki can't answer" (v1) | if Confluence/Rovo search analytics exposed via API, list top failed queries → missing pages | no |

Output per finding: `page, check, severity (high/med/low), evidence (quote + link), suggested action`.

## 4. Architecture (Forge)

```
scheduledTrigger (day) ──► orchestrator fn
                             │  lists pages in scope (Confluence REST v2, cursor paging)
                             │  diff against last-scan index (KVS) → only changed pages + pages referencing changed Jira objects
                             ▼
                       async events queue  (one event per batch of ~20 pages)
                             │
                             ▼
                       worker fn (timeoutSeconds: 300)
                             │  fetch page body (storage format → text), links, owner, labels, last-modified
                             │  run checks 1–4 locally
                             │  check 5–6: Forge LLMs (Haiku extract facts → JSON; Sonnet adjudicates conflicts)
                             │  write findings → Forge SQL (findings, pages, facts tables)
                             ▼
                       UI: confluence:globalPage (admin dashboard, Custom UI)
                           confluence:contentBylineItem (per-page "verified / 2 issues" chip)
                           confluence:spacePage (space report)
```

**Manifest modules:** `scheduledTrigger` (day), `function` ×3, `consumer` (async events), `confluence:globalPage`, `confluence:spacePage`, `confluence:contentBylineItem`, `llm` (model: claude), `sql`.
**Scopes (read-only in v0):** `read:page:confluence`, `read:space:confluence`, `read:user:confluence`, `read:jira-work`, `read:jira-user`, `storage:app`. v1 adds `write:page:confluence` for applying fixes.
**No `external` permissions in manifest** → eligible for Runs on Atlassian automatically. External link checking is dropped for that reason.
**Limits to design around:** function default timeout 55 s, extend to 900 s via `timeoutSeconds`; max 5 scheduled triggers; triggers are per installation and may fire twice (idempotent workers keyed on `pageId:version`); first run ~5 min after deploy; errors are not retried.

## 5. LLM strategy and cost

- **Models:** Haiku 4.5 for extraction and classification ($1 / $5 per 1M in/out); Sonnet 5 only for contradiction adjudication and fix proposals ($3 / $15). No Opus.
- **Prompt shape:** page text (≤ 6k tokens, chunk longer pages) → JSON fact list `{entity, attribute, value, quote}` via tool-calling (`tool_choice: required`), so output is structured. Facts keyed by `(entity, attribute)`; conflicts = same key, different value across pages → Sonnet decides which is current using page dates + Jira evidence.
- **Cost model:** 2,000-page space × 1,500 tokens ≈ 3M input, ~0.3M output on Haiku ≈ $3 + $1.5 per full scan. Incremental nightly scans touch <5% of pages → ~$0.25/night. Sonnet adjudication on ~50 conflicts/night × 2k tokens ≈ $0.30. Budget per site: **< $15/month** at the top end — fine against $200–400/month revenue.
- **Caching:** facts and page-type classification stored by `pageId:version`; re-extract only on version change.
- **Egress rule:** every byte stays in Forge. No OpenAI, no own API keys. This is the product's trust story.

## 6. Data model (Forge SQL)

```
pages(page_id PK, space_id, title, version, owner_id, last_modified, page_type, scanned_at)
facts(id PK, page_id FK, entity, attribute, value, quote, extracted_at)
findings(id PK, page_id FK, check_code, severity, evidence, suggestion, status[open|dismissed|fixed], created_at)
jira_refs(page_id, issue_key, status_at_scan, seen_at)
scan_runs(id, space_id, started_at, finished_at, pages_seen, pages_scanned, tokens_in, tokens_out, cost_est)
```

## 7. Milestones

Week 1 starts Mon 10 Nov 2026. Holidays in weeks 7–8; slip is expected there.

| Wk | Dates | Deliverable | Done when |
|---|---|---|---|
| 1 | 10–16 Nov | Desk validation + setup | Partner account created; payout eligibility for KZ-registered partner confirmed or entity decision made; employment contract IP/outside-work clause reviewed; 20 buyer phrases mined from 1–3★ reviews of Better Content Archiving, Comala, FreshPage, Content Score; `forge create` skeleton deployed to a dev site |
| 2 | 17–23 Nov | Scanner core | Orchestrator + worker + checks 1–4 running nightly on a seeded dev space (200 pages, 20 planted faults); findings in Forge SQL |
| 3 | 24–30 Nov | LLM checks + UI | Checks 5–6 via Forge LLMs; global page dashboard; byline chip; cost per scan measured and logged |
| 4 | 1–7 Dec | Listing | Marketplace listing submitted (free, Runs on Atlassian badge shows in `forge eligibility` check); listing copy from week-1 phrases; 1-page site live; privacy & security answers done |
| 5 | 8–14 Dec | Distribution | Atlassian Community article under product brand; Google Ads on 10 exact-match phrases at ~$30/day; outreach email to every installer asking for a 20-min camera-off call |
| 6 | 15–21 Dec | Interviews | 10 calls done; pricing question asked; findings quality graded on 3 real customer spaces (precision ≥ 70% on high-severity) |
| 7 | 22–28 Dec | Paid tier build | Check 3 (Jira drift) + check 8 (propose fix) behind license; `appIsLicensed` filter; pricing set at $1.5/user/month, free ≤ 10 users |
| 8 | 29 Dec–4 Jan | Paid tier live | Paid version approved; conversion tracking in place; devlog review against gates |

## 8. Repo layout

```
wikiverify/
  manifest.yml
  src/
    triggers/nightly.ts        # orchestrator
    workers/scanBatch.ts       # consumer fn
    checks/                    # one file per check, pure functions, unit-tested
    llm/extractFacts.ts        # Haiku, tool-calling → JSON
    llm/adjudicate.ts          # Sonnet
    db/schema.sql, db/repo.ts
    ui/dashboard/              # Custom UI (React)
    ui/byline/
  test/fixtures/               # seeded pages with planted faults
  PLAN.md
  DEVLOG.md
```

Dev loop: `forge tunnel` against a free dev site; Claude Code with Forge MCP for scaffolding; `forge deploy -e development` nightly; `forge install --upgrade` for scope changes.

## 9. Kill criteria

- Payout or contract blocker unresolved by end of week 2 → stop before building further.
- < 150 installs 60 days after listing → invisible distribution doesn't work here; change channel or stop.
- < 3 of 10 interviewed admins would pay $1/user/month → run the same interviews on "compliance evidence packs" (the #2 candidate).
- free→paid < 3% at day 30 → reprice or pivot to Jira↔Confluence drift (the v2 idea).
- Atlassian announces native contradiction/freshness detection → reassess within 2 weeks.

## 10. Open questions

- [ ] Marketplace partner payouts to a Kazakhstan entity — confirm with Atlassian partner support; fallback entity (Estonia e-Residency, US LLC) and its cost.
- [ ] Employment contract: IP assignment and outside-activity clause. Product touches nothing in banking, but read it.
- [ ] Forge platform pricing beyond the free allowance — get the current allowance table and model 100-site usage.
- [ ] Confluence REST v2 rate limits for a 10k-page site — measure on the dev site; may need weekly full scans + daily incremental.
- [ ] Does the Confluence search analytics API exist for check 9, or is that Premium-only / not exposed.
- [ ] App name: trademark/naming rules check before listing.

## 11. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-11-06 | Atlassian Forge over Shopify | fewer competitors, B2B pricing, hosted, buyer is technical; invisible founder can't win Shopify's ad auction |
| 2026-11-06 | Confluence verifier over admin-config auditor | config-audit space has 6+ new entrants with 3–22 installs; verification has no incumbent |
| 2026-11-06 | Forge LLMs only, no external models | keeps Runs on Atlassian badge = the trust signal; cost is low enough |
| 2026-11-06 | Free read-only scanner first | listing is the only distribution for an invisible founder; installs and reviews before monetization |
| 2026-11-06 | No external link checking in v0 | any egress forfeits the badge |
