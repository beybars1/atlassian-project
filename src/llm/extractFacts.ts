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

export const MAX_PAGE_CHARS = 24_000; // ≈6k tokens; longer pages are truncated for v0 (chunking is T16 follow-up)

export async function extractFacts(llm: LlmClient, page: { id: string; title: string; text: string }) {
  const body = page.text.length > MAX_PAGE_CHARS ? page.text.slice(0, MAX_PAGE_CHARS) + "\n[truncated]" : page.text;
  const res = await llm.callTool<{ facts: Fact[] }>({
    tier: "fast",
    system: SYSTEM,
    user: `Page title: ${page.title}\n\nPage text:\n${body}`,
    tool: FACT_TOOL,
  });
  const facts = (res.value.facts ?? []).filter(isValidFact).map(normalize);
  return { facts, usage: res.usage, model: res.model };
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
    const values = new Set(group.map((g) => canon(g.value)));
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

function canon(v: string): string {
  return v.trim().toLowerCase().replace(/[\s.,;:]+$/g, "").replace(/\s+/g, " ");
}
