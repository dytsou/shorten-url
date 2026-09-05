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

export function createFlagRoutes({
  prefix,
  shorteningPath,
  pageUrl,
  shortener,
  env,
  adapter,
  verifyToken,
  allowedOrigins = [],
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

  async function handleSettings(request, path) {
    if (path === settingsPrefix) {
      if (request.method !== "GET")
        return shortener.errorResponse("Method not allowed", 405, request);
      const authorization = await authorizeSettingsRequest(request, env, {
        verifyToken,
        allowedOrigins: trustedOrigins,
      });
      if (!authorization.ok)
        return shortener.errorResponse("Access denied", authorization.status, request);
      return shortener.fetchHostedPage(pageUrl);
    }
    const apiPrefix = `${settingsPrefix}/api`;
    if (!path.startsWith(`${apiPrefix}/`)) return null;
    const suffix = path.slice(`${apiPrefix}/`.length);
    if (suffix === "csrf") return management.handle(request, "csrf");
    if (suffix === "flags") return management.handle(request, "flags");
    if (suffix === "flag") return management.handle(request, "flag");
    if (suffix === "flag/shorten-routing")
      return management.handle(request, "flag:shorten-routing");
    if (suffix === "flag/shorten-routing/publish") {
      return management.handle(request, "publish:shorten-routing");
    }
    return management.handle(request, "unknown");
  }

  async function evaluateShortening(request, path) {
    if (request.method !== "GET" || !hasPassedAccess(request)) return null;
    if (path !== shorteningPath) return null;
    const country = request.cf?.country;
    const decision = await adapter.evaluate(country);
    log("info", "flagship.evaluation", flagEvaluationFields(decision));
    return decision.outcome === "matched" ? Response.redirect(decision.destination, 302) : null;
  }

  return { settingsPrefix, handleSettings, evaluateShortening };
}
