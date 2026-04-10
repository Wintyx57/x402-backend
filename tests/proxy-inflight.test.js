// tests/proxy-inflight.test.js — Fix 3: In-flight dedup prevents duplicate upstream calls
//
// NOTE: After the proxy refactor, in-flight dedup state (INFLIGHT_MAX_ENTRIES,
// _proxyInFlight) lives in routes/proxy-execute.js. Source-reading assertions
// target that file. The final export assertion still checks routes/proxy.js
// (which re-exports shouldChargeForResponse and isEmptyResponse).
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { mockRes, mockReq } = require("./helpers");

// ---------------------------------------------------------------------------
// Test the in-flight dedup logic
// ---------------------------------------------------------------------------

test("Proxy In-Flight Dedup — Fix 3", async (t) => {
  await t.test("INFLIGHT_MAX_ENTRIES constant exists (5000 cap)", () => {
    // In-flight dedup logic lives in routes/proxy-execute.js after refactor
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes", "proxy-execute.js"),
      "utf8",
    );
    assert.ok(
      src.includes("INFLIGHT_MAX_ENTRIES"),
      "INFLIGHT_MAX_ENTRIES should be defined",
    );
    assert.ok(
      src.includes("_proxyInFlight"),
      "_proxyInFlight Map should be defined",
    );
  });

  await t.test(
    "_proxyInFlight Map is used for dedup in executeProxyCall",
    () => {
      const fs = require("fs");
      const path = require("path");
      const src = fs.readFileSync(
        path.join(__dirname, "..", "routes", "proxy-execute.js"),
        "utf8",
      );
      // Check the inflight guard pattern
      assert.ok(
        src.includes("_proxyInFlight.has(inflightKey)"),
        "should check inflightKey in map",
      );
      assert.ok(
        src.includes("_proxyInFlight.set(inflightKey"),
        "should set inflightKey in map",
      );
      assert.ok(
        src.includes("_proxyInFlight.delete(inflightKey)"),
        "should delete inflightKey in finally",
      );
    },
  );

  await t.test("inflight dedup returns 409 TX_ALREADY_USED", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes", "proxy-execute.js"),
      "utf8",
    );
    // The guard block should return 409 with TX_ALREADY_USED
    assert.ok(
      src.includes("TX_ALREADY_USED"),
      "should return TX_ALREADY_USED error code",
    );
    assert.ok(
      src.includes("already being processed"),
      "should have descriptive message",
    );
  });

  await t.test("inflight has FIFO eviction when cap reached", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes", "proxy-execute.js"),
      "utf8",
    );
    assert.ok(
      src.includes("INFLIGHT_MAX_ENTRIES"),
      "should reference max entries constant",
    );
    assert.ok(
      src.includes(".keys().next().value"),
      "should use FIFO eviction pattern",
    );
  });

  await t.test("inflight cleanup in finally block", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes", "proxy-execute.js"),
      "utf8",
    );
    // The finally block should clean up
    const finallyMatch = src.match(/finally\s*\{[^}]*_proxyInFlight\.delete/s);
    assert.ok(finallyMatch, "should delete inflightKey in finally block");
  });

  await t.test("inflightKey constructed from chain:txHash", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes", "proxy-execute.js"),
      "utf8",
    );
    assert.ok(
      src.includes("`${chain}:${txHash}`"),
      "inflightKey should be chain:txHash",
    );
  });

  await t.test("inflightKey is null when txHash is missing", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes", "proxy-execute.js"),
      "utf8",
    );
    assert.ok(
      src.includes("txHash ? `${chain}:${txHash}` : null"),
      "should handle missing txHash",
    );
  });

  await t.test(
    "exports still include shouldChargeForResponse and isEmptyResponse",
    () => {
      // These are re-exported from proxy.js for backward compatibility
      const proxy = require("../routes/proxy");
      assert.strictEqual(typeof proxy.shouldChargeForResponse, "function");
      assert.strictEqual(typeof proxy.isEmptyResponse, "function");
    },
  );
});
