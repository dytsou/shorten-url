/** Build hosted page URLs from a frontend config object. */
export function endpointsFromFrontend(frontend) {
  const pagesBase = frontend.pagesBase || frontend.url;
  return {
    shortenPage: frontend.url,
    notFoundPage: new URL("404.html", pagesBase).href,
    errorPage: new URL("error.html", pagesBase).href,
    safeBrowsingWarning: new URL("safe-browsing-warning.html", pagesBase).href,
    noRefPage: new URL("no-ref-page.html", pagesBase).href,
    safeBrowsing: "https://safebrowsing.googleapis.com/v4/threatMatches:find",
  };
}
