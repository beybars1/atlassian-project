import type { Check, Finding, PageType, Severity } from "./types";
import { PAGE_TYPES } from "./types";

/**
 * Check 5 — STALE_BY_TYPE: operational pages (runbooks, how-tos, onboarding) that nobody has
 * touched for longer than the threshold for their type.
 *
 * The page type comes from `page.pageType` (labels / title / Haiku, resolved by the worker and
 * cached per page version — see `src/llm/classifyPage.ts`). Pure otherwise: no API calls.
 * Conservative: unknown type, `other`, a type with no threshold, or an unparseable date → nothing.
 */

/** Days after the last edit at which a page of this type counts as stale; `null` = never. */
export type StaleThresholds = Record<PageType, number | null>;

export const DEFAULT_STALE_DAYS: StaleThresholds = {
  runbook: 180,
  "how-to": 365,
  onboarding: 180,
  decision: null, // a decision record is a historical document; it does not go stale
  "meeting-notes": null, // same
  other: null, // never flagged — this is also where low-confidence classifications land
};

const MAX_DAYS = 3650;

/**
 * Admin configuration (KVS `config.staleDays`) merged over the defaults. Accepts integers 1–3650
 * or numeric strings from a form field; `null` switches a type off; anything else keeps the default.
 * `other` is always `null`.
 */
export function parseStaleThresholds(raw: unknown): StaleThresholds {
  const out: StaleThresholds = { ...DEFAULT_STALE_DAYS };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const type of PAGE_TYPES) {
    if (type === "other" || !(type in obj)) continue;
    const v = obj[type];
    if (v === null || v === "") {
      out[type] = null;
      continue;
    }
    const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_DAYS) out[type] = n;
  }
  out.other = null;
  return out;
}

const DAY_MS = 86_400_000;

export const LABEL: Record<PageType, string> = {
  runbook: "runbook",
  "how-to": "how-to guide",
  onboarding: "onboarding page",
  decision: "decision record",
  "meeting-notes": "meeting notes",
  other: "page",
};

export function makeStaleByType(thresholds: StaleThresholds = DEFAULT_STALE_DAYS): Check {
  return async (page, clients): Promise<Finding[]> => {
    const type = page.pageType;
    if (!type) return [];
    const threshold = thresholds[type];
    if (!threshold || threshold <= 0) return [];

    const edited = Date.parse(page.lastModified);
    if (Number.isNaN(edited)) return [];
    const ageDays = Math.floor((clients.now().getTime() - edited) / DAY_MS);
    if (ageDays < threshold) return [];

    const severity: Severity = ageDays >= 2 * threshold ? "high" : "medium";
    const label = LABEL[type];
    return [
      {
        pageId: page.id,
        check: "STALE_BY_TYPE",
        severity,
        evidence: `Classified as ${label}; last edited ${page.lastModified.slice(0, 10)} (${ageDays} days ago), threshold for this type is ${threshold} days.`,
        suggestion: `Review the ${label}: update anything that changed, or make a small confirming edit so the date reflects a real review. Archive it if it is no longer used.`,
      },
    ];
  };
}

/** Default-threshold instance. */
export const staleByType: Check = makeStaleByType();
