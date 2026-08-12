export const PRODUCTION_ORIGIN = "https://dsh.hiwangjie.com";

export const PROTECTED_ENDPOINTS = [
  { name: "home", pathname: "/", init: {} },
  { name: "content", pathname: "/api/content/manifest", init: {} },
  { name: "qaStatus", pathname: "/api/qa/status", init: {} },
  {
    name: "ask",
    pathname: "/api/ask",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  },
];

export const RETRY_DELAYS_MS = [0, 15_000, 30_000];

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isLoginRedirect(response, origin = PRODUCTION_ORIGIN) {
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  const location = response.headers.get("location");
  if (!location) return false;
  const expectedOrigin = new URL(origin).origin;
  const redirect = new URL(location, expectedOrigin);
  return redirect.origin === expectedOrigin && redirect.pathname === "/login";
}

export async function requestWithRetry(
  fetchImpl,
  input,
  init = {},
  {
    delays = RETRY_DELAYS_MS,
    timeoutMs = 20_000,
    sleep = pause,
  } = {},
) {
  let lastError = new Error("production gate request failed");
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      const response = await fetchImpl(input, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status >= 500 && response.status <= 599) {
        lastError = new Error(`production gate returned ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function inspectOAuth(response, origin = PRODUCTION_ORIGIN) {
  const location = response.headers.get("location");
  const oauthUrl = location ? new URL(location, origin) : null;
  const scope = oauthUrl?.searchParams.get("scope") ?? "";
  const stateCookie = response.headers.get("set-cookie") ?? "";
  return {
    status: response.status,
    githubRedirect: oauthUrl?.origin === "https://github.com",
    scopePresent: Boolean(oauthUrl?.searchParams.has("scope")),
    organizationScope: /(?:^|[ ,])(?:read:org|write:org|admin:org)(?:$|[ ,])/iu.test(scope),
    statePresent: Boolean(oauthUrl?.searchParams.get("state")),
    stateCookie: /HttpOnly/iu.test(stateCookie) && /SameSite=Lax/iu.test(stateCookie),
  };
}

export async function auditProductionGate(
  fetchImpl = fetch,
  {
    origin = PRODUCTION_ORIGIN,
    request = requestWithRetry,
  } = {},
) {
  if (new URL(origin).origin !== PRODUCTION_ORIGIN) {
    throw new Error("production gate origin must match the canonical Pages custom domain");
  }

  const gates = {};
  for (const endpoint of PROTECTED_ENDPOINTS) {
    const response = await request(fetchImpl, `${origin}${endpoint.pathname}`, endpoint.init);
    gates[endpoint.name] = {
      status: response.status,
      blocked: isLoginRedirect(response, origin),
    };
  }

  let oauthResponse = await request(fetchImpl, `${origin}/auth/login`);
  let oauthMode = "direct";
  if (isLoginRedirect(oauthResponse, origin)) {
    oauthResponse = await request(fetchImpl, `${origin}/auth/login?fallback=1`);
    oauthMode = "verified-active-list-fallback";
  }
  const oauth = { mode: oauthMode, ...inspectOAuth(oauthResponse, origin) };
  const passed = Object.values(gates).every((gate) => gate.blocked)
    && oauth.githubRedirect
    && !oauth.scopePresent
    && !oauth.organizationScope
    && oauth.statePresent
    && oauth.stateCookie;

  return { origin, gates, oauth, passed };
}
