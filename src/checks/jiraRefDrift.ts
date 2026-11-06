import type { Check, Finding, IssueInfo } from "./types";

/**
 * Check 3 — Jira references on the page that no longer mean what the page implies.
 * v0 covers issue keys: deleted, moved, or resolved while the page talks about them as open.
 * Components and versions are a follow-up task (see TASKS.md).
 */
export const jiraRefDrift: Check = async (page, clients): Promise<Finding[]> => {
  if (page.issueKeys.length === 0) return [];
  const known = await clients.jira.knownProjectKeys();
  const keys = page.issueKeys.filter((k) => known.has(k.split("-")[0]));
  if (keys.length === 0) return [];

  const infos = await Promise.all(keys.map((k) => clients.jira.getIssue(k)));

  const missing = infos.filter((i) => !i.exists && !i.movedTo);
  const moved = infos.filter((i) => i.movedTo);
  const done = infos.filter((i) => i.exists && i.statusCategory === "done" && mentionsAsOpen(page.text, i));

  const findings: Finding[] = [];
  if (missing.length) {
    findings.push({
      pageId: page.id,
      check: "JIRA_REF_DRIFT",
      severity: "high",
      evidence: `Issue(s) not found in Jira: ${missing.map((i) => i.key).join(", ")}.`,
      suggestion: "Replace with the current issue key or remove the reference.",
    });
  }
  if (moved.length) {
    findings.push({
      pageId: page.id,
      check: "JIRA_REF_DRIFT",
      severity: "medium",
      evidence: moved.map((i) => `${i.key} was moved to ${i.movedTo}`).join("; ") + ".",
      suggestion: "Update the key(s) to the new location.",
    });
  }
  if (done.length) {
    findings.push({
      pageId: page.id,
      check: "JIRA_REF_DRIFT",
      severity: "low",
      evidence: done.map((i) => `${i.key} is ${i.statusName ?? "done"} but the page describes it as pending`).join("; ") + ".",
      suggestion: "Reword the section or remove the completed item.",
    });
  }
  return findings;
};

const OPEN_WORDS = /\b(pending|in progress|planned|will be|to be|blocked|waiting|upcoming|not yet)\b/i;

/** Cheap heuristic: the sentence around the key uses "open" language. */
function mentionsAsOpen(text: string, issue: IssueInfo): boolean {
  const idx = text.indexOf(issue.key);
  if (idx < 0) return false;
  const window = text.slice(Math.max(0, idx - 120), idx + 120);
  return OPEN_WORDS.test(window);
}
