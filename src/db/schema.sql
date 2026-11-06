-- WikiVerify — Forge SQL schema (MySQL dialect). Applied by migrationRunner in forgeSqlRepo.ts.

CREATE TABLE IF NOT EXISTS pages (
  page_id       VARCHAR(32)  NOT NULL PRIMARY KEY,
  space_id      VARCHAR(32)  NOT NULL,
  title         VARCHAR(512) NOT NULL,
  version       INT          NOT NULL,
  owner_id      VARCHAR(128) NULL,
  last_modified DATETIME     NOT NULL,
  scanned_at    DATETIME     NOT NULL,
  INDEX idx_pages_space (space_id)
);

CREATE TABLE IF NOT EXISTS findings (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  page_id     VARCHAR(32)  NOT NULL,
  check_code  VARCHAR(32)  NOT NULL,
  severity    VARCHAR(8)   NOT NULL,
  evidence    TEXT         NOT NULL,
  suggestion  TEXT         NOT NULL,
  status      VARCHAR(16)  NOT NULL DEFAULT 'open',
  created_at  DATETIME     NOT NULL,
  INDEX idx_findings_page (page_id),
  INDEX idx_findings_status (status)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id            VARCHAR(64) NOT NULL PRIMARY KEY,
  space_id      VARCHAR(32) NOT NULL,
  started_at    DATETIME    NOT NULL,
  finished_at   DATETIME    NULL,
  pages_seen    INT         NOT NULL DEFAULT 0,
  pages_scanned INT         NOT NULL DEFAULT 0
);
