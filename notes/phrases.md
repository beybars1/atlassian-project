# Buyer language and competitive map (T08) — collected 2026-11-11

Marketplace review pages are client-rendered and the REST API is robots-blocked, so written 1–3★ reviews could not be pulled. Buyer language below comes from Atlassian Community threads where admins describe the problem in their own words. Listing data is from the Marketplace pages as shown on 11 Nov 2026.

## Verbatim buyer phrases (use in listing copy, ads, interview script)

| Phrase | Who | Source |
|---|---|---|
| "Our team struggles with outdated documentation - old version numbers, broken links, deprecated processes" | Star LLC (admin) | [How do you keep Confluence content up to date](https://community.atlassian.com/forums/Confluence-questions/How-do-you-keep-Confluence-content-up-to-date/qaa-p/3140765) |
| "Manual reviews take forever." | Star LLC | same |
| "we do not have it due to cost saving measures" (on Better Content Archiving) | Brant Schroeder | same |
| "the name of something changes and you need to update it without knowing exactly where it appears" | Stavros Rougas (vendor) | same |
| "can Atlassian Intelligence suggest specific updates for docs?" | Star LLC | same |
| AI is useful for "the formal / deterministic / trivial updates" with human review | Aron Gombas (Midori) | same |
| "a page reviewed last month can already be wrong" | Bart_deynrj | [Do you archive/delete old pages or keep everything?](https://community.atlassian.com/forums/Atlassian-AI-Rovo-discussions/Do-you-archive-delete-old-Confluence-pages-or-keep-everything/m-p/3256780) |
| "that sneaky feeling that something used to work one way and now doesn't seem to" | Anne Saunders | same |
| "an agent that kept answering from a deleted Confluence source" | Sami Shaik | same |
| "Sometimes it picks the old one." | Sami Shaik | same |
| "The part I haven't seen anyone solve with process alone is discovery" | Bart_deynrj | same |
| "In practice most teams have no way to answer that at scale" | Bart_deynrj | same |
| Rovo "spends more time (and tokens) trying to make sense of it" | Roger Barnes | same |
| "a stale runbook cost an on-call engineer 45 minutes" | FreshPage (vendor anecdote) | [Your wiki is confidently giving wrong answers](https://community.atlassian.com/forums/App-Central-articles/Your-Confluence-wiki-is-confidently-giving-people-wrong/ba-p/3192612) |
| 40% named "outdated content" the top barrier to finding information | Elevatic poll | [Poll](https://community.atlassian.com/forums/App-Central-articles/Poll-Time-%EF%B8%8F-What-makes-finding-information-in-Confluence-hardest/ba-p/3237012) |

**Words to use:** wrong (not "stale"), broken links, old version numbers, deprecated processes, renamed, discovery, "answer at scale", suggest specific updates, evidence, Rovo quotes it.
**Words to avoid:** health score, freshness, trust score, lifecycle, governance — every zero-install app below uses them.

## Competitive map — Confluence Cloud content quality (11 Nov 2026)

| App | Vendor | Installs | Reviews | Job | Overlap with us |
|---|---|---|---|---|---|
| [Comala Document Management](https://marketplace.atlassian.com/apps/142/comala-document-management) | Appfire | 5,822 | 4.7 (177) | Approval workflows, e-signatures, audit trail | None — process, not verification |
| [Better Content Archiving](https://marketplace.atlassian.com/apps/123/better-content-archiving-and-analytics-for-confluence) | Midori | 1,083 | 4.8 (156) | Statuses, owner reminders, policy archiving, analytics; Cloud Fortified | Owner reminders; "too expensive" for some |
| [Pulse — Content Health](https://marketplace.atlassian.com/apps/2446184211/pulse-content-health-for-confluence) | Bytera | 143 | none | Health score, AI-ready score, broken links, duplicate detection (AI semantic in Advanced) | Broken links, duplicates |
| [Content Score](https://marketplace.atlassian.com/apps/1476919430/content-score-for-confluence-page-quality) | TypeSwitch | 3 | none | Rule-based factor scoring | None real |
| [FreshPage](https://marketplace.atlassian.com/apps/1059183334/freshpage-trusted-knowledge-for-confluence) | LogicLemur Labs | 2 | none | Verified / needs-review banners, review policies | None real |
| [Evergreen](https://marketplace.atlassian.com/apps/1279909983/evergreen-stale-pages-content-review-for-confluence) | keelapps | 1 | none | Fresh/Aging/Stale badges by age | None real |
| [Content Health](https://marketplace.atlassian.com/apps/834797716/content-health-for-confluence) | Ros Entertainment | 1 | none | 0–100 score per page, free | None real |

**Reading:** five "freshness / health score" apps shipped in 2026 and have 1–143 installs between them. Scoring by age and labels is a commodity nobody buys. The one with traction (Pulse) added concrete detections — broken links, duplicates. Nobody does: cross-check against Jira, owner-deactivated, contradictions with evidence, rename propagation, or proposed fixes. That is the positioning: **"finds pages that are wrong and shows why"**, never "health score".

## Implications proposed for the owner (not applied — scope changes need your call)

1. Rename the product promise from "verifier" to the buyer's words: *finds wrong pages — broken links, old versions, renamed things, contradictions — with evidence and a suggested fix.*
2. Move "suggested fix" text into the free tier's output (read-only preview); keep one-click *apply* as the paid feature. Star LLC asked for exactly "suggest specific updates"; showing it free is the demo.
3. Add a check: **rename propagation** — when a Jira component/version/service name changes, list every page still using the old name. Direct quote from the thread; nobody ships it.
