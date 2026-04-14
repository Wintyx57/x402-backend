"use strict";

// lib/smart-search.js — Hybrid search engine for API service discovery
//
// Strategy:
//   1. Extract meaningful keywords from the raw query (stopword removal)
//   2. Multi-field ILIKE search in Supabase (name + description), two parallel queries
//   3. Weighted scoring — return immediately when top score >= SCORE_THRESHOLD
//   4. Gemini AI fallback for ambiguous queries (0 results or score < SCORE_THRESHOLD)
//   5. Full services list cached 5 min; Gemini results cached 10 min per query

const logger = require("./logger");
const { openaiRetry } = require("./openai-retry");
const { getInputSchemaForUrl } = require("./bazaar-discovery");

// --- Sanitize user input before PostgREST ILIKE interpolation ---
// Prevents PostgREST operator injection (e.g. ".ilike.", ".eq.", ".not.", etc.)
function sanitizePostgrest(input) {
  if (!input) return "";
  const str = String(input).trim().slice(0, 100);
  // Block PostgREST operator injection (case-insensitive)
  const operatorPattern =
    /\.(ilike|eq|neq|not|in|cs|cd|is|gt|gte|lt|lte|like|fts)\./i;
  if (operatorPattern.test(str)) return "";
  // Escape ILIKE special chars
  const escaped = str.replace(/[%_\\]/g, (c) => "\\" + c);
  // Remove chars that are meaningful to PostgREST filter syntax
  return escaped.replace(/[,()"`']/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_COLUMNS =
  "id, name, url, price_usdc, description, owner_address, tags, " +
  "verified_status, verified_at, created_at, required_parameters, status, last_checked_at";

/**
 * Words that carry no semantic value and are discarded during keyword extraction.
 * @type {Set<string>}
 */
const STOPWORDS = new Set([
  "i",
  "need",
  "want",
  "to",
  "a",
  "an",
  "the",
  "for",
  "of",
  "and",
  "or",
  "in",
  "on",
  "with",
  "that",
  "this",
  "get",
  "find",
  "me",
  "my",
  "some",
  "can",
  "you",
  "do",
  "is",
  "it",
  "be",
  "have",
  "use",
  "please",
  "should",
  "would",
  "could",
  "how",
  "what",
  "where",
  "which",
]);

/** Minimum top-result score to consider scoring results "good enough" and skip Gemini. */
const SCORE_THRESHOLD = 20;

/** TTL (ms) for the full services list cache used by Gemini. */
const SERVICES_CACHE_TTL_MS = 5 * 60 * 1000;

/** TTL (ms) for individual Gemini query result caches. */
const GEMINI_CACHE_TTL_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// In-memory caches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full services list cache.
 * @type {{ data: Array<object>, fetchedAt: number } | null}
 */
let _servicesListCache = null;

/**
 * Gemini result cache.
 * Key  : normalised query string
 * Value: { suggestions: string[], fetchedAt: number }
 * @type {Map<string, { suggestions: string[], fetchedAt: number }>}
 */
const _geminiCache = new Map();

// Cleanup expired Gemini cache entries every 15 minutes
const _GEMINI_CLEANUP_INTERVAL = 15 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _geminiCache) {
    if (now - val.fetchedAt > GEMINI_CACHE_TTL_MS) _geminiCache.delete(key);
  }
}, _GEMINI_CLEANUP_INTERVAL).unref();

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Keyword extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts meaningful keywords from a raw user query.
 * Lowercases, strips non-alphanumeric characters, removes stopwords,
 * and discards tokens of 2 characters or fewer.
 *
 * @param {string} query
 * @returns {string[]}
 */
function extractKeywords(query) {
  return (query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Multi-field ILIKE search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries Supabase using ILIKE across name and description for all keywords,
 * plus an exact phrase match on name. Runs both queries in parallel.
 * Merges and deduplicates results by `id`.
 *
 * @param {object} supabase - Supabase JS client
 * @param {string[]} keywords - extracted keywords
 * @param {string} originalQuery - raw query (used for phrase match)
 * @returns {Promise<Array<object>>}
 */
async function fetchCandidates(supabase, keywords, originalQuery) {
  const parallelQueries = [];

  // Query 1: OR across all keywords in name + description + tags
  // tags is a PostgreSQL array — cast to text for ILIKE matching
  if (keywords.length > 0) {
    const orParts = keywords.flatMap((kw) => [
      `name.ilike.%${kw}%`,
      `description.ilike.%${kw}%`,
      `tags.cs.{${kw}}`,
    ]);

    parallelQueries.push(
      supabase
        .from("services")
        .select(SERVICE_COLUMNS)
        .neq("status", "pending_validation")
        .neq("status", "quarantined")
        .or(orParts.join(","))
        .limit(100),
    );
  }

  // Query 2: exact original query as substring in name
  // sanitizePostgrest applied to prevent ILIKE injection via operator patterns
  const queryLower = sanitizePostgrest(originalQuery.toLowerCase());
  if (queryLower) {
    parallelQueries.push(
      supabase
        .from("services")
        .select(SERVICE_COLUMNS)
        .neq("status", "pending_validation")
        .neq("status", "quarantined")
        .or(`name.ilike.%${queryLower}%`)
        .limit(50),
    );
  }

  const settled = await Promise.all(parallelQueries);

  // Merge and deduplicate by id
  const seen = new Set();
  const merged = [];

  for (const { data, error } of settled) {
    if (error) {
      logger.warn("SmartSearch", `ILIKE query partial error: ${error.message}`);
      continue;
    }
    for (const service of data || []) {
      if (!seen.has(service.id)) {
        seen.add(service.id);
        merged.push(service);
      }
    }
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Weighted scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a relevance score for a single service against the query.
 *
 * Scoring weights:
 *   +100  exact name match (nameLower === queryLower)
 *    +60  name contains full query as substring
 *    +30  name contains a keyword
 *    +25  tag exact match (tag === keyword)
 *    +15  tag partial match (tag contains keyword)
 *    +10  description contains a keyword
 *    +10  status: online boost
 *    -20  status: offline penalty
 *     -5  status: degraded penalty
 *     +5  verified_status: mainnet_verified boost
 *
 * @param {object} service - service record
 * @param {string[]} keywords - lower-cased extracted keywords
 * @param {string} originalQuery - raw user query (lower-cased comparison done inside)
 * @returns {number}
 */
function scoreService(service, keywords, originalQuery) {
  let score = 0;

  const nameLower = (service.name || "").toLowerCase();
  const descLower = (service.description || "").toLowerCase();
  const tags = Array.isArray(service.tags)
    ? service.tags.map((t) => t.toLowerCase())
    : [];
  const queryLower = (originalQuery || "").toLowerCase().trim();

  // ── Name phrase scoring ───────────────────────────────────────────────────
  if (nameLower === queryLower) {
    score += 100;
  } else if (queryLower && nameLower.includes(queryLower)) {
    score += 60;
  }

  // ── Per-keyword scoring ───────────────────────────────────────────────────
  for (const kw of keywords) {
    if (!kw) continue;

    if (nameLower.includes(kw)) score += 30;

    if (tags.includes(kw)) {
      score += 25; // tag exact match
    } else if (tags.some((t) => t.includes(kw))) {
      score += 15; // tag partial match
    }

    if (descLower.includes(kw)) score += 10;
  }

  // ── Status modifier ───────────────────────────────────────────────────────
  if (service.status === "online") score += 10;
  else if (service.status === "offline") score -= 20;
  else if (service.status === "degraded") score -= 5;

  // ── Verified provider boost ───────────────────────────────────────────────
  if (service.verified_status === "mainnet_verified") score += 5;

  return score;
}

/**
 * Attaches a `_score` field to each service and sorts descending.
 *
 * @param {Array<object>} services
 * @param {string[]} keywords
 * @param {string} originalQuery
 * @returns {Array<object>}
 */
function rankServices(services, keywords, originalQuery) {
  return services
    .map((s) => ({ ...s, _score: scoreService(s, keywords, originalQuery) }))
    .sort((a, b) => b._score - a._score);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Gemini AI fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the full services list, loading from Supabase if the cache is stale.
 * Cache TTL: 5 minutes.
 *
 * @param {object} supabase
 * @returns {Promise<Array<object>>}
 */
async function getServicesWithCache(supabase) {
  const now = Date.now();

  if (
    _servicesListCache &&
    now - _servicesListCache.fetchedAt < SERVICES_CACHE_TTL_MS
  ) {
    return _servicesListCache.data;
  }

  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_COLUMNS)
    .neq("status", "pending_validation")
    .neq("status", "quarantined")
    .limit(500);

  if (error) {
    logger.warn(
      "SmartSearch",
      `Could not refresh services cache: ${error.message}`,
    );
    // Return stale data rather than an empty array — better than nothing
    return _servicesListCache ? _servicesListCache.data : [];
  }

  _servicesListCache = { data: data || [], fetchedAt: now };
  return _servicesListCache.data;
}

/**
 * Returns the normalised cache key for a Gemini query.
 * @param {string} query
 * @returns {string}
 */
function normaliseCacheKey(query) {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Calls Gemini to identify the most relevant service names for the query.
 * Results are cached per normalised query for GEMINI_CACHE_TTL_MS.
 *
 * @param {Function} getGemini - lazy Gemini client factory
 * @param {string} query - raw user query
 * @param {string[]} serviceNames - names of all available services
 * @returns {Promise<string[]>} - up to 5 suggested service names
 */
async function askGemini(getGemini, query, serviceNames) {
  const cacheKey = normaliseCacheKey(query);
  const now = Date.now();

  const cached = _geminiCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < GEMINI_CACHE_TTL_MS) {
    logger.info("SmartSearch", `Gemini cache hit — query="${cacheKey}"`);
    return cached.suggestions;
  }

  const model = getGemini().getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction:
      "You are a search assistant for an API marketplace. Given a user query, " +
      "suggest the BEST matching API service names from this catalog. " +
      "Return ONLY a JSON array of up to 5 service names (strings), ordered by relevance. " +
      "If no good match exists, return an empty array [].\n\n" +
      "Available APIs:\n" +
      serviceNames.join(", "),
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 200,
    },
  });

  const result = await openaiRetry(
    () => model.generateContent(query),
    "SmartSearch:Gemini",
  );

  const rawText = result.response.text();

  let suggestions = [];
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      suggestions = parsed.filter((s) => typeof s === "string").slice(0, 5);
    }
  } catch (parseErr) {
    logger.warn(
      "SmartSearch",
      `Gemini JSON parse error: ${parseErr.message} — raw="${rawText.slice(0, 200)}"`,
    );
  }

  _geminiCache.set(cacheKey, { suggestions, fetchedAt: now });
  logger.info(
    "SmartSearch",
    `Gemini suggestions cached — query="${cacheKey}" count=${suggestions.length}`,
  );

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Param enrichment (mirrors services.js enrichWithParams)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enriches services with `required_parameters` from bazaar-discovery
 * when the DB field is null or undefined.
 *
 * @param {Array<object>} services
 * @returns {Array<object>}
 */
function enrichWithParams(services) {
  if (!Array.isArray(services)) return services;
  return services.map((s) => {
    if (s.required_parameters) return s;
    const schema = getInputSchemaForUrl(s.url);
    if (schema) return { ...s, required_parameters: schema };
    return s;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hybrid search engine for API service discovery.
 *
 * @param {object} supabase - Supabase JS client
 * @param {string} query - raw user search query (natural language or keywords)
 * @param {Function|null} [getGemini=null]
 *   Lazy Gemini client factory — returns a GoogleGenerativeAI instance.
 *   Usage: getGemini().getGenerativeModel({ model: '...' })
 *   Pass null (or omit) when Gemini is not configured.
 *
 * @returns {Promise<{
 *   results: Array<object>,
 *   query_used: string,
 *   keywords_used: string[],
 *   method: 'scoring' | 'gemini' | 'scoring+gemini',
 *   gemini_suggestions: string[] | null
 * }>}
 */
async function smartSearch(supabase, query, getGemini = null) {
  const trimmed = (query || "").trim();

  if (!trimmed) {
    return {
      results: [],
      query_used: trimmed,
      keywords_used: [],
      method: "scoring",
      gemini_suggestions: null,
    };
  }

  const keywords = extractKeywords(trimmed);

  logger.info(
    "SmartSearch",
    `query="${trimmed}" keywords=[${keywords.join(", ")}]`,
  );

  // ── Step 2: multi-field ILIKE candidates ──────────────────────────────────
  const candidates = await fetchCandidates(supabase, keywords, trimmed);

  // ── Step 3: weighted scoring ──────────────────────────────────────────────
  const ranked = rankServices(candidates, keywords, trimmed);
  const topScore = ranked.length > 0 ? ranked[0]._score : 0;

  if (topScore >= SCORE_THRESHOLD) {
    logger.info(
      "SmartSearch",
      `method=scoring results=${ranked.length} topScore=${topScore}`,
    );
    return {
      results: enrichWithParams(ranked),
      query_used: trimmed,
      keywords_used: keywords,
      method: "scoring",
      gemini_suggestions: null,
    };
  }

  // ── Step 4: Gemini fallback ───────────────────────────────────────────────
  if (!getGemini) {
    // Gemini not configured — return scoring results as-is
    logger.info(
      "SmartSearch",
      `method=scoring (no Gemini) results=${ranked.length} topScore=${topScore}`,
    );
    return {
      results: enrichWithParams(ranked),
      query_used: trimmed,
      keywords_used: keywords,
      method: "scoring",
      gemini_suggestions: null,
    };
  }

  logger.info(
    "SmartSearch",
    `topScore=${topScore} < ${SCORE_THRESHOLD} — invoking Gemini fallback`,
  );

  try {
    const allServices = await getServicesWithCache(supabase);
    const serviceNames = allServices.map((s) => s.name).filter(Boolean);

    const suggestions = await askGemini(getGemini, trimmed, serviceNames);

    if (suggestions.length === 0) {
      // Gemini found nothing useful — return scoring results
      return {
        results: enrichWithParams(ranked),
        query_used: trimmed,
        keywords_used: keywords,
        method: ranked.length > 0 ? "scoring+gemini" : "gemini",
        gemini_suggestions: suggestions,
      };
    }

    // Filter full catalogue to Gemini-suggested names (case-insensitive)
    const suggestionSet = new Set(suggestions.map((s) => s.toLowerCase()));
    const geminiMatches = allServices.filter(
      (s) => s.name && suggestionSet.has(s.name.toLowerCase()),
    );

    // Score the Gemini matches so they also carry a `_score` field
    const geminiRanked = rankServices(geminiMatches, keywords, trimmed);

    // Merge: Gemini-matched services first, then remaining scoring results
    const geminiIds = new Set(geminiRanked.map((s) => s.id));
    const extra = ranked.filter((s) => !geminiIds.has(s.id));
    const merged = [...geminiRanked, ...extra];

    logger.info(
      "SmartSearch",
      `method=scoring+gemini results=${merged.length} gemini=${geminiRanked.length}`,
    );

    return {
      results: enrichWithParams(merged),
      query_used: trimmed,
      keywords_used: keywords,
      method: "scoring+gemini",
      gemini_suggestions: suggestions,
    };
  } catch (geminiErr) {
    // Gemini failed — degrade gracefully to scoring results
    logger.error("SmartSearch", `Gemini fallback error: ${geminiErr.message}`);
    return {
      results: enrichWithParams(ranked),
      query_used: trimmed,
      keywords_used: keywords,
      method: "scoring",
      gemini_suggestions: null,
    };
  }
}

module.exports = { smartSearch, scoreService };
