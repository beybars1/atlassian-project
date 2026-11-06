import { describe, expect, it } from "vitest";
import { batches, pagesToScan } from "../src/scan/orchestrate";
import { MemoryRepo } from "../src/db/repo";

describe("orchestration", () => {
  it("scans only pages whose version changed", () => {
    const heads = [
      { id: "1", spaceId: "s", title: "a", version: 2 },
      { id: "2", spaceId: "s", title: "b", version: 1 },
      { id: "3", spaceId: "s", title: "c", version: 5 },
    ];
    const scanned = new Map([["1", 2], ["2", 0]]);
    expect(pagesToScan(heads, scanned).map((h) => h.id)).toEqual(["2", "3"]);
  });

  it("splits into batches of 20", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    expect(batches(items).map((b) => b.length)).toEqual([20, 20, 5]);
  });

  it("memory repo ranks pages by severity score", async () => {
    const repo = new MemoryRepo();
    const base = { spaceId: "s", version: 1, lastModified: "2026-01-01", scannedAt: "2026-01-02" };
    await repo.upsertPage({ pageId: "low", title: "low", ...base });
    await repo.upsertPage({ pageId: "high", title: "high", ...base });
    await repo.replaceFindings("low", [{ pageId: "low", check: "PLACEHOLDER", severity: "low", evidence: "", suggestion: "" }]);
    await repo.replaceFindings("high", [
      { pageId: "high", check: "OWNER_GONE", severity: "high", evidence: "", suggestion: "" },
      { pageId: "high", check: "DEAD_LINK", severity: "medium", evidence: "", suggestion: "" },
    ]);
    const top = await repo.openFindings("s", 20);
    expect(top.map((t) => t.page.pageId)).toEqual(["high", "low"]);
  });
});
