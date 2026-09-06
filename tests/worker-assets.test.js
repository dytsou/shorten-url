import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerHandler } from "../src/lib/worker-handler.js";
import { isFrontendAssetPath } from "../src/lib/assets.js";
import { createResponses } from "../src/lib/responses.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(path, options = {}) {
  return new Request(`https://short.example${path}`, options);
}

function createAssets() {
  const calls = [];
  const binding = {
    calls,
    fetch: vi.fn(async (assetRequest) => {
      calls.push(assetRequest);
      const pathname = new URL(assetRequest.url).pathname;
      if (pathname === "/") {
        return new Response("<html><body>worker shell</body></html>", {
          headers: { "content-type": "text/html;charset=UTF-8" },
        });
      }
      if (pathname === "/assets/main.js") {
        return new Response("console.log('asset');", {
          headers: { "content-type": "text/javascript;charset=UTF-8" },
        });
      }
      return new Response("missing", { status: 404 });
    }),
  };
  return binding;
}

function createEnvironment(assets) {
  return {
    ASSETS: assets,
    LINKS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
    },
  };
}

function accessHeaders() {
  return {
    "Cf-Access-Jwt-Assertion": "token",
    "Cf-Access-Authenticated-User-Email": "operator@example.com",
  };
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
  it("serves the root shell from the ASSETS binding", async () => {
    const assets = createAssets();
    const worker = createHandler();

    const response = await worker(request("/"), createEnvironment(assets));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("worker shell");
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(assets.calls[0].url).pathname).toBe("/");
  });

  it("authorizes settings shell paths before delegating to ASSETS", async () => {
    const assets = createAssets();
    const verifyToken = vi.fn().mockResolvedValue(true);
    const worker = createHandler({ verifyToken });
    const environment = createEnvironment(assets);

    const denied = await worker(request("/settings"), environment);
    expect(denied.status).toBe(403);
    expect(assets.fetch).not.toHaveBeenCalled();

    const deniedApi = await worker(request("/settings/api/flags"), environment);
    expect(deniedApi.status).toBe(403);
    expect(assets.fetch).not.toHaveBeenCalled();

    const allowed = await worker(
      request("/settings/advanced", { headers: accessHeaders() }),
      environment
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("worker shell");
    expect(verifyToken).toHaveBeenCalledWith("token", environment);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(assets.calls[0].url).pathname).toBe("/");
  });

  it("protects HEAD settings shell requests and keeps settings APIs ahead of assets", async () => {
    const assets = createAssets();
    const worker = createHandler({ verifyToken: vi.fn().mockResolvedValue(true) });
    const environment = createEnvironment(assets);

    const shell = await worker(
      request("/settings/", { method: "HEAD", headers: accessHeaders() }),
      environment
    );
    expect(shell.status).toBe(200);
    expect(assets.calls[0].method).toBe("HEAD");

    const api = await worker(request("/settings/api", { headers: accessHeaders() }), environment);
    expect(api.status).toBe(404);
    expect((await api.json()).message).toBe("Settings route not found");
    expect(assets.fetch).toHaveBeenCalledTimes(1);
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
  it("does not fetch an unconfigured hosted page", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const responses = createResponses({ worker: {}, endpoints: {} });
    const response = await responses.fetchHostedPage("", 502);

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Page is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch an unconfigured redirect interstitial", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const responses = createResponses({ worker: {}, endpoints: {} });
    const response = await responses.fetchInterstitial("");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Redirect interstitial is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
