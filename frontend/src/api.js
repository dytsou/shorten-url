export const DEFAULT_SETTINGS_PATH = "/settings";
export const DEFAULT_SHORTEN_PATH = "/shorten";

const FALLBACK_ORIGIN = "http://localhost";

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function readMeta(documentRef, name) {
  const element = documentRef?.querySelector?.(`meta[name="${name}"]`);
  return element?.getAttribute?.("content")?.trim() || "";
}

function readEnv(env, key) {
  return typeof env?.[key] === "string" ? env[key].trim() : "";
}

function normalizeOrigin(value, fallback) {
  if (!value) return fallback;

  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return fallback;
    }
    return url.origin;
  } catch {
    return fallback;
  }
}

export function normalizePath(value, fallback = "/") {
  const candidate = String(value || "").trim();
  if (!candidate || !candidate.startsWith("/")) return fallback;

  try {
    const url = new URL(candidate, "https://shorten-url.invalid");
    if (url.search || url.hash) return fallback;
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return fallback;
  }
}

export function createFrontendConfig({
  windowRef = typeof window === "undefined" ? undefined : window,
  documentRef = typeof document === "undefined" ? undefined : document,
  env = import.meta.env || {},
} = {}) {
  const currentOrigin = windowRef?.location?.origin || FALLBACK_ORIGIN;
  const configuredOrigin = firstNonEmpty(
    readEnv(env, "VITE_WORKER_ORIGIN"),
    readMeta(documentRef, "shorten-url-worker-origin")
  );
  const pathname = windowRef?.location?.pathname || "/";
  const currentPath = normalizePath(pathname, "/");
  const isDevRoute = currentPath === "/shorten" || currentPath === "/shorten/settings";
  const defaultHomePath = isDevRoute ? "/shorten" : "/";
  const homePath = normalizePath(
    firstNonEmpty(
      readEnv(env, "VITE_WORKER_HOME_PATH"),
      readMeta(documentRef, "shorten-url-home-path")
    ),
    defaultHomePath
  );
  const defaultSettingsPath = isDevRoute ? "/shorten/settings" : DEFAULT_SETTINGS_PATH;
  const settingsPath = normalizePath(
    firstNonEmpty(
      readEnv(env, "VITE_WORKER_SETTINGS_PATH"),
      readMeta(documentRef, "shorten-url-settings-path")
    ),
    defaultSettingsPath
  );
  const shortenApiPath = normalizePath(
    firstNonEmpty(
      readEnv(env, "VITE_WORKER_SHORTEN_PATH"),
      readMeta(documentRef, "shorten-url-shorten-path")
    ),
    DEFAULT_SHORTEN_PATH
  );

  return {
    workerOrigin: normalizeOrigin(configuredOrigin, currentOrigin),
    workerOriginConfigured: Boolean(configuredOrigin),
    homePath,
    settingsPath,
    shortenApiPath,
    pathname,
  };
}

export function isSettingsRoute(pathname, settingsPath) {
  const currentPath = normalizePath(pathname, "/");
  const configuredPath = normalizePath(settingsPath, DEFAULT_SETTINGS_PATH);
  return currentPath === configuredPath || currentPath.startsWith(`${configuredPath}/`);
}

export function workerUrl(path, config) {
  const workerOrigin = config?.workerOrigin || FALLBACK_ORIGIN;
  const normalizedPath = normalizePath(path, "/");
  return new URL(normalizedPath, `${workerOrigin}/`).href;
}

export function settingsApiUrl(endpoint, config) {
  const suffix = String(endpoint || "").startsWith("/") ? endpoint : `/${endpoint}`;
  return workerUrl(`${config.settingsPath}/api${suffix}`, config);
}

export class WorkerApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "WorkerApiError";
    this.status = status;
    this.body = body;
  }
}

export function errorMessage(body, status, fallback = "The request could not be completed") {
  const message =
    typeof body?.message === "string"
      ? body.message.trim()
      : typeof body?.error === "string"
        ? body.error.trim()
        : "";
  if (message) return message;
  return status ? `${fallback} (${status})` : fallback;
}

async function readResponseBody(response) {
  if (typeof response?.text === "function") {
    const raw = await response.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return { message: raw.slice(0, 240) };
    }
  }
  if (typeof response?.json === "function") return response.json();
  return {};
}

export async function requestJson(
  url,
  { fetchImpl = globalThis.fetch, method = "GET", body, csrfToken } = {}
) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available");

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const response = await fetchImpl(url, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    throw new WorkerApiError(
      errorMessage(responseBody, response.status),
      response.status,
      responseBody
    );
  }
  return responseBody;
}

export async function shortenUrl({ url, customSlug }, config, fetchImpl = globalThis.fetch) {
  const payload = { url: url.trim() };
  if (customSlug?.trim()) payload.custom_slug = customSlug.trim();

  const result = await requestJson(workerUrl(config.shortenApiPath, config), {
    fetchImpl,
    method: "POST",
    body: payload,
  });
  if (typeof result?.short_url !== "string" || !result.short_url) {
    throw new WorkerApiError("The Worker returned an invalid short URL", 502, result);
  }
  return result.short_url;
}

export async function loadSettings(config, fetchImpl = globalThis.fetch) {
  const [csrf, flags] = await Promise.all([
    requestJson(settingsApiUrl("/csrf", config), { fetchImpl }),
    requestJson(settingsApiUrl("/flags", config), { fetchImpl }),
  ]);
  if (typeof csrf?.csrfToken !== "string" || !csrf.csrfToken) {
    throw new WorkerApiError("The settings session could not be established", 502, csrf);
  }
  const flag = Array.isArray(flags?.flags)
    ? flags.flags.find((candidate) => candidate?.key === "shorten-routing") || null
    : null;
  return { csrfToken: csrf.csrfToken, flag };
}

export async function createShorteningFlag(
  definition,
  config,
  csrfToken,
  fetchImpl = globalThis.fetch
) {
  return requestJson(settingsApiUrl("/flag", config), {
    fetchImpl,
    method: "POST",
    csrfToken,
    body: definition,
  });
}

export async function updateShorteningFlag(
  definition,
  expectedUpdatedAt,
  config,
  csrfToken,
  fetchImpl = globalThis.fetch
) {
  return requestJson(settingsApiUrl("/flag/shorten-routing", config), {
    fetchImpl,
    method: "PUT",
    csrfToken,
    body: { ...definition, expectedUpdatedAt },
  });
}

export async function publishShorteningFlag(
  expectedUpdatedAt,
  config,
  csrfToken,
  fetchImpl = globalThis.fetch
) {
  return requestJson(settingsApiUrl("/flag/shorten-routing/publish", config), {
    fetchImpl,
    method: "POST",
    csrfToken,
    body: { expectedUpdatedAt },
  });
}
