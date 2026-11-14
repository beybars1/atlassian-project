/**
 * Async-events consumer: scans one batch of pages and stores findings.
 */
import { runChecks, V0_CHECKS } from "../checks";
import { makeStaleByType, type StaleThresholds } from "../checks/staleByType";
import type { Clients, PageType } from "../checks/types";
import type { Repo } from "../db/repo";
import { fetchPage } from "../forge/confluencePages";
import { classifyPageType } from "../llm/classifyPage";
import type { LlmClient } from "../llm/client";
import type { ScanBatchEvent } from "../scan/orchestrate";

export interface ScanDeps {
  /** Haiku classifier for check 5. Without it, only labels / titles decide the page type. */
  llm?: LlmClient;
  /** Admin thresholds for check 5; defaults from code when absent. */
  staleThresholds?: StaleThresholds;
}

export async function scanBatch(event: ScanBatchEvent, repo: Repo, clients: Clients, deps: ScanDeps = {}): Promise<number> {
  const checks = [...V0_CHECKS, makeStaleByType(deps.staleThresholds)];
  const tokens = { input: 0, output: 0 };
  let scanned = 0;
  for (const pageId of event.pageIds) {
    try {
      const page = await fetchPage(pageId, event.spaceKey);
      page.pageType = await resolvePageType(page, repo, deps.llm, tokens);
      const findings = await runChecks(page, clients, checks);
      await repo.upsertPage({
        pageId: page.id,
        spaceId: page.spaceId,
        title: page.title,
        version: page.version,
        ownerId: page.ownerId,
        lastModified: page.lastModified,
        scannedAt: clients.now().toISOString(),
        pageType: page.pageType,
      });
      await repo.replaceFindings(page.id, findings);
      scanned += 1;
    } catch (err) {
      console.error(`scan ${pageId} failed`, err);
    }
  }
  if (tokens.input || tokens.output) console.log(`batch llm tokens in=${tokens.input} out=${tokens.output}`);
  await repo.finishRun(`${event.runId}:${event.spaceId}`, { finishedAt: clients.now().toISOString(), pagesScanned: scanned });
  return scanned;
}

/**
 * Page type for check 5: reuse the cached classification when the version is unchanged, otherwise
 * classify (labels → title → Haiku). A classifier failure logs and leaves the type unknown, so the
 * page is still scanned by the other checks and check 5 stays silent for it.
 */
async function resolvePageType(
  page: { id: string; title: string; text: string; labels: string[]; version: number },
  repo: Repo,
  llm: LlmClient | undefined,
  tokens: { input: number; output: number },
): Promise<PageType | undefined> {
  const prev = await repo.getPage(page.id);
  if (prev?.pageType && prev.version === page.version) return prev.pageType;
  try {
    const c = await classifyPageType(llm, page);
    tokens.input += c.usage.input;
    tokens.output += c.usage.output;
    return c.type;
  } catch (err) {
    console.warn(`classify ${page.id} failed`, err);
    return undefined;
  }
}
