// lib/credentials.js — AES-256-GCM encryption for provider API credentials
const crypto = require("crypto");
const logger = require("./logger");

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Derive key from env or generate ephemeral (with warning)
let _key;
function getKey() {
  if (_key) return _key;
  const envKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (envKey && envKey.length === 64) {
    _key = Buffer.from(envKey, "hex");
  } else {
    _key = null;
    logger.error(
      "Credentials",
      "CREDENTIALS_ENCRYPTION_KEY not set or invalid (need 64 hex chars) — credential encryption/decryption will fail",
    );
  }
  return _key;
}

/**
 * Encrypt credentials object → base64 string for DB storage.
 * @param {object} creds - { type, credentials: [...] }
 * @returns {string} base64-encoded encrypted blob
 */
function encryptCredentials(creds) {
  const key = getKey();
  if (!key)
    throw new Error(
      "Cannot encrypt: CREDENTIALS_ENCRYPTION_KEY not configured",
    );
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = JSON.stringify(creds);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: iv (12) + tag (16) + ciphertext
  const blob = Buffer.concat([iv, tag, encrypted]);
  return blob.toString("base64");
}

/**
 * Decrypt base64 string → credentials object.
 * @param {string} encoded - base64-encoded encrypted blob
 * @returns {object|null} decrypted credentials or null on failure
 */
function decryptCredentials(encoded) {
  try {
    const key = getKey();
    if (!key) {
      logger.error(
        "Credentials",
        "Cannot decrypt: CREDENTIALS_ENCRYPTION_KEY not configured",
      );
      return null;
    }
    const blob = Buffer.from(encoded, "base64");
    const iv = blob.subarray(0, IV_LENGTH);
    const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch (err) {
    logger.error("Credentials", `Decryption failed: ${err.message}`);
    return null;
  }
}

/**
 * Build a masked preview of a credential value (for API responses — NEVER expose the real value).
 * e.g. "sk-proj-abc...xyz" → "sk-p****xyz"
 * @param {string} value
 * @returns {string}
 */
function maskCredentialValue(value) {
  if (!value || typeof value !== "string") return "****";
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-3);
}

/**
 * Inject credentials into proxy request headers / URL based on credential type.
 * @param {object} proxyHeaders - mutable headers object
 * @param {string} targetUrl - the upstream URL (may be mutated for query params)
 * @param {object|null} creds - decrypted credentials { type, credentials: [{ key, value, location }] }
 * @returns {{ headers: object, url: string }} updated headers and URL
 */
function injectCredentials(proxyHeaders, targetUrl, creds) {
  if (!creds || !Array.isArray(creds.credentials)) {
    return { headers: proxyHeaders, url: targetUrl };
  }

  let url = targetUrl;

  for (const cred of creds.credentials) {
    const { key, value, location } = cred;
    if (!key || !value) continue;

    const mode = location || creds.type;

    switch (mode) {
      case "header":
        proxyHeaders[key] = value;
        break;
      case "bearer":
        proxyHeaders["Authorization"] = `Bearer ${value}`;
        break;
      case "basic": {
        // value should be "username:password"
        const encoded = Buffer.from(value).toString("base64");
        proxyHeaders["Authorization"] = `Basic ${encoded}`;
        break;
      }
      case "query": {
        const parsed = new URL(url);
        parsed.searchParams.set(key, value);
        url = parsed.toString();
        break;
      }
      default:
        // Default to header injection
        proxyHeaders[key] = value;
    }
  }

  return { headers: proxyHeaders, url };
}

module.exports = {
  encryptCredentials,
  decryptCredentials,
  maskCredentialValue,
  injectCredentials,
};
