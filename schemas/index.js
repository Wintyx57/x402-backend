// schemas/index.js — Zod validation schemas for x402 API endpoints
const { z } = require("zod");

// ─── Service Registration Schema ───────────────────────────────────────
/**
 * Schema for POST /register
 * Validates service registration with name, url, description, price, and tags
 */
const ServiceRegistrationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Service name is required")
    .max(200, "Service name must be at most 200 characters"),

  url: z
    .string()
    .url("Must be a valid HTTP(S) URL")
    .max(500, "Service URL must be at most 500 characters"),

  price: z
    .number()
    .min(0, "Price must be at least 0")
    .max(1000, "Price must be at most 1000 USDC"),

  ownerAddress: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "Owner address must be a valid Ethereum address (0x followed by 40 hex characters)",
    ),

  description: z
    .string()
    .trim()
    .max(1000, "Description must be at most 1000 characters")
    .optional()
    .default(""),

  tags: z
    .array(z.string().max(50, "Each tag must be at most 50 characters"))
    .max(10, "Maximum 10 tags allowed")
    .optional()
    .default([]),

  required_parameters: z
    .object({
      properties: z.record(z.any()).optional(),
      required: z.array(z.string().max(100)).max(50).optional(),
    })
    .optional()
    .nullable(),

  logo_url: z.string().url().max(500).optional().nullable(),

  alert_webhook_url: z.string().url().max(500).optional().nullable(),
});

// ─── Service Search Schema ────────────────────────────────────────────
/**
 * Schema for GET /search query parameters
 * Validates search query input
 */
const ServiceSearchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Search query is required")
    .max(100, "Search query must be at most 100 characters")
    .refine(
      (query) => !/[\x00-\x1F\x7F]/.test(query),
      "Search query contains invalid control characters",
    ),
});

// ─── Web Scraper URL Schema ────────────────────────────────────────────
/**
 * Schema for GET /api/scrape query parameter
 * Validates the target URL for scraping
 */
const ScraperUrlSchema = z.object({
  url: z
    .string()
    .url("Must be a valid HTTP(S) URL")
    .max(2000, "URL must be at most 2000 characters"),
});

// ─── Web Search Query Schema ───────────────────────────────────────────
/**
 * Schema for GET /api/search query parameters
 * Validates search query and optional max results
 */
const WebSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Search query is required")
    .max(200, "Search query must be at most 200 characters")
    .refine(
      (query) => !/[\x00-\x1F\x7F]/.test(query),
      "Search query contains invalid control characters",
    ),

  max: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), "max must be a number")
    .refine((val) => val >= 1 && val <= 20, "max must be between 1 and 20")
    .optional()
    .default("10"),
});

// ─── Image Generation Schema ───────────────────────────────────────────
/**
 * Schema for GET /api/image query parameters
 * Validates image generation request parameters
 */
const ImageGenerationSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "Prompt is required")
    .max(1000, "Prompt must be at most 1000 characters")
    .refine(
      (prompt) => !/[\x00-\x1F\x7F]/.test(prompt),
      "Prompt contains invalid control characters",
    ),

  size: z
    .enum(["1024x1024", "1024x1792", "1792x1024"])
    .optional()
    .default("1024x1024"),

  quality: z.enum(["standard", "hd"]).optional().default("standard"),
});

// ─── Sentiment Analysis Schema ────────────────────────────────────────
/**
 * Schema for sentiment analysis endpoint
 * Validates text input for sentiment analysis
 */
const SentimentAnalysisSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Text is required")
    .max(5000, "Text must be at most 5000 characters"),
});

// ─── Code Execution Schema ──────────────────────────────────────────────
/**
 * Schema for code execution endpoint
 * Validates code and execution parameters
 */
const CodeExecutionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(10000, "Code must be at most 10000 characters"),

  language: z
    .enum(["python", "javascript", "bash"])
    .optional()
    .default("python"),

  timeout: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), "timeout must be a number")
    .refine(
      (val) => val > 0 && val <= 30000,
      "timeout must be between 1 and 30000 ms",
    )
    .optional()
    .default("5000"),
});

// ─── Quick Register Schema ────────────────────────────────────────────
/**
 * Schema for POST /quick-register
 * Minimal registration: url + price + ownerAddress, name optional (auto-derived)
 */
const QuickRegisterSchema = z.object({
  url: z
    .string()
    .url("Must be a valid HTTP(S) URL")
    .max(500, "Service URL must be at most 500 characters"),
  price: z
    .number()
    .min(0.001, "Price must be at least 0.001 USDC")
    .max(1000, "Price must be at most 1000 USDC"),
  ownerAddress: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "Owner address must be a valid Ethereum address (0x followed by 40 hex characters)",
    ),
  name: z
    .string()
    .trim()
    .max(200, "Service name must be at most 200 characters")
    .optional(),
  logo_url: z.string().url().max(500).optional().nullable(),
  alert_webhook_url: z.string().url().max(500).optional().nullable(),
});

// ─── Service Update Schema ────────────────────────────────────────────
/**
 * Schema for PATCH /api/services/:id
 * Only editable fields — url and owner_address are immutable.
 * At least one field must be provided.
 */
const ServiceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    price_usdc: z.number().min(0).max(1000).optional(),
    tags: z.array(z.string().max(50)).max(10).optional(),
    required_parameters: z
      .object({
        properties: z.record(z.any()).optional(),
        required: z.array(z.string().max(100)).max(50).optional(),
      })
      .optional()
      .nullable(),
    logo_url: z.string().url().max(500).optional().nullable(),
    // Providers can rotate credentials (pass raw JSON matching ServiceCredentialsSchema)
    encrypted_credentials: z.string().max(10000).optional().nullable(),
    credential_type: z.enum(["header", "bearer", "basic", "query"]).optional(),
    // Providers can change the upstream endpoint URL after registration
    endpoint_url: z
      .string()
      .url("Must be a valid HTTP(S) URL")
      .max(500, "Service URL must be at most 500 characters")
      .optional(),
    // Fix 3: allow updating monitoring webhook URL
    alert_webhook_url: z.string().url().max(500).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// ─── Batch Register Schema ────────────────────────────────────────────
/**
 * Schema for POST /batch-register
 * Validates bulk service registration with wallet signature
 */
const BatchRegisterSchema = z.object({
  services: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        url: z.string().url().max(500),
        price: z.number().min(0.001).max(1000),
        description: z.string().trim().max(1000).optional().default(""),
        tags: z.array(z.string().max(50)).max(10).optional().default([]),
        required_parameters: z
          .object({
            properties: z.record(z.any()).optional(),
            required: z.array(z.string().max(100)).max(50).optional(),
          })
          .optional()
          .nullable(),
        logo_url: z.string().url().max(500).optional().nullable(),
        alert_webhook_url: z.string().url().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string(),
  timestamp: z.number(),
});

// ─── OpenAPI Import Schema ────────────────────────────────────────────
/**
 * Schema for POST /api/import-openapi
 * Validates bulk service import from an OpenAPI/Swagger specification
 */
const OpenAPIImportSchema = z.object({
  specUrl: z.string().url().max(2000).optional(),
  ownerAddress: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "Owner address must be a valid Ethereum address",
    ),
  defaultPrice: z
    .number()
    .min(0.001, "Price must be at least 0.001 USDC")
    .max(1000, "Price must be at most 1000 USDC"),
  signature: z.string(),
  timestamp: z.number(),
  priceOverrides: z
    .record(z.string(), z.number().min(0.001).max(1000))
    .optional(),
  excludePaths: z.array(z.string()).max(100).optional(),
  defaultTags: z.array(z.string().max(50)).max(10).optional(),
  baseUrl: z.string().url().max(500).optional(),
  mode: z.enum(["import", "sync"]).optional().default("import"),
});

// ─── Service Credentials Schemas ─────────────────────────────────────
/**
 * Schema for a single credential item.
 * location overrides creds.type when injecting (e.g. a bearer auth that also
 * needs a custom header alongside it).
 */
const CredentialItemSchema = z.object({
  key: z.string().max(200),
  value: z.string().max(5000),
  location: z.enum(["header", "bearer", "basic", "query"]).optional(),
});

/**
 * Schema for the credentials block accepted at registration time.
 * Encrypted at rest — never returned in API responses.
 */
const ServiceCredentialsSchema = z.object({
  type: z.enum(["header", "bearer", "basic", "query"]),
  credentials: z.array(CredentialItemSchema).min(1).max(10),
});

// ─── Payment Link Schema ──────────────────────────────────────────────
/**
 * Schema for POST /api/payment-links
 * Validates creation of a shareable paywall link
 */
const PaymentLinkSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(1000).optional().default(""),
  targetUrl: z.string().url("Must be a valid HTTP(S) URL").max(2000),
  priceUsdc: z
    .number()
    .min(0.001, "Price must be at least 0.001 USDC")
    .max(10000, "Price must be at most 10000 USDC"),
  ownerAddress: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "Owner address must be a valid Ethereum address (0x followed by 40 hex characters)",
    ),
  signature: z.string().min(1, "Signature is required"),
  timestamp: z.number().int().positive(),
  redirectAfterPayment: z.boolean().optional().default(true),
});

// ─── Export all schemas ──────────────────────────────────────────────
module.exports = {
  ServiceRegistrationSchema,
  QuickRegisterSchema,
  ServiceSearchSchema,
  ScraperUrlSchema,
  WebSearchQuerySchema,
  ImageGenerationSchema,
  SentimentAnalysisSchema,
  CodeExecutionSchema,
  ServiceUpdateSchema,
  BatchRegisterSchema,
  OpenAPIImportSchema,
  PaymentLinkSchema,
  CredentialItemSchema,
  ServiceCredentialsSchema,
};
