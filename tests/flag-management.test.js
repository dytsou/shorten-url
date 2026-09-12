import { describe, expect, it, vi } from "vitest";
import { createCsrfToken } from "../src/lib/access.js";
import { createFlagManagement } from "../src/lib/flag-management.js";
import { createFlagshipAdapter } from "../src/lib/flagship.js";

const env = {
  FLAGSHIP_CSRF_SECRET: "test-secret",
  CLOUDFLARE_ACCOUNT_ID: "account",
  FLAGSHIP_APP_ID: "app",
  FLAGSHIP_API_TOKEN: "do-not-leak",
  FLAGSHIP_API_BASE_URL: "https://flagship.test/flags",
};
const definition = {
  key: "shorten-routing",
  description: "Country routing",
  enabled: false,
  defaultVariant: "control",
  variants: [
    { key: "control", value: { url: "https://short.example/control" } },
    { key: "sg", value: { url: "https://short.example/sg" } },
  ],
  rules: [{ priority: 1, countries: ["SG"], variant: "sg" }],
};

function responses() {
  return {
    jsonResponse(payload, status = 200) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

function authorizedRequest(url, options = {}) {
  return new Request(`https://short.example${url}`, {
    ...options,
    headers: {
      "Cf-Access-Jwt-Assertion": "test-token",
      "Cf-Access-Authenticated-User-Email": "operator@example.com",
      ...(options.headers || {}),
    },
  });
}

describe("protected Flagship settings", () => {
  it("rejects requests without a verified Access token", async () => {
    const management = createFlagManagement({
      adapter: {},
      responses: responses(),
      env,
      verifyToken: vi.fn().mockResolvedValue(false),
    });
    const result = await management.handle(new Request("https://short.example/api"), "flags");
    expect(result.status).toBe(403);
  });

  it("requires configured-origin JSON and an HMAC CSRF token for mutations", async () => {
    const adapter = { createFlag: vi.fn() };
    const management = createFlagManagement({
      adapter,
      responses: responses(),
      env,
      verifyToken: vi.fn().mockResolvedValue(true),
    });
    const csrfRequest = authorizedRequest("/settings/api/csrf");
    const csrfResponse = await management.handle(csrfRequest, "csrf");
    const { csrfToken } = await csrfResponse.json();
    const request = authorizedRequest("/settings/api/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify(definition),
    });
    request.headers.set("X-CSRF-Token", csrfToken);
    const result = await management.handle(request, "flag");
    expect(result.status).toBe(403);
    expect(adapter.createFlag).not.toHaveBeenCalled();
  });

  it("rejects unknown fields before calling the management API", async () => {
    const adapter = { createFlag: vi.fn() };
    const management = createFlagManagement({
      adapter,
      responses: responses(),
      env,
      verifyToken: vi.fn().mockResolvedValue(true),
    });
    const csrfToken = await createCsrfToken(authorizedRequest("/settings/api/csrf"), env);
    const request = authorizedRequest("/settings/api/flag", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://short.example",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ ...definition, adminHtml: "<script>alert(1)</script>" }),
    });
    const result = await management.handle(request, "flag");
    expect(result.status).toBe(400);
    expect(adapter.createFlag).not.toHaveBeenCalled();
  });
});

describe("Flagship management adapter", () => {
  it("uses the documented envelope and never sends the token to the client", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: [definition] }), { status: 200 })
      );
    const adapter = createFlagshipAdapter(env, { fetchImpl });
    const result = await adapter.listFlags();
    expect(result).toEqual([definition]);
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer do-not-leak");
  });

  it("rejects stale versions before updating", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: { updated_at: "new" } }), {
        status: 200,
      })
    );
    const adapter = createFlagshipAdapter(env, { fetchImpl });
    await expect(adapter.saveFlag(definition, { expectedUpdatedAt: "old" })).rejects.toMatchObject({
      status: 409,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
