const DEFAULT_FRONTEND = {
  url: "http://localhost:8787/",
  pagesBase: "http://localhost:8787/",
  workerOrigin: "",
  displayDomain: null,
  theme: "",
};

const DEFAULT_WORKER = {
  no_ref: "off",
  cors: "on",
  unique_link: true,
  custom_link: true,
  safe_browsing_api_key: "",
  max_custom_slug_length: 50,
  min_random_key_length: 6,
  random_chars: "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678",
  reserved_slugs: [
    "api",
    "admin",
    "www",
    "mail",
    "ftp",
    "localhost",
    "password",
    "help",
    "support",
    "contact",
    "about",
    "settings",
  ],
};

const DEFAULT_CONFIG = {
  frontend: DEFAULT_FRONTEND,
  worker: DEFAULT_WORKER,
  storage: { binding_name: "LINKS" },
  flagship: { binding_name: "FLAGS", app_id: "" },
};

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneConfig(value) {
  if (Array.isArray(value)) return [...value];
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneConfig(entry)])
    );
  }
  return value;
}

function mergeConfig(base, override) {
  const result = cloneConfig(base);
  if (!isObject(override)) return result;

  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) ? mergeConfig(result[key] || {}, value) : value;
  }
  return result;
}

function envValue(env, name, fallback) {
  return typeof env?.[name] === "string" && env[name] ? env[name] : fallback;
}

/**
 * Build the non-secret Worker configuration from defaults and runtime values.
 * Provider credentials intentionally stay in `env` and are never copied here.
 */
export function createRuntimeConfig(env = {}, overrides = {}) {
  const config = mergeConfig(DEFAULT_CONFIG, overrides);

  config.frontend.url = envValue(env, "FRONTEND_URL", config.frontend.url);
  config.frontend.pagesBase = envValue(
    env,
    "FRONTEND_PAGES_BASE",
    config.frontend.pagesBase || config.frontend.url
  );
  config.frontend.workerOrigin = envValue(env, "WORKER_ORIGIN", config.frontend.workerOrigin);
  config.worker.cors = envValue(env, "WORKER_CORS", config.worker.cors);
  config.worker.no_ref = envValue(env, "WORKER_NO_REF", config.worker.no_ref);
  config.flagship.app_id = envValue(env, "FLAGSHIP_APP_ID", config.flagship.app_id);

  return config;
}

export const defaultConfig = DEFAULT_CONFIG;
