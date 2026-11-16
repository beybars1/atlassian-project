/**
 * Check 6 — CONTRADICTION: two pages in the same space state different values for the same fact.
 *
 * Not a plain `Check`: it needs the scanned page's facts (Haiku, cached per version — see
 * `src/llm/extractFacts.ts`), the stored facts of the other pages in the space (repo), and an
 * adjudicator (Sonnet — `src/llm/adjudicate.ts`). The worker wires those; this file is pure.
 *
 * Only conflicts that involve the scanned page are considered (the rest belong to the scans of the
 * pages involved). The finding lands on the page the adjudicator judges outdated — which may be the
 * other page, not the scanned one — and only at high confidence. Everything else is silence.
 */
import type { Fact } from "../llm/extractFacts";
import { canonValue, findConflicts } from "../llm/extractFacts";
import { describeIssue, type Claim, type Conflict, type JiraEvidence, type Verdict } from "../llm/adjudicate";
import type { Finding, IssueInfo } from "./types";

/** A fact as stored for another page in the space, with the page context the adjudicator needs. */
export type StoredFact = Fact & Pick<Claim, "pageId" | "pageTitle" | "pageLastModified">;

export type Adjudicator = (conflict: Conflict) => Promise<Verdict>;

/** Sonnet calls per page scan are capped: a page that disagrees with everything is a page problem, not a space problem. */
export const MAX_CONFLICTS_PER_PAGE = 10;
/** Jira lookups per claim (T16a); keys are cached per batch by the Forge client anyway. */
export const MAX_ISSUES_PER_CLAIM = 3;

export interface ContradictionResult {
  findings: Finding[];
  /** Conflicts involving the page (adjudicated ones, after the cap). */
  conflicts: number;
  usage: { input: number; output: number };
}

export async function contradictionFindings(args: {
  page: { id: string; title: string; lastModified: string };
  pageFacts: Fact[];
  otherFacts: StoredFact[];
  adjudicate: Adjudicator;
  /** Live issue lookup for keys cited next to a claim (T16a). Absent or failing → no Jira evidence, dates + quotes only. */
  jira?: (key: string) => Promise<IssueInfo>;
  maxConflicts?: number;
}): Promise<ContradictionResult> {
  const { page, adjudicate, maxConflicts = MAX_CONFLICTS_PER_PAGE } = args;
  const keysOf = new Map<string, string[]>(); // `${pageId}\0${quote}` → issue keys cited next to that claim
  const remember = (pageId: string, f: Fact) => {
    if (f.issueKeys?.length) keysOf.set(`${pageId}\u0000${f.quote}`, f.issueKeys);
  };
  for (const f of args.pageFacts) remember(page.id, f);
  for (const f of args.otherFacts) remember(f.pageId, f);
  const context = new Map<string, Pick<Claim, "pageTitle" | "pageLastModified">>();
  context.set(page.id, { pageTitle: page.title, pageLastModified: page.lastModified });
  for (const f of args.otherFacts) context.set(f.pageId, { pageTitle: f.pageTitle, pageLastModified: f.pageLastModified });

  const all = [
    ...args.pageFacts.map((f) => ({ ...f, pageId: page.id })),
    ...args.otherFacts.filter((f) => f.pageId !== page.id),
  ];
  const conflicts = findConflicts(all)
    .filter((c) => c.claims.some((k) => k.pageId === page.id))
    .slice(0, maxConflicts);

  const usage = { input: 0, output: 0 };
  const findings: Finding[] = [];
  for (const c of conflicts) {
    const claims: Claim[] = [];
    for (const k of c.claims) {
      const jira = await evidenceFor(keysOf.get(`${k.pageId}\u0000${k.quote}`) ?? [], args.jira);
      claims.push({ ...k, ...context.get(k.pageId)!, ...(jira.length ? { jira } : {}) });
    }
    const conflict: Conflict = { entity: c.entity, attribute: c.attribute, claims };
    let verdict: Verdict;
    try {
      verdict = await adjudicate(conflict);
    } catch (err) {
      console.warn(`adjudicate ${c.entity}/${c.attribute} failed`, err);
      continue;
    }
    usage.input += verdict.usage.input;
    usage.output += verdict.usage.output;
    if (verdict.confidence !== "high" || !verdict.outdatedPageId) continue;
    const finding = toFinding(conflict, verdict.outdatedPageId, verdict.reason, page.id);
    if (finding) findings.push(finding);
  }
  return { findings, conflicts: conflicts.length, usage };
}

/** Jira state of the issues cited next to a claim; a failing lookup yields no evidence rather than a wrong one. */
async function evidenceFor(keys: string[], jira?: (key: string) => Promise<IssueInfo>): Promise<JiraEvidence[]> {
  if (!jira || keys.length === 0) return [];
  const out: JiraEvidence[] = [];
  for (const key of keys.slice(0, MAX_ISSUES_PER_CLAIM)) {
    try {
      const i = await jira(key);
      out.push({ key, exists: i.exists, status: i.statusName, resolved: i.resolved, fixVersions: i.fixVersions });
    } catch (err) {
      console.warn(`jira ${key} lookup failed`, err);
    }
  }
  return out;
}

function toFinding(conflict: Conflict, outdatedPageId: string, reason: string, scannedPageId: string): Finding | undefined {
  const outdated = conflict.claims.find((k) => k.pageId === outdatedPageId);
  if (!outdated) return undefined;
  // The "current" claim: the most recently edited page that says something else.
  const current = conflict.claims
    .filter((k) => k.pageId !== outdatedPageId && canonValue(k.value) !== canonValue(outdated.value))
    .sort((a, b) => Date.parse(b.pageLastModified) - Date.parse(a.pageLastModified))[0];
  if (!current) return undefined;
  const self = outdatedPageId === scannedPageId ? "this page" : `"${outdated.pageTitle}"`;
  const key = `${conflict.entity} · ${conflict.attribute}`;
  const cited = [...(outdated.jira ?? []), ...(current.jira ?? [])].filter((e) => e.exists);
  const evidence =
    `${key}: ${self} says "${outdated.value}" (${q(outdated.quote)}); ` +
    `"${current.pageTitle}" (edited ${day(current.pageLastModified)}) says "${current.value}" (${q(current.quote)}).` +
    (cited.length ? ` Jira: ${cited.map(describeIssue).join("; ")}.` : "") +
    (reason ? ` ${reason}` : "");
  return {
    pageId: outdatedPageId,
    check: "CONTRADICTION",
    severity: "medium",
    evidence,
    suggestion: `Update ${conflict.attribute} of ${conflict.entity} to "${current.value}" to match "${current.pageTitle}", or correct that page if this one is right.`,
    related: { pageId: current.pageId, pageTitle: current.pageTitle },
  };
}

const q = (s: string) => `"${s.length > 160 ? s.slice(0, 157) + "…" : s}"`;
const day = (iso: string) => (Number.isFinite(Date.parse(iso)) ? iso.slice(0, 10) : "unknown date");
