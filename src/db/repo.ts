/**
 * Storage interface + an in-memory implementation for tests.
 * The Forge SQL implementation lives in forgeSqlRepo.ts and is wired in src/index.ts.
 */
import type { Finding } from "../checks/types";

export interface ScannedPage {
  pageId: string;
  spaceId: string;
  title: string;
  version: number;
  ownerId?: string;
  lastModified: string;
  scannedAt: string;
}

export interface ScanRun {
  id: string;
  spaceId: string;
  startedAt: string;
  finishedAt?: string;
  pagesSeen: number;
  pagesScanned: number;
}

export interface Repo {
  getScannedVersions(spaceId: string): Promise<Map<string, number>>;
  upsertPage(p: ScannedPage): Promise<void>;
  replaceFindings(pageId: string, findings: Finding[]): Promise<void>;
  openFindings(spaceId: string, limit: number): Promise<Array<{ page: ScannedPage; findings: Finding[] }>>;
  startRun(run: ScanRun): Promise<void>;
  finishRun(id: string, patch: Partial<ScanRun>): Promise<void>;
}

export class MemoryRepo implements Repo {
  pages = new Map<string, ScannedPage>();
  findings = new Map<string, Finding[]>();
  runs = new Map<string, ScanRun>();

  async getScannedVersions(spaceId: string) {
    const m = new Map<string, number>();
    for (const p of this.pages.values()) if (p.spaceId === spaceId) m.set(p.pageId, p.version);
    return m;
  }
  async upsertPage(p: ScannedPage) {
    this.pages.set(p.pageId, p);
  }
  async replaceFindings(pageId: string, findings: Finding[]) {
    this.findings.set(pageId, findings);
  }
  async openFindings(spaceId: string, limit: number) {
    const rows: Array<{ page: ScannedPage; findings: Finding[]; score: number }> = [];
    for (const p of this.pages.values()) {
      if (p.spaceId !== spaceId) continue;
      const f = this.findings.get(p.pageId) ?? [];
      if (f.length === 0) continue;
      const score = f.reduce((s, x) => s + ({ high: 3, medium: 2, low: 1 } as const)[x.severity], 0);
      rows.push({ page: p, findings: f, score });
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, limit).map(({ page, findings }) => ({ page, findings }));
  }
  async startRun(run: ScanRun) {
    this.runs.set(run.id, run);
  }
  async finishRun(id: string, patch: Partial<ScanRun>) {
    const r = this.runs.get(id);
    if (r) this.runs.set(id, { ...r, ...patch });
  }
}
