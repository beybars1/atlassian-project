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

export const STORAGE_RELEASE_PLAN_CLEAN = `
<h1>Checkout service — release plan</h1>
<p>Work is tracked in PAY-510.</p>
<p>New work goes to the Card Vault component. Version 2.4.0 is the current supported line.</p>
<p>Fix version 3.0.0 shipped in October.</p>
`;
