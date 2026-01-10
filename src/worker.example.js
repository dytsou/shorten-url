let config;

try {
  // In a real deployment, you might want to fetch this from KV storage
  // or use environment variables for sensitive data
  if (typeof importConfig !== "undefined") {
    config = { ...defaultConfig, ...importConfig };
  }
} catch (e) {
  console.log("Error importing config");
  throw e;
  exit();
}

let response_header = {
  "content-type": "text/html;charset=UTF-8",
};

if (config.worker.cors == "on") {
  response_header = {
    "content-type": "text/html;charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
  };
}

// Check whether this request has passed Cloudflare Access (Zero Trust / WARP)
function requireAccess(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");

  console.log("Access headers:", {
    jwtPresent: !!jwt,
    email,
  });

  // Defensive check: if Access is misconfigured, block unauthenticated traffic
  if (!jwt || !email) {
    return false;
  }

  // If you want to restrict to specific accounts, you can check email here:
  // const allowed = ["you@nycu.edu.tw", "xxx@example.com"];
  // if (!allowed.includes(email)) return false;

  return true;
}

// Create JSON error response
function createJsonErrorResponse(message, code) {
  return new Response(JSON.stringify({ status: code, message: message }), {
    status: code,
    headers: {
      ...response_header,
      "content-type": "application/json;charset=UTF-8",
    },
  });
}

// Generate random string for short URLs
async function randomString(len) {
  len = len || config.worker.min_random_key_length;
  let $chars = config.worker.random_chars; // Configurable character set
  let maxPos = $chars.length;
  let result = "";
  for (i = 0; i < len; i++) {
    result += $chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return result;
}

// Generate SHA512 hash for URL
async function sha512(url) {
  url = new TextEncoder().encode(url);

  const url_digest = await crypto.subtle.digest(
    {
      name: "SHA-512",
    },
    url // The data you want to hash as an ArrayBuffer
  );
  const hashArray = Array.from(new Uint8Array(url_digest)); // convert buffer to byte array
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

// Validate URL format
async function checkURL(URL) {
  let str = URL;
  let Expression = /http(s)?:\/\/([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?/;
  let objExp = new RegExp(Expression);
  if (objExp.test(str) == true) {
    if (str[0] == "h") return true;
    else return false;
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
  try {
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
      await LINKS.put(random_key, URL);
      return [undefined, random_key];
    } else if (customSlug) {
      // If custom slug already exists, return error
      return ["CUSTOM_SLUG_EXISTS", null];
    } else {
      // If random key exists, try again
      return save_url(URL);
    }
  } catch (error) {
    console.error("Error in save_url:", error);
    return ["KV_ERROR", null];
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
    client: {
      clientId: "Url-Shorten-Worker",
      clientVersion: "1.0.7",
    },
    threatInfo: {
      threatTypes: [
        "MALWARE",
        "SOCIAL_ENGINEERING",
        "POTENTIALLY_HARMFUL_APPLICATION",
        "UNWANTED_SOFTWARE",
      ],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url: url }],
    },
  });

  let requestOptions = {
    method: "POST",
    body: raw,
    redirect: "follow",
  };

  let result = await fetch(
    "https://safebrowsing.googleapis.com/v4/threatMatches:find?key=" +
      config.worker.safe_browsing_api_key,
    requestOptions
  );
  result = await result.json();
  console.log(result);
  if (Object.keys(result).length === 0) {
    return true;
  } else {
    return false;
  }
}

// Handle short URL redirect
async function handleShortUrlRedirect(path, params) {
  if (!path) {
    const html404 = await fetch("https://dytsou.github.io/404.html");
    return new Response(await html404.text(), {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
      status: 404,
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
  const html404 = await fetch("https://dytsou.github.io/404.html");
  return new Response(await html404.text(), {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
    status: 404,
  });
}

// Handle GET requests
async function handleGetRequest(requestURL) {
  const path = requestURL.pathname.split("/")[1];
  const params = requestURL.search;
  console.log(path);
  return await handleShortUrlRedirect(path, params);
}

// Handle POST requests (URL shortening)
async function handlePostRequest(request, requestURL, pathname) {
  // Only allow shortening via the /shorten endpoint
  if (pathname !== "/shorten") {
    return createJsonErrorResponse("Invalid API path", 404);
  }

  // Enforce Cloudflare Access / WARP for this API
  if (!requireAccess(request)) {
    return createJsonErrorResponse("You must use WARP to shorten the URL", 403);
  }

  let req;
  try {
    req = await request.json();
    console.log(req["url"]);
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return createJsonErrorResponse("Invalid JSON format", 400);
  }

  // Validate URL
  if (!req["url"]) {
    return createJsonErrorResponse("URL is required", 400);
  }

  if (!(await checkURL(req["url"]))) {
    return createJsonErrorResponse("Invalid URL format", 400);
  }

  let stat, random_key;
  let customSlug = req["custom_slug"] || null;

  // Validate custom slug if provided
  if (customSlug) {
    if (!config.worker.custom_link) {
      return createJsonErrorResponse("Custom URLs are disabled", 400);
    }

    if (!(await validateCustomSlug(customSlug))) {
      return createJsonErrorResponse("Invalid custom slug format", 400);
    }
  }

  if (config.worker.unique_link && !customSlug) {
    let url_sha512 = await sha512(req["url"]);
    let url_key = await is_url_exist(url_sha512);
    if (url_key) {
      random_key = url_key;
    } else {
      [stat, random_key] = await save_url(req["url"], customSlug);
      if (typeof stat == "undefined") {
        console.log(await LINKS.put(url_sha512, random_key));
      }
    }
  } else {
    [stat, random_key] = await save_url(req["url"], customSlug);
  }

  console.log(stat);

  if (stat === "CUSTOM_SLUG_EXISTS") {
    return createJsonErrorResponse("Custom slug already exists", 400);
  }

  if (stat === "KV_ERROR") {
    return createJsonErrorResponse("Database error occurred", 500);
  }

  if (typeof stat == "undefined") {
    const shortUrl = `${requestURL.origin}/${random_key}`;
    return new Response(JSON.stringify({ short_url: shortUrl }), {
      status: 201,
      headers: {
        ...response_header,
        "content-type": "application/json;charset=UTF-8",
      },
    });
  }

  return createJsonErrorResponse("Error: Reach the KV write limitation", 500);
}

// Main request handler
async function handleRequest(request) {
  console.log(request);

  const requestURL = new URL(request.url);
  const pathname = requestURL.pathname;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: response_header,
    });
  }

  if (request.method === "POST") {
    return await handlePostRequest(request, requestURL, pathname);
  }

  // Handle GET requests (and any other methods)
  return await handleGetRequest(requestURL);
}

addEventListener("fetch", async (event) => {
  event.respondWith(handleRequest(event.request));
});
