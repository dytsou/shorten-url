import { wantsJson } from "./validate.js";

export function createResponses({ worker, endpoints }) {
  function corsHeaders() {
    if (worker.cors !== "on") return {};
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

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders() });
  }

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
