import { useEffect, useMemo, useState } from "react";
import {
  createFrontendConfig,
  createShorteningFlag,
  errorMessage,
  isSettingsRoute,
  loadSettings,
  publishShorteningFlag,
  shortenUrl,
  updateShorteningFlag,
  workerUrl,
} from "./api.js";
import "./styles/app.css";

const FLAG_KEY = "shorten-routing";

function emptyDefinition() {
  return {
    key: FLAG_KEY,
    description: "Country-aware destinations for newly created short links.",
    enabled: true,
    defaultVariant: "control",
    variants: [{ key: "control", url: "" }],
    rules: [],
  };
}

function normalizeDefinition(flag) {
  if (!flag) return emptyDefinition();

  const variants = Array.isArray(flag.variants)
    ? flag.variants.map((variant) => ({
        key: typeof variant?.key === "string" ? variant.key : "",
        url:
          typeof variant?.value?.url === "string"
            ? variant.value.url
            : typeof variant?.url === "string"
              ? variant.url
              : "",
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
          priority: Number.isInteger(rule?.priority) ? rule.priority : index + 1,
          variant: typeof rule?.variant === "string" ? rule.variant : normalizedVariants[0].key,
          countries: Array.isArray(rule?.countries)
            ? rule.countries.filter((country) => typeof country === "string")
            : [],
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
  if (
    definition.rules.some(
      (rule) => !keys.includes(rule.variant) || !rule.countries.some((country) => country.trim())
    )
  ) {
    return "Each rule needs a variant and at least one country code.";
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
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") throw new Error("Copy is not available");

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy is not available");
}

function Header({ config, settingsPage }) {
  const settingsHref = workerUrl(config.settingsPath, config);
  const homeHref = workerUrl(config.homePath, config);

  return (
    <header className="topbar">
      <a className="brand" href={homeHref} aria-label="Shorten URL home">
        <span className="brand__mark">↗</span>
        <span>shorten.url</span>
      </a>
      <div className="topbar__meta">
        <span className="online-dot" aria-hidden="true" />
        <span>EDGE LINK DESK</span>
        <a className="topbar__link" href={settingsPage ? homeHref : settingsHref}>
          {settingsPage ? "Back to desk" : "Settings"}
        </a>
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
            <span className="card-index">/ / /</span>
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
      return { ...current, variants: [...current.variants, { key, url: "" }] };
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
          priority: Math.max(0, ...current.rules.map((rule) => Number(rule.priority) || 0)) + 1,
          variant: current.variants[0]?.key || "",
          countries: ["US"],
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
    <fieldset className="editor-fields" disabled={disabled}>
      <div className="field-group">
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
          <strong>Routing flag enabled</strong>
          <small>Use country rules when creating a new short link.</small>
        </span>
        <input
          id="flag-enabled"
          type="checkbox"
          checked={definition.enabled}
          onChange={(event) => updateDefinition({ enabled: event.target.checked })}
        />
        <span className="toggle-control" aria-hidden="true" />
      </label>

      <div className="editor-section-heading">
        <div>
          <p className="eyebrow">DESTINATIONS</p>
          <p className="helper-text">Every variant must resolve to an HTTP(S) URL.</p>
        </div>
        <button className="button button--small" type="button" onClick={addVariant}>
          + Variant
        </button>
      </div>
      <div className="repeat-list">
        {definition.variants.map((variant, index) => (
          <div className="repeat-row" key={`variant-${index}`}>
            <div className="field-group field-group--compact">
              <label htmlFor={`variant-key-${index}`}>Key</label>
              <input
                id={`variant-key-${index}`}
                value={variant.key}
                onChange={(event) => updateVariantKey(index, event.target.value)}
                placeholder="control"
              />
            </div>
            <div className="field-group field-group--wide">
              <label htmlFor={`variant-url-${index}`}>Destination URL</label>
              <input
                id={`variant-url-${index}`}
                type="url"
                value={variant.url}
                onChange={(event) => updateVariant(index, "url", event.target.value)}
                placeholder="https://example.com/us"
              />
            </div>
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

      <div className="field-group">
        <label htmlFor="default-variant">Default destination</label>
        <select
          id="default-variant"
          value={definition.defaultVariant}
          onChange={(event) => updateDefinition({ defaultVariant: event.target.value })}
        >
          {definition.variants.map((variant, index) => (
            <option key={`default-${index}`} value={variant.key}>
              {variant.key || "Unnamed variant"}
            </option>
          ))}
        </select>
      </div>

      <div className="editor-section-heading editor-section-heading--rules">
        <div>
          <p className="eyebrow">COUNTRY RULES</p>
          <p className="helper-text">Rules run in ascending priority; first match wins.</p>
        </div>
        <button className="button button--small" type="button" onClick={addRule}>
          + Rule
        </button>
      </div>
      {definition.rules.length === 0 ? (
        <div className="empty-state">
          No targeting rules yet. The default destination will be used.
        </div>
      ) : (
        <div className="repeat-list repeat-list--rules">
          {definition.rules.map((rule, index) => (
            <div className="repeat-row repeat-row--rule" key={`rule-${index}`}>
              <div className="field-group field-group--priority">
                <label htmlFor={`rule-priority-${index}`}>Priority</label>
                <input
                  id={`rule-priority-${index}`}
                  type="number"
                  min="1"
                  step="1"
                  value={rule.priority}
                  onChange={(event) => updateRule(index, "priority", event.target.value)}
                />
              </div>
              <div className="field-group field-group--compact">
                <label htmlFor={`rule-variant-${index}`}>Serve</label>
                <select
                  id={`rule-variant-${index}`}
                  value={rule.variant}
                  onChange={(event) => updateRule(index, "variant", event.target.value)}
                >
                  {definition.variants.map((variant, variantIndex) => (
                    <option key={`rule-option-${variantIndex}`} value={variant.key}>
                      {variant.key || "Unnamed"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group field-group--wide">
                <label htmlFor={`rule-countries-${index}`}>Countries</label>
                <input
                  id={`rule-countries-${index}`}
                  value={rule.countries.join(", ")}
                  onChange={(event) =>
                    updateRule(
                      index,
                      "countries",
                      event.target.value.split(",").map((country) => country.trim())
                    )
                  }
                  placeholder="US, CA"
                />
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
      const result = hasFlag
        ? await updateShorteningFlag(payload, version, config, csrfToken)
        : await createShorteningFlag(payload, config, csrfToken);
      if (!result?.flag) throw new Error("The Worker returned no saved flag");
      setDefinition(normalizeDefinition(result.flag));
      setVersion(result.flag.updatedAt || version);
      setHasFlag(true);
      setStatus({
        tone: "success",
        message: "Draft saved. Publish when the destinations are ready.",
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
      const result = await publishShorteningFlag(version, config, csrfToken);
      if (!result?.flag) throw new Error("The Worker returned no published flag");
      setDefinition(normalizeDefinition(result.flag));
      setVersion(result.flag.updatedAt || version);
      setStatus({
        tone: "success",
        message: "Published. New links can now use the updated routing rules.",
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
  const settingsState =
    phase === "loading" ? "CONNECTING" : phase === "ready" ? "CONNECTED" : "OFFLINE";

  return (
    <>
      <section className="settings-heading">
        <div>
          <p className="eyebrow">FLAGSHIP / SETTINGS</p>
          <h1>
            Route the next
            <br />
            <em>generation.</em>
          </h1>
          <p className="hero-copy__lede">
            Maintain the country-aware destination flag without exposing provider credentials to the
            browser.
          </p>
        </div>
        <div className="settings-status-card">
          <span className={`state-badge state-badge--${phase}`}>{settingsState}</span>
          <p>Worker origin</p>
          <code>{originHost(config.workerOrigin)}</code>
          <small>{hasFlag ? `Version ${version || "pending"}` : "No flag created"}</small>
        </div>
      </section>

      <div className="settings-layout">
        <section className="panel panel--editor">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DEFINITION / {FLAG_KEY}</p>
              <h2>Destination map</h2>
            </div>
            <div className="panel-actions">
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
                {busy === "save" ? "Saving…" : hasFlag ? "Save draft" : "Create flag"}
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
          <DefinitionEditor
            definition={definition}
            setDefinition={setDefinition}
            disabled={editorDisabled}
          />
          <p
            className={`status status--${status.tone}`}
            role={status.tone === "error" ? "alert" : undefined}
            aria-live="polite"
          >
            {status.message}
          </p>
        </section>

        <aside className="settings-aside">
          <section className="panel aside-panel">
            <p className="eyebrow">SAFE HAND-OFF</p>
            <h2>
              Draft first.
              <br />
              Publish second.
            </h2>
            <p>
              Save checks the definition and keeps the provider version. Publish is a separate,
              optimistic-concurrency guarded action.
            </p>
            <div className="aside-rule" />
            <dl className="fact-list">
              <div>
                <dt>Access</dt>
                <dd>Cloudflare Access</dd>
              </div>
              <div>
                <dt>CSRF</dt>
                <dd>{csrfToken ? "Ready" : "Waiting"}</dd>
              </div>
              <div>
                <dt>Targeting</dt>
                <dd>Country code</dd>
              </div>
            </dl>
          </section>
          <section className="panel aside-panel aside-panel--note">
            <p className="eyebrow">OPERATING NOTE</p>
            <p>
              Keep the control variant live as a safe fallback. Unknown countries always use the
              default destination.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function App() {
  const config = useMemo(() => createFrontendConfig(), []);
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
  const settingsPage = isSettingsRoute(pathname, config.settingsPath);

  return (
    <div className="app-shell">
      <Header config={config} settingsPage={settingsPage} />
      <main className="main-content">
        {settingsPage ? <SettingsPage config={config} /> : <ShortenerPage config={config} />}
      </main>
      <footer className="footer">
        <span>SHORTEN.URL / EDGE UTILITY</span>
        <span>Built for the fast lane.</span>
      </footer>
    </div>
  );
}
