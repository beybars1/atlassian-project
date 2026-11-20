# Marketplace listing copy (T21) — draft 2026-11-21

Draft by the agent; the owner uploads. Buyer language comes from `notes/phrases.md` (the words to use: *wrong*, broken links, old version numbers, renamed, evidence, suggest specific updates; the words to avoid: health score, freshness, trust score, lifecycle, governance). Every claim below is something the app does today (checks 1–6, dashboard, byline chip in PR #9); nothing promises the paid tier.

Field limits are from Atlassian's [Building your presence on Marketplace](https://developer.atlassian.com/platform/marketplace/building-your-presence-on-marketplace/): name ≤ 60, tagline ≤ 130, summary ≤ 250, more details ≤ 1000 (plain text, links, bullets and line breaks only), three highlights with title ≤ 50 and summary ≤ 220, highlight screenshot 1840 × 900 px (cropped 580 × 330 px), up to 5 additional screenshots per highlight with captions ≤ 220, logo 144 × 144 px, banner 1120 × 548 px. Verify the limits in the listing form when uploading — the page is dated 2020 and the form wins. Character counts in the tables are without the surrounding quotes.

## Name

The name is the owner's call (T20 naming check). The rules: ≤ 60 characters, title case, none of the words *Atlassian / plugin / add-on / app / beta*, and "X for Confluence" is allowed while "Confluence X" is not.

| Option | Chars | Note |
|---|---|---|
| **WikiVerify for Confluence** | 25 | Recommended: the working name, passes the pattern rule, leaves room for the tagline to say what it does. |
| WikiVerify — Wrong Page Finder for Confluence | 45 | Says the job in the name; the dash and "Finder" read heavier in search results. |
| WikiVerify | 10 | Allowed, but Marketplace search matches on the name and this one carries no product keyword. |

## Tagline (≤ 130)

| Tagline | Chars |
|---|---|
| **Finds the Confluence pages that are wrong — broken links, closed Jira issues, renamed components, contradictions — and shows why.** | 129 |
| Nightly check of your wiki against Jira and itself: wrong pages, the evidence, and a suggested fix. No data leaves Atlassian. | 125 |

## Summary (≤ 250; shown in search results)

> WikiVerify scans a space nightly and lists the pages that are wrong: broken links, closed or moved Jira issues, archived components, contradictions between pages, deactivated owners, TBD placeholders. Each finding shows evidence and a suggested fix.

Chars: 249.

## More details (≤ 1000)

> Wikis do not fail loudly. A page reviewed last month can already be wrong: the Jira issue it points at was closed, the component it names was archived, the owner left, another page now says a different port. Readers quote it anyway.
>
> WikiVerify runs inside your Atlassian site every night and cross-checks each page against Jira and the rest of the space. It reports:
>
> - Broken links to pages and anchors
> - Closed, moved or deleted Jira keys; archived components and versions
> - Pages that contradict each other on the same fact, with both quotes and which page is current
> - Runbooks, how-tos and onboarding pages past the age you set
> - Pages whose owner is deactivated
> - TBD / TODO / template placeholders
>
> Every finding carries a quote from the page and a suggested fix. A dashboard ranks them by severity; a "✓ verified / ⚠ 2 issues" chip sits under every page title. Read-only. All processing, including AI, runs on Atlassian's Forge platform — nothing leaves your site.

Chars: 973 (counted as plain text with "- " bullets and blank lines; the form may count differently, so there is little slack — drop the "Readers quote it anyway." sentence first if it overflows).

## Highlights (three required; title ≤ 50, summary ≤ 220)

| # | Title (chars) | Summary (chars) | Screenshot |
|---|---|---|---|
| 1 | **Finds pages that are wrong and shows why** (40) | Broken links, Jira issues that were closed or moved, archived components, deactivated owners, TBD placeholders. Each finding quotes the page and names the fix. Ranked by severity, one dashboard per space. (204) | S1 — dashboard findings table |
| 2 | **Catches pages that contradict each other** (40) | Two pages give a different port, owner or SLA for the same thing. WikiVerify extracts the facts, compares them across the space, names the outdated page and shows both quotes with their dates. (192) | S3 — contradiction finding |
| 3 | **A verdict on every page, nothing leaves Atlassian** (49) | A "✓ verified" or "⚠ 2 issues" chip under every page title, with the findings one click away. Nightly, read-only, and all processing including AI runs inside Atlassian's Forge platform. (185) | S2 — byline chip + popup |

## Screenshots (1840 × 900 px PNG; captions ≤ 220)

Capture on the dev site after the seed script (T07) has planted the `test/fixtures/pages.ts` pages and one nightly scan has run, so the findings are real output and the evidence text is a real quote. Browser at 100 % zoom, light theme, window sized so a 1840 × 900 crop holds the content without the browser chrome. Crop out or blur anything that identifies the site: the hostname in the address bar, the site name in the top bar, avatars and real names. The seeded space can be called "Platform Operations" (key OPS) — it is already the space key the fixtures link to.

| # | What is in the frame | Caption (chars) |
|---|---|---|
| S1 | Dashboard, "Findings" section, space tab "OPS", severity filter "All". Visible rows: *Payments service runbook* with DEAD_LINK (high), JIRA_REF_DRIFT (medium), PLACEHOLDER (low) each on its own line with the lozenge, the label and the Dismiss button; *Checkout service — release plan* with JIRA_REF_DRIFT ×2 below it. Settings section scrolled out of frame. | Every page that is wrong, ranked by severity. Each line is one finding: what is broken, the quote from the page, and the suggested fix. Dismiss what you disagree with; it stays dismissed on the next scan. (204) |
| S2 | A seeded page open in Confluence with the byline chip "⚠ 3 issues" under the title and the chip's popup open, listing the three findings with severity lozenges. Hover tooltip can be a second, cropped 580 × 330 image. | The verdict where readers look: a chip under every page title, "✓ verified" or "⚠ 3 issues", with the findings one click away. Pages the scan has not reached yet say so instead of looking clean. (194) |
| S3 | Dashboard, one page row expanded to the CONTRADICTION finding: label `CONTRADICTION vs “Payments service runbook”`, evidence with both quotes and their page dates, the Jira line (`PAY-42 — status "Done"`), and the suggestion naming the current value. | Two pages, one fact, different values. WikiVerify quotes both sides with their dates, checks the Jira issues cited next to the claim, and names the page that is out of date. (173) |
| S4 | Dashboard, top: "Space IDs to scan nightly" field with one id, the Save button, and the "Stale-page thresholds" form with the six page types (runbook 90, how-to 180, onboarding 120, decision/meeting-notes/other empty). | Setup is one field: the space to scan. Age thresholds per page type — runbooks, how-tos, onboarding — are yours to set; leave a type empty and it is never reported for age. (172) |
| S5 | Dashboard, "Scan cost" table with 3–5 runs: date, pages scanned of seen, Haiku tokens, Sonnet tokens, cost, per 2,000 pages. Costs in cents. | What the AI checks cost, per run and projected to 2,000 pages. Facts and page types are cached per page version, so a nightly run only pays for what changed. (157) |

Order on the listing: S1 as highlight 1, S2 as highlight 3, S3 as highlight 2; S4 and S5 as additional screenshots under highlight 1.

## Logo and banner (owner)

- Logo 144 × 144 px, transparent or bounded background. Motif: a check mark over a page outline; no Atlassian or Confluence marks.
- Banner 1120 × 548 px: the tagline in one line over a cropped S1.

## Not in this draft (other tasks)

- Privacy & security questionnaire, support URL, EULA, documentation URL — T20 (owner). The Documentation URL is optional for a free app; a README-level page is enough for v0.
- "Runs on Atlassian" badge: the copy says "nothing leaves your site", which is true of the manifest today; the badge itself is confirmed by `forge eligibility` in T22 and should be named in the listing only after that.
- Suggested-fix text: the copy says every finding "names the fix", which is the `suggestion` line each check already emits. Rewrite to "shows the exact replacement text" only once T19b ships.
- Broken attachment links: the check exists but stays silent until the owner adds the `read:attachment:confluence` scope (T12a), so the copy says "pages and anchors" only.
- Video: optional; skip for v0.
