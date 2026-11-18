/**
 * Pure helpers for the dashboard (T18): severity filter, finding order, page links, tab labels.
 * No @forge imports so they are unit-tested; the UI Kit page only renders what comes out of here.
 */
import type { Severity } from "../checks/types";
import type { StoredFinding } from "../db/repo";

/** What the resolver returns per page: the stored page fields the table shows plus its findings. */
export interface DashboardRow {
  page: { pageId: string; title: string; lastModified: string };
  findings: StoredFinding[];
}

export type SeverityFilter = Severity | "all";

export const SEVERITY_OPTIONS: Array<{ label: string; value: SeverityFilter }> = [
  { label: "All severities", value: "all" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Keep only findings of one severity; pages with nothing left disappear from the table. */
export function filterBySeverity(rows: DashboardRow[], severity: SeverityFilter): DashboardRow[] {
  if (severity === "all") return rows;
  return rows.map((r) => ({ ...r, findings: r.findings.filter((f) => f.severity === severity) })).filter((r) => r.findings.length > 0);
}

/** High first, then medium, then low; the repo's order otherwise. */
export function sortFindings<T extends { severity: Severity }>(findings: T[]): T[] {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/**
 * Site-relative URL of a page. The app never knows (or stores) the site's hostname; UI Kit's
 * `Link` resolves a relative URL against the Atlassian site the dashboard runs on.
 */
export function pageUrl(pageId: string): string {
  return `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}

/** Tab label: the space key when the admin gave one, else the id. */
export function spaceLabel(space: { spaceId: string; spaceKey?: string }): string {
  return space.spaceKey?.trim() ? space.spaceKey.trim() : `Space ${space.spaceId}`;
}
