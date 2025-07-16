# URL Shortener

A modern, fast URL shortener built with Cloudflare Workers and a responsive web interface. This project allows anyone to create short URLs with optional custom slugs, featuring a clean UI and robust backend with comprehensive API documentation.

## Features

- **URL Shortening**: Convert long URLs into short, shareable links
- **Custom Slugs**: Create personalized short URLs (optional)
- **Open Access**: No authentication required - anyone can create short URLs
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Fast Performance**: Built on Cloudflare Workers for global edge deployment
- **Security Features**: URL validation, rate limiting, and optional Safe Browsing integration
- **Modern Copy Function**: One-click copying with fallbacks for all browsers
- **Custom Error Pages**: Beautiful 404, security warning, and redirect pages (fully customizable via your GitHub Pages)
- **API Documentation**: Interactive Swagger UI with OpenAPI 3.0.3 specification
- **Analytics Ready**: Optional click tracking and analytics integration

## Quick Start

### Prerequisites

- A Cloudflare account with Workers enabled
- GitHub account for hosting the frontend (or any static hosting)
- Basic knowledge of Git and command line

### 1. Clone the Repository

```bash
git clone https://github.com/dytsou/shorten-url.git
cd shorten-url
```

### 2. Setup Configuration

```bash
# Copy the example configuration
cp config/config.example.js config/config.js

# Edit the configuration file
vim config/config.js
```

Update the `config/config.js` file with your settings:

```javascript
const config = {
    frontend: {
        // IMPORTANT: Update this to your GitHub Pages URL or custom domain
        url: "https://yourusername.github.io/shorten-url/",
    },
    // ... other settings
};
```

### 3. Deploy Frontend

#### Option A: GitHub Pages (Recommended)

1. Push your code to GitHub
2. Go to your repository settings
3. Enable GitHub Pages for the main branch
4. Your frontend will be available at `https://yourusername.github.io/shorten-url/`

#### Option B: Custom Domain

1. Upload the `docs/` directory to your web hosting
2. Update the `frontend.url` in `config/config.js` to match your domain

### 4. Setup Cloudflare Workers

#### Install Wrangler CLI

```bash
npm install -g wrangler
```

#### Configure Wrangler

```bash
# Login to Cloudflare
wrangler auth login

# Create a new KV namespace for storing URLs
wrangler kv:namespace create "LINKS"
```

#### Create wrangler.toml

Create a `wrangler.toml` file in your project root:

```toml
name = "url-shortener"
main = "src/worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "LINKS"
id = "your-kv-namespace-id-here"
```

Replace `your-kv-namespace-id-here` with the ID from the KV namespace creation command.

#### Deploy the Worker

```bash
wrangler deploy
```

### 5. Update Configuration

After deploying, update your `config/config.js` with the worker URL:

```javascript
const config = {
    frontend: {
        url: "https://yourusername.github.io/shorten-url/",
    },
    // ... other settings
};
```

## ⚙️ Configuration Options

### Frontend Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `frontend.url` | URL where your frontend is hosted | Required |
| `frontend.displayDomain` | Domain shown in UI (null = auto-detect) | `null` |
| `frontend.theme` | UI theme selection | `""` |

### Worker Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `worker.no_ref` | Hide HTTP referrer header | `"off"` |
| `worker.cors` | Enable CORS for API requests | `"on"` |
| `worker.unique_link` | Same URL = same short link | `true` |
| `worker.custom_link` | Allow custom slugs | `true` |
| `worker.safe_browsing_api_key` | Google Safe Browsing API key | `""` |
| `worker.min_random_key_length` | Minimum length for generated keys | `6` |
| `worker.max_custom_slug_length` | Maximum length for custom slugs | `50` |
| `worker.reserved_slugs` | List of reserved slugs | See config |

### Security Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `security.rate_limit` | Requests per minute per IP | `10` |
| `security.validate_urls` | Enable URL validation | `true` |
| `security.blocked_domains` | List of blocked domains | `[]` |

### Storage Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `storage.binding_name` | KV namespace binding name | `"LINKS"` |

## 🔧 Advanced Setup

### Custom Domain

1. Add a custom domain in Cloudflare Workers dashboard
2. Update your DNS records to point to Cloudflare
3. Update the worker URL in your configuration

### Google Safe Browsing

1. Get an API key from [Google Cloud Console](https://developers.google.com/safe-browsing/v4/get-started)
2. Add the key to your `config.js`:

```javascript
worker: {
    safe_browsing_api_key: "your-api-key-here",
}
```

### Analytics Integration

Configure analytics in your `config.js`:

```javascript
analytics: {
    enable_tracking: true,
    ga_tracking_id: "G-XXXXXXXXXX", // Google Analytics 4
    analytics_endpoint: "https://your-analytics-endpoint.com"
}
```

### Custom Error Pages

The system fetches error and redirect pages from your GitHub Pages repository, so you can fully customize their content and design:

- **404 Page**: <code>https://dytsou.github.io/404.html</code>
- **Security Warning**: <code>https://dytsou.github.io/safe-browsing-warning.html</code>
- **No-Referrer Redirect**: <code>https://dytsou.github.io/no-ref-page.html</code>

You can edit these HTML files in your GitHub Pages repo to change the look, text, or behavior at any time. The worker will always serve the latest version from your site.

All pages feature responsive design with glassmorphism effects matching your main interface.

## 📖 API Documentation

The project includes comprehensive API documentation available at `/api` endpoint with interactive Swagger UI.

### OpenAPI Specification

- **Format**: OpenAPI 3.0.3
- **Location**: [docs/api/openapi.yaml](docs/api/openapi.yaml)
- **Interactive UI**: Available at `/api` endpoint on your deployed worker
- **Offline Access**: [docs/api/index.html](docs/api/index.html) for local viewing

### Shorten URL

**POST** `/`

```json
{
    "url": "https://example.com/very-long-url",
    "custom_slug": "my-link" // optional
}
```

**Response:**

```json
{
    "status": 200,
    "key": "/abc123"
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

Redirects to the original URL or shows appropriate error page.

### Additional Endpoints

- **GET** `/api` - Interactive API documentation (Swagger UI)

## 🛠️ Development

### Local Development

```bash
# Start local development server
wrangler dev

# Test with curl
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### File Structure

```
shorten-url/
├── src/
│   ├── worker.js           # Production Cloudflare Worker
│   ├── worker.dev.js       # Development Cloudflare Worker
│   └── worker.example.js   # Worker template
├── docs/
│   ├── index.html          # Homepage interface
│   └── api/
│       ├── index.html      # Swagger UI for API docs
│       └── openapi.yaml    # OpenAPI 3.0.3 specification
├── config/
│   ├── config.js           # Configuration (not in git)
│   └── config.example.js   # Configuration template
├── .cursor/                # Cursor IDE rules and workflow
├── .github/                # GitHub workflows and templates
├── .gitignore             # Git ignore rules
├── README.md              # This file
└── wrangler.toml          # Wrangler configuration
```

## Security Considerations

- Keep your `config.js` file private (it's in `.gitignore`)
- Use environment variables for sensitive data in production
- Enable rate limiting to prevent abuse
- Consider enabling Google Safe Browsing for malicious URL detection
- Regularly monitor your KV storage usage
- Be aware this is an open system - anyone can create short URLs

## Troubleshooting

### Common Issues

**"Failed to copy" error:**
- The app uses modern clipboard API with fallbacks
- Ensure you're using HTTPS (required for clipboard access)

**Worker deployment fails:**
- Check your `wrangler.toml` configuration
- Ensure KV namespace ID is correct
- Verify you're logged into the correct Cloudflare account

**Custom slugs not working:**
- Check that `custom_link` is enabled in config
- Verify slug meets validation requirements (alphanumeric, hyphens, underscores only)
- Ensure slug is not in the reserved slugs list

**Frontend not loading:**
- Update `frontend.url` in your config to match your hosting URL
- Ensure CORS is enabled in worker configuration

**Rate limiting issues:**
- Adjust `security.rate_limit` in your configuration
- Consider implementing IP allowlisting for trusted sources

## License

This project is based on [Url-Shorten-Worker](https://github.com/xyTom/Url-Shorten-Worker) by xyTom, licensed under the MIT License.

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

- [ ] Updated `config.js` with your settings
- [ ] Deployed frontend to GitHub Pages or custom hosting
- [ ] Created Cloudflare KV namespace
- [ ] Configured `wrangler.toml` with correct KV namespace ID
- [ ] Deployed worker using `wrangler deploy`
- [ ] Tested URL shortening functionality
- [ ] Verified copy-to-clipboard feature works
- [ ] Tested custom error pages (404, security warnings)
- [ ] (Optional) Configured custom domain
- [ ] (Optional) Added Google Safe Browsing API key
