import { describe, expect, it, vi } from "vitest";
import { createHandler, signSession, verifySession, type WorkerEnv } from "./index";
import { defaultQaPlan, resolveQaTimeRange, streamAnswer } from "./qa";

function makeAccessDb(
  allowedIds = [123],
  writes: unknown[][] = [],
  lastSyncAt: string | null = new Date().toISOString(),
): D1Database {
  const allowlist = new Map(allowedIds.map((id) => [id, { login: `member-${id}`, active: 1 }]));
  const meta = new Map<string, string>();
  if (lastSyncAt) meta.set("last_sync_at", lastSyncAt);
  meta.set("member_count", String(allowedIds.length));
  meta.set("allowlist_refresh_lock_until", "0");
  const staging = new Map<string, Map<number, string>>();

  function prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: vi.fn((...nextValues: unknown[]) => {
        values = nextValues;
        return statement;
      }),
      first: vi.fn(async () => {
        if (sql.includes("SELECT 1 AS allowed")) {
          return allowlist.get(Number(values[0]))?.active === 1 ? { allowed: 1 } : null;
        }
        if (sql.includes("COUNT(*) AS count") && sql.includes("access_allowlist_staging")) {
          return { count: staging.get(String(values[0]))?.size ?? 0 };
        }
        if (sql.includes("COUNT(*) AS count") && sql.includes("access_allowlist WHERE active = 1")) {
          return { count: [...allowlist.values()].filter((row) => row.active === 1).length };
        }
        return null;
      }),
      all: vi.fn(async () => {
        if (sql.includes("FROM access_sync_meta")) {
          return { results: [...meta.entries()].map(([key, value]) => ({ key, value })) };
        }
        return { results: [] };
      }),
      run: vi.fn(async () => {
        writes.push([sql, ...values]);
        let changes = 1;
        if (sql.includes("allowlist_refresh_lock_until") && sql.includes("WHERE CAST")) {
          const current = Number(meta.get("allowlist_refresh_lock_until") ?? 0);
          const now = Number(values[1]);
          if (current <= now) meta.set("allowlist_refresh_lock_until", String(values[0]));
          else changes = 0;
        } else if (sql.includes("INSERT INTO access_allowlist_staging")) {
          const syncId = String(values[0]);
          const rows = staging.get(syncId) ?? new Map<number, string>();
          rows.set(Number(values[1]), String(values[2]));
          staging.set(syncId, rows);
        } else if (sql.includes("DELETE FROM access_allowlist_staging")) {
          staging.delete(String(values[0]));
        } else if (sql.includes("UPDATE access_allowlist SET active = 0")) {
          for (const row of allowlist.values()) row.active = 0;
        } else if (sql.includes("SELECT github_id, login, 1") && sql.includes("access_allowlist_staging")) {
          for (const [githubId, login] of staging.get(String(values[0])) ?? []) {
            allowlist.set(githubId, { login, active: 1 });
          }
        } else if (sql.includes("INSERT INTO access_allowlist (github_id, login, active")) {
          allowlist.set(Number(values[0]), { login: String(values[1]), active: Number(values[2]) });
        } else if (sql.includes("DELETE FROM access_sync_meta") && sql.includes("allowlist_refresh_error_at")) {
          meta.delete("allowlist_refresh_error_at");
        } else if (sql.includes("INSERT INTO access_sync_meta")) {
          const key = ["last_sync_at", "member_count", "allowlist_refresh_error_at", "allowlist_refresh_lock_until"]
            .find((candidate) => sql.includes(`'${candidate}'`));
          if (key) meta.set(key, key === "allowlist_refresh_lock_until" && values.length === 0 ? "0" : String(values[0]));
        }
        return { success: true, meta: { changes } };
      }),
    };
    return statement;
  }

  return {
    prepare: vi.fn(prepare),
    batch: vi.fn(async (statements: Array<ReturnType<typeof prepare>>) => Promise.all(
      statements.map((statement) => statement.run()),
    )),
  } as unknown as D1Database;
}

function makeQaDb(requestCount = 1): D1Database {
  const meta = [
    { key: "active_group_sync_id", value: "test-sync" },
    { key: "active_github_sync_id", value: "test-sync" },
    { key: "group_message_count", value: "13078" },
    { key: "github_issue_count", value: "357" },
    { key: "github_repo_count", value: "80" },
    { key: "group_date_count_v2", value: "7" },
    { key: "latest_group_date_v2", value: "2026-08-09" },
    { key: "latest_issue_date_v2", value: "2026-08-09" },
    { key: "group_synced_at", value: "2026-08-06T08:00:00.000Z" },
    { key: "github_synced_at", value: "2026-08-06T08:05:00.000Z" },
  ];
  const group = {
    document_key: "test-sync:g:message-1",
    kind: "group",
    source_date: "2026-08-06",
    position: 13_077,
    occurred_at: "2026-08-06T00:18:00+08:00",
    sender: "Baymax",
    title: null,
    url: null,
    state: null,
    category: null,
    priority: null,
    is_changelog: 1,
    excerpt: "DeepSeek Harness Changelog 2026-08-05",
    content: "DeepSeek Harness Changelog 2026-08-05 ✨ 新增 🐛 修复 🎨 优化",
    fts_rank: -1,
  };
  const liveChronicle = {
    document_key: "test-sync:g:message-live",
    source_date: "2026-08-07",
    occurred_at: "2026-08-07T09:00:00+08:00",
    sender: "Baymax",
    content: "Changelog 2026-08-07\n✨ 新增\n新增当日实时纪事",
  };
  const overviewGroupRows = [
    { ...group, document_key: "test-sync:g:old", source_date: "2026-08-03", position: 20_001,
      occurred_at: "2026-08-03T12:00:00+08:00", sender: "旧成员", is_changelog: 0, content: "不应进入回答的 08-03 旧消息" },
    { ...group, document_key: "test-sync:g:early", source_date: "2026-08-08", position: 20_002,
      occurred_at: "2026-08-08T17:59:59+08:00", sender: "早到成员", is_changelog: 0, content: "不应进入晚间范围的 17:59 消息" },
    { ...group, document_key: "test-sync:g:evening", source_date: "2026-08-08", position: 20_003,
      occurred_at: "2026-08-08T18:00:04+08:00", sender: "晚间成员", is_changelog: 0, content: "08-08 晚间第一条完整消息" },
    { ...group, document_key: "test-sync:g:latest", source_date: "2026-08-09", position: 20_004,
      occurred_at: "2026-08-09T09:09:43+08:00", sender: "今日成员", is_changelog: 0, content: "08-09 最新完整消息" },
  ];
  const issue = {
    document_key: "test-sync:i:357",
    kind: "issue",
    source_date: "2026-08-06",
    position: 356,
    occurred_at: "2026-08-06T06:43:00Z",
    sender: null,
    title: "#357 · 停止生成时引导消息被静默销毁",
    url: "https://github.com/dsh-external/issues/issues/357",
    state: "open",
    category: "bug修复",
    priority: 5,
    is_changelog: 0,
    excerpt: "停止生成时引导消息无法找回。",
    content: "#357 停止生成 引导消息 静默销毁",
    fts_rank: -0.5,
  };
  const repo = {
    document_key: "test-sync:r:80",
    kind: "repo",
    source_date: "2026-08-06",
    position: 79,
    occurred_at: "2026-08-06T07:00:00Z",
    sender: null,
    title: "dsh-external/example-repo",
    url: "https://github.com/dsh-external/example-repo",
    state: "active",
    category: "TypeScript",
    priority: 0,
    is_changelog: 0,
    excerpt: "一个用于验证 Repo 检索的仓库。",
    content: "dsh-external/example-repo TypeScript 最近推送",
    fts_rank: -0.25,
  };
  const speakerRows = [
    { ...group, document_key: "test-sync:g:speaker-a-1", sender: "成员甲", content: "我做了完整复现，并整理了原因、方案和验证步骤。 ↳ 回复 被引用者：这不是成员甲的观点。", message_count: 120, substantive_count: 82, sample_rank: 1 },
    { ...group, document_key: "test-sync:g:speaker-a-2", sender: "成员甲", content: "这个交互可以换一种实现，减少一次不必要的等待。", message_count: 120, substantive_count: 82, sample_rank: 2 },
    { ...group, document_key: "test-sync:g:speaker-b-1", sender: "成员乙", content: "这里有个挺有启发的产品视角，可以从用户目标反推。", message_count: 98, substantive_count: 61, sample_rank: 1 },
    { ...group, document_key: "test-sync:g:speaker-b-2", sender: "成员乙", content: "实测以后发现问题不是模型，而是上下文组织方式。", message_count: 98, substantive_count: 61, sample_rank: 2 },
  ];
  return {
    prepare: vi.fn((sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: vi.fn((...nextValues: unknown[]) => {
          values = nextValues;
          return statement;
        }),
        first: vi.fn(async () => sql.includes("qa_rate_limits") ? { request_count: requestCount } : null),
        all: vi.fn(async () => {
          if (sql.includes("FROM qa_group_documents") && sql.includes("source_date > ?1")) return { results: [liveChronicle] };
          if (sql.includes("qa_corpus_meta")) return { results: meta };
          if (sql.includes("PARTITION BY d.sender")) return { results: speakerRows };
          if (sql.includes("length(trim(d.content)) > 0")) {
            const startAt = values[2] ? Date.parse(String(values[2])) : Number.NEGATIVE_INFINITY;
            const endAt = values[3] ? Date.parse(String(values[3])) : Number.POSITIVE_INFINITY;
            return { results: overviewGroupRows.filter((row) => {
              const occurredAt = Date.parse(row.occurred_at);
              return occurredAt >= startAt && occurredAt <= endAt;
            }) };
          }
          if (sql.includes("qa_group_fts")) return { results: [group] };
          if (sql.includes("qa_github_fts")) return { results: values[2] === "repo" ? [repo] : [issue] };
          if (sql.includes("is_changelog = 1")) return { results: [group] };
          if (sql.includes("position BETWEEN")) {
            return { results: [{ occurred_at: group.occurred_at, sender: group.sender, content: group.content }] };
          }
          return { results: [] };
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
}

function makeContentDb(): D1Database {
  const groupPayload = {
    version: 2,
    snapshotDate: "2026-08-06",
    group: {
      version: 3,
      source: { group: "【官方】DSH内测群" },
      stats: {
        source_messages: 5,
        accepted_messages: 4,
        excluded_messages: 1,
        date_start: "2026-08-06T00:01:00+08:00",
        date_end: "2026-08-06T23:59:00+08:00",
        type_breakdown: { 文本: 4 },
      },
      signals: [{ message_id: "signal-2", sender: "成员甲", timestamp: "2026-08-06T12:00:00+08:00", text: "第二条信号" }],
      chronicles: [
        {
          message_id: "event-2", sender: "崔小天", timestamp: "2026-08-06T13:00:00+08:00",
          title: "内测版本更新", quote: "Changelog 2026-08-06", detail: "DeepSeek Harness 新版本已发布。",
        },
        {
          message_id: "personal-project", sender: "少女阿原", timestamp: "2026-08-06T15:04:50+08:00",
          title: "内测版本更新", quote: "我做了一个群聊和 Issue 数据网站。", detail: "这是成员项目，不是 DSH 官方更新。",
        },
      ],
      members: [{
        name: "成员甲", count: 3, signals: 1, role: "协作推动者", traits: ["Issue 与协作"], self: false,
        representative: { headline: "第二天表现", time: "2026-08-06 12:00" },
      }],
    },
    comparison: { version: 2, status: "ready" },
    generatedAt: "2026-08-07T00:00:00.000Z",
  };
  const priorGroupPayload = {
    version: 2,
    snapshotDate: "2026-08-05",
    group: {
      version: 3,
      source: { group: "【官方】DSH内测群" },
      stats: {
        source_messages: 4,
        accepted_messages: 3,
        excluded_messages: 1,
        date_start: "2026-08-05T00:02:00+08:00",
        date_end: "2026-08-05T23:58:00+08:00",
        type_breakdown: { 文本: 2, 图片: 1 },
      },
      signals: [{ message_id: "signal-1", sender: "成员乙", timestamp: "2026-08-05T11:00:00+08:00", text: "第一条信号" }],
      chronicles: [{
        message_id: "event-1", sender: "Baymax", timestamp: "2026-08-05T09:00:00+08:00",
        title: "内测版本更新", quote: "GitHub repo 已推送新版本。", detail: "snapshot-20260805T090000Z-test",
      }],
      members: [
        { name: "成员甲", count: 2, signals: 0, role: "讨论参与者", traits: ["插件与生态"], self: false, representative: null },
        { name: "成员乙", count: 1, signals: 1, role: "实测贡献者", traits: ["性能稳定性"], self: false,
          representative: { headline: "第一天表现", time: "2026-08-05 11:00" } },
      ],
    },
    comparison: { version: 2, status: "ready" },
    generatedAt: "2026-08-06T00:00:00.000Z",
  };
  const issuePayload = { version: 2, issues: [{ n: 357 }], issue_groups: [] };
  const repoPayload = {
    version: 2,
    repositories: [{ id: 80, name: "example-repo", summary: "一个示例仓库", activity: "24 小时内更新", why: "近期仍在推进" }],
    groups: [{ id: "examples", name: "示例", count: 1, repositories: [80] }],
    highlights: [80],
    stats: { total: 1 },
  };
  return {
    prepare: vi.fn((sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: vi.fn((...nextValues: unknown[]) => {
          values = nextValues;
          return statement;
        }),
        first: vi.fn(async () => {
          if (sql.includes("content_active_group_days") && sql.includes("v.payload")) {
            return { payload: JSON.stringify(groupPayload) };
          }
          if (sql.includes("content_active_sources")) {
            const source = String(values[0]);
            return {
              source,
              sync_id: "github-sync",
              generated_at: "2026-08-07T00:05:00.000Z",
              item_count: source === "issues" ? 1 : 1,
              payload: sql.includes("v.payload")
                ? JSON.stringify(source === "issues" ? issuePayload : repoPayload)
                : undefined,
              activated_at: "2026-08-07T00:06:00.000Z",
            };
          }
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes("content_active_group_days") && sql.includes("v.payload")) {
            return { results: [
              { date: "2026-08-05", generated_at: priorGroupPayload.generatedAt, payload: JSON.stringify(priorGroupPayload) },
              { date: "2026-08-06", generated_at: groupPayload.generatedAt, payload: JSON.stringify(groupPayload) },
            ] };
          }
          if (sql.includes("content_active_group_days")) {
            return { results: [{
              date: "2026-08-06",
              ingest_id: "group-sync",
              generated_at: "2026-08-07T00:00:00.000Z",
              source_message_count: 3323,
              accepted_message_count: 3219,
              signal_count: 91,
              participant_count: 104,
              chronicle_count: 2,
              activated_at: "2026-08-07T00:01:00.000Z",
            }] };
          }
          if (sql.includes("content_source_chunks")) return { results: [] };
          return { results: [] };
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
}

function makeEnv(
  assetBody = "SECRET ARCHIVE",
  allowedIds = [123],
  requestCount = 1,
  lastSyncAt: string | null = new Date().toISOString(),
  accessWrites: unknown[][] = [],
): WorkerEnv {
  return {
    ACCESS_DB: makeAccessDb(allowedIds, accessWrites, lastSyncAt),
    QA_DB: makeQaDb(requestCount),
    CONTENT_DB: makeContentDb(),
    ASSETS: {
      fetch: vi.fn(async () => new Response(assetBody, { headers: { "Cache-Control": "public" } })),
    } as unknown as Fetcher,
    DEEPSEEK_API_KEY: "test-deepseek-key",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    GITHUB_ORG_READ_TOKEN: "test-org-read-token",
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    GITHUB_ORG: "dsh-external",
    SESSION_SECRET: "a-test-session-secret-that-is-long-enough",
    SITE_ORIGIN: "https://dsh.hiwangjie.com",
  };
}

async function signWebhook(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `sha256=${[...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("signed sessions", () => {
  it("accepts an intact, unexpired session", async () => {
    const payload = { version: 2 as const, githubId: 123, login: "member", exp: 2_000 };
    const token = await signSession(payload, "secret");
    await expect(verifySession(token, "secret", 1_000)).resolves.toEqual(payload);
  });

  it("rejects tampered and expired sessions", async () => {
    const token = await signSession({ version: 2, githubId: 123, login: "member", exp: 2_000 }, "secret");
    await expect(verifySession(`${token}x`, "secret", 1_000)).resolves.toBeNull();
    await expect(verifySession(token, "secret", 2_000)).resolves.toBeNull();
  });
});

describe("archive gate", () => {
  it("never invokes the asset binding for an anonymous request", async () => {
    const env = makeEnv();
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/data/2026-08-05.json`), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${env.SITE_ORIGIN}/login`);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves assets only with a valid signed session and disables caching", async () => {
    const env = makeEnv();
    const token = await signSession(
      { version: 2, githubId: 123, login: "member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const response = await createHandler()(
      new Request(`${env.SITE_ORIGIN}/`, { headers: { Cookie: `__Host-portal_session=${token}` } }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("SECRET ARCHIVE");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("returns the signed-in GitHub account without invoking the asset binding", async () => {
    const env = makeEnv();
    const token = await signSession(
      { version: 2, githubId: 123, login: "member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const response = await createHandler()(
      new Request(`${env.SITE_ORIGIN}/api/me`, { headers: { Cookie: `__Host-portal_session=${token}` } }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ login: "member" });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("keeps the Q&A routes behind the same signed member session", async () => {
    const modelFetch = vi.fn();
    const env = makeEnv();
    const response = await createHandler(fetch, modelFetch)(
      new Request(`${env.SITE_ORIGIN}/api/ask`, { method: "POST", body: "{}" }),
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${env.SITE_ORIGIN}/login`);
    expect(modelFetch).not.toHaveBeenCalled();
  });

  it("keeps the live content APIs behind the member gate", async () => {
    const env = makeEnv();
    const anonymous = await createHandler()(new Request(`${env.SITE_ORIGIN}/api/content/repos`), env);
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("Location")).toBe(`${env.SITE_ORIGIN}/login`);
    const anonymousHistory = await createHandler()(new Request(`${env.SITE_ORIGIN}/api/content/group-history`), env);
    expect(anonymousHistory.status).toBe(302);

    const token = await signSession(
      { version: 2, githubId: 123, login: "member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const headers = { Cookie: `__Host-portal_session=${token}` };
    const manifest = await createHandler()(new Request(`${env.SITE_ORIGIN}/api/content/manifest`, { headers }), env);
    expect(manifest.status).toBe(200);
    await expect(manifest.json()).resolves.toMatchObject({ version: 2, latest: "2026-08-06", github: { repos: 1 } });
    const repos = await createHandler()(new Request(`${env.SITE_ORIGIN}/api/content/repos`, { headers }), env);
    await expect(repos.json()).resolves.toMatchObject({
      version: 2,
      stats: { total: 1 },
      groups: [{ count: 1 }],
      highlights: [80],
    });
    const history = await createHandler()(new Request(`${env.SITE_ORIGIN}/api/content/group-history`, { headers }), env);
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      version: 1,
      scope: "all-active-group-days",
      dates: ["2026-08-05", "2026-08-06", "2026-08-07"],
      stats: { days: 2, live_chronicle_dates: 1, source_messages: 9, accepted_messages: 7, signal_count: 2, participant_count: 2, chronicle_count: 3 },
      signals: [{ message_id: "signal-2" }, { message_id: "signal-1" }],
      chronicles: [{ message_id: "message-live" }, { message_id: "event-2" }, { message_id: "event-1" }],
      members: [
        { name: "成员甲", count: 5, signals: 1, activeDays: 2 },
        { name: "成员乙", count: 1, signals: 1, activeDays: 1 },
      ],
    });
    const day = await createHandler()(new Request(`${env.SITE_ORIGIN}/api/content/group?date=2026-08-06`, { headers }), env);
    await expect(day.json()).resolves.toMatchObject({
      group: { chronicles: [{ message_id: "event-2" }] },
    });
  });

  it("revokes an existing session when the member leaves the allowlist", async () => {
    const env = makeEnv("SECRET ARCHIVE", []);
    const token = await signSession(
      { version: 2, githubId: 123, login: "former-member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const response = await createHandler()(
      new Request(`${env.SITE_ORIGIN}/`, { headers: { Cookie: `__Host-portal_session=${token}` } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
});

describe("protected DeepSeek Q&A", () => {
  async function authenticatedRequest(env: WorkerEnv, pathname: string, init?: RequestInit): Promise<Request> {
    const token = await signSession(
      { version: 2, githubId: 123, login: "member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const headers = new Headers(init?.headers);
    headers.set("Cookie", `__Host-portal_session=${token}`);
    return new Request(`${env.SITE_ORIGIN}${pathname}`, { ...init, headers });
  }

  it("reports private group, Issue, and Repo corpus readiness", async () => {
    const env = makeEnv();
    const response = await createHandler()(await authenticatedRequest(env, "/api/qa/status"), env);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      deepseekReady: true,
      model: "deepseek-v4-flash",
      corpus: { messageCount: 13_078, issueCount: 357, repoCount: 80 },
      localOnly: false,
    });
    expect(body).not.toHaveProperty("webReady");
  });

  it("routes repository questions to the private Repo index", () => {
    expect(defaultQaPlan("组织目前有哪些 Repo，最近哪些仓库有更新？")).toMatchObject({
      intent: "repository",
      source: "repo",
    });
  });

  it("treats a compact evening-to-now range as a hard group-message boundary", () => {
    const question = "帮我归类总结0808晚上到现在的消息，给到分类、观点摘要、代表性原声";
    expect(defaultQaPlan(question)).toMatchObject({ intent: "overview", source: "group" });
    expect(resolveQaTimeRange(question, "2026-08-09")).toEqual({
      startAt: "2026-08-08T18:00:00+08:00",
      endAt: null,
      label: "2026-08-08 18:00 至语料最新时间",
    });
  });

  it("does not treat an explicit Issue number as a compact date", () => {
    expect(resolveQaTimeRange("帮我看一下 Issue #0808 的状态", "2026-08-09")).toBeNull();
    expect(defaultQaPlan("帮我看一下 Issue #0808 的状态")).toMatchObject({
      intent: "issue",
      source: "issue",
      issueNumber: "0808",
    });
  });

  it("uses every message inside an explicit range and excludes earlier records", async () => {
    const env = makeEnv();
    const upstream = [
      'data: {"choices":[{"delta":{"content":"已按完整范围归纳 [G1][G2]"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const modelFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (payload.stream === false) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          intent: "overview", source: "all", queries: ["消息 分类 观点 原声"], days: 7, people: [], issueNumber: null,
        }) } }] });
      }
      return new Response(upstream, { headers: { "Content-Type": "text/event-stream" } });
    });
    const request = await authenticatedRequest(env, "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "帮我归类总结0808晚上到现在的消息，给到分类、观点摘要、代表性原声" }),
    });
    const response = await createHandler(fetch, modelFetch)(request, env);
    const responseBody = await response.text();
    expect(responseBody).toContain('"source":"group"');
    expect(responseBody).toContain('"strategy":"full-range-direct"');
    expect(responseBody).toContain('"startAt":"2026-08-08T18:00:00+08:00"');
    expect(modelFetch).toHaveBeenCalledTimes(2);
    const answerBody = JSON.parse(String(modelFetch.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    const answerContext = answerBody.messages.at(-1)?.content ?? "";
    expect(answerContext).toContain("08-08 晚间第一条完整消息");
    expect(answerContext).toContain("08-09 最新完整消息");
    expect(answerContext).not.toContain("08-03 旧消息");
    expect(answerContext).not.toContain("17:59 消息");
    expect(answerContext).toContain("没有抽样");
    expect(answerBody.max_tokens).toBe(32_768);
  });

  it("streams a cited answer from DeepSeek without exposing the API key", async () => {
    const env = makeEnv();
    const upstream = [
      'data: {"choices":[{"delta":{"content":"已完成更新 [G1]"}}]}',
      'data: {"choices":[],"usage":{"total_tokens":42}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const modelFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (payload.stream === false) {
        return Response.json({
          choices: [{ message: { content: JSON.stringify({
            // Simulate a planner confusing the compact date with an Issue id.
            // Deterministic routing must still keep this on the release path.
            intent: "issue",
            source: "issue",
            queries: ["0806", "版本 新增 修复 优化"],
            days: 3,
            people: [],
            issueNumber: "806",
          }) } }],
        });
      }
      return new Response(upstream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    const request = await authenticatedRequest(env, "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "0806 有什么内测版本更新", history: [] }),
    });
    const response = await createHandler(fetch, modelFetch)(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: meta");
    expect(body).toContain('"kind":"group"');
    expect(body).toContain('"intent":"release"');
    expect(body).not.toContain('"kind":"issue"');
    expect(body).toContain("已完成更新 [G1]");
    expect(body).toContain("event: done");
    expect(body).not.toContain(env.DEEPSEEK_API_KEY);
    expect(modelFetch).toHaveBeenCalledTimes(2);
    const plannerBody = JSON.parse(String(modelFetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const answerBody = JSON.parse(String(modelFetch.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(plannerBody).toMatchObject({ stream: false, thinking: { type: "disabled" } });
    expect(answerBody).toMatchObject({ stream: true, thinking: { type: "enabled" }, reasoning_effort: "high" });
    expect(answerBody).toHaveProperty("max_tokens", 32_768);
  });

  it("uses member-balanced retrieval and max reasoning for speaker comparison questions", async () => {
    const env = makeEnv();
    const upstream = [
      'data: {"choices":[{"delta":{"content":"更有代表性的是成员甲 [G1]。"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const modelFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (payload.stream === false) {
        return Response.json({
          choices: [{ message: { content: JSON.stringify({
            intent: "speaker",
            source: "group",
            queries: ["表达风格", "洞察 幽默"],
            days: 0,
            people: [],
            issueNumber: null,
          }) } }],
        });
      }
      return new Response(upstream, { headers: { "Content-Type": "text/event-stream" } });
    });
    const request = await authenticatedRequest(env, "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "谁说话最有意思" }),
    });
    const response = await createHandler(fetch, modelFetch)(request, env);
    const body = await response.text();
    expect(body).toContain('"intent":"speaker"');
    expect(body).toContain("成员甲 · 成员样本");
    expect(body).toContain("成员乙 · 成员样本");
    const answerBody = JSON.parse(String(modelFetch.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(answerBody).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "max" });
    expect(answerBody).toHaveProperty("max_tokens", 32_768);
    expect(JSON.stringify(answerBody)).not.toContain("这不是成员甲的观点");
  });

  it("reports an explicit error when thinking ends before a final answer", async () => {
    const env = makeEnv();
    const upstream = [
      'data: {"choices":[{"delta":{"reasoning_content":"仍在分析"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":""},"finish_reason":"length"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const modelFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (payload.stream === false) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          intent: "lookup", source: "both", queries: ["插件反馈"], days: 3, people: [], issueNumber: null,
        }) } }] });
      }
      return new Response(upstream, { headers: { "Content-Type": "text/event-stream" } });
    });
    const request = await authenticatedRequest(env, "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "最近插件反馈" }),
    });
    const response = await createHandler(fetch, modelFetch)(request, env);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("模型输出上限");
    expect(body).not.toContain("event: done");
  });

  it("keeps the browser stream alive while DeepSeek is still thinking", async () => {
    const encoder = new TextEncoder();
    const upstream = new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"reasoning_content":"内部推理不应外发"}}]}\n\n',
        ));
        await new Promise((resolve) => setTimeout(resolve, 40));
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"已完成归纳 [G1]"}}]}\n\n',
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }));

    const body = await new Response(streamAnswer(upstream, { sources: [] }, 5)).text();
    expect(body).toContain("event: meta");
    expect(body).toContain("event: progress");
    expect(body).toContain("已完成归纳 [G1]");
    expect(body).toContain("event: done");
    expect(body).not.toContain("内部推理不应外发");
  });

  it("rate-limits an authenticated member before contacting DeepSeek", async () => {
    const env = makeEnv("SECRET ARCHIVE", [123], 21);
    const modelFetch = vi.fn();
    const request = await authenticatedRequest(env, "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "最近版本更新" }),
    });
    const response = await createHandler(fetch, modelFetch)(request, env);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(modelFetch).not.toHaveBeenCalled();
  });
});

describe("organization membership webhook", () => {
  it.each([
    ["member_added", 1],
    ["member_removed", 0],
  ])("applies %s events to the allowlist immediately", async (action, active) => {
    const writes: unknown[][] = [];
    const env = makeEnv();
    env.ACCESS_DB = makeAccessDb([123], writes);
    const body = JSON.stringify({
      action,
      organization: { login: "dsh-external" },
      membership: { user: { id: 456, login: "new-member" } },
    });
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/internal/github-membership`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "organization",
        "X-Hub-Signature-256": await signWebhook(env.GITHUB_WEBHOOK_SECRET, body),
      },
      body,
    }), env);
    expect(response.status).toBe(202);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.slice(-3)).toEqual([456, "new-member", active]);
  });

  it("rejects an invalid signature without changing the allowlist", async () => {
    const writes: unknown[][] = [];
    const env = makeEnv();
    env.ACCESS_DB = makeAccessDb([123], writes);
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/internal/github-membership`, {
      method: "POST",
      headers: {
        "X-GitHub-Event": "organization",
        "X-Hub-Signature-256": `sha256=${"00".repeat(32)}`,
      },
      body: JSON.stringify({ action: "member_added" }),
    }), env);
    expect(response.status).toBe(401);
    expect(writes).toHaveLength(0);
  });
});

describe("GitHub OAuth", () => {
  it("keeps the anonymous login page neutral", async () => {
    const env = makeEnv();
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/login`), env);
    const body = await response.text();
    expect(body).toContain("成员入口");
    expect(body).toContain('href="/auth/login"');
    expect(body).not.toMatch(/DSH|DeepSeek|内测群|dsh-external/i);
  });

  it("refreshes a stale complete allowlist before enabling GitHub login", async () => {
    const writes: unknown[][] = [];
    const env = makeEnv("SECRET ARCHIVE", [123], 1, "2026-08-01T00:00:00.000Z", writes);
    const githubFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/orgs/dsh-external/members");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-org-read-token");
      return Response.json([{ id: 456, login: "new-member" }]);
    });
    let refreshTask: Promise<unknown> | undefined;
    const context = {
      waitUntil: vi.fn((task: Promise<unknown>) => {
        refreshTask = task;
      }),
    } as unknown as ExecutionContext;

    const syncingResponse = await createHandler(githubFetch)(
      new Request(`${env.SITE_ORIGIN}/login`),
      env,
      context,
    );
    const syncingBody = await syncingResponse.text();
    expect(syncingBody).toContain("正在同步访问名单");
    expect(syncingBody).toContain('http-equiv="refresh"');
    expect(syncingBody).not.toContain('href="/auth/login"');
    expect(context.waitUntil).toHaveBeenCalledOnce();

    await refreshTask;
    const readyResponse = await createHandler(githubFetch)(new Request(`${env.SITE_ORIGIN}/login`), env);
    await expect(readyResponse.text()).resolves.toContain('href="/auth/login"');
    expect(githubFetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(writes)).not.toContain(env.GITHUB_ORG_READ_TOKEN);

    const token = await signSession(
      { version: 2, githubId: 456, login: "new-member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const memberResponse = await createHandler()(
      new Request(`${env.SITE_ORIGIN}/`, { headers: { Cookie: `__Host-portal_session=${token}` } }),
      env,
    );
    expect(memberResponse.status).toBe(200);
  });

  it("keeps the previous allowlist active when a refresh fails", async () => {
    const env = makeEnv("SECRET ARCHIVE", [123], 1, "2026-08-01T00:00:00.000Z");
    const githubFetch = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    let refreshTask: Promise<unknown> | undefined;
    const context = {
      waitUntil: vi.fn((task: Promise<unknown>) => {
        refreshTask = task;
      }),
    } as unknown as ExecutionContext;

    const syncingResponse = await createHandler(githubFetch)(
      new Request(`${env.SITE_ORIGIN}/login`),
      env,
      context,
    );
    expect(syncingResponse.status).toBe(200);
    await refreshTask;

    const failedResponse = await createHandler(githubFetch)(new Request(`${env.SITE_ORIGIN}/login`), env);
    const failedBody = await failedResponse.text();
    expect(failedBody).toContain("最新名单暂时无法获取");
    expect(failedBody).toContain('href="/auth/login?fallback=1"');

    const token = await signSession(
      { version: 2, githubId: 123, login: "member", exp: Math.floor(Date.now() / 1000) + 300 },
      env.SESSION_SECRET,
    );
    const existingMember = await createHandler()(
      new Request(`${env.SITE_ORIGIN}/`, { headers: { Cookie: `__Host-portal_session=${token}` } }),
      env,
    );
    expect(existingMember.status).toBe(200);
  });

  it("does not start OAuth while the allowlist is stale", async () => {
    const env = makeEnv("SECRET ARCHIVE", [123], 1, "2026-08-01T00:00:00.000Z");
    const githubFetch = vi.fn();
    const response = await createHandler(githubFetch)(new Request(`${env.SITE_ORIGIN}/auth/login`), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${env.SITE_ORIGIN}/login`);
    expect(githubFetch).not.toHaveBeenCalled();
  });

  it("allows an explicit fallback to the last non-empty verified allowlist", async () => {
    const env = makeEnv("SECRET ARCHIVE", [123], 1, "2026-08-01T00:00:00.000Z");
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/auth/login?fallback=1`), env);
    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.origin).toBe("https://github.com");
    expect(location.searchParams.has("scope")).toBe(false);
  });

  it("requests only public GitHub identity and sets an HttpOnly state cookie", async () => {
    const env = makeEnv();
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/auth/login`), env);
    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.origin).toBe("https://github.com");
    expect(location.searchParams.has("scope")).toBe(false);
    expect(location.searchParams.get("allow_signup")).toBe("false");
    expect(location.searchParams.get("redirect_uri")).toBe(`${env.SITE_ORIGIN}/auth/callback`);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
  });

  it("logs out through POST and clears both local authentication cookies", async () => {
    const env = makeEnv();
    const response = await createHandler()(
      new Request(`${env.SITE_ORIGIN}/auth/logout`, { method: "POST" }),
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`${env.SITE_ORIGIN}/login`);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-portal_session=");
    expect(setCookie).toContain("__Host-portal_oauth_state=");
    expect(setCookie.match(/Max-Age=0/gu)).toHaveLength(2);
  });

  it("does not allow a GET request to trigger logout", async () => {
    const env = makeEnv();
    const response = await createHandler()(new Request(`${env.SITE_ORIGIN}/auth/logout`), env);
    expect(response.status).toBe(405);
  });

  it("rejects a callback with a mismatched state before contacting GitHub", async () => {
    const githubFetch = vi.fn();
    const env = makeEnv();
    const response = await createHandler(githubFetch)(
      new Request(`${env.SITE_ORIGIN}/auth/callback?code=code&state=attacker`, {
        headers: { Cookie: "__Host-portal_oauth_state=expected" },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(githubFetch).not.toHaveBeenCalled();
  });

  it("denies an account whose GitHub ID is not in the allowlist", async () => {
    const githubFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("access_token")) return Response.json({ access_token: "temporary-token" });
      return Response.json({ id: 999, login: "outsider" });
    });
    const env = makeEnv("SECRET ARCHIVE", []);
    const response = await createHandler(githubFetch)(
      new Request(`${env.SITE_ORIGIN}/auth/callback?code=code&state=expected`, {
        headers: { Cookie: "__Host-portal_oauth_state=expected" },
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).not.toContain("__Host-portal_session");
  });

  it("creates a signed session only for an allowlisted GitHub ID", async () => {
    const githubFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("access_token")) return Response.json({ access_token: "temporary-token" });
      return Response.json({ id: 123, login: "member" });
    });
    const env = makeEnv();
    const response = await createHandler(githubFetch)(
      new Request(`${env.SITE_ORIGIN}/auth/callback?code=code&state=expected`, {
        headers: { Cookie: "__Host-portal_oauth_state=expected" },
      }),
      env,
    );
    expect(response.status).toBe(303);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-portal_session=");
    expect(setCookie).not.toContain("temporary-token");
    expect(setCookie).toContain("Max-Age=2592000");
    expect(githubFetch).toHaveBeenCalledTimes(2);
  });
});
