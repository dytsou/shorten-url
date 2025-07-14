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
    console.log('Error importing config');
    throw e;
    exit();
}

const html404 = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Page Not Found</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            text-align: center;
        }
        .container {
            max-width: 500px;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        h1 {
            font-size: 4em;
            margin-bottom: 10px;
            opacity: 0.9;
        }
        h2 {
            font-size: 1.5em;
            margin-bottom: 20px;
            opacity: 0.8;
        }
        p {
            font-size: 1.1em;
            line-height: 1.6;
            opacity: 0.7;
            margin-bottom: 30px;
        }
        .home-btn {
            display: inline-block;
            padding: 12px 24px;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            text-decoration: none;
            border-radius: 25px;
            transition: all 0.3s ease;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        .home-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>The short URL you're looking for doesn't exist or may have expired.</p>
        <a href="/" class="home-btn">← Back to Home</a>
    </div>
</body>
</html>`

const safeBrowsingWarning = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Warning</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            text-align: center;
        }
        .container {
            max-width: 600px;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        .warning-icon {
            font-size: 4em;
            margin-bottom: 20px;
        }
        h1 {
            font-size: 2.5em;
            margin-bottom: 20px;
        }
        p {
            font-size: 1.1em;
            line-height: 1.6;
            margin-bottom: 20px;
            opacity: 0.9;
        }
        .url-box {
            background: rgba(0, 0, 0, 0.2);
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            word-break: break-all;
            font-family: monospace;
        }
        .btn-group {
            margin-top: 30px;
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .btn-danger {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        .btn-danger:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
        .btn-safe {
            background: rgba(255, 255, 255, 0.9);
            color: #333;
        }
        .btn-safe:hover {
            background: white;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="warning-icon">⚠️</div>
        <h1>Security Warning</h1>
        <p>This URL has been flagged by Google Safe Browsing as potentially dangerous.</p>
        <div class="url-box">{Replace}</div>
        <p>The destination may contain malware, phishing attempts, or other security threats. Proceed with caution.</p>
        <div class="btn-group">
            <a href="/" class="btn btn-safe">← Go Back Home</a>
            <a href="{Replace}" class="btn btn-danger">Continue Anyway (Risky)</a>
        </div>
    </div>
</body>
</html>`

const noRefPage = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redirecting...</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            text-align: center;
        }
        .container {
            max-width: 500px;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-left: 4px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 30px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h1 {
            font-size: 2em;
            margin-bottom: 20px;
        }
        p {
            font-size: 1.1em;
            line-height: 1.6;
            opacity: 0.8;
            margin-bottom: 20px;
        }
        .url-box {
            background: rgba(0, 0, 0, 0.2);
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            word-break: break-all;
            font-family: monospace;
        }
        .manual-link {
            color: rgba(255, 255, 255, 0.9);
            text-decoration: underline;
        }
    </style>
    <script>
        setTimeout(() => {
            window.location.href = '{Replace}';
        }, 3000);
    </script>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h1>Redirecting...</h1>
        <p>You will be redirected to your destination in 3 seconds.</p>
        <div class="url-box">{Replace}</div>
        <p>If you're not redirected automatically, <a href="{Replace}" class="manual-link">click here</a>.</p>
    </div>
</body>
</html>`

let response_header = {
    "content-type": "text/html;charset=UTF-8",
}

if (config.worker.cors == "on") {
    response_header = {
        "content-type": "text/html;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
    }
}

// Generate random string for short URLs
async function randomString(len) {
    len = len || config.worker.min_random_key_length;
    let $chars = config.worker.random_chars; // Configurable character set
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

// Save URL with random or custom key
async function save_url(URL, customSlug = null) {
    let random_key;

    if (customSlug) {
        // Use custom slug if provided
        random_key = customSlug;
    } else {
        // Generate random key
        random_key = await randomString();
    }

    let is_exist = await LINKS.get(random_key);
    console.log(is_exist);

    if (is_exist == null) {
        return await LINKS.put(random_key, URL), random_key;
    } else if (customSlug) {
        // If custom slug already exists, return error
        return "CUSTOM_SLUG_EXISTS", null;
    } else {
        // If random key exists, try again
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

    if (request.method === "POST") {
        let req = await request.json();
        console.log(req["url"]);

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

    const requestURL = new URL(request.url);
    const path = requestURL.pathname.split("/")[1];
    const params = requestURL.search;

    // Serve homepage only at /home
    if (path === 'home') {
        const html = await fetch(config.frontend.url);
        return new Response(await html.text(), {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
        });
    }

    console.log(path);

    if (!path) {
        return new Response(html404, {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
            status: 404
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
                let warning_page = safeBrowsingWarning.replace(/{Replace}/gm, location);
                return new Response(warning_page, {
                    headers: {
                        "content-type": "text/html;charset=UTF-8",
                    },
                });
            }
        }

        if (config.worker.no_ref == "on") {
            let no_ref = noRefPage.replace(/{Replace}/gm, location);
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
