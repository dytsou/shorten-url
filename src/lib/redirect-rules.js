const PARAMETER_PATTERN = /:([A-Za-z][A-Za-z0-9_]*)/g;
const SAFE_PATH_PARAMETER = "([A-Za-z0-9_-]+)";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateDestination(destination, parameterNames, ruleIndex) {
  if (!destination) {
    throw new Error(`Rule ${ruleIndex + 1} destination must be a URL`);
  }

  const targetParameters = [...destination.matchAll(PARAMETER_PATTERN)].map((match) => match[1]);
  for (const name of targetParameters) {
    if (!parameterNames.has(name)) {
      throw new Error(`Rule ${ruleIndex + 1} destination uses unknown parameter :${name}`);
    }
  }

  const sampleDestination = destination.replace(PARAMETER_PATTERN, "sample");
  let parsed;
  try {
    parsed = new URL(sampleDestination);
  } catch {
    throw new Error(`Rule ${ruleIndex + 1} destination must be an absolute HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Rule ${ruleIndex + 1} destination must be a safe HTTP(S) URL`);
  }
  return targetParameters.includes("suffix");
}

export function parseSpecialRedirectRules(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("SPECIAL_REDIRECT_RULES is required");
  }

  let entries;
  try {
    entries = JSON.parse(value);
  } catch {
    throw new Error("SPECIAL_REDIRECT_RULES must contain valid JSON");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("SPECIAL_REDIRECT_RULES must be a non-empty array of [path, url] pairs");
  }

  const seenPaths = new Set();
  return entries.map((entry, ruleIndex) => {
    if (!Array.isArray(entry) || entry.length !== 2 || entry.some((part) => typeof part !== "string")) {
      throw new Error(`Rule ${ruleIndex + 1} must be a [path, url] pair`);
    }

    const [sourcePath, destination] = entry;
    if (
      !sourcePath.startsWith("/") ||
      sourcePath.startsWith("//") ||
      sourcePath.includes("?") ||
      sourcePath.includes("#")
    ) {
      throw new Error(`Rule ${ruleIndex + 1} path must be an absolute pathname`);
    }

    const normalizedPath = sourcePath === "/" ? "/" : sourcePath.replace(/\/$/, "");
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Rule ${ruleIndex + 1} duplicates path ${normalizedPath}`);
    }
    seenPaths.add(normalizedPath);

    const segments = normalizedPath === "/" ? [] : normalizedPath.slice(1).split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`Rule ${ruleIndex + 1} path contains an invalid segment`);
    }

    const parameterNames = new Set();
    const sourcePattern = segments.map((segment) => {
      if (!segment.startsWith(":")) return escapeRegExp(segment);
      const name = segment.slice(1);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || parameterNames.has(name)) {
        throw new Error(`Rule ${ruleIndex + 1} has an invalid or duplicate path parameter`);
      }
      parameterNames.add(name);
      return SAFE_PATH_PARAMETER;
    });

    const targetUsesSuffix = validateDestination(destination, parameterNames, ruleIndex);
    const pathRegex = new RegExp(`^/${sourcePattern.join("/")}${segments.length ? "/?" : ""}$`);
    const captureNames = segments.filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1));
    return { sourcePath: normalizedPath, pathRegex, captureNames, destination, targetUsesSuffix };
  });
}

export function redirectForSpecialRule(request, rules) {
  const requestUrl = new URL(request.url);
  for (const rule of rules) {
    const match = rule.pathRegex.exec(requestUrl.pathname);
    if (!match) continue;

    const parameters = Object.fromEntries(rule.captureNames.map((name, index) => [name, match[index + 1]]));
    const destination = rule.destination.replace(PARAMETER_PATTERN, (_placeholder, name) => encodeURIComponent(parameters[name]));
    const targetUrl = new URL(destination);

    // A destination URL ending in a slash acts as a base for the conventional :suffix capture.
    if (!rule.targetUsesSuffix && parameters.suffix) {
      targetUrl.pathname = `${targetUrl.pathname.replace(/\/?$/, "/")}${encodeURIComponent(parameters.suffix)}`;
    }

    for (const [name, value] of requestUrl.searchParams) {
      targetUrl.searchParams.append(name, value);
    }
    return Response.redirect(targetUrl, 302);
  }
  return null;
}
