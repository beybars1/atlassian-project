/**
 * Check 6, step 3 — Sonnet decides which page is outdated when two pages disagree on a fact.
 *
 * Input: the conflicting claims with their page titles, last-edit dates and verbatim quotes.
 * Output: the page id judged outdated (or none) with a confidence. Only `high` becomes a finding;
 * anything else is treated as "cannot tell" by the caller. Since T16a a claim may carry Jira
 * evidence: the live status / fix versions of the issues written next to it on the page.
 */
import type { LlmClient } from "./client";

/** Live state of a Jira issue referenced next to a claim (looked up by the caller). */
export interface JiraEvidence {
  key: string;
  exists: boolean;
  status?: string;
  resolved?: boolean;
  fixVersions?: string[];
}

export interface Claim {
  pageId: string;
  pageTitle: string;
  /** ISO date of the page's last edit. */
  pageLastModified: string;
  value: string;
  quote: string;
  /** Issues cited next to the claim, with what Jira says about them today. Absent = none cited. */
  jira?: JiraEvidence[];
}

export interface Conflict {
  entity: string;
  attribute: string;
  claims: Claim[];
}

export type Confidence = "high" | "medium" | "low";

export interface Verdict {
  /** Page whose claim is outdated; `undefined` when the model could not decide or named no listed page. */
  outdatedPageId?: string;
  confidence: Confidence;
  reason: string;
  usage: { input: number; output: number };
  model: string;
}

export const ADJUDICATE_TOOL = {
  name: "judge_conflict",
  description: "Record which page states the outdated value, or that it cannot be determined.",
  parameters: {
    type: "object",
    properties: {
      outdated_page_id: {
        type: "string",
        description: 'The id of the page whose value is no longer current, exactly as listed, or "unknown" when the evidence does not settle it.',
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "high only when the quotes or dates make it clear which value is current (e.g. one page explains the change, or one is much newer and specific).",
      },
      reason: { type: "string", description: "One sentence, max 200 characters, citing the evidence used." },
    },
    required: ["outdated_page_id", "confidence", "reason"],
  },
} as const;

const SYSTEM = `Two or more internal wiki pages state different values for the same fact. Decide which page is OUTDATED.
Rules:
- Use only the evidence given: each page's last-edit date, the verbatim quote and, when present, the Jira evidence. Do not guess from general knowledge.
- A newer page is not automatically right: an old page that is specific and consistent can beat a newer page that merely repeats a template. Prefer the value backed by an explanation of a change ("since the upgrade", "moved to", "as of").
- If the two values could both be true (different environments, different scopes, a list vs one item), answer "unknown".
- Jira evidence, when given, is the tracker's state today for issues cited next to a claim: a resolved issue means the change it tracks has happened, so a claim citing it describes the present; an open issue means the change has not happened yet, so such a claim may describe a plan; an issue not found proves nothing.
- Answer "unknown" with confidence low whenever a careful reader would hesitate. A wrong verdict costs more than no verdict.`;

/** One line of Jira evidence for the prompt and the finding, e.g. `PAY-42 — status "Done" (resolved; fix version 2.3)`. */
export function describeIssue(e: JiraEvidence): string {
  if (!e.exists) return `${e.key} — not found in Jira`;
  const notes = [e.resolved ? "resolved" : "open", e.fixVersions?.length ? `fix version ${e.fixVersions.join(", ")}` : ""].filter(Boolean);
  return `${e.key} — status "${e.status ?? "unknown"}" (${notes.join("; ")})`;
}

const MAX_CLAIMS = 6;
const date = (iso: string) => (Number.isFinite(Date.parse(iso)) ? iso.slice(0, 10) : "unknown date");

export async function adjudicateConflict(llm: LlmClient, conflict: Conflict): Promise<Verdict> {
  const claims = conflict.claims.slice(0, MAX_CLAIMS);
  const lines = claims.map(
    (c, i) =>
      `${i + 1}. page id "${c.pageId}" — "${c.pageTitle}" (last edited ${date(c.pageLastModified)})\n   value: ${c.value}\n   quote: "${c.quote}"` +
      (c.jira?.length ? `\n   jira: ${c.jira.map(describeIssue).join("; ")}` : ""),
  );
  const res = await llm.callTool<{ outdated_page_id?: unknown; confidence?: unknown; reason?: unknown }>({
    tier: "smart",
    system: SYSTEM,
    user: `Fact: ${conflict.entity} · ${conflict.attribute}\n\nClaims:\n${lines.join("\n")}`,
    tool: ADJUDICATE_TOOL,
    maxOutputTokens: 300,
  });
  const v = res.value ?? {};
  const id = typeof v.outdated_page_id === "string" ? v.outdated_page_id.trim() : "";
  const outdatedPageId = claims.some((c) => c.pageId === id) ? id : undefined;
  const confidence: Confidence = v.confidence === "high" || v.confidence === "medium" ? v.confidence : "low";
  const reason = typeof v.reason === "string" ? v.reason.trim().slice(0, 300) : "";
  return { outdatedPageId, confidence, reason, usage: res.usage, model: res.model };
}
