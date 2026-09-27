# URL Shortener

A URL shortener built with Cloudflare Workers, Cloudflare KV, and a responsive static web interface. The Worker creates short links, stores them in KV, and serves redirects; the `docs/` directory contains the website and OpenAPI reference.

[![Built with Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://cloudflare.com)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dytsou/shorten-url)

## Features

- **URL Shortening**: Create short links stored in Cloudflare KV and redirect with HTTP 302
- **Custom Slugs**: Optionally choose a slug using letters, numbers, hyphens, or underscores
- **Cloudflare Access**: The Worker checks for Cloudflare Access JWT and email headers before creating links
- **Responsive Design**: Static shortening form supports desktop and mobile screens
- **Unique Links**: Optionally reuse the same short key when the destination URL already exists
- **URL Safety**: Validate submitted URLs and optionally check redirect destinations with Google Safe Browsing
- **Copy Support**: Copy shortened URLs with a manual-selection fallback
- **Hosted Error Pages**: Configure external 404, error, Safe Browsing warning, and no-referrer pages
- **API Documentation**: Static Swagger UI with an OpenAPI 3.1 specification
- **Worker Observability**: Structured logs and traces are supported

The Worker does not implement click analytics, per-IP rate limiting, or blocked-domain lists. The similarly named settings in `config/config.js` are not used by the current Worker.

## Quick Start

### Prerequisites

- A Cloudflare account with Workers enabled; the Deploy to Cloudflare button provisions the required KV namespace
- Node.js 24 or newer and pnpm 10.22.0
- A GitHub account for GitHub Pages (optional; any static host can serve `docs/`)
- Basic knowledge of Git and command line

### 1. Clone the Repository

```bash
git clone https://github.com/dytsou/shorten-url.git
cd shorten-url
```

### 2. Setup Configuration

```bash
# Edit the deployment configuration
vim config/config.js
```

Set `frontend.url` in `config/config.js` to the public static homepage URL:

```javascript
const config = {
  frontend: {
    // Static frontend URL fetched by the Worker for GET /
    url: "https://yourusername.github.io/shorten-url/",
  },
  // Configure worker options here
};
```

`src/worker.js` imports `config/config.js` directly. Keep API keys out of this tracked file; configure the optional Google Safe Browsing key with a Wrangler secret.

### 3. Deploy Frontend

#### Option A: GitHub Pages (Recommended)

1. Push your code to GitHub
2. Set the repository's Pages source to **GitHub Actions**
3. The workflow publishes `docs/` on pushes to the `production` branch
4. Set `frontend.url` to the published homepage URL

The `main` branch serves the sample page from `docs/index.html`; its form submits to `POST /`. Your repository-specific homepage stays on the `production` branch, so the one-click deploy uses the sample rather than your personal page.

The **Deploy to Cloudflare** button imports the default `main` branch. It deploys the Worker; host `docs/` separately and set `frontend.url` to that hosted homepage.

#### Option B: Custom Domain

1. Upload the `docs/` directory to your static host
2. Set `frontend.url` in your Worker configuration to the hosted homepage URL
3. For custom error/interstitial pages, set `frontend.pagesBase` to the directory containing those files

### 4. Setup Cloudflare Workers

#### Install Wrangler CLI

```bash
corepack enable
pnpm install
```

The project uses the Wrangler version installed from `package.json`.

#### Configure Wrangler

```bash
# Login to Cloudflare
pnpm exec wrangler login

# Optional for manual Wrangler deployment; the Deploy button provisions this binding
pnpm exec wrangler kv namespace create LINKS
```

See the [Wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/general/) and [KV command](https://developers.cloudflare.com/workers/wrangler/commands/kv/) references.

#### Create wrangler.toml

`wrangler.toml`, `src/worker.js`, and `config/config.js` are included in this branch. The `LINKS` binding omits an account-specific namespace ID so the Deploy to Cloudflare flow can provision it. For a manual deployment with an existing namespace, set its ID in `wrangler.toml`.

#### Deploy the Worker

```bash
pnpm deploy
```

### 5. Update Configuration

Set `frontend.url` to the static homepage that the Worker should fetch for `GET /`. It should be the hosted page URL, not the Worker URL. The Worker returns short URLs using the request's origin, so configure your Worker domain in Cloudflare separately.

## ⚙️ Configuration Options

### Frontend Configuration

| Option                | Description                                                                 | Default  |
| --------------------- | --------------------------------------------------------------------------- | -------- |
| `frontend.url`        | Static homepage URL fetched by the Worker for `GET /`                      | Required |
| `frontend.pagesBase`  | Base URL for hosted error and interstitial pages                            | `url`    |

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

1. Add a custom domain to the Cloudflare Worker
2. Update your DNS records to point to Cloudflare
3. Set `frontend.url` to the static homepage URL; the Worker domain is configured separately in Cloudflare

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

- **GET** `/` - Fetches the configured static homepage
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

The Worker imports `config/config.js` directly. Run `pnpm test` to execute the Worker tests.

### File Structure

```
shorten-url/
├── src/
│   ├── lib/                 # Validation, redirects, KV, responses, and observability
│   └── worker.js            # Worker entrypoint
├── docs/
│   ├── index.html          # Sample homepage (POST /)
│   └── api/
│       ├── index.html      # Swagger UI for API docs
│       └── openapi.yaml    # OpenAPI 3.1.0 specification
├── config/
│   └── config.js            # Worker configuration
├── wrangler.toml            # Wrangler configuration
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

- Confirm `src/worker.js` and `config/config.js` are present
- Ensure the `LINKS` KV namespace ID in `wrangler.toml` is valid
- Ensure KV namespace ID is correct
- Verify you're logged into the correct Cloudflare account

**Custom slugs not working:**

- Check that `custom_link` is enabled in config
- Verify slug meets validation requirements (alphanumeric, hyphens, underscores only)
- Ensure slug is not in the reserved slugs list

**Frontend not loading:**

- Set `frontend.url` to the hosted static homepage URL
- If the form returns an invalid-path response, check that its POST path matches the Worker route (`/` for the template)
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

- [ ] Set `frontend.url` and the `LINKS` KV namespace in the deployment configuration
- [ ] Deployed frontend to GitHub Pages or custom hosting
- [ ] Created Cloudflare KV namespace
- [ ] Configured `wrangler.toml` with correct KV namespace ID
- [ ] Protected the Worker with a Cloudflare Access policy
- [ ] Deployed the Worker using `pnpm deploy`
- [ ] Tested URL shortening at `POST /`
- [ ] Verified copy-to-clipboard feature works
- [ ] Tested custom error pages (404, security warnings)
- [ ] (Optional) Configured custom domain
- [ ] (Optional) Added Google Safe Browsing API key
