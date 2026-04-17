// lib/http-client.js — Shared fetch helpers used by the backend and the MCP
// server. Previously each side had its own fetchWithTimeout: the backend's
// version used Promise.race (leaving the HTTP request running in the
// background after timeout), the MCP's version used AbortController
// (actually aborts the request). We standardize on AbortController here.

"use strict";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * fetch() with a hard timeout that actually cancels the in-flight request.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs=15000]
 * @param {AbortSignal} [externalSignal] — optional caller signal; either
 *   that signal OR the timeout will abort the request.
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  externalSignal,
) {
  const controller = new AbortController();
  // Forward external abort to the internal controller.
  let externalAbortHandler;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalAbortHandler = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", externalAbortHandler, {
        once: true,
      });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === "AbortError") {
      const reason = externalSignal?.aborted
        ? "Request aborted by caller"
        : `Request timed out after ${Math.round(timeoutMs / 1000)}s`;
      const e = new Error(`${reason}: ${url}`);
      e.name = "TimeoutError";
      e.cause = err;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalAbortHandler) {
      externalSignal.removeEventListener("abort", externalAbortHandler);
    }
  }
}

module.exports = {
  fetchWithTimeout,
  DEFAULT_TIMEOUT_MS,
};
