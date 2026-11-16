/**
 * Storage interface + an in-memory implementation for tests.
 * The Forge SQL implementation lives in forgeSqlRepo.ts and is wired in src/index.ts.
 */
import type { Finding, PageType } from "../checks/types";
import type { StoredFact } from "../checks/contradiction";
import type { Fact } from "../llm/extractFacts";

export interface ScannedPage {
  pageId: string;
  spaceId: string;
  title: string;
  version: number;
  ownerId?: string;
  lastModified: string;
  scannedAt: string;
  /** Check 5 classification, valid for `version` only (T15). */
  pageType?: PageType;
  /** Page version whose facts are stored (check 6, T16); absent when extraction has not run or failed. */
  factsVersion?: number;
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
  /** Last stored state of one page (version + cached page type); undefined if never scanned. */
  getPage(pageId: string): Promise<ScannedPage | undefined>;
  upsertPage(p: ScannedPage): Promise<void>;
  /**
   * Replace everything the scan of `pageId` produced. Findings may target other pages (check 6
   * puts a contradiction on the page judged outdated); they are attributed to `pageId` as their
   * source and replaced with it. A finding identical to one already open on its page is stored once.
   */
  replaceFindings(pageId: string, findings: Finding[]): Promise<void>;
  /** Replace the stored facts of a page (check 6). */
  replaceFacts(pageId: string, facts: Fact[]): Promise<void>;
  /** Stored facts of one page (valid for `ScannedPage.factsVersion`). */
  factsOfPage(pageId: string): Promise<Fact[]>;
  /** Facts of scanned pages in a space for the given (entity, attribute) keys, with page context. */
  factsForKeys(spaceId: string, keys: Array<{ entity: string; attribute: string }>): Promise<StoredFact[]>;
  openFindings(spaceId: string, limit: number): Promise<Array<{ page: ScannedPage; findings: Finding[] }>>;
  startRun(run: ScanRun): Promise<void>;
  finishRun(id: string, patch: Partial<ScanRun>): Promise<void>;
}

export class MemoryRepo implements Repo {
  pages = new Map<string, ScannedPage>();
  facts = new Map<string, Fact[]>();
  runs = new Map<string, ScanRun>();
  /** Open findings with the page whose scan produced them. */
  private rows: Array<{ source: string; finding: Finding }> = [];

  /** Open findings per page (view over `rows`). */
  get findings(): Map<string, Finding[]> {
    const m = new Map<string, Finding[]>();
    for (const { finding } of this.rows) m.set(finding.pageId, [...(m.get(finding.pageId) ?? []), finding]);
    return m;
  }

  async getScannedVersions(spaceId: string) {
    const m = new Map<string, number>();
    for (const p of this.pages.values()) if (p.spaceId === spaceId) m.set(p.pageId, p.version);
    return m;
  }
  async getPage(pageId: string) {
    return this.pages.get(pageId);
  }
  async upsertPage(p: ScannedPage) {
    this.pages.set(p.pageId, p);
  }
  async replaceFindings(pageId: string, findings: Finding[]) {
    this.rows = this.rows.filter((r) => r.source !== pageId && r.finding.pageId !== pageId);
    for (const finding of findings) {
      const dup = this.rows.some((r) => sameFinding(r.finding, finding));
      if (!dup) this.rows.push({ source: pageId, finding });
    }
  }
  async replaceFacts(pageId: string, facts: Fact[]) {
    this.facts.set(pageId, facts);
  }
  async factsOfPage(pageId: string) {
    return this.facts.get(pageId) ?? [];
  }
  async factsForKeys(spaceId: string, keys: Array<{ entity: string; attribute: string }>) {
    const wanted = new Set(keys.map((k) => `${k.entity}\u0000${k.attribute}`));
    const out: StoredFact[] = [];
    for (const [pageId, facts] of this.facts) {
      const page = this.pages.get(pageId);
      if (!page || page.spaceId !== spaceId) continue;
      for (const f of facts) {
        if (wanted.has(`${f.entity}\u0000${f.attribute}`)) out.push({ ...f, pageId, pageTitle: page.title, pageLastModified: page.lastModified });
      }
    }
    return out;
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

export function sameFinding(a: Finding, b: Finding): boolean {
  return a.pageId === b.pageId && a.check === b.check && a.severity === b.severity && a.evidence === b.evidence && a.suggestion === b.suggestion;
}
