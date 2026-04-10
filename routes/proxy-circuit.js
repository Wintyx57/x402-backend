/**
 * routes/proxy-circuit.js — Circuit Breaker for upstream service calls
 *
 * Prevents hammering failing upstream services by tracking failure counts
 * in a rolling window and opening/half-opening the circuit accordingly.
 *
 * All state is module-level (singleton per process), intentionally shared
 * across requests so the breaker accumulates failures correctly.
 */
"use strict";

const logger = require("../lib/logger");

const CB_FAILURE_THRESHOLD = 3; // failures before opening circuit
const CB_WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window
const CB_OPEN_DURATION_MS = 30 * 1000; // 30s before half-open
const CB_MAX_ENTRIES = 1000; // eviction cap (FIFO via insertion order)

// Map<serviceUrl, { failures: number, lastFailure: number, state: 'closed'|'open'|'half-open' }>
const circuitBreakers = new Map();

function getCircuitBreaker(serviceUrl) {
  if (!circuitBreakers.has(serviceUrl)) {
    // FIFO eviction when cap is reached
    if (circuitBreakers.size >= CB_MAX_ENTRIES) {
      const firstKey = circuitBreakers.keys().next().value;
      circuitBreakers.delete(firstKey);
    }
    circuitBreakers.set(serviceUrl, {
      failures: 0,
      lastFailure: 0,
      state: "closed",
    });
  }
  return circuitBreakers.get(serviceUrl);
}

/**
 * Check if the circuit is open (should block the request).
 * Transitions open → half-open after CB_OPEN_DURATION_MS.
 * Returns true if the request should be blocked (503).
 */
function isCircuitOpen(serviceUrl) {
  const cb = getCircuitBreaker(serviceUrl);

  if (cb.state === "open") {
    const elapsed = Date.now() - cb.lastFailure;
    if (elapsed >= CB_OPEN_DURATION_MS) {
      cb.state = "half-open";
      return false; // let one probe request through
    }
    return true; // still open → block
  }

  return false;
}

/**
 * Record a successful upstream call.
 * Resets the circuit to 'closed' (from half-open or closed).
 */
function recordCircuitSuccess(serviceUrl) {
  const cb = getCircuitBreaker(serviceUrl);
  cb.failures = 0;
  cb.lastFailure = 0;
  cb.state = "closed";
}

/**
 * Record a failed upstream call.
 * Increments failure count; opens circuit if threshold reached.
 * In half-open state, a single failure reopens the circuit.
 */
function recordCircuitFailure(serviceUrl) {
  const cb = getCircuitBreaker(serviceUrl);
  const now = Date.now();

  // Reset counter if last failure is outside the rolling window
  if (now - cb.lastFailure > CB_WINDOW_MS) {
    cb.failures = 0;
  }

  cb.failures += 1;
  cb.lastFailure = now;

  if (cb.state === "half-open" || cb.failures >= CB_FAILURE_THRESHOLD) {
    cb.state = "open";
    logger.warn(
      "CircuitBreaker",
      `Circuit OPEN for ${serviceUrl} (${cb.failures} failures)`,
    );
  }
}

module.exports = {
  CB_OPEN_DURATION_MS,
  isCircuitOpen,
  recordCircuitSuccess,
  recordCircuitFailure,
};
