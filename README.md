# URL Shortener with Authentication

A modern URL shortener service built with Cloudflare Workers, featuring authentication required for URL creation with fingerprint-first authentication and password fallback.

## Features

### Core Features
- ✅ **URL Shortening**: Convert long URLs into short, shareable links
- ✅ **Custom Slugs**: Create personalized short URLs with custom text
- ✅ **Unique Links**: Same URL generates same short link (configurable)
- ✅ **Safe Browsing**: Google Safe Browsing API integration for malicious URL detection
- ✅ **Fast Access**: No authentication required for accessing shortened URLs

### 🔐 Authentication Features
- ✅ **Protected URL Creation**: Authenticate before creating short URLs
- ✅ **Fingerprint-First**: Primary authentication using biometric methods (WebAuthn)
- ✅ **Password Fallback**: Secondary authentication with secure password system
- ✅ **Admin Management**: Dedicated admin endpoint for credential setup
- ✅ **Session Management**: Temporary tokens for authenticated sessions
- ✅ **Rate Limiting**: Protection against brute force attacks

### Technical Features
- ✅ **Serverless Architecture**: Runs on Cloudflare Workers edge network
- ✅ **Fast Performance**: Global CDN with minimal latency
- ✅ **Scalable Storage**: Cloudflare KV for unlimited URL storage
- ✅ **Modern UI**: Responsive design with mobile support and popup authentication
- ✅ **Enhanced UX**: Clean interface with authentication only when needed
- ✅ **CORS Support**: Cross-origin requests enabled

## How Authentication Works

### Authentication for URL Creation
1. **Setup**: Administrator configures fingerprint and/or password credentials via `/admin/setup`
2. **User Access**: Users visit the clean URL shortener interface (no authentication forms visible)
3. **Action Trigger**: Users click "Shorten URL" or "Shorten URL and Visit" buttons
4. **Authentication Popup**: If not authenticated, a popup modal appears requesting authentication
5. **Primary Method**: System attempts fingerprint authentication first
6. **Fallback**: If fingerprint fails, users can authenticate with password within the popup
7. **Session**: Successful authentication creates a temporary session (30 minutes)
8. **Auto-Proceed**: Popup closes automatically and URL shortening continues
9. **Clean Experience**: Main interface remains uncluttered, authentication only when needed
10. **No Auth for Access**: Shortened URLs can be accessed by anyone without authentication

### Authentication Flow
```
User visits site → Clicks "Shorten URL" → Authentication popup → Fingerprint (primary) → Password (fallback) → Session created → Popup closes → URL shortening proceeds
```

### Popup Authentication UI
- **Clean Interface**: Main page shows only URL shortening form
- **On-Demand Authentication**: Popup appears when authentication is needed
- **Smooth Animations**: Fade-in/fade-out transitions with backdrop
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Accessibility**: Keyboard navigation, escape key support, focus management
- **Auto-Close**: Popup closes automatically after successful authentication
- **Session Persistence**: Remembers authentication for 30 minutes

### Admin Setup
- Access `/admin/setup` endpoint
- Configure fingerprint credentials using WebAuthn
- Set optional password fallback
- Secure credential storage in KV database

## Quick Start

### 1. Deploy to Cloudflare Workers

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/shorten-url.git
   cd shorten-url
   ```

2. **Configure the worker**
   - Copy `config.example.js` to `config.js`
   - Update the configuration values:
   ```javascript
   const config = {
     frontend: {
       url: "https://yourusername.github.io/your-repo-name/"
     },
     auth: {
       enabled: true,
       require_auth_to_create: true,
       fingerprint_primary: true,
       password_fallback: true,
       admin_key: "your-secure-admin-key-here"
     }
   };
   ```

3. **Deploy with Wrangler**
   ```bash
   npm install -g @cloudflare/wrangler
   wrangler login
   wrangler publish
   ```

4. **Set up KV Storage**
   ```bash
   wrangler kv:namespace create "LINKS"
   wrangler kv:namespace create "LINKS" --preview
   ```

### 2. Configure GitHub Pages

1. Enable GitHub Pages in your repository settings
2. Set the source to the main branch
3. Your frontend will be available at `https://yourusername.github.io/your-repo-name/`

### 3. Admin Setup

1. Visit `https://your-worker-domain.workers.dev/admin/setup`
2. Enter your admin key (configured in `config.js`)
3. Set up fingerprint authentication using your device's biometric features
4. Optionally configure a password fallback
5. Save the configuration

## Configuration

### Authentication Settings

```javascript
auth: {
  enabled: true,                      // Enable authentication system
  require_auth_to_create: true,       // Require auth to create URLs
  fingerprint_primary: true,          // Use fingerprint as primary method
  password_fallback: true,            // Allow password fallback
  rate_limit_attempts: 5,            // Max auth attempts per window
  rate_limit_window: 300000,         // Rate limit window (5 minutes)
  session_timeout: 1800000,          // Session timeout (30 minutes)
  pbkdf2_iterations: 100000,         // Password hashing iterations
  salt_length: 32,                   // Salt length for password hashing
  admin_key: "change-this-key"       // Admin key for setup (CHANGE THIS!)
}
```

### Security Settings

```javascript
security: {
  rate_limit: 10,                    // Requests per minute per IP
  validate_urls: true,               // Enable URL validation
  block_suspicious_domains: true,    // Block suspicious domains
  blocked_domains: [                 // List of blocked domains
    "malicious-site.com"
  ]
}
```

## API Reference

### Authentication Endpoints

#### Admin Setup
**Endpoint**: `GET /admin/setup`
- Returns admin setup page for configuring credentials

**Endpoint**: `POST /admin/setup`
```json
{
  "admin_key": "your-admin-key",
  "password": "optional-password",
  "fingerprint": {
    "credentialId": "...",
    "publicKey": "..."
  }
}
```

#### User Authentication
**Endpoint**: `POST /auth`

For fingerprint authentication:
```json
{
  "type": "fingerprint",
  "credential": {
    "id": "credential-id",
    "response": "webauthn-response"
  }
}
```

For password authentication:
```json
{
  "type": "password",
  "password": "user-password"
}
```

**Response**:
```json
{
  "success": true,
  "sessionToken": "session-token",
  "message": "Authentication successful"
}
```

### URL Creation

**Endpoint**: `POST /`

**Request Body**:
```json
{
  "url": "https://example.com/very-long-url",
  "sessionToken": "required-session-token",
  "custom_slug": "my-link"  // Optional
}
```

**Response**:
```json
{
  "status": 200,
  "key": "/abc123"
}
```

### URL Access

**Endpoint**: `GET /{slug}`
- No authentication required
- Direct redirect to original URL

## Data Model

### Credentials Storage
```json
{
  "fingerprint": {
    "credentialId": "webauthn-credential-id",
    "publicKey": "webauthn-public-key"
  },
  "password": {
    "hash": "pbkdf2-hashed-password",
    "salt": "random-salt-string"
  },
  "created": "2023-12-01T12:00:00Z"
}
```

### Session Storage
```json
{
  "expires": 1701436800000,
  "created": 1701435000000
}
```

### URL Storage
- **Key**: Short slug (e.g., "abc123")
- **Value**: Original URL (e.g., "https://example.com")

## Security Features

### Authentication Security
- **PBKDF2 Hashing**: 100,000 iterations with SHA-256
- **Salt Generation**: Secure random 32-byte salt per password
- **Rate Limiting**: 5 attempts per 5-minute window
- **Session Management**: Temporary tokens with 30-minute expiration
- **WebAuthn Standard**: Industry-standard biometric authentication

### General Security
- **HTTPS Only**: All authentication requires secure connections
- **CORS Protection**: Configurable cross-origin policies
- **Input Validation**: Comprehensive validation of all inputs
- **Safe Browsing**: Google Safe Browsing API integration
- **Admin Key Protection**: Secure admin endpoint access

## Browser Support

### Authentication Features
- **Password Protection**: All modern browsers
- **Fingerprint Authentication**: Requires WebAuthn support
  - Chrome 67+
  - Firefox 60+
  - Safari 14+
  - Edge 79+

### Supported Biometric Methods
- Fingerprint scanners
- Face ID / Windows Hello
- Hardware security keys
- Platform authenticators

## Usage Workflow

1. **First-time Setup**:
   - Admin visits `/admin/setup`
   - Configures fingerprint and/or password credentials
   - Credentials stored securely in KV database

2. **User Creates URLs**:
   - User visits URL shortener interface
   - Authenticates using fingerprint (preferred) or password
   - Creates shortened URLs during authenticated session
   - Session expires after 30 minutes of inactivity

3. **Accessing URLs**:
   - Anyone can access shortened URLs without authentication
   - Direct redirect to original destination
   - Optional safety checking via Google Safe Browsing

## Deployment Checklist

- [ ] Update `config.js` with your settings
- [ ] Change the default admin key to something secure
- [ ] Deploy worker to Cloudflare Workers
- [ ] Configure GitHub Pages or custom domain
- [ ] Set up KV storage namespace
- [ ] Complete admin setup at `/admin/setup`
- [ ] Test fingerprint authentication
- [ ] Test password fallback authentication
- [ ] Verify URL creation and access flows

## Troubleshooting

### Common Issues

1. **Cannot access admin setup**
   - Verify admin key in configuration
   - Check that worker is deployed correctly
   - Ensure KV namespace is configured

2. **Fingerprint authentication fails**
   - Verify browser WebAuthn support
   - Check that site is served over HTTPS
   - Ensure biometric authentication is set up on device

3. **Password authentication not working**
   - Verify password was set during admin setup
   - Check rate limiting hasn't been triggered
   - Confirm admin credentials were saved properly

4. **URLs not creating**
   - Verify user is authenticated (green status indicator)
   - Check session hasn't expired (30-minute timeout)
   - Confirm worker has KV write permissions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new features
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Based on [Url-Shorten-Worker](https://github.com/xyTom/Url-Shorten-Worker) by xyTom
- Uses Cloudflare Workers platform
- WebAuthn implementation follows W3C standards