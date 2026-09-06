import { wantsJson } from "./validate.js";

function withHostedPageBase(html, url) {
  if (!/<head\b/i.test(html) || /<base\b/i.test(html)) return html;
  let baseUrl;
  try {
    baseUrl = new URL(".", url).href;
  } catch {
    return html;
  }
  const escapedBaseUrl = baseUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return html.replace(/<head\b[^>]*>/i, (head) => `${head}<base href="${escapedBaseUrl}">`);
}

async function fetchHostedPage(url, status = 200) {
  if (!url) {
    return new Response("Page is not configured", {
      status,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  }
  const upstream = await fetch(url, { redirect: "follow" });
  const html = withHostedPageBase(await upstream.text(), url);
  return new Response(html, {
    status,
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}

async function fetchInterstitial(url, destination) {
  if (!url) {
    return new Response("Redirect interstitial is not configured", {
      status: 503,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  }
  const upstream = await fetch(url);
  const html = (await upstream.text()).replace(/{Replace}/gm, destination);
  return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

export function createResponses({ worker, endpoints }) {
  function corsHeaders() {
    if (worker.cors !== "on") return {};
    let allowedOrigin = endpoints.frontendOrigin || "";
    if (!allowedOrigin && endpoints.shortenPage) {
      try {
        allowedOrigin = new URL(endpoints.shortenPage).origin;
      } catch {
        allowedOrigin = "";
      }
    }
    allowedOrigin ||= "*";
    return {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
      ...(allowedOrigin === "*" ? {} : { "Access-Control-Allow-Credentials": "true" }),
    };
  }

  function htmlHeaders() {
    return { "content-type": "text/html;charset=UTF-8", ...corsHeaders() };
  }

  function jsonHeaders() {
    return { "content-type": "application/json;charset=UTF-8", ...corsHeaders() };
  }

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders() });
  }

  async function errorResponse(message, code, request) {
    if (wantsJson(request) || !endpoints.errorPage) {
      return jsonResponse({ status: code, message }, code);
    }
    const url = `${endpoints.errorPage}?message=${encodeURIComponent(message)}&code=${encodeURIComponent(code)}`;
    return fetchHostedPage(url, code);
  }

  function notFound() {
    if (!endpoints.notFoundPage) {
      return jsonResponse({ status: 404, message: "URL not found" }, 404);
    }
    return fetchHostedPage(endpoints.notFoundPage, 404);
  }

  return {
    corsHeaders,
    htmlHeaders,
    jsonHeaders,
    jsonResponse,
    fetchHostedPage,
    fetchInterstitial,
    errorResponse,
    notFound,
  };
}
