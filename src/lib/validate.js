import { SLUG_PATTERN, URL_PATTERN } from "./constants.js";

export function isValidUrl(url) {
  return typeof url === "string" && url.startsWith("h") && URL_PATTERN.test(url);
}

export function isValidCustomSlug(slug, worker) {
  return (
    SLUG_PATTERN.test(slug) &&
    slug.length >= 1 &&
    slug.length <= worker.max_custom_slug_length &&
    !worker.reserved_slugs.includes(slug.toLowerCase())
  );
}

export function wantsJson(request) {
  const accept = request.headers.get("accept") || "";
  const contentType = request.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}
