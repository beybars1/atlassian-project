import { describe, expect, it } from "vitest";
import { parseStorage, classifyHref } from "../src/text/storageToText";
import { STORAGE_RUNBOOK_WITH_FAULTS } from "./fixtures/pages";

describe("parseStorage", () => {
  const parsed = parseStorage(STORAGE_RUNBOOK_WITH_FAULTS);

  it("extracts readable text without tags", () => {
    expect(parsed.text).toContain("Payments service runbook");
    expect(parsed.text).not.toContain("<");
  });

  it("finds jira macro keys and plain-text keys", () => {
    expect(parsed.issueKeys).toEqual(expect.arrayContaining(["PAY-101", "PAY-202", "PAY-303", "ISO-9001"]));
  });

  it("classifies internal page links by title and id, jira links, and external links", () => {
    expect(parsed.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pageTitle: "Old deploy guide", spaceKey: "OPS", external: false }),
        expect.objectContaining({ pageId: "999999", spaceKey: "OPS", external: false }),
        expect.objectContaining({ issueKey: "PAY-303", external: false }),
        expect.objectContaining({ href: "https://example.com/external", external: true }),
      ]),
    );
  });
});

describe("classifyHref", () => {
  it("treats same-site absolute URLs as internal", () => {
    const l = classifyHref("https://acme.atlassian.net/wiki/spaces/OPS/pages/42/Title", "https://acme.atlassian.net");
    expect(l).toMatchObject({ pageId: "42", spaceKey: "OPS", external: false });
  });
  it("treats other hosts as external", () => {
    expect(classifyHref("https://github.com/x", "https://acme.atlassian.net").external).toBe(true);
  });
});
