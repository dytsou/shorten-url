import { describe, expect, it, vi } from "vitest";
import {
  evaluateFlagDefinition,
  fromProviderFlag,
  normalizeCountry,
  toProviderFlag,
  validateFlagDefinition,
} from "../src/lib/feature-toggle.js";
import { createFlagshipAdapter, runtimeDecision } from "../src/lib/flagship.js";

const definition = {
  key: "shorten-routing",
  enabled: true,
  defaultVariant: "control",
  variants: [
    { key: "control", value: { url: "https://short.example/control" } },
    { key: "sg", value: { url: "https://short.example/sg" } },
  ],
  rules: [{ priority: 1, countries: ["sg"], variant: "sg" }],
};

describe("feature toggle definitions", () => {
  it("normalizes country codes and evaluates ordered rules", () => {
    expect(normalizeCountry(" sg ")).toBe("SG");
    expect(evaluateFlagDefinition(definition, "SG")).toMatchObject({
      outcome: "matched",
      variant: "sg",
      destination: "https://short.example/sg",
    });
    expect(evaluateFlagDefinition(definition, "US")).toMatchObject({
      outcome: "unmatched",
      fallbackReason: "no_match",
    });
    expect(evaluateFlagDefinition(definition, undefined).fallbackReason).toBe("missing_country");
  });

  it("rejects duplicate rules and unsafe variant destinations", () => {
    expect(
      validateFlagDefinition({
        ...definition,
        rules: [...definition.rules, { priority: 1, countries: ["US"], variant: "control" }],
      }).ok
    ).toBe(false);
    expect(
      validateFlagDefinition({
        ...definition,
        variants: [{ key: "control", value: { url: "javascript:alert(1)" } }],
      }).ok
    ).toBe(false);
    expect(validateFlagDefinition({ ...definition, rules: "not-an-array" }).ok).toBe(false);
  });

  it("round-trips the provider definition without exposing extra fields", () => {
    const provider = toProviderFlag(definition);
    expect(provider).toMatchObject({
      key: "shorten-routing",
      type: "json",
      variations: { sg: { url: "https://short.example/sg" } },
    });
    expect(fromProviderFlag({ ...provider, updated_by: "operator@example.com" })).toEqual(
      expect.objectContaining({ key: "shorten-routing", enabled: true })
    );
  });
});

describe("Flagship adapter", () => {
  it("returns a matched decision from the official binding details method", async () => {
    const binding = {
      getObjectDetails: vi.fn().mockResolvedValue({
        flagKey: "shorten-routing",
        value: { url: "https://short.example/sg" },
        variant: "sg",
        reason: "TARGETING_MATCH",
      }),
    };
    const adapter = createFlagshipAdapter({ FLAGS: binding }, { now: () => 100 });
    expect(await adapter.evaluate("sg")).toMatchObject({
      outcome: "matched",
      country: "SG",
      variant: "sg",
      destination: "https://short.example/sg",
    });
    expect(binding.getObjectDetails).toHaveBeenCalledWith(
      "shorten-routing",
      { url: null },
      { country: "SG" }
    );
  });

  it.each([
    ["missing binding", null, "failed", "malformed_provider_response"],
    [
      "provider error",
      { errorCode: "GENERAL", value: { url: null }, reason: "DEFAULT" },
      "failed",
      "provider_error",
    ],
    ["default value", { value: { url: null }, reason: "DEFAULT" }, "unmatched", "no_match"],
    ["malformed details", { value: { url: null } }, "failed", "malformed_provider_response"],
  ])("%s safely falls back", (_name, details, outcome, fallbackReason) => {
    expect(runtimeDecision(details, "US", 5)).toMatchObject({ outcome, fallbackReason });
  });

  it("bounds a provider that does not resolve", async () => {
    const adapter = createFlagshipAdapter(
      { FLAGS: { getObjectDetails: () => new Promise(() => {}) } },
      { evaluationTimeoutMs: 5 }
    );
    await expect(adapter.evaluate("US")).resolves.toMatchObject({
      outcome: "failed",
      fallbackReason: "timeout",
    });
  });
});
