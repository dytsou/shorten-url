import { fetchFrontendAsset, isFrontendAssetPath } from "./assets.js";
import { createFlagRoutes } from "./flag-routes.js";
import { createFlagshipAdapter } from "./flagship.js";
import { endpointsFromFrontend } from "./endpoints.js";
import { createShortener } from "./shortener.js";
import { createRuntimeConfig } from "./runtime-config.js";

const API_DOC_PATHS = new Set(["/api/", "/api/index.html", "/api/openapi.yaml"]);
const ABOUT_DOC_PATHS = new Set(["/about", "/about.html"]);

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
      worker: {
        ...config.worker,
        safe_browsing_api_key: env.SAFE_BROWSING_API_KEY ?? config.worker.safe_browsing_api_key,
      },
      endpoints,
      kv: env.LINKS,
      env,
    });
    const flagRoutes = createFlagRoutes({
      prefix: "/settings",
      shorteningPath: "/",
      pageUrl: endpoints.shortenPage,
      shortener,
      env,
      adapter: flagshipAdapter || createFlagshipAdapter(env),
      verifyToken,
    });

    const path = requestURL.pathname.split("/")[1] || "";
    const params = requestURL.search;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: shortener.htmlHeaders() });
    }
    const settingsResponse = flagRoutes.handleSettings(request, requestURL.pathname);
    if (settingsResponse) return settingsResponse;
    if (request.method === "POST") {
      return shortener.handleShorten(request, requestURL, {
        apiPath: requestURL.pathname,
        allowedApiPaths: ["/", "/shorten"],
      });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (requestURL.pathname === "/api") {
        return Response.redirect(new URL(`/api/${requestURL.search}`, requestURL), 308);
      }
      if (requestURL.pathname === "/about/") {
        return Response.redirect(new URL(`/about${requestURL.search}`, requestURL), 308);
      }
      if (ABOUT_DOC_PATHS.has(requestURL.pathname)) {
        return fetchFrontendAsset(env, request, "/about");
      }
      if (API_DOC_PATHS.has(requestURL.pathname)) {
        return fetchFrontendAsset(env, request, requestURL.pathname);
      }
    }
    const variantResponse = await flagRoutes.evaluateShortening(request, requestURL.pathname, () =>
      fetchFrontendAsset(env, request, "/")
    );
    if (variantResponse) return variantResponse;
    if (requestURL.pathname === "/") return fetchFrontendAsset(env, request, "/");
    if (requestURL.pathname === "/favicon.ico") {
      return Response.redirect(new URL("/favicon.svg", request.url), 302);
    }
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
