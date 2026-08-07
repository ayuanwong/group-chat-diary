import { handleQaAsk, qaStatus, type ModelFetch } from "./qa";
import {
  allowlistIsFresh,
  prepareAllowlistPage,
  type AllowlistPageState,
  type GitHubFetch,
} from "./allowlist";

const SESSION_COOKIE = "__Host-portal_session";
const STATE_COOKIE = "__Host-portal_oauth_state";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;
const GITHUB_API_VERSION = "2026-03-10";

export interface WorkerEnv extends Env {
  ASSETS: Fetcher;
  QA_DB: D1Database;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_MODEL?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_ORG_READ_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_ORG: string;
  SESSION_SECRET: string;
  SITE_ORIGIN: string;
}

interface SessionPayload {
  version: 2;
  githubId: number;
  login: string;
  exp: number;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
}

interface GitHubUser {
  id?: number;
  login?: string;
}

interface OrganizationWebhookPayload {
  action?: string;
  organization?: { login?: string };
  membership?: {
    user?: { id?: number; login?: string };
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/iu.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function verifyGitHubWebhookSignature(
  secret: string,
  payload: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const signature = decodeHex(signatureHeader.slice("sha256=".length));
  if (!signature) return false;
  return crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret),
    new Uint8Array(signature),
    new TextEncoder().encode(payload),
  );
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const signatureBytes = decodeBase64Url(signature);
  const bodyBytes = decodeBase64Url(body);
  if (!signatureBytes || !bodyBytes) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret),
    new Uint8Array(signatureBytes),
    new TextEncoder().encode(body),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(bodyBytes)) as Partial<SessionPayload>;
    if (
      payload.version !== 2
      || !Number.isSafeInteger(payload.githubId)
      || Number(payload.githubId) <= 0
      || typeof payload.login !== "string"
      || !payload.login
      || typeof payload.exp !== "number"
    ) return null;
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds) return null;
    return { version: 2, githubId: Number(payload.githubId), login: payload.login, exp: payload.exp };
  } catch {
    return null;
  }
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function securityHeaders(headers = new Headers()): Headers {
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  return headers;
}

function htmlResponse(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(body, { status, headers });
}

function jsonResponse(body: unknown, status = 200): Response {
  const headers = securityHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location: string, status = 302, cookies: string[] = []): Response {
  const headers = securityHeaders(new Headers({ Location: location }));
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status, headers });
}

function loginPage(
  error?: string,
  cookies: string[] = [],
  allowlist: AllowlistPageState = { status: "ready" },
): Response {
  const errorBlock = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const syncing = allowlist.status === "syncing";
  const refresh = syncing ? '<meta http-equiv="refresh" content="1;url=/login">' : "";
  const action = allowlist.status === "ready"
    ? '<a class="primary" href="/auth/login">使用 GitHub 登录</a>'
    : allowlist.status === "syncing"
      ? '<div class="sync" role="status" aria-live="polite"><span class="pulse" aria-hidden="true"></span><strong>正在同步访问名单</strong><span>通常需要 2–5 秒，同步完成后会自动进入可登录状态。</span></div>'
      : '<div class="sync error" role="alert"><strong>访问名单暂时未能更新</strong><span>旧名单仍保持可用，但为避免新成员被误拒，请稍后重新同步。</span></div><a class="secondary" href="/login?retry=1">重新同步</a>';
  const headers = new Headers();
  for (const value of cookies) headers.append("Set-Cookie", value);
  return htmlResponse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  ${refresh}
  <title>成员入口</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:#030703;color:#d6ffe0;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}.card{width:min(100%,520px);padding:32px;border:1px solid #225c2f;border-radius:18px;background:#071008;box-shadow:0 24px 80px #0008}h1{margin:0 0 12px;font-size:22px;color:#56ff7b}p{margin:10px 0;color:#a8caae}.error{padding:10px 12px;border:1px solid #8a442f;border-radius:8px;color:#ffd2c3;background:#2a110b}a{display:inline-block;margin-top:14px;padding:11px 18px;border-radius:9px;text-decoration:none;font-weight:700}.primary{background:#2ee65a;color:#001806}.secondary{border:1px solid #397846;color:#b8e8c2}.sync{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:center;margin-top:18px;padding:13px 14px;border:1px solid #356841;border-radius:10px;background:#0a190d;color:#b8e8c2}.sync span:last-child{grid-column:2;color:#7fa88a;font-size:12px}.sync.error{border-color:#8a442f;background:#2a110b;color:#ffd2c3}.pulse{width:9px;height:9px;border-radius:50%;background:#56ff7b;box-shadow:0 0 0 0 #56ff7b88;animation:pulse 1.2s infinite}@keyframes pulse{70%{box-shadow:0 0 0 8px #56ff7b00}100%{box-shadow:0 0 0 0 #56ff7b00}}small{display:block;margin-top:20px;color:#6f8e76}
  </style>
</head>
<body><main class="card"><h1>成员入口</h1><p>此页面仅向获准的 GitHub 账户开放。</p>${errorBlock}${action}<small>登录前会先同步最新访问名单。首次登录只读取公开 GitHub 身份；本站不会保存 GitHub 访问令牌。</small></main></body>
</html>`, 200, headers);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function siteOrigin(env: WorkerEnv): string | null {
  try {
    const url = new URL(env.SITE_ORIGIN);
    return url.protocol === "https:" && url.pathname === "/" ? url.origin : null;
  } catch {
    return null;
  }
}

async function githubJson<T>(githubFetch: GitHubFetch, url: string, token: string): Promise<{ response: Response; data: T | null }> {
  const response = await githubFetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "dsh-group-chat-diary",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  let data: T | null = null;
  try {
    data = await response.json() as T;
  } catch {
    // Non-JSON failures are handled by the caller using the HTTP status.
  }
  return { response, data };
}

export async function isAllowlisted(env: WorkerEnv, githubId: number): Promise<boolean> {
  const row = await env.ACCESS_DB
    .prepare("SELECT 1 AS allowed FROM access_allowlist WHERE github_id = ?1 AND active = 1 LIMIT 1")
    .bind(githubId)
    .first<{ allowed: number }>();
  return row?.allowed === 1;
}

async function handleOrganizationWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
  }
  if (request.headers.get("X-GitHub-Event") !== "organization") {
    return new Response("Ignored", { status: 202, headers: securityHeaders() });
  }

  const body = await request.text();
  const validSignature = await verifyGitHubWebhookSignature(
    env.GITHUB_WEBHOOK_SECRET,
    body,
    request.headers.get("X-Hub-Signature-256"),
  );
  if (!validSignature) return new Response("Unauthorized", { status: 401, headers: securityHeaders() });

  let payload: OrganizationWebhookPayload;
  try {
    payload = JSON.parse(body) as OrganizationWebhookPayload;
  } catch {
    return new Response("Bad Request", { status: 400, headers: securityHeaders() });
  }

  const organization = payload.organization?.login ?? "";
  if (organization.toLowerCase() !== env.GITHUB_ORG.toLowerCase()) {
    return new Response("Ignored", { status: 202, headers: securityHeaders() });
  }
  const active = payload.action === "member_added" ? 1 : payload.action === "member_removed" ? 0 : null;
  if (active === null) return new Response("Ignored", { status: 202, headers: securityHeaders() });

  const githubId = Number(payload.membership?.user?.id);
  const login = String(payload.membership?.user?.login ?? "");
  if (!Number.isSafeInteger(githubId) || githubId <= 0 || !login) {
    return new Response("Bad Request", { status: 400, headers: securityHeaders() });
  }

  await env.ACCESS_DB.prepare(`
    INSERT INTO access_allowlist (github_id, login, active, updated_at)
    VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
    ON CONFLICT(github_id) DO UPDATE SET
      login = excluded.login,
      active = excluded.active,
      updated_at = CURRENT_TIMESTAMP
  `).bind(githubId, login, active).run();
  return new Response("Accepted", { status: 202, headers: securityHeaders() });
}

async function handleOAuthCallback(request: Request, env: WorkerEnv, githubFetch: GitHubFetch): Promise<Response> {
  const origin = siteOrigin(env);
  if (!origin) return htmlResponse("<h1>网站配置错误</h1><p>请联系管理员。</p>", 500);

  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const expectedState = parseCookies(request).get(STATE_COOKIE) ?? "";
  const clearState = cookie(STATE_COOKIE, "", 0);
  if (!state || !code || !expectedState || state !== expectedState) {
    return loginPage("登录请求已失效，请重新登录。", [clearState]);
  }

  const callbackUrl = `${origin}/auth/callback`;
  let tokenResponse: Response;
  try {
    tokenResponse = await githubFetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }),
    });
  } catch {
    return htmlResponse("<h1>登录暂时失败</h1><p><a href=\"/login\">返回后重试</a></p>", 502, { "Set-Cookie": clearState });
  }
  let tokenData: GitHubTokenResponse = {};
  try {
    tokenData = await tokenResponse.json() as GitHubTokenResponse;
  } catch {
    // The generic error below intentionally avoids returning provider details.
  }
  if (!tokenResponse.ok || !tokenData.access_token) {
    return htmlResponse("<h1>登录暂时失败</h1><p><a href=\"/login\">返回后重试</a></p>", 502, { "Set-Cookie": clearState });
  }

  const token = tokenData.access_token;
  let userResult: Awaited<ReturnType<typeof githubJson<GitHubUser>>>;
  try {
    userResult = await githubJson<GitHubUser>(githubFetch, "https://api.github.com/user", token);
  } catch {
    return htmlResponse("<h1>身份核验暂时失败</h1><p><a href=\"/login\">返回后重试</a></p>", 502, { "Set-Cookie": clearState });
  }

  const { response: userResponse, data: user } = userResult;
  const githubId = Number(user?.id);
  if (!userResponse.ok || !user?.login || !Number.isSafeInteger(githubId) || githubId <= 0) {
    return htmlResponse("<h1>身份核验暂时失败</h1><p><a href=\"/login\">返回后重试</a></p>", 502, { "Set-Cookie": clearState });
  }

  let allowed: boolean;
  try {
    allowed = await isAllowlisted(env, githubId);
  } catch {
    return htmlResponse("<h1>权限核验暂时失败</h1><p><a href=\"/login\">返回后重试</a></p>", 503, { "Set-Cookie": clearState });
  }

  if (!allowed) {
    return htmlResponse(
      "<h1>没有访问权限</h1><p>当前 GitHub 账户不在获准成员名单中。成员名单每天自动同步。</p><p><a href=\"/login\">返回登录页</a></p>",
      403,
      { "Set-Cookie": clearState },
    );
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const session = await signSession({ version: 2, githubId, login: user.login, exp }, env.SESSION_SECRET);
  return redirect(`${origin}/`, 303, [clearState, cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS)]);
}

export function createHandler(
  githubFetch: GitHubFetch = fetch,
  modelFetch: ModelFetch = fetch,
): (request: Request, env: WorkerEnv, context?: ExecutionContext) => Promise<Response> {
  return async (request: Request, env: WorkerEnv, context?: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url);
    const origin = siteOrigin(env);
    if (!origin) return htmlResponse("<h1>网站配置错误</h1><p>请联系管理员。</p>", 500);

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: securityHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8" })),
      });
    }
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204, headers: securityHeaders() });
    if (url.pathname === "/internal/github-membership") return handleOrganizationWebhook(request, env);
    if (url.pathname === "/login") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
      }
      let allowlist: AllowlistPageState;
      try {
        allowlist = await prepareAllowlistPage(
          env,
          githubFetch,
          context,
          url.searchParams.get("retry") === "1",
        );
      } catch {
        allowlist = { status: "error" };
      }
      return loginPage(undefined, [], allowlist);
    }

    if (url.pathname === "/auth/login") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
      try {
        if (!await allowlistIsFresh(env)) return redirect(`${origin}/login`);
      } catch {
        return loginPage("访问名单核验暂时失败，请重新同步。", [], { status: "error" });
      }
      const state = randomToken();
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", `${origin}/auth/callback`);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("allow_signup", "false");
      return redirect(authorize.toString(), 302, [cookie(STATE_COOKIE, state, STATE_TTL_SECONDS)]);
    }

    if (url.pathname === "/auth/callback") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
      return handleOAuthCallback(request, env, githubFetch);
    }

    if (url.pathname === "/auth/logout") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
      }
      return redirect(`${origin}/login`, 303, [
        cookie(SESSION_COOKIE, "", 0),
        cookie(STATE_COOKIE, "", 0),
      ]);
    }

    const sessionToken = parseCookies(request).get(SESSION_COOKIE);
    const session = sessionToken ? await verifySession(sessionToken, env.SESSION_SECRET) : null;
    if (!session) return redirect(`${origin}/login`);

    let allowed: boolean;
    try {
      allowed = await isAllowlisted(env, session.githubId);
    } catch {
      return htmlResponse("<h1>权限核验暂时失败</h1><p>请稍后刷新页面。</p>", 503);
    }
    if (!allowed) {
      return loginPage("当前 GitHub 账户已不在获准成员名单中。", [cookie(SESSION_COOKIE, "", 0)]);
    }

    if (url.pathname === "/api/me") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
      return jsonResponse({ login: session.login });
    }
    if (url.pathname === "/api/qa/status") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
      return qaStatus(env);
    }
    if (url.pathname === "/api/ask") return handleQaAsk(request, env, session.githubId, modelFetch);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: securityHeaders() });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = securityHeaders(new Headers(assetResponse.headers));
    return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
  };
}

const handler = createHandler();

export default {
  fetch(request, env, context) {
    return handler(request, env, context);
  },
} satisfies ExportedHandler<WorkerEnv>;
