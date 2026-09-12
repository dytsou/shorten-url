/**
 * URL Shortener — Cloudflare Worker (template)
 *
 * Example Worker entrypoint. Production uses the tracked `src/worker.js`.
 * Requires a KV namespace bound as `LINKS`.
 *
 * Routes:
 *   OPTIONS *                -> CORS preflight
 *   POST    /shorten         -> create short URL (protected by Cloudflare Access / WARP)
 *   POST    /                -> compatibility create-short-URL endpoint
 *   GET     /                -> serve the Worker-hosted tabbed frontend
 *   *       /settings/api/*  -> Access-protected Flagship management API
 *   GET     /<key>           -> redirect a stored short link
 */

import { withFetchObservability } from "./lib/observability.js";
import { createWorkerHandler } from "./lib/worker-handler.js";

export const exampleFetchHandler = createWorkerHandler();

export default withFetchObservability(exampleFetchHandler);
