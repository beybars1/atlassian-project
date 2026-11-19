/**
 * Byline chip on every page (T19, `confluence:contentBylineItem`): "✓ verified" / "⚠ 2 issues".
 * Pure (no @forge imports) so it is unit-tested; `src/index.ts` wires it to the module's
 * `dynamicProperties` function and to the popup's resolver.
 *
 * Conservative by construction: "verified" is only said about a page the nightly scan has stored and
 * that has no open finding. A page the app has never seen says so, instead of looking clean.
 */
import type { Severity } from "../checks/types";
import type { FindingStatus, Repo, ScannedPage, StoredFinding } from "../db/repo";
import { sortFindings } from "./dashboardRows";
import { findingLabel } from "./findingLabel";

/** The fields of a finding the chip looks at. */
export interface BylineFinding {
  check: string;
  severity: Severity;
  evidence: string;
  related?: { pageId: string; pageTitle: string };
}

export interface BylineSummary {
  state: "unscanned" | "verified" | "issues";
  /** The chip text. Short: the byline is one line of small print under the page title. */
  title: string;
  /** Hover text; the manifest caps a byline tooltip at 255 characters. */
  tooltip: string;
}

/** Everything the popup shows: the stored page, its open findings (worst first) and the chip. */
export interface BylineStatus {
  page?: ScannedPage;
  findings: StoredFinding[];
  summary: BylineSummary;
}

export const TOOLTIP_MAX = 255;
const SEVERITIES: Severity[] = ["high", "medium", "low"];

export function bylineSummary(page: Pick<ScannedPage, "scannedAt" | "version"> | undefined, findings: BylineFinding[]): BylineSummary {
  if (!page) {
    // Neutral chip, not a warning: the item sits on every page of the site, including spaces the
    // admin never asked to scan, so "not scanned" must not look like a finding.
    return { state: "unscanned", title: "WikiVerify", tooltip: "WikiVerify has not scanned this page yet." };
  }
  const date = page.scannedAt.slice(0, 10);
  if (findings.length === 0) {
    return { state: "verified", title: "✓ verified", tooltip: `No open issues. Last checked ${date} (page version ${page.version}).` };
  }
  const n = findings.length;
  const bySeverity = SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, c]) => c > 0)
    .map(([s, c]) => `${c} ${s}`)
    .join(", ");
  const labels = [...new Set(sortFindings(findings).map(findingLabel))];
  const head = `${n} open issue${n === 1 ? "" : "s"} (${bySeverity}): `;
  const tail = ` Last checked ${date}.`;
  return { state: "issues", title: `⚠ ${n} issue${n === 1 ? "" : "s"}`, tooltip: head + fitList(labels, TOOLTIP_MAX - head.length - tail.length) + "." + tail };
}

/** Comma-join as many items as fit in `max` characters; "…" stands for the rest. */
function fitList(items: string[], max: number): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const next = out ? `${out}, ${items[i]}` : items[i];
    const rest = i + 1 < items.length ? ", …" : "";
    if (next.length + rest.length > max) return out ? `${out}, …` : "…";
    out = next;
  }
  return out;
}

/** Status of one page from storage: the chip plus the open findings for the popup. */
export async function bylineStatus(repo: Repo, pageId: string): Promise<BylineStatus> {
  const page = await repo.getPage(pageId);
  const findings = page ? sortFindings(await repo.findingsOfPage(pageId, "open" satisfies FindingStatus)) : [];
  return { page, findings, summary: bylineSummary(page, findings) };
}

/**
 * The content id out of the `dynamicProperties` function's payload. Forge documents it as
 * `extension.content.id`; the nested `context` form is accepted in case the runtime wraps it
 * (to be confirmed on the dev site, T06). Anything but digits is refused — the id goes into SQL.
 */
export function contentIdFromPayload(payload: unknown): string | undefined {
  const p = payload as { extension?: { content?: { id?: unknown } }; context?: { extension?: { content?: { id?: unknown } } } } | null | undefined;
  const raw = p?.extension?.content?.id ?? p?.context?.extension?.content?.id;
  const id = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : undefined;
  return id && /^\d{1,32}$/.test(id) ? id : undefined;
}
