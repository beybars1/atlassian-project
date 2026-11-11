import { describe, expect, it } from "vitest";
import { estimateCostUsd, forgeLlmClient } from "../src/llm/client";
import { extractFacts, findConflicts } from "../src/llm/extractFacts";

function fakeChat(toolArgs: unknown, usage = { input_tokens: 1200, output_tokens: 150 }) {
  const calls: unknown[] = [];
  const chat = async (prompt: unknown) => {
    calls.push(prompt);
    return {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant" as const,
            content: "",
            tool_calls: [{ id: "c1", type: "function" as const, index: 0, function: { name: "record_facts", arguments: toolArgs as object } }],
          },
        },
      ],
      usage,
    };
  };
  const list = async () => ({ models: [{ model: "claude-haiku-4-5", status: "active" }, { model: "claude-sonnet-4-5", status: "active" }] });
  return { chat, list, calls };
}

describe("forgeLlmClient", () => {
  it("forces the tool call, parses arguments and reports usage", async () => {
    const f = fakeChat({ facts: [] });
    const llm = forgeLlmClient(f);
    const r = await llm.callTool<{ facts: unknown[] }>({ tier: "fast", system: "s", user: "u", tool: { name: "record_facts", description: "d", parameters: {} } });
    expect(r.value.facts).toEqual([]);
    expect(r.usage).toEqual({ input: 1200, output: 150 });
    expect(r.model).toBe("claude-haiku-4-5");
    const prompt = f.calls[0] as { tool_choice: unknown; temperature: number };
    expect(prompt.tool_choice).toEqual({ type: "function", function: { name: "record_facts" } });
    expect(prompt.temperature).toBe(0);
  });

  it("parses stringified arguments too", async () => {
    const f = fakeChat(JSON.stringify({ facts: [{ entity: "x", attribute: "y", value: "z", quote: "q" }] }));
    const llm = forgeLlmClient(f);
    const r = await llm.callTool<{ facts: unknown[] }>({ tier: "fast", system: "s", user: "u", tool: { name: "record_facts", description: "d", parameters: {} } });
    expect(r.value.facts).toHaveLength(1);
  });

  it("falls back to defaults when list() fails", async () => {
    const f = fakeChat({ facts: [] });
    const llm = forgeLlmClient({ chat: f.chat, list: async () => { throw new Error("nope"); } });
    const r = await llm.callTool({ tier: "smart", system: "s", user: "u", tool: { name: "t", description: "d", parameters: {} } });
    expect(r.model).toBe("claude-sonnet-4-5");
  });

  it("estimates cost from list prices", () => {
    expect(estimateCostUsd("fast", { input: 1_000_000, output: 0 })).toBe(1);
    expect(estimateCostUsd("smart", { input: 0, output: 1_000_000 })).toBe(15);
  });
});

describe("extractFacts + findConflicts", () => {
  it("drops facts without a quote and normalizes keys", async () => {
    const f = fakeChat({
      facts: [
        { entity: "The Payments Service", attribute: "Owner", value: "Platform team", quote: "Owner: platform team." },
        { entity: "payments service", attribute: "port", value: "8080" }, // no quote → dropped
      ],
    });
    const { facts } = await extractFacts(forgeLlmClient(f), { id: "1", title: "t", text: "Owner: platform team." });
    expect(facts).toEqual([{ entity: "payments-service", attribute: "owner", value: "Platform team", quote: "Owner: platform team." }]);
  });

  it("finds disagreements across pages and ignores agreement", () => {
    const conflicts = findConflicts([
      { pageId: "a", entity: "payments-service", attribute: "owner", value: "Platform team", quote: "q1" },
      { pageId: "b", entity: "payments-service", attribute: "owner", value: "Core team", quote: "q2" },
      { pageId: "a", entity: "payments-service", attribute: "port", value: "8080", quote: "q3" },
      { pageId: "b", entity: "payments-service", attribute: "port", value: "8080.", quote: "q4" }, // same after canon
      { pageId: "a", entity: "x", attribute: "y", value: "1", quote: "q5" },
      { pageId: "a", entity: "x", attribute: "y", value: "2", quote: "q6" }, // same page → not a cross-page conflict
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ entity: "payments-service", attribute: "owner" });
    expect(conflicts[0].claims.map((c) => c.pageId).sort()).toEqual(["a", "b"]);
  });
});
