/**
 * Seeded pages with planted faults. Each fixture states what a correct scanner must report.
 */
export const STORAGE_RUNBOOK_WITH_FAULTS = `
<h1>Payments service runbook</h1>
<p>Owner: platform team. Last reviewed TBD.</p>
<p>Deploy steps are tracked in <ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">PAY-101</ac:parameter></ac:structured-macro>
and the migration is pending in PAY-202. See also ISO-9001 compliance notes.</p>
<p>Related: <ac:link><ri:page ri:content-title="Old deploy guide" ri:space-key="OPS" /></ac:link>,
<a href="/wiki/spaces/OPS/pages/999999/Gone">gone page</a>,
<a href="https://example.com/external">external</a>,
<a href="/browse/PAY-303">PAY-303</a>.</p>
<p>[insert escalation contact]</p>
`;

export const STORAGE_CLEAN = `
<h1>Team charter</h1>
<p>We ship weekly. Questions go to the #platform channel.</p>
<p>Current work: <a href="/browse/PAY-404">PAY-404</a>.</p>
`;

/**
 * T11 — Jira component / version names. Planted faults (project PAY, see checks.test.ts world):
 *   - "Legacy Gateway" component is archived            → flagged (medium)
 *   - "2.3.0" version is archived, mentioned as a release → flagged (low)
 *   - "3.0.0" version is released, page says "planned"    → flagged (low)
 * Planted non-faults (must NOT be flagged):
 *   - "Card Vault" component is active
 *   - "Pricing" is an archived component, but the word appears without "component" context
 *   - "2.3" and "1.0" are archived versions, but appear as a percentage and a contract section
 *   - "Ledger" is an archived component in project BIL, but the page has no BIL issue keys
 */
export const STORAGE_RELEASE_PLAN_WITH_FAULTS = `
<h1>Checkout service — release plan</h1>
<p>Work is tracked in <a href="/browse/PAY-510">PAY-510</a> and PAY-511.</p>
<p>The Legacy Gateway component owns the SOAP adapter; new work goes to the Card Vault component.</p>
<p>Release 2.3.0 ships the retry fix. Version 2.4.0 is the current supported line.</p>
<p>Fix version 3.0.0 is planned for Q1; it is not yet released.</p>
<p>Pricing is 2.3 percent per transaction; see the 1.0 section of the contract. The Ledger team signs off.</p>
`;

/**
 * T12 — attachments and same-page anchors. Page id "7" owns attachments
 * ["architecture.png", "Runbook v2.pdf", "export.csv"]; page "8" owns ["other.pdf"] (see deadLocalRefs.test.ts).
 * Planted faults:
 *   - link to attachment "old-diagram.vsdx"       → missing on this page (flagged)
 *   - image "screenshot-2024.png"                 → missing on this page (flagged)
 *   - download link to page 8 / "gone.pdf"        → missing on page 8 (flagged)
 *   - anchor "#Rollback-procedure"                → no such heading or anchor macro (flagged)
 *   - <ac:link ac:anchor="escalation">            → no such anchor (flagged)
 * Planted non-faults (must NOT be flagged):
 *   - attachment "architecture.png" (exact), "runbook v2.pdf" (case differs), download link with %20 encoding
 *   - attachment on another page referenced by title (cannot be resolved → skipped)
 *   - "#Deploysteps" (heading, spaces dropped), "#Paymentsrunbook-Deploysteps" (legacy title-prefixed form),
 *     "#Deploysteps.1" (duplicate-heading suffix), "#known-issues" (anchor macro), <ac:link ac:anchor="Deploy steps">,
 *     "#top", "#" (browser special)
 */
export const STORAGE_RUNBOOK_LOCAL_REFS = `
<h1>Payments runbook</h1>
<p>Architecture: <ac:image><ri:attachment ri:filename="architecture.png" /></ac:image></p>
<p>Old architecture: <ac:image><ri:attachment ri:filename="screenshot-2024.png" ri:version-at-save="2" /></ac:image></p>
<p>Full text: <ac:link><ri:attachment ri:filename="runbook v2.pdf" /><ac:plain-text-link-body><![CDATA[runbook]]></ac:plain-text-link-body></ac:link></p>
<p>Legacy diagram: <ac:link><ri:attachment ri:filename="old-diagram.vsdx" /></ac:link></p>
<p>Shared file: <ac:link><ri:attachment ri:filename="shared.xlsx"><ri:page ri:content-title="Shared files" ri:space-key="OPS" /></ri:attachment></ac:link></p>
<p>Data: <a href="/wiki/download/attachments/7/export.csv?version=1&amp;api=v2">export</a>,
<a href="https://acme.atlassian.net/wiki/download/attachments/7/Runbook%20v2.pdf">runbook (abs)</a>,
<a href="/wiki/download/attachments/8/gone.pdf">gone on page 8</a>,
<a href="/wiki/download/attachments/8/other.pdf">other on page 8</a>.</p>
<p>Jump to <a href="#Deploysteps">deploy steps</a>, <a href="#Paymentsrunbook-Deploysteps">deploy (legacy)</a>,
<a href="#Deploysteps.1">second deploy heading</a>, <a href="#known-issues">known issues</a>,
<a href="#Rollback-procedure">rollback</a>, <ac:link ac:anchor="escalation"><ac:plain-text-link-body><![CDATA[escalation]]></ac:plain-text-link-body></ac:link>,
<ac:link ac:anchor="Deploy steps"><ac:plain-text-link-body><![CDATA[deploy (macro)]]></ac:plain-text-link-body></ac:link>,
<a href="#top">top</a>, <a href="#">here</a>.</p>
<h2>Deploy steps</h2>
<p>Run the pipeline.</p>
<h2>Deploy steps</h2>
<p>Run it again.</p>
<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">known-issues</ac:parameter></ac:structured-macro>
<h2>Known issues</h2>
<p>None.</p>
`;

export const STORAGE_RUNBOOK_LOCAL_REFS_CLEAN = `
<h1>Payments runbook</h1>
<p>Architecture: <ac:image><ri:attachment ri:filename="architecture.png" /></ac:image></p>
<p>Jump to <a href="#Deploysteps">deploy steps</a>.</p>
<h2>Deploy steps</h2>
<p>Run the pipeline.</p>
`;

export const STORAGE_RELEASE_PLAN_CLEAN = `
<h1>Checkout service — release plan</h1>
<p>Work is tracked in PAY-510.</p>
<p>New work goes to the Card Vault component. Version 2.4.0 is the current supported line.</p>
<p>Fix version 3.0.0 shipped in October.</p>
`;

/**
 * T15 — stale by type. A runbook with no other faults. Planted fault: last edited 2026-01-01 and
 * scanned on 2026-11-14 (317 days) against the 180-day runbook default → STALE_BY_TYPE (medium).
 * Planted non-faults: the same body typed as decision / meeting-notes / other, or edited within
 * the threshold, must not be flagged. Long enough (> MIN_CLASSIFY_CHARS) to reach the LLM classifier.
 */
export const STORAGE_STALE_RUNBOOK = `
<h1>Payments service runbook</h1>
<p>Owner: platform team. On-call: #payments-oncall.</p>
<h2>Symptoms</h2>
<p>Elevated 5xx on /charge, queue depth above 10k, or the ledger reconciliation job skipping a run.</p>
<h2>Diagnosis</h2>
<p>Check the service dashboard, then the database connection pool. If the pool is exhausted, restart one replica at a time.</p>
<h2>Recovery</h2>
<p>Scale the consumer group to 6, drain the dead-letter queue, and re-run reconciliation for the affected day.</p>
<h2>Escalation</h2>
<p>Page the platform lead if recovery takes longer than 30 minutes.</p>
`;

/**
 * T16 — check 6 CONTRADICTION, planted fault: two pages in the same space disagree about the
 * on-call channel and the database port of the payments service. The runbook (edited later) says
 * #payments-oncall / 5433; the older onboarding page still says #payments-alerts / 5432.
 * Planted non-faults: both pages agree on the owner (platform team) and the region (eu-west-1).
 * T16a: the port change on the runbook cites PAY-42 — Jira evidence the adjudicator receives.
 * Fact extraction is a Haiku call, so in tests the facts are scripted; the bodies exist so the
 * seed script (T07) can plant the fault on a real site.
 */
export const STORAGE_CONTRADICTION_RUNBOOK = `
<h1>Payments service runbook</h1>
<p>Owner: platform team. Region: eu-west-1.</p>
<p>On-call channel: #payments-oncall. The database listens on port 5433 since the Postgres upgrade (PAY-42).</p>
<h2>Recovery</h2>
<p>Scale the consumer group to 6 and re-run reconciliation for the affected day.</p>
`;

export const STORAGE_CONTRADICTION_ONBOARDING = `
<h1>Payments team onboarding</h1>
<p>Welcome! The payments service is owned by the platform team and runs in eu-west-1.</p>
<p>If something breaks, post in #payments-alerts. The database is reachable on port 5432.</p>
<h2>First week</h2>
<p>Read the runbook, get access to the dashboards, and shadow one on-call shift.</p>
`;

/**
 * T19a — rename propagation. Project PAY (see jiraRenamed.test.ts world) renamed component
 * "Payments Gateway" → "Card Gateway" and version "2.5" → "2.5.0"; "Card Vault" was once "Vault"
 * but the page says both names. Planted faults:
 *   - "Payments Gateway component"            → old component name, new one absent → flagged (medium)
 *   - "release 2.5"                           → old version name with release context → flagged (low)
 * Planted non-faults (must NOT be flagged):
 *   - "Card Vault (formerly Vault)"           → the page already uses the new name
 *   - "Ledger"                                → renamed in project BIL, but the page cites no BIL issue
 *   - "Legacy Gateway"                        → archived, not renamed (that is T11's finding, not this one)
 */
export const STORAGE_RENAMED_REFS = `
<h1>Checkout service — integration notes</h1>
<p>Tracked in <a href="/browse/PAY-610">PAY-610</a>.</p>
<p>Card tokens live in the Card Vault (formerly Vault) component; SOAP calls go through the Payments Gateway component.</p>
<p>The retry fix shipped in release 2.5. The Ledger team signs off on reconciliation.</p>
<p>The Legacy Gateway component is kept for the SOAP adapter.</p>
`;

export const STORAGE_RENAMED_REFS_FIXED = `
<h1>Checkout service — integration notes</h1>
<p>Tracked in <a href="/browse/PAY-610">PAY-610</a>.</p>
<p>Card tokens live in the Card Vault component; SOAP calls go through the Card Gateway component.</p>
<p>The retry fix shipped in release 2.5.0.</p>
`;
