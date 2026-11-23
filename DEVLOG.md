# WikiVerify — devlog

Newest first. One entry per working session. Format: what was done · what was learned · what's next · hours spent.

---

## 2026-11-24 (Tue, night) — T19b suggested-fix preview

**Done**
- `src/llm/suggestFix.ts` (check 8, pure, LLM injected): `suggestFix(llm, page, finding)` asks Sonnet (tool `propose_fix`: `old_text`, `new_text`, `confidence`, `note`) for the one smallest edit that fixes a finding of check 3 (`JIRA_REF_DRIFT`), 4 (`PLACEHOLDER`) or 6 (`CONTRADICTION`). The model gets the finding, the generic advice and `excerptsFor(text, evidence)`: a window of ±500 chars around every quoted string and issue key in the evidence that can be located on the page (whitespace-insensitively — check 4's snippets are collapsed), merged, with cuts marked; the head of the page when nothing is found. `JIRA_RENAMED` (3c) is already concrete and is left alone; checks 1, 2, 5 have no text to edit.
- A draft survives only when `confidence` is `high` and `validFix` holds: the old text (trimmed) is 3–400 chars, occurs on the page **exactly once** (an apply in T25 must be unambiguous), and the replacement is ≤ 600 chars and different; an empty replacement is a deletion. The suggestion then reads `Replace "old" with "new".` — the exact shape 3c produces — or `Remove "old".`. Anything else keeps the generic suggestion: the finding itself never depends on the draft.
- `addFixPreviews`: eligible findings of the scanned page, worst severity first, at most `MAX_FIXES_PER_PAGE = 3` Sonnet calls per page scan; a contradiction that lands on the *other* page gets no draft (that page's text is not at hand — see Learned). A failing call logs and keeps the generic text. Worker: `resolveFixPreviews` runs after check 6 and, when the page version is unchanged since the last scan, passes the stored open + dismissed findings of the page so an identical finding **reuses its stored suggestion without a call** — cheaper, and a dismissed finding keeps its identity (T18 matches on the suggestion text). Tokens go to the Sonnet tier of the run (`cost.test.ts` updated: the second page now also costs one declined draft).
- No schema change, no manifest change, no UI change: the dashboard and the byline popup already show `suggestion`.
- 19 new tests (`test/suggestFix.test.ts`): excerpts (located anchors, merged windows, head fallback), validation (unique / verbatim / trimmed / deletion / too long / unchanged), the Sonnet call and every way it declines, selection and cap, reuse of stored suggestions, and the worker over three scans (draft → dismissed finding holds on a same-version replay with no call → redrafted after an edit), plus no LLM / failing LLM / cross-page contradiction. 182 total green under `TZ=Asia/Almaty` and `TZ=UTC`; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Learned**
- "Suggestion becomes concrete" and "dismissal persists" pull against each other because T18 keys identity on the suggestion text. Reusing the stored suggestion whenever the page version is unchanged resolves it for replays and rename-rescans; after an edit the finding is drafted again, and if Sonnet (temperature 0) phrases the edit differently the dismissed row is dropped and the finding reappears. Acceptable: the page changed, the admin looks again. Parsing the stored `Replace "…"` back into old/new to check it still applies was the alternative and is more code for a case T18 already treats as "a changed finding is a new finding".
- A placeholder fix is almost always a deletion ("Last reviewed TBD." → gone) or nothing: the prompt forbids filling a placeholder with a guess, and the test fake declines for check 4 on purpose. The honest fix text for most `TBD`s is "ask the owner", which is what the generic suggestion already says.
- Cross-page contradictions: when the scan of the *newer* page puts the finding on the outdated one, no draft — the outdated page's text is not at hand and fetching it would be one more Confluence call per conflict. The draft arrives when the outdated page is itself scanned (its next edit, a rename rescan, or when it is the one scanned after the newer page): then check 6 reproduces the finding on it with its text in hand. Good enough for a nightly; T19e decides on the dev site whether the dashboard needs more.
- Sonnet budget: 3 drafts per page with eligible findings, ≈1.5k tokens in / 100 out each → ≈ $0.006 per page with findings. On a full 2,000-page scan where a third of the pages carry a drift or placeholder finding that is ≈ $4 on top of adjudication — inside the $10 alert, but the first thing to cut if T17a says otherwise.

**Next**
- Agent: nothing unblocked. T22 (`forge eligibility`) needs a logged-in CLI; T24–T26 are "not before week 5" and T25 adds a scope. The rest needs T06 / T07 on the dev site.
- Owner: T06 verification on the dev site gates T07 / T09 / T13 / T15a / T16b / T17a / T17b / T19c / T19e; T12a scope decision; T20 listing prerequisites.

**Hours:** ~1

---

## 2026-11-23 (Mon, night) — T19d rescan on rename

**Done**
- `pages.project_keys` (migration `v007_pages_project_keys`, comma-separated, cut at a whole key at 255 chars): the worker stores the distinct project prefixes of the page's issue keys with every scan (`projectKeysOf`). `''` = cites nothing, `NULL` = scanned before v007 (those pages join on their next edit, as before). `Repo.pagesCitingProjects(spaceId)` lists `(pageId, scannedAt, projectKeys)` for the pages that cite anything — memory + Forge SQL.
- `src/scan/renameRescan.ts` (Forge-free, repo + clients injected). `refreshJiraNames` moved here from the worker and is now shared: the nightly refreshes the `jira_names` snapshot of every project cited in the space (∩ the site's known projects, one components + one versions call per project) *before* the diff, so a rename is discovered the night it happens even when no edited page cites that project. `pagesNeedingRescan` (pure): a page whose cited project has a rename newer than the page's `scanned_at`. `renameRescanPageIds` never throws — a failing refresh means no rescans tonight, the regular diff always goes ahead.
- `runNightly(repo, clients)`: `addRescans(heads, changed, rescanIds)` appends current pages marked for rescan that the version diff did not already pick (deleted pages are skipped); logs `N page(s) rescanned after a Jira rename` per space and returns `rescans` in the result. `index.ts` passes `forgeClients()`.
- `storedDateMs` in `repo.ts`: a zone-less SQL `DATETIME` ("2026-11-20 02:00:00") is read as UTC. `Date.parse` reads it as *local* time, and the sandbox runs at UTC+5 — the first version of the test failed exactly there. Only the new code uses it; `detectRenames` still uses `new Date(first_seen)` against a 180-day window, where a few hours cannot matter.
- 11 new tests (`test/renameRescan.test.ts`): project prefixes, the pure selection (incl. SQL-style vs ISO timestamps), `addRescans`, the repo method, the three-night end-to-end (night 1 learns and stores projects; night 2 the nightly finds the rename and queues the *unedited* page, the worker produces `JIRA_RENAMED`; night 3 nothing is re-queued, the finding clears when the page is fixed), one Jira call per cited project with unknown projects ignored, and a failing refresh. 163 total green under both `TZ=Asia/Almaty` and `TZ=UTC`; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Learned**
- A rename that happens the same night as the nightly is dated by the refresh (`first_seen` = now), so every page citing the project is rescanned once — tonight — and then `scanned_at > renamedAt` keeps them out. The comparison is strict, which is the conservative side: a page scanned in the same second as the refresh is not queued again.
- Rescans go through the full worker, not just check 3c: `replaceFindings` replaces everything a page's scan produced, so a 3c-only pass would wipe the other findings. Haiku is cached per version (page type, facts), but check 6 re-adjudicates the page's conflicts with Sonnet. A rename is rare and the pages are only those citing the project; if T17a shows this matters, the fix is a repo method that replaces one check's findings — not before.
- Pages scanned before v007 have no project list and are not rescanned until their next edit. Acceptable for a pre-launch app; a one-off backfill would need a full rescan anyway.

**Next**
- Agent (unblocked, in order): T19b suggested-fix preview (needs T16). T21 is open as PR #10 awaiting review.
- Owner: T06 verification on the dev site still gates T07 / T09 / T13 / T15a / T16b / T17a / T17b / T19c; migrations v006 and v007 and the `project_keys <> ''` / `UPDATE … VALUES()` SQL should be checked there too; T12a scope decision.

**Hours:** ~1

---

## 2026-11-22 (Sun, night) — T19a rename propagation

**Done**
- `src/checks/jiraRenamed.ts` — check 3c, finding code `JIRA_RENAMED`: a Jira component or version was renamed and the page still uses the old name. Project context comes only from issue keys on the page (as in 3b); old names are matched with 3b's rules (`componentMentioned` / `versionMention`, now exported); a page that already mentions the new name is left alone ("Card Vault (formerly Vault)"); an old name that is still the name of something else in the project, a case-only change, or a name under 3 chars is never reported. Component → medium, version → low, max 5 per page. The suggestion is the concrete fix: `Replace "Payments Gateway" with "Card Gateway".` — the first finding whose suggestion is directly applicable (T19b / T25 territory).
- The task text says "Jira changelog of component/version names". There is none: Jira REST has no history for component / version objects (issue changelogs record field changes on *issues*, and a rename does not touch them). So the app keeps its own changelog: `jira_names` table (migration `v006_jira_names`), one row per `(project, kind, jira_id, name)` with `first_seen` / `last_seen`. Component and version ids are stable across renames, so an id carrying a new name is a rename, dated by the new name's `first_seen`; its earlier rows are the names pages must drop. `detectRenames` is pure; renames older than 180 days (`RENAME_WINDOW_DAYS`) are forgotten; a project seen for the first time yields nothing.
- Worker: `renameSource` refreshes each cited project once per batch (`refreshJiraNames`: components + versions → diff against the snapshot → upsert). An empty list from a client (also what it returns on an error) is not written, so a Jira outage never turns into "every name disappeared". A failing refresh means no renames known tonight, never a wrong finding. `Repo.jiraNames` / `upsertJiraNames` in memory + Forge SQL (`ON DUPLICATE KEY UPDATE last_seen`).
- Fixture `STORAGE_RENAMED_REFS` (2 planted faults, 3 planted non-faults) + `_FIXED`. 13 new tests: the diff (first sight, fresh rename, rename chain keeps its date, window, name reuse / case-only / short names, other project / vanished id), the check, the repo upsert, and the worker over three nights (learn → rename found on the edited page → cleared when fixed; one refresh per project per batch). 152 total green; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Learned**
- Without a Jira-side history, the first nightly after install is a pure learning run: a rename that happened *before* the app was installed is invisible. That is the honest limit of a no-egress, read-only app; the 180-day window in the task is the retention of the app's own records, not a lookback into Jira.
- Incremental scanning and rename propagation pull in opposite directions: the page most likely to carry the old name is the one nobody edited since the rename, and that page is never rescanned. The check works tonight for pages that change; the sweep over unchanged pages needs the nightly to know which pages cite which projects — split into T19d rather than squeezed in (it touches `pages`, the orchestrator and the trigger).
- A name match is only as good as 3b's rules: "release 2.5" is a hit, "2.5.1" is not, "Payments Gateways" is not. Reusing the same functions means a rename finding is never *less* conservative than a drift finding on the same page.

**Next**
- Agent (unblocked, in order): T19b suggested-fix preview (needs T16), T19d rescan on rename (needs T19a — this PR). T21 is open as PR #10 awaiting review.
- Owner: T06 verification on the dev site still gates T07 / T09 / T13 / T15a / T16b / T17a / T17b / T19c; migration v006 should be checked there too; T12a scope decision.

**Hours:** ~1

---

## 2026-11-21 (Sat, night) — T21 listing copy

**Done**
- `notes/listing.md`: three name options (recommended "WikiVerify for Confluence" — the "X for Confluence" pattern Atlassian allows; the decision stays with T20), two taglines, the 250-character summary, the 1000-character "more details", three highlights (title + summary + which screenshot), five screenshot specs (what is in the frame on the seeded space, 1840 × 900, what to blur) with captions, and logo/banner notes. Every claim maps to a check or UI that exists on main (T19 included); the paid tier, the badge and the concrete fix text (T19b) are deliberately not promised. Character counts were measured (`[...s].length`) and sit in the tables.
- Copy follows `notes/phrases.md`: "wrong pages", broken links, closed Jira issues, renamed components, evidence, suggested fix; no "health score / freshness / trust" anywhere.
- No code change; typecheck, tests and manifest validation green on the branch as on main. PR #9 (T19) was awaiting review when the branch was cut and merged before this one; the branch was rebased onto it (review of PR #10).

**Learned**
- Marketplace limits (Atlassian "Building your presence on Marketplace", dated 2020, so the form wins if it disagrees): name ≤ 60, tagline ≤ 130, summary ≤ 250, more details ≤ 1000 plain text, exactly three highlights with title ≤ 50 / summary ≤ 220, screenshots 1840 × 900 (cropped 580 × 330), up to 5 extra per highlight, logo 144 × 144, banner 1120 × 548. Documentation URL is optional for a free app.
- The attachment half of the dead-link check is silent until T12a, so the listing says "pages and anchors" — worth remembering for every later copy edit: the copy must describe the manifest that ships, not the code that exists.

**Next**
- Agent (unblocked, in order): T19a rename propagation (needs T11), T19b suggested-fix preview (needs T16). T22 needs T19 (merged) but `forge eligibility` needs a logged-in CLI — owner-gated like T06.
- Owner: screenshots S1–S5 can only be taken on the seeded dev site (T06 → T07); app name decision and the questionnaire/EULA/support URL (T20); T12a scope decision. T06 verification still gates T07 / T09 / T13 / T15a / T16b / T17a / T17b / T19c.

**Hours:** ~0.5

---

## 2026-11-19 (Thu, night) — T19 byline item

**Done**
- `confluence:contentBylineItem` module `wikiverify-byline` (the module PLAN §architecture already lists; T19 is the owner's task for it): static `title: WikiVerify` + `tooltip`, `dynamicProperties` → new function `byline-properties` (`index.bylineProperties`), popup resource `src/ui/byline/index.tsx` (UI Kit, `render: native`) with its own read-only resolver function `byline` (`index.byline`). The dashboard's resolver was *not* reused: every page viewer reaches the byline's resolver, and the dashboard one has `setSpaces` / `setStaleDays` / `runNow`. Text only — a dynamic icon needs an external image URL (`forge lint` would ask for `permissions.external.images`), and this app has no external permissions.
- `src/ui/bylineSummary.ts` (pure, tested): `bylineSummary(page, openFindings)` → `{ state, title, tooltip }`. Never scanned → neutral "WikiVerify" + "has not scanned this page yet" (the item sits on every page of the site, so an unscanned page must not look like a finding, and must never read "verified"). Scanned, nothing open → "✓ verified" + "Last checked <date> (page version n)". Otherwise "⚠ N issue(s)" + severities worst-first and the distinct labels (`findingLabel`, so a contradiction names the other page), cut with "…" to the 255-char byline tooltip cap. `bylineStatus(repo, pageId)` adds the open findings worst-first for the popup. `contentIdFromPayload` accepts `extension.content.id` (documented) or `context.extension.content.id` and refuses anything that is not digits — the id goes into SQL.
- `Repo.findingsOfPage(pageId, status)` (memory + Forge SQL, `WHERE page_id = ? AND status = ?`). No schema change.
- Popup: spinner → unscanned (info message) / verified (success message) / list of findings with severity lozenge, label, evidence and suggestion; dismissing stays on the dashboard, the popup says so.
- Review fix (PR #9): the popup's resolver first took the page id from the browser-supplied payload, which would have let any viewer `invoke("bylineStatus", { pageId })` for a page they cannot open — findings quote page content. The id now comes only from the resolver's server-filled `context.extension.content.id` (`bylinePageIdFromContext`, which has no payload parameter by design, with a test that a payload id is ignored); the popup invokes with no payload. `bylineProperties` was already fine: its payload comes from Confluence, not the browser.
- 10 new tests; 139 total green; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI (and this is the first module added since the scaffold, so it matters — T19c).

**Learned**
- The chip's text does not come from the resource: `dynamicProperties` is a backend function Confluence calls when rendering the byline, and the resource is only the click-through popup. That split is what keeps the byline cheap — one SQL read per page view, no UI bundle until someone clicks.
- "Verified" is about the stored version: the byline cannot see the page's current version number (`extension.content` carries only the id), so a page edited this afternoon still shows yesterday's verdict until the nightly run. The tooltip states the check date and version for that reason. Fetching the live version from the byline would cost a REST call per page view; not worth it before T06 shows real latency.
- A resolver's `payload` is whatever the browser sends; only `context` is Forge's. Any resolver that reads data by an id must take the id from `context` (or check access) — the dashboard's `topFindings(spaceId)` is admin-facing today but should be looked at again when the global page gets non-admin viewers.
- Dev-site items for T06 / T19c: the exact `dynamicProperties` payload shape (the code logs the payload's top-level keys when it finds no id), whether a `tooltip` must be in the manifest for a dynamic tooltip to show (it is, to be safe), and `useProductContext().extension.content.id` in a byline popup.

**Next**
- Agent (unblocked, in order): T21 listing copy (needs T08, T18), T19a rename propagation (needs T11), T19b suggested-fix preview (needs T16). T22 needs T19 — done — but `forge eligibility` needs a logged-in CLI, so it is effectively owner-gated like T06.
- Owner: T06 verification on the dev site still gates T07 / T09 / T13 / T15a / T16b / T17a / T17b / T19c; T12a scope decision. Merging T19 is a major version (new module) — users re-consent on upgrade.

**Hours:** ~1

---

## 2026-11-18 (Wed, night) — T18 dashboard v1

**Done**
- Dismiss that survives rescans. `Repo.setFindingStatus(id, "open" | "dismissed")` and `Repo.findingsByStatus(spaceId, status, limit)`; findings now come back with their row `id` and `status` (`StoredFinding`). `replaceFindings` changed in two places: the duplicate check looks at open *and* dismissed rows, so a rescan that reproduces the identical finding keeps the dismissed row instead of inserting a fresh open one; and dismissed rows of the scanned page (or produced by its scan, for cross-page contradictions) that the scan no longer reports are deleted — a fixed page leaves no ghost rows, and a finding whose evidence changed ("3 dead links" → "2 dead links") is a new finding and shows up again. No schema migration: `findings.status` existed since v001.
- `src/ui/dashboardRows.ts` (pure, tested): severity filter (drops pages left empty), high → medium → low order inside a page, `pageUrl` (site-relative `/wiki/pages/viewpage.action?pageId=…` — the app never learns the hostname), tab label (space key if given, else "Space <id>").
- Dashboard: settings on top as before; below, one UI Kit `Tabs` tab per configured space. Each tab: severity `Select`, "Show dismissed" `Toggle`, the table (page title is a `Link` opening in a new tab; one line per finding with a severity lozenge, the label and a Dismiss / Restore button), and the space's cost table (was only ever shown for the first space). Resolvers: `topFindings` takes `status`, new `setFindingStatus`; both reject anything but `open` / `dismissed`. Saving spaces keeps a `spaceKey` the config already had.
- 10 new tests; 129 total green; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Learned**
- "Persists across scans" has to be defined by finding identity, not by page: the only identity the repo has is `(page, check, severity, evidence, suggestion, related)`, the same tuple the duplicate check already used. Reusing it means a dismissal is exactly as broad as the finding text — conservative in the right direction (a changed finding resurfaces) and no new column.
- Deleting dismissed rows the scan no longer reproduces was the smaller fix compared with keeping them "for history": the open list is the product, history has no reader yet, and ghost rows would otherwise match a future identical finding months later and silently hide it.
- Things only the dev site can confirm (added to T06's verification list): `UPDATE … affectedRows` shape from `@forge/sql`; UI Kit `Link` with a site-relative href inside a global page; `Select` / `Toggle` / `Tabs` props as typed in `@atlaskit/forge-react-types` 12.x.

**Next**
- Agent (unblocked, in order): T19 byline item (needs T18; the task itself adds the `confluence:contentBylineItem` module, which the backlog note already flags as a major version), then T21 listing copy, T19a rename propagation, T19b suggested-fix preview.
- Owner: T06 verification on the dev site still gates T07 / T09 / T13 / T15a / T16b / T17a / T17b; T12a scope decision.

**Hours:** ~1

---

## 2026-11-17 (Tue, night) — T17 cost report

**Done**
- `src/llm/cost.ts` (pure): `LlmUsage` keeps Haiku and Sonnet tokens apart (a Sonnet token costs 3× a Haiku one, so one total would hide which check drives the bill); `usageCostUsd` prices them at the list rates already in `client.ts`, at read time, so a price change is a one-line edit and not a migration. `projectedCostUsd` scales a run's rate to 2,000 pages; `costAlert` fires only when a run's *actual* cost passes $10, and only on the batch that crossed the line.
- Run accounting. `scan_runs` gets `fast_in/out`, `smart_in/out` (migration `v005_scan_runs_tokens`, plus an index on `(space_id, started_at)`); `Repo.finishRun` is replaced by `recordBatch`, which *adds* a batch's pages and tokens in SQL (`SET x = x + ?`) — batches of one run finish in any order, possibly concurrently. This also fixes a latent bug: `pages_scanned` was overwritten by whichever batch finished last, so the run row of a 10-batch night said "50 pages". `Repo.recentRuns(spaceId, limit)` lists runs newest first.
- Worker: tokens are attributed per call site (classification and extraction → fast, adjudication → smart), logged per batch with the $ estimate, recorded on the run, and the worker `console.warn`s `cost alert: …` once per run over budget.
- Dashboard: "Scan cost" table (last 10 runs: date, pages scanned of seen, Haiku tokens, Sonnet tokens, cost, per 2,000 pages; cost in a red lozenge when over $10). Rows come from `src/ui/costReport.ts`, pure and tested, so the UI Kit page only renders strings.
- 10 new tests (arithmetic, alert semantics, report rows, memory repo accumulation, worker end-to-end over two batches with both models, alert-once). 119 total green; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Cost watch (the DEVLOG alert T17 asks for)**
- No real scan has run yet (T06/T07 are owner-gated), so there is no measured figure. The PLAN §5 estimate (3M in / 0.3M out Haiku + ~50 Sonnet verdicts ≈ $5.10 per 2,000 pages) is the expectation; the dashboard column "Per 2,000 pages" is where the measured number will appear after the first seeded scan. Writing it here is T17a.

**Learned**
- `finished_at` on a run can only mean "last batch activity": the consumer does not know which batch is the last one. Good enough for a cost table; a real "run complete" needs a batch counter from the trigger, which T09 (incremental scan proof) will want anyway.
- A per-page projection must not be an alert. A 10-page incremental night that hits a few long pages projects to $60 per 2,000 and would cry wolf every week; the alert is on money actually spent.
- `startRun` is a plain INSERT on a primary key `<date>:<space>`: a second start the same day throws in Forge SQL. The in-memory repo silently overwrites, so no test ever saw it. Written down as T17b rather than fixed here — the right fix depends on whether "Scan now" should share the nightly's row.

**Next**
- Agent (unblocked): T18 dashboard v1 (needs T16), then T19b suggested-fix preview.
- Owner: T06 verification on the dev site still gates T07 / T09 / T13 / T15a / T16b / T17a / T17b (migration v005 should be checked there too); T12a scope decision.

**Hours:** ~1

---

## 2026-11-16 (Mon, night) — T16a check 6 follow-ups

**Done**
- Jira evidence for the adjudicator. `extractFacts` now records, per fact, the issue keys written next to the claim (`issueKeysNear`: keys in the quote, or within 120 chars of where the quote sits in the page text; only keys the storage parser already found on the page, so "ISO-9001" never qualifies; max 3). Stored in `facts.issue_keys` (migration `v004_facts_issue_keys`, comma-separated), so the *other* page's claims carry their keys too when they come back from the repo. `contradictionFindings` takes an optional `jira(key)` lookup (the worker passes `clients.jira.getIssue`, cached per batch), attaches `{status, resolved, fixVersions}` per claim, and the Sonnet prompt gets one `jira:` line per claim that cites something plus a rule on how to read it (resolved → the change happened; open → may be a plan; not found → proves nothing). A failing lookup means no evidence, never wrong evidence. The Jira client now requests `fixVersions` (`IssueInfo.fixVersions`); same scope.
- Chunking. Pages over `MAX_PAGE_CHARS` (24k) are split at blank lines (`chunkText`; an oversized paragraph is hard-split) and read in up to `MAX_CHUNKS_PER_PAGE` (4) Haiku calls, each titled "part i of n"; facts are merged and deduped by `(entity, attribute, canonValue)`, extraction stops once `MAX_FACTS_PER_PAGE` is full, usage is summed. Anything past 96k chars is skipped with a warning — that is a document dump, not a wiki page.
- Related page on the finding. `Finding.related = {pageId, pageTitle}` (check 6: the page with the current value), stored in `findings.related_page_id/title` (migration `v004_findings_related`), part of the duplicate test, returned by `openFindings`. `src/ui/findingLabel.ts` (pure, tested) renders `CONTRADICTION vs “<title>”`; the dashboard uses it. The finding's evidence also lists the cited issues ("Jira: PAY-42 — status "Done" (resolved; fix version 2.3)").
- Fixture: the runbook now cites `PAY-42` next to the port change; the worker end-to-end test asserts the key reaches Sonnet with its Jira state and that both findings name the runbook. 15 new tests; 109 total green; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Learned**
- Proximity is the only claim↔issue association available without a second LLM call, and it is good enough because it is conservative: a key 120 chars from the quote is almost always about that sentence, and a missing association only means the adjudicator sees dates + quotes as before.
- Haiku's quotes are not always verbatim to the character (trailing period, smart quotes); when `indexOf` misses, the window falls back to the quote itself, so a key inside the quote still counts. Worth checking on real pages in T16b.
- The dashboard resource is a single file but Forge bundles relative imports, so a pure helper next to it keeps the label testable without pulling `@forge/react` into vitest.

**Next**
- Agent (unblocked): T17 cost report (needs T15, T16), then T18 dashboard v1, T19b suggested-fix preview.
- Owner: T06 verification on the dev site still gates T07 / T15a / T16b (migration v004 should be checked there too); T12a scope decision.

**Hours:** ~1

---

## 2026-11-15 (Sun, night) — T16 check 6 CONTRADICTION

**Done**
- `src/llm/adjudicate.ts`: Sonnet via a forced `judge_conflict` tool (`outdated_page_id` | "unknown", `confidence`, `reason`). The prompt gets each claim's page id, title, last-edit date and verbatim quote — nothing else — and is told that a newer page is not automatically right and that "unknown" is the answer whenever a careful reader would hesitate. An id that is not one of the listed pages counts as no verdict; an unknown confidence counts as low. Capped at 6 claims and 300 output tokens per call.
- `src/checks/contradiction.ts`: pure. Takes the scanned page's facts and the stored facts of the other pages for the same `(entity, attribute)` keys, keeps only conflicts that involve the scanned page (the others belong to their own pages' scans), adjudicates at most 10 per page, and emits a `CONTRADICTION` (medium) finding only at high confidence — on the page judged outdated, which may be the *other* page. Evidence quotes both sides with titles and dates plus Sonnet's one-line reason; the suggestion names the current value and its page. Agreeing facts never reach Sonnet.
- Storage: `facts` table + `pages.facts_version` (migration v003; extraction runs once per page version, an empty list is a cached answer, a failed extraction is not). `findings.source_page_id`: `replaceFindings(pageId, …)` now means "replace everything the scan of this page produced", so a contradiction placed on page B by A's scan is refreshed when A is rescanned and when B is rescanned (B recomputes it against A's cached facts, or clears it if B was fixed). The same finding produced by both sides in one night is stored once.
- Worker: facts are resolved after the local checks (cached → `factsOfPage`, short page → `[]` without a call, else Haiku, capped at 40 facts per page), then `factsForKeys` for only the keys the page has, then adjudication. Tokens from both models go into the existing per-batch log line. No LLM → check 6 is off; extraction failure → the other checks' findings are stored and facts are retried next time.
- Fixtures `STORAGE_CONTRADICTION_RUNBOOK` / `_ONBOARDING` (2 planted faults: on-call channel, database port; 2 planted non-faults: owner, region). 14 new tests incl. the worker end-to-end over three "nights" (store → conflict → fix). 94 total green; typecheck + manifest validation green. `forge lint` still needs a logged-in CLI.

**Learned**
- The finding has to be able to land on a page that is not in the batch: in an incremental scan the page that changed is usually the *right* one, and the stale claim sits on a page nobody touched. Tracking the source page of a finding is the smallest change that keeps "replace findings on rescan" correct for both pages.
- Re-adjudicating on a replayed event costs Sonnet again (facts are cached, verdicts are not). Pages are normally rescanned only on a version change, so this is bounded; caching verdicts by the pair of fact rows is a T16a option if the cost report (T17) says it matters.
- Jira evidence for the adjudicator needs an issue-to-claim association that extraction does not produce today; shipped dates + quotes only and wrote the rest down as T16a rather than guessing.

**Next**
- Agent (unblocked): T17 cost report (needs T15, T16 — both done), then T18 dashboard v1, T19b suggested-fix preview.
- Owner: T06 verification on the dev site still gates T07 / T15a / T16b; T12a scope decision.

**Hours:** ~1.5

---

## 2026-11-14 (Sat, night) — T15 check 5 STALE_BY_TYPE

**Done**
- `src/llm/classifyPage.ts`: page type resolved in three tiers — labels (`runbook`, `how-to`, `onboarding`, `adr`, `meeting-notes`, … ; conflicting labels → undecided), title patterns but only for the two types that are never flagged (meeting notes, decision records — a wrong guess there costs nothing), then Haiku via a forced `classify_page` tool call (`type` enum + `confidence`). Only `confidence: "high"` counts; medium/low or an unknown type → `other`. Pages under 200 chars are `other` without a call; prompts are cut at 8k chars. No LLM available → `undefined`, not cached, so a non-answer never freezes into the cache.
- `src/checks/staleByType.ts`: `makeStaleByType(thresholds)`; defaults runbook 180 d, how-to 365 d, onboarding 180 d, decision / meeting-notes / other off. Medium at the threshold, high at 2×. Silent on unknown type, a type with no threshold, or an unparseable / future date. `parseStaleThresholds` validates admin input (1–3650 or numeric strings; `null`/empty = off; `other` always off).
- Cache: `Repo.getPage` + `pages.page_type` (Forge SQL migration `v002_pages_page_type` as an `ALTER TABLE`; v001 left untouched because a migration runs once per name). Worker reuses the type when the stored version matches, otherwise reclassifies; a classifier error logs and leaves the type unknown — the other checks still run.
- Worker appends check 5 to `V0_CHECKS` with thresholds from KVS `config.staleDays`; sums LLM tokens per batch into one log line (per-call logging already in the client). Dashboard: one field per type + "Save thresholds"; resolvers `getStaleDays` / `setStaleDays`.
- Fixture `STORAGE_STALE_RUNBOOK` (planted fault: 317 days old vs 180). 22 new tests incl. the worker end-to-end with `fetchPage` mocked (classify once per version, cached on re-run, reclassified on a new version). 80 total green; typecheck + manifest validation green.

**Learned**
- Classification is the place to be conservative, not the date check: the date is a fact, the type is a guess. Hence "high confidence or `other`", and labels/titles only pre-empt Haiku where a miss is free or the author said so explicitly.
- `vi.mock` is hoisted above `const`s in the test file; shared state for a mock factory needs `vi.hoisted`.
- `Date.parse` on the ISO `version.createdAt` is fine; the check floors to whole days so a page edited 179.9 days ago is not flagged at a 180-day threshold.

**Next**
- Agent (unblocked): T16 remaining steps (`facts` table, Sonnet adjudication, finding output).
- Owner: T06 verification on the dev site unblocks T15a (classifier precision + real cost) and T07.

**Hours:** ~1

---

## 2026-11-13 (Fri, night) — T12 attachments + same-page anchors

**Done**
- `parseStorage` now also returns `attachments` (`<ri:attachment>` inside `<ac:image>` / `<ac:link>` / file macros, plus `/wiki/download/attachments/{id}/{file}` hrefs, URL- and entity-decoded; a nested `<ri:page>` marks an attachment that lives on another page) and `anchors` (`#target` hrefs and `<ac:link ac:anchor>` without a page reference, anchor-macro names, element ids, heading texts, and whether the page includes other pages).
- `src/checks/deadAttachments.ts` (`DEAD_LINK`, medium / high at ≥3): compares references against `Clients.confluence.attachmentFilenames(pageId)`; case-only differences are not findings; attachments on another page referenced *by title* are skipped (resolving costs a request per reference and a wrong guess is a false positive). `undefined` from the client (403, error) → nothing flagged.
- `src/checks/deadAnchors.ts` (`DEAD_LINK`, low): a target is alive if it matches an anchor macro, an id, or a heading in any Confluence form — comparison drops case and non-alphanumerics, accepts the legacy `PageTitle-Heading` prefix and the `.1` duplicate-heading suffix; `#top` / `#` ignored; pages with include / excerpt-include macros are skipped. No API calls.
- Forge client: v2 `GET /wiki/api/v2/pages/{id}/attachments` (cursor-paged, `title` = filename), cached per page, one warning on 403.
- Planted-fault fixture `STORAGE_RUNBOOK_LOCAL_REFS` (3 attachment faults, 2 anchor faults, 9 planted non-faults). 14 new tests; 58 total green; typecheck + manifest validation green.

**Learned**
- Listing attachments needs `read:attachment:confluence`, which the manifest does not have, and scopes are owner-only. Shipped without the manifest change: the client returns `undefined` on 403, so the attachment check is a no-op until the owner adds the scope (T12a added right below T12). The anchor check works today.
- Heading anchors have had several generated forms (spaces dropped, title-prefixed, numeric suffix for duplicates); normalising both sides to `[a-z0-9]` makes the check editor-agnostic and keeps it conservative.
- `<ri:page>` nested inside `<ri:attachment>` is already collected by the page-link pass, so a missing *page* behind a cross-page attachment is reported by check 1 as before; only the file itself is unresolved.

**Next**
- Owner: T12a (scope decision), T06 verification on the dev site.
- Agent (unblocked): T15 page-type classification, T16 remaining steps.

**Hours:** ~1

---

## 2026-11-12 (Thu, night) — T11 component / version name drift

**Done**
- `src/checks/jiraNameDrift.ts` (same `JIRA_REF_DRIFT` code as check 3): project context comes only from issue keys on the page; for each such project the archived components, archived versions, and released versions that the page still calls planned/upcoming are reported. Archived component → medium, versions → low. One finding per category, names grouped.
- Matching is deliberately strict: single-word component names need exact case plus the word "component" in the same clause; multi-word or digit-bearing names match case-insensitively; version names need a release word ("version", "release", "shipped", …) in the same clause or a direct `v` prefix, and never match inside a longer version ("2.3" vs "2.3.1"). Names under 3 characters are ignored.
- `Clients.jira.getComponents/getVersions` added (interface, fake, Forge impl via `/rest/api/3/project/{key}/components|versions`, cached per project; empty list on any non-200 → check flags nothing). Existing `read:jira-work` scope covers both endpoints — no manifest change.
- Planted-fault fixture `STORAGE_RELEASE_PLAN_WITH_FAULTS` with 3 faults and 5 planted non-faults (a component called "Pricing", versions "2.3"/"1.0" appearing as a percentage and a contract section, an archived component in a project the page never mentions). 10 new tests; 44 total green; typecheck + manifest validation green.

**Learned**
- A ±N-character window is the wrong unit for context words: "Version 2.4.0 is current. Fix version 3.0.0 is planned" put "planned" inside 2.4.0's window and produced a false positive. Clause (sentence / semicolon / block) boundaries fix it; applied to every context test in the check.
- Deleted components/versions cannot be detected from the project lists — Jira drops them. If the owner wants deleted names caught, that is the rename-propagation changelog work in T19a, not this check.
- T06 remainder (dashboard renders, trigger fires, REST shapes vs the live site) needs a logged-in Forge CLI / the dev site; neither is reachable from the agent session, so it is effectively owner-gated until the owner runs it or exposes `forge logs` output. Took T11 instead (needs: T01 only).

**Next**
- Agent (unblocked): T12 attachments/anchors dead-link check, T15, T16 remaining steps.
- Owner: T06 verification on the dev site; T07 seed script needs it.

**Hours:** ~1

---

## 2026-11-12 (Thu) — app registered, deployed, installed

**Done**
- Owner: partner profile created under the product brand; dev site created; Forge secrets added to GitHub.
- `forge-bootstrap` workflow: registers the app (app.id committed), deploys to development, installs on Confluence + Jira of the dev site (site passed as run input, not stored).
- Fixed: tsconfig `noEmit` broke Forge's ts-loader bundling; Forge CLI analytics prompt fails in non-TTY CI — disabled via `forge settings set usage-analytics false`.
- `deploy-dev` now deploys on every merge to main.

**Learned**
- `UserNotFoundError` from Forge CLI = bad email/token pair (here: trailing space in the secret).
- Workflow dispatch is not available to agent sessions; manual runs need the owner (one click).

**Next**
- T06 remainder: open the dashboard on the dev site, confirm the nightly trigger runs, verify REST endpoint shapes.

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
