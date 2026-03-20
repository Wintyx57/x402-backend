// lib/openapi-parser.js — OpenAPI spec parser for bulk import
const SwaggerParser = require('@apidevtools/swagger-parser');

const MAX_ENDPOINTS = 100;

const CATEGORY_KEYWORDS = {
  ai: ['ai', 'ml', 'model', 'predict', 'inference', 'gpt', 'llm', 'embedding', 'neural', 'classify'],
  data: ['data', 'database', 'analytics', 'query', 'dataset', 'csv', 'export', 'import'],
  devtools: ['dev', 'tool', 'build', 'ci', 'deploy', 'lint', 'test', 'debug', 'compile'],
  social: ['social', 'chat', 'message', 'post', 'feed', 'comment', 'notification'],
  finance: ['finance', 'payment', 'trade', 'price', 'invoice', 'billing', 'transaction', 'exchange'],
};

/**
 * Parse an OpenAPI spec from URL or buffer.
 * @param {{ url?: string, buffer?: Buffer, filename?: string }} source
 * @returns {Promise<object>} Dereferenced spec object
 */
async function parseSpec(source) {
  let spec;
  if (source.url) {
    // Parse from URL — but disable remote $ref resolution for SSRF safety
    spec = await SwaggerParser.parse(source.url);
  } else if (source.buffer) {
    const content = source.buffer.toString('utf-8');
    // Try JSON first, then YAML
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // swagger-parser handles YAML natively
      parsed = await SwaggerParser.parse(content);
    }
    spec = parsed;
  } else {
    throw new Error('Either url or buffer must be provided');
  }

  // Dereference with remote $ref resolution DISABLED (SSRF prevention)
  const dereferenced = await SwaggerParser.dereference(spec, {
    resolve: { http: false },
  });

  // Validate that it has paths
  if (!dereferenced.paths || Object.keys(dereferenced.paths).length === 0) {
    throw new Error('OpenAPI spec has no paths defined');
  }

  return dereferenced;
}

/**
 * Resolve the base URL from an OpenAPI spec.
 */
function resolveBaseUrl(spec) {
  // OpenAPI 3.x
  if (spec.servers && spec.servers.length > 0) {
    let url = spec.servers[0].url;
    // Handle relative URLs
    if (url.startsWith('/')) return null;
    // Remove trailing slash
    return url.replace(/\/$/, '');
  }
  // Swagger 2.0
  if (spec.host) {
    const scheme = (spec.schemes && spec.schemes[0]) || 'https';
    const basePath = spec.basePath || '';
    return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, '');
  }
  return null;
}

/**
 * Auto-categorize based on tags and description.
 */
function categorizeFromTags(tags, description) {
  const text = [...(tags || []), description || ''].join(' ').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      return category;
    }
  }
  return 'utility';
}

/**
 * Generate a human-readable service name.
 */
function generateServiceName(operationId, method, path, specTitle) {
  if (operationId) {
    // Convert camelCase/snake_case to human-readable
    return operationId
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .slice(0, 200);
  }
  // Fallback: "GET /users/{id}" → "Get Users Id"
  const pathName = path
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
  const name = `${method.toUpperCase()} ${pathName}`.trim();
  if (specTitle && name.length < 150) {
    return `${specTitle} — ${name}`.slice(0, 200);
  }
  return name.slice(0, 200);
}

/**
 * Extract endpoints from a dereferenced spec.
 * @param {object} spec - Dereferenced OpenAPI spec
 * @param {{ excludePaths?: string[], baseUrlOverride?: string }} options
 * @returns {Array} Array of endpoint objects
 */
function extractEndpoints(spec, options = {}) {
  const { excludePaths = [], baseUrlOverride } = options;
  const baseUrl = baseUrlOverride || resolveBaseUrl(spec);
  const specTitle = spec.info?.title || '';
  const endpoints = [];
  const excludeSet = new Set(excludePaths);

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    if (excludeSet.has(path)) continue;

    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem[method];
      if (!operation) continue;

      const tags = operation.tags || pathItem.tags || [];
      const description = operation.description || operation.summary || '';
      const name = generateServiceName(operation.operationId, method, path, specTitle);
      const category = categorizeFromTags(tags, description);

      // Extract parameters
      const allParams = [...(pathItem.parameters || []), ...(operation.parameters || [])];
      const requiredParams = allParams.filter(p => p.required).map(p => p.name);
      const paramProperties = {};
      for (const p of allParams) {
        paramProperties[p.name] = {
          type: p.schema?.type || 'string',
          description: p.description || '',
          required: !!p.required,
          in: p.in,
        };
      }

      // Also extract request body params (for POST/PUT/PATCH)
      if (operation.requestBody?.content) {
        const jsonContent = operation.requestBody.content['application/json'];
        if (jsonContent?.schema?.properties) {
          for (const [propName, propSchema] of Object.entries(jsonContent.schema.properties)) {
            paramProperties[propName] = {
              type: propSchema.type || 'string',
              description: propSchema.description || '',
              required: (jsonContent.schema.required || []).includes(propName),
              in: 'body',
            };
            if ((jsonContent.schema.required || []).includes(propName)) {
              requiredParams.push(propName);
            }
          }
        }
      }

      const fullUrl = baseUrl ? `${baseUrl}${path}` : path;

      endpoints.push({
        path,
        method: method.toUpperCase(),
        name,
        description: description.slice(0, 1000),
        tags,
        category,
        parameters: {
          required: [...new Set(requiredParams)],
          properties: paramProperties,
        },
        fullUrl,
      });

      if (endpoints.length >= MAX_ENDPOINTS) {
        return endpoints;
      }
    }
  }

  return endpoints;
}

module.exports = {
  parseSpec,
  resolveBaseUrl,
  categorizeFromTags,
  generateServiceName,
  extractEndpoints,
  MAX_ENDPOINTS,
};
