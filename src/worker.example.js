/**
 * URL Shortener — Cloudflare Worker (template)
 *
 * Copy this file to `src/worker.js` and wire in your config (see README).
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

// ============================================================================
// Configuration
// ============================================================================

let config;

try {
  if (typeof importConfig !== "undefined") {
    config = { ...defaultConfig, ...importConfig };
  } else {
    throw new TypeError(
      "Worker config is missing. Copy config/config.example.js to config/config.js and import it when building worker.js."
    );
  }
} catch (error) {
  console.error("Failed to load worker config:", error);
  throw error;
}

function getEndpoints() {
  return endpointsFromFrontend(config.frontend);
}

async function exampleFetchHandler(request, env) {
  const shortener = createShortener({
    worker: config.worker,
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

export default withFetchObservability(exampleFetchHandler);
