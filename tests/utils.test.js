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

describe("URL Validation", () => {
  it("should validate correct URLs", () => {
    const validUrls = [
      "https://example.com",
      "http://example.com",
      "https://www.example.com/path",
      "https://example.com/path?query=value",
    ];

    validUrls.forEach((url) => {
      expect(isValidUrl(url)).toBe(true);
      expect(URL_PATTERN.test(url)).toBe(true);
    });
  });

  it("should reject invalid URLs", () => {
    const invalidUrls = ["not-a-url", "ftp://example.com", "example.com", ""];

    invalidUrls.forEach((url) => {
      expect(isValidUrl(url)).toBe(false);
    });
  });
});

describe("Custom Slug Validation", () => {
  it("should validate correct slug formats", () => {
    const validSlugs = ["my-link", "my_link", "myLink123", "a", "a".repeat(50)];

    validSlugs.forEach((slug) => {
      expect(isValidCustomSlug(slug, workerConfig)).toBe(true);
      expect(SLUG_PATTERN.test(slug)).toBe(true);
    });
  });

  it("should reject invalid slug formats", () => {
    const invalidSlugs = ["my link", "my@link", "my.link", "", "a".repeat(51), "api", "ADMIN"];

    invalidSlugs.forEach((slug) => {
      expect(isValidCustomSlug(slug, workerConfig)).toBe(false);
    });
  });
});

describe("Random String Generation", () => {
  it("should generate strings of correct length", () => {
    const testLengths = [6, 8, 10, 20];

    testLengths.forEach((len) => {
      const result = randomString(workerConfig, len);
      expect(result).toHaveLength(len);
      expect([...result].every((char) => workerConfig.random_chars.includes(char))).toBe(true);
    });
  });

  it("should not contain confusing characters", () => {
    const confusingChars = ["o", "O", "L", "l", "0", "1", "9", "g", "q", "V", "v", "U", "u", "I"];

    confusingChars.forEach((char) => {
      expect(workerConfig.random_chars.includes(char)).toBe(false);
    });
  });
});
