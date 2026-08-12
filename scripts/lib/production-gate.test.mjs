import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_ORIGIN,
  auditProductionGate,
  isLoginRedirect,
  requestWithRetry,
} from "./production-gate.mjs";

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, ...headers } });
}

describe("production gate audit", () => {
  it("locks the audit to the Pages custom production domain", async () => {
    expect(PRODUCTION_ORIGIN).toBe("https://dsh.hiwangjie.com");
    await expect(auditProductionGate(vi.fn(), { origin: "https://legacy.example.com" }))
      .rejects.toThrow("canonical Pages custom domain");
  });

  it("recognizes only same-origin login redirects", () => {
    expect(isLoginRedirect(redirect("/login"))).toBe(true);
    expect(isLoginRedirect(redirect(`${PRODUCTION_ORIGIN}/login`))).toBe(true);
    expect(isLoginRedirect(redirect("https://example.com/login"))).toBe(false);
    expect(isLoginRedirect(new Response("login", { status: 200 }))).toBe(false);
  });

  it("validates all anonymous gates and zero-scope OAuth fallback", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/login" && url.searchParams.get("fallback") === "1") {
        return redirect(
          "https://github.com/login/oauth/authorize?client_id=test&state=opaque&allow_signup=false",
          { "set-cookie": "__Host-portal_oauth_state=opaque; HttpOnly; Secure; SameSite=Lax" },
        );
      }
      return redirect(`${PRODUCTION_ORIGIN}/login`);
    });
    const request = (impl, input, init) => impl(input, init);

    const result = await auditProductionGate(fetchImpl, { request });

    expect(result.passed).toBe(true);
    expect(Object.values(result.gates).every((gate) => gate.blocked)).toBe(true);
    expect(result.oauth).toMatchObject({
      mode: "verified-active-list-fallback",
      githubRedirect: true,
      scopePresent: false,
      organizationScope: false,
      statePresent: true,
      stateCookie: true,
    });
  });

  it("rejects OAuth requests that include an organization scope", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/login" && url.searchParams.get("fallback") === "1") {
        return redirect(
          "https://github.com/login/oauth/authorize?client_id=test&state=opaque&scope=read%3Aorg",
          { "set-cookie": "__Host-portal_oauth_state=opaque; HttpOnly; Secure; SameSite=Lax" },
        );
      }
      return redirect(`${PRODUCTION_ORIGIN}/login`);
    });
    const request = (impl, input, init) => impl(input, init);

    const result = await auditProductionGate(fetchImpl, { request });

    expect(result.passed).toBe(false);
    expect(result.oauth.organizationScope).toBe(true);
  });

  it("retries transient errors at the configured boundaries", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn(async () => {});

    const response = await requestWithRetry(fetchImpl, PRODUCTION_ORIGIN, {}, {
      delays: [0, 15_000, 30_000],
      sleep,
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[15_000], [30_000]]);
  });
});
