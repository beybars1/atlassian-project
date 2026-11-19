import { describe, expect, it } from "vitest";
import { MemoryRepo, type ScannedPage } from "../src/db/repo";
import type { Finding } from "../src/checks/types";
import { bylineStatus, bylineSummary, contentIdFromPayload, type BylineFinding } from "../src/ui/bylineSummary";

const base = { spaceId: "s", version: 3, lastModified: "2026-01-01T10:00:00Z", scannedAt: "2026-11-18T02:30:00Z" };
const page: ScannedPage = { ...base, pageId: "1", title: "a" };
const f = (check: Finding["check"], severity: Finding["severity"], evidence: string, related?: Finding["related"]): BylineFinding => ({
  check,
  severity,
  evidence,
  ...(related ? { related } : {}),
});

describe("byline summary (T19)", () => {
  it("a page that was never scanned is not called verified", () => {
    const s = bylineSummary(undefined, []);
    expect(s.state).toBe("unscanned");
    expect(s.title).toBe("WikiVerify");
    expect(s.title).not.toMatch(/verified/i);
    expect(s.tooltip).toMatch(/not scanned/i);
  });

  it("a scanned page with no open findings is verified, with the check date in the tooltip", () => {
    const s = bylineSummary(page, []);
    expect(s.state).toBe("verified");
    expect(s.title).toBe("✓ verified");
    expect(s.tooltip).toBe("No open issues. Last checked 2026-11-18 (page version 3).");
  });

  it("counts open findings in the title, singular and plural", () => {
    expect(bylineSummary(page, [f("DEAD_LINK", "medium", "x")]).title).toBe("⚠ 1 issue");
    const s = bylineSummary(page, [f("DEAD_LINK", "medium", "x"), f("OWNER_GONE", "high", "y")]);
    expect(s.state).toBe("issues");
    expect(s.title).toBe("⚠ 2 issues");
  });

  it("the tooltip names severities worst-first and the distinct checks, contradiction with the other page", () => {
    const s = bylineSummary(page, [
      f("PLACEHOLDER", "low", "TODO"),
      f("DEAD_LINK", "medium", "x"),
      f("DEAD_LINK", "medium", "y"),
      f("CONTRADICTION", "medium", "port", { pageId: "9", pageTitle: "Runbook" }),
    ]);
    expect(s.tooltip).toBe("4 open issues (3 medium, 1 low): DEAD_LINK, CONTRADICTION vs “Runbook”, PLACEHOLDER. Last checked 2026-11-18.");
  });

  it("the tooltip stays within the byline limit however many checks fire", () => {
    const many = Array.from({ length: 40 }, (_, i) => f("CONTRADICTION", "medium", `e${i}`, { pageId: String(i), pageTitle: `A rather long page title number ${i}` }));
    const s = bylineSummary(page, many);
    expect(s.title).toBe("⚠ 40 issues");
    expect(s.tooltip.length).toBeLessThanOrEqual(255);
    expect(s.tooltip).toMatch(/^40 open issues \(40 medium\): /);
    expect(s.tooltip).toMatch(/…/);
  });
});

describe("byline status from the repo (T19)", () => {
  it("reads only the open findings of that page", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base });
    await repo.upsertPage({ pageId: "2", title: "b", ...base });
    const mk = (pageId: string, check: Finding["check"], severity: Finding["severity"], evidence: string): Finding => ({ pageId, check, severity, evidence, suggestion: "fix" });
    await repo.replaceFindings("1", [mk("1", "DEAD_LINK", "medium", "dead"), mk("1", "PLACEHOLDER", "low", "TODO")]);
    await repo.replaceFindings("2", [mk("2", "OWNER_GONE", "high", "gone")]);
    const [{ findings: [dead] }] = await repo.openFindings("s", 10);
    await repo.setFindingStatus(dead.id, "dismissed");

    const s = await bylineStatus(repo, "1");
    expect(s.summary.title).toBe("⚠ 1 issue");
    expect(s.findings.map((x) => x.check)).toEqual(["PLACEHOLDER"]);
    expect(s.page?.title).toBe("a");

    // The dismissed one is still there, just not open.
    expect((await repo.findingsOfPage("1", "dismissed")).map((x) => x.check)).toEqual(["DEAD_LINK"]);
    // Findings are ordered worst-first for the popup.
    await repo.setFindingStatus(dead.id, "open");
    expect((await bylineStatus(repo, "1")).findings.map((x) => x.severity)).toEqual(["medium", "low"]);
  });

  it("an unknown page is unscanned, never verified", async () => {
    const repo = new MemoryRepo();
    const s = await bylineStatus(repo, "404");
    expect(s.page).toBeUndefined();
    expect(s.findings).toEqual([]);
    expect(s.summary.state).toBe("unscanned");
  });

  it("a scanned page without findings is verified", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base });
    await repo.replaceFindings("1", []);
    expect((await bylineStatus(repo, "1")).summary.state).toBe("verified");
  });
});

describe("content id from the dynamicProperties payload (T19)", () => {
  it("accepts the documented shapes and rejects anything that is not a numeric id", () => {
    expect(contentIdFromPayload({ extension: { content: { id: "12345" } } })).toBe("12345");
    expect(contentIdFromPayload({ context: { extension: { content: { id: 777 } } } })).toBe("777");
    expect(contentIdFromPayload({ extension: { content: { id: "a' OR 1=1" } } })).toBeUndefined();
    expect(contentIdFromPayload({})).toBeUndefined();
    expect(contentIdFromPayload(undefined)).toBeUndefined();
    expect(contentIdFromPayload(null)).toBeUndefined();
  });
});
