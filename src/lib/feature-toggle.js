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
const RULE_FIELDS = new Set([
  "priority",
  "conditions",
  "countries",
  "country",
  "variant",
  "serve_variation",
  "rolloutPercentage",
]);
export const FLAGSHIP_CONTEXT_ATTRIBUTES = Object.freeze([
  "country",
  "regionCode",
  "continent",
  "timezone",
  "language",
  "utmSource",
  "utmMedium",
  "utmCampaign",
]);
const CONTEXT_ATTRIBUTES = new Set(FLAGSHIP_CONTEXT_ATTRIBUTES);
const STRING_OPERATORS = new Set([
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
]);
const ARRAY_OPERATORS = new Set(["in", "not_in"]);
const MAX_CONDITIONS_PER_RULE = 16;
const MAX_CONDITION_VALUES = 50;
const MAX_CONDITION_VALUE_LENGTH = 256;

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

function ruleConditions(rule) {
  if (Array.isArray(rule?.conditions)) return rule.conditions;
  const countries = ruleCountries(rule);
  return countries.length
    ? [{ attribute: "country", operator: "in", value: countries.map(normalizeCountry) }]
    : [];
}

function conditionValues(condition) {
  return Array.isArray(condition?.value) ? condition.value : [condition?.value];
}

function validateCondition(condition, errors) {
  const allowedFields = new Set(["attribute", "operator", "value"]);
  if (
    !condition ||
    typeof condition !== "object" ||
    Array.isArray(condition) ||
    Object.keys(condition).some((field) => !allowedFields.has(field))
  ) {
    errors.push("rule conditions contain unsupported fields");
    return;
  }
  if (!CONTEXT_ATTRIBUTES.has(condition.attribute)) {
    errors.push("rule conditions must use a context attribute available to the Worker");
  }
  if (!STRING_OPERATORS.has(condition.operator)) {
    errors.push("rule conditions contain an unsupported operator");
  }

  if (ARRAY_OPERATORS.has(condition.operator)) {
    if (
      !Array.isArray(condition.value) ||
      condition.value.length === 0 ||
      condition.value.length > MAX_CONDITION_VALUES ||
      condition.value.some(
        (value) =>
          typeof value !== "string" || !value.trim() || value.length > MAX_CONDITION_VALUE_LENGTH
      )
    ) {
      errors.push("in and not_in conditions need a list of non-empty values");
    }
  } else if (
    typeof condition.value !== "string" ||
    !condition.value.trim() ||
    condition.value.length > MAX_CONDITION_VALUE_LENGTH
  ) {
    errors.push("rule condition values must be non-empty strings up to 256 characters");
  }

  if (condition.attribute === "country") {
    const values = conditionValues(condition);
    if (values.some((value) => !normalizeCountry(value))) {
      errors.push("country condition values must be valid two-letter country codes");
    }
  }
}

function validateRuleShape(rule, errors) {
  if (!rule || Object.keys(rule).some((field) => !RULE_FIELDS.has(field))) {
    errors.push("rules contain unsupported fields");
  }
  if (rule?.conditions !== undefined && !Array.isArray(rule.conditions)) {
    errors.push("rule conditions must be an array");
  }
  if (
    (Array.isArray(rule?.countries) && rule.country !== undefined) ||
    (rule?.conditions !== undefined &&
      (rule.countries !== undefined || rule.country !== undefined)) ||
    (rule?.variant !== undefined && rule.serve_variation !== undefined)
  ) {
    errors.push("rules must use one targeting field shape");
  }
}

function validateRulePriorityAndVariant(rule, variantKeys, priorities, errors) {
  if (!Number.isInteger(rule?.priority) || rule.priority < 1 || priorities.has(rule.priority)) {
    errors.push("rule priorities must be unique positive integers");
  }
  priorities.add(rule?.priority);
  if (!variantKeys.has(rule?.variant || rule?.serve_variation)) {
    errors.push("rule variant must exist");
  }
}

function validateRuleConditions(conditions, errors) {
  if (conditions.length > MAX_CONDITIONS_PER_RULE) {
    errors.push(`rules can contain at most ${MAX_CONDITIONS_PER_RULE} conditions`);
  }
  const conditionKeys = new Set();
  for (const condition of conditions) {
    validateCondition(condition, errors);
    const key = JSON.stringify(condition);
    if (conditionKeys.has(key)) errors.push("rule conditions must be unique");
    conditionKeys.add(key);
  }
}

function validateRuleRollout(rule, errors) {
  const hasRollout = rule?.rolloutPercentage !== undefined && rule?.rolloutPercentage !== null;
  if (
    hasRollout &&
    (typeof rule.rolloutPercentage !== "number" ||
      !Number.isFinite(rule.rolloutPercentage) ||
      rule.rolloutPercentage < 0 ||
      rule.rolloutPercentage > 100 ||
      Math.abs(rule.rolloutPercentage * 100 - Math.round(rule.rolloutPercentage * 100)) > 1e-8)
  ) {
    errors.push("rollout percentages must be between 0 and 100 with at most two decimals");
  }
}

function validateRule(rule, variantKeys, priorities, errors) {
  validateRuleShape(rule, errors);
  validateRulePriorityAndVariant(rule, variantKeys, priorities, errors);
  const conditions = ruleConditions(rule);
  validateRuleConditions(conditions, errors);
  validateRuleRollout(rule, errors);
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

function normalizeConditionValue(condition) {
  if (ARRAY_OPERATORS.has(condition.operator)) {
    return condition.value.map((value) => {
      if (condition.attribute === "country") return normalizeCountry(value);
      return value.trim();
    });
  }
  if (condition.attribute === "country") return normalizeCountry(condition.value);
  return condition.value.trim();
}

function normalizedRule(rule) {
  const normalized = {
    priority: rule.priority,
    variant: rule.variant || rule.serve_variation,
    conditions: ruleConditions(rule).map((condition) => ({
      attribute: condition.attribute,
      operator: condition.operator,
      value: normalizeConditionValue(condition),
    })),
  };
  if (rule.rolloutPercentage !== undefined && rule.rolloutPercentage !== null) {
    normalized.rolloutPercentage = rule.rolloutPercentage;
  }
  return normalized;
}

function normalizedContext(contextOrCountry, targetingKey) {
  const context =
    contextOrCountry && typeof contextOrCountry === "object" && !Array.isArray(contextOrCountry)
      ? contextOrCountry
      : { country: contextOrCountry };
  const normalized = {};
  for (const attribute of CONTEXT_ATTRIBUTES) {
    const value = context[attribute];
    if (typeof value !== "string" || !value.trim()) continue;
    normalized[attribute] = attribute === "country" ? normalizeCountry(value) : value.trim();
  }
  const stableKey = context.targetingKey || targetingKey;
  if (typeof stableKey === "string" && stableKey) normalized.targetingKey = stableKey;
  return normalized;
}

function conditionMatches(condition, context) {
  const actual = context[condition.attribute];
  if (actual === undefined || actual === null) return false;
  if (condition.operator === "equals") return actual === condition.value;
  if (condition.operator === "not_equals") return actual !== condition.value;
  if (condition.operator === "contains") return actual.includes(condition.value);
  if (condition.operator === "starts_with") return actual.startsWith(condition.value);
  if (condition.operator === "ends_with") return actual.endsWith(condition.value);
  if (condition.operator === "in") return condition.value.includes(actual);
  if (condition.operator === "not_in") return !condition.value.includes(actual);
  return false;
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

function percentageBucket(targetingKey) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(targetingKey)) {
    hash = Math.imul(hash ^ byte, 16777619);
  }
  return ((hash >>> 0) / 0x100000000) * 100;
}

export function evaluateFlagDefinition(definition, contextOrCountry, targetingKey) {
  const context = normalizedContext(contextOrCountry, targetingKey);
  const normalizedCountry = context.country || null;
  if (!definition?.enabled) {
    return { outcome: "unpublished", country: normalizedCountry, fallbackReason: "disabled" };
  }
  for (const rule of definition.rules || []) {
    if (!ruleConditions(rule).every((condition) => conditionMatches(condition, context))) continue;
    if (rule.rolloutPercentage !== undefined) {
      if (
        typeof context.targetingKey !== "string" ||
        !context.targetingKey ||
        percentageBucket(context.targetingKey) >= rule.rolloutPercentage
      ) {
        continue;
      }
    }
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
  return {
    outcome: "unmatched",
    country: normalizedCountry,
    fallbackReason: normalizedCountry ? "no_match" : "missing_country",
  };
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
      conditions: rule.conditions,
      ...(rule.rolloutPercentage === undefined
        ? {}
        : {
            rollout: {
              percentage: rule.rolloutPercentage,
              attribute: "targetingKey",
            },
          }),
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
    (flag.rules || []).some((rule) => {
      const conditions = rule?.conditions ?? [];
      const rollout = rule?.rollout;
      const hasUnsupportedRollout =
        rollout !== undefined &&
        rollout !== null &&
        (typeof rollout !== "object" ||
          Array.isArray(rollout) ||
          Object.keys(rollout).some((field) => !["percentage", "attribute"].includes(field)) ||
          typeof rollout.percentage !== "number" ||
          (rollout.attribute !== undefined && rollout.attribute !== "targetingKey"));
      return !Array.isArray(conditions) || hasUnsupportedRollout;
    })
  ) {
    return null;
  }
  const variants = Object.entries(flag.variations || {}).map(([key, value]) => ({
    key,
    value,
  }));
  const rules = (flag.rules || []).map((rule) => {
    const normalized = {
      priority: rule.priority,
      variant: rule.serve_variation,
      conditions: rule.conditions || [],
    };
    if (rule.rollout !== undefined && rule.rollout !== null) {
      normalized.rolloutPercentage = rule.rollout.percentage;
    }
    return normalized;
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
