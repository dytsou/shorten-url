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

- A Cloudflare account with Workers and Pages; the Deploy to Cloudflare button provisions the required KV namespace
- A GitHub or GitLab account to receive the repository created by the Deploy to Cloudflare button
- A Cloudflare Pages project to publish `docs/`
- Node.js 24 or newer and pnpm 10.22.0 for manual deployment

### 1. Deploy with Cloudflare (Recommended)

1. Click the **Deploy to Cloudflare** button near the top of this README.
2. Connect your Cloudflare and GitHub or GitLab accounts, then choose the destination repository and Worker name.
3. Confirm the `LINKS` KV binding. Cloudflare provisions the namespace and deploys the Worker from the `main` branch.

The button deploys the Worker; it does not publish the static homepage in `docs/`. Connect the created repository to Cloudflare Pages, leave the build command blank, and set the output directory to `docs`. Then set `frontend.url` in `config/config.js` to the Pages URL and push the change to redeploy the Worker. The Worker fetches the static homepage and serves it at `/`, so the form submits to `POST /` on the Worker.

### 2. Alternative: Manual Worker Deployment

Clone the repository and install the pinned Wrangler version:

```bash
git clone https://github.com/dytsou/shorten-url.git
cd shorten-url
corepack enable
pnpm install
```

Set `frontend.url` in `config/config.js` to the public URL where you host `docs/`. The Worker fetches this page for `GET /`:

```javascript
const config = {
  frontend: {
    url: "https://your-project.pages.dev/",
  },
  // Configure worker options here
};
```

`src/worker.js` imports `config/config.js` directly. Keep API keys out of this file; configure the optional Google Safe Browsing key with a Wrangler secret.

Install Wrangler, log in, and deploy:

```bash
pnpm exec wrangler login
pnpm deploy
```

The `LINKS` binding in `wrangler.toml` omits an account-specific namespace ID so Wrangler can provision it. To use an existing KV namespace, create it with `pnpm exec wrangler kv namespace create LINKS` and set its ID in `wrangler.toml` before deploying.

### 3. Deploy the Frontend to Cloudflare Pages

The `main` branch includes a sample page at `docs/index.html`. To create your own Pages site, connect your repository to Cloudflare Pages, set the production branch to the branch containing your homepage, leave the build command blank, and use `docs` as the output directory.

This repository's Cloudflare Pages project publishes `docs/` from the `production` branch. The `main` branch remains the one-click Worker template. Set `frontend.url` to your Pages URL so the Worker can serve the hosted homepage at `/`.

For custom error and interstitial pages, set `frontend.pagesBase` to the directory containing those files.

The Worker returns short URLs using the request's origin, so configure its public domain in Cloudflare separately from `frontend.url`.

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

1. Add a custom domain to the Cloudflare Pages project for the static site.
2. Add a domain to the Cloudflare Worker separately for the shortening API.
3. Set `frontend.url` to the Cloudflare Pages URL; Pages and Worker domains are configured independently.

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
- [ ] Deployed `docs/` to Cloudflare Pages
- [ ] Created Cloudflare KV namespace
- [ ] Configured `wrangler.toml` with correct KV namespace ID
- [ ] Protected the Worker with a Cloudflare Access policy
- [ ] Deployed the Worker using `pnpm deploy`
- [ ] Tested URL shortening at `POST /`
- [ ] Verified copy-to-clipboard feature works
- [ ] Tested custom error pages (404, security warnings)
- [ ] (Optional) Configured custom domain
- [ ] (Optional) Added Google Safe Browsing API key
