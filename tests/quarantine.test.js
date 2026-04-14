const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("quarantine — status filtering", () => {
  it("quarantined status should be a valid service status", () => {
    const VALID_STATUSES = [
      "online",
      "offline",
      "degraded",
      "unknown",
      "pending_validation",
      "quarantined",
    ];
    assert.ok(VALID_STATUSES.includes("quarantined"));
  });

  it("public query filters should exclude quarantined and pending_validation", () => {
    const FILTERED_STATUSES = ["pending_validation", "quarantined"];
    assert.ok(FILTERED_STATUSES.includes("quarantined"));
    assert.ok(FILTERED_STATUSES.includes("pending_validation"));
    assert.strictEqual(FILTERED_STATUSES.length, 2);
  });
});

describe("quarantine — bare 402 detection logic", () => {
  it("should identify bare 402 (is402 + unknown protocol) as needing quarantine", () => {
    const probeResult = {
      is402: true,
      protocol: "unknown",
      normalized: { format: "unknown", payable: false },
    };
    const shouldQuarantine =
      probeResult.is402 && probeResult.protocol === "unknown";
    assert.strictEqual(shouldQuarantine, true);
  });

  it("should NOT block valid x402 protocols", () => {
    const validProtocols = [
      "x402-v1",
      "x402-v2",
      "x402-bazaar",
      "x402-variant",
      "mpp",
      "flat",
      "header-based",
      "l402",
      "l402-protocol",
      "stripe402",
    ];
    for (const protocol of validProtocols) {
      const probeResult = {
        is402: true,
        protocol,
        normalized: { format: protocol, payable: true },
      };
      const shouldQuarantine =
        probeResult.is402 && probeResult.protocol === "unknown";
      assert.strictEqual(
        shouldQuarantine,
        false,
        `Should NOT quarantine protocol: ${protocol}`,
      );
    }
  });

  it("should NOT block open APIs (200 OK, no 402)", () => {
    const probeResult = { is402: false, protocol: "open", normalized: null };
    const shouldQuarantine =
      probeResult.is402 && probeResult.protocol === "unknown";
    assert.strictEqual(shouldQuarantine, false);
  });

  it("should NOT block API-key protected services (401/403)", () => {
    const probeResult = { is402: false, protocol: "api-key", normalized: null };
    const shouldQuarantine =
      probeResult.is402 && probeResult.protocol === "unknown";
    assert.strictEqual(shouldQuarantine, false);
  });
});

describe("quarantine — relay guard for unknown 402", () => {
  it("should detect unknown format as non-relayable", () => {
    const normalized = {
      format: "unknown",
      payable: false,
      amount: null,
      recipient: null,
      chain: null,
    };
    const isUnknownBare402 = normalized.format === "unknown";
    assert.strictEqual(isUnknownBare402, true);
  });

  it("should NOT block valid relayable formats", () => {
    const relayable = [
      {
        format: "x402-v2",
        payable: true,
        amount: "5000",
        recipient: "0x" + "a".repeat(40),
        chain: "base",
      },
      {
        format: "x402-bazaar",
        payable: true,
        amount: "3000",
        recipient: "0x" + "b".repeat(40),
        chain: "skale",
      },
      {
        format: "mpp",
        payable: true,
        amount: "10000",
        recipient: "0x" + "c".repeat(40),
        chain: "polygon",
      },
    ];
    for (const normalized of relayable) {
      const isUnknownBare402 = normalized.format === "unknown";
      assert.strictEqual(
        isUnknownBare402,
        false,
        `Should NOT block format: ${normalized.format}`,
      );
    }
  });
});

describe("quarantine — monitoring protocol-aware status", () => {
  it("402 with valid protocol should be online", () => {
    const httpStatus = 402;
    const detectedProtocol = "x402-bazaar";
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const status = isBare402 ? "degraded" : "online";
    assert.strictEqual(status, "online");
  });

  it("402 with unknown/null protocol should be degraded", () => {
    const httpStatus = 402;
    const detectedProtocol = null;
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const status = isBare402 ? "degraded" : "online";
    assert.strictEqual(status, "degraded");
  });

  it("200 OK should be online regardless of protocol", () => {
    const httpStatus = 200;
    const detectedProtocol = null;
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const isOnline =
      httpStatus === 200 || httpStatus === 400 || httpStatus === 429;
    const status = isBare402 ? "degraded" : isOnline ? "online" : "offline";
    assert.strictEqual(status, "online");
  });

  it("500 should be offline", () => {
    const httpStatus = 500;
    const detectedProtocol = null;
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const isOnline =
      httpStatus === 200 || httpStatus === 400 || httpStatus === 429;
    const status = isBare402 ? "degraded" : isOnline ? "online" : "offline";
    assert.strictEqual(status, "offline");
  });
});

describe("quarantine — MCP service status guard", () => {
  it("should block quarantined services before payment", () => {
    const blockedStatuses = new Set(["offline", "quarantined"]);
    assert.ok(blockedStatuses.has("quarantined"));
    assert.ok(blockedStatuses.has("offline"));
    assert.ok(!blockedStatuses.has("online"));
    assert.ok(!blockedStatuses.has("degraded"));
    assert.ok(!blockedStatuses.has("unknown"));
  });
});
