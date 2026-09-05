import { describe, expect, it } from "vitest";
import { runtimeDecision } from "../src/lib/flagship.js";
import { isSafeDestination } from "../src/lib/safety.js";

describe("destination safety", () => {
  it.each([
    ["https://example.com/path", true],
    ["http://example.com/path?query=value", true],
    ["https://user:password@example.com", false],
    ["https://example.com/#fragment", false],
    ["ftp://example.com", false],
    ["javascript:alert(1)", false],
    ["not-a-url", false],
    ["", false],
    [null, false],
    [123, false],
  ])("returns %s for %s", (url, expected) => {
    expect(isSafeDestination(url)).toBe(expected);
  });

  it("prevents an unsafe provider destination from becoming a redirect", () => {
    expect(
      runtimeDecision(
        {
          flagKey: "shorten-routing",
          reason: "TARGETING_MATCH",
          variant: "sg",
          value: { url: "https://variant.example/#secret" },
        },
        "SG",
        5
      )
    ).toMatchObject({
      outcome: "unmatched",
      fallbackReason: "invalid_provider_value",
    });
  });
});
