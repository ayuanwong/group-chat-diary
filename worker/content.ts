export interface ContentRuntimeEnv {
  CONTENT_DB: D1Database;
}

interface GroupVersionRow {
  date: string;
  ingest_id: string;
  generated_at: string;
  source_message_count: number;
  accepted_message_count: number;
  signal_count: number;
  participant_count: number;
  chronicle_count: number;
  payload?: string;
  activated_at: string;
}

interface SourceVersionRow {
  source: "issues" | "repos";
  sync_id: string;
  generated_at: string;
  item_count: number;
  payload?: string;
  activated_at: string;
}

function parsePayload(value: string | undefined): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function validArchiveDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

async function activeSource(db: D1Database, source: "issues" | "repos", includePayload: boolean): Promise<SourceVersionRow | null> {
  const payloadColumn = includePayload ? ", v.payload" : "";
  return db.prepare(`
    SELECT v.source, v.sync_id, v.generated_at, v.item_count, a.activated_at${payloadColumn}
    FROM content_active_sources AS a
    JOIN content_source_versions AS v ON v.source = a.source AND v.sync_id = a.sync_id
    WHERE a.source = ?1
    LIMIT 1
  `).bind(source).first<SourceVersionRow>();
}

export async function contentManifest(env: ContentRuntimeEnv): Promise<Record<string, unknown> | null> {
  const [groups, issue, repo] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT v.date, v.ingest_id, v.generated_at, v.source_message_count,
        v.accepted_message_count, v.signal_count, v.participant_count,
        v.chronicle_count, a.activated_at
      FROM content_active_group_days AS a
      JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
      ORDER BY v.date DESC
    `).all<GroupVersionRow>(),
    activeSource(env.CONTENT_DB, "issues", false),
    activeSource(env.CONTENT_DB, "repos", false),
  ]);
  const entries = groups.results ?? [];
  if (!entries.length) return null;
  return {
    version: 2,
    timeZone: "Asia/Shanghai",
    latest: entries[0].date,
    dates: entries.map((entry) => entry.date),
    entries: entries.map((entry) => ({
      date: entry.date,
      generatedAt: entry.generated_at,
      activatedAt: entry.activated_at,
      sourceMessages: Number(entry.source_message_count),
      messages: Number(entry.accepted_message_count),
      signals: Number(entry.signal_count),
      participants: Number(entry.participant_count),
      chronicles: Number(entry.chronicle_count),
    })),
    github: {
      syncId: issue?.sync_id && issue.sync_id === repo?.sync_id ? issue.sync_id : null,
      issues: Number(issue?.item_count ?? 0),
      repos: Number(repo?.item_count ?? 0),
      generatedAt: issue?.generated_at && issue.generated_at === repo?.generated_at
        ? issue.generated_at
        : issue?.generated_at ?? repo?.generated_at ?? null,
      activatedAt: issue?.activated_at && issue.activated_at === repo?.activated_at
        ? issue.activated_at
        : null,
    },
  };
}

export async function contentGroupDay(env: ContentRuntimeEnv, date: string): Promise<unknown | null> {
  if (!validArchiveDate(date)) return null;
  const row = await env.CONTENT_DB.prepare(`
    SELECT v.payload
    FROM content_active_group_days AS a
    JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
    WHERE a.date = ?1
    LIMIT 1
  `).bind(date).first<{ payload: string }>();
  return parsePayload(row?.payload);
}

export async function contentGithubSource(
  env: ContentRuntimeEnv,
  source: "issues" | "repos",
): Promise<unknown | null> {
  const row = await activeSource(env.CONTENT_DB, source, true);
  const inline = parsePayload(row?.payload);
  if (!row || !inline || typeof inline !== "object" || !(inline as { chunked?: boolean }).chunked) return inline;
  const chunks = await env.CONTENT_DB.prepare(`
    SELECT payload FROM content_source_chunks
    WHERE source = ?1 AND sync_id = ?2
    ORDER BY chunk_index
  `).bind(source, row.sync_id).all<{ payload: string }>();
  return parsePayload((chunks.results ?? []).map((chunk) => chunk.payload).join(""));
}

export async function contentStatus(env: ContentRuntimeEnv): Promise<Record<string, unknown>> {
  const manifest = await contentManifest(env);
  return {
    ready: Boolean(manifest),
    storage: "CONTENT_DB",
    manifest,
  };
}
