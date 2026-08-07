CREATE TABLE IF NOT EXISTS content_source_chunks (
  source TEXT NOT NULL CHECK (source IN ('issues', 'repos')),
  sync_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  payload TEXT NOT NULL,
  PRIMARY KEY (source, sync_id, chunk_index),
  FOREIGN KEY (source, sync_id) REFERENCES content_source_versions(source, sync_id)
);

CREATE INDEX IF NOT EXISTS idx_content_source_chunks_version
  ON content_source_chunks(source, sync_id, chunk_index);
