// PostHog analytics for backend events. No-op when POSTHOG_PROJECT_API_KEY is unset.
const { PostHog } = require("posthog-node");
const logger = require("./logger");

let client = null;

if (process.env.POSTHOG_PROJECT_API_KEY) {
  client = new PostHog(process.env.POSTHOG_PROJECT_API_KEY, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10000,
  });
}

function distinctIdFromWallet(wallet) {
  if (!wallet) return "anonymous-backend";
  return `wallet:${String(wallet).toLowerCase()}`;
}

// Capture a backend event. Properties must avoid PII (no raw IPs, no auth headers).
function capture(eventName, { wallet, distinctId, properties = {} } = {}) {
  if (!client) return;
  try {
    client.capture({
      distinctId: distinctId || distinctIdFromWallet(wallet),
      event: eventName,
      properties: {
        $lib: "x402-bazaar-backend",
        $lib_version: require("../package.json").version,
        environment: process.env.NODE_ENV || "production",
        ...properties,
      },
    });
  } catch (err) {
    logger.warn("Analytics", `capture failed for ${eventName}: ${err.message}`);
  }
}

async function shutdown() {
  if (client) {
    try {
      await client.shutdown();
    } catch (err) {
      logger.warn("Analytics", `shutdown failed: ${err.message}`);
    }
  }
}

module.exports = {
  capture,
  shutdown,
  isEnabled: () => Boolean(client),
};
