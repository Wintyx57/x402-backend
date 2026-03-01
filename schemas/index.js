// schemas/index.js — Zod validation schemas for x402 API endpoints
const { z } = require('zod');

// ─── Service Registration Schema ───────────────────────────────────────
/**
 * Schema for POST /register
 * Validates service registration with name, url, description, price, and tags
 */
const ServiceRegistrationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Service name is required')
    .max(200, 'Service name must be at most 200 characters'),

  url: z
    .string()
    .url('Must be a valid HTTP(S) URL')
    .max(500, 'Service URL must be at most 500 characters'),

  price: z
    .number()
    .min(0, 'Price must be at least 0')
    .max(1000, 'Price must be at most 1000 USDC'),

  ownerAddress: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      'Owner address must be a valid Ethereum address (0x followed by 40 hex characters)'
    ),

  description: z
    .string()
    .trim()
    .max(1000, 'Description must be at most 1000 characters')
    .optional()
    .default(''),

  tags: z
    .array(z.string().max(50, 'Each tag must be at most 50 characters'))
    .max(10, 'Maximum 10 tags allowed')
    .optional()
    .default([]),
});

// ─── API Call Validation Schema ───────────────────────────────────────
/**
 * Schema for API call validation
 * Used when agents call wrapped endpoints with parameters
 */
const APICallSchema = z.object({
  serviceId: z
    .string()
    .uuid('Invalid service ID')
    .optional(),

  params: z
    .record(z.unknown())
    .optional()
    .default({}),

  timeout: z
    .number()
    .int('Timeout must be an integer')
    .min(100, 'Timeout must be at least 100ms')
    .max(60000, 'Timeout must be at most 60 seconds')
    .optional()
    .default(10000),

  retries: z
    .number()
    .int('Retries must be an integer')
    .min(0, 'Retries must be at least 0')
    .max(5, 'Retries must be at most 5')
    .optional()
    .default(0),
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
    .min(1, 'Search query is required')
    .max(100, 'Search query must be at most 100 characters')
    .refine(
      (query) => !/[\x00-\x1F\x7F]/.test(query),
      'Search query contains invalid control characters'
    ),
});

// ─── Service List Query Schema ─────────────────────────────────────────
/**
 * Schema for GET /api/services query parameters with filters
 * Validates filtering and pagination parameters
 */
const ServiceListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100, 'Search query must be at most 100 characters')
    .optional(),

  chain: z
    .enum(['base', 'skale', 'ethereum', 'optimism', 'arbitrum'])
    .optional(),

  category: z
    .string()
    .trim()
    .max(50, 'Category must be at most 50 characters')
    .optional(),

  free: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),

  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), 'limit must be a number')
    .refine((val) => val > 0 && val <= 100, 'limit must be between 1 and 100')
    .optional()
    .default('20'),

  offset: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), 'offset must be a number')
    .refine((val) => val >= 0, 'offset must be at least 0')
    .optional()
    .default('0'),
});

// ─── Payment Transaction Schema ──────────────────────────────────────
/**
 * Schema for payment transaction data
 * Used for logging and tracking payments
 */
const PaymentTransactionSchema = z.object({
  amount: z
    .number()
    .positive('Amount must be positive'),

  usdc: z
    .boolean()
    .default(true),

  gasPrice: z
    .number()
    .optional(),

  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash')
    .optional(),

  chain: z
    .enum(['base', 'skale', 'ethereum'])
    .optional()
    .default('base'),
});

// ─── Web Scraper URL Schema ────────────────────────────────────────────
/**
 * Schema for GET /api/scrape query parameter
 * Validates the target URL for scraping
 */
const ScraperUrlSchema = z.object({
  url: z
    .string()
    .url('Must be a valid HTTP(S) URL')
    .max(2000, 'URL must be at most 2000 characters'),
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
    .min(1, 'Search query is required')
    .max(200, 'Search query must be at most 200 characters')
    .refine(
      (query) => !/[\x00-\x1F\x7F]/.test(query),
      'Search query contains invalid control characters'
    ),

  max: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), 'max must be a number')
    .refine((val) => val >= 1 && val <= 20, 'max must be between 1 and 20')
    .optional()
    .default('10'),
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
    .min(1, 'Prompt is required')
    .max(1000, 'Prompt must be at most 1000 characters')
    .refine(
      (prompt) => !/[\x00-\x1F\x7F]/.test(prompt),
      'Prompt contains invalid control characters'
    ),

  size: z
    .enum(['1024x1024', '1024x1792', '1792x1024'])
    .optional()
    .default('1024x1024'),

  quality: z
    .enum(['standard', 'hd'])
    .optional()
    .default('standard'),
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
    .min(1, 'Text is required')
    .max(5000, 'Text must be at most 5000 characters'),
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
    .min(1, 'Code is required')
    .max(10000, 'Code must be at most 10000 characters'),

  language: z
    .enum(['python', 'javascript', 'bash'])
    .optional()
    .default('python'),

  timeout: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), 'timeout must be a number')
    .refine((val) => val > 0 && val <= 30000, 'timeout must be between 1 and 30000 ms')
    .optional()
    .default('5000'),
});

// ─── Export all schemas ──────────────────────────────────────────────
module.exports = {
  ServiceRegistrationSchema,
  APICallSchema,
  ServiceSearchSchema,
  ServiceListQuerySchema,
  ScraperUrlSchema,
  WebSearchQuerySchema,
  ImageGenerationSchema,
  SentimentAnalysisSchema,
  CodeExecutionSchema,
  PaymentTransactionSchema,
};
