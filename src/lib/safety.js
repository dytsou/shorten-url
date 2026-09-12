import { traceSpan } from "./observability.js";

export function isSafeDestination(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export async function isUrlSafe(url, worker, endpoints) {
  return traceSpan("safe_browsing.check", async () => {
    const body = JSON.stringify({
      client: { clientId: "Url-Shorten-Worker", clientVersion: "1.0.7" },
      threatInfo: {
        threatTypes: [
          "MALWARE",
          "SOCIAL_ENGINEERING",
          "POTENTIALLY_HARMFUL_APPLICATION",
          "UNWANTED_SOFTWARE",
        ],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url }],
      },
    });

    const response = await fetch(`${endpoints.safeBrowsing}?key=${worker.safe_browsing_api_key}`, {
      method: "POST",
      body,
      redirect: "follow",
    });
    const result = await response.json();
    return Object.keys(result).length === 0;
  });
}
