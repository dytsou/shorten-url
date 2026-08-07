import { tracing } from "cloudflare:workers";

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
