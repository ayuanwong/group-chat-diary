CREATE TABLE IF NOT EXISTS content_active_live_group (
  scope TEXT PRIMARY KEY CHECK (scope = 'chronicle'),
  date TEXT NOT NULL,
  ingest_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  FOREIGN KEY (date, ingest_id) REFERENCES content_group_versions(date, ingest_id)
);
