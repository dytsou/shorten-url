/**
 * URL Shortener Configuration Example
 * 
 * Copy this file to config.js and modify the values according to your setup.
 * This file should be committed to your repository as a template.
 * The actual config.js file should be added to .gitignore to keep your secrets safe.
 */

const config = {
  // Frontend Configuration
  frontend: {
    // URL where your frontend is hosted (used by worker to serve the main page)
    // REQUIRED: Change this to your GitHub Pages URL or custom domain
    url: "https://yourusername.github.io/your-repo-name/",

    // Domain displayed in the custom slug input prefix
    // If null, will use the current domain automatically
    // Example: "short.ly" or "yourdomain.com"
    displayDomain: null,

    // Default theme for the frontend
    theme: "", // Use empty string for default theme, or "theme/urlcool" for urlcool theme
  },

  // Worker Configuration
  worker: {
    // Control the HTTP referrer header
    // Set to "on" to create anonymous links that hide the HTTP Referer header
    no_ref: "off",

    // Allow Cross-origin resource sharing for API requests
    cors: "on",

    // If true, the same long URL will be shortened into the same short URL
    unique_link: true,

    // Allow users to customize the short URL
    custom_link: true,

    // Google Safe Browsing API Key for URL safety check before redirect
    // Get your API key from: https://developers.google.com/safe-browsing/v4/get-started
    // Leave empty to disable safety checking
    safe_browsing_api_key: "",

    // Maximum length for custom slugs
    max_custom_slug_length: 50,

    // Minimum length for generated random keys
    min_random_key_length: 6,

    // Characters used for random key generation (removed confusing characters)
    random_chars: 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678',

    // Reserved slugs that cannot be used as custom URLs
    reserved_slugs: ['api', 'admin', 'www', 'mail', 'ftp', 'localhost', 'password', 'help', 'support', 'contact', 'about']
  },

  // KV Storage Configuration (Cloudflare Workers)
  storage: {
    // KV namespace binding name (must match wrangler.toml)
    binding_name: "LINKS"
  },

  // Security Configuration
  security: {
    // Rate limiting (requests per minute per IP)
    rate_limit: 10,

    // Enable URL validation
    validate_urls: true,

    // Block suspicious domains
    block_suspicious_domains: true,

    // List of blocked domains (exact matches)
    // Add domains you want to block from being shortened
    blocked_domains: [
      // "bit.ly",
      // "tinyurl.com", 
      // "t.co"
    ]
  },

  // Analytics Configuration (optional)
  analytics: {
    // Enable click tracking
    enable_tracking: false,

    // Google Analytics tracking ID (GA4)
    // Example: "G-XXXXXXXXXX"
    ga_tracking_id: "",

    // Custom analytics endpoint for tracking clicks
    analytics_endpoint: ""
  }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = config;
}

// Make available globally for browser usage
if (typeof window !== 'undefined') {
  window.APP_CONFIG = config;
}