import { authorizeSettingsRequest, hasPassedAccess } from "./access.js";
import { createFlagManagement } from "./flag-management.js";
import { flagEvaluationFields, log } from "./observability.js";

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

export function createFlagRoutes({
  prefix,
  shorteningPath,
  pageUrl,
  shortener,
  env,
  adapter,
  verifyToken,
  allowedOrigins = [],
  fetchSettingsShell,
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
  const renderSettingsShell = fetchSettingsShell || (() => shortener.fetchHostedPage(pageUrl));
  const apiPrefix = `${settingsPrefix}/api`;

  async function handleSettings(request, path) {
    if (isPathWithin(path, apiPrefix))
      return management.handle(request, managementRoute(path, apiPrefix));

    if (!isPathWithin(path, settingsPrefix)) return null;
    if (!["GET", "HEAD"].includes(request.method))
      return shortener.errorResponse("Method not allowed", 405, request);

    const authorization = await authorizeSettingsRequest(request, env, {
      verifyToken,
      allowedOrigins: trustedOrigins,
    });
    if (!authorization.ok)
      return shortener.errorResponse("Access denied", authorization.status, request);
    return renderSettingsShell(request);
  }

  async function evaluateShortening(request, path) {
    if (request.method !== "GET" || !hasPassedAccess(request, env)) return null;
    if (path !== shorteningPath) return null;
    const country = request.cf?.country;
    const decision = await adapter.evaluate(country);
    log("info", "flagship.evaluation", flagEvaluationFields(decision));
    return decision.outcome === "matched" ? Response.redirect(decision.destination, 302) : null;
  }

  return { settingsPrefix, handleSettings, evaluateShortening };
}
