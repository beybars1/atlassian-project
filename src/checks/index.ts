import type { Check, Clients, Finding, PageRecord } from "./types";
import { deadLinks } from "./deadLinks";
import { ownerGone } from "./ownerGone";
import { jiraRefDrift } from "./jiraRefDrift";
import { placeholders } from "./placeholders";

/** v0 checks, in the order they run. Checks 5–6 (LLM) are added in week 3. */
export const V0_CHECKS: Check[] = [deadLinks, ownerGone, jiraRefDrift, placeholders];

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
