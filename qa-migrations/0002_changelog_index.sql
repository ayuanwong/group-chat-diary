ALTER TABLE qa_corpus_documents
  ADD COLUMN is_changelog INTEGER NOT NULL DEFAULT 0 CHECK (is_changelog IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_qa_corpus_documents_changelog
  ON qa_corpus_documents(sync_id, kind, is_changelog, position DESC);
