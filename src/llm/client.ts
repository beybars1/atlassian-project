/**
 * Thin wrapper over @forge/llm. Everything LLM-related goes through `LlmClient` so checks are
 * testable with a fake and token usage is logged in one place.
 *
 * Model ids: Forge LLMs exposes Claude families; exact ids come from `list()` at runtime.
 * Defaults below are the documented Nov-2026 names; `resolveModels()` corrects them on first use.
 */
import type { Prompt, ChatResponse, ToolSchema, Message } from "@forge/llm";

export interface LlmCallResult<T> {
  value: T;
  usage: { input: number; output: number };
  model: string;
}

export interface LlmClient {
  /** Force a tool call and return its parsed arguments. */
  callTool<T>(args: {
    tier: "fast" | "smart";
    system: string;
    user: string;
    tool: { name: string; description: string; parameters: Record<string, unknown> };
    maxOutputTokens?: number;
  }): Promise<LlmCallResult<T>>;
}

export const MODEL_DEFAULTS = {
  fast: "claude-haiku-4-5",
  smart: "claude-sonnet-4-5",
} as const;

/** Approximate list price, USD per 1M tokens (Forge LLMs pricing page, Nov 2026). Used for the cost report only. */
export const PRICE_PER_M = {
  fast: { input: 1, output: 5 },
  smart: { input: 3, output: 15 },
} as const;

export function estimateCostUsd(tier: "fast" | "smart", usage: { input: number; output: number }): number {
  const p = PRICE_PER_M[tier];
  return (usage.input * p.input + usage.output * p.output) / 1_000_000;
}

type ChatFn = (prompt: Prompt) => Promise<ChatResponse>;
type ListFn = () => Promise<{ models: Array<{ model: string; status: string }> }>;

/** Production client. `chat`/`list` are injected so this file has no top-level Forge import (tests load it). */
export function forgeLlmClient(deps: { chat: ChatFn; list: ListFn; log?: (line: string) => void }): LlmClient {
  let models: Record<"fast" | "smart", string> | undefined;

  async function resolveModels() {
    if (models) return models;
    try {
      const { models: available } = await deps.list();
      const active = available.filter((m) => m.status === "active").map((m) => m.model);
      const pick = (want: string, fallbackRe: RegExp) =>
        active.find((m) => m === want) ?? active.filter((m) => fallbackRe.test(m)).sort().reverse()[0] ?? want;
      models = {
        fast: pick(MODEL_DEFAULTS.fast, /haiku/i),
        smart: pick(MODEL_DEFAULTS.smart, /sonnet/i),
      };
    } catch {
      models = { ...MODEL_DEFAULTS };
    }
    return models;
  }

  return {
    async callTool({ tier, system, user, tool, maxOutputTokens = 2048 }) {
      const m = await resolveModels();
      const model = m[tier];
      const tools: ToolSchema[] = [{ type: "function", function: tool }];
      const messages: Message[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const res = await deps.chat({
        model,
        messages,
        tools,
        tool_choice: { type: "function", function: { name: tool.name } },
        temperature: 0,
        max_completion_tokens: maxOutputTokens,
      });
      const call = res.choices[0]?.message.tool_calls?.[0];
      if (!call) throw new Error(`LLM returned no tool call (finish_reason=${res.choices[0]?.finish_reason})`);
      const args = call.function.arguments as unknown;
      const value = (typeof args === "string" ? JSON.parse(args) : args) as never;
      const usage = { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 };
      deps.log?.(`llm ${tier}/${model} in=${usage.input} out=${usage.output} $${estimateCostUsd(tier, usage).toFixed(5)}`);
      return { value, usage, model };
    },
  };
}
