import { describe, it, expect } from "vitest";
import { URL_PATTERN, SLUG_PATTERN } from "../src/lib/constants.js";
import { randomString } from "../src/lib/crypto.js";
import { isValidUrl, isValidCustomSlug } from "../src/lib/validate.js";

const workerConfig = {
  min_random_key_length: 6,
  max_custom_slug_length: 50,
  random_chars: "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678",
  reserved_slugs: ["api", "admin", "www", "mail", "ftp", "localhost", "password"],
};

const allowedChars = new Set(workerConfig.random_chars);

describe("URL Validation", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "https://www.example.com/path",
    "https://example.com/path?query=value",
  ])("accepts valid URL %s", (url) => {
    expect(isValidUrl(url)).toBe(true);
    expect(URL_PATTERN.test(url)).toBe(true);
  });

  it.each(["not-a-url", "ftp://example.com", "example.com", ""])(
    "rejects invalid URL %s",
    (url) => {
      expect(isValidUrl(url)).toBe(false);
    }
  );
});

describe("Custom Slug Validation", () => {
  it.each(["my-link", "my_link", "myLink123", "a", "a".repeat(50)])(
    "accepts valid slug %s",
    (slug) => {
      expect(isValidCustomSlug(slug, workerConfig)).toBe(true);
      expect(SLUG_PATTERN.test(slug)).toBe(true);
    }
  );

  it.each(["my link", "my@link", "my.link", "", "a".repeat(51), "api", "ADMIN"])(
    "rejects invalid slug %s",
    (slug) => {
      expect(isValidCustomSlug(slug, workerConfig)).toBe(false);
    }
  );
});

describe("Random String Generation", () => {
  it.each([6, 8, 10, 20])("generates strings of length %i", (len) => {
    const result = randomString(workerConfig, len);
    expect(result).toHaveLength(len);
    expect([...result].every((char) => allowedChars.has(char))).toBe(true);
  });

  it.each(["o", "O", "L", "l", "0", "1", "9", "g", "q", "V", "v", "U", "u", "I"])(
    "excludes confusing character %s",
    (char) => {
      expect(allowedChars.has(char)).toBe(false);
    }
  );
});
