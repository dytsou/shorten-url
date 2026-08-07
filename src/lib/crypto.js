export function randomString(worker, len = worker.min_random_key_length) {
  const chars = worker.random_chars;
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(bytes[i] % chars.length);
  }
  return result;
}

export async function sha512(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
