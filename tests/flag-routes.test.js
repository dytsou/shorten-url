import { describe, expect, it, vi } from "vitest";
import { createCsrfToken } from "../src/lib/access.js";
import { createFlagRoutes } from "../src/lib/flag-routes.js";

const env = { FLAGSHIP_CSRF_SECRET: "test-secret" };

function shortener() {
  return {
    jsonResponse(payload, status = 200) {
      return new Response(JSON.stringify(payload), { status });
    },
    errorResponse: vi.fn(async (_message, status) => new Response("error", { status })),
  };
}

function accessRequest(url) {
  return new Request(`https://short.example${url}`, {
    headers: {
      "Cf-Access-Jwt-Assertion": "token",
      "Cf-Access-Authenticated-User-Email": "operator@example.com",
    },
  });
}

describe("Flagship route adapters", () => {
  it("evaluates the shortening page once and redirects only on a match", async () => {
    const adapter = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ outcome: "matched", destination: "https://variant.example" }),
    };
    const routes = createFlagRoutes({
      prefix: "/settings",
      shorteningPath: "/",
      pageUrl: "https://frontend.example",
      shortener: shortener(),
      env,
      adapter,
      verifyToken: vi.fn().mockResolvedValue(true),
    });

    const response = await routes.evaluateShortening(accessRequest("/"), "/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://variant.example/");
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
  });

  it("removes standalone settings pages without evaluating them", async () => {
    const adapter = { evaluate: vi.fn(), listFlags: vi.fn() };
    const routes = createFlagRoutes({
      prefix: "/settings",
      shorteningPath: "/",
      pageUrl: "https://frontend.example",
      shortener: shortener(),
      env,
      adapter,
      verifyToken: vi.fn().mockResolvedValue(true),
    });

    const response = await routes.handleSettings(accessRequest("/settings"), "/settings");
    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Settings route not found");
    expect(adapter.evaluate).not.toHaveBeenCalled();

    const unauthenticated = await routes.handleSettings(
      new Request("https://short.example/settings"),
      "/settings"
    );
    expect(unauthenticated.status).toBe(404);
  });

  it("supports the example root convention without treating settings as a slug", async () => {
    const adapter = { evaluate: vi.fn().mockResolvedValue({ outcome: "unmatched" }) };
    const routes = createFlagRoutes({
      prefix: "/settings",
      shorteningPath: "/",
      pageUrl: "https://frontend.example",
      shortener: shortener(),
      env,
      adapter,
      verifyToken: vi.fn().mockResolvedValue(true),
    });
    expect(await routes.evaluateShortening(accessRequest("/"), "/")).toBeNull();
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
    const settingsPage = await routes.handleSettings(accessRequest("/settings"), "/settings");
    expect(settingsPage.status).toBe(404);
    expect((await settingsPage.json()).message).toBe("Settings route not found");
  });

  it("allows API mutations from the configured frontend origin", async () => {
    const adapter = { createFlag: vi.fn() };
    const page = shortener();
    const routes = createFlagRoutes({
      prefix: "/settings",
      shorteningPath: "/",
      pageUrl: "https://pages.example/shorten-url/",
      shortener: page,
      env: { ...env, FLAGSHIP_CSRF_SECRET: "test-secret" },
      adapter,
      verifyToken: vi.fn().mockResolvedValue(true),
    });
    const request = new Request("https://short.example/settings/api/flag", {
      method: "POST",
      headers: {
        Origin: "https://pages.example",
        "Content-Type": "application/json",
        "Cf-Access-Jwt-Assertion": "token",
        "Cf-Access-Authenticated-User-Email": "operator@example.com",
      },
      body: "{}",
    });
    request.headers.set(
      "X-CSRF-Token",
      await createCsrfToken(request, { ...env, FLAGSHIP_CSRF_SECRET: "test-secret" })
    );

    const response = await routes.handleSettings(request, "/settings/api/flag");
    expect(response.status).not.toBe(403);
  });
});
