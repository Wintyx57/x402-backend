// Sentry initialization. Must be required BEFORE any other module that should be instrumented.
// See server.js: this is the very first require() call.
require("dotenv").config();

const Sentry = require("@sentry/node");

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    release:
      process.env.RENDER_GIT_COMMIT ||
      `x402-bazaar@${require("./package.json").version}`,
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1",
    ),
    profilesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        const sensitive = [
          "authorization",
          "cookie",
          "x-admin-token",
          "x-payment",
          "payment-signature",
        ];
        for (const key of sensitive) {
          if (event.request.headers[key]) {
            event.request.headers[key] = "[REDACTED]";
          }
        }
      }
      if (event.request?.query_string) {
        event.request.query_string = String(event.request.query_string).replace(
          /(token|key|apikey|sig|auth|password|credential|access_token)=[^&]*/gi,
          "$1=[REDACTED]",
        );
      }
      return event;
    },
  });
}

module.exports = Sentry;
