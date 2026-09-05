import { describe, it, expect, vi } from "vitest";
import { flagEvaluationFields, requestFields } from "../src/lib/observability.js";

describe("requestFields", () => {
  it.each([
    {
      name: "method and path",
      request: new Request("https://example.com/shorten?x=1", { method: "POST" }),
      expected: { http: { method: "POST", path: "/shorten", query: "?x=1" } },
    },
    {
      name: "empty query",
      request: new Request("https://example.com/", { method: "GET" }),
      expected: { http: { method: "GET", path: "/" } },
    },
  ])("$name", ({ request, expected }) => {
    expect(requestFields(request)).toEqual(expected);
  });

  it("includes cf metadata when present", () => {
    expect(
      requestFields({
        url: "https://example.com/",
        method: "GET",
        cf: { colo: "SIN", country: "SG" },
      })
    ).toEqual({
      http: { method: "GET", path: "/" },
      client: { colo: "SIN", country: "SG" },
    });
  });
});

describe("log", () => {
  it("writes structured JSON to console", async () => {
    const { log } = await import("../src/lib/observability.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    log("info", "test.event", { key: "abc" });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        event: "test.event",
        key: "abc",
        ts: expect.any(String),
      })
    );

    spy.mockRestore();
  });

  describe("flagEvaluationFields", () => {
    it("keeps evaluation telemetry bounded and free of provider payloads", () => {
      expect(
        flagEvaluationFields({
          flagKey: "shorten-routing",
          outcome: "matched",
          country: "SG",
          variant: "sg",
          version: "v1",
          durationMs: 2.6,
          destination: "https://secret.example",
          raw: { token: "secret" },
        })
      ).toEqual({
        flagship: {
          key: "shorten-routing",
          outcome: "matched",
          country: "SG",
          variant: "sg",
          version: "v1",
        },
        duration_ms: 3,
      });
    });

    it("caps and normalizes provider-controlled fields", () => {
      expect(
        flagEvaluationFields({
          flagKey: "k".repeat(200),
          outcome: "unexpected",
          country: "SG",
          variant: "v".repeat(200),
          version: "version".repeat(40),
          fallbackReason: "reason".repeat(40),
          durationMs: -2.4,
        })
      ).toEqual({
        flagship: {
          key: "k".repeat(64),
          outcome: "failed",
          country: "SG",
          variant: "v".repeat(64),
          version: "version".repeat(40).slice(0, 128),
          fallback_reason: "reason".repeat(40).slice(0, 128),
        },
        duration_ms: 0,
      });
    });

    it("omits invalid country values and uses safe defaults", () => {
      expect(
        flagEvaluationFields({
          flagKey: { provider: "unexpected" },
          outcome: "provider_error",
          country: "not-a-country",
          variant: "",
          fallbackReason: "",
        })
      ).toEqual({
        flagship: {
          key: "shorten-routing",
          outcome: "failed",
        },
        duration_ms: null,
      });
    });
  });
});
