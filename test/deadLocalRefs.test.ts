import { describe, expect, it } from "vitest";
import { runChecks } from "../src/checks";
import { deadAnchors } from "../src/checks/deadAnchors";
import { deadAttachments } from "../src/checks/deadAttachments";
import type { PageRecord } from "../src/checks/types";
import { parseStorage } from "../src/text/storageToText";
import { fakeClients } from "./fixtures/clients";
import { STORAGE_RUNBOOK_LOCAL_REFS, STORAGE_RUNBOOK_LOCAL_REFS_CLEAN } from "./fixtures/pages";

function page(storage: string, extra: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "7",
    spaceId: "100",
    spaceKey: "OPS",
    title: "Payments runbook",
    version: 1,
    ownerId: "editor-1",
    lastEditorId: "editor-1",
    lastModified: "2026-01-01T00:00:00Z",
    labels: [],
    ...parseStorage(storage, { siteBase: "https://acme.atlassian.net" }),
    ...extra,
  };
}

const world = fakeClients({
  pagesByTitle: [["OPS", "Shared files"]], // the page owning "shared.xlsx" exists; only the file is unresolved
  attachments: {
    "7": ["architecture.png", "Runbook v2.pdf", "export.csv"],
    "8": ["other.pdf"],
  },
  users: { "editor-1": true },
});

describe("parseStorage — attachments and anchors", () => {
  const parsed = parseStorage(STORAGE_RUNBOOK_LOCAL_REFS, { siteBase: "https://acme.atlassian.net" });

  it("extracts attachment references with their kind and owning page", () => {
    expect(parsed.attachments).toEqual(
      expect.arrayContaining([
        { filename: "architecture.png", kind: "image" },
        { filename: "screenshot-2024.png", kind: "image" },
        { filename: "runbook v2.pdf", kind: "link" },
        { filename: "old-diagram.vsdx", kind: "link" },
        { filename: "shared.xlsx", kind: "link", pageTitle: "Shared files", spaceKey: "OPS" },
        { filename: "export.csv", kind: "download", pageId: "7" },
        { filename: "Runbook v2.pdf", kind: "download", pageId: "7" },
        { filename: "gone.pdf", kind: "download", pageId: "8" },
        { filename: "other.pdf", kind: "download", pageId: "8" },
      ]),
    );
    expect(parsed.attachments).toHaveLength(9);
  });

  it("extracts same-page anchor targets, anchor macro names and headings", () => {
    expect(parsed.anchors.targets).toEqual([
      "Deploysteps",
      "Paymentsrunbook-Deploysteps",
      "Deploysteps.1",
      "known-issues",
      "Rollback-procedure",
      "escalation",
      "Deploy steps",
      "top",
    ]);
    expect(parsed.anchors.names).toEqual(["known-issues"]);
    expect(parsed.anchors.headings).toEqual(["Payments runbook", "Deploy steps", "Deploy steps", "Known issues"]);
    expect(parsed.anchors.hasIncludes).toBe(false);
  });

  it("ignores anchors that point at another page", () => {
    const p = parseStorage(
      `<ac:link ac:anchor="x"><ri:page ri:content-title="Other" /></ac:link><a href="/wiki/spaces/OPS/pages/9/T#y">y</a>`,
    );
    expect(p.anchors.targets).toEqual([]);
    expect(p.links).toEqual(expect.arrayContaining([expect.objectContaining({ pageId: "9" })]));
  });

  it("flags include macros so the anchor check can stand down", () => {
    const p = parseStorage(`<ac:structured-macro ac:name="include"><ac:parameter ac:name=""><ri:page ri:content-title="X"/></ac:parameter></ac:structured-macro>`);
    expect(p.anchors.hasIncludes).toBe(true);
  });
});

describe("T12 — dead attachments", () => {
  it("flags the three missing attachments and nothing else", async () => {
    const findings = await deadAttachments(page(STORAGE_RUNBOOK_LOCAL_REFS), world);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.check).toBe("DEAD_LINK");
    expect(f.severity).toBe("high"); // 3 missing
    expect(f.evidence).toContain('"old-diagram.vsdx"');
    expect(f.evidence).toContain('"screenshot-2024.png"');
    expect(f.evidence).toContain('"gone.pdf" (page #8)');
    expect(f.evidence).not.toContain("architecture.png");
    expect(f.evidence).not.toContain("unbook v2.pdf"); // neither case variant
    expect(f.evidence).not.toContain("export.csv");
    expect(f.evidence).not.toContain("shared.xlsx");
    expect(f.evidence).not.toContain("other.pdf");
  });

  it("uses medium severity for fewer than three", async () => {
    const p = page(`<ac:link><ri:attachment ri:filename="nope.pdf" /></ac:link>`);
    const findings = await deadAttachments(p, world);
    expect(findings).toEqual([expect.objectContaining({ check: "DEAD_LINK", severity: "medium" })]);
  });

  it("flags nothing when the attachment list is unavailable (no scope, error)", async () => {
    const noList = fakeClients({ attachments: {} }); // every page unknown → undefined
    const findings = await deadAttachments(page(STORAGE_RUNBOOK_LOCAL_REFS), noList);
    expect(findings).toEqual([]);
  });

  it("does not call the API when the page references no attachments", async () => {
    let calls = 0;
    const counting = fakeClients({ attachments: {} });
    counting.confluence.attachmentFilenames = async () => {
      calls += 1;
      return [];
    };
    expect(await deadAttachments(page(`<p>plain</p>`), counting)).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("T12 — dead same-page anchors", () => {
  it("flags the two dangling anchors and nothing else", async () => {
    const findings = await deadAnchors(page(STORAGE_RUNBOOK_LOCAL_REFS), world);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.check).toBe("DEAD_LINK");
    expect(f.severity).toBe("low");
    expect(f.evidence).toContain("#Rollback-procedure");
    expect(f.evidence).toContain("#escalation");
    expect(f.evidence).not.toContain("Deploysteps");
    expect(f.evidence).not.toContain("Paymentsrunbook");
    expect(f.evidence).not.toContain("known-issues");
    expect(f.evidence).not.toContain("#top");
  });

  it("matches heading anchors without the page title prefix when the title differs", async () => {
    const p = page(`<a href="#Deploysteps">x</a><h2>Deploy steps</h2>`, { title: "Something else" });
    expect(await deadAnchors(p, world)).toEqual([]);
  });

  it("stands down when the page includes other pages", async () => {
    const p = page(
      `<a href="#from-elsewhere">x</a><ac:structured-macro ac:name="excerpt-include"><ac:parameter ac:name=""><ri:page ri:content-title="X"/></ac:parameter></ac:structured-macro>`,
    );
    expect(await deadAnchors(p, world)).toEqual([]);
  });

  it("does not flag anchor-ish targets Confluence generates for layouts or ids", async () => {
    const p = page(`<a href="#sec-2">x</a><div id="sec-2">…</div>`);
    expect(await deadAnchors(p, world)).toEqual([]);
  });
});

describe("T12 — in the v0 check set", () => {
  it("adds exactly the attachment and anchor findings to the runbook", async () => {
    const findings = await runChecks(page(STORAGE_RUNBOOK_LOCAL_REFS), world);
    const dead = findings.filter((f) => f.check === "DEAD_LINK");
    expect(dead.map((f) => f.severity).sort()).toEqual(["high", "low"]);
    expect(findings.filter((f) => f.check !== "DEAD_LINK")).toEqual([]);
  });

  it("reports nothing on the clean page", async () => {
    expect(await runChecks(page(STORAGE_RUNBOOK_LOCAL_REFS_CLEAN), world)).toEqual([]);
  });
});
