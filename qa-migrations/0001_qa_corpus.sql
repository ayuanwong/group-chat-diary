CREATE TABLE IF NOT EXISTS qa_corpus_documents (
  document_key TEXT PRIMARY KEY,
  sync_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('group', 'issue')),
  source_date TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  occurred_at TEXT NOT NULL,
  sender TEXT,
  title TEXT,
  url TEXT,
  state TEXT,
  category TEXT,
  priority INTEGER,
  excerpt TEXT,
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_corpus_documents_sync_kind_position
  ON qa_corpus_documents(sync_id, kind, position DESC);

CREATE INDEX IF NOT EXISTS idx_qa_corpus_documents_group_context
  ON qa_corpus_documents(sync_id, kind, source_date, position);

CREATE VIRTUAL TABLE IF NOT EXISTS qa_corpus_fts USING fts5(
  document_key UNINDEXED,
  tokens,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS qa_corpus_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qa_rate_limits (
  github_id INTEGER PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
