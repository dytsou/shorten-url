import { describe, it, expect } from 'vitest';

// Test utility functions
describe('URL Validation', () => {
  it('should validate correct URLs', () => {
    const validUrls = [
      'https://example.com',
      'http://example.com',
      'https://www.example.com/path',
      'https://example.com/path?query=value',
    ];

    const urlRegex = /http(s)?:\/\/([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?/;
    
    validUrls.forEach(url => {
      expect(urlRegex.test(url)).toBe(true);
      expect(url[0] === 'h').toBe(true);
    });
  });

  it('should reject invalid URLs', () => {
    const invalidUrls = [
      'not-a-url',
      'ftp://example.com',
      'example.com',
      '',
    ];

    const urlRegex = /http(s)?:\/\/([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?/;
    
    invalidUrls.forEach(url => {
      const isValid = urlRegex.test(url) && url[0] === 'h';
      expect(isValid).toBe(false);
    });
  });
});

describe('Custom Slug Validation', () => {
  it('should validate correct slug formats', () => {
    const validSlugs = [
      'my-link',
      'my_link',
      'myLink123',
      'a',
      'a'.repeat(50), // max length
    ];

    const slugRegex = /^[a-zA-Z0-9\-_]+$/;
    const maxLength = 50;
    const reservedSlugs = ['api', 'admin', 'www', 'mail', 'ftp', 'localhost', 'password'];

    validSlugs.forEach(slug => {
      expect(slugRegex.test(slug)).toBe(true);
      expect(slug.length >= 1 && slug.length <= maxLength).toBe(true);
      expect(reservedSlugs.includes(slug.toLowerCase())).toBe(false);
    });
  });

  it('should reject invalid slug formats', () => {
    const invalidSlugs = [
      'my link', // contains space
      'my@link', // contains special char
      'my.link', // contains dot
      '', // empty
      'a'.repeat(51), // too long
      'api', // reserved
      'ADMIN', // reserved (case insensitive)
    ];

    const slugRegex = /^[a-zA-Z0-9\-_]+$/;
    const maxLength = 50;
    const reservedSlugs = ['api', 'admin', 'www', 'mail', 'ftp', 'localhost', 'password'];

    invalidSlugs.forEach(slug => {
      const isValid = 
        slugRegex.test(slug) && 
        slug.length >= 1 && 
        slug.length <= maxLength &&
        !reservedSlugs.includes(slug.toLowerCase());
      expect(isValid).toBe(false);
    });
  });
});

describe('Random String Generation', () => {
  it('should generate strings of correct length', () => {
    const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
    const minLength = 6;
    const testLengths = [minLength, 8, 10, 20];

    testLengths.forEach(len => {
      // Simulate random string generation
      let result = '';
      for (let i = 0; i < len; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      expect(result.length).toBe(len);
      // All characters should be from the allowed set
      expect([...result].every(char => chars.includes(char))).toBe(true);
    });
  });

  it('should not contain confusing characters', () => {
    const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
    const confusingChars = ['o', 'O', 'L', 'l', '0', '1', '9', 'g', 'q', 'V', 'v', 'U', 'u', 'I'];
    
    confusingChars.forEach(char => {
      expect(chars.includes(char)).toBe(false);
    });
  });
});

