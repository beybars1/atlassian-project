/**
 * Pure orchestration logic: decide which pages need scanning and split them into batches.
 * Kept free of Forge imports so it is unit-testable.
 */
import type { PageHead } from "../forge/confluencePages";

export const BATCH_SIZE = 20;

export function pagesToScan(heads: PageHead[], scannedVersions: Map<string, number>): PageHead[] {
  return heads.filter((h) => scannedVersions.get(h.id) !== h.version);
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
