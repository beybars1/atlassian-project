/**
 * T16a — check 6 follow-ups: Jira evidence for the adjudicator, chunked extraction of long pages,
 * and a dashboard label that names the other page.
 */
import { describe, expect, it } from "vitest";
import type { Finding, IssueInfo } from "../src/checks/types";
import { MAX_ISSUES_PER_CLAIM, contradictionFindings } from "../src/checks/contradiction";
import { MemoryRepo, sameFinding } from "../src/db/repo";
import { ADJUDICATE_TOOL, adjudicateConflict, type Conflict, type Verdict } from "../src/llm/adjudicate";
import type { LlmClient } from "../src/llm/client";
import { FACT_TOOL, MAX_CHUNKS_PER_PAGE, MAX_FACTS_PER_PAGE, MAX_PAGE_CHARS, chunkText, extractFacts, issueKeysNear, type Fact } from "../src/llm/extractFacts";
import { parseStorage } from "../src/text/storageToText";
import { findingLabel } from "../src/ui/findingLabel";
import { STORAGE_CONTRADICTION_RUNBOOK } from "./fixtures/pages";

const RUNBOOK = { id: "10", title: "Payments service runbook", lastModified: "2026-11-10T00:00:00Z" };
const ONBOARDING = { id: "11", title: "Payments team onboarding", lastModified: "2026-06-01T00:00:00Z" };

function fakeLlm(answers: Record<string, unknown | ((user: string) => unknown)>, usage = { input: 700, output: 60 }) {
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

describe("extractFacts — chunking of long pages", () => {
  it("chunkText splits at paragraph boundaries and never exceeds the limit", () => {
    const para = (i: number) => `Paragraph ${i}. ${"x".repeat(900)}`;
    const text = Array.from({ length: 60 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text, MAX_PAGE_CHARS);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toBe(text); // nothing lost, nothing duplicated
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
      expect(c.startsWith("Paragraph")).toBe(true); // cut between paragraphs, not inside one
    }
    expect(chunkText("short", MAX_PAGE_CHARS)).toEqual(["short"]);
    // A single paragraph longer than the limit is hard-split rather than dropped.
    const huge = "y".repeat(MAX_PAGE_CHARS * 2 + 10);
    const hard = chunkText(huge, MAX_PAGE_CHARS);
    expect(hard.join("")).toBe(huge);
    expect(Math.max(...hard.map((c) => c.length))).toBeLessThanOrEqual(MAX_PAGE_CHARS);
  });

  it("calls Haiku once per chunk, merges and dedupes the facts, sums usage", async () => {
    const text = Array.from({ length: 3 }, (_, i) => `Part ${i}. ${"z".repeat(MAX_PAGE_CHARS - 100)}`).join("\n\n");
    const f = fakeLlm({
      record_facts: (user: string) => ({
        facts: [
          { entity: "svc", attribute: "owner", value: "team a", quote: "owner team a" }, // repeated in every chunk
          { entity: "svc", attribute: "port", value: user.includes("Part 0") ? "1" : user.includes("Part 1") ? "2" : "3", quote: "port" },
        ],
      }),
    });
    const r = await extractFacts(f.llm, { id: "1", title: "Long", text });
    expect(f.calls).toHaveLength(3);
    for (const [i, c] of f.calls.entries()) {
      expect(c.toolName).toBe(FACT_TOOL.name);
      expect(c.user).toContain("Page title: Long");
      expect(c.user).toContain(`part ${i + 1} of 3`);
      expect(c.user).toContain(`Part ${i}.`);
      expect(c.user).not.toContain("[truncated]");
    }
    expect(r.usage).toEqual({ input: 2100, output: 180 });
    expect(r.facts.filter((x) => x.attribute === "owner")).toHaveLength(1);
    expect(r.facts.filter((x) => x.attribute === "port").map((x) => x.value)).toEqual(["1", "2", "3"]);
  });

  it("stops after MAX_CHUNKS_PER_PAGE and still caps facts per page", async () => {
    const text = Array.from({ length: MAX_CHUNKS_PER_PAGE + 3 }, (_, i) => `Part ${i}. ${"z".repeat(MAX_PAGE_CHARS - 100)}`).join("\n\n");
    const perChunk = Math.ceil(MAX_FACTS_PER_PAGE / MAX_CHUNKS_PER_PAGE) + 1; // the cap is hit on the last chunk
    const some = Array.from({ length: perChunk }, (_, i) => ({ entity: `e${i}`, attribute: "a", value: "v", quote: "q" }));
    const f = fakeLlm({ record_facts: (user: string) => ({ facts: some.map((m) => ({ ...m, entity: `${m.entity}-${user.match(/part (\d+)/)?.[1]}` })) }) });
    const r = await extractFacts(f.llm, { id: "1", title: "Long", text });
    expect(f.calls).toHaveLength(MAX_CHUNKS_PER_PAGE);
    expect(r.facts).toHaveLength(MAX_FACTS_PER_PAGE);

    // Once the cap is full, later chunks are not sent to Haiku at all.
    const full = Array.from({ length: MAX_FACTS_PER_PAGE }, (_, i) => ({ entity: `e${i}`, attribute: "a", value: "v", quote: "q" }));
    const g = fakeLlm({ record_facts: { facts: full } });
    await extractFacts(g.llm, { id: "1", title: "Long", text });
    expect(g.calls).toHaveLength(1);
  });

  it("a short page is one call without a part marker (unchanged behaviour)", async () => {
    const f = fakeLlm({ record_facts: { facts: [] } });
    await extractFacts(f.llm, { id: "1", title: "Short", text: "Owner: platform team." });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].user).not.toContain("part 1 of");
  });
});

describe("extractFacts — Jira keys next to a claim", () => {
  const page = parseStorage(STORAGE_CONTRADICTION_RUNBOOK);

  it("issueKeysNear finds keys in the quote or in the same neighbourhood of the page text, only known ones", () => {
    expect(page.issueKeys).toContain("PAY-42");
    // The quote itself has no key; the key sits right after it on the page.
    expect(issueKeysNear(page.text, "The database listens on port 5433 since the Postgres upgrade", page.issueKeys)).toEqual(["PAY-42"]);
    // A key inside the quote counts even when the quote is not found verbatim on the page.
    expect(issueKeysNear(page.text, "See PAY-42 for the port change", page.issueKeys)).toEqual(["PAY-42"]);
    // Far away on the page → not next to the claim.
    expect(issueKeysNear(page.text, "Owner: platform team", page.issueKeys)).toEqual([]);
    // Unknown keys (not on the page / not real projects) are ignored; "ISO-9001" is not an issue.
    expect(issueKeysNear("quality per ISO-9001 and ABC-1", "quality per ISO-9001 and ABC-1", ["ABC-1"])).toEqual(["ABC-1"]);
    expect(issueKeysNear("", "nothing here", [])).toEqual([]);
  });

  it("extractFacts attaches the keys to each fact and omits the field when there are none", async () => {
    const f = fakeLlm({
      record_facts: {
        facts: [
          { entity: "payments-service", attribute: "database-port", value: "5433", quote: "The database listens on port 5433 since the Postgres upgrade" },
          { entity: "payments-service", attribute: "owner", value: "platform team", quote: "Owner: platform team." },
        ],
      },
    });
    const r = await extractFacts(f.llm, { id: RUNBOOK.id, title: RUNBOOK.title, text: page.text, issueKeys: page.issueKeys });
    expect(r.facts[0].issueKeys).toEqual(["PAY-42"]);
    expect(r.facts[1].issueKeys).toBeUndefined();
  });
});

describe("adjudicateConflict — Jira evidence in the prompt", () => {
  const conflict: Conflict = {
    entity: "payments-service",
    attribute: "database-port",
    claims: [
      {
        pageId: RUNBOOK.id, pageTitle: RUNBOOK.title, pageLastModified: RUNBOOK.lastModified,
        value: "5433", quote: "The database listens on port 5433 since the Postgres upgrade",
        jira: [{ key: "PAY-42", exists: true, status: "Done", resolved: true, fixVersions: ["2.3"] }],
      },
      { pageId: ONBOARDING.id, pageTitle: ONBOARDING.title, pageLastModified: ONBOARDING.lastModified, value: "5432", quote: "The database is reachable on port 5432." },
    ],
  };

  it("lists each claim's issues with status and fix version; claims without evidence get no Jira line", async () => {
    const f = fakeLlm({ judge_conflict: { outdated_page_id: ONBOARDING.id, confidence: "high", reason: "PAY-42 is done." } });
    const v = await adjudicateConflict(f.llm, conflict);
    expect(v.outdatedPageId).toBe(ONBOARDING.id);
    const user = f.calls[0].user;
    expect(user).toContain("PAY-42");
    expect(user).toContain("Done");
    expect(user).toContain("resolved");
    expect(user).toContain("2.3");
    expect(f.calls[0].system.toLowerCase()).toContain("jira");
    // one Jira line only (the onboarding claim has none)
    expect(user.split("\n").filter((l) => l.includes("jira:"))).toHaveLength(1);
  });

  it("describes open and missing issues plainly", async () => {
    const f = fakeLlm({ judge_conflict: { outdated_page_id: "unknown", confidence: "low", reason: "" } });
    await adjudicateConflict(f.llm, {
      ...conflict,
      claims: [
        { ...conflict.claims[0], jira: [{ key: "PAY-42", exists: true, status: "In Progress", resolved: false }] },
        { ...conflict.claims[1], jira: [{ key: "PAY-7", exists: false }] },
      ],
    });
    const user = f.calls[0].user;
    expect(user).toContain('PAY-42 — status "In Progress" (open)');
    expect(user).toContain("PAY-7 — not found in Jira");
  });
});

describe("contradictionFindings — Jira evidence and the related page", () => {
  const RUNBOOK_FACTS: Fact[] = [
    { entity: "payments-service", attribute: "database-port", value: "5433", quote: "The database listens on port 5433 since the Postgres upgrade", issueKeys: ["PAY-42"] },
  ];
  const ONBOARDING_FACTS: Fact[] = [
    { entity: "payments-service", attribute: "database-port", value: "5432", quote: "The database is reachable on port 5432." },
  ];
  const stored = (page: typeof RUNBOOK, facts: Fact[]) =>
    facts.map((f) => ({ ...f, pageId: page.id, pageTitle: page.title, pageLastModified: page.lastModified }));
  const issues: Record<string, IssueInfo> = {
    "PAY-42": { key: "PAY-42", exists: true, statusName: "Done", statusCategory: "done", resolved: true, fixVersions: ["2.3"] },
  };

  it("looks up the issues next to each claim and hands them to the adjudicator; the finding names the other page", async () => {
    const seen: Conflict[] = [];
    const looked: string[] = [];
    const adjudicate = async (c: Conflict): Promise<Verdict> => {
      seen.push(c);
      return { outdatedPageId: ONBOARDING.id, confidence: "high", reason: "PAY-42 is done.", usage: { input: 1, output: 1 }, model: "f" };
    };
    const r = await contradictionFindings({
      page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: stored(ONBOARDING, ONBOARDING_FACTS), adjudicate,
      jira: async (key) => { looked.push(key); return issues[key] ?? { key, exists: false }; },
    });
    expect(looked).toEqual(["PAY-42"]);
    expect(seen[0].claims.find((k) => k.pageId === RUNBOOK.id)?.jira).toEqual([{ key: "PAY-42", exists: true, status: "Done", resolved: true, fixVersions: ["2.3"] }]);
    expect(seen[0].claims.find((k) => k.pageId === ONBOARDING.id)?.jira).toBeUndefined();
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.pageId).toBe(ONBOARDING.id);
    expect(f.related).toEqual({ pageId: RUNBOOK.id, pageTitle: RUNBOOK.title });
    expect(f.evidence).toContain("PAY-42");
    expect(f.evidence).toContain("Done");
  });

  it("works without a Jira client and survives a failing lookup", async () => {
    const seen: Conflict[] = [];
    const adjudicate = async (c: Conflict): Promise<Verdict> => {
      seen.push(c);
      return { outdatedPageId: ONBOARDING.id, confidence: "high", reason: "r", usage: { input: 1, output: 1 }, model: "f" };
    };
    const none = await contradictionFindings({ page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: stored(ONBOARDING, ONBOARDING_FACTS), adjudicate });
    expect(none.findings).toHaveLength(1);
    expect(seen[0].claims.every((k) => k.jira === undefined)).toBe(true);

    const broken = await contradictionFindings({
      page: RUNBOOK, pageFacts: RUNBOOK_FACTS, otherFacts: stored(ONBOARDING, ONBOARDING_FACTS), adjudicate,
      jira: async () => { throw new Error("jira down"); },
    });
    expect(broken.findings).toHaveLength(1);
    expect(seen[1].claims.every((k) => k.jira === undefined)).toBe(true);
  });

  it("caps the issues looked up per claim", async () => {
    const keys = Array.from({ length: MAX_ISSUES_PER_CLAIM + 4 }, (_, i) => `PAY-${i + 1}`);
    const looked: string[] = [];
    await contradictionFindings({
      page: RUNBOOK, pageFacts: [{ ...RUNBOOK_FACTS[0], issueKeys: keys }], otherFacts: stored(ONBOARDING, ONBOARDING_FACTS),
      adjudicate: async () => ({ confidence: "low", reason: "", usage: { input: 0, output: 0 }, model: "f" }),
      jira: async (key) => { looked.push(key); return { key, exists: true }; },
    });
    expect(looked).toHaveLength(MAX_ISSUES_PER_CLAIM);
  });

  it("the related page is the one the finding is not on, whichever side is outdated", async () => {
    const r = await contradictionFindings({
      page: ONBOARDING, pageFacts: ONBOARDING_FACTS, otherFacts: stored(RUNBOOK, RUNBOOK_FACTS),
      adjudicate: async () => ({ outdatedPageId: ONBOARDING.id, confidence: "high", reason: "r", usage: { input: 0, output: 0 }, model: "f" }),
    });
    expect(r.findings[0]).toMatchObject({ pageId: ONBOARDING.id, related: { pageId: RUNBOOK.id, pageTitle: RUNBOOK.title } });
  });
});

describe("dashboard label and storage of the related page", () => {
  const cross: Finding = {
    pageId: "11", check: "CONTRADICTION", severity: "medium", evidence: "e", suggestion: "s",
    related: { pageId: "10", pageTitle: "Payments service runbook" },
  };

  it("findingLabel names the other page for contradictions and is the check code otherwise", () => {
    expect(findingLabel(cross)).toBe("CONTRADICTION vs “Payments service runbook”");
    expect(findingLabel({ ...cross, related: undefined })).toBe("CONTRADICTION");
    const dead: Finding = { pageId: "1", check: "DEAD_LINK", severity: "low", evidence: "e", suggestion: "s" };
    expect(findingLabel(dead)).toBe("DEAD_LINK");
  });

  it("MemoryRepo keeps `related` on findings and tells findings apart by it", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "11", spaceId: "100", title: "b", version: 1, lastModified: "2026-01-01", scannedAt: "2026-01-02" });
    await repo.replaceFindings("10", [cross]);
    expect(repo.findings.get("11")?.[0].related).toEqual(cross.related);
    expect((await repo.openFindings("100", 10))[0].findings[0].related).toEqual(cross.related);
    expect(sameFinding(cross, { ...cross })).toBe(true);
    expect(sameFinding(cross, { ...cross, related: { pageId: "12", pageTitle: "other" } })).toBe(false);
  });

  it("MemoryRepo keeps issue keys on stored facts", async () => {
    const repo = new MemoryRepo();
    await repo.upsertPage({ pageId: "10", spaceId: "100", title: "a", version: 1, lastModified: "2026-01-01", scannedAt: "2026-01-02" });
    await repo.replaceFacts("10", [{ entity: "e", attribute: "a", value: "v", quote: "q", issueKeys: ["PAY-1"] }]);
    expect((await repo.factsForKeys("100", [{ entity: "e", attribute: "a" }]))[0].issueKeys).toEqual(["PAY-1"]);
  });
});
