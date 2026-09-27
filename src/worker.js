/**
 * URL Shortener - Cloudflare Worker
 *
 * Configuration is imported from `config/config.js`.
 * Requires a KV namespace bound as `LINKS`.
 *
 * Routes:
 *   OPTIONS *                -> CORS preflight
 *   POST    /shorten         -> create short URL (protected by Cloudflare Access / WARP)
 *   GET     /                -> serve the shortener frontend
 *   GET     /<key>           -> redirect a stored short link
 */

import { createShortener } from "./lib/shortener.js";
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
  if (request.method === "POST") {
    return shortener.handleShorten(request, requestURL, {
      apiPath: requestURL.pathname,
      allowedApiPaths: ["/shorten"],
    });
  }
  if (!path) return shortener.fetchHostedPage(getEndpoints().shortenPage);
  return shortener.handleShortUrlRedirect(path, params);
}

export default withFetchObservability(fetchHandler);
