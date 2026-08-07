const GITHUB_API_VERSION = "2026-03-10";
const REFRESH_TTL_MS = 60_000;
const REFRESH_LOCK_SECONDS = 30;
const REFRESH_ERROR_COOLDOWN_MS = 30_000;
const MEMBER_PAGE_SIZE = 100;
const MAX_MEMBER_PAGES = 50;
const STAGING_BATCH_SIZE = 75;

export type GitHubFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AllowlistEnv {
  ACCESS_DB: D1Database;
  GITHUB_ORG: string;
  GITHUB_ORG_READ_TOKEN: string;
}

export interface AllowlistPageState {
  status: "ready" | "syncing" | "stale" | "error";
}

interface AccessMetaRow {
  key: string;
  value: string;
}

interface GitHubMember {
  id?: number;
  login?: string;
}

interface AllowlistMeta {
  lastSyncAt: string | null;
  lockUntil: number;
  errorAt: string | null;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readMeta(env: AllowlistEnv): Promise<AllowlistMeta> {
  const result = await env.ACCESS_DB.prepare(`
    SELECT key, value
    FROM access_sync_meta
    WHERE key IN ('last_sync_at', 'allowlist_refresh_lock_until', 'allowlist_refresh_error_at')
  `).all<AccessMetaRow>();
  const values = new Map((result.results ?? []).map((row) => [row.key, row.value]));
  return {
    lastSyncAt: values.get("last_sync_at") ?? null,
    lockUntil: Number(values.get("allowlist_refresh_lock_until") ?? 0),
    errorAt: values.get("allowlist_refresh_error_at") ?? null,
  };
}

function isFresh(meta: AllowlistMeta, nowMs: number): boolean {
  const lastSync = timestamp(meta.lastSyncAt);
  return lastSync !== null && nowMs - lastSync >= 0 && nowMs - lastSync <= REFRESH_TTL_MS;
}

function hasRecentError(meta: AllowlistMeta, nowMs: number): boolean {
  const errorAt = timestamp(meta.errorAt);
  return errorAt !== null && nowMs - errorAt >= 0 && nowMs - errorAt <= REFRESH_ERROR_COOLDOWN_MS;
}

async function claimRefresh(env: AllowlistEnv, nowSeconds: number): Promise<boolean> {
  const lockUntil = nowSeconds + REFRESH_LOCK_SECONDS;
  const result = await env.ACCESS_DB.prepare(`
    INSERT INTO access_sync_meta (key, value, updated_at)
    VALUES ('allowlist_refresh_lock_until', ?1, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
    WHERE CAST(access_sync_meta.value AS INTEGER) <= ?2
  `).bind(String(lockUntil), nowSeconds).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function fetchMembers(env: AllowlistEnv, githubFetch: GitHubFetch): Promise<Array<{ githubId: number; login: string }>> {
  const members = new Map<number, string>();
  for (let page = 1; page <= MAX_MEMBER_PAGES; page += 1) {
    const url = new URL(`https://api.github.com/orgs/${encodeURIComponent(env.GITHUB_ORG)}/members`);
    url.searchParams.set("filter", "all");
    url.searchParams.set("per_page", String(MEMBER_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const response = await githubFetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_ORG_READ_TOKEN}`,
        "User-Agent": "dsh-group-chat-diary",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });
    if (!response.ok) throw new Error("GitHub organization member refresh failed");
    const rows = await response.json() as GitHubMember[];
    if (!Array.isArray(rows)) throw new Error("GitHub organization member response is invalid");
    for (const member of rows) {
      const githubId = Number(member.id);
      const login = String(member.login ?? "");
      if (Number.isSafeInteger(githubId) && githubId > 0 && login) members.set(githubId, login);
    }
    if (rows.length < MEMBER_PAGE_SIZE) break;
    if (page === MAX_MEMBER_PAGES) throw new Error("GitHub organization member pagination exceeded the safety limit");
  }
  if (members.size === 0) throw new Error("GitHub organization member list is empty");
  return [...members.entries()]
    .map(([githubId, login]) => ({ githubId, login }))
    .sort((left, right) => left.githubId - right.githubId);
}

async function releaseFailedRefresh(env: AllowlistEnv, syncId: string, failedAt: string): Promise<void> {
  try {
    await env.ACCESS_DB.batch([
      env.ACCESS_DB.prepare("DELETE FROM access_allowlist_staging WHERE sync_id = ?1").bind(syncId),
      env.ACCESS_DB.prepare(`
        INSERT INTO access_sync_meta (key, value, updated_at)
        VALUES ('allowlist_refresh_error_at', ?1, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(failedAt),
      env.ACCESS_DB.prepare(`
        INSERT INTO access_sync_meta (key, value, updated_at)
        VALUES ('allowlist_refresh_lock_until', '0', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP
      `),
    ]);
  } catch {
    // The lock expires automatically even if cleanup is temporarily unavailable.
  }
}

async function refreshAllowlist(env: AllowlistEnv, githubFetch: GitHubFetch): Promise<boolean> {
  const syncId = crypto.randomUUID();
  try {
    const members = await fetchMembers(env, githubFetch);
    for (let offset = 0; offset < members.length; offset += STAGING_BATCH_SIZE) {
      const chunk = members.slice(offset, offset + STAGING_BATCH_SIZE);
      await env.ACCESS_DB.batch(chunk.map((member) => env.ACCESS_DB.prepare(`
        INSERT INTO access_allowlist_staging (sync_id, github_id, login, created_at)
        VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
        ON CONFLICT(sync_id, github_id) DO UPDATE SET login = excluded.login
      `).bind(syncId, member.githubId, member.login)));
    }

    const staged = await env.ACCESS_DB.prepare(`
      SELECT COUNT(*) AS count
      FROM access_allowlist_staging
      WHERE sync_id = ?1
    `).bind(syncId).first<{ count: number }>();
    if (Number(staged?.count) !== members.length || members.length <= 0) {
      throw new Error("Staged organization member count mismatch");
    }

    const syncedAt = new Date().toISOString();
    await env.ACCESS_DB.batch([
      env.ACCESS_DB.prepare("UPDATE access_allowlist SET active = 0, updated_at = CURRENT_TIMESTAMP"),
      env.ACCESS_DB.prepare(`
        INSERT INTO access_allowlist (github_id, login, active, updated_at)
        SELECT github_id, login, 1, CURRENT_TIMESTAMP
        FROM access_allowlist_staging
        WHERE sync_id = ?1
        ON CONFLICT(github_id) DO UPDATE SET
          login = excluded.login,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(syncId),
      env.ACCESS_DB.prepare(`
        INSERT INTO access_sync_meta (key, value, updated_at)
        VALUES ('last_sync_at', ?1, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(syncedAt),
      env.ACCESS_DB.prepare(`
        INSERT INTO access_sync_meta (key, value, updated_at)
        VALUES ('member_count', ?1, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(String(members.length)),
      env.ACCESS_DB.prepare("DELETE FROM access_sync_meta WHERE key = 'allowlist_refresh_error_at'"),
      env.ACCESS_DB.prepare(`
        INSERT INTO access_sync_meta (key, value, updated_at)
        VALUES ('allowlist_refresh_lock_until', '0', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP
      `),
      env.ACCESS_DB.prepare("DELETE FROM access_allowlist_staging WHERE sync_id = ?1").bind(syncId),
    ]);
    return true;
  } catch {
    await releaseFailedRefresh(env, syncId, new Date().toISOString());
    return false;
  }
}

export async function allowlistIsFresh(env: AllowlistEnv, nowMs = Date.now()): Promise<boolean> {
  return isFresh(await readMeta(env), nowMs);
}

export async function allowlistHasActiveMembers(env: AllowlistEnv): Promise<boolean> {
  const row = await env.ACCESS_DB.prepare(`
    SELECT COUNT(*) AS count FROM access_allowlist WHERE active = 1
  `).first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

export async function prepareAllowlistPage(
  env: AllowlistEnv,
  githubFetch: GitHubFetch,
  context?: Pick<ExecutionContext, "waitUntil">,
  forceRetry = false,
  nowMs = Date.now(),
): Promise<AllowlistPageState> {
  const meta = await readMeta(env);
  if (isFresh(meta, nowMs)) return { status: "ready" };
  if (meta.lockUntil > Math.floor(nowMs / 1000)) return { status: "syncing" };
  if (!forceRetry && hasRecentError(meta, nowMs)) {
    return { status: await allowlistHasActiveMembers(env) ? "stale" : "error" };
  }
  if (!env.GITHUB_ORG_READ_TOKEN) {
    return { status: await allowlistHasActiveMembers(env) ? "stale" : "error" };
  }

  const claimed = await claimRefresh(env, Math.floor(nowMs / 1000));
  if (!claimed) return { status: "syncing" };
  const refresh = refreshAllowlist(env, githubFetch);
  if (context) {
    context.waitUntil(refresh);
    return { status: "syncing" };
  }
  if (await refresh) return { status: "ready" };
  return { status: await allowlistHasActiveMembers(env) ? "stale" : "error" };
}
