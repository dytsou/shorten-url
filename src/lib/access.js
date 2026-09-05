export function hasPassedAccess(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return Boolean(jwt && email);
}

const textEncoder = new TextEncoder();
const jwksCache = new Map();
const JWKS_TTL_MS = 5 * 60 * 1000;

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function issuerFor(env) {
  if (env?.CF_ACCESS_ISSUER) return env.CF_ACCESS_ISSUER.replace(/\/$/, "");
  if (env?.CF_ACCESS_TEAM_DOMAIN) {
    const domain = env.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${domain}${domain.endsWith(".cloudflareaccess.com") ? "" : ".cloudflareaccess.com"}`;
  }
  return null;
}

export async function verifyAccessJwt(token, env, { fetchImpl = globalThis.fetch } = {}) {
  const segments = String(token).split(".");
  if (segments.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const issuer = issuerFor(env);
  const audience = env?.CF_ACCESS_AUDIENCE;
  const jwksUrl = env?.CF_ACCESS_JWKS_URL || (issuer ? `${issuer}/cdn-cgi/access/certs` : null);
  if (!encodedHeader || !encodedPayload || !encodedSignature || !issuer || !audience || !jwksUrl) {
    return false;
  }

  let header;
  let payload;
  try {
    header = decodeJson(encodedHeader);
    payload = decodeJson(encodedPayload);
  } catch {
    return false;
  }
  if (
    !header ||
    typeof header !== "object" ||
    Array.isArray(header) ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return false;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audiences.some((value) => typeof value !== "string")) return false;
  if (
    payload.iss !== issuer ||
    !audiences.includes(audience) ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= now ||
    (payload.nbf !== undefined &&
      (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > now))
  ) {
    return false;
  }

  let keys = jwksCache.get(jwksUrl);
  if (!keys || keys.expiresAt <= Date.now()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetchImpl(jwksUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return false;
      keys = await response.json();
      if (!Array.isArray(keys?.keys)) return false;
      jwksCache.set(jwksUrl, { ...keys, expiresAt: Date.now() + JWKS_TTL_MS });
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
  const jwk = keys?.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      decodeBase64Url(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
  } catch {
    return false;
  }
}

async function hmac(secret, value, usage) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
  return crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function originFromRequest(request) {
  return new URL(request.url).origin;
}

export async function createCsrfToken(request, env) {
  const secret = env?.FLAGSHIP_CSRF_SECRET;
  const email = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  if (!secret || !email) return null;
  return base64Url(await hmac(secret, `${originFromRequest(request)}\n${email}`, ["sign"]));
}

export async function verifyCsrfToken(request, env, token) {
  const secret = env?.FLAGSHIP_CSRF_SECRET;
  const email = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  if (!secret || !email || typeof token !== "string") return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(token),
      textEncoder.encode(`${originFromRequest(request)}\n${email}`)
    );
  } catch {
    return false;
  }
}

export async function authorizeSettingsRequest(
  request,
  env,
  { verifyToken = verifyAccessJwt, mutation = false, allowedOrigins = [] } = {}
) {
  if (!hasPassedAccess(request)) return { ok: false, status: 403, reason: "access_denied" };
  let validJwt = false;
  try {
    validJwt = await verifyToken(request.headers.get("Cf-Access-Jwt-Assertion"), env);
  } catch {
    validJwt = false;
  }
  if (!validJwt) return { ok: false, status: 403, reason: "access_denied" };

  if (!mutation) return { ok: true };
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expectedOrigin = originFromRequest(request);
  let suppliedOrigin = origin || null;
  if (!suppliedOrigin && referer) {
    try {
      suppliedOrigin = new URL(referer).origin;
    } catch {
      suppliedOrigin = null;
    }
  }
  const trustedOrigins = new Set([
    expectedOrigin,
    ...(Array.isArray(allowedOrigins) ? allowedOrigins : []),
  ]);
  if (!suppliedOrigin || !trustedOrigins.has(suppliedOrigin)) {
    return { ok: false, status: 403, reason: "origin_denied" };
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, reason: "content_type_required" };
  }
  if (!(await verifyCsrfToken(request, env, request.headers.get("x-csrf-token")))) {
    return { ok: false, status: 403, reason: "csrf_denied" };
  }
  return { ok: true };
}
