import { useEffect, useMemo, useState } from "react";
import {
  createFrontendConfig,
  createShorteningFlag,
  errorMessage,
  loadSettings,
  nextWorkspaceTab,
  publishShorteningFlag,
  shortenUrl,
  updateShorteningFlag,
  workerUrl,
  WORKSPACE_TABS,
} from "./api.js";
import { loadLocalFlagMock, publishLocalFlagMock, saveLocalFlagMock } from "./local-flag-mock.js";
import "./styles/app.css";

const FLAG_KEY = "shorten-routing";
let nextEditorItemId = 0;

function createEditorItemId(prefix) {
  nextEditorItemId += 1;
  return `${prefix}-${nextEditorItemId}`;
}

function emptyDefinition() {
  return {
    key: FLAG_KEY,
    description: "Country-aware destinations and gradual rollouts for the landing page.",
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

  return {
    key: typeof flag.key === "string" && flag.key ? flag.key : FLAG_KEY,
    description: typeof flag.description === "string" ? flag.description : "",
    enabled: flag.enabled === true,
    defaultVariant:
      typeof flag.defaultVariant === "string" && flag.defaultVariant
        ? flag.defaultVariant
        : normalizedVariants[0].key,
    variants: normalizedVariants,
    rules: Array.isArray(flag.rules)
      ? flag.rules.map((rule, index) => ({
          id: createEditorItemId("rule"),
          priority: Number.isInteger(rule?.priority) ? rule.priority : index + 1,
          variant: typeof rule?.variant === "string" ? rule.variant : normalizedVariants[0].key,
          countries: Array.isArray(rule?.countries)
            ? rule.countries.filter((country) => typeof country === "string")
            : [],
          rolloutPercentage: Number.isFinite(rule?.rolloutPercentage) ? rule.rolloutPercentage : "",
        }))
      : [],
  };
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
    rules: definition.rules.map((rule) => ({
      priority: Number(rule.priority),
      variant: rule.variant,
      countries: rule.countries.map((country) => country.trim().toUpperCase()).filter(Boolean),
      ...(rule.rolloutPercentage === "" ||
      rule.rolloutPercentage === undefined ||
      rule.rolloutPercentage === null
        ? {}
        : { rolloutPercentage: Number(rule.rolloutPercentage) }),
    })),
  };
}

function draftProblem(definition) {
  if (!definition.variants.length) return "Add at least one destination variant.";

  const keys = definition.variants.map((variant) => variant.key.trim()).filter(Boolean);
  if (keys.length !== new Set(keys).size) return "Variant keys must be unique.";
  if (keys.length !== definition.variants.length) return "Every variant needs a key.";
  if (!keys.includes(definition.defaultVariant)) return "Choose an existing default variant.";
  if (definition.variants.some((variant) => !variant.url.trim())) {
    return "Every variant needs a destination URL.";
  }

  const priorities = definition.rules.map((rule) => Number(rule.priority));
  if (priorities.some((priority) => !Number.isInteger(priority) || priority < 1)) {
    return "Rule priorities must be positive whole numbers.";
  }
  if (priorities.length !== new Set(priorities).size) return "Rule priorities must be unique.";
  if (definition.rules.some((rule) => !keys.includes(rule.variant))) {
    return "Each rule needs an existing variant.";
  }
  for (const rule of definition.rules) {
    const countries = rule.countries.map((country) => country.trim().toUpperCase()).filter(Boolean);
    const hasRollout =
      rule.rolloutPercentage !== "" &&
      rule.rolloutPercentage !== undefined &&
      rule.rolloutPercentage !== null;
    if (countries.length === 0 && !hasRollout) {
      return "Each rule needs a country or a rollout percentage.";
    }
    if (countries.some((country) => !/^[A-Z]{2}$/.test(country))) {
      return "Countries must use two-letter country codes.";
    }
    if (new Set(countries).size !== countries.length) {
      return "Countries in a rule must be unique.";
    }
    if (hasRollout) {
      const percentage = Number(rule.rolloutPercentage);
      if (
        !Number.isFinite(percentage) ||
        percentage < 0 ||
        percentage > 100 ||
        Math.abs(percentage * 100 - Math.round(percentage * 100)) > 1e-8
      ) {
        return "Rollout percentages must be between 0 and 100, with at most two decimals.";
      }
    }
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

function Header({ config, activeTab, onTabChange }) {
  const homeHref = workerUrl(config.homePath, config);

  function handleTabKeyDown(event) {
    const nextTab = nextWorkspaceTab(activeTab, event.key);
    if (!nextTab) return;
    event.preventDefault();
    onTabChange(nextTab);
    document.getElementById(`${nextTab}-tab`)?.focus();
  }

  return (
    <header className="topbar">
      <a className="brand" href={homeHref} aria-label="Shorten URL home">
        <span className="brand__mark">↗</span>
        <span>shorten.url</span>
      </a>
      <div className="topbar__meta">
        <span className="online-dot" aria-hidden="true" />
        <span>EDGE LINK DESK</span>
        <div className="topbar__tabs" role="tablist" aria-label="Workspace view">
          {WORKSPACE_TABS.map(({ id: tab, label }) => (
            <button
              id={`${tab}-tab`}
              className="topbar__tab"
              type="button"
              role="tab"
              aria-controls={`${tab}-panel`}
              aria-selected={activeTab === tab}
              tabIndex={activeTab === tab ? 0 : -1}
              key={tab}
              onClick={() => onTabChange(tab)}
              onKeyDown={handleTabKeyDown}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
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
    <>
      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">01 / CREATE A LINK</p>
          <h1>
            Make the long URL
            <br />
            <em>disappear.</em>
          </h1>
          <p className="hero-copy__lede">
            One clean link for the edge. Add a memorable slug when the destination needs a little
            more signal.
          </p>
          <div className="hero-notes" aria-label="Service characteristics">
            <span>
              <strong>01</strong> WARP protected
            </span>
            <span>
              <strong>02</strong> KV backed
            </span>
            <span>
              <strong>03</strong> Global edge
            </span>
          </div>
        </div>

        <form className="shorten-card" onSubmit={handleSubmit}>
          <div className="card-topline">
            <span>NEW SHORT LINK</span>
          </div>
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
          <div className="field-group">
            <label htmlFor="custom-slug">
              Custom slug <span className="label-note">optional</span>
            </label>
            <div className="slug-input">
              <span aria-hidden="true">/</span>
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
          </div>
          <button className="button button--primary button--wide" type="submit" disabled={busy}>
            {busy ? "Creating link…" : "Shorten URL"}
            <span aria-hidden="true">↗</span>
          </button>
          <p className="form-footnote">
            Requests are sent to <code>{originHost(config.workerOrigin)}</code>.
          </p>
          {error && (
            <p className="status status--error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

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

      <section className="process-strip" aria-label="How it works">
        <div className="process-strip__intro">
          <p className="eyebrow">THE SMALL PRINT</p>
          <p>
            Short links stay simple. The Worker handles validation, access, storage, and redirects.
          </p>
        </div>
        <div className="process-step">
          <span>01</span>
          <strong>Paste</strong>
          <p>Give us the full destination.</p>
        </div>
        <div className="process-step">
          <span>02</span>
          <strong>Shape</strong>
          <p>Optionally name the link.</p>
        </div>
        <div className="process-step">
          <span>03</span>
          <strong>Share</strong>
          <p>Copy the edge-ready result.</p>
        </div>
      </section>
    </>
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
          priority: Math.max(0, ...current.rules.map((rule) => Number(rule.priority) || 0)) + 1,
          variant: current.variants[0]?.key || "",
          countries: ["US"],
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

  return (
    <fieldset className="flag-editor" aria-label="Flag configuration" disabled={disabled}>
      <nav className="flag-section-nav" aria-label="Flag configuration sections">
        <a href="#flag-details">Details</a>
        <a href="#flag-variants">
          Variations <span>{definition.variants.length}</span>
        </a>
        <a href="#flag-rules">
          Targeting rules <span>{definition.rules.length}</span>
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
          <label className="toggle-row" htmlFor="flag-enabled">
            <span>
              <strong>Flag enabled</strong>
              <small>When disabled, visitors receive the default variation.</small>
            </span>
            <input
              id="flag-enabled"
              type="checkbox"
              checked={definition.enabled}
              onChange={(event) => updateDefinition({ enabled: event.target.checked })}
            />
            <span className="toggle-control" aria-hidden="true" />
          </label>
        </div>
      </section>

      <section id="flag-variants" className="flag-section panel">
        <div className="flag-section-heading">
          <div>
            <p className="eyebrow">02 / VARIATIONS</p>
            <h2>Variations</h2>
            <p className="helper-text">Each variation returns one safe HTTP(S) destination.</p>
          </div>
          <div className="flag-section-tools">
            <span className="count-chip">{definition.variants.length} total</span>
            <button className="button button--small" type="button" onClick={addVariant}>
              + Add variation
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
                aria-label={`Remove ${variant.key || "variation"}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="flag-rules" className="flag-section panel">
        <div className="flag-section-heading flag-section-heading--rules">
          <div>
            <p className="eyebrow">03 / TARGETING</p>
            <h2>Targeting rules</h2>
            <p className="helper-text">
              Rules run by priority. Blank countries match every country; browsers keep a stable
              bucket. Use cumulative rollout thresholds for a multi-variation split.
            </p>
          </div>
          <div className="flag-section-tools">
            <span className="count-chip">{definition.rules.length} total</span>
            <button className="button button--small" type="button" onClick={addRule}>
              + Add rule
            </button>
          </div>
        </div>
        {definition.rules.length === 0 ? (
          <div className="empty-state">
            <strong>No targeting rules</strong>
            <span>All visitors receive the default variation until you add a rule.</span>
          </div>
        ) : (
          <div className="rule-list">
            <div className="rule-list-heading" aria-hidden="true">
              <span>Priority</span>
              <span>Country audience</span>
              <span>Rollout</span>
              <span>Serve variation</span>
              <span />
            </div>
            {definition.rules.map((rule, index) => (
              <div className="rule-row" key={rule.id}>
                <div className="field-group rule-priority-field">
                  <label htmlFor={`rule-priority-${rule.id}`}>Priority</label>
                  <input
                    id={`rule-priority-${rule.id}`}
                    type="number"
                    min="1"
                    step="1"
                    value={rule.priority}
                    onChange={(event) => updateRule(index, "priority", event.target.value)}
                  />
                </div>
                <div className="field-group rule-country-field">
                  <label htmlFor={`rule-countries-${rule.id}`}>Countries (optional)</label>
                  <input
                    id={`rule-countries-${rule.id}`}
                    value={rule.countries.join(", ")}
                    onChange={(event) =>
                      updateRule(
                        index,
                        "countries",
                        event.target.value.split(",").map((country) => country.trim())
                      )
                    }
                    placeholder="All countries or US, CA"
                  />
                </div>
                <div className="field-group rule-rollout-field">
                  <label htmlFor={`rule-rollout-${rule.id}`}>Rollout (%)</label>
                  <input
                    id={`rule-rollout-${rule.id}`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={rule.rolloutPercentage}
                    onChange={(event) => updateRule(index, "rolloutPercentage", event.target.value)}
                    placeholder="100"
                  />
                </div>
                <div className="field-group rule-variation-field">
                  <label htmlFor={`rule-variant-${rule.id}`}>Serve</label>
                  <select
                    id={`rule-variant-${rule.id}`}
                    value={rule.variant}
                    onChange={(event) => updateRule(index, "variant", event.target.value)}
                  >
                    {definition.variants.map((variant) => (
                      <option key={`${rule.id}-${variant.id}`} value={variant.key}>
                        {variant.key || "Unnamed"}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() =>
                    updateDefinition({
                      rules: definition.rules.filter((_, ruleIndex) => ruleIndex !== index),
                    })
                  }
                  aria-label={`Remove rule ${index + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="rule-fallback">
          <span className="rule-fallback__marker" aria-hidden="true">
            ↳
          </span>
          <div>
            <span>Default variation</span>
            <strong>{definition.defaultVariant || "Choose a variation"}</strong>
          </div>
          <p>Used when a visitor falls through every targeting rule.</p>
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
        <span>Flag management</span>
        <span aria-hidden="true">/</span>
        <code>{FLAG_KEY}</code>
      </div>

      <header className="flag-manager-header">
        <div className="flag-manager-title">
          <p className="eyebrow">JSON FEATURE FLAG</p>
          <h1 id="flag-page-title">{FLAG_KEY}</h1>
          <p>Country and percentage routing for the protected landing page.</p>
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
            {hasFlag ? "SAVED" : "NOT SAVED"}
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
          <dt>VARIATIONS</dt>
          <dd>{definition.variants.length}</dd>
        </div>
        <div>
          <dt>TARGETING RULES</dt>
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
  const [activeTab, setActiveTab] = useState("shorten");
  const [settingsVisited, setSettingsVisited] = useState(false);

  function selectTab(tab) {
    setActiveTab(tab);
    if (tab === "settings") setSettingsVisited(true);
  }

  return (
    <div className="app-shell">
      <Header config={config} activeTab={activeTab} onTabChange={selectTab} />
      <main className={`main-content${activeTab === "settings" ? " main-content--settings" : ""}`}>
        <section
          id="shorten-panel"
          role="tabpanel"
          aria-labelledby="shorten-tab"
          hidden={activeTab !== "shorten"}
        >
          <ShortenerPage config={config} />
        </section>
        <section
          id="settings-panel"
          role="tabpanel"
          aria-labelledby="settings-tab"
          hidden={activeTab !== "settings"}
        >
          {settingsVisited ? <SettingsPage config={config} /> : null}
        </section>
      </main>
      <footer className="footer">
        <span>SHORTEN.URL / EDGE UTILITY</span>
        <span>Built for the fast lane.</span>
      </footer>
    </div>
  );
}
