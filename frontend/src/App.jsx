import { useEffect, useMemo, useState } from "react";
import {
  createFrontendConfig,
  createShorteningFlag,
  errorMessage,
  loadSettings,
  publishShorteningFlag,
  shortenUrl,
  updateShorteningFlag,
} from "./api.js";
import { loadLocalFlagMock, publishLocalFlagMock, saveLocalFlagMock } from "./local-flag-mock.js";
import "./styles/app.css";

const FLAG_KEY = "shorten-routing";
let nextEditorItemId = 0;
const FLAGSHIP_CONTEXT_FIELDS = [
  { key: "country", label: "Country code", example: "US or CA" },
  { key: "regionCode", label: "Region code", example: "TX" },
  { key: "continent", label: "Continent", example: "NA" },
  { key: "timezone", label: "Time zone", example: "America/Chicago" },
  { key: "language", label: "Browser language", example: "en-us" },
  { key: "utmSource", label: "UTM source", example: "newsletter" },
  { key: "utmMedium", label: "UTM medium", example: "email" },
  { key: "utmCampaign", label: "UTM campaign", example: "spring-launch" },
];
const TARGETING_OPERATORS = [
  { key: "equals", label: "is" },
  { key: "not_equals", label: "is not" },
  { key: "contains", label: "contains" },
  { key: "starts_with", label: "starts with" },
  { key: "ends_with", label: "ends with" },
  { key: "in", label: "is one of" },
  { key: "not_in", label: "is not one of" },
];
const LIST_OPERATORS = new Set(["in", "not_in"]);

function createEditorItemId(prefix) {
  nextEditorItemId += 1;
  return `${prefix}-${nextEditorItemId}`;
}

function emptyDefinition() {
  return {
    key: FLAG_KEY,
    description: "Route visitors to the right destination using audience segments and rollouts.",
    enabled: true,
    defaultVariant: "control",
    variants: [{ id: createEditorItemId("variant"), key: "control", url: "" }],
    rules: [],
  };
}

function normalizeVariantUrl(variant) {
  if (typeof variant?.value?.url === "string") return variant.value.url;
  if (typeof variant?.url === "string") return variant.url;
  return "";
}

function normalizeSourceConditions(rule) {
  if (Array.isArray(rule?.conditions)) return rule.conditions;

  let legacyCountries = [];
  if (Array.isArray(rule?.countries)) {
    legacyCountries = rule.countries;
  } else if (typeof rule?.country === "string") {
    legacyCountries = [rule.country];
  }

  if (!legacyCountries.length) return [];
  return [{ attribute: "country", operator: "in", value: legacyCountries }];
}

function normalizeEditorCondition(condition) {
  const isKnownAttribute = FLAGSHIP_CONTEXT_FIELDS.some(
    (field) => field.key === condition?.attribute
  );
  const isKnownOperator = TARGETING_OPERATORS.some(
    (operator) => operator.key === condition?.operator
  );
  let value = "";
  if (Array.isArray(condition?.value)) {
    value = condition.value.join(", ");
  } else if (typeof condition?.value === "string") {
    value = condition.value;
  }

  return {
    id: createEditorItemId("condition"),
    attribute: isKnownAttribute ? condition.attribute : "country",
    operator: isKnownOperator ? condition.operator : "equals",
    value,
  };
}

function normalizeEditorRule(rule, index, variants) {
  return {
    id: createEditorItemId("rule"),
    priority: Number.isInteger(rule?.priority) ? rule.priority : index + 1,
    variant: typeof rule?.variant === "string" ? rule.variant : variants[0].key,
    conditions: normalizeSourceConditions(rule).map(normalizeEditorCondition),
    rolloutPercentage: Number.isFinite(rule?.rolloutPercentage) ? rule.rolloutPercentage : "",
  };
}

function normalizeDefaultVariant(flag, variants) {
  if (typeof flag.defaultVariant === "string" && flag.defaultVariant) {
    return flag.defaultVariant;
  }
  return variants[0].key;
}

function normalizeDefinition(flag) {
  if (!flag) return emptyDefinition();

  const variants = Array.isArray(flag.variants)
    ? flag.variants.map((variant) => ({
        id: createEditorItemId("variant"),
        key: typeof variant?.key === "string" ? variant.key : "",
        url: normalizeVariantUrl(variant),
      }))
    : [];
  const normalizedVariants = variants.length ? variants : emptyDefinition().variants;
  const rules = Array.isArray(flag.rules)
    ? flag.rules
        .map((rule, index) => normalizeEditorRule(rule, index, normalizedVariants))
        .sort((left, right) => left.priority - right.priority)
        .map((rule, index) => ({ ...rule, priority: index + 1 }))
    : [];

  return {
    key: typeof flag.key === "string" && flag.key ? flag.key : FLAG_KEY,
    description: typeof flag.description === "string" ? flag.description : "",
    enabled: flag.enabled === true,
    defaultVariant: normalizeDefaultVariant(flag, normalizedVariants),
    variants: normalizedVariants,
    rules,
  };
}

function conditionValueForPayload(condition) {
  const value = condition.value.trim();
  if (!LIST_OPERATORS.has(condition.operator)) {
    return condition.attribute === "country" ? value.toUpperCase() : value;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (condition.attribute === "country" ? item.toUpperCase() : item));
}

function toFlagPayload(definition) {
  return {
    key: FLAG_KEY,
    description: definition.description.trim(),
    enabled: definition.enabled,
    defaultVariant: definition.defaultVariant,
    variants: definition.variants.map((variant) => ({
      key: variant.key.trim(),
      value: { url: variant.url.trim() },
    })),
    rules: definition.rules.map((rule, index) => ({
      priority: index + 1,
      variant: rule.variant,
      conditions: rule.conditions.map((condition) => ({
        attribute: condition.attribute,
        operator: condition.operator,
        value: conditionValueForPayload(condition),
      })),
      ...(rule.rolloutPercentage === "" ||
      rule.rolloutPercentage === undefined ||
      rule.rolloutPercentage === null
        ? {}
        : { rolloutPercentage: Number(rule.rolloutPercentage) }),
    })),
  };
}

function draftVariantProblem(definition) {
  if (!definition.variants.length) return "Add at least one destination variant.";

  const keys = definition.variants.map((variant) => variant.key.trim()).filter(Boolean);
  if (keys.length !== new Set(keys).size) return "Variant keys must be unique.";
  if (keys.length !== definition.variants.length) return "Every variant needs a key.";
  if (!keys.includes(definition.defaultVariant)) return "Choose an existing default variant.";
  if (definition.variants.some((variant) => !variant.url.trim())) {
    return "Every variant needs a destination URL.";
  }
  return "";
}

function draftConditionProblem(condition) {
  if (!condition.value.trim()) {
    return "Complete each condition or remove it before saving.";
  }

  if (condition.attribute === "country") {
    const countryValues = LIST_OPERATORS.has(condition.operator)
      ? condition.value.split(",").map((value) => value.trim().toUpperCase())
      : [condition.value.trim().toUpperCase()];
    if (countryValues.some((value) => !/^[A-Z]{2}$/.test(value))) {
      return "Country conditions need two-letter codes, such as US or CA.";
    }
    if (new Set(countryValues).size !== countryValues.length) {
      return "Remove duplicate country codes from a condition.";
    }
  }

  if (!LIST_OPERATORS.has(condition.operator)) return "";
  const values = condition.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) return "Enter at least one value for an ‘is one of’ condition.";
  if (new Set(values).size !== values.length) {
    return "Remove duplicate values from a condition.";
  }
  return "";
}

function draftRolloutProblem(rule) {
  const hasRollout =
    rule.rolloutPercentage !== "" &&
    rule.rolloutPercentage !== undefined &&
    rule.rolloutPercentage !== null;
  if (!hasRollout) return "";

  const percentage = Number(rule.rolloutPercentage);
  if (
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100 ||
    Math.abs(percentage * 100 - Math.round(percentage * 100)) > 1e-8
  ) {
    return "Rollout percentages must be between 0 and 100, with at most two decimals.";
  }
  return "";
}

function draftRuleProblem(rule) {
  for (const condition of rule.conditions) {
    const problem = draftConditionProblem(condition);
    if (problem) return problem;
  }
  return draftRolloutProblem(rule);
}

function draftProblem(definition) {
  const variantProblem = draftVariantProblem(definition);
  if (variantProblem) return variantProblem;

  const variantKeys = new Set(definition.variants.map((variant) => variant.key.trim()));
  if (definition.rules.some((rule) => !variantKeys.has(rule.variant))) {
    return "Choose an existing variant for every segment.";
  }
  for (const rule of definition.rules) {
    const problem = draftRuleProblem(rule);
    if (problem) return problem;
  }
  return "";
}

function originHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

async function copyText(value) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("Copy is not available");
  }
  await navigator.clipboard.writeText(value);
}

function ShortenerPage({ config }) {
  const [longUrl, setLongUrl] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (!longUrl.trim()) {
      setError("Paste a destination URL first.");
      return;
    }

    setBusy(true);
    setCopied(false);
    setError("");
    setShortUrl("");
    try {
      const result = await shortenUrl({ url: longUrl, customSlug }, config);
      setShortUrl(result);
    } catch (requestError) {
      setError(errorMessage(requestError.body, requestError.status, requestError.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    try {
      await copyText(shortUrl);
      setCopied(true);
    } catch (copyError) {
      setError(copyError.message || "Could not copy the short URL.");
    }
  }

  return (
    <div className="shorten-page">
      <div className="page-heading">
        <div>
          <h1 id="shorten-page-title">Shorten URL</h1>
          <p>Create a short link from a destination URL.</p>
        </div>
      </div>

      <form className="shorten-card" onSubmit={handleSubmit}>
        <div className="field-group">
          <label htmlFor="long-url">Destination URL</label>
          <input
            id="long-url"
            name="url"
            type="url"
            value={longUrl}
            onChange={(event) => setLongUrl(event.target.value)}
            placeholder="https://example.com/a/very/long/path"
            autoComplete="url"
            required
          />
        </div>
        <div className="shorten-form__actions">
          <div className="field-group">
            <label htmlFor="custom-slug">
              Custom slug <span className="label-note">optional</span>
            </label>
            <div className="slug-input">
              <span className="slug-prefix">{originHost(config.workerOrigin)}/</span>
              <input
                id="custom-slug"
                name="customSlug"
                type="text"
                value={customSlug}
                onChange={(event) => setCustomSlug(event.target.value)}
                placeholder="campaign-name"
                maxLength={50}
                autoComplete="off"
              />
            </div>
            <p className="field-help">Leave blank to generate a short key automatically.</p>
          </div>
          <button className="button button--primary button--wide" type="submit" disabled={busy}>
            {busy ? "Creating link…" : "Shorten URL"}
          </button>
        </div>
        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}
      </form>

      {shortUrl && (
        <section className="result-card" aria-live="polite">
          <div>
            <p className="eyebrow">LINK READY</p>
            <a className="result-url" href={shortUrl} target="_blank" rel="noreferrer">
              {shortUrl}
            </a>
          </div>
          <div className="result-actions">
            <button className="button button--quiet" type="button" onClick={handleCopy}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <a className="button button--dark" href={shortUrl} target="_blank" rel="noreferrer">
              Visit <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
      )}
    </div>
  );
}

function DefinitionEditor({ definition, setDefinition, disabled }) {
  function updateDefinition(update) {
    setDefinition((current) => ({ ...current, ...update }));
  }

  function updateVariant(index, field, value) {
    setDefinition((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant
      ),
    }));
  }

  function updateVariantKey(index, value) {
    setDefinition((current) => {
      const previousKey = current.variants[index]?.key;
      return {
        ...current,
        defaultVariant: current.defaultVariant === previousKey ? value : current.defaultVariant,
        variants: current.variants.map((variant, variantIndex) =>
          variantIndex === index ? { ...variant, key: value } : variant
        ),
        rules: current.rules.map((rule) =>
          rule.variant === previousKey ? { ...rule, variant: value } : rule
        ),
      };
    });
  }

  function addVariant() {
    setDefinition((current) => {
      const taken = new Set(current.variants.map((variant) => variant.key));
      let index = current.variants.length + 1;
      let key = `variant-${index}`;
      while (taken.has(key)) key = `variant-${++index}`;
      return {
        ...current,
        variants: [...current.variants, { id: createEditorItemId("variant"), key, url: "" }],
      };
    });
  }

  function removeVariant(index) {
    setDefinition((current) => {
      if (current.variants.length <= 1) return current;
      const removedKey = current.variants[index].key;
      const variants = current.variants.filter((_, variantIndex) => variantIndex !== index);
      return {
        ...current,
        variants,
        defaultVariant:
          current.defaultVariant === removedKey ? variants[0].key : current.defaultVariant,
        rules: current.rules.filter((rule) => rule.variant !== removedKey),
      };
    });
  }

  function addRule() {
    setDefinition((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: createEditorItemId("rule"),
          priority: current.rules.length + 1,
          variant: current.variants[0]?.key || "",
          conditions: [
            {
              id: createEditorItemId("condition"),
              attribute: "country",
              operator: "in",
              value: "US",
            },
          ],
          rolloutPercentage: "",
        },
      ],
    }));
  }

  function updateRule(index, field, value) {
    setDefinition((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, [field]: value } : rule
      ),
    }));
  }

  function addCondition(ruleIndex) {
    setDefinition((current) => ({
      ...current,
      rules: current.rules.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              conditions: [
                ...rule.conditions,
                {
                  id: createEditorItemId("condition"),
                  attribute: "language",
                  operator: "equals",
                  value: "en-us",
                },
              ],
            }
          : rule
      ),
    }));
  }

  function updateCondition(ruleIndex, conditionIndex, field, value) {
    setDefinition((current) => ({
      ...current,
      rules: current.rules.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              conditions: rule.conditions.map((condition, itemIndex) =>
                itemIndex === conditionIndex ? { ...condition, [field]: value } : condition
              ),
            }
          : rule
      ),
    }));
  }

  function removeCondition(ruleIndex, conditionIndex) {
    setDefinition((current) => ({
      ...current,
      rules: current.rules.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              conditions: rule.conditions.filter((_, itemIndex) => itemIndex !== conditionIndex),
            }
          : rule
      ),
    }));
  }

  function moveRule(ruleIndex, direction) {
    setDefinition((current) => {
      const nextIndex = ruleIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.rules.length) return current;
      const rules = [...current.rules];
      [rules[ruleIndex], rules[nextIndex]] = [rules[nextIndex], rules[ruleIndex]];
      return { ...current, rules: rules.map((rule, index) => ({ ...rule, priority: index + 1 })) };
    });
  }

  return (
    <fieldset className="flag-editor" disabled={disabled}>
      <legend className="visually-hidden">Flag configuration</legend>
      <nav className="flag-section-nav" aria-label="Flag configuration sections">
        <a href="#flag-details">Details</a>
        <a href="#flag-variants">
          Variants <span>{definition.variants.length}</span>
        </a>
        <a href="#flag-rules">
          Segments <span>{definition.rules.length}</span>
        </a>
      </nav>

      <section id="flag-details" className="flag-section panel">
        <div className="flag-section-heading">
          <div>
            <p className="eyebrow">01 / CONFIGURATION</p>
            <h2>Flag details</h2>
          </div>
          <span className="flag-section-note">Shared settings for this flag</span>
        </div>
        <div className="flag-details-grid">
          <div className="flag-key-field">
            <span>Key</span>
            <code>{FLAG_KEY}</code>
          </div>
          <div className="field-group flag-description-field">
            <label htmlFor="flag-description">Description</label>
            <textarea
              id="flag-description"
              value={definition.description}
              onChange={(event) => updateDefinition({ description: event.target.value })}
              rows={2}
              maxLength={512}
            />
          </div>
          <div className="toggle-row">
            <span>
              <label htmlFor="flag-enabled">
                <strong id="flag-enabled-label">Flag enabled</strong>
              </label>
              <small>When disabled, Flagship returns the default variant.</small>
            </span>
            <input
              id="flag-enabled"
              type="checkbox"
              aria-labelledby="flag-enabled-label"
              checked={definition.enabled}
              onChange={(event) => updateDefinition({ enabled: event.target.checked })}
            />
            <label className="toggle-control" htmlFor="flag-enabled">
              <span className="visually-hidden">Flag enabled</span>
            </label>
          </div>
        </div>
      </section>

      <section id="flag-variants" className="flag-section panel">
        <div className="flag-section-heading">
          <div>
            <p className="eyebrow">02 / VARIANTS</p>
            <h2>Variants</h2>
            <p className="helper-text">
              Each variant is a destination URL. Choose the control or fallback with “Default”.
            </p>
          </div>
          <div className="flag-section-tools">
            <span className="count-chip">{definition.variants.length} total</span>
            <button className="button button--small" type="button" onClick={addVariant}>
              + Add variant
            </button>
          </div>
        </div>
        <div className="variation-list">
          {definition.variants.map((variant, index) => (
            <div className="variation-row" key={variant.id}>
              <div className="field-group variation-key-field">
                <label htmlFor={`variant-key-${variant.id}`}>Key</label>
                <input
                  id={`variant-key-${variant.id}`}
                  value={variant.key}
                  onChange={(event) => updateVariantKey(index, event.target.value)}
                  placeholder="control"
                />
              </div>
              <div className="field-group variation-url-field">
                <label htmlFor={`variant-url-${variant.id}`}>Destination URL</label>
                <input
                  id={`variant-url-${variant.id}`}
                  type="url"
                  value={variant.url}
                  onChange={(event) => updateVariant(index, "url", event.target.value)}
                  placeholder="https://example.com/control"
                />
              </div>
              <label className="default-variation" htmlFor={`variant-default-${variant.id}`}>
                <input
                  id={`variant-default-${variant.id}`}
                  name="default-variation"
                  type="radio"
                  checked={definition.defaultVariant === variant.key}
                  onChange={() => updateDefinition({ defaultVariant: variant.key })}
                />
                <span>Default</span>
              </label>
              <button
                className="icon-button"
                type="button"
                onClick={() => removeVariant(index)}
                disabled={definition.variants.length <= 1}
                aria-label={`Remove ${variant.key || "variant"}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="flag-rules" className="flag-section panel">
        <div className="flag-section-heading">
          <div>
            <p className="eyebrow">03 / AUDIENCE</p>
            <h2>Segments</h2>
            <p className="helper-text">
              OpenFlagr calls these Segments: conditions are constraints, and rollout controls the
              share sent to a variant. Segments run top to bottom; the first match wins.
            </p>
          </div>
          <div className="flag-section-tools">
            <span className="count-chip">{definition.rules.length} total</span>
            <button className="button button--small" type="button" onClick={addRule}>
              + Add segment
            </button>
          </div>
        </div>
        <div className="context-note">
          <span aria-hidden="true">i</span>
          <p>
            Available context: country, region, continent, time zone, browser language, and UTM
            source, medium, and campaign. If a request has no value for a condition, that segment
            will not match.
          </p>
        </div>
        {definition.rules.length === 0 ? (
          <div className="segment-empty-state">
            <span className="segment-empty-state__step">DEFAULT</span>
            <div>
              <strong>
                Every visitor gets {definition.defaultVariant || "the default variant"}
              </strong>
              <p>Add a segment to target an audience or start a canary rollout.</p>
            </div>
          </div>
        ) : (
          <div className="segment-list">
            {definition.rules.map((rule, index) => (
              <article className="segment-card" key={rule.id}>
                <header className="segment-card__header">
                  <div className="segment-card__identity">
                    <span className="segment-priority">{index + 1}</span>
                    <div>
                      <h3>Segment {index + 1}</h3>
                      <p>
                        Priority {index + 1} · checked {index === 0 ? "first" : "in order"}
                      </p>
                    </div>
                  </div>
                  <div
                    className="segment-card__actions"
                    aria-label={`Segment ${index + 1} actions`}
                  >
                    <button
                      className="icon-button segment-order-button"
                      type="button"
                      onClick={() => moveRule(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move segment ${index + 1} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="icon-button segment-order-button"
                      type="button"
                      onClick={() => moveRule(index, 1)}
                      disabled={index === definition.rules.length - 1}
                      aria-label={`Move segment ${index + 1} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="icon-button segment-remove-button"
                      type="button"
                      onClick={() =>
                        updateDefinition({
                          rules: definition.rules.filter((_, ruleIndex) => ruleIndex !== index),
                        })
                      }
                      aria-label={`Remove segment ${index + 1}`}
                      title="Remove segment"
                    >
                      ×
                    </button>
                  </div>
                </header>

                <fieldset className="segment-stage segment-conditions">
                  <legend>
                    <span>IF</span> Conditions <small>all must match</small>
                  </legend>
                  {rule.conditions.length === 0 ? (
                    <p className="segment-all-visitors">
                      This segment matches everyone. Add a condition to narrow the audience.
                    </p>
                  ) : (
                    <div className="condition-list">
                      {rule.conditions.map((condition, conditionIndex) => {
                        const contextField = FLAGSHIP_CONTEXT_FIELDS.find(
                          (field) => field.key === condition.attribute
                        );
                        const listCondition = LIST_OPERATORS.has(condition.operator);
                        const helpId = `condition-help-${rule.id}-${condition.id}`;
                        return (
                          <div className="condition-row" key={condition.id}>
                            <div className="field-group condition-attribute-field">
                              <label htmlFor={`condition-field-${condition.id}`}>Attribute</label>
                              <select
                                id={`condition-field-${condition.id}`}
                                value={condition.attribute}
                                onChange={(event) =>
                                  updateCondition(
                                    index,
                                    conditionIndex,
                                    "attribute",
                                    event.target.value
                                  )
                                }
                              >
                                {FLAGSHIP_CONTEXT_FIELDS.map((field) => (
                                  <option key={field.key} value={field.key}>
                                    {field.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group condition-operator-field">
                              <label htmlFor={`condition-operator-${condition.id}`}>Operator</label>
                              <select
                                id={`condition-operator-${condition.id}`}
                                value={condition.operator}
                                onChange={(event) =>
                                  updateCondition(
                                    index,
                                    conditionIndex,
                                    "operator",
                                    event.target.value
                                  )
                                }
                              >
                                {TARGETING_OPERATORS.map((operator) => (
                                  <option key={operator.key} value={operator.key}>
                                    {operator.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group condition-value-field">
                              <label htmlFor={`condition-value-${condition.id}`}>Value</label>
                              <input
                                id={`condition-value-${condition.id}`}
                                value={condition.value}
                                onChange={(event) =>
                                  updateCondition(
                                    index,
                                    conditionIndex,
                                    "value",
                                    event.target.value
                                  )
                                }
                                placeholder={
                                  listCondition ? "US, CA" : contextField?.example || "Value"
                                }
                                aria-describedby={helpId}
                                maxLength={256}
                              />
                              <small id={helpId}>
                                {listCondition
                                  ? "Separate values with commas."
                                  : `Example: ${contextField?.example || "value"}.`}
                              </small>
                            </div>
                            <button
                              className="icon-button condition-remove-button"
                              type="button"
                              onClick={() => removeCondition(index, conditionIndex)}
                              aria-label={`Remove condition ${conditionIndex + 1} from segment ${index + 1}`}
                              title="Remove condition"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button
                    className="button button--quiet button--small condition-add-button"
                    type="button"
                    onClick={() => addCondition(index)}
                  >
                    + Add condition
                  </button>
                </fieldset>

                <div className="segment-outcome-grid">
                  <fieldset className="segment-stage segment-rollout">
                    <legend>Rollout</legend>
                    <label className="rollout-toggle" htmlFor={`rollout-enabled-${rule.id}`}>
                      <input
                        id={`rollout-enabled-${rule.id}`}
                        type="checkbox"
                        checked={rule.rolloutPercentage !== ""}
                        onChange={(event) =>
                          updateRule(index, "rolloutPercentage", event.target.checked ? "10" : "")
                        }
                      />
                      <span>Use gradual rollout</span>
                    </label>
                    {rule.rolloutPercentage !== "" ? (
                      <div className="rollout-controls">
                        <label className="visually-hidden" htmlFor={`rollout-slider-${rule.id}`}>
                          Rollout percentage slider
                        </label>
                        <input
                          className="rollout-slider"
                          id={`rollout-slider-${rule.id}`}
                          type="range"
                          min="0"
                          max="100"
                          step="0.01"
                          value={rule.rolloutPercentage}
                          onChange={(event) =>
                            updateRule(index, "rolloutPercentage", event.target.value)
                          }
                          aria-valuetext={`${rule.rolloutPercentage}% of matching visitors`}
                        />
                        <div className="field-group rollout-number-field">
                          <label htmlFor={`rollout-value-${rule.id}`}>
                            Percent of matching visitors
                          </label>
                          <div className="rollout-number-input">
                            <input
                              id={`rollout-value-${rule.id}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max="100"
                              step="0.01"
                              value={rule.rolloutPercentage}
                              onChange={(event) =>
                                updateRule(index, "rolloutPercentage", event.target.value)
                              }
                            />
                            <span aria-hidden="true">%</span>
                          </div>
                        </div>
                        <p className="rollout-help">
                          The same anonymous browser stays in the same cohort. Visitors outside this
                          rollout continue to the next segment or default.
                        </p>
                      </div>
                    ) : (
                      <p className="rollout-help">
                        Off means every visitor who matches these conditions gets the selected
                        variant.
                      </p>
                    )}
                  </fieldset>

                  <div className="segment-stage segment-serve">
                    <label htmlFor={`rule-variant-${rule.id}`}>THEN · Serve variant</label>
                    <select
                      id={`rule-variant-${rule.id}`}
                      value={rule.variant}
                      onChange={(event) => updateRule(index, "variant", event.target.value)}
                    >
                      {definition.variants.map((variant) => (
                        <option key={`${rule.id}-${variant.id}`} value={variant.key}>
                          {variant.key || "Unnamed"}
                          {definition.defaultVariant === variant.key ? " · default" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="rule-fallback">
          <span className="rule-fallback__marker" aria-hidden="true">
            ↳
          </span>
          <div>
            <span>DEFAULT VARIANT</span>
            <strong>{definition.defaultVariant || "Choose a variant"}</strong>
          </div>
          <p>Used when no segment matches, and when the flag is disabled.</p>
        </div>
      </section>
    </fieldset>
  );
}

function SettingsPage({ config }) {
  const [definition, setDefinition] = useState(emptyDefinition);
  const [csrfToken, setCsrfToken] = useState("");
  const [version, setVersion] = useState("");
  const [hasFlag, setHasFlag] = useState(false);
  const [phase, setPhase] = useState("loading");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState({ tone: "neutral", message: "Loading settings…" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setStatus({ tone: "neutral", message: "Loading settings…" });
    if (config.isLocalDevelopment) {
      try {
        const flag = loadLocalFlagMock();
        setCsrfToken("");
        setHasFlag(Boolean(flag));
        setVersion(flag?.updatedAt || "");
        setDefinition(normalizeDefinition(flag));
        setPhase("ready");
        setStatus({
          tone: "neutral",
          message: "Local mock mode. Changes stay in this browser and never reach Flagship.",
        });
      } catch (error) {
        setPhase("error");
        setStatus({ tone: "error", message: error.message || "Could not load the local mock." });
      }
      return undefined;
    }
    loadSettings(config)
      .then(({ csrfToken: nextToken, flag }) => {
        if (cancelled) return;
        setCsrfToken(nextToken);
        setHasFlag(Boolean(flag));
        setVersion(flag?.updatedAt || "");
        setDefinition(normalizeDefinition(flag));
        setPhase("ready");
        setStatus({
          tone: "success",
          message: flag
            ? "Live definition loaded."
            : "No live flag yet. Save a definition to create it.",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPhase("error");
        setStatus({
          tone: "error",
          message: errorMessage(
            error.body,
            error.status,
            error.message || "Could not load settings."
          ),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [config, reloadKey]);

  async function handleSave() {
    if (busy || phase !== "ready") return;
    const problem = draftProblem(definition);
    if (problem) {
      setStatus({ tone: "error", message: problem });
      return;
    }

    setBusy("save");
    setStatus({ tone: "neutral", message: "Saving the draft…" });
    try {
      const payload = toFlagPayload(definition);
      let result;
      if (config.isLocalDevelopment) {
        result = saveLocalFlagMock(payload);
      } else if (hasFlag) {
        result = await updateShorteningFlag(payload, version, config, csrfToken);
      } else {
        result = await createShorteningFlag(payload, config, csrfToken);
      }
      if (!result?.flag) throw new Error("The Worker returned no saved flag");
      setDefinition(normalizeDefinition(result.flag));
      setVersion(result.flag.updatedAt || version);
      setHasFlag(true);
      setStatus({
        tone: "success",
        message: config.isLocalDevelopment
          ? "Local mock saved in this browser. No real Flagship data changed."
          : "Draft saved. Publish when the destinations are ready.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: errorMessage(
          error.body,
          error.status,
          error.message || "Could not save the draft."
        ),
      });
    } finally {
      setBusy("");
    }
  }

  async function handlePublish() {
    if (busy || phase !== "ready" || !hasFlag || !version) return;
    setBusy("publish");
    setStatus({ tone: "neutral", message: "Publishing the current draft…" });
    try {
      const result = config.isLocalDevelopment
        ? publishLocalFlagMock(version)
        : await publishShorteningFlag(version, config, csrfToken);
      if (!result?.flag) throw new Error("The Worker returned no published flag");
      setDefinition(normalizeDefinition(result.flag));
      setVersion(result.flag.updatedAt || version);
      setStatus({
        tone: "success",
        message: config.isLocalDevelopment
          ? "Local mock published in this browser. Real links are unchanged."
          : "Published. New links can now use the updated routing rules.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: errorMessage(
          error.body,
          error.status,
          error.message || "Could not publish the draft."
        ),
      });
    } finally {
      setBusy("");
    }
  }

  const editorDisabled = phase !== "ready" || Boolean(busy);
  let settingsState = config.isLocalDevelopment ? "LOCAL MOCK" : "OFFLINE";
  if (!config.isLocalDevelopment && phase === "loading") settingsState = "CONNECTING";
  if (!config.isLocalDevelopment && phase === "ready") settingsState = "CONNECTED";
  let saveLabel = "Create flag";
  if (hasFlag) saveLabel = "Save draft";
  if (busy === "save") saveLabel = "Saving…";

  return (
    <div className="flag-manager">
      <div className="flag-breadcrumb" aria-label="Breadcrumb">
        <a href="#/">Shorten URL</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Flagship</span>
        <span aria-hidden="true">/</span>
        <code>{FLAG_KEY}</code>
      </div>

      <header className="flag-manager-header">
        <div className="flag-manager-title">
          <p className="eyebrow">FEATURE FLAG</p>
          <h1 id="flag-page-title">{FLAG_KEY}</h1>
          <p>Route visitors with audience segments, destination variants, and gradual rollouts.</p>
        </div>
        <div className="flag-state-list" aria-label="Flag state">
          <span className={`state-badge state-badge--${phase}`}>{settingsState}</span>
          <span
            className={`flag-state-chip ${definition.enabled ? "flag-state-chip--enabled" : "flag-state-chip--disabled"}`}
          >
            {definition.enabled ? "ENABLED" : "DISABLED"}
          </span>
          <span
            className={`flag-state-chip ${hasFlag ? "flag-state-chip--saved" : "flag-state-chip--new"}`}
          >
            {hasFlag ? "DRAFT SAVED" : "NEW FLAG"}
          </span>
        </div>
      </header>

      <dl className="flag-summary-strip" aria-label="Flag summary">
        <div>
          <dt>FLAG KEY</dt>
          <dd>
            <code>{FLAG_KEY}</code>
          </dd>
        </div>
        <div>
          <dt>WORKER ORIGIN</dt>
          <dd title={config.workerOrigin}>{originHost(config.workerOrigin)}</dd>
        </div>
        <div>
          <dt>VARIANTS</dt>
          <dd>{definition.variants.length}</dd>
        </div>
        <div>
          <dt>SEGMENTS</dt>
          <dd>{definition.rules.length}</dd>
        </div>
      </dl>

      <DefinitionEditor
        definition={definition}
        setDefinition={setDefinition}
        disabled={editorDisabled}
      />

      <div className="flag-action-bar">
        <p
          className={`status status--${status.tone}`}
          role={status.tone === "error" ? "alert" : undefined}
          aria-live="polite"
        >
          {status.message}
        </p>
        <div className="flag-action-buttons">
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={Boolean(busy)}
          >
            Reload
          </button>
          <button
            className="button button--dark"
            type="button"
            onClick={handleSave}
            disabled={editorDisabled}
          >
            {saveLabel}
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={handlePublish}
            disabled={editorDisabled || !hasFlag || !version}
          >
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const config = useMemo(() => createFrontendConfig(), []);
  const currentPage = () =>
    typeof window !== "undefined" && window.location.hash === "#/flagship" ? "settings" : "shorten";
  const [activePage, setActivePage] = useState(currentPage);
  const [settingsVisited, setSettingsVisited] = useState(() => currentPage() === "settings");

  useEffect(() => {
    function handleLocationChange() {
      const page = currentPage();
      setActivePage(page);
      if (page === "settings") setSettingsVisited(true);
      window.scrollTo(0, 0);
    }

    window.addEventListener("hashchange", handleLocationChange);
    return () => window.removeEventListener("hashchange", handleLocationChange);
  }, []);

  return (
    <div className="app-shell">
      <main className={`main-content${activePage === "settings" ? " main-content--settings" : ""}`}>
        <section
          id="shorten-page"
          aria-labelledby="shorten-page-title"
          hidden={activePage !== "shorten"}
        >
          <ShortenerPage config={config} />
        </section>
        <section
          id="flagship-page"
          aria-labelledby="flag-page-title"
          hidden={activePage !== "settings"}
        >
          {settingsVisited ? <SettingsPage config={config} /> : null}
        </section>
        <footer className="app-footer">
          <nav aria-label="Project links">
            <a href="https://github.com/dytsou/shorten-url" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="/about">Docs</a>
            <a href="/api/">API</a>
          </nav>
          <p>
            © 2026 dytsou. Licensed under{" "}
            <a
              href="https://github.com/dytsou/shorten-url/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              MIT License
            </a>
            {"."}
          </p>
        </footer>
      </main>
    </div>
  );
}
