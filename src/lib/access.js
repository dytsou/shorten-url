function allowedHosts(env) {
  return new Set(
    String(env?.ACCESS_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAllowedAccessHost(request, env) {
  const hosts = allowedHosts(env);
  return hosts.size === 0 || hosts.has(new URL(request.url).hostname.toLowerCase());
}

export function hasPassedAccess(request, env) {
  if (!isAllowedAccessHost(request, env)) return false;
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return Boolean(jwt && email);
}

const textEncoder = new TextEncoder();
const jwksCache = new Map();
const JWKS_TTL_MS = 5 * 60 * 1000;

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.codePointAt(0));
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

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeAccessToken(token, env) {
  const segments = String(token).split(".");
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const issuer = issuerFor(env);
  const audience = env?.CF_ACCESS_AUDIENCE;
  const jwksUrl = env?.CF_ACCESS_JWKS_URL || (issuer ? `${issuer}/cdn-cgi/access/certs` : null);
  if (!encodedHeader || !encodedPayload || !encodedSignature || !issuer || !audience || !jwksUrl) {
    return null;
  }

  try {
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedPayload);
    if (!isObjectRecord(header) || !isObjectRecord(payload)) return null;
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    return {
      encodedHeader,
      encodedPayload,
      encodedSignature,
      header,
      payload,
      issuer,
      audience,
      jwksUrl,
    };
  } catch {
    return null;
  }
}

function hasValidAccessClaims({ payload, issuer, audience }) {
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audiences.some((value) => typeof value !== "string")) return false;
  if (payload.iss !== issuer || !audiences.includes(audience)) return false;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now) {
    return false;
  }
  if (
    payload.nbf !== undefined &&
    (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > now)
  ) {
    return false;
  }
  return true;
}

async function loadJwks(jwksUrl, fetchImpl) {
  let keys = jwksCache.get(jwksUrl);
  if (keys && keys.expiresAt > Date.now()) return keys;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetchImpl(jwksUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    keys = await response.json();
    if (!Array.isArray(keys?.keys)) return null;
    jwksCache.set(jwksUrl, { ...keys, expiresAt: Date.now() + JWKS_TTL_MS });
    return jwksCache.get(jwksUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyAccessSignature(
  { encodedHeader, encodedPayload, encodedSignature, header },
  keys
) {
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

export async function verifyAccessJwt(token, env, { fetchImpl = globalThis.fetch } = {}) {
  const decoded = decodeAccessToken(token, env);
  if (!decoded || !hasValidAccessClaims(decoded)) return false;
  const keys = await loadJwks(decoded.jwksUrl, fetchImpl);
  if (!keys) return false;
  return verifyAccessSignature(decoded, keys);
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
  for (const byte of new Uint8Array(bytes)) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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
  if (!hasPassedAccess(request, env)) return { ok: false, status: 403, reason: "access_denied" };
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
