import { describe, expect, it, vi } from "vitest";
import type { Finding, PageRecord } from "../src/checks/types";
import { MAX_CONFLICTS_PER_PAGE, contradictionFindings } from "../src/checks/contradiction";
import { MemoryRepo } from "../src/db/repo";
import { ADJUDICATE_TOOL, adjudicateConflict, type Conflict, type Verdict } from "../src/llm/adjudicate";
import type { LlmClient } from "../src/llm/client";
import { FACT_TOOL, MAX_FACTS_PER_PAGE, MIN_EXTRACT_CHARS, type Fact } from "../src/llm/extractFacts";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_CONTRADICTION_ONBOARDING, STORAGE_CONTRADICTION_RUNBOOK } from "./fixtures/pages";

const NOW = "2026-11-15T00:00:00Z";
const world = fakeClients({ now: NOW });

const RUNBOOK = { id: "10", title: "Payments service runbook", lastModified: "2026-11-10T00:00:00Z" };
const ONBOARDING = { id: "11", title: "Payments team onboarding", lastModified: "2026-06-01T00:00:00Z" };

/** Facts Haiku would extract from the two fixture pages (scripted: the LLM is faked in tests). */
const RUNBOOK_FACTS: Fact[] = [
  { entity: "payments-service", attribute: "owner", value: "platform team", quote: "Owner: platform team." },
  { entity: "payments-service", attribute: "region", value: "eu-west-1", quote: "Region: eu-west-1." },
  { entity: "payments-service", attribute: "on-call-channel", value: "#payments-oncall", quote: "On-call channel: #payments-oncall." },
  { entity: "payments-service", attribute: "database-port", value: "5433", quote: "The database listens on port 5433 since the Postgres upgrade." },
];
const ONBOARDING_FACTS: Fact[] = [
  { entity: "payments-service", attribute: "owner", value: "Platform team", quote: "owned by the platform team" },
  { entity: "payments-service", attribute: "region", value: "eu-west-1", quote: "runs in eu-west-1" },
  { entity: "payments-service", attribute: "on-call-channel", value: "#payments-alerts", quote: "post in #payments-alerts" },
  { entity: "payments-service", attribute: "database-port", value: "5432", quote: "The database is reachable on port 5432." },
];

const stored = (page: typeof RUNBOOK, facts: Fact[]) =>
  facts.map((f) => ({ ...f, pageId: page.id, pageTitle: page.title, pageLastModified: page.lastModified }));

/** LLM fake answering by tool name; records every call. */
function fakeLlm(answers: Record<string, unknown | ((user: string) => unknown)>, usage = { input: 700, output: 60 }) {
  const calls: Array<{ tier: string; toolName: string; user: string; system: string }> = [];
  const llm: LlmClient = {
    async callTool<T>(args: { tier: string; user: string; system: string; tool: { name: string } }) {
      calls.push({ tier: args.tier, toolName: args.tool.name, user: args.user, system: args.system });
      const a = answers[args.tool.name];
      if (a === undefined) throw new Error(`no scripted answer for ${args.tool.name}`);
      return { value: (typeof a === "function" ? a(args.user) : a) as T, usage, model: args.tier === "smart" ? "claude-sonnet-4-5" : "claude-haiku-4-5" };
    },
  };
  return { llm, calls };
}

const conflict: Conflict = {
  entity: "payments-service",
  attribute: "on-call-channel",
  claims: [
    { ...RUNBOOK_FACTS[2], pageId: RUNBOOK.id, pageTitle: RUNBOOK.title, pageLastModified: RUNBOOK.lastModified },
    { ...ONBOARDING_FACTS[2], pageId: ONBOARDING.id, pageTitle: ONBOARDING.title, pageLastModified: ONBOARDING.lastModified },
  ],
};

describe("adjudicateConflict (Sonnet)", () => {
  it("asks the smart tier with every claim, its page and date, and returns the verdict", async () => {
    const f = fakeLlm({ judge_conflict: { outdated_page_id: "11", confidence: "high", reason: "The runbook is newer and explains the change." } });
    const v = await adjudicateConflict(f.llm, conflict);
    expect(v).toMatchObject({ outdatedPageId: "11", confidence: "high", usage: { input: 700, output: 60 }, model: "claude-sonnet-4-5" });
    expect(v.reason).toContain("newer");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ tier: "smart", toolName: ADJUDICATE_TOOL.name });
    for (const c of conflict.claims) {
      expect(f.calls[0].user).toContain(c.pageTitle);
      expect(f.calls[0].user).toContain(c.pageId);
      expect(f.calls[0].user).toContain(c.quote);
      expect(f.calls[0].user).toContain(c.pageLastModified.slice(0, 10));
    }
  });

  it("treats an unknown page id, 'unknown', or a missing verdict as no verdict", async () => {
    for (const answer of [
      { outdated_page_id: "99", confidence: "high", reason: "x" },
      { outdated_page_id: "unknown", confidence: "high", reason: "x" },
      { confidence: "high", reason: "x" },
      {},
    ]) {
      const f = fakeLlm({ judge_conflict: answer });
      const v = await adjudicateConflict(f.llm, conflict);
      expect(v.outdatedPageId).toBeUndefined();
    }
  });

  it("maps an unknown confidence to low", async () => {
    const f = fakeLlm({ judge_conflict: { outdated_page_id: "11", confidence: "certain", reason: "x" } });
    expect((await adjudicateConflict(f.llm, conflict)).confidence).toBe("low");
  });
});

describe("check 6 — contradictionFindings", () => {
  const verdictFor =
    (byAttribute: Record<string, Partial<Verdict>>) =>
    async (c: Conflict): Promise<Verdict> => ({
      confidence: "low",
      reason: "",
      usage: { input: 500, output: 40 },
      model: "fake",
      ...byAttribute[c.attribute],
    });

  it("reports the planted faults on the page Sonnet judges outdated (even when it is the other page)", async () => {
    const calls: Conflict[] = [];
    const adjudicate = async (c: Conflict) => {
      calls.push(c);
      return verdictFor({
        "on-call-channel": { outdatedPageId: ONBOARDING.id, confidence: "high", reason: "The runbook is newer." },
        "database-port": { outdatedPageId: ONBOARDING.id, confidence: "high", reason: "The runbook mentions the upgrade." },
      })(c);
    };
    const r = await contradictionFindings({ page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: stored(ONBOARDING, ONBOARDING_FACTS), adjudicate });
    // owner and region agree → never adjudicated (planted non-faults)
    expect(calls.map((c) => c.attribute).sort()).toEqual(["database-port", "on-call-channel"]);
    expect(r.conflicts).toBe(2);
    expect(r.usage).toEqual({ input: 1000, output: 80 });
    expect(r.findings).toHaveLength(2);
    for (const f of r.findings) {
      expect(f).toMatchObject({ pageId: ONBOARDING.id, check: "CONTRADICTION", severity: "medium" });
      expect(f.evidence).toContain(RUNBOOK.title);
    }
    const channel = r.findings.find((f) => f.evidence.includes("on-call-channel"))!;
    expect(channel.evidence).toContain("#payments-alerts");
    expect(channel.evidence).toContain("#payments-oncall");
    expect(channel.evidence).toContain("post in #payments-alerts");
    expect(channel.evidence).toContain("2026-11-10");
    expect(channel.evidence).toContain("The runbook is newer.");
    expect(channel.suggestion).toContain("#payments-oncall");
    expect(channel.suggestion).toContain(RUNBOOK.title);
  });

  it("reports on the scanned page itself when it is the outdated one", async () => {
    const r = await contradictionFindings({
      page: ONBOARDING,
      pageFacts: ONBOARDING_FACTS,
      otherFacts: stored(RUNBOOK, RUNBOOK_FACTS),
      adjudicate: verdictFor({ "on-call-channel": { outdatedPageId: ONBOARDING.id, confidence: "high", reason: "r" } }),
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].pageId).toBe(ONBOARDING.id);
    expect(r.findings[0].evidence).toContain("this page");
  });

  it("is silent below high confidence, without a verdict, and when facts agree", async () => {
    const other = stored(ONBOARDING, ONBOARDING_FACTS);
    const medium = await contradictionFindings({ page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: other, adjudicate: verdictFor({ "on-call-channel": { outdatedPageId: "11", confidence: "medium" } }) });
    expect(medium.findings).toEqual([]);
    const none = await contradictionFindings({ page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: other, adjudicate: verdictFor({}) });
    expect(none.findings).toEqual([]);
    const agree = await contradictionFindings({ page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: stored(ONBOARDING, RUNBOOK_FACTS), adjudicate: async () => { throw new Error("must not be called"); } });
    expect(agree.findings).toEqual([]);
    expect(agree.conflicts).toBe(0);
  });

  it("ignores conflicts that do not involve the scanned page and caps adjudications", async () => {
    const third = { id: "12", title: "Old notes", lastModified: "2025-01-01T00:00:00Z" };
    const calls: Conflict[] = [];
    const adjudicate = async (c: Conflict) => { calls.push(c); return verdictFor({})(c); };
    // The scanned page has no fact about the port; the other two disagree about it → not this page's business.
    const pageFacts = RUNBOOK_FACTS.filter((f) => f.attribute !== "database-port");
    await contradictionFindings({ page: RUNBOOK, pageFacts, otherFacts: [...stored(ONBOARDING, ONBOARDING_FACTS), ...stored(third, [{ ...ONBOARDING_FACTS[3], value: "5434" }])], adjudicate });
    expect(calls.map((c) => c.attribute)).toEqual(["on-call-channel"]);

    calls.length = 0;
    const many = Array.from({ length: MAX_CONFLICTS_PER_PAGE + 5 }, (_, i) => ({ entity: `svc-${i}`, attribute: "port", value: String(i), quote: `port ${i}` }));
    await contradictionFindings({ page: RUNBOOK, pageFacts: many, otherFacts: stored(ONBOARDING, many.map((f) => ({ ...f, value: "x" }))), adjudicate });
    expect(calls).toHaveLength(MAX_CONFLICTS_PER_PAGE);
  });

  it("keeps scanning when adjudication throws for one conflict", async () => {
    const adjudicate = async (c: Conflict): Promise<Verdict> => {
      if (c.attribute === "database-port") throw new Error("llm down");
      return { outdatedPageId: ONBOARDING.id, confidence: "high", reason: "r", usage: { input: 1, output: 1 }, model: "f" };
    };
    const r = await contradictionFindings({ page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: stored(ONBOARDING, ONBOARDING_FACTS), adjudicate });
    expect(r.findings).toHaveLength(1);
  });
});

describe("MemoryRepo — facts and cross-page findings", () => {
  const base = { spaceId: "100", version: 1, lastModified: "2026-01-01", scannedAt: "2026-01-02" };

  it("stores facts per page and returns them by (entity, attribute) key with page context", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "10", title: RUNBOOK.title, ...base, lastModified: RUNBOOK.lastModified });
    await repo.upsertPage({ pageId: "11", title: ONBOARDING.title, ...base, lastModified: ONBOARDING.lastModified });
    await repo.upsertPage({ pageId: "20", title: "Elsewhere", ...base, spaceId: "200" });
    await repo.replaceFacts("10", RUNBOOK_FACTS);
    await repo.replaceFacts("11", ONBOARDING_FACTS);
    await repo.replaceFacts("20", ONBOARDING_FACTS); // other space → never returned
    const rows = await repo.factsForKeys("100", [{ entity: "payments-service", attribute: "on-call-channel" }]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.pageId === "11")).toMatchObject({ pageTitle: ONBOARDING.title, pageLastModified: ONBOARDING.lastModified, value: "#payments-alerts" });
    expect(await repo.factsForKeys("100", [])).toEqual([]);
    await repo.replaceFacts("11", []);
    expect(await repo.factsForKeys("100", [{ entity: "payments-service", attribute: "on-call-channel" }])).toHaveLength(1);
  });

  it("replaceFindings replaces everything the scanned page produced, including findings on other pages", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "10", title: "a", ...base });
    await repo.upsertPage({ pageId: "11", title: "b", ...base });
    const local = (pageId: string, evidence: string): Finding => ({ pageId, check: "PLACEHOLDER", severity: "low", evidence, suggestion: "s" });
    const cross = (pageId: string, evidence: string): Finding => ({ pageId, check: "CONTRADICTION", severity: "medium", evidence, suggestion: "s" });

    await repo.replaceFindings("11", [local("11", "b-own")]);
    await repo.replaceFindings("10", [local("10", "a-own"), cross("11", "b-from-a")]);
    expect(repo.findings.get("11")?.map((f) => f.evidence).sort()).toEqual(["b-from-a", "b-own"]);

    // Page 10 rescanned, conflict gone → the finding it produced on 11 disappears; 11's own stays.
    await repo.replaceFindings("10", [local("10", "a-own")]);
    expect(repo.findings.get("11")?.map((f) => f.evidence)).toEqual(["b-own"]);

    // Both pages produce the same finding on 11 → stored once.
    await repo.replaceFindings("10", [cross("11", "same")]);
    await repo.replaceFindings("11", [cross("11", "same")]);
    expect(repo.findings.get("11")?.map((f) => f.evidence)).toEqual(["same"]);
    const top = await repo.openFindings("100", 10);
    expect(top.map((r) => r.page.pageId)).toEqual(["11"]);
  });

  it("remembers which version facts were extracted for", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "10", title: "a", ...base, version: 3, factsVersion: 3 });
    expect((await repo.getPage("10"))?.factsVersion).toBe(3);
  });
});

// The worker imports the Forge page fetcher directly; replace it with an in-memory map.
const fetched = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/forge/confluencePages", () => ({
  fetchPage: async (id: string) => {
    const p = fetched.get(id);
    if (!p) throw new Error("no page");
    return p;
  },
}));

function record(meta: typeof RUNBOOK, storage: string, labels: string[]): PageRecord {
  return { ...meta, spaceId: "100", version: 1, labels, ...parseStorage(storage) };
}

describe("scanBatch wiring — check 6", () => {
  const answers = {
    classify_page: { type: "other", confidence: "high" },
    record_facts: (user: string) => ({ facts: user.includes(`Page title: ${RUNBOOK.title}`) ? RUNBOOK_FACTS : ONBOARDING_FACTS }),
    judge_conflict: (user: string) => ({ outdated_page_id: ONBOARDING.id, confidence: "high", reason: user.includes("port") ? "Upgrade noted on the runbook." : "The runbook is newer." }),
  };

  it("extracts facts once per version, finds the planted contradictions and puts them on the outdated page", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set(ONBOARDING.id, record(ONBOARDING, STORAGE_CONTRADICTION_ONBOARDING, ["onboarding"]));
    fetched.set(RUNBOOK.id, record(RUNBOOK, STORAGE_CONTRADICTION_RUNBOOK, ["runbook"]));
    const f = fakeLlm(answers);

    // Night 1: only the onboarding page exists → facts stored, nothing to compare against.
    await scanBatch({ runId: "r1", spaceId: "100", pageIds: [ONBOARDING.id] }, repo, world, { llm: f.llm });
    expect(f.calls.map((c) => c.toolName)).toEqual([FACT_TOOL.name]);
    expect((await repo.getPage(ONBOARDING.id))?.factsVersion).toBe(1);
    expect(repo.findings.get(ONBOARDING.id)?.filter((x) => x.check === "CONTRADICTION") ?? []).toEqual([]);

    // Night 2: the runbook is new → its facts conflict with the stored onboarding facts.
    await scanBatch({ runId: "r2", spaceId: "100", pageIds: [RUNBOOK.id] }, repo, world, { llm: f.llm });
    expect(f.calls.filter((c) => c.toolName === ADJUDICATE_TOOL.name)).toHaveLength(2);
    expect(f.calls.filter((c) => c.toolName === ADJUDICATE_TOOL.name).every((c) => c.tier === "smart")).toBe(true);
    const onOnboarding = repo.findings.get(ONBOARDING.id)?.filter((x) => x.check === "CONTRADICTION") ?? [];
    expect(onOnboarding).toHaveLength(2);
    expect(repo.findings.get(RUNBOOK.id)?.filter((x) => x.check === "CONTRADICTION") ?? []).toEqual([]);

    // Replay of the same event (double-fired trigger): facts cached, conflicts re-adjudicated, nothing duplicated.
    const before = f.calls.length;
    await scanBatch({ runId: "r2", spaceId: "100", pageIds: [RUNBOOK.id] }, repo, world, { llm: f.llm });
    expect(f.calls.slice(before).map((c) => c.toolName)).toEqual([ADJUDICATE_TOOL.name, ADJUDICATE_TOOL.name]);
    expect(repo.findings.get(ONBOARDING.id)?.filter((x) => x.check === "CONTRADICTION")).toHaveLength(2);

    // The onboarding page is fixed (new version, now agrees) → its rescan clears the findings.
    fetched.set(ONBOARDING.id, { ...record(ONBOARDING, STORAGE_CONTRADICTION_ONBOARDING, ["onboarding"]), version: 2 });
    const fixed = fakeLlm({ ...answers, record_facts: { facts: RUNBOOK_FACTS } });
    await scanBatch({ runId: "r3", spaceId: "100", pageIds: [ONBOARDING.id] }, repo, world, { llm: fixed.llm });
    expect(fixed.calls.map((c) => c.toolName)).toEqual([FACT_TOOL.name]);
    expect(repo.findings.get(ONBOARDING.id)?.filter((x) => x.check === "CONTRADICTION") ?? []).toEqual([]);
    expect((await repo.getPage(ONBOARDING.id))?.factsVersion).toBe(2);
  });

  it("skips extraction without an LLM or for very short pages, and survives an extraction failure", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set(RUNBOOK.id, record(RUNBOOK, STORAGE_CONTRADICTION_RUNBOOK, ["runbook"]));
    fetched.set("13", { ...record({ id: "13", title: "Stub", lastModified: NOW }, "<p>Short.</p>", ["runbook"]) });

    await scanBatch({ runId: "r", spaceId: "100", pageIds: [RUNBOOK.id] }, repo, world, {});
    expect((await repo.getPage(RUNBOOK.id))?.factsVersion).toBeUndefined();

    const f = fakeLlm(answers);
    await scanBatch({ runId: "r", spaceId: "100", pageIds: ["13"] }, repo, world, { llm: f.llm });
    expect(f.calls).toEqual([]);
    expect("Short.".length).toBeLessThan(MIN_EXTRACT_CHARS);
    expect((await repo.getPage("13"))?.factsVersion).toBe(1); // nothing to extract is a cached answer

    const broken = fakeLlm({ ...answers, record_facts: () => { throw new Error("llm down"); } });
    const scanned = await scanBatch({ runId: "r", spaceId: "100", pageIds: [RUNBOOK.id] }, repo, world, { llm: broken.llm });
    expect(scanned).toBe(1);
    expect((await repo.getPage(RUNBOOK.id))?.factsVersion).toBeUndefined(); // retried next time
    expect((await repo.getPage(RUNBOOK.id))?.pageType).toBe("runbook"); // the rest of the scan still ran
  });

  it("caps the number of facts stored per page", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set(RUNBOOK.id, record(RUNBOOK, STORAGE_CONTRADICTION_RUNBOOK, ["runbook"]));
    const many = Array.from({ length: MAX_FACTS_PER_PAGE + 10 }, (_, i) => ({ entity: `e${i}`, attribute: "a", value: "v", quote: "q" }));
    const f = fakeLlm({ ...answers, record_facts: { facts: many } });
    await scanBatch({ runId: "r", spaceId: "100", pageIds: [RUNBOOK.id] }, repo, world, { llm: f.llm });
    expect(repo.facts.get(RUNBOOK.id)).toHaveLength(MAX_FACTS_PER_PAGE);
  });
});
