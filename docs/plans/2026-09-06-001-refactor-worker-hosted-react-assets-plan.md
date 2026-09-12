---
title: "Worker-Hosted React Assets and Local Build - Plan"
type: refactor
date: 2026-09-06
topic: worker-hosted-react-assets
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
deepened: 2026-09-06
---

# Worker-Hosted React Assets and Local Build - Plan

## Goal Capsule

- **Objective:** Make the React frontend a reproducible Workers Static Assets build served directly by the URL-shortening Worker, so local development and production use the same `frontend/dist` asset path while preserving shortening, redirect, Flagship, and Access behavior.
- **Product authority:** The existing URL-shortening Worker remains the runtime authority. React/Vite remains the frontend source and build system; Worker logic remains under `src/`; the existing documentation site is not merged into the product frontend.
- **Open blockers:** Cloudflare account identifiers, KV/Flagship bindings, Access configuration, and deployment secrets still need to be supplied by the deployment environment. They are operational prerequisites, not reasons to make local compilation depend on live Cloudflare services.

## Product Contract

### Summary

Serve the main React UI and protected settings shell from a Workers Assets binding rooted at `frontend/dist`. A clean checkout must be able to build the frontend, start Wrangler, and exercise the real Worker route ordering without copying `docs/` or requiring a real Access/Flagship service locally.

React is retained. A VanillaJS rewrite is explicitly out of scope because the existing frontend already owns the UI composition, same-origin API configuration, credentials, and CSRF behavior required by this change.

### Problem Frame

The current example Worker obtains the main page through `fetchHostedPage(getEndpoints().shortenPage)`, while the repository configuration points Wrangler at a missing `src/worker.js` and has no Workers Assets binding. The frontend build is a separate Vite package, and the root scripts do not guarantee that `frontend/dist` exists before `wrangler dev` or deployment.

That split creates three failure modes: local development can pass with ignored developer files that are absent from a clean checkout; the Worker can serve a different page path from the React API configuration; and a broad SPA fallback can turn an unknown short-link key or API path into HTML instead of a redirect or JSON response.

### Key Decisions

- **The Worker hosts the product frontend through Workers Assets** (session-settled: user-directed — chosen over a Pages proxy or embedding the frontend bundle into Worker JavaScript so local and production use one origin and one route boundary). Governs R1, R5, R8, and R11.
- **React/Vite remains the implementation boundary** (session-settled: user-approved — chosen over a VanillaJS rewrite because the existing UI and API helpers already provide the needed behavior, while a rewrite would add unrelated product risk). Governs R1, R2, and R7.
- **The root workflow builds first and then runs Wrangler** (session-settled: user-directed — chosen over treating Vite dev server or a separately hosted page as the integration path). Governs R2, R3, and R13.
- **Access remains enforced for local settings** (session-settled: user-directed — chosen over a local-only bypass or fake production authorization so local tests exercise the same protected boundary). Governs R6, R10, and R13.
- **Only `frontend/dist` is in the Worker asset collection** (session-settled: user-directed — `docs/index.html` and the rest of `docs/` remain outside the product asset boundary). Governs R1, R5, and R11.

### Actors

- A1. **Visitor:** Opens the shortening UI, submits a destination, or follows a short link.
- A2. **Authorized operator:** Opens `/settings` and uses the existing protected Flagship management APIs.
- A3. **Local developer:** Builds the React package and runs the Worker with deterministic local mocks.
- A4. **Cloudflare runtime:** Provides Worker execution, KV, Access context, Flagship bindings, and Workers Assets.

### Requirements

**Source and build boundary**

- R1. All product UI source and generated UI assets remain under `frontend/`; all Worker routing, asset delegation, compatibility, and backend behavior remain under `src/`. The implementation must not modify `docs/index.html` or copy `docs/` into the Worker asset directory.
- R2. A root build contract must compile the existing React/Vite package into exactly `frontend/dist`, with a clean checkout able to reproduce the output from declared dependencies. Generated `frontend/dist` remains untracked.
- R3. The root development path must build the frontend before starting `wrangler dev`. A separate Vite-only watch command may remain available for UI iteration, but it is not the end-to-end runtime contract.
- R4. Wrangler must point at a tracked, reproducible Worker entrypoint and an explicit Workers Assets configuration. Startup must not depend on ignored `src/worker.js`/`src/worker.dev.js` files or injected global configuration that only exists in one developer's shell.

**Runtime and routing**

- R5. The Worker must serve `/` and frontend static assets through an `ASSETS` binding rooted only at `frontend/dist`.
- R6. `GET`/`HEAD` `/settings`, `/settings/`, and future non-API `/settings/*` shell requests, plus every `/settings/api` and `/settings/api/*` request, must remain behind the existing Access authorization and CSRF/origin protections. Local development must use mocks or fixtures to exercise this boundary, never a production-auth bypass.
- R7. The React app must use same-origin URLs in Worker-hosted mode. `POST /shorten` is the canonical shortening endpoint; existing `POST /` behavior is retained only as an explicitly tested compatibility path if current clients require it.
- R8. Dynamic routes must win over asset fallback: preflight, shortening APIs, settings APIs, Access checks, Flagship evaluation, and short-link redirects/not-found handling must execute before the Worker delegates to Assets. Unknown short-link paths and unknown API paths must not become the React shell.
- R9. The Worker-hosted shell for `/` and authorized `/settings` must be fetched from the built asset collection. The normal UI path must not fetch an externally hosted page. Legacy external error-page behavior may remain only when an explicit legacy frontend URL is configured; Worker-hosted mode must have a safe local response when it is not.
- R10. Local tests must provide deterministic Access, Flagship, KV, and Assets doubles. Production code must not contain a local-only authorization branch, and browser code must never receive Flagship credentials or Worker secrets.
- R15. The production route boundary must not trust client-supplied Access-like headers on an unprotected direct Worker hostname. Production must disable the default direct Worker hostname, expose the Worker only through an allowlisted custom hostname protected by Access, and reject protected requests whose host is not allowlisted; forged headers must not authorize settings, shortening, or Flagship evaluation.

**Deployment and maintenance**

- R11. Production deployment must use the same Worker Assets path as local integration. If GitHub Pages remains enabled for documentation, its artifact must be documentation-only; it must not remain the source of the product frontend.
- R12. Existing short-link KV behavior, redirect safety, Flagship evaluation/fallback semantics, response shapes, and OPTIONS behavior must remain unchanged except where the new asset route boundary necessarily replaces hosted-page fetching.
- R13. Verification must cover a clean build, the real Wrangler runtime, protected settings, same-origin shortening, static assets, short-link redirects, unknown paths, and local provider failure behavior.
- R14. Documentation and example configuration must explain the build-before-Wrangler workflow, the `frontend/dist` asset boundary, required production bindings/secrets, and the distinction between the product Worker and the documentation site.

### Key Flows

- F1. **Build and start locally**
  - **Trigger:** A developer checks out the repository and runs the root development workflow.
  - **Actors:** A3, A4.
  - **Steps:** The root workflow builds `frontend/` into `frontend/dist`, starts Wrangler with the tracked Worker entrypoint, and exposes the Worker origin.
  - **Outcome:** `/` returns the built React shell from the Assets binding without requiring a real hosted frontend, Access tenant, or Flagship service.
  - **Covered by:** R2, R3, R4, R5, R10, R13.

- F2. **Submit a shortening request**
  - **Trigger:** A visitor submits the React form.
  - **Actors:** A1, A4.
  - **Steps:** React sends same-origin `POST /shorten`; the Worker recognizes the API before asset fallback and invokes the existing shortener.
  - **Outcome:** The existing success, validation, storage, and error responses are returned as API responses rather than the React shell.
  - **Covered by:** R7, R8, R12, R13.

- F3. **Follow a short link**
  - **Trigger:** A visitor requests `/<key>`.
  - **Actors:** A1, A4.
  - **Steps:** The Worker classifies the path as a short-link candidate before delegating to Assets, evaluates any active Flagship behavior, and performs the existing safe redirect or not-found response.
  - **Outcome:** A valid key redirects; an invalid key retains the existing not-found semantics; neither result is replaced by `index.html`.
  - **Covered by:** R8, R9, R12, R13.

- F4. **Open protected settings**
  - **Trigger:** An operator requests `/settings`.
  - **Actors:** A2, A4.
  - **Steps:** The Worker authorizes the request first, then fetches the React shell from the Assets binding. Subsequent `/settings/api` and `/settings/api/*` calls remain in the protected Flagship route boundary.
  - **Outcome:** Authorized operators see the settings UI; unauthorized requests receive the existing denial behavior; API failures remain JSON/API failures.
  - **Covered by:** R6, R8, R9, R10, R13.

- F5. **Deploy the same artifact shape**
  - **Trigger:** The production deployment workflow runs.
  - **Actors:** A4, repository automation.
  - **Steps:** CI installs declared dependencies, builds `frontend/dist`, validates the Worker/Assets configuration, and deploys the Worker with the required production bindings and secrets.
  - **Outcome:** Production serves the same Worker-hosted React route boundary; the documentation Pages artifact, if retained, contains only documentation.
  - **Covered by:** R2, R4, R5, R11, R14.

### Acceptance Examples

- AE1. **Clean checkout build:** Given a clean checkout with declared dependencies installed, when the root build runs, then `frontend/dist/index.html` and its Vite assets are produced and no generated asset is required to be committed.
- AE2. **Worker-hosted root:** Given the built asset directory and local Worker bindings, when `GET /` is requested through Wrangler, then the response is the React shell from `ASSETS`, not an external hosted-page fetch.
- AE3. **Protected settings shell:** Given no valid Access context, when `GET` or `HEAD` `/settings`, `/settings/`, or a supported settings deep link is requested, then the request is denied before the asset shell is returned. Given a valid mocked Access context, the shell is returned from `ASSETS`.
- AE4. **API precedence:** Given a built frontend, when `POST /shorten`, `POST /` compatibility, OPTIONS, or `/settings/api/*` is requested, then the appropriate existing Worker/API handler runs and no HTML shell is returned.
- AE5. **Redirect precedence:** Given a valid and invalid short-link key, when each key is requested, then the valid key keeps its redirect and the invalid key keeps its not-found response; neither request receives SPA HTML.
- AE6. **Same-origin frontend:** Given the Worker-hosted build with no explicit cross-origin override, when the React form or settings UI creates a request, then its URL is same-origin and credentials/CSRF behavior remains intact.
- AE7. **Local provider isolation:** Given local mock Access/Flagship/KV/Assets bindings, when settings and shortening flows are exercised, then tests are deterministic and no production secret or live provider request is required.
- AE8. **Deployment parity:** Given the production workflow, when the Worker is deployed, then its asset directory is `frontend/dist`, its entrypoint is tracked, and the Pages artifact does not provide the product frontend.
- AE9. **Documentation boundary:** Given the implementation, when the diff is inspected, then `docs/index.html` is unchanged and no file under `docs/` is copied into `frontend/dist` or the Worker asset collection.

### Scope Boundaries

- **Deferred for later:** React visual redesign, new settings features, a VanillaJS rewrite, HMR through Wrangler, a new Flagship product model, and changes to country targeting or fallback semantics already covered by the existing Flagship plan.
- **Outside this product's identity:** The documentation site under `docs/` is not the product frontend and is not an alternate Worker asset source.
- **Compatibility boundary:** The existing external hosted-page path is not removed wholesale in this plan; it is removed from the normal Worker-hosted UI path and retained only for explicitly configured legacy error/compatibility behavior.

### Dependencies and Assumptions

- Wrangler v4 supports the Workers Assets `directory`, `binding`, `run_worker_first`, and `not_found_handling` settings used by the plan.
- `frontend/` remains a separate Vite package rather than adopting the Cloudflare Vite plugin; its React plugin and Vite version remain declared in that package.
- Local Wrangler can provide KV and test bindings without a live Cloudflare account. Access and Flagship behavior is represented by test/mocked environments.
- Production continues to provide the existing `LINKS`, Access, Flagship, and observability configuration. Secret values are provisioned outside the repository.
- The current frontend routes are the root shell and `/settings`; adding another React navigation route later requires adding it to the Worker shell route table rather than enabling a global fallback that could capture short links.

### Outstanding Questions

- **Resolved in Planning:** Create and track `src/worker.js` as the canonical Wrangler entrypoint. Extract the shared handler/config normalization into `src/lib/` so `src/worker.example.js` remains an executable example/fixture without being the only production source.
- **Resolved in Planning:** Configure a named `ASSETS` binding for `frontend/dist`, set Worker-first routing for the application boundary, and use `not_found_handling = "none"` with explicit shell delegation rather than broad automatic SPA fallback. This makes `/settings` authorization and short-link precedence testable and prevents unknown keys from becoming HTML.
- **Resolved in Planning:** Use `/` for the Worker-hosted shell and `/shorten` as the canonical frontend API path. Keep `POST /` only as a compatibility handler if existing clients/tests demonstrate that it is still required.
- **Resolved in Planning:** Protect `/settings` itself as well as `/settings/api/*`; an unauthenticated request must not receive the settings shell.
- **Resolved in Planning:** Protect `/settings`, `/settings/`, and all non-API `/settings/*` shell paths before any Assets fetch; match `/settings/api/*` first as the API branch.
- **Resolved in Planning:** Use a dedicated Worker deployment workflow for the product frontend and make the existing Pages workflow documentation-only if documentation deployment is still needed. The product deploy must not depend on the Pages artifact.
- **Resolved in Planning:** Treat Worker-hosted same-origin requests as the default credentialed origin. Any retained cross-origin mode requires an explicit allowlist; unknown, `null`, or missing mutation origins are rejected and wildcard credentials are forbidden. Production disables the default direct Worker hostname and accepts protected user-facing traffic only on an allowlisted Access-protected custom hostname.
- **Deferred to implementation:** Confirm the exact Cloudflare account name, Access issuer/audience values, Flagship binding names, and CI secret names in the deployment environment. These values must be wired through configuration/secrets, never guessed or committed.

## Planning Contract

### Key Technical Decisions

- **KTD1 — Workers Assets is the single product frontend boundary.** Configure one Assets collection at `frontend/dist` with an `ASSETS` binding and `not_found_handling = "none"`. The Worker explicitly delegates the root shell and known static assets through that binding. This follows the user’s direct-Worker decision and avoids a Pages proxy or bundle embedding; the official Assets binding supports `env.ASSETS.fetch()` for this pattern. Explicit shell mapping is safer than global SPA fallback because every non-reserved path is potentially a short-link key. Governs R1, R5, R8, R9, and R11.
- **KTD2 — Use Worker-first routing for correctness, then delegate cacheable assets.** Set `run_worker_first = true` for the Worker route boundary. The Worker handles OPTIONS, settings/API authorization, shortening APIs, root Flagship evaluation, and reserved static/shell paths before short-link resolution; it delegates only an explicitly recognized shell or static asset to `ASSETS`. This costs an invocation for the dynamic boundary but prevents authorization and redirect semantics from being decided by asset routing. Governs R6, R8, R9, and R12.
- **KTD3 — Establish one tracked runtime entrypoint and one route composer.** `src/worker.js` becomes the canonical `main`; a shared `src/lib/worker-handler.js` owns route composition and normalized runtime configuration; `src/worker.example.js` reuses that boundary for examples/tests. `flag-routes.js` receives a settings-shell responder or remains limited to authorization/API concerns and must not know about Workers Assets or call `fetchHostedPage()`. This removes the current clean-checkout gap and prevents entrypoint/UI transport drift. Governs R4, R6, R8, R10, and R13.
- **KTD4 — Keep the frontend package separate but make the root contract authoritative.** Preserve the existing React/Vite package and React plugin, add a root build that delegates to it, and make root development/deployment depend on that build. Keep a committed `frontend/pnpm-lock.yaml` for the separate package and use frozen installs in CI/deploy/local setup. Do not add the Cloudflare Vite plugin or rewrite the UI. Use root-relative asset URLs for the Worker origin and verify `/` and `/settings` explicitly. Governs R1, R2, R3, R7, and R13.
- **KTD5 — Treat same-origin as the supported hosted mode with separate path fields and an origin matrix.** Normalize `shellPath = "/"`, `settingsPath = "/settings"`, `shortenApiPath = "/shorten"`, and `flagEvaluationPath = "/"` independently; keep compatibility `POST /` separate rather than reusing the evaluation path. Existing API helper credentials and CSRF behavior remain in place. The Worker origin is the default allowed credentialed origin; a configured legacy frontend origin is an explicit opt-in, while unknown/`null`/missing mutation origins are rejected and `Access-Control-Allow-Origin: *` is never combined with credentials. External-origin configuration is not required for the Worker-hosted flow. Governs R7, R9, R12, R13, and R15.
- **KTD6 — Local realism comes from mocks, not weakened authorization.** Test environments provide Access claims/headers, Flagship behavior, KV, and Assets fetchers. The runtime has no `NODE_ENV`-style bypass for `/settings`; missing, malformed, or forged authorization remains denied in local and production code paths. Production uses an origin-lock policy: disable the default direct Worker hostname, allowlist the Access-protected custom hostname, and reject protected requests on any other host before relying on the existing header-based shortening/evaluation checks. Governs R6, R10, R13, and R15.
- **KTD7 — Public configuration is an allowlisted projection.** Only non-sensitive frontend values such as shell/API paths, public origin, and display settings may reach Vite metadata or generated HTML. Worker secrets, Access values, Flagship tokens/CSRF material, KV identifiers, test sentinels, local vars, and secret-bearing source maps/files must be excluded from `frontend/dist` and deployment manifests. Governs R2, R10, R14, and R15.
- **KTD8 — Separate product deployment from documentation deployment.** A dedicated Worker deployment workflow builds and uploads only `frontend/dist` from a tracked non-secret Wrangler configuration. The Pages workflow, if kept, builds/deploys `docs/` without copying the frontend. Production deploys require an explicit prerequisite gate, a pre-deploy manifest, a non-mutating smoke, and a previous Worker version plus asset manifest for rollback. This keeps `docs/index.html` untouched while preventing two production frontend authorities. Governs R1, R11, R13, and R14.

### High-Level Technical Design

```mermaid
flowchart TD
    Source[frontend React/Vite source] --> Build[root build contract]
    Build --> Dist[frontend/dist]
    Dist --> Assets[Workers Assets binding]
    Request[Browser request] --> Gate[Tracked Worker route gate]
    Gate --> Options[OPTIONS / CORS]
    Gate --> SettingsAuth[Access + CSRF boundary]
    SettingsAuth --> SettingsAPI[/settings/api/*]
    SettingsAuth --> SettingsShell[/settings shell]
    Gate --> ShortenAPI[/shorten and compatibility POST]
    Gate --> Flagship[Eligible Flagship evaluation]
    Flagship --> Redirect[Short-link redirect or not-found]
    Gate --> Static[Known static asset]
    Gate --> Root[Root shell]
    SettingsShell --> Assets
    Static --> Assets
    Root --> Assets
    ShortenAPI --> KV[Existing LINKS / shortener]
    Redirect --> KV
    Deploy[Worker deploy workflow] --> Build
    Deploy --> Assets
```

The route gate is intentionally ordered:

| Priority | Request class | Result |
| --- | --- | --- |
| 1 | OPTIONS and explicit CORS preflight | Existing 204/preflight behavior |
| 2 | `/settings/api` and `/settings/api/*` | Access, origin, CSRF, then Flagship management/API response |
| 3 | `/settings`, `/settings/`, and future non-API settings shell paths | Access first, then map the shell request to the root asset |
| 4 | Canonical shortening API and any retained compatibility POST | Existing shortener response |
| 5 | Eligible root/shortening-page evaluation | Existing Flagship decision and safe fallback |
| 6 | `/` root shell | Explicit root `ASSETS` fetch after evaluation/fallback |
| 7 | `/assets/*` and an explicit allowlist of root public assets | Static asset `ASSETS` fetch |
| 8 | Short-link candidate paths | Existing redirect/not-found/safety behavior; never automatic SPA HTML |
| 9 | Unknown API/static paths | Existing JSON/404 semantics; no shell fallback |

The asset helper should fetch the built root shell for `/settings` rather than asking the asset collection to reinterpret an arbitrary path. It should preserve request method, headers, content type, and cache behavior for static files, while never forwarding Access-sensitive settings responses through a public asset path. The normalized route configuration must keep shell, shortening API, and Flagship evaluation paths independent so changing one cannot silently move another.

### Implementation Units

#### U1. Establish the tracked Worker runtime and Assets configuration

- **Files:** `src/worker.js` (create), `src/worker.example.js`, the new `src/lib/worker-handler.js` and runtime-config module, `wrangler.toml.example`, and related Worker configuration documentation.
- **Depends on:** Existing `src/worker.example.js` flow, `src/lib/flag-routes.js`, `src/lib/responses.js`, `src/lib/endpoints.js`, and the current ignored local Wrangler configuration.
- **Approach:** Extract the shared request composition without changing existing shortener/Flagship semantics. Make `src/worker.js` the tracked `main`, normalize configuration from Worker bindings/variables with safe local defaults, and keep example/test adapters on the same shared path. Keep `flag-routes.js` limited to settings authorization/API and inject the shell response from the route composer. Add an `ASSETS` binding rooted at `frontend/dist`, `run_worker_first = true`, and `not_found_handling = "none"`; keep the local `wrangler.toml` developer copy ignored but make `wrangler.toml.example` sufficient to reproduce the shape. The production deployment profile must disable the default direct Worker hostname and declare the allowlisted Access-protected route; local Wrangler may use localhost without that production route. Do not use global `importConfig`/`defaultConfig` as the only startup contract.
- **Test scenarios:** Import the canonical entrypoint in a clean test environment; verify missing optional local provider bindings do not prevent the Worker from starting; verify the example and canonical adapters share route behavior; verify shell/API/evaluation path fields are independent; verify the Wrangler example names `src/worker.js`, `frontend/dist`, `ASSETS`, `run_worker_first`, `not_found_handling`, and the existing KV binding; verify a protected-route request on a non-allowlisted host is rejected even with forged Access-like headers.

#### U2. Make the root build contract produce the Worker asset directory

- **Files:** Root `package.json`, `frontend/package.json`, new `frontend/pnpm-lock.yaml`, `frontend/vite.config.js`, `frontend/index.html`, `.github/workflows/ci.yml`, and package-manager lock/config files needed for reproducibility.
- **Depends on:** U1’s asset directory and tracked entrypoint.
- **Approach:** Add one root build entry that invokes the existing frontend package and one root development/deployment path that runs that build before Wrangler. Keep Vite and React as the frontend toolchain, set the build base for the Worker origin, and make the generated API metadata agree with `/`, `/settings`, and `/shorten`. Keep the frontend build output ignored, use the committed frontend lockfile with frozen installs, and avoid adding a second frontend bundler or Cloudflare-specific plugin.
- **Test scenarios:** Build from a clean checkout using the root and frontend frozen dependency contracts; assert `frontend/dist/index.html` references generated assets with paths that work at `/` and `/settings`; confirm a failed frontend build prevents Wrangler from starting; confirm repeated builds do not change tracked source; verify CI uses the same root build contract rather than a separately assembled frontend artifact.

#### U3. Replace hosted-page UI fetches with route-safe asset delegation

- **Files:** `src/worker.js`, `src/worker.example.js`, the shared Worker application module from U1, `src/lib/flag-routes.js`, `src/lib/responses.js`, `src/lib/endpoints.js`, `frontend/src/api.js`, and `frontend/index.html`.
- **Depends on:** U1 and U2.
- **Approach:** Add a narrow asset/shell delegation boundary. `/` and authorized `/settings` obtain the shell from `env.ASSETS`; known generated assets are delegated directly. Protect `/settings`, `/settings/`, and future non-API `/settings/*` before shell mapping, with `/settings/api` and `/settings/api/*` matched first. Apply the same authorization before `HEAD` shell responses. Enforce the allowlisted production host before any header-presence access check on shortening/evaluation paths. Preserve the existing API, redirect, Flagship evaluation, CORS, CSRF, and error behavior before delegation. Remove `fetchHostedPage` from normal product-page serving, and split Worker-hosted endpoint data from optional legacy `frontend.url` data so missing legacy configuration produces a safe local error/not-found response rather than startup failure or an unintended external fetch. Any retained legacy URL must be an explicit validated HTTPS endpoint, and legacy HTML/interstitial output must retain existing escaping guarantees. Make same-origin frontend configuration the default and use independent shell/API/evaluation paths with a tested compatibility decision for `POST /`. Do not construct filesystem paths from request strings; delegate through `ASSETS.fetch()` only.
- **Test scenarios:** Mock `env.ASSETS.fetch` and verify root HTML/static content types; verify `GET`/`HEAD` `/settings`, `/settings/`, and a settings deep link deny before asset fetch and serve the shell after mocked authorization; verify `/settings/api`, `/settings/api/*`, `POST /shorten`, OPTIONS, valid redirects, invalid keys, unknown APIs, malformed/encoded asset paths, hidden files, and Flagship fallback never return the shell or call `ASSETS.fetch` unexpectedly; verify same-origin URL and CSRF/credentials behavior in `tests/frontend-api.test.js`; verify `javascript:`, `data:`, protocol-relative, credential-bearing, and malformed variant destinations are rejected before redirect.

#### U4. Add deterministic local Access/Flagship/Assets integration fixtures

- **Files:** `tests/mocks/cloudflare-workers.js`, new focused worker asset/routing fixtures under `tests/`, `tests/worker-flagship.test.js`, `tests/flag-routes.test.js`, and any shared test setup needed to stop relying on ignored local Worker files.
- **Depends on:** U3’s route boundary and existing Flagship test fixtures.
- **Approach:** Extend the current mocks with an Assets fetcher that can return the built shell, static files, and misses; keep Access mocks explicit per test; keep Flagship management/evaluation failures injectable. Test both local success and failure states without changing production authorization. Use tracked fixtures or in-memory responses so a clean CI checkout has the same evidence as a developer machine. Add negative fixtures for forged Access-like headers, provider exceptions containing secret-like text, and public-config leak sentinels.
- **Test scenarios:** Missing/invalid/forged Access denies `/settings`, settings API mutations, and any protected route; authorized verified mocked Access reaches the shell/API; missing Flagship binding, provider failure, malformed decision, and no-match preserve current shortening behavior; missing asset returns the intended error; provider error responses/log fields do not contain raw token/secret text; the built asset inventory contains only allowlisted public config and no `.dev.vars`, `config.js`, secret-like filenames, or test sentinels; no test makes a live provider request or exposes a secret.

#### U5. Align production deployment, documentation, and clean-checkout verification

- **Files:** Dedicated Worker deployment workflow, the existing `.github/workflows/deploy.yml` reduced to documentation-only if retained, `.github/workflows/ci.yml`, `README.md`, `wrangler.toml.example`, deployment/config examples, and no changes to `docs/index.html`.
- **Depends on:** U1-U4.
- **Approach:** Build `frontend/dist` in the dedicated Worker deployment job and deploy the tracked Worker with environment-provided Cloudflare credentials/bindings. Production configuration disables the default direct Worker hostname and binds the Worker to an allowlisted Access-protected custom hostname. PR jobs only build, test, and dry-run; production deploys run from a protected environment on the repository’s release trigger or manual approval. Reduce Pages to documentation-only; move any documentation CNAME handling to the documentation artifact rather than depending on `frontend/public/CNAME`; do not copy `frontend/dist` into `site/` as the product deployment. Add prerequisite checks for `LINKS`, `ASSETS`, Access, Flagship, allowed host, and deploy credentials; record the commit, public asset manifest, Worker version, and previous rollback target before deploy. Document local installation/build/dev, the ignored local Wrangler config, required production secrets, the direct-hostname/origin policy, and the exact frontend/backend ownership boundary.
- **Test scenarios:** CI installs both packages with frozen lockfiles, runs the root build and backend tests, and validates the Wrangler configuration without requiring production secrets in pull requests; deployment configuration points only to `frontend/dist`; a clean checkout can reproduce the Worker entrypoint and asset directory; a diff check confirms `docs/index.html` remains unchanged; a non-mutating post-deploy smoke checks root/static/settings/API/redirect/not-found behavior, forged-header behavior on the direct hostname, and logs for asset misses, binding failures, uncaught exceptions, HTML responses from API paths, and secret leakage. Rollback verification restores the matching Worker version and asset manifest before re-running the same smoke matrix.

### System-Wide Impact

- **Runtime:** The Worker becomes the owner of the product UI origin. Existing shortener, redirect, Flagship, OPTIONS, and settings API handlers remain in `src/` and execute before asset delegation.
- **Frontend:** `frontend/src/api.js` and build metadata become same-origin by default. The root shell and settings shell share one compiled asset set; React source and Vite package boundaries remain intact.
- **Security:** `/settings` and `/settings/api/*` are protected before Assets. No public asset request can bypass the Worker authorization decision, and no local mode skips Access checks.
- **Security:** `/settings`, `/settings/`, and future non-API settings paths are protected before Assets. The deployment policy must also prevent direct-hostname header spoofing for protected user-facing routes; same-origin/legacy-origin CORS and CSRF rules are explicit rather than wildcarded.
- **Storage:** `LINKS` KV and Flagship authority are unchanged. The asset build is generated output only and must not become a second source of persisted state.
- **Deployment:** Worker deploy uploads `frontend/dist`; documentation deployment is separate. Production account IDs, Access values, Flagship identifiers, and secrets stay outside tracked files.
- **Performance:** `run_worker_first` prioritizes route correctness and may invoke the Worker for more requests; hashed Vite assets are still served through the Assets collection and can retain edge caching. A later optimization can narrow patterns only after route coverage is proven.
- **Compatibility:** Legacy `frontend.url` support is limited to explicitly configured non-primary error/compatibility paths. The normal UI no longer depends on an external page being reachable.
- **Rollout:** No production switch occurs until the build/entrypoint/config/asset manifest gates pass. Smoke requests are read-only and use a canary hostname or known canary link; they must not mutate KV or Flagship. Keep the prior Worker version and matching asset manifest available for rollback, then repeat the route/content-type matrix after rollback.

### Risks and Dependencies

- **Entrypoint drift:** An ignored local Worker can make local tests pass while CI fails. Mitigation: track `src/worker.js`, point the example Wrangler config to it, import it in focused tests, and verify from a clean checkout.
- **Short-link capture by SPA behavior:** Automatic `index.html` fallback can mask invalid keys. Mitigation: use explicit shell delegation and test unknown keys/API paths before any asset fetch; do not rely on a global SPA fallback for this application.
- **Settings authorization bypass:** Asset-first routing could return the settings shell without Access. Mitigation: Worker-first route configuration and an authorization assertion before every settings shell/API response.
- **Static asset versus slug ambiguity:** A root-level favicon/manifest or future generated file can resemble a short key. Mitigation: make the asset classifier explicit and cover the actual Vite output plus a short-link miss in the same integration suite.
- **Build-path drift:** `frontend/` has its own package and currently uses a different Vite version from the root package. Mitigation: keep the package boundary deliberate, declare/install its dependencies reproducibly, and make CI invoke the same root build path developers use.
- **Duplicate production authorities:** Pages can continue to expose an old copy of the frontend. Mitigation: keep Pages documentation-only or remove its frontend assembly and add a Worker deploy path with a dry-run configuration gate.
- **Legacy hosted error pages:** Removing the external page entirely could change existing not-found/error behavior. Mitigation: retain opt-in legacy fetching where configured and provide a safe Worker-hosted fallback when it is not.
- **Direct-origin header spoofing:** The current access helper has a weaker header-presence path for some shortening/evaluation behavior. Mitigation: block direct Worker hostnames in production or require verified Access claims for all protected user-facing routes; add forged-header tests and a direct-hostname smoke gate.
- **Cross-origin credential confusion:** Retained external-origin mode could accept an unintended origin or wildcard credentials. Mitigation: enforce the origin matrix in KTD5, reject `null`/missing/unknown mutation origins, and test preflight plus credentialed mutation responses.
- **Public-config leakage:** Broad config normalization or source maps could place tokens, local vars, or test values in `frontend/dist`. Mitigation: use an allowlisted public projection, inventory generated assets, and add a sentinel denial test.
- **Provider error leakage:** Raw Flagship exception text could expose tokens or internal URLs through responses/logs. Mitigation: preserve generalized management errors, redact evaluation diagnostics, and assert redaction in provider-failure fixtures.
- **Unsafe variant redirect:** A mock or future provider adapter could return an unvalidated destination. Mitigation: validate the final destination at the redirect boundary and cover unsafe schemes, credentials, malformed URLs, and interstitial escaping.
- **Operational secrets:** Cloudflare and Flagship credentials must not enter Vite metadata, generated HTML, logs, tests, or workflow command output. Mitigation: use Worker/GitHub secret bindings and test configuration shape rather than secret values.

### Verification Contract

- **Build:** The root build produces `frontend/dist/index.html` and all referenced assets; the generated directory is ignored; root development and deployment cannot skip the frontend build.
- **Worker startup:** The canonical tracked entrypoint loads with the example Wrangler configuration and exposes the `ASSETS` binding shape without an ignored local source file.
- **Asset serving:** `/` returns the built React shell; known JS/CSS/static files return their generated content types; `/settings`, `/settings/`, and supported settings deep links return the same shell only after Access authorization; malformed/hidden/missing asset paths do not expose files or silently become the shell.
- **Route precedence:** OPTIONS, `/shorten`, compatibility POST `/` when retained, `/settings/api/*`, Flagship evaluation, valid redirects, invalid keys, and unknown APIs preserve their existing non-HTML response semantics. Assert that API/redirect paths do not call `ASSETS.fetch` and that only shell/static paths do.
- **Security:** Missing, malformed, forged, or direct-hostname Access context cannot fetch `/settings` or mutate settings APIs. CSRF, origin, credential, redirect safety, error redaction, public-config projection, and secret-handling behavior remain enforced. Credentialed responses never use wildcard origins.
- **Local isolation:** Mocks cover Access, Flagship, KV, and Assets success/failure paths; tests do not need a live Cloudflare account or provider credentials.
- **Deployment:** Wrangler dry-run/config validation sees `main = src/worker.js`, the Assets directory `frontend/dist`, the `ASSETS` binding, the existing KV binding, and no `docs/` asset input. CI builds the same artifact before deploy. Production prerequisites, public asset manifest, previous rollback target, post-deploy smoke, and fixed observation-window evidence are recorded.
- **Regression:** Existing Flagship fallback, safe redirects, CORS/preflight, response shapes, and documentation content remain stable. `docs/index.html` has no implementation diff.
- **Parity:** The canonical Worker and example adapter pass the same route matrix for root shell, settings protection, shortening, redirect, unknown path, and provider failure scenarios.

### Definition of Done

- A clean checkout can install dependencies, build React into `frontend/dist`, and start the tracked Worker through the root development workflow.
- Wrangler configuration exposes one `ASSETS` binding rooted at `frontend/dist`; no `docs/` content is uploaded as product frontend assets.
- `/` and authorized `/settings` are served by the Worker-hosted React shell; settings APIs, shortening, Flagship evaluation, redirects, and not-found behavior retain their route precedence and security boundaries.
- Local tests use deterministic Access/Flagship/KV/Assets mocks and include both success and failure paths without a production-auth bypass.
- CI and production deployment use the same build/asset shape; any retained Pages deployment is documentation-only.
- Production has a protected Worker deployment workflow with prerequisite checks, dry-run evidence, non-mutating post-deploy smoke evidence, and a known rollback Worker version plus matching asset manifest.
- `docs/index.html` is unchanged, frontend changes are confined to `frontend/`, backend/runtime changes are confined to `src/`, and supporting configuration/workflow/docs changes are documented.
- The full Verification Contract passes, including a real local Wrangler smoke flow and a Worker configuration dry run.

### Sources / Research

- `src/worker.example.js` — current example handler order, hosted-page fetch, shortening POST, Flagship evaluation, and redirect dispatch.
- `src/lib/flag-routes.js` — settings authorization/API boundary and shortening evaluation entry point that must remain ahead of Assets.
- `src/lib/responses.js` — current hosted-page fallback, CORS, JSON, error, and not-found response semantics.
- `src/lib/endpoints.js` — current `frontend.url`-derived page endpoints and the compatibility surface for legacy hosted errors.
- `frontend/src/api.js` — existing same-origin defaults, credentials, CSRF header, and settings/shortening path configuration.
- `frontend/index.html` and `frontend/vite.config.js` — React entrypoint, current metadata defaults, and Vite asset base behavior.
- `package.json` and `frontend/package.json` — current separate root/frontend package boundaries, Node/pnpm requirements, and available Wrangler/Vite scripts.
- `wrangler.toml.example` and `.gitignore` — current missing Assets configuration, missing tracked Worker entrypoint, and ignored local runtime files.
- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` — current separate frontend build, Pages assembly, and the deployment split to reconcile.
- [Cloudflare Workers Static Assets configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) — authoritative `assets.directory`, `binding`, `run_worker_first`, and `not_found_handling` configuration shape.
- [Cloudflare Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/) — authoritative `env.ASSETS.fetch()` runtime boundary and Worker-first behavior.
- [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) — explains why automatic SPA fallback must be constrained for an application where arbitrary paths are short-link candidates.
- [Cloudflare Worker script routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) — documents Worker-first routing tradeoffs and selective routing options.
- [Vite build guide](https://vite.dev/guide/build.html) — frontend build-output contract used by the root build workflow.
