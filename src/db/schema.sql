-- WikiVerify — Forge SQL schema (MySQL dialect). Applied by migrationRunner in forgeSqlRepo.ts.

CREATE TABLE IF NOT EXISTS pages (
  page_id       VARCHAR(32)  NOT NULL PRIMARY KEY,
  space_id      VARCHAR(32)  NOT NULL,
  title         VARCHAR(512) NOT NULL,
  version       INT          NOT NULL,
  owner_id      VARCHAR(128) NULL,
  last_modified DATETIME     NOT NULL,
  scanned_at    DATETIME     NOT NULL,
  page_type     VARCHAR(16)  NULL,       -- v002 (T15): check 5 classification, valid for `version`
  facts_version INT          NULL,       -- v003 (T16): page version whose facts are in `facts`
  INDEX idx_pages_space (space_id)
);

CREATE TABLE IF NOT EXISTS findings (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  page_id     VARCHAR(32)  NOT NULL,
  check_code  VARCHAR(32)  NOT NULL,
  severity    VARCHAR(8)   NOT NULL,
  evidence    TEXT         NOT NULL,
  suggestion  TEXT         NOT NULL,
  status      VARCHAR(16)  NOT NULL DEFAULT 'open',  -- 'open' | 'dismissed' (T18: a dismissed row survives rescans that reproduce the same finding)
  created_at  DATETIME     NOT NULL,
  source_page_id VARCHAR(32) NULL,       -- v003 (T16): page whose scan produced the finding (check 6 may target another page)
  related_page_id    VARCHAR(32)  NULL,  -- v004 (T16a): the other page of a two-page finding (check 6: the page with the current value)
  related_page_title VARCHAR(512) NULL,  -- v004 (T16a): its title at the time, for the dashboard label
  INDEX idx_findings_page (page_id),
  INDEX idx_findings_status (status),
  INDEX idx_findings_source (source_page_id)
);

-- v003 (T16): facts Haiku extracted per page, keyed by (entity, attribute) for cross-page comparison.
CREATE TABLE IF NOT EXISTS facts (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  page_id      VARCHAR(32)  NOT NULL,
  entity       VARCHAR(255) NOT NULL,
  attribute    VARCHAR(255) NOT NULL,
  value        TEXT         NOT NULL,
  quote        TEXT         NOT NULL,
  issue_keys   VARCHAR(255) NULL,        -- v004 (T16a): Jira keys cited next to the claim, comma-separated
  extracted_at DATETIME     NOT NULL,
  INDEX idx_facts_page (page_id),
  INDEX idx_facts_key (entity, attribute)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id            VARCHAR(64) NOT NULL PRIMARY KEY,
  space_id      VARCHAR(32) NOT NULL,
  started_at    DATETIME    NOT NULL,
  finished_at   DATETIME    NULL,
  pages_seen    INT         NOT NULL DEFAULT 0,
  pages_scanned INT         NOT NULL DEFAULT 0,  -- summed over the run's batches
  fast_in       BIGINT      NOT NULL DEFAULT 0,  -- v005 (T17): Haiku tokens (classification + extraction)
  fast_out      BIGINT      NOT NULL DEFAULT 0,
  smart_in      BIGINT      NOT NULL DEFAULT 0,  -- v005 (T17): Sonnet tokens (adjudication)
  smart_out     BIGINT      NOT NULL DEFAULT 0,
  INDEX idx_scan_runs_space (space_id, started_at)
);
