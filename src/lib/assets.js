const ROOT_ASSET_PATHS = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/index.html",
  "/manifest.webmanifest",
  "/robots.txt",
]);
const ASSET_PREFIX = "/assets/";

function unavailableResponse() {
  return new Response("Frontend assets are unavailable", {
    status: 503,
    headers: { "content-type": "text/plain;charset=UTF-8" },
  });
}

function hasUnsafeAssetSegment(pathname) {
  let decoded = pathname;
  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return true;
  }

  if (decoded.includes("%") || decoded.includes("\0") || decoded.includes("\\")) return true;
  return decoded
    .split("/")
    .slice(2)
    .some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."));
}

export function isFrontendAssetPath(pathname) {
  const candidate = String(pathname || "");
  if (ROOT_ASSET_PATHS.has(candidate)) return true;
  if (!candidate.startsWith(ASSET_PREFIX) || candidate === ASSET_PREFIX) return false;
  return !hasUnsafeAssetSegment(candidate);
}

function requestForAsset(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

/** Fetch a known built frontend asset without exposing request paths to a filesystem API. */
export async function fetchFrontendAsset(env, request, pathname = "/") {
  if (typeof env?.ASSETS?.fetch !== "function") return unavailableResponse();

  try {
    return await env.ASSETS.fetch(requestForAsset(request, pathname));
  } catch {
    return unavailableResponse();
  }
}
