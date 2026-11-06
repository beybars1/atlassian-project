/**
 * Scheduled trigger (daily). Lists pages in every configured space, diffs against the last scan,
 * and enqueues batches for the worker. Must be idempotent: Forge may invoke a trigger twice.
 */
import { Queue } from "@forge/events";
import { kvs } from "@forge/kvs";
import { listPageHeads } from "../forge/confluencePages";
import { batches, pagesToScan, type ScanBatchEvent } from "../scan/orchestrate";
import type { Repo } from "../db/repo";

export interface SpaceConfig {
  spaceId: string;
  spaceKey?: string;
}

const queue = new Queue({ key: "scan-batch" });

export async function runNightly(repo: Repo): Promise<{ spaces: number; batches: number; pages: number }> {
  const spaces = ((await kvs.get("config.spaces")) as SpaceConfig[] | undefined) ?? [];
  const runId = new Date().toISOString().slice(0, 10); // one run per day per install → dedupes double-fires
  let totalBatches = 0;
  let totalPages = 0;

  for (const s of spaces) {
    const heads = await listPageHeads(s.spaceId);
    const scanned = await repo.getScannedVersions(s.spaceId);
    const todo = pagesToScan(heads, scanned);
    await repo.startRun({
      id: `${runId}:${s.spaceId}`,
      spaceId: s.spaceId,
      startedAt: new Date().toISOString(),
      pagesSeen: heads.length,
      pagesScanned: 0,
    });
    for (const b of batches(todo)) {
      const event: ScanBatchEvent = { runId, spaceId: s.spaceId, spaceKey: s.spaceKey, pageIds: b.map((p) => p.id) };
      await queue.push({ body: event as unknown as Record<string, unknown> });
      totalBatches += 1;
      totalPages += b.length;
    }
  }
  return { spaces: spaces.length, batches: totalBatches, pages: totalPages };
}
