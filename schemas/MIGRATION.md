# Zod Migration Guide for x402 Backend

## Overview

This guide explains how to migrate API endpoints from manual validation to Zod schema-based validation. The migration provides type safety, better error messages, and consistent validation across the API.

## Current Status

✅ **Phase 1 (Completed)**
- [x] ESLint configuration (eslint.config.js)
- [x] Created schemas directory (/schemas)
- [x] Implemented core validation schemas:
  - ServiceRegistrationSchema (for POST /register)
  - APICallSchema (for API calls with parameters)
  - ServiceSearchSchema (for GET /search)
  - PaymentTransactionSchema (for payment tracking)
- [x] Migrated POST /register endpoint to use Zod validation

## How to Use Zod Schemas

### Basic Usage

```javascript
const { ServiceRegistrationSchema } = require('../schemas');

// Validate data
try {
  const validatedData = ServiceRegistrationSchema.parse(req.body);
  // Data is now typed and validated
  console.log(validatedData.name); // string, guaranteed non-empty, max 200 chars
} catch (zodError) {
  // Handle validation errors
  const errors = zodError.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
  }));
  res.status(400).json({ error: 'Validation failed', details: errors });
}
```

### Safe Parsing

Use `.safeParse()` if you prefer to handle errors manually:

```javascript
const result = ServiceRegistrationSchema.safeParse(req.body);

if (!result.success) {
  // Handle error
  console.log(result.error);
} else {
  // Use result.data
  console.log(result.data.name);
}
```

## Available Schemas

### ServiceRegistrationSchema

Used for: `POST /register`

```javascript
{
  name: string (1-200 chars)
  url: string (valid HTTPS URL, max 500 chars)
  price: number (0-1000)
  ownerAddress: string (Ethereum wallet 0x...)
  description?: string (optional, max 1000 chars)
  tags?: string[] (optional, max 10 tags, 50 chars each)
}
```

### APICallSchema

Used for: API calls with parameters

```javascript
{
  serviceId?: string (UUID format)
  params?: object (any parameters)
  timeout?: number (100-60000ms, default 10000)
  retries?: number (0-5, default 0)
}
```

### ServiceSearchSchema

Used for: `GET /search?q=...`

```javascript
{
  q: string (1-100 chars, no control characters)
}
```

### PaymentTransactionSchema

Used for: Payment transaction logging

```javascript
{
  amount: number (positive)
  usdc?: boolean (default true)
  gasPrice?: number (optional)
  txHash?: string (0x + 64 hex chars, optional)
  chain?: 'base' | 'skale' | 'ethereum' (default 'base')
}
```

## Migration Checklist for Remaining Endpoints

The following endpoints should be migrated next (prioritized by frequency):

- [ ] GET /search → Use ServiceSearchSchema
- [ ] POST /api/call → Create EndpointCallSchema
- [ ] GET /services → Add pagination schema
- [ ] POST /api/payment → Use PaymentTransactionSchema
- [ ] All /wrappers/* routes → Create individual schemas per wrapper

## Error Handling Best Practices

Always provide clear error messages to API clients:

```javascript
try {
  const data = ServiceRegistrationSchema.parse(req.body);
  // Process data
} catch (zodError) {
  const errors = zodError.errors.map(err => ({
    field: err.path.join('.') || 'root',
    message: err.message,
    code: err.code, // 'invalid_type', 'too_small', etc.
  }));

  res.status(400).json({
    error: 'Validation failed',
    details: errors,
    timestamp: new Date().toISOString(),
  });
}
```

## Testing Zod Schemas

Example test for ServiceRegistrationSchema:

```javascript
const { ServiceRegistrationSchema } = require('../schemas');

// Valid data
const valid = {
  name: 'Weather API',
  url: 'https://api.weather.example.com',
  price: 0.10,
  ownerAddress: '0x742d35Cc6634C0532925a3b844Bc927e38a3e42B',
};

const result = ServiceRegistrationSchema.safeParse(valid);
console.log(result.success); // true

// Invalid data
const invalid = {
  name: 'A'.repeat(201), // Too long
  url: 'not-a-url',
  price: -5,
  ownerAddress: 'invalid',
};

const result2 = ServiceRegistrationSchema.safeParse(invalid);
console.log(result2.success); // false
console.log(result2.error.errors.length); // Multiple errors
```

## Performance Considerations

- Zod validation is fast and suitable for high-frequency endpoints
- Validation errors are caught before database queries
- All schemas are pre-compiled for efficiency
- Consider adding caching for validated data if needed

## Future Improvements

1. **Request/Response Middleware**: Create Express middleware wrapper
2. **OpenAPI Integration**: Auto-generate OpenAPI docs from Zod schemas
3. **Custom Error Messages**: Add i18n for error messages (FR/EN)
4. **Schema Composition**: Reuse common field definitions
5. **Refined Types**: Extract TypeScript types from schemas for IDE support

## Files Modified

- `/routes/register.js` - Now uses ServiceRegistrationSchema for validation
- `/schemas/index.js` - Main schemas file (NEW)
- `/eslint.config.js` - ESLint configuration (NEW)
- `/package.json` - Added lint scripts

## Running the Linter

```bash
npm run lint       # Check for issues
npm run lint:fix   # Auto-fix issues
```

Current status: **0 errors, 46 warnings** (warnings are mostly unused variables in test files)
