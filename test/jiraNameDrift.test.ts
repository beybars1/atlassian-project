import { describe, expect, it } from "vitest";
import { runChecks } from "../src/checks";
import { jiraNameDrift } from "../src/checks/jiraNameDrift";
import type { PageRecord } from "../src/checks/types";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_RELEASE_PLAN_CLEAN, STORAGE_RELEASE_PLAN_WITH_FAULTS } from "./fixtures/pages";

function page(storage: string, extra: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "7",
    spaceId: "100",
    spaceKey: "OPS",
    title: "release plan",
    version: 1,
    ownerId: "editor-1",
    lastEditorId: "editor-1",
    lastModified: "2026-01-01T00:00:00Z",
    labels: [],
    ...parseStorage(storage),
    ...extra,
  };
}

const world = fakeClients({
  issues: {
    "PAY-510": { statusName: "In Progress", statusCategory: "indeterminate" },
    "PAY-511": { statusName: "In Progress", statusCategory: "indeterminate" },
  },
  projectKeys: ["PAY", "BIL"],
  components: {
    PAY: [
      { name: "Legacy Gateway", archived: true },
      { name: "Card Vault" },
      { name: "Pricing", archived: true },
    ],
    BIL: [{ name: "Ledger", archived: true }],
  },
  versions: {
    PAY: [
      { name: "2.3.0", archived: true, released: true },
      { name: "2.3", archived: true, released: true },
      { name: "1.0", archived: true, released: true },
      { name: "2.4.0", released: true },
      { name: "3.0.0", released: true, releaseDate: "2026-10-20" },
    ],
  },
  users: { "editor-1": true },
});

describe("T11 — Jira component / version name drift", () => {
  it("flags the archived component and the two version faults, nothing else", async () => {
    const findings = await jiraNameDrift(page(STORAGE_RELEASE_PLAN_WITH_FAULTS), world);
    expect(findings.every((f) => f.check === "JIRA_REF_DRIFT")).toBe(true);
    expect(findings.map((f) => f.severity).sort()).toEqual(["low", "low", "medium"]);

    const comp = findings.find((f) => f.severity === "medium")!;
    expect(comp.evidence).toContain('"Legacy Gateway"');
    expect(comp.evidence).toContain("archived");

    const all = findings.map((f) => f.evidence).join("\n");
    expect(all).toContain('"2.3.0"');
    expect(all).toContain('"3.0.0"');
    expect(all).not.toContain("Card Vault");
    expect(all).not.toContain("Pricing");
    expect(all).not.toContain("Ledger");
    expect(all).not.toContain('"2.3"');
    expect(all).not.toContain('"1.0"');
    expect(all).not.toContain("2.4.0");
  });

  it("runs as part of the v0 check set", async () => {
    const findings = await runChecks(page(STORAGE_RELEASE_PLAN_WITH_FAULTS), world);
    expect(findings.filter((f) => f.check === "JIRA_REF_DRIFT")).toHaveLength(3);
  });

  it("reports nothing on a clean page", async () => {
    expect(await jiraNameDrift(page(STORAGE_RELEASE_PLAN_CLEAN), world)).toEqual([]);
  });

  it("does nothing when the page has no issue keys (no project context)", async () => {
    const p = page(STORAGE_RELEASE_PLAN_WITH_FAULTS.replace(/PAY-51\d/g, "ticket"));
    p.issueKeys = [];
    expect(await jiraNameDrift(p, world)).toEqual([]);
  });

  it("does nothing when Jira returns no components or versions (error path)", async () => {
    const empty = fakeClients({ issues: { "PAY-510": {} }, projectKeys: ["PAY"] });
    expect(await jiraNameDrift(page(STORAGE_RELEASE_PLAN_WITH_FAULTS), empty)).toEqual([]);
  });

  it("single-word component names need the word 'component' nearby and exact case", async () => {
    const w = fakeClients({
      issues: { "PAY-1": {} },
      components: { PAY: [{ name: "Vault", archived: true }] },
    });
    const flagged = await jiraNameDrift(page("<p>PAY-1: file bugs against the Vault component.</p>"), w);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].evidence).toContain('"Vault"');

    const noContext = await jiraNameDrift(page("<p>PAY-1: keys live in the Vault.</p>"), w);
    expect(noContext).toEqual([]);

    const wrongCase = await jiraNameDrift(page("<p>PAY-1: the vault component is retired.</p>"), w);
    expect(wrongCase).toEqual([]);
  });

  it("multi-word component names match case-insensitively without context", async () => {
    const w = fakeClients({
      issues: { "PAY-1": {} },
      components: { PAY: [{ name: "Legacy Gateway", archived: true }] },
    });
    const flagged = await jiraNameDrift(page("<p>PAY-1 moves traffic off the legacy gateway.</p>"), w);
    expect(flagged).toHaveLength(1);
  });

  it("version names need release context in the same clause; a 'v' prefix counts", async () => {
    const w = fakeClients({
      issues: { "PAY-1": {} },
      versions: { PAY: [{ name: "4.2", archived: true, released: true }] },
    });
    expect(await jiraNameDrift(page("<p>PAY-1 was fixed in v4.2.</p>"), w)).toHaveLength(1);
    expect(await jiraNameDrift(page("<p>PAY-1 was fixed. Release 4.2 has it.</p>"), w)).toHaveLength(1);
    expect(await jiraNameDrift(page("<p>PAY-1 was released. Latency is 4.2 ms.</p>"), w)).toEqual([]);
    expect(await jiraNameDrift(page("<p>PAY-1 release notes: build 4.2.1 is out.</p>"), w)).toEqual([]);
  });

  it("released versions are only flagged when the page treats them as upcoming", async () => {
    const w = fakeClients({
      issues: { "PAY-1": {} },
      versions: { PAY: [{ name: "5.0.0", released: true }] },
    });
    expect(await jiraNameDrift(page("<p>PAY-1 shipped in version 5.0.0.</p>"), w)).toEqual([]);
    const f = await jiraNameDrift(page("<p>PAY-1 is planned for version 5.0.0, not yet released.</p>"), w);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("low");
    expect(f[0].evidence).toContain("released");
  });

  it("ignores names shorter than three characters", async () => {
    const w = fakeClients({
      issues: { "PAY-1": {} },
      versions: { PAY: [{ name: "v1", archived: true }, { name: "2", archived: true }] },
    });
    expect(await jiraNameDrift(page("<p>PAY-1: release v1 and version 2 are archived.</p>"), w)).toEqual([]);
  });
});
