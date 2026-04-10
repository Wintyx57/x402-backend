// lib/safe-url.js — Shared SSRF protection utility
// Used by: routes/wrappers/intelligence.js, routes/wrappers/web.js, routes/wrappers/ai.js,
//          routes/wrappers/data.js, routes/wrappers/tools.js, routes/services.js, routes/proxy.js

const dns = require("node:dns");

// Blocks internal hostnames and IPv6 loopback/link-local/ULA forms in the hostname field
// (before DNS resolution). Bracket-wrapped forms (e.g. [::1], [fc00::1]) are also blocked.
const BLOCKED_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|\[?fc00:|\[?fe80:|\[?fd[0-9a-f]{2}:|::1|\[::1\]|\[::ffff:)/i;

// Blocks private/loopback IPv4 addresses returned by DNS resolution
// Also blocks IPv4-mapped IPv6 (::ffff:) and full-expanded forms
// Note: dns.promises.lookup({family:4}) always returns a dotted-decimal IPv4 string,
//       so we only need to match IPv4 patterns here.
const PRIVATE_IP_V4 =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|0\.0\.0\.0)/;

// DNS result cache — reduces the TOCTOU window between safeUrl check and the actual fetch.
// A 10-second TTL means the DNS entry used during validation is very likely the same one
// the OS resolver returns milliseconds later during the real fetch (Node.js default TTL is 0,
// so without this cache every call re-resolves). This does NOT fully eliminate TOCTOU for
// a determined DNS rebinding attacker (who could manipulate TTL at the authoritative server),
// but it narrows the attack window to near-zero for typical infrastructure.
const _dnsCache = new Map();
const DNS_CACHE_TTL_MS = 10_000; // 10 seconds

/**
 * Validates a URL against SSRF attacks.
 *
 * Security measures:
 * 1. Rejects non-HTTP(S) protocols.
 * 2. Blocks internal/private hostnames by name (localhost, 10.x, 192.168.x, etc.).
 * 3. Resolves the hostname (IPv4 only) and blocks RFC-1918 / loopback / link-local addresses.
 * 4. Caches the resolved IP for 10 s — narrows the DNS rebinding TOCTOU window so that
 *    the fetch() that immediately follows this call reuses the same OS resolver result.
 * 5. Removes stale cache entries when the cache exceeds 1 000 entries.
 *
 * @param {string} rawUrl - The URL to validate
 * @returns {Promise<URL>} The parsed URL if safe
 * @throws {Error} If the URL is invalid or resolves to an internal address
 */
async function safeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP/HTTPS URLs allowed");
    }
  } catch (e) {
    throw new Error(
      e.message.includes("Only") ? e.message : "Invalid URL format",
      { cause: e },
    );
  }

  const hostname = parsed.hostname;

  // Fast-path: block obviously private hostnames without a DNS lookup
  if (BLOCKED_HOST.test(hostname)) {
    throw new Error("Internal URLs not allowed");
  }

  // Check the DNS cache first
  const cached = _dnsCache.get(hostname);
  if (cached && Date.now() - cached.time < DNS_CACHE_TTL_MS) {
    if (PRIVATE_IP_V4.test(cached.address)) {
      throw new Error("Internal IPs not allowed");
    }
    return parsed;
  }

  // Perform the DNS resolution (IPv4 only — family:4 guarantees a dotted-decimal string)
  let address;
  try {
    const result = await dns.promises.lookup(hostname, { family: 4 });
    address = result.address;
  } catch (e) {
    // Reject unresolvable hostnames — they could be internal names only reachable
    // from the server network.
    throw new Error("Could not resolve hostname", { cause: e });
  }

  if (PRIVATE_IP_V4.test(address)) {
    throw new Error("Internal IPs not allowed");
  }

  // Store in cache, then clean up stale entries if the cache is growing large
  _dnsCache.set(hostname, { address, time: Date.now() });
  if (_dnsCache.size > 1000) {
    const now = Date.now();
    for (const [key, val] of _dnsCache) {
      if (now - val.time > DNS_CACHE_TTL_MS) {
        _dnsCache.delete(key);
      }
    }
  }

  return parsed;
}

// Exposed for unit tests only — do not use in production code
function _clearDnsCache() {
  _dnsCache.clear();
}

module.exports = { safeUrl, _clearDnsCache };
