// lib/webhooks.js — Real-time webhook notifications for providers
// Sends POST to service.webhook_url after a confirmed payment

"use strict";

const crypto = require("node:crypto");
const logger = require("./logger");
const { safeUrl } = require("./safe-url");

const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_RETRY_DELAY_MS = 30000;

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 * Secret = service owner wallet address (lowercase).
 *
 * @param {string} secret - HMAC key (owner wallet)
 * @param {string} body   - JSON-serialized payload string
 * @returns {string} hex digest
 */
function signWebhook(secret, body) {
  return crypto
    .createHmac("sha256", secret.toLowerCase())
    .update(body)
    .digest("hex");
}

/**
 * Attempt a single HTTP delivery to webhookUrl.
 *
 * @param {string} webhookUrl
 * @param {string} bodyStr    - pre-serialized JSON
 * @param {string} signature  - hex HMAC-SHA256
 * @returns {Promise<boolean>} true on 2xx, false otherwise
 */
async function deliverWebhook(webhookUrl, bodyStr, signature) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`,
        "User-Agent": "x402-bazaar-webhook/1.0",
      },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    clearTimeout(timer);
    logger.warn("Webhook", `Delivery error to ${webhookUrl}: ${err.message}`);
    return false;
  }
}

/**
 * Fire-and-forget: send a payment.completed webhook to service.webhook_url.
 * - SSRF-checks the URL before sending.
 * - Signs payload with HMAC-SHA256 (secret = owner_address).
 * - Retries once after WEBHOOK_RETRY_DELAY_MS on failure.
 * - Never throws — all errors are logged.
 *
 * @param {object} service     - service row from DB (must have webhook_url, owner_address, id, name)
 * @param {object} paymentData - { amount_usdc, caller_wallet, tx_hash, chain }
 */
async function notifyWebhook(service, paymentData) {
  const webhookUrl = service.webhook_url;

  // Skip silently if no webhook configured
  if (!webhookUrl || typeof webhookUrl !== "string") return;

  const payload = {
    event: "payment.completed",
    service_id: service.id,
    service_name: service.name,
    amount_usdc: String(paymentData.amount_usdc),
    caller_wallet: paymentData.caller_wallet || null,
    tx_hash: paymentData.tx_hash || null,
    chain: paymentData.chain || "base",
    timestamp: new Date().toISOString(),
  };

  const bodyStr = JSON.stringify(payload);
  const secret = service.owner_address || "x402-bazaar";
  const signature = signWebhook(secret, bodyStr);

  // Fire and forget — SSRF check and delivery happen async to not block the caller
  (async () => {
    // SSRF protection (inside IIFE so it doesn't delay the response)
    try {
      await safeUrl(webhookUrl);
    } catch (err) {
      logger.warn(
        "Webhook",
        `SSRF blocked for service ${service.id}: ${err.message}`,
      );
      return;
    }

    const ok = await deliverWebhook(webhookUrl, bodyStr, signature);
    if (ok) {
      logger.info(
        "Webhook",
        `Delivered payment.completed to ${webhookUrl} for service ${service.id}`,
      );
      return;
    }

    // Single retry after delay
    logger.info(
      "Webhook",
      `Delivery failed for ${webhookUrl} — retrying in ${WEBHOOK_RETRY_DELAY_MS}ms`,
    );
    await new Promise((r) => setTimeout(r, WEBHOOK_RETRY_DELAY_MS));
    const retryOk = await deliverWebhook(webhookUrl, bodyStr, signature);
    if (retryOk) {
      logger.info("Webhook", `Retry succeeded for ${webhookUrl}`);
    } else {
      logger.warn("Webhook", `Retry failed for ${webhookUrl} — giving up`);
    }
  })().catch((err) => {
    logger.error("Webhook", `Unexpected webhook error: ${err.message}`);
  });
}

module.exports = { notifyWebhook, signWebhook, deliverWebhook };
