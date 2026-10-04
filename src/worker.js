import { withFetchObservability } from "./lib/observability.js";
import { parseSpecialRedirectRules, redirectForSpecialRule } from "./lib/redirect-rules.js";
import config from "../config/config.js";
import { createWorkerHandler } from "./lib/worker-handler.js";

const appFetchHandler = createWorkerHandler({ configOverrides: config });
let cachedRulesValue;
let cachedRules = [];

function rulesFromEnvironment(value) {
  if (value === cachedRulesValue) return cachedRules;
  cachedRulesValue = value;
  cachedRules = [];
  if (typeof value !== "string" || !value.trim()) return cachedRules;

  try {
    cachedRules = parseSpecialRedirectRules(value);
  } catch (error) {
    console.error({
      level: "error",
      event: "special_redirect.invalid_config",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  return cachedRules;
}

export async function workerFetchHandler(request, env, ctx) {
  if (request.method === "GET" || request.method === "HEAD") {
    const redirect = redirectForSpecialRule(request, rulesFromEnvironment(env?.SPECIAL_REDIRECT_RULES));
    if (redirect) return redirect;
  }
  return appFetchHandler(request, env, ctx);
}

export default withFetchObservability(workerFetchHandler);
