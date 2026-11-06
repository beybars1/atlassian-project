import type { Check, Finding } from "./types";

/**
 * Check 2 — the page owner (or, failing that, the last editor) is deactivated.
 * `isActive` returns undefined when the user cannot be resolved (e.g. anonymous, app user).
 */
export const ownerGone: Check = async (page, clients): Promise<Finding[]> => {
  const findings: Finding[] = [];

  if (page.ownerId) {
    const active = await clients.users.isActive(page.ownerId);
    if (active === false) {
      findings.push({
        pageId: page.id,
        check: "OWNER_GONE",
        severity: "high",
        evidence: `Page owner (${page.ownerId}) is deactivated.`,
        suggestion: "Assign a new owner, or archive the page if nobody needs it.",
      });
      return findings;
    }
  }

  if (!page.ownerId && page.lastEditorId) {
    const active = await clients.users.isActive(page.lastEditorId);
    if (active === false) {
      findings.push({
        pageId: page.id,
        check: "OWNER_GONE",
        severity: "medium",
        evidence: `No owner set; last editor (${page.lastEditorId}) is deactivated.`,
        suggestion: "Set a page owner so someone is accountable for keeping it current.",
      });
    }
  }
  return findings;
};
