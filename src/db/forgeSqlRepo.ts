/**
 * Forge SQL implementation of Repo.
 * API surface per @forge/sql 4.x: sql.prepare(query).bindParams(...).execute(), migrationRunner.enqueue/run.
 * Verify against the package README on first deploy — this file is the one most likely to need edits.
 */
import sql, { migrationRunner, type UpdateQueryResponse } from "@forge/sql";
import type { Finding, PageType } from "../checks/types";
import type { StoredFact } from "../checks/contradiction";
import type { Fact } from "../llm/extractFacts";
import { sameFinding, severityScore, type BatchResult, type FindingStatus, type Repo, type ScannedPage, type ScanRun, type StoredFinding } from "./repo";

const SCHEMA = [
  [
    "v001_pages",
    `CREATE TABLE IF NOT EXISTS pages (page_id VARCHAR(32) NOT NULL PRIMARY KEY, space_id VARCHAR(32) NOT NULL, title VARCHAR(512) NOT NULL, version INT NOT NULL, owner_id VARCHAR(128) NULL, last_modified DATETIME NOT NULL, scanned_at DATETIME NOT NULL, INDEX idx_pages_space (space_id))`,
  ],
  [
    "v001_findings",
    `CREATE TABLE IF NOT EXISTS findings (id BIGINT AUTO_INCREMENT PRIMARY KEY, page_id VARCHAR(32) NOT NULL, check_code VARCHAR(32) NOT NULL, severity VARCHAR(8) NOT NULL, evidence TEXT NOT NULL, suggestion TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'open', created_at DATETIME NOT NULL, INDEX idx_findings_page (page_id), INDEX idx_findings_status (status))`,
  ],
  [
    "v001_scan_runs",
    `CREATE TABLE IF NOT EXISTS scan_runs (id VARCHAR(64) NOT NULL PRIMARY KEY, space_id VARCHAR(32) NOT NULL, started_at DATETIME NOT NULL, finished_at DATETIME NULL, pages_seen INT NOT NULL DEFAULT 0, pages_scanned INT NOT NULL DEFAULT 0)`,
  ],
  // T15: cached page type for check 5. A migration runs once per name, so v001 stays untouched.
  ["v002_pages_page_type", `ALTER TABLE pages ADD COLUMN page_type VARCHAR(16) NULL`],
  // T16: check 6. Facts per page version; findings remember which page's scan produced them so a
  // contradiction placed on another page is refreshed when its source is rescanned.
  ["v003_pages_facts_version", `ALTER TABLE pages ADD COLUMN facts_version INT NULL`],
  ["v003_findings_source", `ALTER TABLE findings ADD COLUMN source_page_id VARCHAR(32) NULL, ADD INDEX idx_findings_source (source_page_id)`],
  [
    "v003_facts",
    `CREATE TABLE IF NOT EXISTS facts (id BIGINT AUTO_INCREMENT PRIMARY KEY, page_id VARCHAR(32) NOT NULL, entity VARCHAR(255) NOT NULL, attribute VARCHAR(255) NOT NULL, value TEXT NOT NULL, quote TEXT NOT NULL, extracted_at DATETIME NOT NULL, INDEX idx_facts_page (page_id), INDEX idx_facts_key (entity, attribute))`,
  ],
  // T16a: issue keys cited next to a fact (Jira evidence for adjudication) and the other page of a
  // two-page finding (dashboard label "CONTRADICTION vs <title>").
  ["v004_facts_issue_keys", `ALTER TABLE facts ADD COLUMN issue_keys VARCHAR(255) NULL`],
  ["v004_findings_related", `ALTER TABLE findings ADD COLUMN related_page_id VARCHAR(32) NULL, ADD COLUMN related_page_title VARCHAR(512) NULL`],
  // T17: LLM tokens per run, one pair of counters per model tier (priced at read time, see src/llm/cost.ts).
  [
    "v005_scan_runs_tokens",
    `ALTER TABLE scan_runs ADD COLUMN fast_in BIGINT NOT NULL DEFAULT 0, ADD COLUMN fast_out BIGINT NOT NULL DEFAULT 0, ADD COLUMN smart_in BIGINT NOT NULL DEFAULT 0, ADD COLUMN smart_out BIGINT NOT NULL DEFAULT 0, ADD INDEX idx_scan_runs_space (space_id, started_at)`,
  ],
] as const;

/** `issue_keys` column ↔ `Fact.issueKeys` (comma-separated; keys never contain commas). */
const packKeys = (keys?: string[]) => (keys?.length ? keys.join(",").slice(0, 255) : null);
const unpackKeys = (col: string | null): string[] | undefined => (col ? col.split(",").filter(Boolean) : undefined);
const related = (id: string | null, title: string | null): Finding["related"] => (id ? { pageId: id, pageTitle: title ?? "" } : undefined);

export async function migrate(): Promise<void> {
  for (const [name, ddl] of SCHEMA) migrationRunner.enqueue(name, ddl);
  await migrationRunner.run();
}

function withKeys<T extends Fact>(f: T, col: string | null): T {
  const keys = unpackKeys(col);
  return keys ? { ...f, issueKeys: keys } : f;
}

const dt = (iso: string) => iso.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", "");

export class ForgeSqlRepo implements Repo {
  async getScannedVersions(spaceId: string) {
    const rows = await sql
      .prepare<{ page_id: string; version: number }>("SELECT page_id, version FROM pages WHERE space_id = ?")
      .bindParams(spaceId)
      .execute();
    return new Map(rows.rows.map((r) => [r.page_id, r.version]));
  }

  async getPage(pageId: string) {
    const rows = await sql
      .prepare<{
        page_id: string; space_id: string; title: string; version: number; owner_id: string | null;
        last_modified: string; scanned_at: string; page_type: string | null; facts_version: number | null;
      }>("SELECT page_id, space_id, title, version, owner_id, last_modified, scanned_at, page_type, facts_version FROM pages WHERE page_id = ?")
      .bindParams(pageId)
      .execute();
    const r = rows.rows[0];
    if (!r) return undefined;
    return {
      pageId: r.page_id, spaceId: r.space_id, title: r.title, version: r.version, ownerId: r.owner_id ?? undefined,
      lastModified: r.last_modified, scannedAt: r.scanned_at, pageType: (r.page_type as PageType | null) ?? undefined,
      factsVersion: r.facts_version ?? undefined,
    };
  }

  async upsertPage(p: ScannedPage) {
    await sql
      .prepare(
        `INSERT INTO pages (page_id, space_id, title, version, owner_id, last_modified, scanned_at, page_type, facts_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), version = VALUES(version), owner_id = VALUES(owner_id),
           last_modified = VALUES(last_modified), scanned_at = VALUES(scanned_at), page_type = VALUES(page_type),
           facts_version = VALUES(facts_version)`,
      )
      .bindParams(p.pageId, p.spaceId, p.title, p.version, p.ownerId ?? null, dt(p.lastModified), dt(p.scannedAt), p.pageType ?? null, p.factsVersion ?? null)
      .execute();
  }

  async replaceFindings(pageId: string, findings: Finding[]) {
    await sql
      .prepare("DELETE FROM findings WHERE status = 'open' AND (page_id = ? OR source_page_id = ?)")
      .bindParams(pageId, pageId)
      .execute();
    // Dismissed findings of this scan stay only while the scan still reports them (T18): the
    // dismissal was about one specific finding, and a page that was fixed must not keep a ghost row.
    const dismissed = await sql
      .prepare<{ id: number; page_id: string; check_code: string; severity: string; evidence: string; suggestion: string; related_page_id: string | null }>(
        "SELECT id, page_id, check_code, severity, evidence, suggestion, related_page_id FROM findings WHERE status = 'dismissed' AND (page_id = ? OR source_page_id = ?)",
      )
      .bindParams(pageId, pageId)
      .execute();
    for (const d of dismissed.rows) {
      const stored: Finding = {
        pageId: d.page_id, check: d.check_code as Finding["check"], severity: d.severity as Finding["severity"],
        evidence: d.evidence, suggestion: d.suggestion, ...(d.related_page_id ? { related: { pageId: d.related_page_id, pageTitle: "" } } : {}),
      };
      if (!findings.some((f) => sameFinding(stored, f))) await sql.prepare("DELETE FROM findings WHERE id = ?").bindParams(d.id).execute();
    }
    const now = dt(new Date().toISOString());
    for (const f of findings) {
      // Same finding already stored on its page — open (both sides of a contradiction scanned
      // tonight) or dismissed (a human said so) → keep the one row.
      const dup = await sql
        .prepare<{ id: number }>(
          "SELECT id FROM findings WHERE page_id = ? AND check_code = ? AND severity = ? AND evidence = ? AND suggestion = ? AND (related_page_id <=> ?) AND status IN ('open', 'dismissed') LIMIT 1",
        )
        .bindParams(f.pageId, f.check, f.severity, f.evidence, f.suggestion, f.related?.pageId ?? null)
        .execute();
      if (dup.rows.length > 0) continue;
      await sql
        .prepare(
          "INSERT INTO findings (page_id, source_page_id, check_code, severity, evidence, suggestion, related_page_id, related_page_title, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
        )
        .bindParams(f.pageId, pageId, f.check, f.severity, f.evidence, f.suggestion, f.related?.pageId ?? null, f.related?.pageTitle.slice(0, 512) ?? null, now)
        .execute();
    }
  }

  async replaceFacts(pageId: string, facts: Fact[]) {
    await sql.prepare("DELETE FROM facts WHERE page_id = ?").bindParams(pageId).execute();
    const now = dt(new Date().toISOString());
    for (const f of facts) {
      await sql
        .prepare("INSERT INTO facts (page_id, entity, attribute, value, quote, issue_keys, extracted_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bindParams(pageId, f.entity.slice(0, 255), f.attribute.slice(0, 255), f.value, f.quote, packKeys(f.issueKeys), now)
        .execute();
    }
  }

  async factsOfPage(pageId: string) {
    const rows = await sql
      .prepare<{ entity: string; attribute: string; value: string; quote: string; issue_keys: string | null }>(
        "SELECT entity, attribute, value, quote, issue_keys FROM facts WHERE page_id = ?",
      )
      .bindParams(pageId)
      .execute();
    return rows.rows.map((r): Fact => withKeys({ entity: r.entity, attribute: r.attribute, value: r.value, quote: r.quote }, r.issue_keys));
  }

  async factsForKeys(spaceId: string, keys: Array<{ entity: string; attribute: string }>) {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => "(f.entity = ? AND f.attribute = ?)").join(" OR ");
    const rows = await sql
      .prepare<{ page_id: string; title: string; last_modified: string; entity: string; attribute: string; value: string; quote: string; issue_keys: string | null }>(
        `SELECT f.page_id, p.title, p.last_modified, f.entity, f.attribute, f.value, f.quote, f.issue_keys
         FROM facts f JOIN pages p ON p.page_id = f.page_id
         WHERE p.space_id = ? AND (${placeholders})`,
      )
      .bindParams(spaceId, ...keys.flatMap((k) => [k.entity, k.attribute]))
      .execute();
    return rows.rows.map(
      (r): StoredFact =>
        withKeys(
          { pageId: r.page_id, pageTitle: r.title, pageLastModified: r.last_modified, entity: r.entity, attribute: r.attribute, value: r.value, quote: r.quote },
          r.issue_keys,
        ),
    );
  }

  async openFindings(spaceId: string, limit: number) {
    return this.findingsByStatus(spaceId, "open", limit);
  }

  async setFindingStatus(id: string, status: FindingStatus) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return false;
    const r = await sql.prepare<UpdateQueryResponse>("UPDATE findings SET status = ? WHERE id = ?").bindParams(status, n).execute();
    return r.rows.affectedRows > 0;
  }

  async findingsByStatus(spaceId: string, status: FindingStatus, limit: number) {
    const rows = await sql
      .prepare<{
        id: number; page_id: string; space_id: string; title: string; version: number; owner_id: string | null;
        last_modified: string; scanned_at: string; check_code: string; severity: string; evidence: string; suggestion: string;
        related_page_id: string | null; related_page_title: string | null;
      }>(
        `SELECT f.id, p.page_id, p.space_id, p.title, p.version, p.owner_id, p.last_modified, p.scanned_at,
                f.check_code, f.severity, f.evidence, f.suggestion, f.related_page_id, f.related_page_title
         FROM findings f JOIN pages p ON p.page_id = f.page_id
         WHERE p.space_id = ? AND f.status = ?
         ORDER BY f.id`,
      )
      .bindParams(spaceId, status)
      .execute();
    const byPage = new Map<string, { page: ScannedPage; findings: StoredFinding[] }>();
    for (const r of rows.rows) {
      const e = byPage.get(r.page_id) ?? {
        page: {
          pageId: r.page_id, spaceId: r.space_id, title: r.title, version: r.version,
          ownerId: r.owner_id ?? undefined, lastModified: r.last_modified, scannedAt: r.scanned_at,
        },
        findings: [],
      };
      const rel = related(r.related_page_id, r.related_page_title);
      e.findings.push({
        id: String(r.id), status, pageId: r.page_id, check: r.check_code as Finding["check"], severity: r.severity as Finding["severity"],
        evidence: r.evidence, suggestion: r.suggestion, ...(rel ? { related: rel } : {}),
      });
      byPage.set(r.page_id, e);
    }
    return [...byPage.values()]
      .map((e) => ({ ...e, score: severityScore(e.findings) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ page, findings }) => ({ page, findings }));
  }

  async findingsOfPage(pageId: string, status: FindingStatus) {
    const rows = await sql
      .prepare<{ id: number; check_code: string; severity: string; evidence: string; suggestion: string; related_page_id: string | null; related_page_title: string | null }>(
        "SELECT id, check_code, severity, evidence, suggestion, related_page_id, related_page_title FROM findings WHERE page_id = ? AND status = ? ORDER BY id",
      )
      .bindParams(pageId, status)
      .execute();
    return rows.rows.map((r): StoredFinding => {
      const rel = related(r.related_page_id, r.related_page_title);
      return {
        id: String(r.id), status, pageId, check: r.check_code as Finding["check"], severity: r.severity as Finding["severity"],
        evidence: r.evidence, suggestion: r.suggestion, ...(rel ? { related: rel } : {}),
      };
    });
  }

  async startRun(run: ScanRun) {
    await sql
      .prepare("INSERT INTO scan_runs (id, space_id, started_at, pages_seen, pages_scanned, fast_in, fast_out, smart_in, smart_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bindParams(run.id, run.spaceId, dt(run.startedAt), run.pagesSeen, run.pagesScanned, run.usage.fast.input, run.usage.fast.output, run.usage.smart.input, run.usage.smart.output)
      .execute();
  }

  async recordBatch(id: string, r: BatchResult) {
    // Batches of one run finish in any order, possibly at the same time: increment in SQL, never read-modify-write.
    await sql
      .prepare(
        `UPDATE scan_runs SET finished_at = ?, pages_scanned = pages_scanned + ?,
           fast_in = fast_in + ?, fast_out = fast_out + ?, smart_in = smart_in + ?, smart_out = smart_out + ?
         WHERE id = ?`,
      )
      .bindParams(dt(r.finishedAt), r.pagesScanned, r.usage.fast.input, r.usage.fast.output, r.usage.smart.input, r.usage.smart.output, id)
      .execute();
    const rows = await sql.prepare<RunRow>(`${SELECT_RUN} WHERE id = ?`).bindParams(id).execute();
    return rows.rows[0] ? toRun(rows.rows[0]) : undefined;
  }

  async recentRuns(spaceId: string, limit: number) {
    const rows = await sql
      .prepare<RunRow>(`${SELECT_RUN} WHERE space_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`)
      .bindParams(spaceId, limit)
      .execute();
    return rows.rows.map(toRun);
  }
}

type RunRow = {
  id: string; space_id: string; started_at: string; finished_at: string | null; pages_seen: number; pages_scanned: number;
  fast_in: number; fast_out: number; smart_in: number; smart_out: number;
};
const SELECT_RUN = "SELECT id, space_id, started_at, finished_at, pages_seen, pages_scanned, fast_in, fast_out, smart_in, smart_out FROM scan_runs";
const toRun = (r: RunRow): ScanRun => ({
  id: r.id, spaceId: r.space_id, startedAt: r.started_at, finishedAt: r.finished_at ?? undefined,
  pagesSeen: r.pages_seen, pagesScanned: r.pages_scanned,
  // BIGINT may come back as a string depending on the driver; Number() keeps the arithmetic honest.
  usage: { fast: { input: Number(r.fast_in), output: Number(r.fast_out) }, smart: { input: Number(r.smart_in), output: Number(r.smart_out) } },
});
