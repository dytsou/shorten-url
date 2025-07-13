/*
 * URL Shortener Worker
 * 
 * Based on Url-Shorten-Worker by xyTom
 * Original: https://github.com/xyTom/Url-Shorten-Worker
 * Copyright (c) 2020 xyTom
 * Licensed under MIT License
 * 
 * Modified to include custom URL functionality and proper license compliance
 */

// Import configuration - you'll need to include config.js in your worker
// For development, you can copy the config object here
// For production, consider using environment variables or KV storage for sensitive data

let config;

try {
    // In a real deployment, you might want to fetch this from KV storage
    // or use environment variables for sensitive data
    if (typeof importConfig !== 'undefined') {
        config = { ...defaultConfig, ...importConfig };
    }
} catch (e) {
    console.log('Error importing config, using default config');
    // Fallback to default config if import fails
    config = {
        frontend: {
            url: "https://dytsou.github.io/shorten-url/"
        },
        worker: {
            no_ref: "off",
            cors: "on",
            unique_link: true,
            custom_link: true,
            safe_browsing_api_key: "",
            min_random_key_length: 6,
            max_custom_slug_length: 50,
            random_chars: 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678',
            reserved_slugs: ['api', 'admin', 'www', 'mail', 'ftp', 'localhost', 'password', 'auth']
        },
        // Authentication configuration
        auth: {
            enabled: true,
            require_auth_to_create: true, // Require authentication to create URLs
            fingerprint_primary: true, // Use fingerprint as primary auth method
            password_fallback: true, // Allow password fallback if fingerprint fails
            rate_limit_attempts: 5,
            rate_limit_window: 300000, // 5 minutes in milliseconds
            session_timeout: 1800000, // 30 minutes in milliseconds
            pbkdf2_iterations: 100000,
            salt_length: 32,
            admin_key: "admin-secret-key-change-this" // Change this in production
        }
    };
}

// Authentication types
const AUTH_TYPES = {
    NONE: 'none',
    FINGERPRINT: 'fingerprint',
    PASSWORD: 'password'
};

// Rate limiting storage (in-memory for simplicity)
const rateLimitStore = new Map();

const html404 = `<!DOCTYPE html>
<body>
  <h1>404 Not Found.</h1>
  <p>The url you visit is not found.</p>
  <p>Based on <a href="https://github.com/xyTom/Url-Shorten-Worker/" target="_blank">Url-Shorten-Worker</a> by xyTom</p>
  <p>Licensed under MIT License</p>
</body>`

let response_header = {
    "content-type": "text/html;charset=UTF-8",
}

if (config.worker.cors == "on") {
    response_header = {
        "content-type": "text/html;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE",
    }
}

// Generate secure random bytes
async function generateSecureRandom(length) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return array;
}

// Generate random string for short URLs
async function randomString(len) {
    len = len || config.worker.min_random_key_length;
    let $chars = config.worker.random_chars;
    let maxPos = $chars.length;
    let result = '';
    for (i = 0; i < len; i++) {
        result += $chars.charAt(Math.floor(Math.random() * maxPos));
    }
    return result;
}

// Generate SHA512 hash for URL
async function sha512(url) {
    url = new TextEncoder().encode(url)

    const url_digest = await crypto.subtle.digest(
        {
            name: "SHA-512",
        },
        url, // The data you want to hash as an ArrayBuffer
    )
    const hashArray = Array.from(new Uint8Array(url_digest)); // convert buffer to byte array
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex
}

// Generate salt for password hashing
async function generateSalt() {
    const salt = await generateSecureRandom(config.auth.salt_length);
    return Array.from(salt, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Hash password using PBKDF2
async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const saltBuffer = encoder.encode(salt);

    const key = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBuffer,
            iterations: config.auth.pbkdf2_iterations,
            hash: 'SHA-256'
        },
        key,
        256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify password against hash
async function verifyPassword(password, hash, salt) {
    const computedHash = await hashPassword(password, salt);
    return computedHash === hash;
}

// Generate session token
async function generateSessionToken() {
    const tokenBytes = await generateSecureRandom(32);
    return Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Rate limiting check
function checkRateLimit(ip, action) {
    const key = `${ip}:${action}`;
    const now = Date.now();
    const window = config.auth.rate_limit_window;
    const limit = config.auth.rate_limit_attempts;

    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, { count: 1, resetTime: now + window });
        return true;
    }

    const record = rateLimitStore.get(key);

    if (now > record.resetTime) {
        // Reset the window
        rateLimitStore.set(key, { count: 1, resetTime: now + window });
        return true;
    }

    if (record.count >= limit) {
        return false;
    }

    record.count++;
    rateLimitStore.set(key, record);
    return true;
}

// Validate URL format
async function checkURL(URL) {
    let str = URL;
    let Expression = /http(s)?:\/\/([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?/;
    let objExp = new RegExp(Expression);
    if (objExp.test(str) == true) {
        if (str[0] == 'h')
            return true;
        else
            return false;
    } else {
        return false;
    }
}

// Validate custom slug format
async function validateCustomSlug(slug) {
    // Check format - only allow letters, numbers, hyphens, and underscores
    const slugRegex = /^[a-zA-Z0-9\-_]+$/;
    if (!slugRegex.test(slug)) {
        return false;
    }

    // Check length using config
    if (slug.length < 1 || slug.length > config.worker.max_custom_slug_length) {
        return false;
    }

    // Check reserved words from config
    if (config.worker.reserved_slugs.includes(slug.toLowerCase())) {
        return false;
    }

    return true;
}

// Get stored credentials
async function getCredentials() {
    const credData = await LINKS.get('admin:credentials');
    if (!credData) {
        return null;
    }
    try {
        return JSON.parse(credData);
    } catch (e) {
        return null;
    }
}

// Verify session token
async function verifySession(sessionToken) {
    if (!sessionToken) return false;

    const sessionData = await LINKS.get(`session:${sessionToken}`);
    if (!sessionData) return false;

    try {
        const session = JSON.parse(sessionData);
        return session.expires > Date.now();
    } catch (e) {
        return false;
    }
}

// Create session
async function createSession() {
    const sessionToken = await generateSessionToken();
    const sessionData = {
        expires: Date.now() + config.auth.session_timeout,
        created: Date.now()
    };

    await LINKS.put(`session:${sessionToken}`, JSON.stringify(sessionData), {
        expirationTtl: config.auth.session_timeout / 1000
    });

    return sessionToken;
}

// Verify fingerprint credential (simplified for demo)
async function verifyFingerprintCredential(credentialData) {
    // In a real implementation, you would verify the WebAuthn assertion
    // For now, we'll check if the credential ID matches stored credentials
    const credentials = await getCredentials();
    if (!credentials || !credentials.fingerprint) {
        return false;
    }

    // Simplified verification - in production use proper WebAuthn verification
    return credentialData && credentialData.id === credentials.fingerprint.credentialId;
}

// Handle admin endpoint
async function handleAdminRequest(request, path) {
    const pathSegments = path.split('/');

    if (pathSegments[1] === 'setup') {
        // GET /admin/setup - Show setup page
        if (request.method === 'GET') {
            return new Response(generateAdminSetupPage(), {
                headers: { "content-type": "text/html;charset=UTF-8" }
            });
        }

        // POST /admin/setup - Store credentials
        if (request.method === 'POST') {
            try {
                const data = await request.json();

                // Verify admin key
                if (data.admin_key !== config.auth.admin_key) {
                    return new Response(JSON.stringify({
                        success: false,
                        message: "Invalid admin key"
                    }), {
                        status: 401,
                        headers: { "content-type": "application/json" }
                    });
                }

                const credentials = {
                    fingerprint: data.fingerprint || null,
                    password: null,
                    created: new Date().toISOString()
                };

                // Hash password if provided
                if (data.password) {
                    const salt = await generateSalt();
                    const hash = await hashPassword(data.password, salt);
                    credentials.password = { hash, salt };
                }

                await LINKS.put('admin:credentials', JSON.stringify(credentials));

                return new Response(JSON.stringify({
                    success: true,
                    message: "Credentials saved successfully"
                }), {
                    headers: { "content-type": "application/json" }
                });

            } catch (e) {
                return new Response(JSON.stringify({
                    success: false,
                    message: "Invalid request data"
                }), {
                    status: 400,
                    headers: { "content-type": "application/json" }
                });
            }
        }
    }

    return new Response(html404, {
        status: 404,
        headers: { "content-type": "text/html;charset=UTF-8" }
    });
}

// Generate admin setup page
function generateAdminSetupPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Setup - URL Shortener</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .setup-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 40px;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
            font-size: 2em;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
        }
        input[type="password"], input[type="text"] {
            width: 100%;
            padding: 15px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 16px;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        .btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(45deg, #667eea, #764ba2);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-bottom: 15px;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        .fingerprint-btn {
            background: linear-gradient(45deg, #28a745, #20c997);
        }
        .help-text {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        .success, .error {
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 20px;
            text-align: center;
        }
        .success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="setup-container">
        <h1>🔧 Admin Setup</h1>
        
        <div id="message" class="hidden"></div>
        
        <form id="setupForm">
            <div class="form-group">
                <label for="adminKey">Admin Key:</label>
                <input type="password" id="adminKey" required>
                <div class="help-text">Enter the admin key from your configuration</div>
            </div>
            
            <div class="form-group">
                <label for="password">Fallback Password:</label>
                <input type="password" id="password">
                <div class="help-text">Optional: Password to use when fingerprint authentication fails</div>
            </div>
            
            <button type="button" class="btn fingerprint-btn" onclick="setupFingerprint()">
                👆 Setup Fingerprint Authentication
            </button>
            
            <button type="submit" class="btn">Save Configuration</button>
        </form>
    </div>

    <script>
        let fingerprintCredential = null;
        
        async function setupFingerprint() {
            try {
                // Create a new credential
                const credential = await navigator.credentials.create({
                    publicKey: {
                        challenge: new Uint8Array(32),
                        rp: {
                            name: "URL Shortener",
                            id: window.location.hostname
                        },
                        user: {
                            id: new TextEncoder().encode("admin"),
                            name: "admin",
                            displayName: "Administrator"
                        },
                        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
                        timeout: 60000,
                        attestation: "direct"
                    }
                });
                
                fingerprintCredential = {
                    credentialId: Array.from(new Uint8Array(credential.rawId), b => b.toString(16).padStart(2, '0')).join(''),
                    publicKey: Array.from(new Uint8Array(credential.response.publicKey || []), b => b.toString(16).padStart(2, '0')).join('')
                };
                
                showMessage("Fingerprint credential created successfully!", "success");
                
            } catch (error) {
                console.error('Fingerprint setup failed:', error);
                showMessage("Fingerprint setup failed. Make sure your device supports biometric authentication.", "error");
            }
        }
        
        document.getElementById('setupForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const adminKey = document.getElementById('adminKey').value;
            const password = document.getElementById('password').value;
            
            if (!adminKey) {
                showMessage("Admin key is required", "error");
                return;
            }
            
            try {
                const response = await fetch('/admin/setup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        admin_key: adminKey,
                        password: password || null,
                        fingerprint: fingerprintCredential
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showMessage(result.message, "success");
                    document.getElementById('setupForm').reset();
                    fingerprintCredential = null;
                } else {
                    showMessage(result.message, "error");
                }
                
            } catch (error) {
                showMessage("Setup failed. Please try again.", "error");
            }
        });
        
        function showMessage(message, type) {
            const messageEl = document.getElementById('message');
            messageEl.textContent = message;
            messageEl.className = type;
            messageEl.classList.remove('hidden');
            
            if (type === 'success') {
                setTimeout(() => {
                    messageEl.classList.add('hidden');
                }, 5000);
            }
        }
    </script>
</body>
</html>`;
}

// Handle authentication before URL creation
async function handleAuthRequest(request) {
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

    // Check rate limiting
    if (!checkRateLimit(clientIP, 'auth')) {
        return new Response(JSON.stringify({
            success: false,
            message: "Too many authentication attempts. Please try again later."
        }), {
            status: 429,
            headers: { "content-type": "application/json" }
        });
    }

    try {
        const data = await request.json();
        const credentials = await getCredentials();

        if (!credentials) {
            return new Response(JSON.stringify({
                success: false,
                message: "Authentication not configured. Please contact administrator."
            }), {
                status: 500,
                headers: { "content-type": "application/json" }
            });
        }

        let authSuccess = false;

        // Try fingerprint authentication first
        if (data.type === 'fingerprint' && data.credential) {
            authSuccess = await verifyFingerprintCredential(data.credential);
        }

        // Fall back to password if fingerprint fails or not provided
        if (!authSuccess && data.type === 'password' && data.password && credentials.password) {
            authSuccess = await verifyPassword(data.password, credentials.password.hash, credentials.password.salt);
        }

        if (authSuccess) {
            const sessionToken = await createSession();
            return new Response(JSON.stringify({
                success: true,
                sessionToken: sessionToken,
                message: "Authentication successful"
            }), {
                headers: { "content-type": "application/json" }
            });
        } else {
            return new Response(JSON.stringify({
                success: false,
                message: "Authentication failed"
            }), {
                status: 401,
                headers: { "content-type": "application/json" }
            });
        }

    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            message: "Invalid request data"
        }), {
            status: 400,
            headers: { "content-type": "application/json" }
        });
    }
}

// Save URL (simplified, no authentication data stored)
async function save_url(URL, customSlug = null) {
    let random_key;

    if (customSlug) {
        random_key = customSlug;
    } else {
        random_key = await randomString();
    }

    let is_exist = await LINKS.get(random_key);
    console.log(is_exist);

    if (is_exist == null) {
        await LINKS.put(random_key, URL);
        return undefined, random_key;
    } else if (customSlug) {
        return "CUSTOM_SLUG_EXISTS", null;
    } else {
        return save_url(URL);
    }
}

// Check if URL exists in database
async function is_url_exist(url_sha512) {
    let is_exist = await LINKS.get(url_sha512);
    console.log(is_exist);
    if (is_exist == null) {
        return false;
    } else {
        return is_exist;
    }
}

// Check URL safety using Google Safe Browsing API
async function is_url_safe(url) {
    let raw = JSON.stringify({
        "client": {
            "clientId": "Url-Shorten-Worker",
            "clientVersion": "1.0.7"
        },
        "threatInfo": {
            "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "POTENTIALLY_HARMFUL_APPLICATION", "UNWANTED_SOFTWARE"],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{ "url": url }]
        }
    });

    let requestOptions = {
        method: 'POST',
        body: raw,
        redirect: 'follow'
    };

    result = await fetch("https://safebrowsing.googleapis.com/v4/threatMatches:find?key=" + config.worker.safe_browsing_api_key, requestOptions);
    result = await result.json();
    console.log(result);
    if (Object.keys(result).length === 0) {
        return true;
    } else {
        return false;
    }
}

// Main request handler
async function handleRequest(request) {
    console.log(request);

    const requestURL = new URL(request.url);
    const pathSegments = requestURL.pathname.split("/").filter(segment => segment);
    const path = pathSegments[0];

    // Handle admin endpoints
    if (path === 'admin') {
        return handleAdminRequest(request, requestURL.pathname.substring(1));
    }

    // Handle authentication endpoint
    if (path === 'auth' && request.method === 'POST') {
        return handleAuthRequest(request);
    }

    if (request.method === "POST") {
        let req = await request.json();
        console.log(req["url"]);

        // Check authentication if required
        if (config.auth.enabled && config.auth.require_auth_to_create) {
            const sessionToken = req["sessionToken"];
            if (!sessionToken || !(await verifySession(sessionToken))) {
                return new Response(`{"status":401,"message":"Authentication required to create URLs"}`, {
                    headers: response_header,
                });
            }
        }

        // Validate URL
        if (!await checkURL(req["url"])) {
            return new Response(`{"status":400,"message":"Invalid URL format"}`, {
                headers: response_header,
            });
        }

        let stat, random_key;
        let customSlug = req["custom_slug"] || null;

        // Validate custom slug if provided
        if (customSlug) {
            if (!config.worker.custom_link) {
                return new Response(`{"status":400,"message":"Custom URLs are disabled"}`, {
                    headers: response_header,
                });
            }

            if (!await validateCustomSlug(customSlug)) {
                return new Response(`{"status":400,"message":"Invalid custom slug format"}`, {
                    headers: response_header,
                });
            }
        }

        if (config.worker.unique_link && !customSlug) {
            let url_sha512 = await sha512(req["url"]);
            let url_key = await is_url_exist(url_sha512);
            if (url_key) {
                random_key = url_key;
            } else {
                stat, random_key = await save_url(req["url"], customSlug);
                if (typeof (stat) == "undefined") {
                    console.log(await LINKS.put(url_sha512, random_key));
                }
            }
        } else {
            stat, random_key = await save_url(req["url"], customSlug);
        }

        console.log(stat);

        if (stat === "CUSTOM_SLUG_EXISTS") {
            return new Response(`{"status":400,"message":"Custom slug already exists"}`, {
                headers: response_header,
            });
        }

        if (typeof (stat) == "undefined") {
            return new Response(`{"status":200,"key":"/${random_key}"}`, {
                headers: response_header,
            });
        } else {
            return new Response(`{"status":500,"message":"Error: Reach the KV write limitation"}`, {
                headers: response_header,
            });
        }
    } else if (request.method === "OPTIONS") {
        return new Response(``, {
            headers: response_header,
        });
    }

    const params = requestURL.search;

    console.log(path);

    if (!path) {
        const html = await fetch(config.frontend.url);

        return new Response(await html.text(), {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
        });
    }

    const value = await LINKS.get(path);
    let location;

    if (params) {
        location = value + params;
    } else {
        location = value;
    }
    console.log(value);

    if (location) {
        if (config.worker.safe_browsing_api_key) {
            if (!(await is_url_safe(location))) {
                let warning_page = await fetch("https://xytom.github.io/Url-Shorten-Worker/safe-browsing.html");
                warning_page = await warning_page.text();
                warning_page = warning_page.replace(/{Replace}/gm, location);
                return new Response(warning_page, {
                    headers: {
                        "content-type": "text/html;charset=UTF-8",
                    },
                });
            }
        }

        if (config.worker.no_ref == "on") {
            let no_ref = await fetch("https://xytom.github.io/Url-Shorten-Worker/no-ref.html");
            no_ref = await no_ref.text();
            no_ref = no_ref.replace(/{Replace}/gm, location);
            return new Response(no_ref, {
                headers: {
                    "content-type": "text/html;charset=UTF-8",
                },
            });
        } else {
            return Response.redirect(location, 302);
        }
    }

    // If request not in kv, return 404
    return new Response(html404, {
        headers: {
            "content-type": "text/html;charset=UTF-8",
        },
        status: 404
    });
}

addEventListener("fetch", async event => {
    event.respondWith(handleRequest(event.request));
});
