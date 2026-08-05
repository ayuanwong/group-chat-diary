CREATE TABLE IF NOT EXISTS access_allowlist (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_allowlist_active
  ON access_allowlist(active);

CREATE TABLE IF NOT EXISTS access_sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
