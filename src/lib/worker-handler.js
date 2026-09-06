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
export function createWorkerHandler({ config: fixedConfig, configOverrides = {} } = {}) {
  return async function workerHandler(request, env) {
    const config = fixedConfig || createRuntimeConfig(env, configOverrides);
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
    if (!path) return shortener.fetchHostedPage(endpoints.shortenPage);
    return shortener.handleShortUrlRedirect(path, params);
  };
}
