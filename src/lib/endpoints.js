function httpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function pageUrl(path, base) {
  if (!base) return null;
  try {
    return new URL(path, base).href;
  } catch {
    return null;
  }
}

/** Build optional legacy hosted-page URLs from a frontend config object. */
export function endpointsFromFrontend(frontend = {}) {
  const shortenPage = httpUrl(frontend.url);
  const pagesBase = httpUrl(frontend.pagesBase) || shortenPage;
  return {
    shortenPage,
    frontendOrigin: shortenPage ? new URL(shortenPage).origin : null,
    notFoundPage: pageUrl("404.html", pagesBase),
    errorPage: pageUrl("error.html", pagesBase),
    safeBrowsingWarning: pageUrl("safe-browsing-warning.html", pagesBase),
    noRefPage: pageUrl("no-ref-page.html", pagesBase),
    safeBrowsing: "https://safebrowsing.googleapis.com/v4/threatMatches:find",
  };
}
