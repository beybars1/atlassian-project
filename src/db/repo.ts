/**
 * Storage interface + an in-memory implementation for tests.
 * The Forge SQL implementation lives in forgeSqlRepo.ts and is wired in src/index.ts.
 */
import type { Finding, PageType } from "../checks/types";
import type { StoredFact } from "../checks/contradiction";
import type { JiraNameKind, JiraNameRow } from "../checks/jiraRenamed";
import type { Fact } from "../llm/extractFacts";
import { addUsage, emptyUsage, type LlmUsage } from "../llm/cost";

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
  /**
   * Jira project keys cited on the page (prefixes of its issue keys), as of `version` (T19d). The
   * nightly rescans the page when one of them has a rename newer than `scannedAt`. Absent for rows
   * scanned before this column existed — those pages join on their next edit.
   */
  projectKeys?: string[];
}

/** A page that cites Jira projects, with the scan date the nightly compares rename dates against (T19d). */
export interface CitedProjects {
  pageId: string;
  scannedAt: string;
  projectKeys: string[];
}

/** One nightly run of one space (`<date>:<spaceId>`); batches add to it as they finish (T17). */
export interface ScanRun {
  id: string;
  spaceId: string;
  startedAt: string;
  /** When the latest batch finished. Batches are independent, so this is "last activity", not "all done". */
  finishedAt?: string;
  pagesSeen: number;
  pagesScanned: number;
  /** LLM tokens per tier, summed over the run's batches. */
  usage: LlmUsage;
}

/** What one worker batch adds to its run. */
export interface BatchResult {
  pagesScanned: number;
  usage: LlmUsage;
  finishedAt: string;
}

/** `open` = shown on the dashboard; `dismissed` = a human said "not a problem" (T18). */
export type FindingStatus = "open" | "dismissed";

/** A finding as stored: identity for the dashboard's dismiss button plus its status. */
export interface StoredFinding extends Finding {
  id: string;
  status: FindingStatus;
}

export interface FindingsRow {
  page: ScannedPage;
  findings: StoredFinding[];
}

export interface Repo {
  getScannedVersions(spaceId: string): Promise<Map<string, number>>;
  /** Last stored state of one page (version + cached page type); undefined if never scanned. */
  getPage(pageId: string): Promise<ScannedPage | undefined>;
  upsertPage(p: ScannedPage): Promise<void>;
  /** Scanned pages of a space that cite at least one Jira project (T19d). */
  pagesCitingProjects(spaceId: string): Promise<CitedProjects[]>;
  /**
   * Replace everything the scan of `pageId` produced. Findings may target other pages (check 6
   * puts a contradiction on the page judged outdated); they are attributed to `pageId` as their
   * source and replaced with it. A finding identical to one already stored on its page — open or
   * dismissed — is stored once, so a dismissal holds as long as the scan keeps reporting the same
   * finding; a dismissed finding the scan no longer reports is dropped (T18).
   */
  replaceFindings(pageId: string, findings: Finding[]): Promise<void>;
  /** Dismiss or reopen one finding by id; false when there is no such finding. */
  setFindingStatus(id: string, status: FindingStatus): Promise<boolean>;
  /** Pages of a space with their findings of one status, worst pages first. */
  findingsByStatus(spaceId: string, status: FindingStatus, limit: number): Promise<FindingsRow[]>;
  /** Findings of one status on one page, in storage order (byline chip, T19). */
  findingsOfPage(pageId: string, status: FindingStatus): Promise<StoredFinding[]>;
  /** Replace the stored facts of a page (check 6). */
  replaceFacts(pageId: string, facts: Fact[]): Promise<void>;
  /** Stored facts of one page (valid for `ScannedPage.factsVersion`). */
  factsOfPage(pageId: string): Promise<Fact[]>;
  /** Facts of scanned pages in a space for the given (entity, attribute) keys, with page context. */
  factsForKeys(spaceId: string, keys: Array<{ entity: string; attribute: string }>): Promise<StoredFact[]>;
  /** `findingsByStatus(spaceId, "open", limit)`. */
  openFindings(spaceId: string, limit: number): Promise<FindingsRow[]>;
  startRun(run: ScanRun): Promise<void>;
  /** Add a batch's pages and tokens to its run; returns the run as it now stands, undefined if no such run. */
  recordBatch(id: string, result: BatchResult): Promise<ScanRun | undefined>;
  /** Runs of a space, newest first. */
  recentRuns(spaceId: string, limit: number): Promise<ScanRun[]>;
  /** Every name ever seen on a project's components and versions (check 3c, T19a). */
  jiraNames(projectKey: string): Promise<JiraNameRow[]>;
  /** Record a refresh: a row per `(project, kind, id, name)`; `firstSeen` is kept, `lastSeen` becomes `seenAt`. */
  upsertJiraNames(names: JiraNameInput[], seenAt: string): Promise<void>;
}

export interface JiraNameInput {
  projectKey: string;
  kind: JiraNameKind;
  jiraId: string;
  name: string;
}

export class MemoryRepo implements Repo {
  pages = new Map<string, ScannedPage>();
  facts = new Map<string, Fact[]>();
  runs = new Map<string, ScanRun>();
  jiraNameRows: JiraNameRow[] = [];
  /** Stored findings (open and dismissed) with the page whose scan produced them. */
  private rows: Array<{ id: string; source: string; status: FindingStatus; finding: Finding }> = [];
  private nextId = 1;

  /** Open findings per page (view over `rows`). */
  get findings(): Map<string, Finding[]> {
    const m = new Map<string, Finding[]>();
    for (const { finding, status } of this.rows) {
      if (status === "open") m.set(finding.pageId, [...(m.get(finding.pageId) ?? []), finding]);
    }
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
  async pagesCitingProjects(spaceId: string) {
    const out: CitedProjects[] = [];
    for (const p of this.pages.values()) {
      if (p.spaceId === spaceId && p.projectKeys?.length) out.push({ pageId: p.pageId, scannedAt: p.scannedAt, projectKeys: [...p.projectKeys] });
    }
    return out;
  }
  async replaceFindings(pageId: string, findings: Finding[]) {
    const mine = (r: { source: string; finding: Finding }) => r.source === pageId || r.finding.pageId === pageId;
    // Open findings of this scan are recomputed; dismissed ones stay only while the scan still reports them.
    this.rows = this.rows.filter((r) => !mine(r) || (r.status === "dismissed" && findings.some((f) => sameFinding(r.finding, f))));
    for (const finding of findings) {
      const dup = this.rows.some((r) => sameFinding(r.finding, finding));
      if (!dup) this.rows.push({ id: String(this.nextId++), source: pageId, status: "open", finding });
    }
  }
  async setFindingStatus(id: string, status: FindingStatus) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return false;
    r.status = status;
    return true;
  }
  async findingsByStatus(spaceId: string, status: FindingStatus, limit: number) {
    const stored = new Map<string, StoredFinding[]>();
    for (const r of this.rows) {
      if (r.status === status) stored.set(r.finding.pageId, [...(stored.get(r.finding.pageId) ?? []), { ...r.finding, id: r.id, status: r.status }]);
    }
    const rows: Array<FindingsRow & { score: number }> = [];
    for (const p of this.pages.values()) {
      if (p.spaceId !== spaceId) continue;
      const f = stored.get(p.pageId) ?? [];
      if (f.length === 0) continue;
      rows.push({ page: p, findings: f, score: severityScore(f) });
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, limit).map(({ page, findings }) => ({ page, findings }));
  }
  async findingsOfPage(pageId: string, status: FindingStatus) {
    return this.rows.filter((r) => r.status === status && r.finding.pageId === pageId).map((r) => ({ ...r.finding, id: r.id, status: r.status }));
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
    return this.findingsByStatus(spaceId, "open", limit);
  }
  async startRun(run: ScanRun) {
    this.runs.set(run.id, { ...run, usage: { fast: { ...run.usage.fast }, smart: { ...run.usage.smart } } });
  }
  async recordBatch(id: string, result: BatchResult) {
    const r = this.runs.get(id);
    if (!r) return undefined;
    const usage = emptyUsage();
    addUsage(usage, "fast", r.usage.fast);
    addUsage(usage, "smart", r.usage.smart);
    addUsage(usage, "fast", result.usage.fast);
    addUsage(usage, "smart", result.usage.smart);
    const next: ScanRun = { ...r, pagesScanned: r.pagesScanned + result.pagesScanned, finishedAt: result.finishedAt, usage };
    this.runs.set(id, next);
    return { ...next, usage: { fast: { ...usage.fast }, smart: { ...usage.smart } } };
  }
  async recentRuns(spaceId: string, limit: number) {
    return [...this.runs.values()]
      .filter((r) => r.spaceId === spaceId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((r) => ({ ...r, usage: { fast: { ...r.usage.fast }, smart: { ...r.usage.smart } } }));
  }
  async jiraNames(projectKey: string) {
    return this.jiraNameRows.filter((r) => r.projectKey === projectKey).map((r) => ({ ...r }));
  }
  async upsertJiraNames(names: JiraNameInput[], seenAt: string) {
    for (const n of names) {
      const row = this.jiraNameRows.find((r) => r.projectKey === n.projectKey && r.kind === n.kind && r.jiraId === n.jiraId && r.name === n.name);
      if (row) row.lastSeen = seenAt;
      else this.jiraNameRows.push({ ...n, firstSeen: seenAt, lastSeen: seenAt });
    }
  }
}

/**
 * Milliseconds of a stored date. Forge SQL hands DATETIME back without a zone ("2026-11-20 02:00:00",
 * written as UTC by `forgeSqlRepo`), which `Date.parse` would read as local time; ISO strings with a
 * zone parse as they are. NaN when unparsable.
 */
export function storedDateMs(s: string): number {
  const bare = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s);
  return Date.parse(bare ? `${s.replace(" ", "T")}Z` : s);
}

/** Page ranking on the dashboard: worst pages first. */
export function severityScore(findings: Finding[]): number {
  return findings.reduce((s, x) => s + ({ high: 3, medium: 2, low: 1 } as const)[x.severity], 0);
}

export function sameFinding(a: Finding, b: Finding): boolean {
  return (
    a.pageId === b.pageId &&
    a.check === b.check &&
    a.severity === b.severity &&
    a.evidence === b.evidence &&
    a.suggestion === b.suggestion &&
    a.related?.pageId === b.related?.pageId
  );
}
