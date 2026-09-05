/**
 * URL Shortener - Cloudflare Worker
 *
 * Configuration is imported from `config/config.js`.
 * Requires a KV namespace bound as `LINKS`.
 *
 * Routes:
 *   OPTIONS *                -> CORS preflight
 *   POST    /                -> create short URL (protected by Cloudflare Access / WARP)
 *   GET     /                -> serve the shortener frontend
 *   GET     /<key>           -> redirect a stored short link
 */

import { createShortener } from "./lib/shortener.js";
import { createFlagshipAdapter } from "./lib/flagship.js";
import { createFlagRoutes } from "./lib/flag-routes.js";
import { endpointsFromFrontend } from "./lib/endpoints.js";
import { withFetchObservability } from "./lib/observability.js";
import config from "../config/config.js";

function getEndpoints() {
  return endpointsFromFrontend(config.frontend);
}

async function fetchHandler(request, env) {
  const workerConfig = {
    ...config.worker,
    safe_browsing_api_key:
      env.SAFE_BROWSING_API_KEY ?? config.worker.safe_browsing_api_key,
  };
  const shortener = createShortener({
    worker: workerConfig,
    endpoints: getEndpoints(),
    kv: env.LINKS,
  });
  const flagRoutes = createFlagRoutes({
    prefix: "/settings",
    shorteningPath: "/",
    pageUrl: getEndpoints().shortenPage,
    shortener,
    env,
    adapter: createFlagshipAdapter(env),
  });

  const requestURL = new URL(request.url);
  const [, path] = requestURL.pathname.split("/");
  const params = requestURL.search;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: shortener.htmlHeaders() });
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (requestURL.pathname === "/api" || requestURL.pathname.startsWith("/api/"))
  ) {
    if (
      requestURL.pathname !== "/api/" &&
      /^\/api(?:\/api)*\/?$/.test(requestURL.pathname)
    ) {
      return Response.redirect(new URL("/api/", requestURL), 308);
    }

    const assetURL = new URL(
      `${requestURL.pathname.slice(1)}${requestURL.search}`,
      config.frontend.url,
    );
    return fetch(new Request(assetURL, { method: request.method }));
  }
  const settingsResponse = await flagRoutes.handleSettings(request, requestURL.pathname);
  if (settingsResponse) return settingsResponse;
  if (request.method === "POST") {
    return shortener.handleShorten(request, requestURL, {
      apiPath: requestURL.pathname,
      allowedApiPaths: ["/"],
    });
  }
  const variantResponse = await flagRoutes.evaluateShortening(request, requestURL.pathname);
  if (variantResponse) return variantResponse;
  if (!path) return shortener.fetchHostedPage(getEndpoints().shortenPage);
  return shortener.handleShortUrlRedirect(path, params);
}

export default withFetchObservability(fetchHandler);
