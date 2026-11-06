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
