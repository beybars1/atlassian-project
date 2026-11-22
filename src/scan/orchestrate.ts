/**
 * Pure orchestration logic: decide which pages need scanning and split them into batches.
 * Kept free of Forge imports so it is unit-testable.
 */
import type { PageHead } from "../forge/confluencePages";

export const BATCH_SIZE = 20;

export function pagesToScan(heads: PageHead[], scannedVersions: Map<string, number>): PageHead[] {
  return heads.filter((h) => scannedVersions.get(h.id) !== h.version);
}

/**
 * T19d: add the pages marked for a rescan (a cited Jira project was renamed since their scan) to the
 * version diff's result. Only pages that still exist are added, each once.
 */
export function addRescans(heads: PageHead[], todo: PageHead[], rescanIds: string[]): PageHead[] {
  if (rescanIds.length === 0) return todo;
  const wanted = new Set(rescanIds);
  const queued = new Set(todo.map((h) => h.id));
  return [...todo, ...heads.filter((h) => wanted.has(h.id) && !queued.has(h.id))];
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ScanBatchEvent {
  runId: string;
  spaceId: string;
  spaceKey?: string;
  pageIds: string[];
}
