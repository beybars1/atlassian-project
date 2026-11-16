import { describe, expect, it, vi } from "vitest";
import type { PageRecord, PageType } from "../src/checks/types";
import { DEFAULT_STALE_DAYS, makeStaleByType, parseStaleThresholds, staleByType } from "../src/checks/staleByType";
import { CLASSIFY_TOOL, MIN_CLASSIFY_CHARS, classifyPageType, pageTypeFromMetadata } from "../src/llm/classifyPage";
import type { LlmClient } from "../src/llm/client";
import { MemoryRepo } from "../src/db/repo";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_CLEAN, STORAGE_RUNBOOK_LOCAL_REFS_CLEAN, STORAGE_STALE_RUNBOOK } from "./fixtures/pages";

const NOW = "2026-11-14T00:00:00Z";
const world = fakeClients({ now: NOW });

function page(extra: Partial<PageRecord> = {}): PageRecord {
  const parsed = parseStorage(STORAGE_STALE_RUNBOOK);
  return {
    id: "1",
    spaceId: "100",
    title: "Payments service runbook",
    version: 3,
    lastModified: "2026-01-01T00:00:00Z", // 317 days before NOW
    labels: [],
    ...parsed,
    ...extra,
  };
}

/**
 * LLM fake that answers the classify tool with a scripted result and counts calls. The worker also
 * asks for facts (check 6, T16); those calls get an empty fact list and are excluded from `calls`.
 */
function fakeLlm(answer: { type: string; confidence: string }, usage = { input: 900, output: 20 }) {
  const calls: Array<{ tier: string; user: string; toolName: string }> = [];
  const llm: LlmClient = {
    async callTool<T>(args: { tier: string; user: string; tool: { name: string } }) {
      if (args.tool.name !== CLASSIFY_TOOL.name) return { value: { facts: [] } as unknown as T, usage: { input: 0, output: 0 }, model: "claude-haiku-4-5" };
      calls.push({ tier: args.tier, user: args.user, toolName: args.tool.name });
      return { value: answer as unknown as T, usage, model: "claude-haiku-4-5" };
    },
  };
  return { llm, calls };
}

describe("check 5 — staleByType", () => {
  it("flags a runbook older than its threshold (planted fault)", async () => {
    const findings = await staleByType(page({ pageType: "runbook" }), world);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ pageId: "1", check: "STALE_BY_TYPE", severity: "medium" });
    expect(findings[0].evidence).toContain("runbook");
    expect(findings[0].evidence).toContain("317 days");
    expect(findings[0].evidence).toContain("180 days");
  });

  it("raises severity to high at twice the threshold", async () => {
    const findings = await staleByType(page({ pageType: "runbook", lastModified: "2025-10-01T00:00:00Z" }), world);
    expect(findings[0].severity).toBe("high");
  });

  it("is silent for a page that was edited within the threshold", async () => {
    expect(await staleByType(page({ pageType: "runbook", lastModified: "2026-08-01T00:00:00Z" }), world)).toEqual([]);
  });

  it("is silent when the page type is unknown or has no threshold", async () => {
    expect(await staleByType(page({ pageType: undefined }), world)).toEqual([]);
    expect(await staleByType(page({ pageType: "other" }), world)).toEqual([]);
    expect(await staleByType(page({ pageType: "decision" }), world)).toEqual([]);
    expect(await staleByType(page({ pageType: "meeting-notes" }), world)).toEqual([]);
  });

  it("is silent on an unparseable or future last-modified date", async () => {
    expect(await staleByType(page({ pageType: "runbook", lastModified: "not a date" }), world)).toEqual([]);
    expect(await staleByType(page({ pageType: "runbook", lastModified: "2027-01-01T00:00:00Z" }), world)).toEqual([]);
  });

  it("honours admin thresholds, including switching a type off", async () => {
    const strict = makeStaleByType({ ...DEFAULT_STALE_DAYS, "how-to": 30, runbook: null });
    expect(await strict(page({ pageType: "runbook" }), world)).toEqual([]);
    const howTo = await strict(page({ pageType: "how-to", lastModified: "2026-10-01T00:00:00Z" }), world);
    expect(howTo).toHaveLength(1);
    expect(howTo[0].evidence).toContain("30 days");
  });
});

describe("parseStaleThresholds", () => {
  it("returns the defaults for nothing", () => {
    expect(parseStaleThresholds(undefined)).toEqual(DEFAULT_STALE_DAYS);
    expect(parseStaleThresholds("garbage")).toEqual(DEFAULT_STALE_DAYS);
  });

  it("merges valid overrides and ignores invalid ones", () => {
    const t = parseStaleThresholds({ runbook: 90, "how-to": "200", onboarding: null, decision: 400, other: 10, bogus: 5, "meeting-notes": -3 });
    expect(t.runbook).toBe(90);
    expect(t["how-to"]).toBe(200); // numeric string from a form field
    expect(t.onboarding).toBeNull(); // explicitly off
    expect(t.decision).toBe(400); // admin may switch a default-off type on
    expect(t.other).toBeNull(); // "other" can never be flagged
    expect(t["meeting-notes"]).toBeNull(); // negative → default (off)
    expect((t as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("treats zero and absurd values as invalid", () => {
    const t = parseStaleThresholds({ runbook: 0, "how-to": 100000 });
    expect(t.runbook).toBe(DEFAULT_STALE_DAYS.runbook);
    expect(t["how-to"]).toBe(DEFAULT_STALE_DAYS["how-to"]);
  });
});

describe("pageTypeFromMetadata", () => {
  it("trusts labels first", () => {
    expect(pageTypeFromMetadata({ title: "Weekly sync", labels: ["runbook"] })).toBe("runbook");
    expect(pageTypeFromMetadata({ title: "x", labels: ["team", "How-To"] })).toBe("how-to");
    expect(pageTypeFromMetadata({ title: "x", labels: ["new-hire"] })).toBe("onboarding");
    expect(pageTypeFromMetadata({ title: "x", labels: ["adr"] })).toBe("decision");
    expect(pageTypeFromMetadata({ title: "x", labels: ["meeting-notes"] })).toBe("meeting-notes");
  });

  it("recognises meeting notes and decision records by title only for types that are never flagged", () => {
    expect(pageTypeFromMetadata({ title: "2026-11-13 Meeting notes", labels: [] })).toBe("meeting-notes");
    expect(pageTypeFromMetadata({ title: "Sprint 42 retrospective", labels: [] })).toBe("meeting-notes");
    expect(pageTypeFromMetadata({ title: "ADR-012 Use Forge SQL", labels: [] })).toBe("decision");
    // A runbook-looking title alone is not enough: the LLM decides.
    expect(pageTypeFromMetadata({ title: "Payments runbook", labels: [] })).toBeUndefined();
  });

  it("returns nothing on conflicting labels", () => {
    expect(pageTypeFromMetadata({ title: "x", labels: ["runbook", "meeting-notes"] })).toBeUndefined();
  });
});

describe("classifyPageType", () => {
  const body = page();

  it("uses the LLM when metadata says nothing, and accepts only high confidence", async () => {
    const hi = fakeLlm({ type: "runbook", confidence: "high" });
    const r = await classifyPageType(hi.llm, body);
    expect(r).toMatchObject({ type: "runbook", source: "llm", usage: { input: 900, output: 20 } });
    expect(hi.calls).toHaveLength(1);
    expect(hi.calls[0]).toMatchObject({ tier: "fast", toolName: CLASSIFY_TOOL.name });
    expect(hi.calls[0].user).toContain("Payments service runbook");

    const med = fakeLlm({ type: "runbook", confidence: "medium" });
    expect((await classifyPageType(med.llm, body)).type).toBe("other");
  });

  it("maps unknown types to other", async () => {
    const weird = fakeLlm({ type: "manifesto", confidence: "high" });
    expect((await classifyPageType(weird.llm, body)).type).toBe("other");
  });

  it("does not call the LLM when labels decide", async () => {
    const f = fakeLlm({ type: "other", confidence: "high" });
    const r = await classifyPageType(f.llm, { ...body, labels: ["runbook"] });
    expect(r).toMatchObject({ type: "runbook", source: "label", usage: { input: 0, output: 0 } });
    expect(f.calls).toHaveLength(0);
  });

  it("does not call the LLM for very short pages", async () => {
    const f = fakeLlm({ type: "runbook", confidence: "high" });
    const r = await classifyPageType(f.llm, { ...body, text: "Short." });
    expect(r).toMatchObject({ type: "other", source: "short" });
    expect(f.calls).toHaveLength(0);
    expect("Short.".length).toBeLessThan(MIN_CLASSIFY_CHARS);
  });

  it("returns no type without an LLM, so nothing is cached or flagged", async () => {
    const r = await classifyPageType(undefined, body);
    expect(r.type).toBeUndefined();
    expect(r.source).toBe("none");
  });

  it("truncates long pages in the prompt", async () => {
    const f = fakeLlm({ type: "how-to", confidence: "high" });
    await classifyPageType(f.llm, { ...body, text: "word ".repeat(10_000) });
    expect(f.calls[0].user.length).toBeLessThan(10_000);
  });
});

describe("MemoryRepo page type cache", () => {
  it("stores and returns the page type with its version", async () => {
    const repo = new MemoryRepo();
    const base = { spaceId: "s", title: "t", lastModified: "2026-01-01", scannedAt: "2026-01-02" };
    await repo.upsertPage({ pageId: "1", version: 3, pageType: "runbook", ...base });
    expect(await repo.getPage("1")).toMatchObject({ version: 3, pageType: "runbook" });
    expect(await repo.getPage("missing")).toBeUndefined();
  });
});

// The worker imports the Forge page fetcher directly; replace it with an in-memory map so the
// whole worker (classification → cache → checks → repo) runs without the Forge runtime.
const fetched = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/forge/confluencePages", () => ({
  fetchPage: async (id: string) => {
    const p = fetched.get(id);
    if (!p) throw new Error("no page");
    return p;
  },
}));

describe("scanBatch wiring", () => {
  it("classifies once per page version, caches the type and reports stale pages", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("1", page({ id: "1" })); // stale runbook, no labels → LLM
    fetched.set("2", { ...page({ id: "2", title: "Team charter", lastModified: "2026-11-01T00:00:00Z" }), ...parseStorage(STORAGE_CLEAN), labels: [] });
    const f = fakeLlm({ type: "runbook", confidence: "high" });
    const event = { runId: "r", spaceId: "100", pageIds: ["1", "2"] };
    await repo.startRun({ id: "r:100", spaceId: "100", startedAt: NOW, pagesSeen: 2, pagesScanned: 0 });

    await scanBatch(event, repo, world, { llm: f.llm });
    expect(f.calls.map((c) => c.user.includes("Payments service runbook"))).toEqual([true]); // page 2 is too short for the LLM
    expect((await repo.getPage("1"))?.pageType).toBe("runbook");
    expect((await repo.getPage("2"))?.pageType).toBe("other");
    expect(repo.findings.get("1")?.map((x) => x.check)).toContain("STALE_BY_TYPE");
    expect(repo.findings.get("2")?.map((x) => x.check) ?? []).not.toContain("STALE_BY_TYPE");

    // Same version again (e.g. a double-fired trigger): cached, no second LLM call.
    await scanBatch(event, repo, world, { llm: f.llm });
    expect(f.calls).toHaveLength(1);

    // New version → reclassified.
    fetched.set("1", page({ id: "1", version: 4 }));
    await scanBatch(event, repo, world, { llm: f.llm });
    expect(f.calls).toHaveLength(2);
    expect((await repo.getPage("1"))?.version).toBe(4);
  });

  it("keeps scanning when classification fails and leaves the type unknown", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("1", page({ id: "1" }));
    const llm: LlmClient = { async callTool() { throw new Error("llm down"); } };
    const scanned = await scanBatch({ runId: "r", spaceId: "100", pageIds: ["1"] }, repo, world, { llm });
    expect(scanned).toBe(1);
    expect((await repo.getPage("1"))?.pageType).toBeUndefined();
    expect(repo.findings.get("1")?.map((x) => x.check) ?? []).not.toContain("STALE_BY_TYPE");
  });

  it("the clean fixtures are not flagged as stale when typed as something with no threshold", async () => {
    const types: PageType[] = ["decision", "meeting-notes", "other"];
    for (const t of types) {
      const p = { ...page({ pageType: t }), ...parseStorage(STORAGE_RUNBOOK_LOCAL_REFS_CLEAN) };
      expect(await staleByType(p, world)).toEqual([]);
    }
  });
});
