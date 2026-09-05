import { describe, expect, it, vi } from "vitest";
import { authorizeSettingsRequest, createCsrfToken, verifyAccessJwt } from "../src/lib/access.js";

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signedToken(env, payload = {}, header = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const encodedHeader = encodeJson({ alg: "RS256", kid: "test-key", ...header });
  const encodedPayload = encodeJson({
    iss: env.CF_ACCESS_ISSUER,
    aud: env.CF_ACCESS_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...payload,
  });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  jwk.kid = header.kid || "test-key";
  return {
    token: `${encodedHeader}.${encodedPayload}.${encodeBase64Url(signature)}`,
    jwk,
  };
}

function accessEnv() {
  const suffix = crypto.randomUUID();
  return {
    CF_ACCESS_ISSUER: `https://team-${suffix}.cloudflareaccess.com`,
    CF_ACCESS_AUDIENCE: "test-audience",
    CF_ACCESS_JWKS_URL: `https://jwks.test/${suffix}`,
  };
}

function authorizedRequest(url, options = {}) {
  return new Request(`https://short.example${url}`, {
    ...options,
    headers: {
      "Cf-Access-Jwt-Assertion": "token",
      "Cf-Access-Authenticated-User-Email": "operator@example.com",
      ...(options.headers || {}),
    },
  });
}

describe("Access settings authorization", () => {
  it("fails closed when issuer, audience, or token material is missing", async () => {
    expect(await verifyAccessJwt("not-a-jwt", {})).toBe(false);
    const result = await authorizeSettingsRequest(
      new Request("https://short.example/settings"),
      {},
      { verifyToken: vi.fn().mockResolvedValue(false) }
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("maps a verifier failure to access denied", async () => {
    const result = await authorizeSettingsRequest(
      authorizedRequest("/settings"),
      {},
      { verifyToken: vi.fn().mockRejectedValue(new Error("JWKS unavailable")) }
    );
    expect(result).toEqual({ ok: false, status: 403, reason: "access_denied" });
  });

  it("rejects malformed referers instead of throwing", async () => {
    const request = authorizedRequest("/settings", {
      method: "POST",
      headers: {
        Referer: "not a url",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const result = await authorizeSettingsRequest(
      request,
      { FLAGSHIP_CSRF_SECRET: "secret" },
      {
        verifyToken: vi.fn().mockResolvedValue(true),
        mutation: true,
      }
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a same-origin JSON mutation with a valid CSRF token", async () => {
    const env = { FLAGSHIP_CSRF_SECRET: "secret" };
    const request = authorizedRequest("/settings", {
      method: "POST",
      headers: { Origin: "https://short.example", "Content-Type": "application/json" },
      body: "{}",
    });
    request.headers.set("X-CSRF-Token", await createCsrfToken(request, env));

    await expect(
      authorizeSettingsRequest(request, env, {
        verifyToken: vi.fn().mockResolvedValue(true),
        mutation: true,
      })
    ).resolves.toEqual({ ok: true });
  });

  it("accepts a same-origin referer when Origin is unavailable", async () => {
    const env = { FLAGSHIP_CSRF_SECRET: "secret" };
    const request = authorizedRequest("/settings", {
      method: "POST",
      headers: {
        Referer: "https://short.example/settings",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    request.headers.set("X-CSRF-Token", await createCsrfToken(request, env));

    await expect(
      authorizeSettingsRequest(request, env, {
        verifyToken: vi.fn().mockResolvedValue(true),
        mutation: true,
      })
    ).resolves.toEqual({ ok: true });
  });

  it("accepts a configured static frontend origin for credentialed mutations", async () => {
    const env = { FLAGSHIP_CSRF_SECRET: "secret" };
    const request = authorizedRequest("/settings", {
      method: "POST",
      headers: { Origin: "https://pages.example", "Content-Type": "application/json" },
      body: "{}",
    });
    request.headers.set("X-CSRF-Token", await createCsrfToken(request, env));

    await expect(
      authorizeSettingsRequest(request, env, {
        verifyToken: vi.fn().mockResolvedValue(true),
        allowedOrigins: ["https://pages.example"],
        mutation: true,
      })
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    ["missing origin", {}, 403, "origin_denied"],
    ["wrong origin", { Origin: "https://attacker.example" }, 403, "origin_denied"],
    [
      "non-json",
      { Origin: "https://short.example", "Content-Type": "text/plain" },
      415,
      "content_type_required",
    ],
    [
      "missing csrf",
      { Origin: "https://short.example", "Content-Type": "application/json" },
      403,
      "csrf_denied",
    ],
  ])("rejects %s mutation requests", async (_name, headers, status, reason) => {
    const result = await authorizeSettingsRequest(
      authorizedRequest("/settings", { method: "POST", headers, body: "{}" }),
      { FLAGSHIP_CSRF_SECRET: "secret" },
      { verifyToken: vi.fn().mockResolvedValue(true), mutation: true }
    );
    expect(result).toEqual({ ok: false, status, reason });
  });
});

describe("Access JWT verification", () => {
  it("accepts a valid RS256 token and caches its JWKS", async () => {
    const env = accessEnv();
    const { token, jwk } = await signedToken(env);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      })
    );

    await expect(verifyAccessJwt(token, env, { fetchImpl })).resolves.toBe(true);
    await expect(verifyAccessJwt(token, env, { fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed for null claims and extra JWT segments", async () => {
    const env = accessEnv();
    const header = encodeJson({ alg: "RS256", kid: "test-key" });
    const signature = encodeBase64Url(new Uint8Array([1, 2, 3]));
    const nullPayload = `${header}.${encodeJson(null)}.${signature}`;
    const fetchImpl = vi.fn();

    await expect(verifyAccessJwt(nullPayload, env, { fetchImpl })).resolves.toBe(false);
    await expect(verifyAccessJwt(`${nullPayload}.extra`, env, { fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["wrong issuer", { iss: "https://other.cloudflareaccess.com" }],
    ["wrong audience", { aud: "other-audience" }],
    ["not yet valid", { nbf: Math.floor(Date.now() / 1000) + 60 }],
  ])("rejects %s claims before fetching keys", async (_name, payload) => {
    const env = accessEnv();
    const { token } = await signedToken(env, payload);
    const fetchImpl = vi.fn();

    await expect(verifyAccessJwt(token, env, { fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the JWKS endpoint is unavailable", async () => {
    const env = accessEnv();
    const { token } = await signedToken(env);

    await expect(
      verifyAccessJwt(token, env, {
        fetchImpl: vi.fn().mockRejectedValue(new Error("network down")),
      })
    ).resolves.toBe(false);
  });
});
