import type { Check, Clients, Finding, PageRecord } from "./types";
import { deadLinks } from "./deadLinks";
import { deadAttachments } from "./deadAttachments";
import { deadAnchors } from "./deadAnchors";
import { ownerGone } from "./ownerGone";
import { jiraRefDrift } from "./jiraRefDrift";
import { jiraNameDrift } from "./jiraNameDrift";
import { placeholders } from "./placeholders";

/**
 * v0 checks that need nothing beyond the page and the clients, in the order they run.
 * Check 5 (`staleByType`) is appended by the worker with the admin thresholds. Check 6
 * (`contradiction.ts`) is not a `Check`: it needs stored facts and an adjudicator, so the worker
 * runs it after these and merges its findings.
 */
export const V0_CHECKS: Check[] = [
  deadLinks,
  deadAttachments,
  deadAnchors,
  ownerGone,
  jiraRefDrift,
  jiraNameDrift,
  placeholders,
];

export async function runChecks(page: PageRecord, clients: Clients, checks = V0_CHECKS): Promise<Finding[]> {
  const results = await Promise.allSettled(checks.map((c) => c(page, clients)));
  const findings: Finding[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") findings.push(...r.value);
    // A failing check must never block the others; the worker logs rejections.
  }
  return findings;
}

export const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;

export function scorePage(findings: Finding[]): number {
  return findings.reduce((s, f) => s + SEVERITY_RANK[f.severity], 0);
}
