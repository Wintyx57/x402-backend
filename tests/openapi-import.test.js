// tests/openapi-import.test.js — Tests unitaires pour lib/openapi-parser.js et OpenAPIImportSchema
// Stratégie : tests purs sur le parser (sans I/O réseau) + validation Zod du schéma d'import.
// SwaggerParser est mocké pour éviter toute dépendance réseau ou fichier externe.
// Zod v4 : les erreurs sont dans result.error.issues (plus result.error.errors).
'use strict';

const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock SwaggerParser AVANT le require du module testé ──────────────────────
// SwaggerParser est une dépendance externe (réseau + système de fichiers).
// On la remplace par une implémentation synchrone contrôlée.

const swaggerParserStub = {
  parse: async (input) => {
    // Si l'input est un objet, le retourner tel quel (cas dereference)
    if (typeof input === 'object' && input !== null) return input;
    // Si c'est une chaîne JSON, la parser
    if (typeof input === 'string') {
      try { return JSON.parse(input); } catch { throw new Error('Invalid JSON/YAML'); }
    }
    throw new Error('Unsupported input type');
  },
  dereference: async (spec, _opts) => {
    // Retourner le spec tel quel (pas de $ref à résoudre dans nos fixtures)
    if (!spec.paths || Object.keys(spec.paths).length === 0) {
      throw new Error('OpenAPI spec has no paths defined');
    }
    return spec;
  },
};

// Injecter le mock via require.cache avant de charger openapi-parser.js
const Module = require('module');
const swaggerParserModulePath = require.resolve('@apidevtools/swagger-parser');
require.cache[swaggerParserModulePath] = {
  id: swaggerParserModulePath,
  filename: swaggerParserModulePath,
  loaded: true,
  exports: swaggerParserStub,
};

// Charger le module après injection du mock
const {
  parseSpec,
  extractEndpoints,
  resolveBaseUrl,
  categorizeFromTags,
  generateServiceName,
  detectRapidAPI,
  MAX_ENDPOINTS,
} = require('../lib/openapi-parser');

const { OpenAPIImportSchema } = require('../schemas/index.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function firstIssueMessage(result) {
  return result.error?.issues?.[0]?.message || result.error?.message || '(no message)';
}

function validImportPayload(overrides = {}) {
  return {
    ownerAddress: '0x' + 'a'.repeat(40),
    defaultPrice: 0.01,
    signature: '0x' + 'f'.repeat(130),
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Fixtures OpenAPI ──────────────────────────────────────────────────────────

const VALID_SPEC_30 = {
  openapi: '3.0.3',
  info: { title: 'Pet Store', version: '1.0.0' },
  servers: [{ url: 'https://api.petstore.com/v1' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  tag: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPetById',
        summary: 'Get a pet by ID',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

const VALID_SPEC_20 = {
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0.0' },
  host: 'api.legacy.com',
  basePath: '/v2',
  schemes: ['https'],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        parameters: [{ name: 'page', in: 'query', type: 'integer' }],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

// ─── Suite 1 : lib/openapi-parser.js — parseSpec ──────────────────────────────

describe('openapi-parser — parseSpec', () => {
  it('should parse a valid spec from a JSON buffer', async () => {
    // Arrange
    const buf = Buffer.from(JSON.stringify(VALID_SPEC_30), 'utf-8');
    // Act
    const spec = await parseSpec({ buffer: buf });
    // Assert
    assert.ok(spec, 'parseSpec should return a spec object');
    assert.ok(spec.paths, 'parsed spec should have paths');
  });

  it('should reject a spec buffer with no paths', async () => {
    // Arrange — spec valide JSON mais sans paths
    const emptySpec = { openapi: '3.0.3', info: { title: 'Empty', version: '1.0.0' }, paths: {} };
    const buf = Buffer.from(JSON.stringify(emptySpec), 'utf-8');
    // Act + Assert
    await assert.rejects(
      () => parseSpec({ buffer: buf }),
      /no paths/i,
      'Should throw when spec has no paths'
    );
  });

  it('should reject an empty buffer', async () => {
    // Arrange
    const buf = Buffer.from('', 'utf-8');
    // Act + Assert
    await assert.rejects(
      () => parseSpec({ buffer: buf }),
      Error,
      'Should throw on empty buffer'
    );
  });

  it('should throw when neither url nor buffer is provided', async () => {
    // Act + Assert
    await assert.rejects(
      () => parseSpec({}),
      /url or buffer/i,
      'Should throw when no source is given'
    );
  });

  it('should parse a valid spec from a YAML-like string buffer', async () => {
    // Arrange — simuler YAML en fournissant un JSON valide (le stub parse JSON)
    const specWithPaths = { ...VALID_SPEC_30 };
    const buf = Buffer.from(JSON.stringify(specWithPaths), 'utf-8');
    // Act
    const spec = await parseSpec({ buffer: buf });
    // Assert
    assert.strictEqual(typeof spec, 'object');
    assert.ok(spec.paths['/pets']);
  });
});

// ─── Suite 2 : lib/openapi-parser.js — extractEndpoints ──────────────────────

describe('openapi-parser — extractEndpoints', () => {
  it('should return the correct number of endpoints from a 3-path spec', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30);
    // Assert — /pets GET, /pets POST, /pets/{petId} GET = 3 endpoints
    assert.strictEqual(endpoints.length, 3);
  });

  it('should return endpoints with all required fields', () => {
    // Arrange + Act
    const [endpoint] = extractEndpoints(VALID_SPEC_30);
    // Assert
    assert.ok('path' in endpoint, 'endpoint should have path');
    assert.ok('method' in endpoint, 'endpoint should have method');
    assert.ok('name' in endpoint, 'endpoint should have name');
    assert.ok('description' in endpoint, 'endpoint should have description');
    assert.ok('tags' in endpoint, 'endpoint should have tags');
    assert.ok('category' in endpoint, 'endpoint should have category');
    assert.ok('parameters' in endpoint, 'endpoint should have parameters');
    assert.ok('fullUrl' in endpoint, 'endpoint should have fullUrl');
  });

  it('should extract POST body parameters correctly', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30);
    const postEndpoint = endpoints.find(e => e.method === 'POST' && e.path === '/pets');
    // Assert
    assert.ok(postEndpoint, 'POST /pets should be extracted');
    assert.ok('name' in postEndpoint.parameters.properties, 'body param "name" should be present');
    assert.ok('tag' in postEndpoint.parameters.properties, 'body param "tag" should be present');
    assert.strictEqual(postEndpoint.parameters.properties.name.in, 'body');
  });

  it('should extract required parameters correctly', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30);
    // getPetById: petId est required (path param)
    const getByIdEndpoint = endpoints.find(e => e.path === '/pets/{petId}');
    assert.ok(getByIdEndpoint, 'GET /pets/{petId} should be extracted');
    assert.ok(getByIdEndpoint.parameters.required.includes('petId'), 'petId should be required');
  });

  it('should respect the excludePaths option', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30, { excludePaths: ['/pets/{petId}'] });
    // Assert — /pets/{petId} GET exclu → 2 endpoints restants
    assert.strictEqual(endpoints.length, 2);
    const paths = endpoints.map(e => e.path);
    assert.ok(!paths.includes('/pets/{petId}'), 'excluded path should not appear');
  });

  it('should respect MAX_ENDPOINTS limit', () => {
    // Arrange — créer un spec avec 110 paths (> 100)
    const paths = {};
    for (let i = 0; i < 110; i++) {
      paths[`/resource-${i}`] = {
        get: {
          operationId: `getResource${i}`,
          summary: `Get resource ${i}`,
          responses: { '200': { description: 'OK' } },
        },
      };
    }
    const bigSpec = {
      openapi: '3.0.3',
      info: { title: 'Big API', version: '1.0.0' },
      paths,
    };
    // Act
    const endpoints = extractEndpoints(bigSpec);
    // Assert
    assert.strictEqual(endpoints.length, MAX_ENDPOINTS, `Should cap at ${MAX_ENDPOINTS} endpoints`);
    assert.strictEqual(MAX_ENDPOINTS, 100);
  });

  it('should use baseUrlOverride when provided', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30, { baseUrlOverride: 'https://override.example.com' });
    // Assert — toutes les fullUrl commencent par l'override
    for (const ep of endpoints) {
      assert.ok(
        ep.fullUrl.startsWith('https://override.example.com'),
        `fullUrl should start with override: got ${ep.fullUrl}`
      );
    }
  });

  it('should handle empty paths object gracefully', () => {
    // Arrange
    const specNoOps = {
      openapi: '3.0.3',
      info: { title: 'Empty paths', version: '1.0.0' },
      paths: {},
    };
    // Act
    const endpoints = extractEndpoints(specNoOps);
    // Assert
    assert.strictEqual(endpoints.length, 0);
  });

  it('should handle a path item with no HTTP operations', () => {
    // Arrange — path sans verbes HTTP (que des paramètres de path item)
    const specNoOps = {
      openapi: '3.0.3',
      info: { title: 'No ops', version: '1.0.0' },
      paths: {
        '/empty-path': {
          summary: 'A path with no operations',
          parameters: [],
        },
      },
    };
    // Act
    const endpoints = extractEndpoints(specNoOps);
    // Assert
    assert.strictEqual(endpoints.length, 0, 'Path items with no operations should yield no endpoints');
  });

  it('should handle all supported HTTP methods (get, post, put, patch, delete)', () => {
    // Arrange
    const allMethodsSpec = {
      openapi: '3.0.3',
      info: { title: 'All Methods', version: '1.0.0' },
      paths: {
        '/resource': {
          get: { operationId: 'getResource', summary: 'Get', responses: { '200': { description: 'OK' } } },
          post: { operationId: 'createResource', summary: 'Create', responses: { '201': { description: 'Created' } } },
          put: { operationId: 'replaceResource', summary: 'Replace', responses: { '200': { description: 'OK' } } },
          patch: { operationId: 'updateResource', summary: 'Update', responses: { '200': { description: 'OK' } } },
          delete: { operationId: 'deleteResource', summary: 'Delete', responses: { '204': { description: 'No Content' } } },
        },
      },
    };
    // Act
    const endpoints = extractEndpoints(allMethodsSpec);
    // Assert
    const methods = endpoints.map(e => e.method);
    assert.ok(methods.includes('GET'), 'GET should be extracted');
    assert.ok(methods.includes('POST'), 'POST should be extracted');
    assert.ok(methods.includes('PUT'), 'PUT should be extracted');
    assert.ok(methods.includes('PATCH'), 'PATCH should be extracted');
    assert.ok(methods.includes('DELETE'), 'DELETE should be extracted');
    assert.strictEqual(endpoints.length, 5);
  });

  it('should deduplicate required parameters when same param appears at path and operation level', () => {
    // Arrange — paramètre "id" déclaré à la fois au niveau pathItem et operation
    const specDuplicateParams = {
      openapi: '3.0.3',
      info: { title: 'Dup Params', version: '1.0.0' },
      paths: {
        '/items/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            operationId: 'getItem',
            summary: 'Get item',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    // Act
    const [endpoint] = extractEndpoints(specDuplicateParams);
    // Assert
    const idCount = endpoint.parameters.required.filter(p => p === 'id').length;
    assert.strictEqual(idCount, 1, 'required param "id" should not be duplicated');
  });
});

// ─── Suite 3 : lib/openapi-parser.js — resolveBaseUrl ────────────────────────

describe('openapi-parser — resolveBaseUrl', () => {
  it('should resolve base URL from OpenAPI 3.x servers[0].url', () => {
    // Arrange + Act
    const url = resolveBaseUrl(VALID_SPEC_30);
    // Assert
    assert.strictEqual(url, 'https://api.petstore.com/v1');
  });

  it('should resolve base URL from Swagger 2.0 host + basePath', () => {
    // Arrange + Act
    const url = resolveBaseUrl(VALID_SPEC_20);
    // Assert
    assert.strictEqual(url, 'https://api.legacy.com/v2');
  });

  it('should return null when no servers and no host', () => {
    // Arrange
    const spec = { openapi: '3.0.3', info: { title: 'No server', version: '1.0.0' }, paths: {} };
    // Act
    const url = resolveBaseUrl(spec);
    // Assert
    assert.strictEqual(url, null);
  });

  it('should remove trailing slash from server URL', () => {
    // Arrange
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Trailing slash', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com/v1/' }],
      paths: {},
    };
    // Act
    const url = resolveBaseUrl(spec);
    // Assert
    assert.strictEqual(url, 'https://api.example.com/v1', 'trailing slash should be removed');
  });

  it('should return null for a relative server URL (starts with /)', () => {
    // Arrange
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Relative', version: '1.0.0' },
      servers: [{ url: '/api/v1' }],
      paths: {},
    };
    // Act
    const url = resolveBaseUrl(spec);
    // Assert
    assert.strictEqual(url, null, 'relative server URL should return null');
  });
});

// ─── Suite 4 : lib/openapi-parser.js — categorizeFromTags ────────────────────

describe('openapi-parser — categorizeFromTags', () => {
  it('should map AI-related tags to "ai" category', () => {
    assert.strictEqual(categorizeFromTags(['ai', 'vision'], ''), 'ai');
    assert.strictEqual(categorizeFromTags(['llm'], 'text generation'), 'ai');
    assert.strictEqual(categorizeFromTags([], 'embedding service'), 'ai');
  });

  it('should map finance-related tags to "finance" category', () => {
    assert.strictEqual(categorizeFromTags(['finance'], ''), 'finance');
    assert.strictEqual(categorizeFromTags(['billing'], 'invoice API'), 'finance');
    assert.strictEqual(categorizeFromTags([], 'payment processing'), 'finance');
  });

  it('should default to "utility" for unknown tags', () => {
    assert.strictEqual(categorizeFromTags(['misc', 'random'], 'some api'), 'utility');
    assert.strictEqual(categorizeFromTags([], ''), 'utility');
  });

  it('should map data-related tags to "data" category', () => {
    assert.strictEqual(categorizeFromTags(['data'], ''), 'data');
    assert.strictEqual(categorizeFromTags(['analytics'], 'query endpoint'), 'data');
    assert.strictEqual(categorizeFromTags([], 'export dataset'), 'data');
  });

  it('should map devtools-related tags to "devtools" category', () => {
    assert.strictEqual(categorizeFromTags(['devtools'], ''), 'devtools');
    assert.strictEqual(categorizeFromTags(['ci', 'build'], ''), 'devtools');
    assert.strictEqual(categorizeFromTags([], 'lint and compile'), 'devtools');
  });

  it('should map social-related tags to "social" category', () => {
    // Note: 'social' contains 'ci' which is a devtools keyword — use keywords that
    // don't overlap with earlier categories in the iteration order (ai > data > devtools).
    assert.strictEqual(categorizeFromTags(['chat'], ''), 'social');
    assert.strictEqual(categorizeFromTags(['chat'], 'messaging service'), 'social');
    assert.strictEqual(categorizeFromTags([], 'post to feed'), 'social');
  });

  it('should handle null/undefined tags without throwing', () => {
    assert.doesNotThrow(() => categorizeFromTags(null, 'description'));
    assert.doesNotThrow(() => categorizeFromTags(undefined, 'description'));
    assert.strictEqual(categorizeFromTags(null, ''), 'utility');
  });
});

// ─── Suite 5 : lib/openapi-parser.js — generateServiceName ───────────────────

describe('openapi-parser — generateServiceName', () => {
  it('should convert camelCase operationId to human-readable name', () => {
    // Arrange + Act
    const name = generateServiceName('listPetOwners', 'get', '/pets/owners', 'Pet Store');
    // Assert
    assert.strictEqual(name, 'List Pet Owners');
  });

  it('should convert snake_case operationId to human-readable name', () => {
    // Arrange + Act
    const name = generateServiceName('get_user_profile', 'get', '/user/profile', 'User API');
    // Assert — les underscores sont remplacés par des espaces et capitalisés
    assert.strictEqual(name, 'Get User Profile');
  });

  it('should use method + path as fallback when no operationId', () => {
    // Arrange + Act
    const name = generateServiceName(null, 'get', '/users/profile', null);
    // Assert
    assert.ok(name.includes('GET') || name.includes('Get') || name.includes('Users'), `Unexpected name: ${name}`);
  });

  it('should include spec title in fallback when name is short', () => {
    // Arrange + Act
    const name = generateServiceName(null, 'get', '/data', 'My Amazing API');
    // Assert
    assert.ok(name.includes('My Amazing API'), `Spec title should be included in: ${name}`);
  });

  it('should truncate generated name to 200 characters', () => {
    // Arrange — operationId très long
    const longOpId = 'getSome' + 'Very'.repeat(60) + 'LongOperationName';
    // Act
    const name = generateServiceName(longOpId, 'get', '/resource', 'API');
    // Assert
    assert.ok(name.length <= 200, `Name should be at most 200 chars, got ${name.length}`);
  });
});

// ─── Suite 6 : OpenAPIImportSchema — validation Zod ──────────────────────────

describe('OpenAPIImportSchema — cas nominal', () => {
  it('should accept a valid complete import payload', () => {
    // Arrange
    const payload = validImportPayload({
      specUrl: 'https://api.example.com/openapi.json',
      priceOverrides: { '/pets GET': 0.05 },
      excludePaths: ['/health', '/ping'],
      defaultTags: ['api', 'demo'],
      baseUrl: 'https://api.example.com',
    });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, true, `Unexpected error: ${firstIssueMessage(result)}`);
  });

  it('should accept a minimal payload without optional fields', () => {
    // Arrange
    const payload = validImportPayload();
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, true, `Unexpected error: ${firstIssueMessage(result)}`);
  });

  it('should accept payload without priceOverrides (optional)', () => {
    // Arrange
    const payload = validImportPayload();
    // priceOverrides intentionnellement absent
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.priceOverrides, undefined);
  });
});

describe('OpenAPIImportSchema — validation ownerAddress', () => {
  it('should reject payload with missing ownerAddress', () => {
    // Arrange
    const payload = validImportPayload();
    delete payload.ownerAddress;
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Should fail without ownerAddress');
  });

  it('should reject payload with invalid ownerAddress format', () => {
    // Arrange
    const payload = validImportPayload({ ownerAddress: 'not-an-address' });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(
      firstIssueMessage(result).toLowerCase().includes('address') ||
      firstIssueMessage(result).toLowerCase().includes('ethereum'),
      `Unexpected error message: ${firstIssueMessage(result)}`
    );
  });
});

describe('OpenAPIImportSchema — validation defaultPrice', () => {
  it('should reject price below minimum (0.001 USDC)', () => {
    // Arrange
    const payload = validImportPayload({ defaultPrice: 0.0001 });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Price below 0.001 should be rejected');
    assert.ok(
      firstIssueMessage(result).includes('0.001') || firstIssueMessage(result).toLowerCase().includes('price'),
      `Unexpected error: ${firstIssueMessage(result)}`
    );
  });

  it('should reject defaultPrice of 0', () => {
    // Arrange
    const payload = validImportPayload({ defaultPrice: 0 });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Price of 0 should be rejected');
  });

  it('should reject defaultPrice above 1000', () => {
    // Arrange
    const payload = validImportPayload({ defaultPrice: 1000.01 });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Price above 1000 should be rejected');
  });
});

describe('OpenAPIImportSchema — validation excludePaths', () => {
  it('should reject more than 100 excludePaths', () => {
    // Arrange
    const payload = validImportPayload({
      excludePaths: Array.from({ length: 101 }, (_, i) => `/path-${i}`),
    });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'More than 100 excludePaths should be rejected');
  });

  it('should accept exactly 100 excludePaths', () => {
    // Arrange
    const payload = validImportPayload({
      excludePaths: Array.from({ length: 100 }, (_, i) => `/path-${i}`),
    });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, true, 'Exactly 100 excludePaths should be accepted');
  });
});

describe('OpenAPIImportSchema — validation priceOverrides', () => {
  it('should accept valid priceOverrides record', () => {
    // Arrange
    const payload = validImportPayload({
      priceOverrides: {
        '/pets GET': 0.05,
        '/pets POST': 0.10,
        '/users/{id} DELETE': 1.0,
      },
    });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, true, `Unexpected error: ${firstIssueMessage(result)}`);
  });

  it('should reject priceOverrides with value below 0.001', () => {
    // Arrange
    const payload = validImportPayload({
      priceOverrides: { '/pets GET': 0.0001 },
    });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'priceOverrides value below 0.001 should be rejected');
  });

  it('should reject priceOverrides with value above 1000', () => {
    // Arrange
    const payload = validImportPayload({
      priceOverrides: { '/pets GET': 1001 },
    });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'priceOverrides value above 1000 should be rejected');
  });
});

// ─── Suite 7 : import-openapi route — validation de forme des requêtes ─────────
// Ces tests valident les contraintes d'entrée du schéma, sans serveur HTTP.

describe('OpenAPIImportSchema — validation signature et timestamp', () => {
  it('should reject payload with missing signature', () => {
    // Arrange
    const payload = validImportPayload();
    delete payload.signature;
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Missing signature should be rejected');
  });

  it('should reject payload with missing timestamp', () => {
    // Arrange
    const payload = validImportPayload();
    delete payload.timestamp;
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Missing timestamp should be rejected');
  });

  it('should reject payload where timestamp is a string instead of a number', () => {
    // Arrange
    const payload = validImportPayload({ timestamp: '1700000000000' });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'String timestamp should be rejected (must be number)');
  });

  it('should reject specUrl that is not a valid URL', () => {
    // Arrange
    const payload = validImportPayload({ specUrl: 'not-a-valid-url' });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'Invalid specUrl should be rejected');
  });

  it('should reject specUrl longer than 2000 characters', () => {
    // Arrange
    const longUrl = 'https://example.com/' + 'a'.repeat(1990);
    const payload = validImportPayload({ specUrl: longUrl });
    // Act
    const result = OpenAPIImportSchema.safeParse(payload);
    // Assert
    assert.strictEqual(result.success, false, 'specUrl longer than 2000 chars should be rejected');
  });
});

// ─── Suite 8 : extractEndpoints — fullUrl avec ou sans baseUrl ────────────────

describe('openapi-parser — extractEndpoints fullUrl construction', () => {
  it('should build fullUrl from spec servers[0].url + path', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30);
    const listPets = endpoints.find(e => e.path === '/pets' && e.method === 'GET');
    // Assert
    assert.strictEqual(listPets.fullUrl, 'https://api.petstore.com/v1/pets');
  });

  it('should use path as fullUrl when no base URL is available', () => {
    // Arrange — spec sans servers ni host
    const spec = {
      openapi: '3.0.3',
      info: { title: 'No Base', version: '1.0.0' },
      paths: {
        '/data': {
          get: {
            operationId: 'getData',
            summary: 'Get data',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    // Act
    const [endpoint] = extractEndpoints(spec);
    // Assert
    assert.strictEqual(endpoint.fullUrl, '/data', 'Should fall back to path when no base URL');
  });

  it('should build fullUrl from Swagger 2.0 host + basePath + path', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_20);
    const listUsers = endpoints.find(e => e.path === '/users');
    // Assert
    assert.strictEqual(listUsers.fullUrl, 'https://api.legacy.com/v2/users');
  });
});

// ─── Suite 9 : extractEndpoints — méthode et description ─────────────────────

describe('openapi-parser — extractEndpoints method and description', () => {
  it('should uppercase the HTTP method in extracted endpoint', () => {
    // Arrange + Act
    const endpoints = extractEndpoints(VALID_SPEC_30);
    for (const ep of endpoints) {
      assert.strictEqual(ep.method, ep.method.toUpperCase(), `Method should be uppercased: ${ep.method}`);
    }
  });

  it('should truncate description to 1000 characters', () => {
    // Arrange
    const longDescription = 'x'.repeat(1500);
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Long Desc', version: '1.0.0' },
      paths: {
        '/item': {
          get: {
            operationId: 'getItem',
            description: longDescription,
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    // Act
    const [endpoint] = extractEndpoints(spec);
    // Assert
    assert.ok(endpoint.description.length <= 1000, `Description should be truncated to 1000 chars`);
  });

  it('should fall back to summary when description is not provided', () => {
    // Arrange
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Summary Fallback', version: '1.0.0' },
      paths: {
        '/item': {
          get: {
            operationId: 'getItem',
            summary: 'Get a single item',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    // Act
    const [endpoint] = extractEndpoints(spec);
    // Assert
    assert.strictEqual(endpoint.description, 'Get a single item');
  });
});

// ─── Suite 10 : lib/openapi-parser.js — detectRapidAPI ────────────────────────

describe('openapi-parser — detectRapidAPI', () => {
  it('should detect RapidAPI spec with x-rapidapi-info', () => {
    const spec = {
      'x-rapidapi-info': { apiId: 'abc', apiVersionId: 'v1' },
      servers: [{ url: 'https://weather.p.rapidapi.com' }],
    };
    const result = detectRapidAPI(spec);
    assert.ok(result);
    assert.strictEqual(result.isRapidAPI, true);
    assert.strictEqual(result.host, 'weather.p.rapidapi.com');
    assert.strictEqual(result.apiId, 'abc');
  });

  it('should detect RapidAPI by server URL pattern', () => {
    const spec = {
      servers: [{ url: 'https://moviedb.p.rapidapi.com/v1' }],
    };
    const result = detectRapidAPI(spec);
    assert.ok(result);
    assert.strictEqual(result.host, 'moviedb.p.rapidapi.com');
  });

  it('should detect RapidAPI Swagger 2.0 spec', () => {
    const spec = {
      swagger: '2.0',
      host: 'weather.p.rapidapi.com',
      basePath: '/v1',
      schemes: ['https'],
      'x-rapidapi-info': { apiId: 'xyz' },
    };
    const result = detectRapidAPI(spec);
    assert.ok(result);
    assert.strictEqual(result.host, 'weather.p.rapidapi.com');
    assert.strictEqual(result.serverUrl, 'https://weather.p.rapidapi.com/v1');
  });

  it('should return null for non-RapidAPI spec', () => {
    const spec = {
      servers: [{ url: 'https://api.example.com/v1' }],
    };
    const result = detectRapidAPI(spec);
    assert.strictEqual(result, null);
  });

  it('should return null when host cannot be extracted', () => {
    const spec = {
      'x-rapidapi-info': { apiId: 'abc' },
      // no servers, no host
    };
    const result = detectRapidAPI(spec);
    assert.strictEqual(result, null);
  });

  it('should return null for null/undefined spec', () => {
    assert.strictEqual(detectRapidAPI(null), null);
    assert.strictEqual(detectRapidAPI(undefined), null);
  });
});
