/**
 * Check 6, step 1 — extract checkable facts from a page as (entity, attribute, value, quote).
 * Conservative by prompt: only facts stated as current truth, each with a verbatim quote.
 */
import type { LlmClient } from "./client";

export interface Fact {
  entity: string; // normalized, lower-case, e.g. "payments-service"
  attribute: string; // normalized, lower-case, e.g. "owner", "port", "url", "on-call channel"
  value: string; // as stated
  quote: string; // verbatim sentence or fragment from the page
  /** Jira issue keys written next to the claim (in the quote or right around it) — adjudication evidence (T16a). */
  issueKeys?: string[];
}

export const FACT_TOOL = {
  name: "record_facts",
  description: "Record facts the page states as currently true about named things (services, teams, systems, processes).",
  parameters: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entity: { type: "string", description: "Normalized name of the thing, lower-case, hyphenated" },
            attribute: { type: "string", description: "Normalized attribute, lower-case: owner, url, port, version, channel, schedule, step, contact, status" },
            value: { type: "string", description: "The value exactly as the page states it" },
            quote: { type: "string", description: "Verbatim text from the page that states this fact, max 200 chars" },
          },
          required: ["entity", "attribute", "value", "quote"],
        },
      },
    },
    required: ["facts"],
  },
} as const;

const SYSTEM = `You extract checkable facts from internal wiki pages so they can be compared across pages.
Rules:
- Only record facts the page asserts as CURRENTLY true about a NAMED thing (a service, team, system, environment, process, person-role).
- Skip opinions, history ("used to be"), plans ("will be"), examples, and anything hedged ("might", "usually").
- Normalize entity and attribute names so the same thing on two pages gets the same key (lower-case, hyphens, no articles).
- quote must be copied verbatim from the page text. If you cannot quote it, do not record it.
- Prefer fewer, precise facts over many vague ones. Zero facts is a valid answer.`;

export const MAX_PAGE_CHARS = 24_000; // ≈6k tokens per Haiku call; longer pages are chunked (T16a)
/** Haiku calls per page. Beyond this a page is a document dump, not a wiki page; the rest is skipped. */
export const MAX_CHUNKS_PER_PAGE = 4;
/** Pages shorter than this state nothing worth comparing; they get an empty fact list without a call. */
export const MIN_EXTRACT_CHARS = 200;
/** Hard cap per page: bounds storage and the number of keys looked up per scan. */
export const MAX_FACTS_PER_PAGE = 40;
/** Characters around a quote in which an issue key still counts as "next to the claim". */
export const ISSUE_KEY_WINDOW = 120;
const MAX_KEYS_PER_FACT = 3;

export async function extractFacts(llm: LlmClient, page: { id: string; title: string; text: string; issueKeys?: string[] }) {
  const chunks = chunkText(page.text, MAX_PAGE_CHARS);
  if (chunks.length > MAX_CHUNKS_PER_PAGE) console.warn(`extract facts ${page.id}: ${chunks.length} chunks, only the first ${MAX_CHUNKS_PER_PAGE} are read`);
  const parts = chunks.slice(0, MAX_CHUNKS_PER_PAGE);
  const usage = { input: 0, output: 0 };
  let model = "";
  const facts: Fact[] = [];
  const seen = new Set<string>();
  for (const [i, body] of parts.entries()) {
    if (facts.length >= MAX_FACTS_PER_PAGE) break; // the cap is reached; more calls would only be discarded
    const part = parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : "";
    const res = await llm.callTool<{ facts: Fact[] }>({
      tier: "fast",
      system: SYSTEM,
      user: `Page title: ${page.title}${part}\n\nPage text:\n${body}`,
      tool: FACT_TOOL,
    });
    usage.input += res.usage.input;
    usage.output += res.usage.output;
    model = res.model;
    for (const raw of Array.isArray(res.value?.facts) ? res.value.facts : []) {
      if (!isValidFact(raw)) continue;
      const f = normalize(raw);
      const key = `${f.entity}\u0000${f.attribute}\u0000${canonValue(f.value)}`;
      if (seen.has(key)) continue; // the same claim repeated across chunks (or within one) is one fact
      seen.add(key);
      const keys = issueKeysNear(body, f.quote, page.issueKeys ?? []);
      facts.push(keys.length ? { ...f, issueKeys: keys } : f);
    }
  }
  return { facts: facts.slice(0, MAX_FACTS_PER_PAGE), usage, model };
}

/**
 * Split page text into pieces of at most `max` chars, cutting between paragraphs (blank line, else
 * newline). A single paragraph longer than `max` is hard-split. Joining the pieces with "\n\n" gives
 * the text back when the cuts were at blank lines.
 */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current) out.push(current);
    current = "";
  };
  for (const para of text.split(/\n\n/)) {
    if (para.length > max) {
      push();
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      continue;
    }
    const joined = current ? `${current}\n\n${para}` : para;
    if (joined.length > max) {
      push();
      current = para;
    } else {
      current = joined;
    }
  }
  push();
  return out;
}

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g;

/**
 * Issue keys "next to" a claim: in the quote itself, or within `ISSUE_KEY_WINDOW` chars of where the
 * quote appears in the text. Only keys the page is known to reference (`known`, from the storage
 * parser — real-looking keys, later filtered by check 3's project list) count; "ISO-9001" never does.
 */
export function issueKeysNear(text: string, quote: string, known: string[]): string[] {
  if (known.length === 0 || !quote) return [];
  const wanted = new Set(known);
  const at = text.indexOf(quote);
  const window = at >= 0 ? text.slice(Math.max(0, at - ISSUE_KEY_WINDOW), at + quote.length + ISSUE_KEY_WINDOW) : quote;
  const found: string[] = [];
  for (const m of window.matchAll(ISSUE_KEY_RE)) {
    const key = `${m[1]}-${m[2]}`;
    if (wanted.has(key) && !found.includes(key)) found.push(key);
  }
  return found.slice(0, MAX_KEYS_PER_FACT);
}

function isValidFact(f: Partial<Fact>): f is Fact {
  return !!f.entity && !!f.attribute && !!f.value && !!f.quote && f.quote.length <= 300;
}

function normalize(f: Fact): Fact {
  const norm = (s: string) => s.trim().toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[\s_]+/g, "-");
  return { entity: norm(f.entity), attribute: norm(f.attribute), value: f.value.trim(), quote: f.quote.trim() };
}

/** Group facts by (entity, attribute); return keys where pages disagree on the value. */
export function findConflicts(
  facts: Array<Fact & { pageId: string }>,
): Array<{ entity: string; attribute: string; claims: Array<{ pageId: string; value: string; quote: string }> }> {
  const byKey = new Map<string, Array<Fact & { pageId: string }>>();
  for (const f of facts) {
    const k = `${f.entity}\u0000${f.attribute}`;
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  const out: ReturnType<typeof findConflicts> = [];
  for (const group of byKey.values()) {
    const values = new Set(group.map((g) => canonValue(g.value)));
    const pages = new Set(group.map((g) => g.pageId));
    if (values.size < 2 || pages.size < 2) continue;
    out.push({
      entity: group[0].entity,
      attribute: group[0].attribute,
      claims: group.map((g) => ({ pageId: g.pageId, value: g.value, quote: g.quote })),
    });
  }
  return out;
}

/** Value comparison form: two claims with the same canonical value agree. */
export function canonValue(v: string): string {
  return v.trim().toLowerCase().replace(/[\s.,;:]+$/g, "").replace(/\s+/g, " ");
}
