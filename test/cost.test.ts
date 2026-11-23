import { describe, expect, it, vi } from "vitest";
import { MemoryRepo, type ScanRun } from "../src/db/repo";
import type { LlmClient } from "../src/llm/client";
import { addUsage, COST_ALERT, costAlert, emptyUsage, projectedCostUsd, usageCostUsd, type LlmUsage } from "../src/llm/cost";
import { costRows, formatUsd } from "../src/ui/costReport";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_CONTRADICTION_ONBOARDING, STORAGE_CONTRADICTION_RUNBOOK, STORAGE_STALE_RUNBOOK } from "./fixtures/pages";

const NOW = "2026-11-17T02:00:00Z";
const usage = (fast: [number, number], smart: [number, number] = [0, 0]): LlmUsage => ({
  fast: { input: fast[0], output: fast[1] },
  smart: { input: smart[0], output: smart[1] },
});

describe("cost arithmetic", () => {
  it("prices each tier at its own list price", () => {
    // Haiku: $1 in / $5 out per 1M; Sonnet: $3 in / $15 out per 1M.
    expect(usageCostUsd(usage([1_000_000, 0]))).toBe(1);
    expect(usageCostUsd(usage([0, 1_000_000]))).toBe(5);
    expect(usageCostUsd(usage([0, 0], [1_000_000, 0]))).toBe(3);
    expect(usageCostUsd(usage([0, 0], [0, 1_000_000]))).toBe(15);
    expect(usageCostUsd(emptyUsage())).toBe(0);
  });

  it("accumulates per tier and never shares objects between runs", () => {
    const a = emptyUsage();
    addUsage(a, "fast", { input: 100, output: 10 });
    addUsage(a, "smart", { input: 7, output: 3 });
    addUsage(a, "fast", { input: 1, output: 1 });
    expect(a).toEqual(usage([101, 11], [7, 3]));
    expect(emptyUsage()).toEqual(usage([0, 0]));
  });

  it("projects the cost of a full scan from the pages actually scanned", () => {
    // 100 pages cost $0.50 → 2,000 pages ≈ $10.
    const u = usage([400_000, 20_000]); // $0.40 + $0.10
    expect(projectedCostUsd(u, 100)).toBeCloseTo(10, 6);
    expect(projectedCostUsd(u, 100, 1000)).toBeCloseTo(5, 6);
    // No pages scanned → nothing to project from.
    expect(projectedCostUsd(u, 0)).toBeUndefined();
  });

  it("alerts only when a run actually exceeded the budget", () => {
    const cheap: ScanRun = { id: "2026-11-17:100", spaceId: "100", startedAt: NOW, pagesSeen: 2000, pagesScanned: 2000, usage: usage([3_000_000, 300_000], [100_000, 20_000]) };
    expect(usageCostUsd(cheap.usage)).toBeCloseTo(4.5 + 0.6, 6); // PLAN §5 estimate: under $10
    expect(costAlert(cheap)).toBeUndefined();

    const pricey: ScanRun = { ...cheap, usage: usage([8_000_000, 800_000], [200_000, 50_000]) };
    const msg = costAlert(pricey);
    expect(msg).toContain("2026-11-17:100");
    expect(msg).toContain(`$${COST_ALERT.usd}`);
    expect(msg).toMatch(/\$13\.35/); // 8 + 4 + 0.6 + 0.75

    // A small run that is expensive per page is reported, not alerted: the projection is for the dashboard.
    const smallButSteep: ScanRun = { ...cheap, pagesScanned: 10, usage: usage([200_000, 20_000]) }; // $0.30 → $60 per 2,000
    expect(costAlert(smallButSteep)).toBeUndefined();
    expect(projectedCostUsd(smallButSteep.usage, smallButSteep.pagesScanned)).toBeCloseTo(60, 6);
  });
});

describe("cost report rows (dashboard)", () => {
  it("formats dollars for small and large amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.25)).toBe("$0.25");
    expect(formatUsd(12.3456)).toBe("$12.35");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("one row per run, newest first, with tokens per tier, cost and the 2,000-page projection", () => {
    const runs: ScanRun[] = [
      { id: "2026-11-16:100", spaceId: "100", startedAt: "2026-11-16T02:00:00Z", finishedAt: "2026-11-16T02:10:00Z", pagesSeen: 120, pagesScanned: 40, usage: usage([80_000, 6_000], [4_000, 600]) },
      { id: "2026-11-17:100", spaceId: "100", startedAt: "2026-11-17T02:00:00Z", pagesSeen: 121, pagesScanned: 0, usage: emptyUsage() },
    ];
    const rows = costRows(runs);
    expect(rows.map((r) => r.id)).toEqual(["2026-11-17:100", "2026-11-16:100"]);
    const done = rows[1];
    expect(done.date).toBe("2026-11-16");
    expect(done.pages).toBe("40 of 120");
    expect(done.haiku).toBe("80,000 in / 6,000 out");
    expect(done.sonnet).toBe("4,000 in / 600 out");
    expect(done.cost).toBe("$0.13"); // 0.08 + 0.03 + 0.012 + 0.009 = 0.131
    expect(done.per2000).toBe("$6.55"); // 0.131 / 40 * 2000
    expect(done.overBudget).toBe(false);
    const running = rows[0];
    expect(running.pages).toBe("0 of 121");
    expect(running.cost).toBe("$0.00");
    expect(running.per2000).toBe("—");
  });

  it("marks a run that blew the budget", () => {
    const [row] = costRows([{ id: "2026-11-15:100", spaceId: "100", startedAt: NOW, pagesSeen: 2000, pagesScanned: 2000, usage: usage([9_000_000, 900_000]) }]);
    expect(row.cost).toBe("$13.50");
    expect(row.overBudget).toBe(true);
  });
});

describe("MemoryRepo scan runs", () => {
  it("accumulates batches into the run and lists runs newest first", async () => {
    const repo = new MemoryRepo();
    await repo.startRun({ id: "2026-11-16:100", spaceId: "100", startedAt: "2026-11-16T02:00:00Z", pagesSeen: 10, pagesScanned: 0, usage: emptyUsage() });
    await repo.startRun({ id: "2026-11-17:100", spaceId: "100", startedAt: "2026-11-17T02:00:00Z", pagesSeen: 12, pagesScanned: 0, usage: emptyUsage() });
    await repo.startRun({ id: "2026-11-17:200", spaceId: "200", startedAt: "2026-11-17T02:00:00Z", pagesSeen: 3, pagesScanned: 0, usage: emptyUsage() });

    const r1 = await repo.recordBatch("2026-11-17:100", { pagesScanned: 5, usage: usage([1000, 100]), finishedAt: "2026-11-17T02:05:00Z" });
    const r2 = await repo.recordBatch("2026-11-17:100", { pagesScanned: 7, usage: usage([2000, 200], [300, 30]), finishedAt: "2026-11-17T02:06:00Z" });
    expect(r1).toMatchObject({ pagesScanned: 5, usage: usage([1000, 100]) });
    expect(r2).toMatchObject({ pagesScanned: 12, finishedAt: "2026-11-17T02:06:00Z", usage: usage([3000, 300], [300, 30]) });
    // An unknown run (e.g. a replayed event after the row was pruned) is not invented.
    expect(await repo.recordBatch("nope", { pagesScanned: 1, usage: emptyUsage(), finishedAt: NOW })).toBeUndefined();

    const runs = await repo.recentRuns("100", 10);
    expect(runs.map((r) => r.id)).toEqual(["2026-11-17:100", "2026-11-16:100"]);
    expect(runs[0].usage).toEqual(usage([3000, 300], [300, 30]));
    expect(await repo.recentRuns("100", 1)).toHaveLength(1);
    expect((await repo.recentRuns("200", 10)).map((r) => r.id)).toEqual(["2026-11-17:200"]);
  });
});

// Worker wiring: tokens of both models reach the run row, split by tier.
const fetched = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/forge/confluencePages", () => ({
  fetchPage: async (id: string) => {
    const p = fetched.get(id);
    if (!p) throw new Error("no page");
    return p;
  },
}));

function page(id: string, title: string, storage: string, version = 1) {
  return { id, spaceId: "100", title, version, ownerId: "u1", lastModified: "2026-11-10T00:00:00Z", labels: [], ...parseStorage(storage) };
}

describe("scanBatch cost accounting", () => {
  it("records Haiku and Sonnet tokens on the scan run, accumulating across batches", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    const world = fakeClients({ now: NOW, pagesById: ["11", "12"], issues: { "PAY-42": { statusName: "Done", resolved: true } } });
    const runbook = page("11", "Payments service runbook", STORAGE_CONTRADICTION_RUNBOOK);
    const onboarding = page("12", "Payments onboarding", STORAGE_CONTRADICTION_ONBOARDING);
    fetched.set("11", runbook);
    fetched.set("12", onboarding);

    const calls: string[] = [];
    const llm: LlmClient = {
      async callTool<T>(args: { tier: "fast" | "smart"; user: string; tool: { name: string } }) {
        calls.push(`${args.tier}:${args.tool.name}`);
        if (args.tool.name === "classify_page") return { value: { type: "other", confidence: "high" } as T, usage: { input: 500, output: 10 }, model: "claude-haiku-4-5" };
        if (args.tool.name === "record_facts") {
          const onRunbook = args.user.includes("Page title: Payments service runbook");
          const facts = [
            { entity: "payments-service", attribute: "database port", value: onRunbook ? "5433" : "5432", quote: onRunbook ? "port 5433" : "port 5432" },
          ];
          return { value: { facts } as T, usage: { input: 1500, output: 100 }, model: "claude-haiku-4-5" };
        }
        if (args.tool.name === "judge_conflict") return { value: { outdated_page_id: "12", confidence: "high", reason: "r" } as T, usage: { input: 800, output: 40 }, model: "claude-sonnet-4-5" };
        if (args.tool.name === "propose_fix") return { value: { old_text: "", new_text: "", confidence: "low" } as T, usage: { input: 600, output: 30 }, model: "claude-sonnet-4-5" }; // T19b: a draft attempt costs Sonnet tokens even when it declines
        throw new Error(`unexpected tool ${args.tool.name}`);
      },
    };

    await repo.startRun({ id: "2026-11-17:100", spaceId: "100", startedAt: NOW, pagesSeen: 2, pagesScanned: 0, usage: emptyUsage() });
    await scanBatch({ runId: "2026-11-17", spaceId: "100", pageIds: ["11"] }, repo, world, { llm });
    let run = (await repo.recentRuns("100", 1))[0];
    expect(run.pagesScanned).toBe(1);
    expect(run.usage).toEqual(usage([2000, 110])); // classify + extract; nothing to adjudicate yet
    expect(Date.parse(run.finishedAt!)).toBe(Date.parse(NOW));

    await scanBatch({ runId: "2026-11-17", spaceId: "100", pageIds: ["12"] }, repo, world, { llm });
    run = (await repo.recentRuns("100", 1))[0];
    expect(run.pagesScanned).toBe(2);
    expect(run.usage).toEqual(usage([4000, 220], [1400, 70])); // second page: classify + extract + one Sonnet verdict + one Sonnet fix draft for the contradiction
    expect(calls.filter((c) => c.startsWith("smart:"))).toEqual(["smart:judge_conflict", "smart:propose_fix"]);
    expect(usageCostUsd(run.usage)).toBeCloseTo(0.004 + 0.0011 + 0.0042 + 0.00105, 9);
  });

  it("warns once when a run crosses the budget, not on every later batch", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    const world = fakeClients({ now: NOW });
    const classifyTokens = { input: 0, output: 0 };
    const llm: LlmClient = {
      async callTool<T>(args: { tool: { name: string } }) {
        if (args.tool.name === "classify_page") return { value: { type: "other", confidence: "high" } as T, usage: { ...classifyTokens }, model: "claude-haiku-4-5" };
        return { value: { facts: [] } as T, usage: { input: 0, output: 0 }, model: "claude-haiku-4-5" };
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await repo.startRun({ id: "2026-11-17:100", spaceId: "100", startedAt: NOW, pagesSeen: 3, pagesScanned: 0, usage: emptyUsage() });
      const batch = async (id: string) => {
        fetched.set(id, page(id, "Payments service runbook", STORAGE_STALE_RUNBOOK));
        await scanBatch({ runId: "2026-11-17", spaceId: "100", pageIds: [id] }, repo, world, { llm });
      };
      classifyTokens.input = 6_000_000; // $6: under budget, quiet
      await batch("21");
      expect(warn).not.toHaveBeenCalled();
      await batch("22"); // $12 total: this batch crossed the line
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining("cost alert")]);
      warn.mockClear();
      classifyTokens.input = 1_000; // already over budget before this batch → no second alert
      await batch("23");
      expect(warn).not.toHaveBeenCalled();
      expect((await repo.recentRuns("100", 1))[0].pagesScanned).toBe(3);
    } finally {
      warn.mockRestore();
    }
  });
});
