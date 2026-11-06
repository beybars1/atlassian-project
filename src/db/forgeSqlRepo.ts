/**
 * Forge SQL implementation of Repo.
 * API surface per @forge/sql 4.x: sql.prepare(query).bindParams(...).execute(), migrationRunner.enqueue/run.
 * Verify against the package README on first deploy — this file is the one most likely to need edits.
 */
import sql, { migrationRunner } from "@forge/sql";
import type { Finding } from "../checks/types";
import type { Repo, ScannedPage, ScanRun } from "./repo";

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
] as const;

export async function migrate(): Promise<void> {
  for (const [name, ddl] of SCHEMA) migrationRunner.enqueue(name, ddl);
  await migrationRunner.run();
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

  async upsertPage(p: ScannedPage) {
    await sql
      .prepare(
        `INSERT INTO pages (page_id, space_id, title, version, owner_id, last_modified, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), version = VALUES(version), owner_id = VALUES(owner_id),
           last_modified = VALUES(last_modified), scanned_at = VALUES(scanned_at)`,
      )
      .bindParams(p.pageId, p.spaceId, p.title, p.version, p.ownerId ?? null, dt(p.lastModified), dt(p.scannedAt))
      .execute();
  }

  async replaceFindings(pageId: string, findings: Finding[]) {
    await sql.prepare("DELETE FROM findings WHERE page_id = ? AND status = 'open'").bindParams(pageId).execute();
    const now = dt(new Date().toISOString());
    for (const f of findings) {
      await sql
        .prepare(
          "INSERT INTO findings (page_id, check_code, severity, evidence, suggestion, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)",
        )
        .bindParams(pageId, f.check, f.severity, f.evidence, f.suggestion, now)
        .execute();
    }
  }

  async openFindings(spaceId: string, limit: number) {
    const rows = await sql
      .prepare<{
        page_id: string; space_id: string; title: string; version: number; owner_id: string | null;
        last_modified: string; scanned_at: string; check_code: string; severity: string; evidence: string; suggestion: string;
      }>(
        `SELECT p.page_id, p.space_id, p.title, p.version, p.owner_id, p.last_modified, p.scanned_at,
                f.check_code, f.severity, f.evidence, f.suggestion
         FROM findings f JOIN pages p ON p.page_id = f.page_id
         WHERE p.space_id = ? AND f.status = 'open'`,
      )
      .bindParams(spaceId)
      .execute();
    const byPage = new Map<string, { page: ScannedPage; findings: Finding[]; score: number }>();
    for (const r of rows.rows) {
      const e = byPage.get(r.page_id) ?? {
        page: {
          pageId: r.page_id, spaceId: r.space_id, title: r.title, version: r.version,
          ownerId: r.owner_id ?? undefined, lastModified: r.last_modified, scannedAt: r.scanned_at,
        },
        findings: [],
        score: 0,
      };
      const sev = r.severity as Finding["severity"];
      e.findings.push({ pageId: r.page_id, check: r.check_code as Finding["check"], severity: sev, evidence: r.evidence, suggestion: r.suggestion });
      e.score += { high: 3, medium: 2, low: 1 }[sev];
      byPage.set(r.page_id, e);
    }
    return [...byPage.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ page, findings }) => ({ page, findings }));
  }

  async startRun(run: ScanRun) {
    await sql
      .prepare("INSERT INTO scan_runs (id, space_id, started_at, pages_seen, pages_scanned) VALUES (?, ?, ?, ?, ?)")
      .bindParams(run.id, run.spaceId, dt(run.startedAt), run.pagesSeen, run.pagesScanned)
      .execute();
  }

  async finishRun(id: string, patch: Partial<ScanRun>) {
    await sql
      .prepare("UPDATE scan_runs SET finished_at = ?, pages_seen = COALESCE(?, pages_seen), pages_scanned = COALESCE(?, pages_scanned) WHERE id = ?")
      .bindParams(patch.finishedAt ? dt(patch.finishedAt) : null, patch.pagesSeen ?? null, patch.pagesScanned ?? null, id)
      .execute();
  }
}
