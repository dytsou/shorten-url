import { fetchFrontendAsset, isFrontendAssetPath } from "./assets.js";
import { createFlagRoutes } from "./flag-routes.js";
import { createFlagshipAdapter } from "./flagship.js";
import { endpointsFromFrontend } from "./endpoints.js";
import { createShortener } from "./shortener.js";
import { createRuntimeConfig } from "./runtime-config.js";

/**
 * Compose the shared Worker request handler.
 *
 * Entrypoints provide only configuration overrides; route behavior lives here
 * so the production and example Workers cannot silently diverge.
 */
export function createWorkerHandler({
  config: fixedConfig,
  configOverrides = {},
  flagshipAdapter,
  verifyToken,
} = {}) {
  return async function workerHandler(request, env = {}) {
    const config = fixedConfig || createRuntimeConfig(env, configOverrides);
    const requestURL = new URL(request.url);
    const endpoints = endpointsFromFrontend(config.frontend);
    const shortener = createShortener({
      worker: config.worker,
      endpoints,
      kv: env.LINKS,
    });
    const flagRoutes = createFlagRoutes({
      prefix: "/settings",
      shorteningPath: "/",
      pageUrl: endpoints.shortenPage,
      shortener,
      env,
      adapter: flagshipAdapter || createFlagshipAdapter(env),
      verifyToken,
      fetchSettingsShell: (shellRequest) => fetchFrontendAsset(env, shellRequest),
    });

    const path = requestURL.pathname.split("/")[1] || "";
    const params = requestURL.search;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: shortener.htmlHeaders() });
    }
    const settingsResponse = await flagRoutes.handleSettings(request, requestURL.pathname);
    if (settingsResponse) return settingsResponse;
    if (request.method === "POST") {
      return shortener.handleShorten(request, requestURL, {
        apiPath: requestURL.pathname,
        allowedApiPaths: ["/", "/shorten"],
      });
    }
    const variantResponse = await flagRoutes.evaluateShortening(request, requestURL.pathname);
    if (variantResponse) return variantResponse;
    if (requestURL.pathname === "/") return fetchFrontendAsset(env, request, "/");
    if (isFrontendAssetPath(requestURL.pathname)) {
      return fetchFrontendAsset(env, request, requestURL.pathname);
    }
    if (
      requestURL.pathname === "/api" ||
      requestURL.pathname.startsWith("/api/") ||
      requestURL.pathname === "/shorten" ||
      requestURL.pathname.startsWith("/shorten/")
    ) {
      return shortener.jsonResponse({ status: 404, message: "API route not found" }, 404);
    }
    return shortener.handleShortUrlRedirect(path, params);
  };
}
