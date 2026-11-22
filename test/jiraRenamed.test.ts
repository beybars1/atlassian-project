import { describe, expect, it, vi } from "vitest";
import { detectRenames, makeJiraRenamed, RENAME_WINDOW_DAYS, type JiraNameRow, type JiraRename } from "../src/checks/jiraRenamed";
import type { PageRecord } from "../src/checks/types";
import { MemoryRepo } from "../src/db/repo";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_RENAMED_REFS, STORAGE_RENAMED_REFS_FIXED } from "./fixtures/pages";

const NOW = new Date("2026-11-22T02:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function row(kind: JiraNameRow["kind"], jiraId: string, name: string, firstSeen: string, lastSeen = firstSeen, projectKey = "PAY"): JiraNameRow {
  return { projectKey, kind, jiraId, name, firstSeen, lastSeen };
}

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

describe("T19a — detectRenames: the app's own changelog of Jira names", () => {
  it("a project seen for the first time yields no renames", () => {
    const current = [
      { kind: "component" as const, id: "1", name: "Card Gateway" },
      { kind: "version" as const, id: "9", name: "2.5.0" },
    ];
    expect(detectRenames("PAY", [], current, NOW)).toEqual([]);
  });

  it("an id whose name changed since the last refresh is a rename dated now", () => {
    const seen = [row("component", "1", "Payments Gateway", daysAgo(40)), row("component", "2", "Card Vault", daysAgo(40))];
    const current = [
      { kind: "component" as const, id: "1", name: "Card Gateway" },
      { kind: "component" as const, id: "2", name: "Card Vault" },
    ];
    expect(detectRenames("PAY", seen, current, NOW)).toEqual<JiraRename[]>([
      { projectKey: "PAY", kind: "component", jiraId: "1", oldName: "Payments Gateway", newName: "Card Gateway", renamedAt: NOW.toISOString() },
    ]);
  });

  it("a rename seen on an earlier refresh keeps its date; every earlier name of the id is reported", () => {
    const seen = [
      row("component", "1", "Payments", daysAgo(120), daysAgo(90)),
      row("component", "1", "Payments Gateway", daysAgo(89), daysAgo(31)),
      row("component", "1", "Card Gateway", daysAgo(30), daysAgo(1)),
    ];
    const current = [{ kind: "component" as const, id: "1", name: "Card Gateway" }];
    const renames = detectRenames("PAY", seen, current, NOW);
    expect(renames.map((r) => [r.oldName, r.newName, r.renamedAt])).toEqual([
      ["Payments", "Card Gateway", daysAgo(30)],
      ["Payments Gateway", "Card Gateway", daysAgo(30)],
    ]);
  });

  it(`forgets renames older than ${RENAME_WINDOW_DAYS} days`, () => {
    const seen = [row("version", "9", "2.5", daysAgo(400), daysAgo(200)), row("version", "9", "2.5.0", daysAgo(RENAME_WINDOW_DAYS + 1), daysAgo(1))];
    const current = [{ kind: "version" as const, id: "9", name: "2.5.0" }];
    expect(detectRenames("PAY", seen, current, NOW)).toEqual([]);
    const fresh = [row("version", "9", "2.5", daysAgo(400), daysAgo(200)), row("version", "9", "2.5.0", daysAgo(RENAME_WINDOW_DAYS - 1), daysAgo(1))];
    expect(detectRenames("PAY", fresh, current, NOW)).toHaveLength(1);
  });

  it("is silent when the old name still exists in the project, differs only in case, or is too short", () => {
    const seen = [
      row("component", "1", "Vault", daysAgo(10)), // renamed → "Card Vault", but a new component "Vault" exists
      row("component", "3", "card gateway", daysAgo(10)), // case-only change
      row("component", "4", "UI", daysAgo(10)), // too short to search for
      row("version", "9", "2.5", daysAgo(10)), // a version, not a component: never compared with component names
    ];
    const current = [
      { kind: "component" as const, id: "1", name: "Card Vault" },
      { kind: "component" as const, id: "2", name: "Vault" },
      { kind: "component" as const, id: "3", name: "Card Gateway" },
      { kind: "component" as const, id: "4", name: "Web UI" },
      { kind: "version" as const, id: "9", name: "2.5.0" },
    ];
    expect(detectRenames("PAY", seen, current, NOW).map((r) => `${r.kind}:${r.oldName}→${r.newName}`)).toEqual(["version:2.5→2.5.0"]);
  });

  it("ignores names of another project and ids that disappeared", () => {
    const seen = [row("component", "1", "Ledger", daysAgo(10), daysAgo(10), "BIL"), row("component", "7", "Gone", daysAgo(10))];
    const current = [{ kind: "component" as const, id: "1", name: "Card Gateway" }];
    expect(detectRenames("PAY", seen, current, NOW)).toEqual([]);
  });
});

const RENAMES: Record<string, JiraRename[]> = {
  PAY: [
    { projectKey: "PAY", kind: "component", jiraId: "1", oldName: "Payments Gateway", newName: "Card Gateway", renamedAt: "2026-10-03T00:00:00Z" },
    { projectKey: "PAY", kind: "component", jiraId: "2", oldName: "Vault", newName: "Card Vault", renamedAt: "2026-10-03T00:00:00Z" },
    { projectKey: "PAY", kind: "version", jiraId: "9", oldName: "2.5", newName: "2.5.0", renamedAt: "2026-11-01T00:00:00Z" },
  ],
  BIL: [{ projectKey: "BIL", kind: "component", jiraId: "5", oldName: "Ledger", newName: "General Ledger", renamedAt: "2026-11-01T00:00:00Z" }],
};

const world = fakeClients({ projectKeys: ["PAY", "BIL"], users: { "editor-1": true }, now: NOW.toISOString() });

describe("T19a — JIRA_RENAMED check", () => {
  const check = makeJiraRenamed(async (project) => RENAMES[project] ?? []);

  it("flags the planted old names and nothing else, with the concrete replacement", async () => {
    const findings = await check(page(STORAGE_RENAMED_REFS), world);
    expect(findings.every((f) => f.check === "JIRA_RENAMED" && f.pageId === "21")).toBe(true);
    expect(findings.map((f) => f.severity).sort()).toEqual(["low", "medium"]);

    const comp = findings.find((f) => f.severity === "medium")!;
    expect(comp.evidence).toContain('Component "Payments Gateway" (PAY) was renamed to "Card Gateway"');
    expect(comp.evidence).toContain("2026-10-03");
    expect(comp.suggestion).toBe('Replace "Payments Gateway" with "Card Gateway".');

    const ver = findings.find((f) => f.severity === "low")!;
    expect(ver.evidence).toContain('Version "2.5" (PAY) was renamed to "2.5.0"');
    expect(ver.suggestion).toBe('Replace "2.5" with "2.5.0".');

    const all = findings.map((f) => f.evidence).join("\n");
    expect(all).not.toContain("Vault"); // the page already uses the new name
    expect(all).not.toContain("Ledger"); // project BIL is not cited on the page
    expect(all).not.toContain("Legacy Gateway");
  });

  it("is silent on the fixed page, on pages without issue keys, and when the project is unknown", async () => {
    expect(await check(page(STORAGE_RENAMED_REFS_FIXED), world)).toEqual([]);
    expect(await check(page("<p>SOAP calls go through the Payments Gateway component.</p>"), world)).toEqual([]);
    const other = fakeClients({ projectKeys: ["OPS"], now: NOW.toISOString() });
    expect(await check(page(STORAGE_RENAMED_REFS), other)).toEqual([]);
  });

  it("asks the rename source once per project and survives a failing source", async () => {
    const calls: string[] = [];
    const counting = makeJiraRenamed(async (project) => {
      calls.push(project);
      if (project === "BIL") throw new Error("jira down");
      return RENAMES[project];
    });
    const p = page(STORAGE_RENAMED_REFS.replace("PAY-610", "PAY-610</a> and <a href=\"/browse/BIL-7\">BIL-7</a> and PAY-611"));
    const findings = await counting(p, world);
    expect(calls.sort()).toEqual(["BIL", "PAY"]);
    expect(findings).toHaveLength(2);
  });

  it("does not match a version name inside a longer version or an old name inside a word", async () => {
    const text = "<p>PAY-610. Release 2.5.1 fixed it; the Payments Gateways team owns it.</p>";
    expect(await check(page(text), world)).toEqual([]);
  });
});

describe("MemoryRepo — jira name snapshot", () => {
  it("upserts by (project, kind, id, name): first_seen is kept, last_seen moves", async () => {
    const repo = new MemoryRepo();
    const t1 = daysAgo(3);
    const t2 = daysAgo(1);
    await repo.upsertJiraNames([{ projectKey: "PAY", kind: "component", jiraId: "1", name: "Payments Gateway" }], t1);
    await repo.upsertJiraNames(
      [
        { projectKey: "PAY", kind: "component", jiraId: "1", name: "Payments Gateway" },
        { projectKey: "PAY", kind: "version", jiraId: "9", name: "2.5" },
        { projectKey: "BIL", kind: "component", jiraId: "5", name: "Ledger" },
      ],
      t2,
    );
    const pay = await repo.jiraNames("PAY");
    expect(pay).toEqual<JiraNameRow[]>([
      { projectKey: "PAY", kind: "component", jiraId: "1", name: "Payments Gateway", firstSeen: t1, lastSeen: t2 },
      { projectKey: "PAY", kind: "version", jiraId: "9", name: "2.5", firstSeen: t2, lastSeen: t2 },
    ]);
    expect(await repo.jiraNames("BIL")).toHaveLength(1);
    expect(await repo.jiraNames("OPS")).toEqual([]);
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

describe("scanBatch wiring — rename propagation over three nights", () => {
  const components = {
    before: [
      { id: "1", name: "Payments Gateway" },
      { id: "2", name: "Card Vault" },
      { id: "3", name: "Legacy Gateway", archived: true },
    ],
    after: [
      { id: "1", name: "Card Gateway" },
      { id: "2", name: "Card Vault" },
      { id: "3", name: "Legacy Gateway", archived: true },
    ],
  };
  const versions = {
    before: [{ id: "9", name: "2.5", released: true }],
    after: [{ id: "9", name: "2.5.0", released: true }],
  };
  const clientsAt = (when: "before" | "after", now: string) =>
    fakeClients({
      projectKeys: ["PAY", "BIL"],
      components: { PAY: components[when] },
      versions: { PAY: versions[when] },
      users: { "editor-1": true },
      now,
    });

  it("learns the names on night 1, finds the rename on night 2, and the finding clears when the page is fixed", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("21", page(STORAGE_RENAMED_REFS));
    const renamed = (f: { check: string }) => f.check === "JIRA_RENAMED";

    // Night 1: first sight of PAY's names → snapshot stored, no rename finding (T11 still reports the archived component).
    await scanBatch({ runId: "2026-11-20", spaceId: "100", pageIds: ["21"] }, repo, clientsAt("before", "2026-11-20T02:00:00Z"));
    expect((await repo.jiraNames("PAY")).map((r) => r.name).sort()).toEqual(["2.5", "Card Vault", "Legacy Gateway", "Payments Gateway"]);
    expect((await repo.findingsOfPage("21", "open")).filter(renamed)).toEqual([]);
    expect((await repo.findingsOfPage("21", "open")).some((f) => f.check === "JIRA_REF_DRIFT")).toBe(true);

    // Night 2: Jira renamed the component and the version; the page was edited (version 2) and still uses the old names.
    fetched.set("21", page(STORAGE_RENAMED_REFS, { version: 2 }));
    await scanBatch({ runId: "2026-11-21", spaceId: "100", pageIds: ["21"] }, repo, clientsAt("after", "2026-11-21T02:00:00Z"));
    const found = (await repo.findingsOfPage("21", "open")).filter(renamed);
    expect(found.map((f) => f.suggestion).sort()).toEqual(['Replace "2.5" with "2.5.0".', 'Replace "Payments Gateway" with "Card Gateway".']);
    expect(found.find((f) => f.severity === "medium")!.evidence).toContain("2026-11-21");
    // Both the old and the new name are now in the snapshot, dated.
    const rows = await repo.jiraNames("PAY");
    expect(rows.find((r) => r.name === "Card Gateway")!.firstSeen).toBe("2026-11-21T02:00:00.000Z");
    expect(rows.find((r) => r.name === "Payments Gateway")!.lastSeen).toBe("2026-11-20T02:00:00.000Z");

    // Night 3: the page was fixed → no rename finding; the rename itself is still remembered.
    fetched.set("21", page(STORAGE_RENAMED_REFS_FIXED, { version: 3 }));
    await scanBatch({ runId: "2026-11-22", spaceId: "100", pageIds: ["21"] }, repo, clientsAt("after", "2026-11-22T02:00:00Z"));
    expect((await repo.findingsOfPage("21", "open")).filter(renamed)).toEqual([]);
    expect((await repo.jiraNames("PAY")).filter((r) => r.jiraId === "1").map((r) => r.name).sort()).toEqual(["Card Gateway", "Payments Gateway"]);
  });

  it("refreshes a project's names once per batch, not once per page", async () => {
    const { scanBatch } = await import("../src/workers/scanBatch");
    const repo = new MemoryRepo();
    fetched.set("21", page(STORAGE_RENAMED_REFS));
    fetched.set("22", page(STORAGE_RENAMED_REFS_FIXED, { id: "22" }));
    const clients = clientsAt("before", "2026-11-20T02:00:00Z");
    const spy = vi.spyOn(clients.jira, "getComponents");
    await scanBatch({ runId: "2026-11-20", spaceId: "100", pageIds: ["21", "22"] }, repo, clients);
    // T11 (jiraNameDrift) calls it once per page; the rename refresh adds exactly one more call per project.
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
