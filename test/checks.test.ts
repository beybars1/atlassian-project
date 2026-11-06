import { describe, expect, it } from "vitest";
import { runChecks } from "../src/checks";
import type { PageRecord } from "../src/checks/types";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_CLEAN, STORAGE_RUNBOOK_WITH_FAULTS } from "./fixtures/pages";

function page(storage: string, extra: Partial<PageRecord> = {}): PageRecord {
  const parsed = parseStorage(storage);
  return {
    id: "1",
    spaceId: "100",
    spaceKey: "OPS",
    title: "fixture",
    version: 3,
    ownerId: "owner-1",
    lastEditorId: "editor-1",
    lastModified: "2026-01-01T00:00:00Z",
    labels: [],
    ...parsed,
    ...extra,
  };
}

const world = fakeClients({
  pagesById: ["42"], // 999999 does not exist
  pagesByTitle: [["OPS", "New deploy guide"]], // "Old deploy guide" does not exist
  issues: {
    "PAY-101": { statusName: "Done", statusCategory: "done" },
    "PAY-202": { statusName: "Done", statusCategory: "done" }, // page says "pending"
    "PAY-404": { statusName: "In Progress", statusCategory: "indeterminate" },
    // PAY-303 missing
  },
  projectKeys: ["PAY"], // ISO is not a project → ISO-9001 must not be flagged
  users: { "owner-1": false, "editor-1": true },
});

describe("v0 checks on the faulty runbook", () => {
  it("reports every planted fault and nothing else", async () => {
    const findings = await runChecks(page(STORAGE_RUNBOOK_WITH_FAULTS), world);
    const codes = findings.map((f) => f.check).sort();
    expect(codes).toEqual(["DEAD_LINK", "JIRA_REF_DRIFT", "JIRA_REF_DRIFT", "OWNER_GONE", "PLACEHOLDER"]);

    const dead = findings.find((f) => f.check === "DEAD_LINK")!;
    expect(dead.evidence).toContain('"Old deploy guide"');
    expect(dead.evidence).toContain("page #999999");
    expect(dead.evidence).toContain("PAY-303");
    expect(dead.severity).toBe("high");

    const drift = findings.filter((f) => f.check === "JIRA_REF_DRIFT");
    expect(drift.map((d) => d.severity).sort()).toEqual(["high", "low"]);
    expect(drift.find((d) => d.severity === "high")!.evidence).toContain("PAY-303");
    expect(drift.find((d) => d.severity === "low")!.evidence).toContain("PAY-202");
    expect(JSON.stringify(drift)).not.toContain("ISO-9001");

    const owner = findings.find((f) => f.check === "OWNER_GONE")!;
    expect(owner.severity).toBe("high");

    const ph = findings.find((f) => f.check === "PLACEHOLDER")!;
    expect(ph.evidence).toContain("TBD");
    expect(ph.evidence).toContain("[insert …]");
  });

  it("reports nothing on a clean page", async () => {
    const findings = await runChecks(page(STORAGE_CLEAN, { ownerId: "editor-1" }), world);
    expect(findings).toEqual([]);
  });

  it("falls back to last editor when there is no owner", async () => {
    const findings = await runChecks(
      page(STORAGE_CLEAN, { ownerId: undefined, lastEditorId: "ghost" }),
      fakeClients({ issues: { "PAY-404": {} }, users: { ghost: false } }),
    );
    expect(findings).toEqual([expect.objectContaining({ check: "OWNER_GONE", severity: "medium" })]);
  });
});
