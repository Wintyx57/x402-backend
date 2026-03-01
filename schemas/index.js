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

// ─── Export all schemas ──────────────────────────────────────────────
module.exports = {
  ServiceRegistrationSchema,
  APICallSchema,
  ServiceSearchSchema,
  PaymentTransactionSchema,
};
