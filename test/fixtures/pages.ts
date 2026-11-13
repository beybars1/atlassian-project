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
