import { hasPassedAccess } from "./access.js";
import { createKvStore } from "./kv.js";
import { log, logError, traceSpan } from "./observability.js";
import { createResponses } from "./responses.js";
import { isUrlSafe } from "./safety.js";
import { isValidCustomSlug, isValidUrl } from "./validate.js";

export function createShortener({ worker, endpoints, kv }) {
  const responses = createResponses({ worker, endpoints });
  const kvStore = createKvStore({ worker, kv });
  const reservedSlugSet = new Set(worker.reserved_slugs.map((s) => s.toLowerCase()));
  const { jsonResponse, fetchInterstitial, errorResponse, notFound } = responses;
  const { resolveShortKey } = kvStore;

  function respondToSaveError(errorCode, request) {
    if (errorCode === "CUSTOM_SLUG_EXISTS") {
      return errorResponse("Custom slug already exists", 400, request);
    }
    if (errorCode === "KV_ERROR") {
      return errorResponse("Database error occurred", 500, request);
    }
    return errorResponse("Error: Reach the KV write limitation", 500, request);
  }

  async function validateShortenPayload(body, request) {
    const longUrl = body.url;
    if (!longUrl) return { error: await errorResponse("URL is required", 400, request) };
    if (!isValidUrl(longUrl)) {
      return { error: await errorResponse("Invalid URL format", 400, request) };
    }

    const customSlug = body.custom_slug || null;
    if (!customSlug) return { longUrl, customSlug: null };

    if (!worker.custom_link) {
      return { error: await errorResponse("Custom URLs are disabled", 400, request) };
    }
    if (!isValidCustomSlug(customSlug, worker, reservedSlugSet)) {
      return { error: await errorResponse("Invalid custom slug format", 400, request) };
    }
    return { longUrl, customSlug };
  }

  async function handleShorten(
    request,
    requestURL,
    { apiPath = "/", allowedApiPaths = ["/"], requireAccess = true } = {}
  ) {
    return traceSpan("shorten", async (span) => {
      if (span.isTraced) span.setAttribute("api.path", apiPath);

      const allowedPaths =
        allowedApiPaths instanceof Set ? allowedApiPaths : new Set(allowedApiPaths);
      if (!allowedPaths.has(apiPath)) {
        return jsonResponse({ status: 404, message: "Invalid API path" }, 404);
      }

      if (requireAccess && !hasPassedAccess(request)) {
        log("warn", "shorten.access_denied", { api: { path: apiPath } });
        return errorResponse("You must use WARP to shorten the URL", 403, request);
      }

      let body;
      try {
        body = await request.json();
      } catch (error) {
        logError("shorten.invalid_json", error, { api: { path: apiPath } });
        return errorResponse("Invalid JSON format", 400, request);
      }

      const validated = await validateShortenPayload(body, request);
      if (validated.error) return validated.error;

      const [errorCode, key] = await resolveShortKey(validated.longUrl, validated.customSlug);
      if (errorCode === undefined) {
        log("info", "shorten.created", {
          key,
          custom_slug: Boolean(validated.customSlug),
        });
        return jsonResponse({ short_url: `${requestURL.origin}/${key}` }, 201);
      }
      log("warn", "shorten.save_failed", { error_code: errorCode });
      return respondToSaveError(errorCode, request);
    });
  }

  async function handleShortUrlRedirect(path, params, suffix = null) {
    return traceSpan("redirect", async (span) => {
      const key = suffix ? `${path}/${suffix}` : path;
      if (span.isTraced) span.setAttribute("shortlink.key", key || "");

      if (!key) return notFound();

      const value = await kv.get(key);
      if (!value) {
        log("info", "redirect.not_found", { key });
        return notFound();
      }

      const destination = params ? value + params : value;

      if (worker.safe_browsing_api_key && !(await isUrlSafe(destination, worker, endpoints))) {
        log("warn", "redirect.unsafe_url", { key });
        return fetchInterstitial(endpoints.safeBrowsingWarning, destination);
      }
      if (worker.no_ref === "on") {
        return fetchInterstitial(endpoints.noRefPage, destination);
      }
      log("info", "redirect.success", { key });
      return Response.redirect(destination, 302);
    });
  }

  return {
    ...responses,
    handleShorten,
    handleShortUrlRedirect,
  };
}
