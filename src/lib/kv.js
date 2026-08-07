import { randomString } from "./crypto.js";
import { sha512 } from "./crypto.js";
import { logError, traceSpan } from "./observability.js";

export function createKvStore({ worker, kv }) {
  async function saveUrl(url, customSlug = null) {
    return traceSpan("kv.save", async (span) => {
      if (span.isTraced) span.setAttribute("kv.custom_slug", Boolean(customSlug));
      try {
        const key = customSlug || randomString(worker);
        const existing = await kv.get(key);

        if (existing === null) {
          await kv.put(key, url);
          return [undefined, key];
        }
        if (customSlug) {
          return ["CUSTOM_SLUG_EXISTS", null];
        }
        return saveUrl(url);
      } catch (error) {
        logError("kv.save_failed", error);
        return ["KV_ERROR", null];
      }
    });
  }

  async function findUrlKeyByHash(urlHash) {
    return (await kv.get(urlHash)) || null;
  }

  async function resolveShortKey(longUrl, customSlug) {
    return traceSpan("kv.resolve", async (span) => {
      if (span.isTraced) span.setAttribute("kv.unique_link", worker.unique_link);
      if (worker.unique_link && !customSlug) {
        const urlHash = await sha512(longUrl);
        const existingKey = await findUrlKeyByHash(urlHash);
        if (existingKey) {
          return [undefined, existingKey];
        }
        const [errorCode, key] = await saveUrl(longUrl);
        if (errorCode === undefined) await kv.put(urlHash, key);
        return [errorCode, key];
      }
      return saveUrl(longUrl, customSlug);
    });
  }

  return { saveUrl, findUrlKeyByHash, resolveShortKey };
}
