// lib/validators.js — Shared validation and sanitization helpers
// Imported by routes/register.js, routes/services.js, and their test suites
// to ensure tests exercise the real production logic, not a copied implementation.

"use strict";

const { ServiceRegistrationSchema } = require("../schemas");

// ─── Register input validation ───────────────────────────────────────────────

/**
 * Validate a service registration body using the canonical Zod schema.
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, error: string }`
 * on the first validation failure — matching the interface the test suite expects.
 *
 * @param {object} body - Raw request body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRegisterInput(body) {
  const result = ServiceRegistrationSchema.safeParse(body);
  if (result.success) return { valid: true };

  const firstIssue = (result.error.issues || [])[0];
  const errorMsg = firstIssue ? firstIssue.message : "Validation failed";
  return { valid: false, error: errorMsg };
}

/**
 * Build the Supabase insert object from a validated registration body.
 * Maps camelCase fields to snake_case columns and applies optional tx_hash.
 *
 * @param {object} body - Raw request body (pre-validated)
 * @returns {object} Supabase insert row
 */
function prepareInsertData(body) {
  const { name, description, url, price, tags, ownerAddress } = body;
  const txHash = body.txHash || null;

  const insertData = {
    name: name.trim(),
    description: (description || "").trim(),
    url: url.trim(),
    price_usdc: price,
    owner_address: ownerAddress,
    tags: tags || [],
  };

  if (txHash) insertData.tx_hash = txHash;

  return insertData;
}

// ─── Query sanitization helpers ──────────────────────────────────────────────

/**
 * Escape Postgres LIKE/ILIKE special characters: %, _, and backslash.
 *
 * @param {string} query
 * @returns {string}
 */
function escapeLike(query) {
  return query.replace(/[%_\\]/g, "\\$&");
}

/**
 * Sanitize a search query for Postgres text search: escape LIKE chars first,
 * then strip SQL special characters used in PostgREST filter expressions.
 *
 * @param {string} query
 * @returns {string}
 */
function sanitizeForSearch(query) {
  return escapeLike(query).replace(/[(),."']/g, "");
}

/**
 * Normalize a raw query string: trim whitespace and enforce a maximum length.
 *
 * @param {string|null|undefined} raw
 * @param {number} [maxLength=100]
 * @returns {string}
 */
function normalizeQuery(raw, maxLength = 100) {
  return (raw || "").trim().slice(0, maxLength);
}

module.exports = {
  validateRegisterInput,
  prepareInsertData,
  escapeLike,
  sanitizeForSearch,
  normalizeQuery,
};
