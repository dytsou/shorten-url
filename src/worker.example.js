/**
 * URL Shortener — Cloudflare Worker (template)
 *
 * Copy this file to `src/worker.js` and wire in your config (see README).
 * Service-worker syntax. Requires a KV namespace bound as `LINKS`.
 *
 * Routes:
 *   OPTIONS *                -> CORS preflight
 *   POST    /                -> create short URL (protected by Cloudflare Access / WARP)
 *   GET     /                -> serve the shortener frontend
 *   GET     /<key>           -> redirect a stored short link
 */

// ============================================================================
// Configuration
// ============================================================================

let config;

try {
  if (typeof importConfig !== "undefined") {
    config = { ...defaultConfig, ...importConfig };
  } else {
    throw new Error(
      "Worker config is missing. Copy config/config.example.js to config/config.js and import it when building worker.js."
    );
  }
} catch (error) {
  console.error("Failed to load worker config:", error);
  throw error;
}

const SLUG_PATTERN = /^[a-zA-Z0-9\-_]+$/;
const URL_PATTERN = /http(s)?:\/\/([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?/;

/** Resolve hosted page URLs from `config.frontend`. */
function getEndpoints() {
  // Error/interstitial HTML files may live at the frontend root or a separate Pages path.
  const pagesBase = config.frontend.pagesBase || config.frontend.url;

  return {
    shortenPage: config.frontend.url,
    notFoundPage: new URL("404.html", pagesBase).href,
    errorPage: new URL("error.html", pagesBase).href,
    safeBrowsingWarning: new URL("safe-browsing-warning.html", pagesBase).href,
    noRefPage: new URL("no-ref-page.html", pagesBase).href,
    safeBrowsing: "https://safebrowsing.googleapis.com/v4/threatMatches:find",
  };
}

// ============================================================================
// Response header helpers
// ============================================================================

function corsHeaders() {
  if (config.worker.cors !== "on") return {};
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

function htmlHeaders() {
  return { "content-type": "text/html;charset=UTF-8", ...corsHeaders() };
}

function jsonHeaders() {
  return { "content-type": "application/json;charset=UTF-8", ...corsHeaders() };
}

// ============================================================================
// Utilities
// ============================================================================

function randomString(len = config.worker.min_random_key_length) {
  const chars = config.worker.random_chars;
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sha512(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isValidUrl(url) {
  return typeof url === "string" && url[0] === "h" && URL_PATTERN.test(url);
}

function isValidCustomSlug(slug) {
  return (
    SLUG_PATTERN.test(slug) &&
    slug.length >= 1 &&
    slug.length <= config.worker.max_custom_slug_length &&
    !config.worker.reserved_slugs.includes(slug.toLowerCase())
  );
}

function wantsJson(request) {
  const accept = request.headers.get("accept") || "";
  const contentType = request.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

// ============================================================================
// KV access
// ============================================================================

/**
 * Store a URL under a random or custom key.
 * @returns {Promise<[errorCode: string|undefined, key: string|null]>}
 */
async function saveUrl(url, customSlug = null) {
  try {
    const key = customSlug || randomString();
    const existing = await LINKS.get(key);

    if (existing === null) {
      await LINKS.put(key, url);
      return [undefined, key];
    }
    if (customSlug) {
      return ["CUSTOM_SLUG_EXISTS", null];
    }
    return saveUrl(url);
  } catch (error) {
    console.error("saveUrl failed:", error);
    return ["KV_ERROR", null];
  }
}

async function findUrlKeyByHash(urlHash) {
  return (await LINKS.get(urlHash)) || null;
}

// ============================================================================
// External page / safety helpers
// ============================================================================

async function fetchHostedPage(url, status = 200) {
  const upstream = await fetch(url, { redirect: "follow" });
  return new Response(await upstream.text(), {
    status,
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}

async function fetchInterstitial(url, destination) {
  const upstream = await fetch(url);
  const html = (await upstream.text()).replace(/{Replace}/gm, destination);
  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

function notFound() {
  return fetchHostedPage(getEndpoints().notFoundPage, 404);
}

async function isUrlSafe(url) {
  const endpoints = getEndpoints();
  const body = JSON.stringify({
    client: { clientId: "Url-Shorten-Worker", clientVersion: "1.0.7" },
    threatInfo: {
      threatTypes: [
        "MALWARE",
        "SOCIAL_ENGINEERING",
        "POTENTIALLY_HARMFUL_APPLICATION",
        "UNWANTED_SOFTWARE",
      ],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url }],
    },
  });

  const response = await fetch(
    `${endpoints.safeBrowsing}?key=${config.worker.safe_browsing_api_key}`,
    { method: "POST", body, redirect: "follow" }
  );
  const result = await response.json();
  return Object.keys(result).length === 0;
}

// ============================================================================
// Error responses
// ============================================================================

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders() });
}

async function errorResponse(message, code, request) {
  if (wantsJson(request)) {
    return jsonResponse({ status: code, message }, code);
  }
  const endpoints = getEndpoints();
  const url = `${endpoints.errorPage}?message=${encodeURIComponent(message)}&code=${encodeURIComponent(code)}`;
  return fetchHostedPage(url, code);
}

// ============================================================================
// Access control (Cloudflare Zero Trust / WARP)
// ============================================================================

function hasPassedAccess(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!jwt || !email) return false;

  // To restrict to specific accounts, gate on `email` here.
  return true;
}

// ============================================================================
// Route handlers
// ============================================================================

async function handleShorten(request, requestURL, pathname) {
  // Only allow shortening via the root endpoint.
  if (pathname !== "/") {
    return jsonResponse({ status: 404, message: "Invalid API path" }, 404);
  }

  if (!hasPassedAccess(request)) {
    return errorResponse("You must use WARP to shorten the URL", 403, request);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error("Invalid JSON body:", error);
    return errorResponse("Invalid JSON format", 400, request);
  }

  const longUrl = body.url;
  if (!longUrl) return errorResponse("URL is required", 400, request);
  if (!isValidUrl(longUrl)) return errorResponse("Invalid URL format", 400, request);

  const customSlug = body.custom_slug || null;
  if (customSlug) {
    if (!config.worker.custom_link) {
      return errorResponse("Custom URLs are disabled", 400, request);
    }
    if (!isValidCustomSlug(customSlug)) {
      return errorResponse("Invalid custom slug format", 400, request);
    }
  }

  let errorCode;
  let key;

  if (config.worker.unique_link && !customSlug) {
    const urlHash = await sha512(longUrl);
    const existingKey = await findUrlKeyByHash(urlHash);
    if (existingKey) {
      key = existingKey;
    } else {
      [errorCode, key] = await saveUrl(longUrl);
      if (errorCode === undefined) await LINKS.put(urlHash, key);
    }
  } else {
    [errorCode, key] = await saveUrl(longUrl, customSlug);
  }

  if (errorCode === "CUSTOM_SLUG_EXISTS") {
    return errorResponse("Custom slug already exists", 400, request);
  }
  if (errorCode === "KV_ERROR") {
    return errorResponse("Database error occurred", 500, request);
  }
  if (errorCode === undefined) {
    return jsonResponse({ short_url: `${requestURL.origin}/${key}` }, 201);
  }
  return errorResponse("Error: Reach the KV write limitation", 500, request);
}

async function handleShortUrlRedirect(path, params) {
  if (!path) return notFound();

  const value = await LINKS.get(path);
  if (!value) return notFound();

  const destination = params ? value + params : value;
  const endpoints = getEndpoints();

  if (config.worker.safe_browsing_api_key && !(await isUrlSafe(destination))) {
    return fetchInterstitial(endpoints.safeBrowsingWarning, destination);
  }
  if (config.worker.no_ref === "on") {
    return fetchInterstitial(endpoints.noRefPage, destination);
  }
  return Response.redirect(destination, 302);
}

async function handleGet(path, params) {
  const endpoints = getEndpoints();

  if (path === "") return fetchHostedPage(endpoints.shortenPage);
  return handleShortUrlRedirect(path, params);
}

// ============================================================================
// Router
// ============================================================================

async function handleRequest(request) {
  const requestURL = new URL(request.url);
  const [, path] = requestURL.pathname.split("/");
  const params = requestURL.search;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: htmlHeaders() });
  }
  if (request.method === "POST") {
    return handleShorten(request, requestURL, requestURL.pathname);
  }
  return handleGet(path, params);
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
