import { traceSpan } from "./observability.js";

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
