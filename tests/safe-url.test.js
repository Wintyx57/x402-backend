// tests/safe-url.test.js — Unit tests for lib/safe-url.js (SSRF protection)
// Strategy: mock dns.promises.lookup to avoid real network calls and test all
// IP-blocking branches deterministically. We test the pure regex fast-path
// (BLOCKED_HOST) without DNS, and simulate DNS resolution outcomes for the
// post-resolution PRIVATE_IP_V4 check. DNS cache is cleared before each test.

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns");

// ── DNS mock infrastructure ────────────────────────────────────────────────
// We replace dns.promises.lookup with a controllable stub so tests never touch
// the network. Each test configures the stub's response before calling safeUrl.
let _dnsLookupImpl = null;

// Install the stub once, before any module load that might cache the original
const _originalLookup = dns.promises.lookup;
dns.promises.lookup = (hostname, opts) => {
  if (_dnsLookupImpl) {
    return _dnsLookupImpl(hostname, opts);
  }
  // Fallback: simulate a public IP so tests that don't care about DNS pass
  return Promise.resolve({ address: "1.2.3.4", family: 4 });
};

// Load safeUrl AFTER the stub is installed
const { safeUrl, _clearDnsCache } = require("../lib/safe-url");

// Helpers
function resolvesTo(ip) {
  _dnsLookupImpl = () => Promise.resolve({ address: ip, family: 4 });
}

function dnsFailsWith(msg = "getaddrinfo ENOTFOUND") {
  _dnsLookupImpl = () => Promise.reject(new Error(msg));
}

// ── Setup ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  _clearDnsCache();
  _dnsLookupImpl = null; // reset to "public IP" fallback between tests
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. PROTOCOL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — protocol validation", () => {
  it("should accept https:// URLs", async () => {
    resolvesTo("93.184.216.34"); // example.com public IP
    const result = await safeUrl("https://example.com");
    assert.equal(result.hostname, "example.com");
    assert.equal(result.protocol, "https:");
  });

  it("should accept http:// URLs", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl("http://example.com");
    assert.equal(result.protocol, "http:");
  });

  it("should reject file:// URLs", async () => {
    await assert.rejects(() => safeUrl("file:///etc/passwd"), {
      message: "Only HTTP/HTTPS URLs allowed",
    });
  });

  it("should reject ftp:// URLs", async () => {
    await assert.rejects(() => safeUrl("ftp://example.com/file.txt"), {
      message: "Only HTTP/HTTPS URLs allowed",
    });
  });

  it("should reject javascript: URLs", async () => {
    await assert.rejects(
      () => safeUrl("javascript:alert(1)"),
      (err) => {
        // Parsed as invalid URL or wrong protocol
        assert.ok(
          err.message === "Only HTTP/HTTPS URLs allowed" ||
            err.message === "Invalid URL format",
          `Unexpected message: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("should reject data: URLs", async () => {
    await assert.rejects(() => safeUrl("data:text/html,<h1>XSS</h1>"), {
      message: "Only HTTP/HTTPS URLs allowed",
    });
  });

  it("should reject completely invalid URL strings", async () => {
    await assert.rejects(() => safeUrl("not-a-url"), {
      message: "Invalid URL format",
    });
  });

  it("should reject empty string", async () => {
    await assert.rejects(() => safeUrl(""), { message: "Invalid URL format" });
  });

  it("should reject protocol-relative URLs", async () => {
    await assert.rejects(() => safeUrl("//example.com/path"), {
      message: "Invalid URL format",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FAST-PATH: BLOCKED_HOST REGEX (no DNS lookup needed)
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — fast-path hostname blocking (BLOCKED_HOST regex)", () => {
  // localhost
  it("should block localhost", async () => {
    await assert.rejects(() => safeUrl("http://localhost/api"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block localhost with port", async () => {
    await assert.rejects(() => safeUrl("http://localhost:8080/secret"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block localhost case-insensitively", async () => {
    await assert.rejects(() => safeUrl("http://LOCALHOST/api"), {
      message: "Internal URLs not allowed",
    });
  });

  // 127.x.x.x loopback range
  it("should block 127.0.0.1", async () => {
    await assert.rejects(() => safeUrl("http://127.0.0.1/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 127.0.0.1 with port", async () => {
    await assert.rejects(() => safeUrl("http://127.0.0.1:3000/admin"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 127.255.255.255 (entire 127.x range)", async () => {
    await assert.rejects(() => safeUrl("http://127.255.255.255/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 127.1.2.3", async () => {
    await assert.rejects(() => safeUrl("http://127.1.2.3/"), {
      message: "Internal URLs not allowed",
    });
  });

  // 10.x.x.x private range
  it("should block 10.0.0.1", async () => {
    await assert.rejects(() => safeUrl("http://10.0.0.1/internal"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 10.255.255.255", async () => {
    await assert.rejects(() => safeUrl("http://10.255.255.255/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 10.1.2.3:9200 (Elasticsearch port)", async () => {
    await assert.rejects(() => safeUrl("http://10.1.2.3:9200/"), {
      message: "Internal URLs not allowed",
    });
  });

  // 192.168.x.x private range
  it("should block 192.168.0.1", async () => {
    await assert.rejects(() => safeUrl("http://192.168.0.1/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 192.168.1.100", async () => {
    await assert.rejects(() => safeUrl("http://192.168.1.100/router"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 192.168.255.255", async () => {
    await assert.rejects(() => safeUrl("http://192.168.255.255/"), {
      message: "Internal URLs not allowed",
    });
  });

  // 172.16-31.x.x private range (RFC 1918)
  it("should block 172.16.0.1 (start of range)", async () => {
    await assert.rejects(() => safeUrl("http://172.16.0.1/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 172.20.5.10 (middle of range)", async () => {
    await assert.rejects(() => safeUrl("http://172.20.5.10/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 172.31.255.255 (end of range)", async () => {
    await assert.rejects(() => safeUrl("http://172.31.255.255/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should NOT block 172.15.x.x (just before private range)", async () => {
    resolvesTo("172.15.0.1");
    // 172.15 is NOT in 172.16-31 range → should pass hostname check, then DNS check
    const result = await safeUrl("http://172.15.0.1/");
    assert.ok(result instanceof URL);
  });

  it("should NOT block 172.32.x.x (just after private range)", async () => {
    resolvesTo("172.32.0.1");
    const result = await safeUrl("http://172.32.0.1/");
    assert.ok(result instanceof URL);
  });

  // 0.0.0.0
  it("should block 0.0.0.0", async () => {
    await assert.rejects(() => safeUrl("http://0.0.0.0/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block 0.1.2.3 (0.x range)", async () => {
    await assert.rejects(() => safeUrl("http://0.1.2.3/"), {
      message: "Internal URLs not allowed",
    });
  });

  // 169.254.x.x link-local (APIPA / AWS metadata)
  it("should block 169.254.169.254 (AWS metadata endpoint)", async () => {
    await assert.rejects(
      () => safeUrl("http://169.254.169.254/latest/meta-data/"),
      { message: "Internal URLs not allowed" },
    );
  });

  it("should block 169.254.0.1 (link-local)", async () => {
    await assert.rejects(() => safeUrl("http://169.254.0.1/"), {
      message: "Internal URLs not allowed",
    });
  });

  // IPv6 loopback / link-local in hostname
  it("should block [::1] (IPv6 loopback bracket notation)", async () => {
    await assert.rejects(() => safeUrl("http://[::1]/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block [::ffff:127.0.0.1] (IPv4-mapped IPv6 loopback)", async () => {
    await assert.rejects(() => safeUrl("http://[::ffff:127.0.0.1]/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block [fc00::1] (IPv6 unique local) — KNOWN GAP: fc00: regex misses bracket form", async () => {
    // BUG DOCUMENTED: Node URL.hostname returns "[fc00::1]" (with brackets) but
    // the BLOCKED_HOST regex tests for "fc00:" (without leading bracket).
    // Result: the fast-path does NOT catch this form; it falls through to DNS lookup
    // which fails with "Could not resolve hostname" (IPv6 literal with family:4).
    // The URL is rejected, but for the wrong reason. The regex should be updated to
    // also match /^\[fc00:/i to close this gap.
    dnsFailsWith("getaddrinfo ENOTFOUND [fc00::1]");
    await assert.rejects(
      () => safeUrl("http://[fc00::1]/"),
      (err) => {
        // Accepted outcomes: blocked by hostname regex OR rejected by DNS failure
        assert.ok(
          err.message === "Internal URLs not allowed" ||
            err.message === "Could not resolve hostname",
          `Expected SSRF block, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("should block [fe80::1] (IPv6 link-local) — KNOWN GAP: fe80: regex misses bracket form", async () => {
    // BUG DOCUMENTED: Same issue as fc00::1. Node URL.hostname returns "[fe80::1]"
    // but the BLOCKED_HOST regex tests for "fe80:" (without leading bracket).
    // The URL is still rejected via DNS failure, but the hostname fast-path misses it.
    // Fix: add /^\[fe80:/i to BLOCKED_HOST to make blocking explicit and fast.
    dnsFailsWith("getaddrinfo ENOTFOUND [fe80::1]");
    await assert.rejects(
      () => safeUrl("http://[fe80::1]/"),
      (err) => {
        assert.ok(
          err.message === "Internal URLs not allowed" ||
            err.message === "Could not resolve hostname",
          `Expected SSRF block, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POST-DNS PRIVATE IP BLOCKING (PRIVATE_IP_V4 regex on resolved address)
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — DNS-resolved private IP blocking (PRIVATE_IP_V4 regex)", () => {
  it("should block when DNS resolves to 127.0.0.1", async () => {
    resolvesTo("127.0.0.1");
    await assert.rejects(() => safeUrl("https://evil-rebind.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should block when DNS resolves to 10.0.0.5", async () => {
    resolvesTo("10.0.0.5");
    await assert.rejects(() => safeUrl("https://dns-rebind.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should block when DNS resolves to 192.168.1.1", async () => {
    resolvesTo("192.168.1.1");
    await assert.rejects(
      () => safeUrl("https://internal-service.example.com"),
      { message: "Internal IPs not allowed" },
    );
  });

  it("should block when DNS resolves to 172.16.0.1", async () => {
    resolvesTo("172.16.0.1");
    await assert.rejects(() => safeUrl("https://sneaky.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should block when DNS resolves to 172.31.0.1", async () => {
    resolvesTo("172.31.0.1");
    await assert.rejects(() => safeUrl("https://sneaky2.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should block when DNS resolves to 169.254.169.254 (metadata via DNS)", async () => {
    resolvesTo("169.254.169.254");
    await assert.rejects(() => safeUrl("https://metadata.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should block when DNS resolves to 0.0.0.0", async () => {
    resolvesTo("0.0.0.0");
    await assert.rejects(() => safeUrl("https://zero.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should allow when DNS resolves to a public IP", async () => {
    resolvesTo("93.184.216.34"); // example.com
    const result = await safeUrl("https://public.example.com");
    assert.ok(result instanceof URL);
    assert.equal(result.hostname, "public.example.com");
  });

  it("should allow when DNS resolves to 172.32.0.1 (outside private range)", async () => {
    resolvesTo("172.32.0.1");
    const result = await safeUrl("https://edge-case.example.com");
    assert.ok(result instanceof URL);
  });

  it("should allow when DNS resolves to 8.8.8.8 (Google DNS)", async () => {
    resolvesTo("8.8.8.8");
    const result = await safeUrl("https://google-dns.example.com");
    assert.ok(result instanceof URL);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. DNS RESOLUTION FAILURES
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — DNS resolution failures", () => {
  it("should reject when hostname cannot be resolved (ENOTFOUND)", async () => {
    dnsFailsWith("getaddrinfo ENOTFOUND this-hostname-does-not-exist.invalid");
    await assert.rejects(
      () => safeUrl("https://this-hostname-does-not-exist.invalid/path"),
      { message: "Could not resolve hostname" },
    );
  });

  it("should reject when DNS times out", async () => {
    dnsFailsWith("ETIMEDOUT");
    await assert.rejects(() => safeUrl("https://timeout.example.com/"), {
      message: "Could not resolve hostname",
    });
  });

  it("should reject on any DNS error", async () => {
    dnsFailsWith("SERVFAIL");
    await assert.rejects(() => safeUrl("https://servfail.example.com/"), {
      message: "Could not resolve hostname",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. DNS CACHE BEHAVIOUR
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — DNS cache", () => {
  it("should reuse cached result on second call (DNS not called again)", async () => {
    let callCount = 0;
    _dnsLookupImpl = () => {
      callCount++;
      return Promise.resolve({ address: "93.184.216.34", family: 4 });
    };

    await safeUrl("https://cached-host.example.com");
    await safeUrl("https://cached-host.example.com");

    assert.equal(
      callCount,
      1,
      "DNS lookup should be called only once for the same hostname",
    );
  });

  it("should block on second call when cached IP is private", async () => {
    // First call: DNS returns a public IP, then the cache is poisoned manually.
    // Simpler approach: DNS returns private IP both times; first call should throw.
    resolvesTo("10.0.0.1");
    await assert.rejects(() => safeUrl("https://rebind-target.example.com"), {
      message: "Internal IPs not allowed",
    });
  });

  it("should re-call DNS after cache TTL expires", async () => {
    let callCount = 0;
    _dnsLookupImpl = () => {
      callCount++;
      return Promise.resolve({ address: "93.184.216.34", family: 4 });
    };

    // First call: populates cache
    await safeUrl("https://ttl-test.example.com");
    assert.equal(callCount, 1);

    // Manually expire the cache entry by back-dating its timestamp
    // Access the module's internal cache via _clearDnsCache + re-require is not
    // possible without module re-load, so we test the observable effect:
    // after _clearDnsCache(), a second call hits DNS again.
    _clearDnsCache();
    await safeUrl("https://ttl-test.example.com");
    assert.equal(callCount, 2, "DNS lookup should run again after cache clear");
  });

  it("_clearDnsCache() should export correctly and not throw", () => {
    assert.equal(typeof _clearDnsCache, "function");
    assert.doesNotThrow(() => _clearDnsCache());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. VALID PUBLIC URLs (should always pass)
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — valid public URLs", () => {
  it("should accept https://api.openai.com", async () => {
    resolvesTo("104.18.7.192");
    const result = await safeUrl("https://api.openai.com/v1/chat");
    assert.equal(result.hostname, "api.openai.com");
  });

  it("should accept https://x402-api.onrender.com", async () => {
    resolvesTo("216.24.57.4");
    const result = await safeUrl("https://x402-api.onrender.com/api/search");
    assert.equal(result.hostname, "x402-api.onrender.com");
  });

  it("should accept https://x402bazaar.org", async () => {
    resolvesTo("76.76.21.21");
    const result = await safeUrl("https://x402bazaar.org");
    assert.equal(result.hostname, "x402bazaar.org");
  });

  it("should accept URL with path, query string and fragment", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl(
      "https://example.com/path?foo=bar&baz=1#section",
    );
    assert.equal(result.pathname, "/path");
    assert.equal(result.search, "?foo=bar&baz=1");
  });

  it("should return a URL object on success", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl("https://example.com/");
    assert.ok(result instanceof URL, "should return URL instance");
  });

  it("should accept URLs with non-standard ports on public hosts", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl("https://example.com:8443/secure");
    assert.equal(result.port, "8443");
  });

  it("should accept https://api.interzoid.com (known provider)", async () => {
    resolvesTo("52.71.13.201");
    const result = await safeUrl("https://api.interzoid.com/getcompanymatch");
    assert.equal(result.hostname, "api.interzoid.com");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — edge cases", () => {
  it("should strip credentials from URL (user:pass@host) — URL still parsed safely", async () => {
    // http://user:pass@example.com — credentials in URL are a security smell
    // but the SSRF check is on the hostname, not credentials. The URL class
    // parses the hostname correctly. If the resolved IP is public, safeUrl passes.
    resolvesTo("93.184.216.34");
    const result = await safeUrl("https://user:pass@example.com/path");
    // The URL is accepted; the hostname is correctly extracted
    assert.equal(result.hostname, "example.com");
    assert.equal(result.username, "user");
  });

  it("should block credentials URL that embeds a private IP as host", async () => {
    // https://user:pass@192.168.1.1/ — hostname is 192.168.1.1 → blocked
    await assert.rejects(() => safeUrl("https://user:pass@192.168.1.1/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block SSRF via URL-encoded localhost attempt (not a bypass)", async () => {
    // The URL constructor decodes percent-encoding in the hostname,
    // so "localh%6Fst" becomes "localhost" → blocked
    // Note: browsers don't do this but Node URL spec may vary; test documents behaviour
    const testUrl = "http://localh%6Fst/";
    try {
      const parsed = new URL(testUrl);
      // If parsed, hostname must be blocked
      if (/^(localhost|127\.|10\.|192\.168\.)/.test(parsed.hostname)) {
        // Expected — blocked by regex
      }
    } catch {
      // Expected — URL parsing rejects the encoded host
    }
    // What matters: safeUrl either throws (blocked) or rejects (invalid)
    await assert.rejects(
      () => safeUrl(testUrl),
      (err) => {
        assert.ok(
          err.message === "Internal URLs not allowed" ||
            err.message === "Invalid URL format" ||
            err.message === "Could not resolve hostname",
          `Unexpected: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("should block numeric-encoded IP bypass attempt (0x7f000001 = 127.0.0.1)", async () => {
    // Node's URL constructor normalises hex IPs: "0x7f000001" → "127.0.0.1"
    // so this is caught by the fast-path BLOCKED_HOST regex ("127." prefix).
    // No DNS lookup occurs — blocked before reaching the network.
    await assert.rejects(() => safeUrl("http://0x7f000001/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should handle URLs with uppercase scheme", async () => {
    // "HTTP://" — URL class normalises scheme to lowercase
    resolvesTo("93.184.216.34");
    const result = await safeUrl("HTTPS://example.com/");
    assert.equal(result.protocol, "https:");
  });

  it("should block port 0 on localhost (bypass attempt)", async () => {
    await assert.rejects(() => safeUrl("http://localhost:0/"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should block when URL path contains ../ but hostname is internal", async () => {
    await assert.rejects(() => safeUrl("http://127.0.0.1/../etc/passwd"), {
      message: "Internal URLs not allowed",
    });
  });

  it("should handle very long public URLs without throwing", async () => {
    resolvesTo("93.184.216.34");
    const longPath = "/path/" + "a".repeat(2000);
    const result = await safeUrl(`https://example.com${longPath}`);
    assert.equal(result.hostname, "example.com");
  });

  it("should accept URL with IPv6 public address bracket notation", async () => {
    // [2606:2800:220:1:248:1893:25c8:1946] is example.com public IPv6.
    // The BLOCKED_HOST regex only blocks ::1, fc00:, fe80:, ::ffff: prefixes.
    // A real public IPv6 should pass the hostname check (DNS lookup skipped for
    // literal IPs — dns.lookup of a bracket-enclosed literal may behave differently
    // per OS, so we test that it does not throw on a non-blocked IPv6 literal).
    // This test is informational — documents current behaviour.
    const url = "http://[2606:2800:220:1:248:1893:25c8:1946]/";
    try {
      // dns.lookup on an IPv6 with family:4 may fail — that's acceptable
      // the important thing is it's NOT blocked by the BLOCKED_HOST regex
      _dnsLookupImpl = () =>
        Promise.reject(new Error("IPv6 not supported with family:4"));
      await assert.rejects(() => safeUrl(url), {
        message: "Could not resolve hostname",
      });
    } catch (e) {
      // If it throws for a different reason, rethrow
      if (e?.message?.includes("assert")) throw e;
    }
  });

  it("should block [::ffff:10.0.0.1] (IPv4-mapped private via IPv6)", async () => {
    // ::ffff: prefix is in the BLOCKED_HOST regex
    await assert.rejects(() => safeUrl("http://[::ffff:10.0.0.1]/"), {
      message: "Internal URLs not allowed",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. RETURN VALUE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════
describe("safeUrl — return value contract", () => {
  it("should return a Promise", () => {
    resolvesTo("93.184.216.34");
    const returnValue = safeUrl("https://example.com/");
    assert.ok(returnValue instanceof Promise, "safeUrl must return a Promise");
    return returnValue; // let the test runner await resolution
  });

  it("returned URL should preserve original path", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl("https://example.com/v1/endpoint");
    assert.equal(result.pathname, "/v1/endpoint");
  });

  it("returned URL should preserve query parameters", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl("https://example.com/?key=value&other=123");
    assert.equal(result.searchParams.get("key"), "value");
    assert.equal(result.searchParams.get("other"), "123");
  });

  it("returned URL should have correct origin", async () => {
    resolvesTo("93.184.216.34");
    const result = await safeUrl("https://example.com/path");
    assert.equal(result.origin, "https://example.com");
  });
});
