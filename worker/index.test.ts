import { describe, expect, it, vi } from "vitest";
import { createHandler, signSession, verifySession, type WorkerEnv } from "./index";

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
    { key: "active_sync_id", value: "test-sync" },
    { key: "message_count", value: "13078" },
    { key: "issue_count", value: "357" },
    { key: "group_date_count", value: "7" },
    { key: "latest_group_date", value: "2026-08-06" },
    { key: "latest_issue_date", value: "2026-08-06" },
    { key: "synced_at", value: "2026-08-06T08:00:00.000Z" },
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
          if (sql.includes("qa_corpus_meta")) return { results: meta };
          if (sql.includes("PARTITION BY d.sender")) return { results: speakerRows };
          if (sql.includes("qa_corpus_fts")) return { results: values[2] === "group" ? [group] : [issue] };
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

  it("reports only private group and Issue corpus readiness", async () => {
    const env = makeEnv();
    const response = await createHandler()(await authenticatedRequest(env, "/api/qa/status"), env);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      deepseekReady: true,
      model: "deepseek-v4-flash",
      corpus: { messageCount: 13_078, issueCount: 357 },
      localOnly: false,
    });
    expect(body).not.toHaveProperty("webReady");
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
    expect(answerBody).toHaveProperty("max_tokens", 384_000);
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
    expect(answerBody).toHaveProperty("max_tokens", 384_000);
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
    expect(failedBody).toContain("访问名单暂时未能更新");
    expect(failedBody).not.toContain('href="/auth/login"');

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
