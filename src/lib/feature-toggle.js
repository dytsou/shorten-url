import { isSafeDestination } from "./safety.js";

export const SHORTENING_FLAG_KEY = "shorten-routing";
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DEFINITION_BYTES = 100 * 1024;
const DEFINITION_FIELDS = new Set([
  "key",
  "description",
  "enabled",
  "defaultVariant",
  "default_variation",
  "variants",
  "rules",
]);
const VARIANT_FIELDS = new Set(["key", "value", "url"]);
const RULE_FIELDS = new Set(["priority", "countries", "country", "variant", "serve_variation"]);

export function normalizeCountry(country) {
  if (typeof country !== "string") return null;
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validateVariantValue(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${key} must contain an object value`;
  }
  if (Object.keys(value).some((field) => field !== "url")) {
    return `${key} contains unsupported fields`;
  }
  if (!isSafeDestination(value.url)) return `${key} must contain a valid safe HTTP(S) url`;
  return null;
}

function validateVariant(variant, variantKeys, errors) {
  if (!variant || Object.keys(variant).some((field) => !VARIANT_FIELDS.has(field))) {
    errors.push("variants contain unsupported fields");
  }
  if (variant?.value !== undefined && variant?.url !== undefined) {
    errors.push("variants must use one value field shape");
  }
  if (!variant || !KEY_PATTERN.test(variant.key || "")) {
    errors.push("variant keys must use letters, numbers, hyphens, or underscores");
    return;
  }
  if (variantKeys.has(variant.key)) errors.push("variant keys must be unique");
  variantKeys.add(variant.key);
  const valueError = validateVariantValue(variant.value || { url: variant.url }, variant.key);
  if (valueError) errors.push(valueError);
}

function validateVariants(variants, errors) {
  if (!Array.isArray(variants) || variants.length === 0) {
    errors.push("at least one variant is required");
  }
  const variantKeys = new Set();
  for (const variant of Array.isArray(variants) ? variants : []) {
    validateVariant(variant, variantKeys, errors);
  }
  return variantKeys;
}

function validateDescription(description, errors) {
  if (description === undefined || description === null) return;
  if (typeof description !== "string" || description.length > 512) {
    errors.push("description must be at most 512 characters");
  }
  if (typeof description === "string" && /<|>|javascript:|<\/?script/i.test(description)) {
    errors.push("description contains unsupported markup");
  }
}

function ruleCountries(rule) {
  if (Array.isArray(rule?.countries)) return rule.countries;
  if (rule?.country) return [rule.country];
  return [];
}

function validateRule(rule, variantKeys, priorities, errors) {
  if (!rule || Object.keys(rule).some((field) => !RULE_FIELDS.has(field))) {
    errors.push("rules contain unsupported fields");
  }
  if (
    (Array.isArray(rule?.countries) && rule.country !== undefined) ||
    (rule?.variant !== undefined && rule.serve_variation !== undefined)
  ) {
    errors.push("rules must use one targeting field shape");
  }
  if (!Number.isInteger(rule?.priority) || rule.priority < 1 || priorities.has(rule.priority)) {
    errors.push("rule priorities must be unique positive integers");
  }
  priorities.add(rule?.priority);
  if (!variantKeys.has(rule?.variant || rule?.serve_variation)) {
    errors.push("rule variant must exist");
  }
  const countries = ruleCountries(rule);
  if (countries.length === 0 || countries.some((country) => !normalizeCountry(country))) {
    errors.push("rules must target one or more valid country codes");
  }
  if (new Set(countries.map(normalizeCountry)).size !== countries.length) {
    errors.push("rule countries must be unique");
  }
}

function validateRules(rules, variantKeys, errors) {
  if (rules !== undefined && !Array.isArray(rules)) {
    errors.push("rules must be an array");
  }
  const priorities = new Set();
  for (const rule of Array.isArray(rules) ? rules : []) {
    validateRule(rule, variantKeys, priorities, errors);
  }
}

function normalizedVariant(variant) {
  return {
    key: variant.key,
    value: { url: (variant.value || { url: variant.url }).url },
  };
}

function normalizedRule(rule) {
  return {
    priority: rule.priority,
    variant: rule.variant || rule.serve_variation,
    countries: ruleCountries(rule).map(normalizeCountry),
  };
}

function providerRuleCountries(condition) {
  if (condition?.attribute !== "country") return [];
  if (Array.isArray(condition.value)) return condition.value;
  return [condition.value];
}

/**
 * Validate the small JSON flag definition used by the settings control plane.
 * The provider-specific envelope is deliberately kept out of this boundary.
 */
export function validateFlagDefinition(input, { expectedKey = SHORTENING_FLAG_KEY } = {}) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["definition must be an object"] };
  }
  for (const field of Object.keys(input)) {
    if (!DEFINITION_FIELDS.has(field)) errors.push(`unsupported field: ${field}`);
  }
  const key = input.key || expectedKey;
  if (key !== expectedKey || !KEY_PATTERN.test(key)) errors.push("invalid flag key");

  const variants = input.variants;
  const variantKeys = validateVariants(variants, errors);

  const defaultVariant = input.defaultVariant || input.default_variation;
  if (!variantKeys.has(defaultVariant)) errors.push("default variant must exist");

  if (typeof input.enabled !== "boolean") errors.push("enabled must be a boolean");
  validateDescription(input.description, errors);
  validateRules(input.rules, variantKeys, errors);

  if (byteLength(input) > MAX_DEFINITION_BYTES) errors.push("definition is too large");
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: {
      key,
      description: input.description || "",
      enabled: input.enabled,
      defaultVariant,
      variants: variants.map(normalizedVariant),
      rules: (input.rules || []).map(normalizedRule).sort((a, b) => a.priority - b.priority),
    },
  };
}

export function evaluateFlagDefinition(definition, country) {
  const normalizedCountry = normalizeCountry(country);
  if (!definition?.enabled) {
    return { outcome: "unpublished", country: normalizedCountry, fallbackReason: "disabled" };
  }
  if (!normalizedCountry) {
    return { outcome: "unmatched", country: null, fallbackReason: "missing_country" };
  }
  for (const rule of definition.rules || []) {
    const countries = (rule.countries || []).map(normalizeCountry);
    if (!countries.includes(normalizedCountry)) continue;
    const variant = definition.variants.find((item) => item.key === rule.variant);
    if (variant) {
      return {
        outcome: "matched",
        country: normalizedCountry,
        variant: variant.key,
        destination: variant.value.url,
      };
    }
  }
  return { outcome: "unmatched", country: normalizedCountry, fallbackReason: "no_match" };
}

export function toProviderFlag(definition) {
  const validated = validateFlagDefinition(definition);
  if (!validated.ok) return validated;
  const value = validated.value;
  return {
    key: value.key,
    type: "json",
    default_variation: value.defaultVariant,
    variations: Object.fromEntries(value.variants.map((variant) => [variant.key, variant.value])),
    rules: value.rules.map((rule) => ({
      priority: rule.priority,
      conditions: [
        {
          attribute: "country",
          operator: "in",
          value: rule.countries,
        },
      ],
      serve_variation: rule.variant,
    })),
    description: value.description || null,
    enabled: value.enabled,
  };
}

export function fromProviderFlag(flag) {
  if (!flag || typeof flag !== "object") return null;
  if (
    (flag.type && flag.type !== "json") ||
    (flag.rules || []).some(
      (rule) =>
        rule?.rollout ||
        !Array.isArray(rule.conditions) ||
        rule.conditions.length !== 1 ||
        !["in", "equals"].includes(rule.conditions[0]?.operator)
    )
  ) {
    return null;
  }
  const variants = Object.entries(flag.variations || {}).map(([key, value]) => ({
    key,
    value,
  }));
  const rules = (flag.rules || []).map((rule) => {
    const condition = rule.conditions?.[0];
    return {
      priority: rule.priority,
      variant: rule.serve_variation,
      countries: providerRuleCountries(condition),
    };
  });
  const candidate = {
    key: flag.key,
    description: flag.description || "",
    enabled: flag.enabled === true,
    defaultVariant: flag.default_variation,
    variants,
    rules,
  };
  const validated = validateFlagDefinition(candidate);
  return validated.ok ? validated.value : null;
}
