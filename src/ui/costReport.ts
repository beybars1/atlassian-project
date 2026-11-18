/**
 * Rows for the dashboard's cost table (T17). Pure (no @forge imports) so it is unit-tested; the
 * UI Kit page only renders what comes out of here. Dollars are an estimate from list prices.
 */
import type { ScanRun } from "../db/repo";
import { COST_ALERT, projectedCostUsd, usageCostUsd } from "../llm/cost";

export interface CostRow {
  id: string;
  /** `YYYY-MM-DD` of the run's start. */
  date: string;
  /** "scanned of seen". */
  pages: string;
  haiku: string;
  sonnet: string;
  cost: string;
  /** What a full scan of `COST_ALERT.pages` pages would cost at this run's rate; "—" until a page was scanned. */
  per2000: string;
  overBudget: boolean;
}

export function formatUsd(v: number | undefined): string {
  if (v === undefined) return "—";
  if (v === 0) return "$0.00";
  // Nightly incremental runs cost fractions of a cent; show enough digits for those to be non-zero.
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

const tokens = (n: number) => n.toLocaleString("en-US");

export function costRows(runs: ScanRun[]): CostRow[] {
  return [...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
    .map((r) => {
      const cost = usageCostUsd(r.usage);
      return {
        id: r.id,
        date: r.startedAt.slice(0, 10),
        pages: `${r.pagesScanned} of ${r.pagesSeen}`,
        haiku: `${tokens(r.usage.fast.input)} in / ${tokens(r.usage.fast.output)} out`,
        sonnet: `${tokens(r.usage.smart.input)} in / ${tokens(r.usage.smart.output)} out`,
        cost: formatUsd(cost),
        per2000: formatUsd(projectedCostUsd(r.usage, r.pagesScanned)),
        overBudget: cost > COST_ALERT.usd,
      };
    });
}
