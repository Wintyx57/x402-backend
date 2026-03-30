// tests/protocolSniffer.test.js — Unit tests for lib/protocolSniffer.js
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

// Helper: build a base64-encoded Payment-Required header for x402-v2
function buildX402V2Header({
  amount = "1000000",
  payTo = "0xDeadBeef",
  network = "eip155:8453",
} = {}) {
  const payload = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network,
        maxAmountRequired: amount,
        payTo,
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
      },
    ],
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// Helper: build a mock Response-like object
function mockResponse({ status, headers = {}, body = null, bodyText = null }) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    headers: {
      get: (key) => headerMap.get(key.toLowerCase()) ?? null,
      entries: () => headerMap.entries(),
      [Symbol.iterator]: () => headerMap[Symbol.iterator](),
    },
    json: async () => {
      if (body !== null) return body;
      throw new Error("No JSON body");
    },
    text: async () => bodyText ?? "",
  };
}

// The module reads global.fetch at call time — require once after patching global.fetch
// with a no-op so the require() doesn't crash if global.fetch is not set yet.
global.fetch = async () => {
  throw new Error("fetch not mocked");
};
const { probeProtocol } = require("../lib/protocolSniffer");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("probeProtocol", () => {
  afterEach(() => {
    // Reset to a "not mocked" state between tests to prevent accidental reuse
    global.fetch = async () => {
      throw new Error("fetch not mocked");
    };
  });

  it("should detect open API (200) → protocol=open, is402=false", async () => {
    global.fetch = async () =>
      mockResponse({
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const result = await probeProtocol("https://api.example.com/data");

    assert.equal(result.protocol, "open");
    assert.equal(result.is402, false);
    assert.equal(result.normalized, null);
    assert.equal(result.upstreamPrice, null);
    assert.equal(result.warning, null);
    assert.equal(result.error, null);
  });

  it("should detect x402-v2 via Payment-Required header → protocol=x402-v2, is402=true, upstreamPrice extracted", async () => {
    const prHeader = buildX402V2Header({
      amount: "5000000",
      payTo: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
      network: "eip155:8453",
    });

    global.fetch = async () => {
      const resp = mockResponse({
        status: 402,
        headers: {
          "payment-required": prHeader,
          "content-type": "application/json",
        },
        body: {},
      });
      // Override entries() so Object.fromEntries(res.headers) works
      resp.headers[Symbol.iterator] = () => resp.headers.entries();
      resp.headers.entries = () =>
        new Map([
          ["payment-required", prHeader],
          ["content-type", "application/json"],
        ]).entries();
      return resp;
    };

    const result = await probeProtocol("https://api.cascade.surf/endpoint");

    assert.equal(result.protocol, "x402-v2");
    assert.equal(result.is402, true);
    assert.ok(result.normalized, "normalized should be set");
    assert.equal(result.normalized.payable, true);
    assert.equal(result.upstreamPrice, "5000000");
    assert.equal(
      result.upstreamRecipient,
      "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    );
    assert.equal(result.upstreamChain, "base");
    assert.equal(result.warning, null);
    assert.equal(result.error, null);
  });

  it("should detect L402 (Lightning) → protocol=l402, is402=true, payable=false", async () => {
    global.fetch = async () => {
      const resp = mockResponse({
        status: 402,
        headers: {
          "www-authenticate": 'L402 macaroon="abc123", invoice="lnbc..."',
        },
        body: {},
      });
      resp.headers.entries = () =>
        new Map([
          ["www-authenticate", 'L402 macaroon="abc123", invoice="lnbc..."'],
        ]).entries();
      return resp;
    };

    const result = await probeProtocol(
      "https://api.lightning.example/resource",
    );

    assert.equal(result.protocol, "l402");
    assert.equal(result.is402, true);
    assert.ok(result.normalized, "normalized should be set");
    assert.equal(result.normalized.payable, false);
    assert.equal(result.warning, null);
    assert.equal(result.error, null);
  });

  it("should detect API key required (401) → protocol=api-key, is402=false", async () => {
    global.fetch = async () => mockResponse({ status: 401, headers: {} });

    const result = await probeProtocol("https://api.rapidapi.com/protected");

    assert.equal(result.protocol, "api-key");
    assert.equal(result.is402, false);
    assert.equal(result.normalized, null);
    assert.equal(result.upstreamPrice, null);
    assert.equal(result.error, null);
  });

  it("should detect API key required (403) → protocol=api-key", async () => {
    global.fetch = async () => mockResponse({ status: 403, headers: {} });

    const result = await probeProtocol("https://api.example.com/protected");

    assert.equal(result.protocol, "api-key");
    assert.equal(result.is402, false);
    assert.equal(result.error, null);
  });

  it("should handle timeout gracefully → protocol=unknown, error=timeout", async () => {
    global.fetch = async (_url, opts) => {
      // Simulate abort by triggering the signal
      await new Promise((_res, rej) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          rej(err);
        });
      });
    };

    const result = await probeProtocol("https://slow.example.com", {
      timeoutMs: 50,
    });

    assert.equal(result.protocol, "unknown");
    assert.equal(result.is402, false);
    assert.equal(result.error, "timeout");
  });

  it("should handle HTML response (SPA) as open with warning → protocol=open, warning=html_response", async () => {
    global.fetch = async () =>
      mockResponse({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });

    const result = await probeProtocol("https://cascade.surf/api/data");

    assert.equal(result.protocol, "open");
    assert.equal(result.is402, false);
    assert.equal(result.warning, "html_response");
    assert.equal(result.error, null);
  });

  it("should extract upstream price from x402 normalized result → upstreamPrice and upstreamRecipient populated", async () => {
    const recipientAddr = "0x1234567890123456789012345678901234567890";
    const prHeader = buildX402V2Header({
      amount: "2500000",
      payTo: recipientAddr,
      network: "eip155:137",
    });

    global.fetch = async () => {
      const resp = mockResponse({
        status: 402,
        headers: { "payment-required": prHeader },
        body: {},
      });
      resp.headers.entries = () =>
        new Map([["payment-required", prHeader]]).entries();
      return resp;
    };

    const result = await probeProtocol("https://api.polygon.service/data");

    assert.equal(result.is402, true);
    assert.equal(result.upstreamPrice, "2500000");
    assert.equal(result.upstreamRecipient, recipientAddr);
    assert.equal(result.upstreamChain, "polygon");
    assert.ok(result.normalized);
    assert.equal(result.normalized.format, "x402-v2");
  });
});

describe("MPP request base64 parsing", () => {
  it("should mark MPP payable when chainId is supported and currency is USDC", () => {
    const { normalize402 } = require("../lib/protocolAdapter");
    const request = Buffer.from(
      JSON.stringify({
        amount: "10000",
        currency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
        methodDetails: { chainId: 8453 },
        recipient: "0x2BB201f1bb056eb738718BD7A3ad1BEF24b883bb",
      }),
    ).toString("base64");
    const headers = {
      "www-authenticate": `Payment id="abc", realm="test.com", method="tempo", intent="charge", request="${request}"`,
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, "mpp");
    assert.equal(result.payable, true);
    assert.equal(result.amount, "10000");
    assert.equal(
      result.recipient,
      "0x2BB201f1bb056eb738718BD7A3ad1BEF24b883bb",
    );
    assert.equal(result.chain, "base");
  });

  it("should keep MPP not payable when chainId is unsupported", () => {
    const { normalize402 } = require("../lib/protocolAdapter");
    const request = Buffer.from(
      JSON.stringify({
        amount: "10000",
        currency: "0x20C000000000000000000000b9537d11c60E8b50",
        methodDetails: { chainId: 4217 },
        recipient: "0x2BB201f1bb056eb738718BD7A3ad1BEF24b883bb",
      }),
    ).toString("base64");
    const headers = {
      "www-authenticate": `Payment id="abc", realm="test.com", method="tempo", intent="charge", request="${request}"`,
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, "mpp");
    assert.equal(result.payable, false);
  });

  it("should keep MPP not payable when no request param", () => {
    const { normalize402 } = require("../lib/protocolAdapter");
    const headers = {
      "www-authenticate": 'Payment id="abc", realm="test.com", method="tempo"',
    };
    const result = normalize402(402, headers, {});
    assert.equal(result.format, "mpp");
    assert.equal(result.payable, false);
  });
});
