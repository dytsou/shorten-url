import { describe, expect, it } from "vitest";
import { createRuntimeConfig } from "../src/lib/runtime-config.js";

describe("tracked Worker runtime", () => {
  it("loads the canonical entrypoint without injected global config", async () => {
    const workerModule = await import("../src/worker.js");

    expect(workerModule.default.fetch).toEqual(expect.any(Function));
    expect(globalThis.importConfig).toBeUndefined();
    expect(globalThis.defaultConfig).toBeUndefined();
  });

  it("does not let one request mutate the default runtime configuration", () => {
    const configured = createRuntimeConfig({
      FRONTEND_URL: "https://configured.example/",
      FRONTEND_HOME_PATH: "/shorten",
    });
    const fresh = createRuntimeConfig();

    expect(configured.frontend.url).toBe("https://configured.example/");
    expect(configured.frontend.homePath).toBe("/shorten");
    expect(fresh.frontend.url).toBe("");
    expect(fresh.frontend.homePath).toBe("/");
  });
});
