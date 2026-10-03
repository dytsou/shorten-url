import { hasPassedAccess } from "./access.js";
import { createFlagManagement } from "./flag-management.js";
import { flagEvaluationFields, log } from "./observability.js";

const TARGETING_KEY_COOKIE = "shorten-url-targeting-key";
const TARGETING_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function normalizePrefix(prefix) {
  return `/${String(prefix || "").replace(/^\/|\/$/g, "")}`;
}

function originFromPageUrl(pageUrl) {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

function isPathWithin(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function managementRoute(path, apiPrefix) {
  const suffix = path === apiPrefix ? "" : path.slice(`${apiPrefix}/`.length);
  const routes = {
    csrf: "csrf",
    flags: "flags",
    flag: "flag",
    "flag/shorten-routing": "flag:shorten-routing",
    "flag/shorten-routing/publish": "publish:shorten-routing",
  };
  return routes[suffix] || "unknown";
}

function targetingKeyFromRequest(request) {
  const cookie = request.headers.get("Cookie") || "";
  for (const entry of cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== TARGETING_KEY_COOKIE) continue;
    const value = entry.slice(separator + 1).trim();
    return TARGETING_KEY_PATTERN.test(value) ? value : null;
  }
  return null;
}

function setTargetingKeyCookie(response, targetingKey) {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${TARGETING_KEY_COOKIE}=${targetingKey}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createFlagRoutes({
  prefix,
  shorteningPath,
  pageUrl,
  shortener,
  env,
  adapter,
  verifyToken,
  allowedOrigins = [],
  createTargetingKey = () => globalThis.crypto.randomUUID(),
}) {
  const settingsPrefix = normalizePrefix(prefix);
  const pageOrigin = originFromPageUrl(pageUrl);
  const trustedOrigins = [
    ...new Set(
      [pageOrigin, ...(Array.isArray(allowedOrigins) ? allowedOrigins : [])].filter(Boolean)
    ),
  ];
  const management = createFlagManagement({
    adapter,
    responses: shortener,
    env,
    verifyToken,
    allowedOrigins: trustedOrigins,
  });
  const apiPrefix = `${settingsPrefix}/api`;

  function handleSettings(request, path) {
    if (!isPathWithin(path, settingsPrefix)) return null;
    if (!isPathWithin(path, apiPrefix)) {
      return shortener.jsonResponse({ status: 404, message: "Settings route not found" }, 404);
    }
    return management.handle(request, managementRoute(path, apiPrefix));
  }

  async function evaluateShortening(request, path, fallbackResponse) {
    if (request.method !== "GET" || !hasPassedAccess(request, env)) return null;
    if (path !== shorteningPath) return null;
    const country = request.cf?.country;
    const existingTargetingKey = targetingKeyFromRequest(request);
    const targetingKey = existingTargetingKey || createTargetingKey();
    const decision = await adapter.evaluate(country, { targetingKey });
    log("info", "flagship.evaluation", flagEvaluationFields(decision));
    const response =
      decision.outcome === "matched"
        ? Response.redirect(decision.destination, 302)
        : typeof fallbackResponse === "function"
          ? await fallbackResponse()
          : null;
    if (!response || existingTargetingKey) return response;
    return setTargetingKeyCookie(response, targetingKey);
  }

  return { handleSettings, evaluateShortening };
}
