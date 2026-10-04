import { afterEach, describe, expect, it, vi } from "vitest";
import { createResponses } from "../src/lib/responses.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("response CORS headers", () => {
  it("allows the configured frontend to use credentialed settings requests", () => {
    const responses = createResponses({
      worker: { cors: "on" },
      endpoints: { frontendOrigin: "https://pages.example" },
    });

    expect(responses.jsonHeaders()).toMatchObject({
      "Access-Control-Allow-Origin": "https://pages.example",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    });
  });

  it("keeps wildcard CORS when no frontend origin is configured", () => {
    const responses = createResponses({
      worker: { cors: "on" },
      endpoints: {},
    });

    expect(responses.corsHeaders()).toMatchObject({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS",
    });
    expect(responses.corsHeaders()["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("derives the allowed origin from the hosted frontend page", () => {
    const responses = createResponses({
      worker: { cors: "on" },
      endpoints: { shortenPage: "https://pages.example/shorten-url/" },
    });

    expect(responses.corsHeaders()["Access-Control-Allow-Origin"]).toBe("https://pages.example");
  });

  it("keeps relative frontend assets anchored to the hosted page", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html><head><title>Desk</title></head><body>ok</body></html>")
        )
    );
    const responses = createResponses({ worker: { cors: "on" }, endpoints: {} });

    const result = await responses.fetchHostedPage("https://pages.example/shorten-url/");
    expect(await result.text()).toContain('<base href="https://pages.example/shorten-url/">');
  });
});
