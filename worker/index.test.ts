import { describe, expect, it, vi } from "vitest";
import { createHandler, signSession, verifySession, type WorkerEnv } from "./index";

function makeAccessDb(allowedIds = [123], writes: unknown[][] = []): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        run: vi.fn(async () => {
          writes.push([sql, ...values]);
          return { success: true };
        }),
        first: vi.fn(async () => allowedIds.includes(Number(values[0])) ? { allowed: 1 } : null),
      })),
    })),
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

function makeEnv(assetBody = "SECRET ARCHIVE", allowedIds = [123], requestCount = 1): WorkerEnv {
  return {
    ACCESS_DB: makeAccessDb(allowedIds),
    QA_DB: makeQaDb(requestCount),
    ASSETS: {
      fetch: vi.fn(async () => new Response(assetBody, { headers: { "Cache-Control": "public" } })),
    } as unknown as Fetcher,
    DEEPSEEK_API_KEY: "test-deepseek-key",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
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
    const modelFetch = vi.fn(async () => new Response(upstream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    const request = await authenticatedRequest(env, "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "最近版本更新", history: [] }),
    });
    const response = await createHandler(fetch, modelFetch)(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: meta");
    expect(body).toContain('"kind":"group"');
    expect(body).toContain('"kind":"issue"');
    expect(body).toContain("已完成更新 [G1]");
    expect(body).toContain("event: done");
    expect(body).not.toContain(env.DEEPSEEK_API_KEY);
    expect(modelFetch).toHaveBeenCalledOnce();
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
    expect(body).not.toMatch(/DSH|DeepSeek|内测群|dsh-external/i);
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
