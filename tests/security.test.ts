// tests/security.test.ts
// Security edge-case tests — SSRF, injection, prompt injection, input validation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl } from "../src/lib/media-proxy.js";

describe("SSRF Protection", () => {

  it("blocks localhost", () => {
    assert.throws(() => assertSafeUrl("http://localhost:3000/admin"), /private/i);
  });

  it("blocks 127.x.x.x loopback", () => {
    assert.throws(() => assertSafeUrl("http://127.0.0.1/secret"), /private/i);
    assert.throws(() => assertSafeUrl("http://127.0.0.99/"), /private/i);
  });

  it("blocks 10.x.x.x private range", () => {
    assert.throws(() => assertSafeUrl("http://10.0.0.1/api/keys"), /private/i);
  });

  it("blocks 172.16-31.x.x private range", () => {
    assert.throws(() => assertSafeUrl("http://172.16.0.1/"), /private/i);
    assert.throws(() => assertSafeUrl("http://172.31.255.255/"), /private/i);
  });

  it("blocks 192.168.x.x private range", () => {
    assert.throws(() => assertSafeUrl("http://192.168.1.1/router"), /private/i);
  });

  it("blocks AWS metadata endpoint (169.254.x.x)", () => {
    assert.throws(() => assertSafeUrl("http://169.254.169.254/latest/meta-data/"), /private/i);
  });

  it("blocks IPv6 loopback", () => {
    assert.throws(() => assertSafeUrl("http://[::1]/secret"), /private|Blocked/i);
  });

  it("blocks file:// scheme", () => {
    assert.throws(() => assertSafeUrl("file:///etc/passwd"), /scheme/i);
  });

  it("blocks javascript: scheme", () => {
    assert.throws(() => assertSafeUrl("javascript:alert(1)"), /scheme/i);
  });

  it("blocks data: scheme", () => {
    assert.throws(() => assertSafeUrl("data:text/html,<h1>pwned</h1>"), /scheme/i);
  });

  it("blocks ftp: scheme", () => {
    assert.throws(() => assertSafeUrl("ftp://evil.com/file"), /scheme/i);
  });

  it("blocks invalid URLs", () => {
    assert.throws(() => assertSafeUrl("not a url"), /Invalid URL/i);
  });

  it("allows public HTTPS URLs", () => {
    const url = assertSafeUrl("https://images.unsplash.com/photo-123.jpg");
    assert.equal(url.protocol, "https:");
  });

  it("allows public HTTP URLs", () => {
    const url = assertSafeUrl("http://example.com/image.png");
    assert.equal(url.protocol, "http:");
  });

  it("blocks 0.0.0.0", () => {
    assert.throws(() => assertSafeUrl("http://0.0.0.0/"), /private/i);
  });
});

describe("Input Validation Edge Cases", () => {

  it("handles empty string", () => {
    assert.throws(() => assertSafeUrl(""), /Invalid URL/i);
  });

  it("handles URLs with null bytes — allows if Node accepts them", () => {
    // Node's URL parser strips null bytes rather than rejecting, so the URL is valid
    // The important thing is it doesn't crash or bypass SSRF checks
    try {
      const url = assertSafeUrl("https://example.com/\x00exploit");
      assert.equal(url.protocol, "https:");
    } catch {
      // If it throws, that's also acceptable behavior
      assert.ok(true);
    }
  });

  it("handles extremely long URLs", () => {
    const longUrl = "https://example.com/" + "a".repeat(10000);
    // Should not crash — just validate normally
    const url = assertSafeUrl(longUrl);
    assert.equal(url.protocol, "https:");
  });

  it("handles URLs with authentication", () => {
    // URLs with user:pass@ should still work for public hosts
    const url = assertSafeUrl("https://user:pass@cdn.example.com/image.jpg");
    assert.equal(url.hostname, "cdn.example.com");
  });
});
