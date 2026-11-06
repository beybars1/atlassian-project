/**
 * Async-events consumer: scans one batch of pages and stores findings.
 */
import { runChecks } from "../checks";
import type { Clients } from "../checks/types";
import type { Repo } from "../db/repo";
import { fetchPage } from "../forge/confluencePages";
import type { ScanBatchEvent } from "../scan/orchestrate";

export async function scanBatch(event: ScanBatchEvent, repo: Repo, clients: Clients): Promise<number> {
  let scanned = 0;
  for (const pageId of event.pageIds) {
    try {
      const page = await fetchPage(pageId, event.spaceKey);
      const findings = await runChecks(page, clients);
      await repo.upsertPage({
        pageId: page.id,
        spaceId: page.spaceId,
        title: page.title,
        version: page.version,
        ownerId: page.ownerId,
        lastModified: page.lastModified,
        scannedAt: clients.now().toISOString(),
      });
      await repo.replaceFindings(page.id, findings);
      scanned += 1;
    } catch (err) {
      console.error(`scan ${pageId} failed`, err);
    }
  }
  await repo.finishRun(`${event.runId}:${event.spaceId}`, { finishedAt: clients.now().toISOString(), pagesScanned: scanned });
  return scanned;
}
