import { authorizeSettingsRequest, createCsrfToken } from "./access.js";
import { SHORTENING_FLAG_KEY, fromProviderFlag, validateFlagDefinition } from "./feature-toggle.js";
import { FlagshipManagementError } from "./flagship.js";
import { log, logError } from "./observability.js";

const MAX_BODY_BYTES = 100 * 1024;

function json(response, payload, status = 200) {
  const result = response.jsonResponse(payload, status);
  result.headers.set("cache-control", "no-store");
  return result;
}

function publicFlag(flag) {
  const normalized = fromProviderFlag(flag);
  if (!normalized) return null;
  return {
    ...normalized,
    updatedAt: typeof flag.updated_at === "string" ? flag.updated_at : null,
  };
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new FlagshipManagementError("Payload too large", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new FlagshipManagementError("Payload too large", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new FlagshipManagementError("Invalid JSON format", 400);
  }
}

function safeError(error) {
  if (error instanceof FlagshipManagementError) {
    return {
      status: error.status,
      message: error.status === 400 ? error.message : "Flagship request failed",
    };
  }
  return { status: 502, message: "Flagship request failed" };
}

export function createFlagManagement({ adapter, responses, env, verifyToken, allowedOrigins }) {
  async function authorized(request, mutation = false) {
    return authorizeSettingsRequest(request, env, { mutation, verifyToken, allowedOrigins });
  }

  async function handleCsrf(request) {
    const token = await createCsrfToken(request, env);
    if (!token)
      return json(responses, { status: 503, message: "Settings are not configured" }, 503);
    return json(responses, { csrfToken: token });
  }

  async function handleFlags() {
    const flags = await adapter.listFlags();
    const result = (Array.isArray(flags) ? flags : [flags])
      .map(publicFlag)
      .filter(Boolean)
      .filter((flag) => flag.key === SHORTENING_FLAG_KEY);
    return json(responses, { flags: result });
  }

  async function handleCreateFlag(request) {
    const body = await readJson(request);
    const validated = validateFlagDefinition(body);
    if (!validated.ok) {
      return json(responses, { status: 400, message: validated.errors.join("; ") }, 400);
    }
    const result = await adapter.createFlag(validated.value);
    return json(responses, { flag: publicFlag(result) }, 201);
  }

  async function handleSaveFlag(request) {
    const body = await readJson(request);
    const { expectedUpdatedAt, ...definition } = body;
    if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) {
      return json(responses, { status: 409, message: "A current version is required" }, 409);
    }
    const validated = validateFlagDefinition(definition);
    if (!validated.ok) {
      return json(responses, { status: 400, message: validated.errors.join("; ") }, 400);
    }
    const result = await adapter.saveFlag(validated.value, { expectedUpdatedAt });
    return json(responses, { flag: publicFlag(result) });
  }

  async function handlePublishFlag(request) {
    const { expectedUpdatedAt } = await readJson(request);
    if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) {
      return json(responses, { status: 409, message: "A current version is required" }, 409);
    }
    const current = await adapter.getFlag(SHORTENING_FLAG_KEY);
    const definition = fromProviderFlag(current);
    if (!definition) throw new FlagshipManagementError("Invalid Flagship definition", 502);
    const result = await adapter.publishFlag(definition, expectedUpdatedAt);
    return json(responses, { flag: publicFlag(result) });
  }

  async function dispatch(request, route) {
    if (route === "csrf" && request.method === "GET") return handleCsrf(request);
    if (route === "flags" && request.method === "GET") return handleFlags();
    if (route === "flag" && request.method === "POST") return handleCreateFlag(request);
    if (route.startsWith("flag:") && request.method === "PUT") return handleSaveFlag(request);
    if (route.startsWith("publish:") && request.method === "POST") {
      return handlePublishFlag(request);
    }
    return json(responses, { status: 404, message: "Settings route not found" }, 404);
  }

  async function handle(request, route) {
    const mutation = request.method !== "GET";
    const authorization = await authorized(request, mutation);
    if (!authorization.ok) {
      log("warn", "flagship.settings_denied", { reason: authorization.reason });
      return json(
        responses,
        { status: authorization.status, message: "Access denied" },
        authorization.status
      );
    }

    try {
      return await dispatch(request, route);
    } catch (error) {
      logError("flagship.settings_failed", error, { route });
      const failure = safeError(error);
      return json(responses, { status: failure.status, message: failure.message }, failure.status);
    }
  }

  return { handle };
}
