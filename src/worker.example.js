/**
 * URL Shortener — Cloudflare Worker (template)
 *
 * Example Worker entrypoint. Production uses the tracked `src/worker.js`.
 * Requires a KV namespace bound as `LINKS`.
 *
 * Routes:
 *   OPTIONS *                -> CORS preflight
 *   POST    /                -> create short URL (protected by Cloudflare Access / WARP)
 *   GET     /                -> serve the shortener frontend
 *   GET     /<key>           -> redirect a stored short link
 */

import { withFetchObservability } from "./lib/observability.js";
import { createWorkerHandler } from "./lib/worker-handler.js";

export const exampleFetchHandler = createWorkerHandler();

export default withFetchObservability(exampleFetchHandler);
