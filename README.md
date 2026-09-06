# URL Shortener

A URL shortener built with Cloudflare Workers, Cloudflare KV, and a responsive React interface. The Worker serves the product UI and redirects, while `docs/` contains the documentation and OpenAPI reference.

[![Built with Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://cloudflare.com)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dytsou/shorten-url)

## Features

- **URL Shortening**: Create short links stored in Cloudflare KV and redirect with HTTP 302
- **Custom Slugs**: Optionally choose a slug using letters, numbers, hyphens, or underscores
- **Cloudflare Access**: The Worker checks for Cloudflare Access JWT and email headers before creating links
- **Responsive Design**: Worker-hosted React interface supports desktop and mobile screens
- **Flagship Controls**: Shorten and protected Flagship views share one interface
- **Unique Links**: Optionally reuse the same short key when the destination URL already exists
- **URL Safety**: Validate submitted URLs and optionally check redirect destinations with Google Safe Browsing
- **Copy Support**: Copy shortened URLs with a manual-selection fallback
- **Hosted Error Pages**: Configure external 404, error, Safe Browsing warning, and no-referrer pages
- **API Documentation**: Static Swagger UI with an OpenAPI 3.1 specification
- **Worker Observability**: Structured logs and traces are supported

The Worker does not implement click analytics, per-IP rate limiting, or blocked-domain lists. The similarly named settings in `config/config.js` are not used by the current Worker.

## Quick Start

### Worker-hosted React frontend

The product UI is React source in `frontend/`, compiled to `frontend/dist`, and served by the Worker through its `ASSETS` binding. Worker routing and APIs remain in `src/`; the separate Cloudflare Pages site publishes documentation from `docs/`. `docs/index.html` is not a product asset.

For a clean local setup, install both declared packages and use the root commands:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir frontend install --frozen-lockfile --ignore-scripts
cp wrangler.toml.example wrangler.toml
# Set a real LINKS namespace and production-only Access values in wrangler.toml or secrets.
pnpm build
pnpm dev
```

`pnpm dev`, `pnpm preview`, and `pnpm deploy` build `frontend/dist` before running Wrangler. The default UI makes same-origin requests to `POST /shorten` and `/settings`; `POST /` remains a compatibility endpoint.

Production must use an Access-protected custom hostname, set `workers_dev = false`, and set `ACCESS_ALLOWED_HOSTS` to that hostname. Keep `CLOUDFLARE_API_TOKEN`, `FLAGSHIP_CSRF_SECRET`, and provider credentials in Cloudflare/GitHub secrets, never Vite metadata or tracked configuration. Optional `FRONTEND_URL` and `FRONTEND_PAGES_BASE` retain legacy error/interstitial pages only; they are not used to serve the normal UI.

The Worker deployment workflow reads the non-secret GitHub variables
`LINKS_KV_NAMESPACE_ID` and `ACCESS_ALLOWED_HOSTS`, plus the
`CLOUDFLARE_API_TOKEN` secret, to create its ignored `wrangler.toml` at build
time.

### Prerequisites

- A Cloudflare account with Workers and Pages; the Deploy to Cloudflare button provisions the required KV namespace
- A GitHub or GitLab account to receive the repository created by the Deploy to Cloudflare button
- A Cloudflare Pages project to publish `docs/`
- Node.js 24 or newer and pnpm 10.22.0 for manual deployment

### 1. Deploy with Cloudflare (Recommended)

1. Click the **Deploy to Cloudflare** button near the top of this README.
2. Connect your Cloudflare and GitHub or GitLab accounts, then choose the destination repository and Worker name.
3. Confirm the `LINKS` KV binding. Cloudflare provisions the namespace and deploys the Worker from the `main` branch.

The button deploys the Worker; it does not publish `docs/`. Connect the created repository to Cloudflare Pages, leave the build command blank, and set the output directory to `docs`. The React product UI is built into `frontend/dist` and served by the Worker through `ASSETS`; use the Worker deployment workflow or `pnpm deploy` to build and deploy those assets.

### 2. Alternative: Manual Worker Deployment

Clone the repository and install the pinned Wrangler version:

```bash
git clone https://github.com/dytsou/shorten-url.git
cd shorten-url
corepack enable
pnpm install
```

The Worker serves the product UI from `ASSETS`. To deploy manually, install both packages, create the local Wrangler file from the tracked example, set the `LINKS` namespace ID and Access hostname, then build and deploy:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir frontend install --frozen-lockfile --ignore-scripts
cp wrangler.toml.example wrangler.toml
# Set the LINKS namespace ID and ACCESS_ALLOWED_HOSTS.
pnpm build
pnpm exec wrangler login
pnpm deploy
```

The `LINKS` binding in `wrangler.toml` omits an account-specific namespace ID so Wrangler can provision it. To use an existing KV namespace, create it with `pnpm exec wrangler kv namespace create LINKS` and set its ID in `wrangler.toml` before deploying.

### 3. Deploy Documentation to Cloudflare Pages

The `docs/` directory contains the API reference and documentation. To create a Pages site, connect your repository, set the production branch to the branch containing your documentation, leave the build command blank, and use `docs` as the output directory.

This repository's Cloudflare Pages project publishes `docs/` from the `production` branch. The product UI is served by the Worker and does not depend on the Pages site.

For custom error and interstitial pages, set `frontend.pagesBase` to the directory containing those files.

The Worker returns short URLs using the request's origin, so configure its public domain in Cloudflare separately from `frontend.url`.

## ⚙️ Configuration Options

### Frontend Configuration

| Option                | Description                                                                 | Default  |
| --------------------- | --------------------------------------------------------------------------- | -------- |
| `frontend.url`        | Optional origin for legacy error and interstitial pages                    | `""`     |
| `frontend.pagesBase`  | Base URL for hosted error and interstitial pages                            | `url`    |
| `frontend.workerOrigin` | Public Worker origin for a separately hosted frontend                      | `""`     |

The `frontend.displayDomain` and `frontend.theme` values in the configuration are not read by the current static page or Worker.

### Worker Configuration

| Option                          | Description                                                     | Default    |
| ------------------------------- | --------------------------------------------------------------- | ---------- |
| `worker.no_ref`                 | Use the hosted no-referrer interstitial before redirecting      | `"off"`    |
| `worker.cors`                   | Add wildcard CORS headers for API responses                     | `"on"`     |
| `worker.unique_link`            | Reuse a key when the same URL has already been shortened        | `true`     |
| `worker.custom_link`            | Allow custom slugs                                              | `true`     |
| `SAFE_BROWSING_API_KEY`         | Optional Google Safe Browsing API key stored as a Worker secret  | Unset      |
| `worker.min_random_key_length`  | Minimum length for generated keys                               | `6`        |
| `worker.random_chars`           | Characters used for generated keys                              | See config |
| `worker.max_custom_slug_length` | Maximum length for custom slugs                                 | `50`       |
| `worker.reserved_slugs`         | Slugs that cannot be used as custom links                       | See config |

### Security Configuration

| Option                                | Description                                                          | Default |
| ------------------------------------- | -------------------------------------------------------------------- | ------- |
| `security.rate_limit`                | Not implemented by the Worker                                        | Unused  |
| `security.validate_urls`             | URLs are always validated; this setting does not toggle validation  | Unused  |
| `security.blocked_domains`           | Domain blocklists are not implemented by the Worker                 | Unused  |
| `security.block_suspicious_domains`  | Domain blocklists are not implemented by the Worker                 | Unused  |

### Storage Configuration

| Option                 | Description                                                          | Default   |
| ---------------------- | -------------------------------------------------------------------- | --------- |
| `storage.binding_name` | Worker reads KV from `env.LINKS`; this config value is not consulted | `"LINKS"` |

## 🔧 Advanced Setup

### Custom Domain

1. Add a custom domain to the Cloudflare Worker and protect it with Cloudflare Access.
2. Add a custom domain to the Cloudflare Pages project for documentation.
3. Set `frontend.url` only when using separately hosted legacy error or interstitial pages.

### Google Safe Browsing

1. Get an API key from [Google Cloud Console](https://developers.google.com/safe-browsing/v4/get-started)
2. Store it as a Worker secret:

```bash
pnpm exec wrangler secret put SAFE_BROWSING_API_KEY
```

The Worker reads this secret at runtime. The key is not stored in `config/config.js`.

### Analytics Integration

Click analytics is not implemented, and the `analytics` object in `config/config.js` is not used by the Worker. Cloudflare Worker logs and traces are enabled in `wrangler.toml`.

### Custom Error Pages

The Worker fetches optional error and interstitial pages from `frontend.pagesBase` (or `frontend.url` when `pagesBase` is not set). Add these files to your static host to customize them:

- **404 Page**: `404.html`
- **Error Page**: `error.html`
- **Security Warning**: `safe-browsing-warning.html`
- **No-Referrer Redirect**: `no-ref-page.html`

These files are not included in this repository. The Worker fetches their current contents from your static host when needed.

## 📖 API Documentation

The API reference is a static Swagger UI published from `docs/api/`; it is not served by the Worker at `/api`.

### OpenAPI Specification

- **Format**: OpenAPI 3.1.0
- **Location**: [docs/api/openapi.yaml](docs/api/openapi.yaml)
- **Interactive UI**: [docs/api/index.html](docs/api/index.html), published at `/api/` under the Pages base URL
- **Offline Access**: [docs/api/index.html](docs/api/index.html) for local viewing

### Shorten URL

**POST** `/`

```json
{
  "url": "https://example.com/very-long-url",
  "custom_slug": "my-link"
}
```

`custom_slug` is optional. The default Worker template requires Cloudflare Access headers before creating a link.

**Response (201 Created):**

```json
{
  "short_url": "https://your-worker-domain.example/abc123"
}
```

**Error Response:**

```json
{
  "status": 400,
  "message": "Invalid URL format"
}
```

### Access Short URL

**GET** `/{key}`

Redirects to the stored destination with HTTP 302. Query parameters from the short URL are appended to the destination.

### Additional Endpoints

- **GET** `/` - Serves the Worker-hosted React interface
- **OPTIONS** - Returns a CORS preflight response

## 🛠️ Development

### Local Development

```bash
# Start local development server (see wrangler.toml for port / host)
pnpm dev

# Local-only example. The handler checks for both headers; Cloudflare Access must
# authenticate production requests before they reach the Worker.
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -H "Cf-Access-Jwt-Assertion: local-test" \
  -H "Cf-Access-Authenticated-User-Email: you@example.com" \
  -d '{"url": "https://example.com"}'
```

The Worker combines built-in defaults with non-secret Wrangler variables; keep credentials in Wrangler secrets. Run `pnpm test` to execute the Worker tests.

### File Structure

```
shorten-url/
├── src/
│   ├── lib/                 # Validation, routes, KV, assets, and observability
│   ├── worker.js            # Production Worker entrypoint
│   └── worker.example.js    # Example Worker entrypoint
├── frontend/               # React product UI and build configuration
├── docs/
│   ├── index.html          # Documentation site homepage
│   └── api/
│       ├── index.html      # Swagger UI for API docs
│       └── openapi.yaml    # OpenAPI 3.1.0 specification
├── config/
│   ├── config.js            # Existing deployment template
│   └── config.example.js    # Configuration example
├── wrangler.toml.example    # Wrangler deployment template
├── .github/                # GitHub workflows and templates
├── .gitignore              # Ignores local-only files
└── README.md               # This file
```

## Security Considerations

- Keep API keys out of version control; store them with Wrangler secrets
- Configure a Cloudflare Access policy in front of the Worker; the handler checks for Access headers but does not verify JWT signatures itself
- The Worker has no built-in per-IP rate limit or blocked-domain list
- Consider enabling Google Safe Browsing for redirect destinations
- Regularly monitor your KV storage usage

## Troubleshooting

### Common Issues

**"Failed to copy" error:**

- The app uses modern clipboard API with fallbacks
- Ensure you're using HTTPS (required for clipboard access)

**Worker deployment fails:**

- Confirm `src/worker.js`, `wrangler.toml.example`, and `frontend/` are present
- Build the frontend so `frontend/dist/index.html` exists
- Ensure the `LINKS` KV namespace ID in `wrangler.toml` is valid
- Ensure KV namespace ID is correct
- Verify you're logged into the correct Cloudflare account

**Custom slugs not working:**

- Check that `custom_link` is enabled in config
- Verify slug meets validation requirements (alphanumeric, hyphens, underscores only)
- Ensure slug is not in the reserved slugs list

**Frontend not loading:**

- Check that the Worker has an `ASSETS` binding and `frontend/dist/index.html` was built
- If shortening returns an invalid-path response, check the frontend POST path (`/shorten` or the compatibility `/` route)
- Enable CORS if the frontend and Worker use different origins

**Rate limiting issues:**

- The Worker does not currently rate-limit requests. Protect shortening with Cloudflare Access or add a rate limiter.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

If you encounter any issues or have questions:

1. Check the [troubleshooting section](#-troubleshooting)
2. Search existing issues on GitHub
3. Create a new issue with detailed information

## Deployment Checklist

- [ ] Set `LINKS_KV_NAMESPACE_ID` and `ACCESS_ALLOWED_HOSTS` for Worker deployment
- [ ] Build the React frontend into `frontend/dist`
- [ ] Deployed `docs/` to Cloudflare Pages
- [ ] Created Cloudflare KV namespace
- [ ] Configured `wrangler.toml` with correct KV namespace ID
- [ ] Protected the Worker with a Cloudflare Access policy
- [ ] Deployed the Worker using `pnpm deploy`
- [ ] Tested URL shortening at `POST /shorten` and the compatibility `POST /` route
- [ ] Verified copy-to-clipboard feature works
- [ ] Tested custom error pages (404, security warnings)
- [ ] (Optional) Configured custom domain
- [ ] (Optional) Added Google Safe Browsing API key
