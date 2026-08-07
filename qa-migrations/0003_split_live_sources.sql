CREATE TABLE IF NOT EXISTS qa_group_documents (
  document_key TEXT PRIMARY KEY,
  sync_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'group' CHECK (kind = 'group'),
  source_date TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  occurred_at TEXT NOT NULL,
  sender TEXT,
  title TEXT,
  url TEXT,
  state TEXT,
  category TEXT,
  priority INTEGER,
  is_changelog INTEGER NOT NULL DEFAULT 0 CHECK (is_changelog IN (0, 1)),
  excerpt TEXT,
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_group_sync_position
  ON qa_group_documents(sync_id, position DESC);

CREATE INDEX IF NOT EXISTS idx_qa_group_context
  ON qa_group_documents(sync_id, source_date, position);

CREATE VIRTUAL TABLE IF NOT EXISTS qa_group_fts USING fts5(
  document_key UNINDEXED,
  tokens,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS qa_github_documents (
  document_key TEXT PRIMARY KEY,
  sync_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'repo')),
  source_date TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  occurred_at TEXT NOT NULL,
  sender TEXT,
  title TEXT,
  url TEXT,
  state TEXT,
  category TEXT,
  priority INTEGER,
  is_changelog INTEGER NOT NULL DEFAULT 0 CHECK (is_changelog = 0),
  excerpt TEXT,
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_github_sync_kind_position
  ON qa_github_documents(sync_id, kind, position DESC);

CREATE INDEX IF NOT EXISTS idx_qa_github_date
  ON qa_github_documents(sync_id, kind, source_date DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS qa_github_fts USING fts5(
  document_key UNINDEXED,
  tokens,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS qa_github_snapshots (
  sync_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue_api', 'repo_api')),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sync_id, kind)
);

INSERT OR IGNORE INTO qa_group_documents (
  document_key, sync_id, kind, source_date, position, occurred_at, sender, title,
  url, state, category, priority, is_changelog, excerpt, content
)
SELECT document_key, sync_id, 'group', source_date, position, occurred_at, sender, title,
  url, state, category, priority, is_changelog, excerpt, content
FROM qa_corpus_documents
WHERE kind = 'group';

INSERT OR IGNORE INTO qa_group_fts (document_key, tokens)
SELECT f.document_key, f.tokens
FROM qa_corpus_fts AS f
JOIN qa_corpus_documents AS d ON d.document_key = f.document_key
WHERE d.kind = 'group';

INSERT OR IGNORE INTO qa_github_documents (
  document_key, sync_id, kind, source_date, position, occurred_at, sender, title,
  url, state, category, priority, is_changelog, excerpt, content
)
SELECT document_key, sync_id, 'issue', source_date, position, occurred_at, sender, title,
  url, state, category, priority, 0, excerpt, content
FROM qa_corpus_documents
WHERE kind = 'issue';

INSERT OR IGNORE INTO qa_github_fts (document_key, tokens)
SELECT f.document_key, f.tokens
FROM qa_corpus_fts AS f
JOIN qa_corpus_documents AS d ON d.document_key = f.document_key
WHERE d.kind = 'issue';

INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'active_group_sync_id', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'active_sync_id';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'group_message_count', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'message_count';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'group_date_count_v2', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'group_date_count';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'latest_group_date_v2', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'latest_group_date';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'group_synced_at', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'synced_at';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'active_github_sync_id', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'active_sync_id';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'github_issue_count', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'issue_count';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
VALUES ('github_repo_count', '0', CURRENT_TIMESTAMP);
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'latest_issue_date_v2', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'latest_issue_date';
INSERT OR REPLACE INTO qa_corpus_meta (key, value, updated_at)
SELECT 'github_synced_at', value, CURRENT_TIMESTAMP FROM qa_corpus_meta WHERE key = 'synced_at';
