/**
 * T19b — suggested-fix preview: Sonnet drafts a concrete `Replace "old" with "new".` for findings
 * of checks 3, 4 and 6; only validated drafts replace the generic suggestion.
 */
import { describe, expect, it, vi } from "vitest";
import type { Finding, PageRecord } from "../src/checks/types";
import { MemoryRepo } from "../src/db/repo";
import type { LlmClient } from "../src/llm/client";
import {
  addFixPreviews,
  excerptsFor,
  EXCERPT_RADIUS,
  FIX_TOOL,
  formatFix,
  MAX_EXCERPT_CHARS,
  MAX_FIXES_PER_PAGE,
  MAX_OLD_CHARS,
  suggestFix,
  validFix,
} from "../src/llm/suggestFix";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_CONTRADICTION_ONBOARDING, STORAGE_RUNBOOK_WITH_FAULTS } from "./fixtures/pages";

const RUNBOOK_TEXT = parseStorage(STORAGE_RUNBOOK_WITH_FAULTS).text;
const PAGE = { id: "1", title: "Payments service runbook", text: RUNBOOK_TEXT };

function fakeLlm(answers: Record<string, unknown | ((user: string) => unknown)>, usage = { input: 900, output: 50 }) {
  const calls: Array<{ tier: string; toolName: string; user: string; system: string }> = [];
  const llm: LlmClient = {
    async callTool<T>(args: { tier: string; user: string; system: string; tool: { name: string } }) {
      calls.push({ tier: args.tier, toolName: args.tool.name, user: args.user, system: args.system });
      const a = answers[args.tool.name];
      if (a === undefined) throw new Error(`no scripted answer for ${args.tool.name}`);
      return { value: (typeof a === "function" ? a(args.user) : a) as T, usage, model: "fake" };
    },
  };
  return { llm, calls };
}

const finding = (over: Partial<Finding> = {}): Finding => ({
  pageId: "1",
  check: "JIRA_REF_DRIFT",
  severity: "low",
  evidence: "PAY-202 is Done but the page describes it as pending.",
  suggestion: "Reword the section or remove the completed item.",
  ...over,
});

const DRAFT = { old_text: "the migration is pending in PAY-202", new_text: "the migration was completed in PAY-202", confidence: "high", note: "Issue is done." };

describe("excerptsFor — what the model sees", () => {
  it("locates issue keys and quoted snippets, whitespace-insensitively, and merges overlapping windows", () => {
    const evidence = 'TBD ×1 — "Owner: platform team. Last reviewed TBD. Deploy steps are tracked in and the migration"; PAY-303 missing';
    const ex = excerptsFor(RUNBOOK_TEXT, evidence, 20);
    expect(ex).toContain("Last reviewed TBD."); // the snippet was whitespace-collapsed by check 4, the page has a newline there
    expect(ex).toContain("PAY-303");
    // Two anchors far apart → two windows with a cut between them; a cut before the first too (it starts mid-page).
    expect(ex).toMatch(/^\[…\].*\n\[…\].*PAY-303/s);
    // Close anchors → one window.
    const one = excerptsFor(RUNBOOK_TEXT, 'PAY-202 and "ISO-9001"', EXCERPT_RADIUS);
    expect(one.match(/\[…\]/g) ?? []).toHaveLength(0); // small page, one window covering all of it
  });

  it("falls back to the head of the page when nothing can be located", () => {
    const long = "x".repeat(MAX_EXCERPT_CHARS + 100);
    const ex = excerptsFor(long, 'nothing "here" matches');
    expect(ex.length).toBe(MAX_EXCERPT_CHARS + "\n[…]".length);
    expect(excerptsFor("short page", "no anchors")).toBe("short page");
  });
});

describe("validFix — only unambiguous, local edits survive", () => {
  it("accepts a unique verbatim fragment and trims it", () => {
    const d = { old: "  the migration is pending in PAY-202 ", new: " the migration was completed in PAY-202 " };
    expect(validFix(RUNBOOK_TEXT, d)).toBe(true);
    expect(d).toEqual({ old: "the migration is pending in PAY-202", new: "the migration was completed in PAY-202" });
  });

  it("accepts a deletion", () => {
    expect(validFix(RUNBOOK_TEXT, { old: "[insert escalation contact]", new: "" })).toBe(true);
  });

  it("rejects text that is not on the page, is ambiguous, trivial, unchanged or too long", () => {
    expect(validFix(RUNBOOK_TEXT, { old: "the migration is pending in PAY-999", new: "x" })).toBe(false);
    expect(validFix(RUNBOOK_TEXT, { old: "PAY-", new: "x" })).toBe(false); // occurs twice
    expect(validFix(RUNBOOK_TEXT, { old: "", new: "x" })).toBe(false);
    expect(validFix(RUNBOOK_TEXT, { old: "in", new: "x" })).toBe(false);
    expect(validFix(RUNBOOK_TEXT, { old: "TBD", new: "TBD" })).toBe(false);
    expect(validFix("a".repeat(MAX_OLD_CHARS + 1), { old: "a".repeat(MAX_OLD_CHARS + 1), new: "b" })).toBe(false);
    expect(validFix(RUNBOOK_TEXT, { old: "TBD", new: "b".repeat(1000) })).toBe(false);
  });

  it("formats like check 3c's suggestion", () => {
    expect(formatFix({ old: "a b", new: "c" })).toBe('Replace "a b" with "c".');
    expect(formatFix({ old: "a b", new: "" })).toBe('Remove "a b".');
  });
});

describe("suggestFix — one Sonnet call per finding", () => {
  it("sends the finding and the excerpt to the smart tier and returns the validated draft", async () => {
    const f = fakeLlm({ propose_fix: DRAFT });
    const r = await suggestFix(f.llm, PAGE, finding());
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ tier: "smart", toolName: FIX_TOOL.name });
    expect(f.calls[0].user).toContain("Finding: PAY-202 is Done");
    expect(f.calls[0].user).toContain("Generic advice: Reword");
    expect(f.calls[0].user).toContain("Page title: Payments service runbook");
    expect(f.calls[0].user).toContain("the migration is pending in PAY-202");
    expect(f.calls[0].system).toContain("Never invent facts");
    expect(r.fix).toEqual({ old: "the migration is pending in PAY-202", new: "the migration was completed in PAY-202" });
    expect(r.usage).toEqual({ input: 900, output: 50 });
  });

  it.each([
    ["medium confidence", { ...DRAFT, confidence: "medium" }],
    ["no edit", { old_text: "", new_text: "", confidence: "low" }],
    ["text not on the page", { ...DRAFT, old_text: "the migration is pending in PAY-203" }],
    ["ambiguous text", { ...DRAFT, old_text: "PAY-" }],
    ["garbage", { facts: [] }],
    ["nothing", null],
  ])("returns no fix for %s", async (_name, answer) => {
    const f = fakeLlm({ propose_fix: answer });
    const r = await suggestFix(f.llm, PAGE, finding());
    expect(r.fix).toBeUndefined();
  });
});

describe("addFixPreviews — which findings get a draft", () => {
  const generic = [
    finding({ check: "DEAD_LINK", severity: "high", evidence: "dead", suggestion: "Fix the link." }),
    finding({ check: "PLACEHOLDER", severity: "medium", evidence: 'TBD ×1 — "Last reviewed TBD."', suggestion: "Fill in or remove the placeholder text, or mark the page as draft." }),
    finding(), // JIRA_REF_DRIFT low
    finding({ check: "JIRA_RENAMED", severity: "medium", evidence: "renamed", suggestion: 'Replace "A" with "B".' }),
    finding({ pageId: "2", check: "CONTRADICTION", severity: "medium", evidence: "elsewhere", suggestion: "Update it.", related: { pageId: "1", pageTitle: "Runbook" } }),
  ];

  it("drafts for checks 3, 4, 6 on this page only, worst first, and leaves the rest untouched", async () => {
    const f = fakeLlm({
      propose_fix: (user: string) =>
        user.includes("placeholder") ? { old_text: " Last reviewed TBD.", new_text: "", confidence: "high" } : DRAFT,
    });
    const r = await addFixPreviews({ llm: f.llm, page: PAGE, findings: generic });
    expect(f.calls.map((c) => c.user.split("\n")[0])).toEqual([
      "Check: placeholder or unfinished-template text",
      expect.stringContaining("Check: Jira reference drift"),
    ]);
    expect(r.drafted).toBe(2);
    expect(r.usage).toEqual({ input: 1800, output: 100 });
    expect(r.findings.map((x) => x.suggestion)).toEqual([
      "Fix the link.",
      'Remove "Last reviewed TBD.".',
      'Replace "the migration is pending in PAY-202" with "the migration was completed in PAY-202".',
      'Replace "A" with "B".',
      "Update it.",
    ]);
    expect(generic[2].suggestion).toBe("Reword the section or remove the completed item."); // input not mutated
  });

  it("stops after MAX_FIXES_PER_PAGE calls and keeps the generic text when a call fails or declines", async () => {
    const many = Array.from({ length: MAX_FIXES_PER_PAGE + 2 }, (_, i) => finding({ evidence: `PAY-20${i} is Done but the page describes it as pending.` }));
    const f = fakeLlm({ propose_fix: (user: string) => (user.includes("PAY-200") ? { old_text: "", new_text: "", confidence: "low" } : DRAFT) });
    const r = await addFixPreviews({ llm: f.llm, page: PAGE, findings: many });
    expect(r.drafted).toBe(MAX_FIXES_PER_PAGE);
    expect(r.findings[0].suggestion).toBe("Reword the section or remove the completed item."); // declined
    expect(r.findings[1].suggestion).toContain("Replace");
    expect(r.findings[MAX_FIXES_PER_PAGE + 1].suggestion).toBe("Reword the section or remove the completed item."); // over the cap

    const log = vi.fn();
    const broken = fakeLlm({});
    const r2 = await addFixPreviews({ llm: broken.llm, page: PAGE, findings: [finding()], log });
    expect(r2.findings[0].suggestion).toBe("Reword the section or remove the completed item.");
    expect(r2.usage).toEqual({ input: 0, output: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("suggest fix 1/JIRA_REF_DRIFT failed"));
  });

  it("reuses a stored suggestion for an identical finding instead of calling again", async () => {
    const stored = [finding({ suggestion: 'Replace "the migration is pending in PAY-202" with "the migration was completed in PAY-202".' })];
    const f = fakeLlm({ propose_fix: DRAFT });
    const r = await addFixPreviews({ llm: f.llm, page: PAGE, findings: [finding(), finding({ evidence: "PAY-303 is Done but the page describes it as pending." })], stored });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].user).toContain("PAY-303");
    expect(r.findings[0].suggestion).toBe(stored[0].suggestion);
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

function record(id: string, title: string, storage: string, version = 1): PageRecord {
  return { id, spaceId: "100", title, version, lastModified: "2026-11-10T00:00:00Z", labels: [], ...parseStorage(storage) };
}

describe("scanBatch wiring — check 8", () => {
  const world = fakeClients({
    now: "2026-11-24T02:00:00Z",
    issues: { "PAY-202": { statusName: "Done", statusCategory: "done" } },
    projectKeys: ["PAY"],
  });
  const answers = {
    classify_page: { type: "other", confidence: "high" },
    record_facts: { facts: [] },
    propose_fix: (user: string) => (user.includes("Jira reference drift") ? DRAFT : { old_text: "", new_text: "", confidence: "low" }),
  };

  it("stores the drafted fix, reuses it on a rescan of the same version so a dismissal holds, and redrafts after an edit", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("1", record("1", "Payments service runbook", STORAGE_RUNBOOK_WITH_FAULTS));
    const f = fakeLlm(answers);

    await scanBatch({ runId: "r1", spaceId: "100", pageIds: ["1"] }, repo, world, { llm: f.llm });
    const fixCalls = () => f.calls.filter((c) => c.toolName === FIX_TOOL.name);
    expect(fixCalls()).toHaveLength(3); // JIRA_REF_DRIFT high (PAY-303 missing), PLACEHOLDER medium, JIRA_REF_DRIFT low — cap reached
    expect(fixCalls().every((c) => c.tier === "smart")).toBe(true);
    const open = await repo.findingsOfPage("1", "open");
    const drift = open.find((x) => x.check === "JIRA_REF_DRIFT" && x.severity === "low")!;
    expect(drift.suggestion).toBe('Replace "the migration is pending in PAY-202" with "the migration was completed in PAY-202".');
    expect(open.find((x) => x.check === "PLACEHOLDER")!.suggestion).toBe("Fill in or remove the placeholder text, or mark the page as draft."); // declined
    expect(open.find((x) => x.check === "DEAD_LINK")!.suggestion).not.toContain("Replace"); // not a fix-preview check
    const run = (await repo.recentRuns("100", 1))[0];
    expect(run).toBeUndefined(); // no startRun in this test; usage is checked in cost.test.ts

    // Dismiss the drifted finding, replay the same version: no Sonnet call, the dismissal holds.
    await repo.setFindingStatus(drift.id, "dismissed");
    const before = f.calls.length;
    await scanBatch({ runId: "r1", spaceId: "100", pageIds: ["1"] }, repo, world, { llm: f.llm });
    expect(f.calls.slice(before).filter((c) => c.toolName === FIX_TOOL.name)).toEqual([]);
    expect((await repo.findingsOfPage("1", "dismissed")).map((x) => x.id)).toEqual([drift.id]);
    expect((await repo.findingsOfPage("1", "open")).some((x) => x.check === "JIRA_REF_DRIFT" && x.severity === "low")).toBe(false);

    // The page is edited (new version): drafted again.
    fetched.set("1", record("1", "Payments service runbook", STORAGE_RUNBOOK_WITH_FAULTS, 2));
    const again = f.calls.length;
    await scanBatch({ runId: "r2", spaceId: "100", pageIds: ["1"] }, repo, world, { llm: f.llm });
    expect(f.calls.slice(again).filter((c) => c.toolName === FIX_TOOL.name)).toHaveLength(3);
  });

  it("leaves suggestions generic without an LLM and when the fix call fails", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("1", record("1", "Payments service runbook", STORAGE_RUNBOOK_WITH_FAULTS));
    await scanBatch({ runId: "r", spaceId: "100", pageIds: ["1"] }, repo, world, {});
    expect((await repo.findingsOfPage("1", "open")).every((x) => !x.suggestion.startsWith(`Replace "`))).toBe(true);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const broken = fakeLlm({ ...answers, propose_fix: () => { throw new Error("llm down"); } });
      const fresh = new MemoryRepo();
      const scanned = await scanBatch({ runId: "r", spaceId: "100", pageIds: ["1"] }, fresh, world, { llm: broken.llm });
      expect(scanned).toBe(1);
      expect((await fresh.findingsOfPage("1", "open")).every((x) => !x.suggestion.startsWith(`Replace "`))).toBe(true);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("suggest fix 1/"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not draft for a contradiction that lands on the other page", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("2", record("2", "Payments team onboarding", STORAGE_CONTRADICTION_ONBOARDING));
    fetched.set("3", record("3", "Payments service runbook", "<p>" + "The database listens on port 5433 since the Postgres upgrade. ".repeat(5) + "</p>"));
    const f = fakeLlm({
      ...answers,
      record_facts: (user: string) => ({
        facts: [{ entity: "payments-service", attribute: "port", value: user.includes("onboarding") ? "5432" : "5433", quote: user.includes("onboarding") ? "port 5432" : "port 5433" }],
      }),
      judge_conflict: { outdated_page_id: "2", confidence: "high", reason: "r" },
    });
    await scanBatch({ runId: "r", spaceId: "100", pageIds: ["2"] }, repo, world, { llm: f.llm });
    await scanBatch({ runId: "r", spaceId: "100", pageIds: ["3"] }, repo, world, { llm: f.llm }); // the finding lands on page 2
    expect(f.calls.filter((c) => c.toolName === FIX_TOOL.name)).toEqual([]);
    const c = (await repo.findingsOfPage("2", "open")).find((x) => x.check === "CONTRADICTION")!;
    expect(c.suggestion).toContain('to "5433"'); // check 6's own, still generic
  });
});
