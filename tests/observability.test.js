import { describe, it, expect, vi } from "vitest";
import { requestFields } from "../src/lib/observability.js";

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
});
