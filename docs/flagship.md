# Flagship shortening controls

The two maintained Worker entrypoints use the first-party Cloudflare Flagship
binding when it is provisioned as `env.FLAGS`. The binding is intentionally
behind a typed adapter in `src/lib/flagship.js`: if the binding is absent, its
response is malformed, or evaluation reports an error, requests use the
existing shortening page and redirect behavior.

## Provisioning

1. Create a Flagship app and replace the placeholder in the `[[flagship]]`
   block in `wrangler.toml` (see `wrangler.toml.example`).
2. Create the JSON flag `shorten-routing`. Variations must be objects with a
   single `url` field. Country rules target the `country` attribute and use
   `in` with two-letter country codes. Keep a control variation as the default.
3. Configure the protected settings API secrets/variables:
   `CLOUDFLARE_ACCOUNT_ID`, `FLAGSHIP_APP_ID`, `FLAGSHIP_API_TOKEN`,
   `FLAGSHIP_CSRF_SECRET`, `CF_ACCESS_ISSUER`, and `CF_ACCESS_AUDIENCE`.
   `CF_ACCESS_JWKS_URL` is optional when the standard Access certificate URL
   is available.
4. Deploy behind the same Cloudflare Access application that protects
   `/shorten`. Operators open `/` in the deployed Worker and switch to the Flagship tab; there is
   no standalone settings page route.

When the built `frontend/` app is deployed to GitHub Pages or another static
host, set its `shorten-url-worker-origin` meta tag to the public Worker origin.
The frontend tabs and settings API requests use that origin. Leave the tag
empty when the Worker serves the page so the current origin remains the
fallback. The origin is public and must also match `frontend.workerOrigin` in
the local config example; do not put any Access, Flagship, or CSRF secret in
the HTML or frontend config.

The settings API uses the documented Cloudflare Flagship management API for
listing, creating, updating, and enabling the published flag. The API's
full-replacement update is the atomic publication boundary; there is no
second Worker-owned draft store. API tokens stay server-side. Writes require
a verified Access JWT, JSON requests from the Worker or configured frontend
origin, and an HMAC CSRF token returned by the settings API. A stale
`updated_at` value is rejected with
`409` instead of overwriting another operator's edit.

The installed repository tooling does not provide a `Flagship` TypeScript
declaration or management client package, so the adapter uses the documented
binding method (`getObjectDetails`) and an explicit JSDoc interface. This
keeps local Vitest runs runnable without inventing a second KV-backed flag
authority. Until the official binding is configured, settings management
returns a non-sensitive `503` and visitor traffic falls back safely. Mutations
accept the Worker origin or the configured origin that hosts `frontend/`, and
the Worker returns credential-compatible CORS headers for that frontend.
