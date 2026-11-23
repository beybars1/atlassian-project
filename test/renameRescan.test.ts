import { describe, expect, it, vi } from "vitest";
import type { PageRecord } from "../src/checks/types";
import { MemoryRepo, type CitedProjects } from "../src/db/repo";
import { addRescans } from "../src/scan/orchestrate";
import { pagesNeedingRescan, projectKeysOf, renameRescanPageIds } from "../src/scan/renameRescan";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_RENAMED_REFS, STORAGE_RENAMED_REFS_FIXED } from "./fixtures/pages";

const NIGHT1 = "2026-11-20T02:00:00.000Z";
const NIGHT2 = "2026-11-21T02:00:00.000Z";
const NIGHT3 = "2026-11-22T02:00:00.000Z";

function page(storage: string, extra: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "21",
    spaceId: "100",
    spaceKey: "OPS",
    title: "integration notes",
    version: 1,
    ownerId: "editor-1",
    lastEditorId: "editor-1",
    lastModified: "2026-10-01T00:00:00Z",
    labels: [],
    ...parseStorage(storage),
    ...extra,
  };
}

describe("T19d — project keys a page cites", () => {
  it("are the distinct prefixes of its issue keys, in first-seen order", () => {
    expect(projectKeysOf(["PAY-610", "BIL-7", "PAY-611", "OPS-1"])).toEqual(["PAY", "BIL", "OPS"]);
    expect(projectKeysOf([])).toEqual([]);
  });
});

describe("T19d — pagesNeedingRescan (pure)", () => {
  const rows: CitedProjects[] = [
    { pageId: "1", scannedAt: NIGHT1, projectKeys: ["PAY"] },
    { pageId: "2", scannedAt: NIGHT2, projectKeys: ["PAY", "BIL"] },
    { pageId: "3", scannedAt: NIGHT1, projectKeys: ["OPS"] },
  ];

  it("picks the pages citing a project renamed after their scan", () => {
    const latest = new Map([["PAY", "2026-11-20T12:00:00.000Z"]]);
    expect(pagesNeedingRescan(rows, latest)).toEqual(["1"]);
  });

  it("a page scanned after the rename, or citing an untouched project, is left alone", () => {
    const latest = new Map([
      ["PAY", NIGHT1], // same instant as page 1's scan: not newer
      ["BIL", "2026-11-19T00:00:00.000Z"],
    ]);
    expect(pagesNeedingRescan(rows, latest)).toEqual([]);
    expect(pagesNeedingRescan(rows, new Map())).toEqual([]);
  });

  it("compares dates, not strings, so SQL-style and ISO timestamps mix", () => {
    const stored: CitedProjects[] = [{ pageId: "1", scannedAt: "2026-11-20 02:00:00", projectKeys: ["PAY"] }];
    expect(pagesNeedingRescan(stored, new Map([["PAY", "2026-11-20T02:00:01.000Z"]]))).toEqual(["1"]);
    expect(pagesNeedingRescan(stored, new Map([["PAY", "2026-11-20T01:59:59.000Z"]]))).toEqual([]);
  });
});

describe("T19d — addRescans (orchestration)", () => {
  const heads = [
    { id: "1", spaceId: "s", title: "a", version: 2 },
    { id: "2", spaceId: "s", title: "b", version: 1 },
    { id: "3", spaceId: "s", title: "c", version: 5 },
  ];

  it("appends current pages marked for rescan that the version diff did not already pick", () => {
    const todo = [heads[0]];
    expect(addRescans(heads, todo, ["1", "3", "deleted-99"]).map((h) => h.id)).toEqual(["1", "3"]);
  });

  it("changes nothing without rescans", () => {
    expect(addRescans(heads, [heads[1]], [])).toEqual([heads[1]]);
  });
});

describe("MemoryRepo — pagesCitingProjects", () => {
  it("lists the pages of a space that cite any project, with their scan date", async () => {
    const repo = new MemoryRepo();
    const base = { title: "t", version: 1, lastModified: "2026-10-01T00:00:00Z" };
    await repo.upsertPage({ pageId: "1", spaceId: "100", scannedAt: NIGHT1, projectKeys: ["PAY"], ...base });
    await repo.upsertPage({ pageId: "2", spaceId: "100", scannedAt: NIGHT1, projectKeys: [], ...base });
    await repo.upsertPage({ pageId: "3", spaceId: "100", scannedAt: NIGHT1, ...base });
    await repo.upsertPage({ pageId: "4", spaceId: "200", scannedAt: NIGHT1, projectKeys: ["PAY"], ...base });
    expect(await repo.pagesCitingProjects("100")).toEqual<CitedProjects[]>([{ pageId: "1", scannedAt: NIGHT1, projectKeys: ["PAY"] }]);
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

describe("T19d — rescan on rename, end to end over three nights", () => {
  const components = {
    before: [
      { id: "1", name: "Payments Gateway" },
      { id: "2", name: "Card Vault" },
    ],
    after: [
      { id: "1", name: "Card Gateway" },
      { id: "2", name: "Card Vault" },
    ],
  };
  const versions = [{ id: "9", name: "2.5.0", released: true }];
  const clientsAt = (when: "before" | "after", now: string) =>
    fakeClients({
      projectKeys: ["PAY", "BIL"],
      components: { PAY: components[when] },
      versions: { PAY: versions },
      users: { "editor-1": true },
      now,
    });

  it("the worker stores the cited projects; the nightly refreshes Jira names and re-queues the unedited page once", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    const renamed = (f: { check: string }) => f.check === "JIRA_RENAMED";
    // Page 21 cites PAY and still says "Payments Gateway"; page 22 cites nothing. Neither is ever edited again.
    fetched.set("21", page(STORAGE_RENAMED_REFS));
    fetched.set("22", page("<p>Nothing from Jira here.</p>", { id: "22" }));

    // Night 1: regular scan. Names learned, projects stored on the page row.
    await scanBatch({ runId: "2026-11-20", spaceId: "100", pageIds: ["21", "22"] }, repo, clientsAt("before", NIGHT1));
    expect((await repo.getPage("21"))!.projectKeys).toEqual(["PAY"]);
    expect((await repo.getPage("22"))!.projectKeys).toEqual([]);
    expect(await renameRescanPageIds(repo, clientsAt("before", NIGHT1), "100")).toEqual([]);

    // Night 2: Jira renamed the component; nobody edited the page. The nightly's refresh finds the rename
    // and marks the page for a rescan, which produces the finding — without the version-based diff.
    const night2 = clientsAt("after", NIGHT2);
    const rescan = await renameRescanPageIds(repo, night2, "100");
    expect(rescan).toEqual(["21"]);
    expect((await repo.jiraNames("PAY")).find((r) => r.name === "Card Gateway")!.firstSeen).toBe(NIGHT2);
    await scanBatch({ runId: "2026-11-21", spaceId: "100", pageIds: rescan }, repo, night2);
    const found = (await repo.findingsOfPage("21", "open")).filter(renamed);
    expect(found.map((f) => f.suggestion)).toEqual(['Replace "Payments Gateway" with "Card Gateway".']);
    expect(found[0].evidence).toContain("2026-11-21");

    // Night 3: the page was scanned after the rename → not queued again; the finding stays until the page is fixed.
    const night3 = clientsAt("after", NIGHT3);
    expect(await renameRescanPageIds(repo, night3, "100")).toEqual([]);
    fetched.set("21", page(STORAGE_RENAMED_REFS_FIXED, { version: 2 }));
    await scanBatch({ runId: "2026-11-22", spaceId: "100", pageIds: ["21"] }, repo, night3);
    expect((await repo.findingsOfPage("21", "open")).filter(renamed)).toEqual([]);
  });

  it("asks Jira once per cited project and ignores projects the site does not know", async () => {
    const repo = new MemoryRepo();
    const base = { title: "t", version: 1, lastModified: "2026-10-01T00:00:00Z", scannedAt: NIGHT1 };
    await repo.upsertPage({ pageId: "1", spaceId: "100", projectKeys: ["PAY", "ISO"], ...base });
    await repo.upsertPage({ pageId: "2", spaceId: "100", projectKeys: ["PAY"], ...base });
    const clients = clientsAt("before", NIGHT2);
    const spy = vi.spyOn(clients.jira, "getComponents");
    expect(await renameRescanPageIds(repo, clients, "100")).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("PAY");
  });

  it("a failing Jira refresh means no rescans tonight, never a throw", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "1", spaceId: "100", title: "t", version: 1, lastModified: "2026-10-01T00:00:00Z", scannedAt: NIGHT1, projectKeys: ["PAY"] });
    const clients = clientsAt("after", NIGHT2);
    clients.jira.getComponents = async () => {
      throw new Error("jira down");
    };
    expect(await renameRescanPageIds(repo, clients, "100")).toEqual([]);
  });
});

describe("storedDateMs", () => {
  it("reads a zone-less SQL datetime as UTC and leaves ISO strings alone", async () => {
    const { storedDateMs } = await import("../src/db/repo");
    expect(storedDateMs("2026-11-20 02:00:00")).toBe(Date.parse("2026-11-20T02:00:00Z"));
    expect(storedDateMs("2026-11-20T02:00:00")).toBe(Date.parse("2026-11-20T02:00:00Z"));
    expect(storedDateMs("2026-11-20T02:00:00.000Z")).toBe(Date.parse("2026-11-20T02:00:00Z"));
    expect(storedDateMs("2026-11-20T02:00:00+05:00")).toBe(Date.parse("2026-11-19T21:00:00Z"));
    expect(Number.isNaN(storedDateMs(""))).toBe(true);
  });
});
