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
    fetchHostedPage: vi.fn(async (url) => new Response(url)),
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
  it("evaluates the dev shortening page once and redirects only on a match", async () => {
    const adapter = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ outcome: "matched", destination: "https://variant.example" }),
    };
    const routes = createFlagRoutes({
      prefix: "/shorten/settings",
      shorteningPath: "/shorten",
      pageUrl: "https://frontend.example",
      shortener: shortener(),
      env,
      adapter,
      verifyToken: vi.fn().mockResolvedValue(true),
    });

    const response = await routes.evaluateShortening(accessRequest("/shorten"), "/shorten");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://variant.example/");
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
  });

  it("does not evaluate settings traffic and protects the settings page", async () => {
    const adapter = { evaluate: vi.fn(), listFlags: vi.fn() };
    const page = shortener();
    const routes = createFlagRoutes({
      prefix: "/shorten/settings",
      shorteningPath: "/shorten",
      pageUrl: "https://frontend.example",
      shortener: page,
      env,
      adapter,
      verifyToken: vi.fn().mockResolvedValue(true),
    });

    const response = await routes.handleSettings(
      accessRequest("/shorten/settings"),
      "/shorten/settings"
    );
    expect(response.status).toBe(200);
    expect(adapter.evaluate).not.toHaveBeenCalled();
    expect(page.fetchHostedPage).toHaveBeenCalledWith("https://frontend.example");

    const denied = await routes.handleSettings(
      new Request("https://short.example/shorten/settings"),
      "/shorten/settings"
    );
    expect(denied.status).toBe(403);
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
    expect(await routes.handleSettings(accessRequest("/settings"), "/settings")).toBeInstanceOf(
      Response
    );
  });

  it("allows mutations from the origin that hosts the settings page", async () => {
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
