CREATE TABLE IF NOT EXISTS access_allowlist_staging (
  sync_id TEXT NOT NULL,
  github_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sync_id, github_id)
);

CREATE INDEX IF NOT EXISTS idx_access_allowlist_staging_created_at
  ON access_allowlist_staging(created_at);
