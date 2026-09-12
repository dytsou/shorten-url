import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerHandler } from "../src/lib/worker-handler.js";
import { isFrontendAssetPath } from "../src/lib/assets.js";
import { createResponses } from "../src/lib/responses.js";
import {
  createAssetsBinding,
  createWorkerEnvironment,
  mockedAccessHeaders,
} from "./mocks/cloudflare-workers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(path, options = {}) {
  return new Request(`https://short.example${path}`, options);
}

function createAssets() {
  return createAssetsBinding({
    "/": new Response("<html><body>worker shell</body></html>", {
      headers: { "content-type": "text/html;charset=UTF-8" },
    }),
    "/assets/main.js": new Response("console.log('asset');", {
      headers: { "content-type": "text/javascript;charset=UTF-8" },
    }),
    "/favicon.svg": new Response("<svg></svg>", {
      headers: { "content-type": "image/svg+xml" },
    }),
  });
}

function createEnvironment(assets) {
  return createWorkerEnvironment({ assets });
}

function createHandler(options = {}) {
  return createWorkerHandler({
    flagshipAdapter: options.flagshipAdapter || {
      evaluate: vi.fn().mockResolvedValue({ outcome: "unmatched" }),
    },
    verifyToken: options.verifyToken,
  });
}

describe("Worker-hosted frontend assets", () => {
  it("serves the tabbed frontend shell at the root", async () => {
    const assets = createAssets();
    const worker = createHandler();

    const response = await worker(request("/"), createEnvironment(assets));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("worker shell");
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(assets.calls[0].url).pathname).toBe("/");
  });

  it("removes settings page routes while keeping settings APIs protected", async () => {
    const assets = createAssets();
    const verifyToken = vi.fn().mockResolvedValue(true);
    const worker = createHandler({ verifyToken });
    const environment = createEnvironment(assets);

    const removed = await worker(request("/settings"), environment);
    expect(removed.status).toBe(404);
    expect((await removed.json()).message).toBe("Settings route not found");
    expect(assets.fetch).not.toHaveBeenCalled();

    const deniedApi = await worker(request("/settings/api/flags"), environment);
    expect(deniedApi.status).toBe(403);
    expect(assets.fetch).not.toHaveBeenCalled();

    const nested = await worker(
      request("/settings/advanced", { headers: mockedAccessHeaders() }),
      environment
    );
    expect(nested.status).toBe(404);
    expect((await nested.json()).message).toBe("Settings route not found");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("does not trust Access-like headers on an unlisted host", async () => {
    const assets = createAssets();
    const environment = {
      ...createEnvironment(assets),
      ACCESS_ALLOWED_HOSTS: "short.example",
    };
    const worker = createHandler({ verifyToken: vi.fn().mockResolvedValue(true) });

    const settings = await worker(
      new Request("https://direct-worker.example/settings", { headers: mockedAccessHeaders() }),
      environment
    );
    expect(settings.status).toBe(404);
    expect(assets.fetch).not.toHaveBeenCalled();

    const shorten = await worker(
      new Request("https://direct-worker.example/shorten", {
        method: "POST",
        headers: mockedAccessHeaders(),
        body: "{}",
      }),
      environment
    );
    expect(shorten.status).toBe(403);
  });

  it("removes HEAD settings pages and keeps settings APIs ahead of assets", async () => {
    const assets = createAssets();
    const worker = createHandler({ verifyToken: vi.fn().mockResolvedValue(true) });
    const environment = createEnvironment(assets);

    const shell = await worker(
      request("/settings/", { method: "HEAD", headers: mockedAccessHeaders() }),
      environment
    );
    expect(shell.status).toBe(404);
    expect(assets.fetch).not.toHaveBeenCalled();

    const api = await worker(
      request("/settings/api", { headers: mockedAccessHeaders() }),
      environment
    );
    expect(api.status).toBe(404);
    expect((await api.json()).message).toBe("Settings route not found");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("keeps APIs, redirects, and unknown paths out of the React shell", async () => {
    const assets = createAssets();
    const environment = createEnvironment(assets);
    environment.LINKS.get.mockImplementation(async (key) =>
      key === "launch" ? "https://destination.example/path" : null
    );
    const worker = createHandler();

    const deniedShorten = await worker(
      request("/shorten", { method: "POST", body: "{}" }),
      environment
    );
    expect(deniedShorten.status).toBe(403);

    const developmentOnlyPage = await worker(request("/shorten"), environment);
    expect(developmentOnlyPage.status).toBe(404);
    expect((await developmentOnlyPage.json()).message).toBe("API route not found");

    const unknownApi = await worker(request("/api/unknown"), environment);
    expect(unknownApi.status).toBe(404);
    expect((await unknownApi.json()).message).toBe("API route not found");

    const redirect = await worker(request("/launch"), environment);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://destination.example/path");

    const unknown = await worker(request("/missing"), environment);
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).message).toBe("URL not found");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("delegates only known static asset paths", async () => {
    const assets = createAssets();
    const worker = createHandler();
    const environment = createEnvironment(assets);

    const asset = await worker(request("/assets/main.js?cache=1"), environment);
    expect(asset.status).toBe(200);
    expect(new URL(assets.calls[0].url).pathname).toBe("/assets/main.js");

    expect(isFrontendAssetPath("/assets/.env")).toBe(false);
    expect(isFrontendAssetPath("/assets/%2e%2e/secret.js")).toBe(false);
    expect(isFrontendAssetPath("/assets/main.js")).toBe(true);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the SVG favicon for legacy ICO requests", async () => {
    const assets = createAssets();
    const worker = createHandler();

    const response = await worker(request("/favicon.ico"), createEnvironment(assets));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://short.example/favicon.svg");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("returns a controlled failure when the asset binding is unavailable", async () => {
    const worker = createHandler();
    const response = await worker(request("/"), createEnvironment());

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Frontend assets are unavailable");
  });

  it("returns a controlled failure when the asset binding throws", async () => {
    const worker = createHandler();
    const assets = { fetch: vi.fn().mockRejectedValue(new Error("binding unavailable")) };
    const response = await worker(request("/assets/main.js"), createEnvironment(assets));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Frontend assets are unavailable");
  });

  it("rejects malformed and encoded unsafe asset paths", () => {
    for (const pathname of [
      "/assets/%",
      "/assets/%00main.js",
      "/assets/%2fsecret.js",
      "/assets/%252e%252e/secret.js",
      "/assets/main\\file.js",
    ]) {
      expect(isFrontendAssetPath(pathname)).toBe(false);
    }
  });
});

describe("legacy hosted-page fallbacks", () => {
  it("does not fetch when legacy pages are unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const responses = createResponses({ worker: {}, endpoints: {} });

    try {
      const hostedPage = await responses.fetchHostedPage("", 502);
      expect(hostedPage.status).toBe(502);
      expect(await hostedPage.text()).toBe("Page is not configured");

      const notFound = await responses.notFound();
      expect(notFound.status).toBe(404);
      expect((await notFound.json()).message).toBe("URL not found");

      const error = await responses.errorResponse("Request failed", 502, new Request("https://x"));
      expect(error.status).toBe(502);
      expect((await error.json()).message).toBe("Request failed");

      const interstitial = await responses.fetchInterstitial("");
      expect(interstitial.status).toBe(503);
      expect(await interstitial.text()).toBe("Redirect interstitial is not configured");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
