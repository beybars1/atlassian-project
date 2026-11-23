/**
 * Scheduled trigger (daily). Lists pages in every configured space, diffs against the last scan,
 * adds pages whose cited Jira project was renamed since their scan (T19d), and enqueues batches for
 * the worker. Must be idempotent: Forge may invoke a trigger twice.
 */
import { Queue } from "@forge/events";
import { kvs } from "@forge/kvs";
import type { Clients } from "../checks/types";
import { listPageHeads } from "../forge/confluencePages";
import { addRescans, batches, pagesToScan, type ScanBatchEvent } from "../scan/orchestrate";
import { renameRescanPageIds } from "../scan/renameRescan";
import type { Repo } from "../db/repo";
import { emptyUsage } from "../llm/cost";

export interface SpaceConfig {
  spaceId: string;
  spaceKey?: string;
}

const queue = new Queue({ key: "scan-batch" });

export async function runNightly(repo: Repo, clients: Clients): Promise<{ spaces: number; batches: number; pages: number; rescans: number }> {
  const spaces = ((await kvs.get("config.spaces")) as SpaceConfig[] | undefined) ?? [];
  const runId = new Date().toISOString().slice(0, 10); // one run per day per install → dedupes double-fires
  let totalBatches = 0;
  let totalPages = 0;
  let totalRescans = 0;

  for (const s of spaces) {
    const heads = await listPageHeads(s.spaceId);
    const scanned = await repo.getScannedVersions(s.spaceId);
    const changed = pagesToScan(heads, scanned);
    // Pages nobody edited since a rename in a Jira project they cite (T19d). Never throws; empty on any Jira trouble.
    const rescanIds = await renameRescanPageIds(repo, clients, s.spaceId);
    const todo = addRescans(heads, changed, rescanIds);
    const rescans = todo.length - changed.length;
    if (rescans > 0) console.log(`space ${s.spaceId}: ${rescans} page(s) rescanned after a Jira rename`);
    totalRescans += rescans;
    await repo.startRun({
      id: `${runId}:${s.spaceId}`,
      spaceId: s.spaceId,
      startedAt: new Date().toISOString(),
      pagesSeen: heads.length,
      pagesScanned: 0,
      usage: emptyUsage(),
    });
    for (const b of batches(todo)) {
      const event: ScanBatchEvent = { runId, spaceId: s.spaceId, spaceKey: s.spaceKey, pageIds: b.map((p) => p.id) };
      await queue.push({ body: event as unknown as Record<string, unknown> });
      totalBatches += 1;
      totalPages += b.length;
    }
  }
  return { spaces: spaces.length, batches: totalBatches, pages: totalPages, rescans: totalRescans };
}
