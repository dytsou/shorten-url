import { describe, expect, it } from "vitest";
import {
  createFrontendConfig,
  isSettingsRoute,
  loadSettings,
  settingsApiUrl,
  shortenUrl,
  updateShorteningFlag,
  workerUrl,
} from "../frontend/src/api.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function documentWithMeta(values) {
  return {
    querySelector(selector) {
      const name = selector.match(/meta\[name="([^"]+)"\]/)?.[1];
      const content = values[name];
      return content === undefined ? null : { getAttribute: () => content };
    },
  };
}

describe("frontend API configuration", () => {
  it("uses the configured Worker origin without confusing a GitHub Pages path for a route", () => {
    const config = createFrontendConfig({
      windowRef: {
        location: { origin: "https://pages.example", pathname: "/shorten-url/" },
      },
      documentRef: documentWithMeta({
        "shorten-url-worker-origin": "https://worker.example",
        "shorten-url-settings-path": "/shorten/settings",
      }),
    });

    expect(config.workerOrigin).toBe("https://worker.example");
    expect(config.homePath).toBe("/");
    expect(workerUrl("/shorten", config)).toBe("https://worker.example/shorten");
    expect(settingsApiUrl("/csrf", config)).toBe(
      "https://worker.example/shorten/settings/api/csrf"
    );
    expect(isSettingsRoute("/shorten-url/", config.settingsPath)).toBe(false);
    expect(isSettingsRoute("/shorten/settings/", config.settingsPath)).toBe(true);
  });

  it("detects the development settings route when its path is not explicitly configured", () => {
    const config = createFrontendConfig({
      windowRef: {
        location: { origin: "http://localhost:8787", pathname: "/shorten/settings" },
      },
      documentRef: documentWithMeta({}),
    });

    expect(config.settingsPath).toBe("/shorten/settings");
    expect(settingsApiUrl("/flags", config)).toBe(
      "http://localhost:8787/shorten/settings/api/flags"
    );
    expect(isSettingsRoute(config.pathname, config.settingsPath)).toBe(true);
  });

  it("keeps the development home and settings links under /shorten", () => {
    const config = createFrontendConfig({
      windowRef: {
        location: { origin: "http://localhost:8787", pathname: "/shorten" },
      },
      documentRef: documentWithMeta({}),
    });

    expect(config.homePath).toBe("/shorten");
    expect(config.settingsPath).toBe("/shorten/settings");
  });

  it("falls back to the current origin when the public origin is invalid", () => {
    const config = createFrontendConfig({
      windowRef: { location: { origin: "https://pages.example", pathname: "/" } },
      env: { VITE_WORKER_ORIGIN: "javascript:alert(1)" },
    });

    expect(config.workerOrigin).toBe("https://pages.example");
    expect(config.workerOriginConfigured).toBe(true);
  });
});

describe("frontend API calls", () => {
  it("posts the shortener payload and includes credentials for Access", async () => {
    const config = { workerOrigin: "https://worker.example", shortenApiPath: "/shorten" };
    const calls = [];
    const shortUrl = await shortenUrl(
      { url: " https://example.com/path ", customSlug: " launch " },
      config,
      async (url, options) => {
        calls.push({ url, options });
        return response({ short_url: "https://worker.example/launch" }, 201);
      }
    );

    expect(shortUrl).toBe("https://worker.example/launch");
    expect(calls[0].url).toBe("https://worker.example/shorten");
    expect(calls[0].options.credentials).toBe("include");
    expect(JSON.parse(calls[0].options.body)).toEqual({
      url: "https://example.com/path",
      custom_slug: "launch",
    });
  });

  it("loads the CSRF token and the shortening flag", async () => {
    const config = { workerOrigin: "https://worker.example", settingsPath: "/settings" };
    const requested = [];
    const settings = await loadSettings(config, async (url) => {
      requested.push(url);
      if (url.endsWith("/csrf")) return response({ csrfToken: "csrf-token" });
      return response({
        flags: [
          {
            key: "other-flag",
          },
          {
            key: "shorten-routing",
            updatedAt: "v1",
            defaultVariant: "control",
          },
        ],
      });
    });

    expect(requested).toEqual([
      "https://worker.example/settings/api/csrf",
      "https://worker.example/settings/api/flags",
    ]);
    expect(settings.csrfToken).toBe("csrf-token");
    expect(settings.flag.updatedAt).toBe("v1");
  });

  it("sends the optimistic-concurrency version when saving a flag", async () => {
    const config = { workerOrigin: "https://worker.example", settingsPath: "/settings" };
    const calls = [];
    await updateShorteningFlag(
      {
        key: "shorten-routing",
        enabled: true,
        defaultVariant: "control",
        variants: [{ key: "control", value: { url: "https://example.com" } }],
        rules: [],
      },
      "2026-09-05T00:00:00Z",
      config,
      "csrf-token",
      async (url, options) => {
        calls.push({ url, options });
        return response({ flag: { key: "shorten-routing" } });
      }
    );

    expect(calls[0].url).toBe("https://worker.example/settings/api/flag/shorten-routing");
    expect(calls[0].options.headers["X-CSRF-Token"]).toBe("csrf-token");
    expect(JSON.parse(calls[0].options.body).expectedUpdatedAt).toBe("2026-09-05T00:00:00Z");
  });
});
