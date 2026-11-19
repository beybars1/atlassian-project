import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../src/db/repo";
import type { Finding } from "../src/checks/types";
import { filterBySeverity, pageUrl, sortFindings, spaceLabel, type DashboardRow } from "../src/ui/dashboardRows";

const base = { spaceId: "s", version: 1, lastModified: "2026-01-01", scannedAt: "2026-01-02" };
const f = (pageId: string, check: Finding["check"], severity: Finding["severity"], evidence: string): Finding => ({
  pageId,
  check,
  severity,
  evidence,
  suggestion: "fix it",
});

describe("dismissed findings (T18)", () => {
  it("dismissing hides a finding from the open list and shows it in the dismissed list", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base });
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "dead"), f("1", "PLACEHOLDER", "low", "TODO")]);

    const open = await repo.openFindings("s", 10);
    expect(open[0].findings).toHaveLength(2);
    const dead = open[0].findings.find((x) => x.check === "DEAD_LINK")!;
    expect(dead.id).toBeTruthy();
    expect(dead.status).toBe("open");

    expect(await repo.setFindingStatus(dead.id, "dismissed")).toBe(true);
    expect((await repo.openFindings("s", 10))[0].findings.map((x) => x.check)).toEqual(["PLACEHOLDER"]);
    const dismissed = await repo.findingsByStatus("s", "dismissed", 10);
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].findings.map((x) => x.check)).toEqual(["DEAD_LINK"]);
    expect(dismissed[0].findings[0].status).toBe("dismissed");

    // Unknown id → false, nothing changes.
    expect(await repo.setFindingStatus("nope", "dismissed")).toBe(false);
  });

  it("a dismissal survives a rescan that reproduces the same finding", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base });
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "dead")]);
    const [{ findings: [dead] }] = await repo.openFindings("s", 10);
    await repo.setFindingStatus(dead.id, "dismissed");

    // Next night: the page is rescanned and the check still reports the identical finding.
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "dead"), f("1", "OWNER_GONE", "high", "gone")]);
    expect((await repo.openFindings("s", 10))[0].findings.map((x) => x.check)).toEqual(["OWNER_GONE"]);
    const dismissed = await repo.findingsByStatus("s", "dismissed", 10);
    expect(dismissed[0].findings.map((x) => x.check)).toEqual(["DEAD_LINK"]);
    // Still the same row, not a copy.
    expect(dismissed[0].findings[0].id).toBe(dead.id);
  });

  it("a dismissed finding that the rescan no longer reports is dropped; a changed finding is new and open", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base });
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "3 dead links")]);
    const [{ findings: [dead] }] = await repo.openFindings("s", 10);
    await repo.setFindingStatus(dead.id, "dismissed");

    // Evidence changed (one link fixed, two still dead): the dismissal was about the old finding.
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "2 dead links")]);
    expect((await repo.openFindings("s", 10))[0].findings.map((x) => x.evidence)).toEqual(["2 dead links"]);
    expect(await repo.findingsByStatus("s", "dismissed", 10)).toEqual([]);

    // Everything fixed: nothing open, nothing dismissed left behind.
    await repo.replaceFindings("1", []);
    expect(await repo.openFindings("s", 10)).toEqual([]);
    expect(await repo.findingsByStatus("s", "dismissed", 10)).toEqual([]);
  });

  it("a dismissed cross-page finding follows its source page", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "10", title: "a", ...base });
    await repo.upsertPage({ pageId: "11", title: "b", ...base });
    const cross: Finding = { ...f("11", "CONTRADICTION", "medium", "port"), related: { pageId: "10", pageTitle: "a" } };
    await repo.replaceFindings("10", [cross]);
    const [{ findings: [c] }] = await repo.openFindings("s", 10);
    await repo.setFindingStatus(c.id, "dismissed");

    // 10 rescanned, same conflict → stays dismissed. The other side scanned too → still stored once.
    await repo.replaceFindings("10", [cross]);
    await repo.replaceFindings("11", [cross]);
    expect(await repo.openFindings("s", 10)).toEqual([]);
    expect((await repo.findingsByStatus("s", "dismissed", 10))[0].findings).toHaveLength(1);

    // 10 rescanned, conflict gone → the dismissed row goes with it.
    await repo.replaceFindings("10", []);
    expect(await repo.findingsByStatus("s", "dismissed", 10)).toEqual([]);
  });

  it("reopening puts a finding back", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base });
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "dead")]);
    const [{ findings: [dead] }] = await repo.openFindings("s", 10);
    await repo.setFindingStatus(dead.id, "dismissed");
    expect(await repo.setFindingStatus(dead.id, "open")).toBe(true);
    expect((await repo.openFindings("s", 10))[0].findings[0].id).toBe(dead.id);
    expect(await repo.findingsByStatus("s", "dismissed", 10)).toEqual([]);
  });

  it("lists are per space", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", title: "a", ...base, spaceId: "s1" });
    await repo.upsertPage({ pageId: "2", title: "b", ...base, spaceId: "s2" });
    await repo.replaceFindings("1", [f("1", "DEAD_LINK", "medium", "dead")]);
    await repo.replaceFindings("2", [f("2", "DEAD_LINK", "medium", "dead")]);
    expect((await repo.openFindings("s1", 10)).map((r) => r.page.pageId)).toEqual(["1"]);
    expect((await repo.openFindings("s2", 10)).map((r) => r.page.pageId)).toEqual(["2"]);
  });
});

describe("dashboard rows (T18)", () => {
  const row = (pageId: string, findings: Array<[Finding["severity"], string]>): DashboardRow => ({
    page: { pageId, title: pageId, lastModified: "2026-01-01" },
    findings: findings.map(([severity, evidence], i) => ({ id: `${pageId}-${i}`, status: "open", pageId, check: "DEAD_LINK", severity, evidence, suggestion: "" })),
  });

  it("severity filter keeps only findings of that severity and drops pages left empty", () => {
    const rows = [row("a", [["high", "h"], ["low", "l"]]), row("b", [["low", "l"]]), row("c", [["medium", "m"]])];
    expect(filterBySeverity(rows, "all")).toEqual(rows);
    expect(filterBySeverity(rows, "high").map((r) => r.page.pageId)).toEqual(["a"]);
    expect(filterBySeverity(rows, "high")[0].findings.map((x) => x.evidence)).toEqual(["h"]);
    expect(filterBySeverity(rows, "low").map((r) => r.page.pageId)).toEqual(["a", "b"]);
    expect(filterBySeverity(rows, "medium").map((r) => r.page.pageId)).toEqual(["c"]);
  });

  it("findings inside a page are ordered high → medium → low, stable otherwise", () => {
    const r = row("a", [["low", "l1"], ["high", "h"], ["low", "l2"], ["medium", "m"]]);
    expect(sortFindings(r.findings).map((x) => x.evidence)).toEqual(["h", "m", "l1", "l2"]);
  });

  it("page links are relative to the site (no site URL in the app)", () => {
    expect(pageUrl("12345")).toBe("/wiki/pages/viewpage.action?pageId=12345");
    // Ids come from the API as digits; anything else is encoded rather than trusted.
    expect(pageUrl("a b&c")).toBe("/wiki/pages/viewpage.action?pageId=a%20b%26c");
  });

  it("tab label prefers the space key", () => {
    expect(spaceLabel({ spaceId: "123", spaceKey: "ENG" })).toBe("ENG");
    expect(spaceLabel({ spaceId: "123" })).toBe("Space 123");
  });
});
