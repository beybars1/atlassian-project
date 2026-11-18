/**
 * Token accounting per scan run (T17). Pure: tokens are summed per model tier and priced at the
 * list prices in client.ts when read, so a price change never needs a migration. Haiku and Sonnet
 * are kept apart because one Sonnet token costs 3× a Haiku one — a single total would hide which
 * check is driving the bill.
 */
import { estimateCostUsd } from "./client";

export type Tier = "fast" | "smart";
export interface TierUsage {
  input: number;
  output: number;
}
export interface LlmUsage {
  /** Haiku: classification (check 5) and fact extraction (check 6). */
  fast: TierUsage;
  /** Sonnet: contradiction adjudication (check 6). */
  smart: TierUsage;
}

export const emptyUsage = (): LlmUsage => ({ fast: { input: 0, output: 0 }, smart: { input: 0, output: 0 } });

export function addUsage(into: LlmUsage, tier: Tier, u: TierUsage): void {
  into[tier].input += u.input;
  into[tier].output += u.output;
}

export function usageCostUsd(u: LlmUsage): number {
  return estimateCostUsd("fast", u.fast) + estimateCostUsd("smart", u.smart);
}

/** Budget from PLAN §5: a full scan of a 2,000-page space should stay under $10. */
export const COST_ALERT = { pages: 2000, usd: 10 } as const;

/** What a scan of `pages` pages would cost at this run's rate; undefined when nothing was scanned yet. */
export function projectedCostUsd(u: LlmUsage, pagesScanned: number, pages: number = COST_ALERT.pages): number | undefined {
  if (pagesScanned <= 0) return undefined;
  return (usageCostUsd(u) / pagesScanned) * pages;
}

/**
 * Alert text when a run has cost more than the budget. With `batch` (the usage this batch added),
 * only the batch that crossed the line alerts, so a run over budget warns once, not per batch.
 * The per-page projection is deliberately not an alert: a 10-page incremental night that happens
 * to hit long pages projects wildly and would cry wolf.
 */
export function costAlert(run: { id: string; pagesScanned: number; usage: LlmUsage }, batch?: LlmUsage): string | undefined {
  const total = usageCostUsd(run.usage);
  if (total <= COST_ALERT.usd) return undefined;
  if (batch && total - usageCostUsd(batch) > COST_ALERT.usd) return undefined;
  return `cost alert: scan run ${run.id} has cost $${total.toFixed(2)} for ${run.pagesScanned} pages, over the $${COST_ALERT.usd} budget for ${COST_ALERT.pages} pages`;
}
