/**
 * Dashboard label for a finding. Pure (no @forge imports) so it is unit-tested; the UI Kit page
 * imports it. A contradiction names the other page, because "CONTRADICTION" alone sends the reader
 * hunting through the evidence text for which page to compare against.
 */
export function findingLabel(f: { check: string; related?: { pageId: string; pageTitle: string } }): string {
  return f.check === "CONTRADICTION" && f.related ? `CONTRADICTION vs “${f.related.pageTitle}”` : f.check;
}
