/**
 * Check 5, step 1 — decide what kind of page this is, once per page version.
 *
 * Order: labels (explicit admin/author intent, free) → title patterns, but only for types that are
 * never flagged (meeting notes, decision records — a wrong guess there costs nothing) → Haiku.
 * Haiku's answer counts only at high confidence; everything else is `other`, which check 5 ignores.
 * Without an LLM the result is `undefined` (not cached), so the check stays silent rather than
 * freezing a non-answer into the cache.
 */
import type { PageType } from "../checks/types";
import { PAGE_TYPES } from "../checks/types";
import type { LlmClient } from "./client";

export type ClassifySource = "label" | "title" | "llm" | "short" | "none";

export interface Classification {
  /** `undefined` only when no classifier was available (no LLM and metadata said nothing). */
  type: PageType | undefined;
  source: ClassifySource;
  usage: { input: number; output: number };
  model?: string;
}

/** Pages shorter than this have too little structure to classify; they become `other` without an LLM call. */
export const MIN_CLASSIFY_CHARS = 200;
/** Classification needs the shape of the page, not all of it. ≈2k tokens. */
export const MAX_CLASSIFY_CHARS = 8_000;

export const CLASSIFY_TOOL = {
  name: "classify_page",
  description: "Record what kind of wiki page this is and how sure you are.",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...PAGE_TYPES],
        description:
          "runbook = operational procedure for running or recovering a system (alerts, symptoms, steps, escalation); " +
          "how-to = step-by-step instructions for a task; onboarding = material for new team members or new users; " +
          "decision = a decision record / ADR / RFC with a decision and its rationale; meeting-notes = notes or minutes of a specific meeting; " +
          "other = anything else (charters, overviews, specs, status pages, templates, indexes).",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "high only when the page's structure and content clearly match the type; use medium or low if it is a mix, a template, or a stub.",
      },
    },
    required: ["type", "confidence"],
  },
} as const;

const SYSTEM = `You classify internal wiki pages by type so a maintenance tool can apply the right freshness rule.
Rules:
- Judge by what the page IS, not by words it merely mentions. A page about a runbook is not a runbook.
- Templates, stubs, indexes, and pages that mix several kinds are "other".
- Use confidence "high" only when a reader would unambiguously call the page that type. When unsure, pick "other" or lower the confidence. There is no penalty for "other".`;

const LABEL_MAP: Array<[PageType, string[]]> = [
  ["runbook", ["runbook", "runbooks", "run-book", "playbook", "sop", "on-call", "oncall"]],
  ["how-to", ["how-to", "howto", "how-to-guide", "guide", "tutorial"]],
  ["onboarding", ["onboarding", "new-hire", "new-hires", "new-joiner", "new-joiners", "getting-started"]],
  ["decision", ["decision", "decisions", "decision-record", "adr", "daci", "rfc"]],
  ["meeting-notes", ["meeting-notes", "meetingnotes", "meeting", "meetings", "minutes", "retro", "retrospective", "standup", "stand-up"]],
];

const TITLE_PATTERNS: Array<[PageType, RegExp]> = [
  ["meeting-notes", /\bmeeting[- ]?notes?\b|\bminutes\b|\bretro(spective)?\b|\bstand-?up\b/i],
  ["decision", /^\s*ADR[-\s]?\d|\bDACI\b|\bdecision (record|log)\b/i],
];

/** Exactly one type suggested by the labels, else undefined (none, or conflicting labels). */
function typeFromLabels(labels: string[]): PageType | undefined {
  const norm = labels.map((l) => l.trim().toLowerCase().replace(/[\s_]+/g, "-"));
  const found = new Set<PageType>();
  for (const [type, names] of LABEL_MAP) if (names.some((n) => norm.includes(n))) found.add(type);
  return found.size === 1 ? [...found][0] : undefined;
}

function typeFromTitle(title: string): PageType | undefined {
  for (const [type, re] of TITLE_PATTERNS) if (re.test(title)) return type;
  return undefined;
}

/** Labels first; then title patterns for the never-flagged types. Conflicting labels → undefined. */
export function pageTypeFromMetadata(page: { title: string; labels: string[] }): PageType | undefined {
  return typeFromLabels(page.labels) ?? typeFromTitle(page.title);
}

export async function classifyPageType(
  llm: LlmClient | undefined,
  page: { id: string; title: string; text: string; labels: string[] },
): Promise<Classification> {
  const none = { input: 0, output: 0 };
  const fromLabels = typeFromLabels(page.labels);
  if (fromLabels) return { type: fromLabels, source: "label", usage: none };
  const fromTitle = typeFromTitle(page.title);
  if (fromTitle) return { type: fromTitle, source: "title", usage: none };
  if (page.text.trim().length < MIN_CLASSIFY_CHARS) return { type: "other", source: "short", usage: none };
  if (!llm) return { type: undefined, source: "none", usage: none };

  const body = page.text.length > MAX_CLASSIFY_CHARS ? page.text.slice(0, MAX_CLASSIFY_CHARS) + "\n[truncated]" : page.text;
  const res = await llm.callTool<{ type?: unknown; confidence?: unknown }>({
    tier: "fast",
    system: SYSTEM,
    user: `Page title: ${page.title}\n\nPage text:\n${body}`,
    tool: CLASSIFY_TOOL,
    maxOutputTokens: 64,
  });
  const type = isPageType(res.value?.type) && res.value?.confidence === "high" ? res.value.type : "other";
  return { type, source: "llm", usage: res.usage, model: res.model };
}

function isPageType(v: unknown): v is PageType {
  return typeof v === "string" && (PAGE_TYPES as readonly string[]).includes(v);
}
