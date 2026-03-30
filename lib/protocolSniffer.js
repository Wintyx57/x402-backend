// lib/protocolSniffer.js — Standalone protocol probe for upstream URLs
"use strict";

const logger = require("./logger");
const { normalize402 } = require("./protocolAdapter");

const PROBE_TIMEOUT_MS = 8000;

/**
 * Probe a URL without payment to detect its protocol.
 *
 * @param {string} url - The upstream URL to probe
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Custom timeout (default 8s)
 * @param {object} [options.headers] - Extra headers to include
 * @returns {Promise<ProbeResult>}
 */
async function probeProtocol(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "User-Agent": "x402-bazaar/protocol-sniffer",
      ...(options.headers || {}),
    };

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);

    const status = res.status;

    // 401/403 → API key required
    if (status === 401 || status === 403) {
      return {
        protocol: "api-key",
        is402: false,
        normalized: null,
        upstreamPrice: null,
        upstreamRecipient: null,
        upstreamChain: null,
        warning: null,
        error: null,
      };
    }

    // 402 → sniff payment protocol
    if (status === 402) {
      let headers402 = {};
      try {
        headers402 = Object.fromEntries(res.headers);
      } catch {
        /* empty */
      }
      let body402 = {};
      try {
        body402 = await res.json();
      } catch {
        /* empty */
      }

      const normalized = normalize402(402, headers402, body402);

      return {
        protocol: normalized.format,
        is402: true,
        normalized,
        upstreamPrice: normalized.amount || null,
        upstreamRecipient: normalized.recipient || null,
        upstreamChain: normalized.chain || null,
        warning:
          normalized.format === "unknown" ? "unsupported_protocol" : null,
        error: null,
      };
    }

    // 200-299 → open API
    if (status >= 200 && status < 300) {
      const contentType = res.headers.get("content-type") || "";
      const isHtml = contentType.includes("text/html");

      return {
        protocol: "open",
        is402: false,
        normalized: null,
        upstreamPrice: null,
        upstreamRecipient: null,
        upstreamChain: null,
        warning: isHtml ? "html_response" : null,
        error: null,
      };
    }

    // Anything else → unknown
    return {
      protocol: "unknown",
      is402: false,
      normalized: null,
      upstreamPrice: null,
      upstreamRecipient: null,
      upstreamChain: null,
      warning: null,
      error: `Upstream returned HTTP ${status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      protocol: "unknown",
      is402: false,
      normalized: null,
      upstreamPrice: null,
      upstreamRecipient: null,
      upstreamChain: null,
      warning: null,
      error: err.name === "AbortError" ? "timeout" : err.message,
    };
  }
}

module.exports = { probeProtocol };
