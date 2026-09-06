import { log } from "./observability.js";
import {
  SHORTENING_FLAG_KEY,
  fromProviderFlag,
  normalizeCountry,
  toProviderFlag,
  validateFlagDefinition,
} from "./feature-toggle.js";
import { isSafeDestination } from "./safety.js";

export class FlagshipUnavailableError extends Error {
  constructor(message = "Flagship is not configured") {
    super(message);
    this.name = "FlagshipUnavailableError";
  }
}

export class FlagshipManagementError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "FlagshipManagementError";
    this.status = status;
  }
}

/**
 * Typed boundary for the first-party Cloudflare Flagship binding.
 *
 * @typedef {object} FlagshipBinding
 * @property {(key: string, fallback: object, context?: Record<string, string>) => Promise<object>} getObjectDetails
 *
 * @typedef {object} FlagshipEnvironment
 * @property {FlagshipBinding} [FLAGS] Official Cloudflare Flagship evaluation binding.
 * @property {string} [CLOUDFLARE_ACCOUNT_ID] Account identifier for management calls.
 * @property {string} [FLAGSHIP_APP_ID] Flagship app identifier for management calls.
 * @property {string} [FLAGSHIP_API_TOKEN] Secret token for management calls.
 * @property {string} [FLAGSHIP_CSRF_SECRET] Secret used for settings CSRF tokens.
 */

function getBinding(env) {
  const binding = env?.FLAGS;
  return binding && typeof binding.getObjectDetails === "function" ? binding : null;
}

function runtimeDecision(details, country, durationMs) {
  const normalizedCountry = normalizeCountry(country);
  if (!details || typeof details !== "object") {
    return {
      outcome: "failed",
      country: normalizedCountry,
      fallbackReason: "malformed_provider_response",
      durationMs,
    };
  }
  if (details.errorCode) {
    return {
      outcome: "failed",
      country: normalizedCountry,
      fallbackReason: "provider_error",
      durationMs,
    };
  }
  const reason = details.reason;
  if (!["TARGETING_MATCH", "SPLIT", "DEFAULT", "DISABLED"].includes(reason)) {
    return {
      outcome: "failed",
      country: normalizedCountry,
      fallbackReason: "malformed_provider_response",
      durationMs,
    };
  }
  if (reason === "DISABLED") {
    return {
      outcome: "unpublished",
      country: normalizedCountry,
      fallbackReason: "disabled",
      durationMs,
    };
  }
  if (!normalizedCountry) {
    return { outcome: "unmatched", country: null, fallbackReason: "missing_country", durationMs };
  }
  const destination = details.value?.url;
  if (
    !destination ||
    !isSafeDestination(destination) ||
    typeof details.variant !== "string" ||
    !["TARGETING_MATCH", "SPLIT"].includes(reason)
  ) {
    return {
      outcome: "unmatched",
      country: normalizedCountry,
      fallbackReason: reason === "DEFAULT" ? "no_match" : "invalid_provider_value",
      durationMs,
    };
  }
  return {
    outcome: "matched",
    country: normalizedCountry,
    variant: details.variant,
    destination,
    flagKey: details.flagKey || SHORTENING_FLAG_KEY,
    ...(details.version ? { version: details.version } : {}),
    durationMs,
  };
}

function providerBase(env) {
  const accountId = env?.CLOUDFLARE_ACCOUNT_ID;
  const appId = env?.FLAGSHIP_APP_ID;
  const token = env?.FLAGSHIP_API_TOKEN;
  if (!accountId || !appId || !token) throw new FlagshipUnavailableError();
  return {
    token,
    url:
      env.FLAGSHIP_API_BASE_URL ||
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/flagship/apps/${encodeURIComponent(appId)}/flags`,
  };
}

export function createFlagshipAdapter(
  env,
  { fetchImpl = globalThis.fetch, now = () => Date.now(), evaluationTimeoutMs = 200 } = {}
) {
  async function evaluate(country, flagKey = SHORTENING_FLAG_KEY) {
    const started = now();
    const binding = getBinding(env);
    const normalizedCountry = normalizeCountry(country);
    if (!binding) {
      return runtimeDecision(null, country, now() - started);
    }
    let timeoutId;
    try {
      const details = await Promise.race([
        binding.getObjectDetails(
          flagKey,
          { url: null },
          normalizedCountry ? { country: normalizedCountry } : undefined
        ),
        new Promise(
          (_, reject) =>
            (timeoutId = setTimeout(
              () => reject(new Error("Flagship evaluation timed out")),
              evaluationTimeoutMs
            ))
        ),
      ]);
      return runtimeDecision(details, country, now() - started);
    } catch (error) {
      const fallbackReason = error?.message?.includes("timed out") ? "timeout" : "provider_error";
      log("warn", "flagship.evaluate_failed", { fallback_reason: fallbackReason });
      return {
        outcome: "failed",
        country: normalizedCountry,
        fallbackReason,
        durationMs: now() - started,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function managementRequest(path = "", options = {}) {
    const { token, url } = providerBase(env);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });
    } catch {
      throw new FlagshipManagementError("Flagship management request failed", 502);
    } finally {
      clearTimeout(timeout);
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Treat a non-JSON provider response as an unavailable provider.
    }
    if (!response.ok || !body?.success) {
      throw new FlagshipManagementError(
        "Flagship management request failed",
        response.status || 502
      );
    }
    return body.result;
  }

  async function listFlags() {
    return managementRequest();
  }

  async function getFlag(key = SHORTENING_FLAG_KEY) {
    return managementRequest(`/${encodeURIComponent(key)}`);
  }

  async function saveFlag(definition, { key = definition?.key, expectedUpdatedAt } = {}) {
    const validated = validateFlagDefinition(definition);
    if (!validated.ok) {
      throw new FlagshipManagementError(validated.errors.join("; "), 400);
    }
    if (expectedUpdatedAt !== undefined) {
      const current = await getFlag(key);
      if (current?.updated_at !== expectedUpdatedAt) {
        throw new FlagshipManagementError("Flag definition changed; reload before saving", 409);
      }
    }
    const providerFlag = toProviderFlag(validated.value);
    return managementRequest(`/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(providerFlag),
    });
  }

  async function createFlag(definition) {
    const validated = validateFlagDefinition(definition);
    if (!validated.ok) throw new FlagshipManagementError(validated.errors.join("; "), 400);
    return managementRequest("", {
      method: "POST",
      body: JSON.stringify(toProviderFlag(validated.value)),
    });
  }

  async function publishFlag(definition, expectedUpdatedAt) {
    const validated = validateFlagDefinition({ ...definition, enabled: true });
    if (!validated.ok) throw new FlagshipManagementError(validated.errors.join("; "), 400);
    return saveFlag(validated.value, { expectedUpdatedAt });
  }

  return {
    evaluate,
    listFlags,
    getFlag,
    saveFlag,
    createFlag,
    publishFlag,
    normalizeProviderFlag: fromProviderFlag,
  };
}

export { runtimeDecision };
