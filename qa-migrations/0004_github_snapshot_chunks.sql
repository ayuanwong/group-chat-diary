CREATE TABLE IF NOT EXISTS qa_github_snapshot_chunks (
  sync_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue_api', 'repo_api')),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  payload TEXT NOT NULL,
  PRIMARY KEY (sync_id, kind, chunk_index),
  FOREIGN KEY (sync_id, kind) REFERENCES qa_github_snapshots(sync_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_qa_github_snapshot_chunks_version
  ON qa_github_snapshot_chunks(sync_id, kind, chunk_index);
