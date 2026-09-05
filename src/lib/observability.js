import { tracing } from "cloudflare:workers";

const FLAG_OUTCOMES = new Set(["matched", "unmatched", "unpublished", "failed"]);

function boundedString(value, maxLength) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : null;
}

/** Structured JSON log for Workers Logs indexing. */
export function log(level, event, fields = {}) {
  console.log({ level, event, ts: new Date().toISOString(), ...fields });
}

export function logError(event, error, fields = {}) {
  console.error({
    level: "error",
    event,
    ts: new Date().toISOString(),
    error:
      error instanceof Error
        ? { message: error.message, name: error.name }
        : { message: String(error) },
    ...fields,
  });
}

export function requestFields(request) {
  const url = new URL(request.url);
  return {
    http: {
      method: request.method,
      path: url.pathname,
      ...(url.search ? { query: url.search } : {}),
    },
    ...(request.cf?.colo || request.cf?.country
      ? {
          client: {
            ...(request.cf.colo ? { colo: request.cf.colo } : {}),
            ...(request.cf.country ? { country: request.cf.country } : {}),
          },
        }
      : {}),
  };
}

/** Return only bounded, non-sensitive fields for a Flagship decision log. */
export function flagEvaluationFields(decision) {
  const key = boundedString(decision?.flagKey, 64) || "shorten-routing";
  const outcome = FLAG_OUTCOMES.has(decision?.outcome) ? decision.outcome : "failed";
  const variant = boundedString(decision?.variant, 64);
  const country =
    typeof decision?.country === "string" && /^[A-Za-z]{2}$/.test(decision.country)
      ? decision.country.toUpperCase()
      : null;
  const version = boundedString(decision?.version, 128);
  const fallbackReason = boundedString(decision?.fallbackReason, 128);

  return {
    flagship: {
      key,
      outcome,
      ...(variant ? { variant } : {}),
      ...(country ? { country } : {}),
      ...(version ? { version } : {}),
      ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
    },
    duration_ms:
      typeof decision?.durationMs === "number" && Number.isFinite(decision.durationMs)
        ? Math.max(0, Math.round(decision.durationMs))
        : null,
  };
}

function setRequestSpanAttributes(span, request) {
  if (!span.isTraced) return;
  const url = new URL(request.url);
  span.setAttribute("http.request.method", request.method);
  span.setAttribute("url.path", url.pathname);
  if (request.cf?.colo) span.setAttribute("cf.colo", request.cf.colo);
  if (request.cf?.country) span.setAttribute("cf.country", request.cf.country);
}

/** Wrap a Worker fetch handler with request-level spans and structured logs. */
export function withFetchObservability(handler) {
  async function observedFetch(request, env, ctx) {
    return tracing.enterSpan("fetch", async (span) => {
      const fields = requestFields(request);
      setRequestSpanAttributes(span, request);
      log("info", "request.start", fields);

      try {
        const response = await handler(request, env, ctx);
        const status = response.status;
        if (span.isTraced) span.setAttribute("http.response.status_code", status);
        log("info", "request.complete", {
          ...fields,
          http: { ...fields.http, status },
        });
        return response;
      } catch (error) {
        logError("request.error", error, fields);
        throw error;
      }
    });
  }

  return { fetch: observedFetch };
}

/** Run async work inside a named custom span. */
export function traceSpan(name, fn, attributes = {}) {
  return tracing.enterSpan(name, async (span) => {
    if (span.isTraced) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) span.setAttribute(key, value);
      }
    }
    return fn(span);
  });
}
