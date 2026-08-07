CREATE TABLE IF NOT EXISTS content_group_versions (
  date TEXT NOT NULL,
  ingest_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_message_count INTEGER NOT NULL CHECK (source_message_count > 0),
  accepted_message_count INTEGER NOT NULL CHECK (accepted_message_count > 0),
  signal_count INTEGER NOT NULL CHECK (signal_count >= 0),
  participant_count INTEGER NOT NULL CHECK (participant_count > 0),
  chronicle_count INTEGER NOT NULL CHECK (chronicle_count >= 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (date, ingest_id)
);

CREATE TABLE IF NOT EXISTS content_active_group_days (
  date TEXT PRIMARY KEY,
  ingest_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  FOREIGN KEY (date, ingest_id) REFERENCES content_group_versions(date, ingest_id)
);

CREATE TABLE IF NOT EXISTS content_source_versions (
  source TEXT NOT NULL CHECK (source IN ('issues', 'repos')),
  sync_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, sync_id)
);

CREATE TABLE IF NOT EXISTS content_active_sources (
  source TEXT PRIMARY KEY CHECK (source IN ('issues', 'repos')),
  sync_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  FOREIGN KEY (source, sync_id) REFERENCES content_source_versions(source, sync_id)
);

CREATE TABLE IF NOT EXISTS content_repo_first_seen (
  github_id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_sync_runs (
  sync_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('group', 'github')),
  source_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged', 'active', 'failed')),
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_group_versions_created
  ON content_group_versions(date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_source_versions_created
  ON content_source_versions(source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_sync_runs_source_started
  ON content_sync_runs(source, started_at DESC);
