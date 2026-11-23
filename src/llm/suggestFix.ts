/**
 * Check 8 (T19b) — suggested-fix preview: Sonnet turns the generic `suggestion` of a finding of
 * check 3 (Jira reference drift), 4 (placeholder text) or 6 (contradiction) into a concrete edit,
 * `Replace "old" with "new".` — the same shape check 3c (T19a) already produces by itself.
 *
 * Read-only: the text is shown on the dashboard and in the byline popup; applying it is T25.
 *
 * Conservative on purpose. A draft is kept only when the model is confident AND the old text is
 * found verbatim exactly once on the page (so a later apply is unambiguous) AND the edit is small.
 * Anything else leaves the generic suggestion in place — a wrong fix costs more trust than none.
 *
 * Pure: the LLM is injected, no @forge imports.
 */
import type { CheckCode, Finding, Severity } from "../checks/types";
import type { LlmClient } from "./client";

/** Checks whose findings get a drafted fix. `JIRA_RENAMED` is concrete already; the rest have no text to edit. */
export const FIX_CHECKS: ReadonlySet<CheckCode> = new Set<CheckCode>(["JIRA_REF_DRIFT", "PLACEHOLDER", "CONTRADICTION"]);
/** Sonnet calls per page scan; worst findings first. */
export const MAX_FIXES_PER_PAGE = 3;
/** A fix is a local edit: longer passages are not a "replace", they are a rewrite. */
export const MAX_OLD_CHARS = 400;
export const MAX_NEW_CHARS = 600;
/** Characters around each piece of evidence sent to the model. */
export const EXCERPT_RADIUS = 500;
/** Fallback when nothing from the evidence can be located: the head of the page (≈1.5k tokens). */
export const MAX_EXCERPT_CHARS = 6_000;

export interface FixDraft {
  /** Verbatim text on the page, unique. */
  old: string;
  /** Replacement; empty = delete `old`. */
  new: string;
}

export interface FixResult {
  /** Absent when the model declined or its answer failed validation. */
  fix?: FixDraft;
  usage: { input: number; output: number };
  model: string;
}

export const FIX_TOOL = {
  name: "propose_fix",
  description: "Propose one minimal text edit that fixes the finding, or state that no safe edit exists.",
  parameters: {
    type: "object",
    properties: {
      old_text: {
        type: "string",
        description: "The exact text to replace, copied verbatim from the excerpt, occurring once on the page. Keep it to the smallest fragment that makes the edit unambiguous (part of a sentence, at most a sentence). Empty when no safe edit exists.",
      },
      new_text: { type: "string", description: "The replacement text. Empty to delete old_text (only when the sentence or item stands on its own without it)." },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "high only when every word of new_text is supported by the finding or the page itself and the edit cannot make the page say something false.",
      },
      note: { type: "string", description: "One short sentence, max 120 characters, on why this edit." },
    },
    required: ["old_text", "new_text", "confidence"],
  },
} as const;

const SYSTEM = `A nightly check found a problem on an internal wiki page. Draft the ONE smallest text edit that fixes it, as "replace old_text with new_text".
Rules:
- old_text must be copied character for character from the excerpt and must occur only once on the page. Prefer a fragment of a sentence over a whole sentence, and a sentence over a paragraph.
- Never invent facts. Every value in new_text must come from the finding (e.g. the new issue key, the value the other page states) or from the page itself.
- Jira reference: an issue that was moved → write the new key. An issue that is done but described as pending → reword that fragment to past tense. An issue that does not exist → remove the reference only if the sentence still reads correctly without it; otherwise answer no edit.
- Placeholder text (TBD, TODO, [insert …], coming soon …): do not fill it in with a guess. Remove the placeholder, or the unfilled field it belongs to, only when the rest stands on its own; otherwise answer no edit.
- Contradiction: replace the outdated value with the value the finding names as current, nothing more.
- Keep formatting, names and everything else unchanged. Do not "improve" the text.
- When in doubt, answer with an empty old_text and confidence low. No edit is always acceptable; a wrong edit is not.`;

const CHECK_NAMES: Partial<Record<CheckCode, string>> = {
  JIRA_REF_DRIFT: "Jira reference drift (an issue, component or version named on the page no longer means what the page implies)",
  PLACEHOLDER: "placeholder or unfinished-template text",
  CONTRADICTION: "contradiction with another page in the space",
};

/** Draft a concrete fix for one finding. Never throws on a bad model answer, only on a failed call. */
export async function suggestFix(llm: LlmClient, page: { title: string; text: string }, finding: Finding): Promise<FixResult> {
  const excerpt = excerptsFor(page.text, finding.evidence);
  const res = await llm.callTool<{ old_text?: unknown; new_text?: unknown; confidence?: unknown }>({
    tier: "smart",
    system: SYSTEM,
    user:
      `Check: ${CHECK_NAMES[finding.check] ?? finding.check}\n` +
      `Finding: ${finding.evidence}\n` +
      `Generic advice: ${finding.suggestion}\n\n` +
      `Page title: ${page.title}\n` +
      `Page excerpt (passages around the finding; "[…]" marks a cut):\n${excerpt}`,
    tool: FIX_TOOL,
    maxOutputTokens: 400,
  });
  const v = res.value ?? {};
  const draft: FixDraft = { old: typeof v.old_text === "string" ? v.old_text : "", new: typeof v.new_text === "string" ? v.new_text : "" };
  const fix = v.confidence === "high" && validFix(page.text, draft) ? draft : undefined;
  return { ...(fix ? { fix } : {}), usage: res.usage, model: res.model };
}

/** The suggestion text for a validated draft — the shape T19a uses, so the dashboard reads the same for both. */
export function formatFix(fix: FixDraft): string {
  return fix.new ? `Replace "${fix.old}" with "${fix.new}".` : `Remove "${fix.old}".`;
}

/**
 * A draft is usable when the old text is a non-trivial, unique, verbatim passage of the page and the
 * replacement is a bounded, actual change. Whitespace at the ends is not part of the edit.
 */
export function validFix(pageText: string, draft: FixDraft): boolean {
  const old = draft.old.trim();
  const neu = draft.new.trim();
  if (old.length < 3 || old.length > MAX_OLD_CHARS) return false;
  if (neu.length > MAX_NEW_CHARS || neu === old) return false;
  if (countOccurrences(pageText, old) !== 1) return false;
  draft.old = old;
  draft.new = neu;
  return true;
}

function countOccurrences(text: string, needle: string): number {
  let n = 0;
  for (let i = text.indexOf(needle); i >= 0 && n < 2; i = text.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

/**
 * The parts of the page the model needs: a window around every quoted string and issue key the
 * evidence mentions that can be located on the page (whitespace-insensitively — evidence snippets
 * are whitespace-collapsed). Overlapping windows merge; cuts are marked. When nothing is found,
 * the head of the page.
 */
export function excerptsFor(text: string, evidence: string, radius = EXCERPT_RADIUS): string {
  const anchors = new Set<string>();
  for (const m of evidence.matchAll(/["“]([^"”]{3,200})["”]/g)) anchors.add(m[1]);
  for (const m of evidence.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) anchors.add(m[0]);

  const spans: Array<[number, number]> = [];
  for (const a of anchors) {
    const re = new RegExp(a.trim().split(/\s+/).map(escapeRe).join("\\s+"));
    const m = re.exec(text);
    if (!m) continue;
    spans.push([Math.max(0, m.index - radius), Math.min(text.length, m.index + m[0].length + radius)]);
  }
  if (spans.length === 0) return text.slice(0, MAX_EXCERPT_CHARS) + (text.length > MAX_EXCERPT_CHARS ? "\n[…]" : "");

  spans.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged
    .map(([a, b]) => (a > 0 ? "[…]" : "") + text.slice(a, b) + (b < text.length ? "[…]" : ""))
    .join("\n");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export interface FixPreviewResult {
  findings: Finding[];
  /** Sonnet calls made. */
  drafted: number;
  usage: { input: number; output: number };
}

/**
 * Give the eligible findings of a page a concrete suggestion. Worst findings first, at most
 * `max` Sonnet calls; findings that land on another page (check 6) are left alone — their text is
 * not at hand. A finding already stored for this page version with the same identity keeps its
 * stored suggestion without a call: cheaper, and a dismissed one stays dismissed (T18 matches on
 * the suggestion text). A failing call keeps the generic suggestion.
 */
export async function addFixPreviews(args: {
  llm: LlmClient;
  page: { id: string; title: string; text: string };
  findings: Finding[];
  /** Findings stored for this page from a scan of the same version (open and dismissed). */
  stored?: Finding[];
  max?: number;
  log?: (line: string) => void;
}): Promise<FixPreviewResult> {
  const { llm, page, max = MAX_FIXES_PER_PAGE, stored = [] } = args;
  const out = [...args.findings];
  const usage = { input: 0, output: 0 };
  let drafted = 0;
  const order = out
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.pageId === page.id && FIX_CHECKS.has(f.check))
    .sort((a, b) => RANK[b.f.severity] - RANK[a.f.severity] || a.i - b.i);
  for (const { f, i } of order) {
    const prior = stored.find((s) => s.check === f.check && s.severity === f.severity && s.evidence === f.evidence && s.related?.pageId === f.related?.pageId);
    if (prior) {
      out[i] = { ...f, suggestion: prior.suggestion };
      continue;
    }
    if (drafted >= max) break;
    drafted += 1;
    try {
      const r = await suggestFix(llm, page, f);
      usage.input += r.usage.input;
      usage.output += r.usage.output;
      if (r.fix) out[i] = { ...f, suggestion: formatFix(r.fix) };
    } catch (err) {
      args.log?.(`suggest fix ${page.id}/${f.check} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { findings: out, drafted, usage };
}
