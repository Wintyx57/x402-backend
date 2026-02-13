// tests/register-validation.test.js — Unit tests for validation logic in routes/register.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// --- Validation patterns from routes/register.js ---
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const URL_REGEX = /^https?:\/\/.+/;

// --- Validation functions replicated from the route handler ---
function validateRegisterInput(body) {
    const { name, description, url, price, tags, ownerAddress } = body;
    const errors = [];

    // Required fields
    if (!name || !url || price === undefined || price === null || !ownerAddress) {
        return { valid: false, error: 'Champs requis manquants' };
    }

    // Name validation
    if (typeof name !== 'string' || name.length > 200) {
        return { valid: false, error: 'name must be a string (max 200 chars)' };
    }

    // URL validation
    if (typeof url !== 'string' || !URL_REGEX.test(url) || url.length > 500) {
        return { valid: false, error: 'url must be a valid HTTP(S) URL (max 500 chars)' };
    }

    // Price validation
    if (typeof price !== 'number' || price < 0 || price > 1000) {
        return { valid: false, error: 'price must be a number between 0 and 1000' };
    }

    // Owner address validation
    if (typeof ownerAddress !== 'string' || !WALLET_REGEX.test(ownerAddress)) {
        return { valid: false, error: 'ownerAddress must be a valid Ethereum address (0x...)' };
    }

    // Optional: description
    if (description && (typeof description !== 'string' || description.length > 1000)) {
        return { valid: false, error: 'description must be a string (max 1000 chars)' };
    }

    // Optional: tags
    if (tags && (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== 'string' || t.length > 50))) {
        return { valid: false, error: 'tags must be an array of strings (max 10 tags, 50 chars each)' };
    }

    return { valid: true };
}

describe('register validation — required fields', () => {
    const validBody = {
        name: 'Test Service',
        url: 'https://example.com/api',
        price: 0.05,
        ownerAddress: '0x' + 'a'.repeat(40),
    };

    it('should accept valid input with all required fields', () => {
        const result = validateRegisterInput(validBody);
        assert.ok(result.valid);
    });

    it('should reject missing name', () => {
        const body = { ...validBody, name: undefined };
        assert.ok(!validateRegisterInput(body).valid);
    });

    it('should reject empty name', () => {
        const body = { ...validBody, name: '' };
        assert.ok(!validateRegisterInput(body).valid);
    });

    it('should reject missing url', () => {
        const body = { ...validBody, url: undefined };
        assert.ok(!validateRegisterInput(body).valid);
    });

    it('should reject missing price', () => {
        const body = { ...validBody, price: undefined };
        assert.ok(!validateRegisterInput(body).valid);
    });

    it('should reject null price', () => {
        const body = { ...validBody, price: null };
        assert.ok(!validateRegisterInput(body).valid);
    });

    it('should reject missing ownerAddress', () => {
        const body = { ...validBody, ownerAddress: undefined };
        assert.ok(!validateRegisterInput(body).valid);
    });
});

describe('register validation — name', () => {
    const baseBody = {
        url: 'https://example.com',
        price: 0.05,
        ownerAddress: '0x' + 'a'.repeat(40),
    };

    it('should accept short name', () => {
        assert.ok(validateRegisterInput({ ...baseBody, name: 'A' }).valid);
    });

    it('should accept name with 200 chars', () => {
        assert.ok(validateRegisterInput({ ...baseBody, name: 'a'.repeat(200) }).valid);
    });

    it('should reject name with 201 chars', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, name: 'a'.repeat(201) }).valid);
    });

    it('should reject non-string name (number)', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, name: 42 }).valid);
    });

    it('should reject non-string name (object)', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, name: {} }).valid);
    });

    it('should reject non-string name (array)', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, name: ['test'] }).valid);
    });
});

describe('register validation — url', () => {
    const baseBody = {
        name: 'Test',
        price: 0.05,
        ownerAddress: '0x' + 'a'.repeat(40),
    };

    it('should accept https URL', () => {
        assert.ok(validateRegisterInput({ ...baseBody, url: 'https://example.com' }).valid);
    });

    it('should accept http URL', () => {
        assert.ok(validateRegisterInput({ ...baseBody, url: 'http://localhost:3000' }).valid);
    });

    it('should accept URL with path', () => {
        assert.ok(validateRegisterInput({ ...baseBody, url: 'https://api.example.com/v1/endpoint' }).valid);
    });

    it('should accept URL with query params', () => {
        assert.ok(validateRegisterInput({ ...baseBody, url: 'https://example.com/api?key=value' }).valid);
    });

    it('should accept URL with 500 chars', () => {
        const longUrl = 'https://example.com/' + 'a'.repeat(480);
        assert.equal(longUrl.length, 500);
        assert.ok(validateRegisterInput({ ...baseBody, url: longUrl }).valid);
    });

    it('should reject URL with 501 chars', () => {
        const longUrl = 'https://example.com/' + 'a'.repeat(481);
        assert.equal(longUrl.length, 501);
        assert.ok(!validateRegisterInput({ ...baseBody, url: longUrl }).valid);
    });

    it('should reject ftp URL', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, url: 'ftp://example.com' }).valid);
    });

    it('should reject URL without protocol', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, url: 'example.com' }).valid);
    });

    it('should reject javascript URL (XSS)', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, url: 'javascript:alert(1)' }).valid);
    });

    it('should reject non-string url', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, url: 42 }).valid);
    });
});

describe('register validation — price', () => {
    const baseBody = {
        name: 'Test',
        url: 'https://example.com',
        ownerAddress: '0x' + 'a'.repeat(40),
    };

    it('should accept price of 0', () => {
        assert.ok(validateRegisterInput({ ...baseBody, price: 0 }).valid);
    });

    it('should accept price of 0.001', () => {
        assert.ok(validateRegisterInput({ ...baseBody, price: 0.001 }).valid);
    });

    it('should accept price of 1', () => {
        assert.ok(validateRegisterInput({ ...baseBody, price: 1 }).valid);
    });

    it('should accept price of 999.99', () => {
        assert.ok(validateRegisterInput({ ...baseBody, price: 999.99 }).valid);
    });

    it('should accept price of 1000', () => {
        assert.ok(validateRegisterInput({ ...baseBody, price: 1000 }).valid);
    });

    it('should reject price above 1000', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, price: 1001 }).valid);
    });

    it('should reject negative price', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, price: -1 }).valid);
    });

    it('should reject string price', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, price: '0.05' }).valid);
    });

    it('NaN passes typeof check but fails comparison (known JS quirk)', () => {
        // typeof NaN === 'number', and NaN < 0 is false, NaN > 1000 is false
        // So NaN passes the current validation — documenting this behavior
        const result = validateRegisterInput({ ...baseBody, price: NaN });
        assert.ok(result.valid, 'NaN passes current validation (JS quirk: NaN comparisons are always false)');
    });

    it('should reject Infinity price', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, price: Infinity }).valid);
    });
});

describe('register validation — ownerAddress', () => {
    const baseBody = {
        name: 'Test',
        url: 'https://example.com',
        price: 0.05,
    };

    it('should accept valid lowercase address', () => {
        assert.ok(validateRegisterInput({ ...baseBody, ownerAddress: '0x' + 'a'.repeat(40) }).valid);
    });

    it('should accept valid uppercase address', () => {
        assert.ok(validateRegisterInput({ ...baseBody, ownerAddress: '0x' + 'A'.repeat(40) }).valid);
    });

    it('should accept valid mixed-case address', () => {
        assert.ok(validateRegisterInput({ ...baseBody, ownerAddress: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430' }).valid);
    });

    it('should reject address without 0x prefix', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, ownerAddress: 'a'.repeat(40) }).valid);
    });

    it('should reject address too short', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, ownerAddress: '0x' + 'a'.repeat(39) }).valid);
    });

    it('should reject address too long', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, ownerAddress: '0x' + 'a'.repeat(41) }).valid);
    });

    it('should reject address with non-hex chars', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, ownerAddress: '0x' + 'g'.repeat(40) }).valid);
    });

    it('should reject non-string address', () => {
        assert.ok(!validateRegisterInput({ ...baseBody, ownerAddress: 12345 }).valid);
    });
});

describe('register validation — description (optional)', () => {
    const validBody = {
        name: 'Test',
        url: 'https://example.com',
        price: 0.05,
        ownerAddress: '0x' + 'a'.repeat(40),
    };

    it('should accept without description', () => {
        assert.ok(validateRegisterInput(validBody).valid);
    });

    it('should accept empty description (falsy → skipped)', () => {
        assert.ok(validateRegisterInput({ ...validBody, description: '' }).valid);
    });

    it('should accept valid description', () => {
        assert.ok(validateRegisterInput({ ...validBody, description: 'My great service' }).valid);
    });

    it('should accept description with 1000 chars', () => {
        assert.ok(validateRegisterInput({ ...validBody, description: 'a'.repeat(1000) }).valid);
    });

    it('should reject description with 1001 chars', () => {
        assert.ok(!validateRegisterInput({ ...validBody, description: 'a'.repeat(1001) }).valid);
    });

    it('should reject non-string description', () => {
        assert.ok(!validateRegisterInput({ ...validBody, description: 42 }).valid);
    });
});

describe('register validation — tags (optional)', () => {
    const validBody = {
        name: 'Test',
        url: 'https://example.com',
        price: 0.05,
        ownerAddress: '0x' + 'a'.repeat(40),
    };

    it('should accept without tags', () => {
        assert.ok(validateRegisterInput(validBody).valid);
    });

    it('should accept empty array', () => {
        assert.ok(validateRegisterInput({ ...validBody, tags: [] }).valid);
    });

    it('should accept valid tags', () => {
        assert.ok(validateRegisterInput({ ...validBody, tags: ['ai', 'weather', 'api'] }).valid);
    });

    it('should accept up to 10 tags', () => {
        const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
        assert.ok(validateRegisterInput({ ...validBody, tags }).valid);
    });

    it('should reject more than 10 tags', () => {
        const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
        assert.ok(!validateRegisterInput({ ...validBody, tags }).valid);
    });

    it('should accept tag with 50 chars', () => {
        assert.ok(validateRegisterInput({ ...validBody, tags: ['a'.repeat(50)] }).valid);
    });

    it('should reject tag with 51 chars', () => {
        assert.ok(!validateRegisterInput({ ...validBody, tags: ['a'.repeat(51)] }).valid);
    });

    it('should reject non-array tags', () => {
        assert.ok(!validateRegisterInput({ ...validBody, tags: 'ai,weather' }).valid);
    });

    it('should reject tags with non-string elements', () => {
        assert.ok(!validateRegisterInput({ ...validBody, tags: [42] }).valid);
    });

    it('should reject mixed valid/invalid tags', () => {
        assert.ok(!validateRegisterInput({ ...validBody, tags: ['valid', 42, 'also-valid'] }).valid);
    });
});

describe('register — data preparation', () => {
    function prepareInsertData(body) {
        const { name, description, url, price, tags, ownerAddress } = body;
        const txHash = body.txHash || null;
        const insertData = {
            name: name.trim(),
            description: (description || '').trim(),
            url: url.trim(),
            price_usdc: price,
            owner_address: ownerAddress,
            tags: tags || [],
        };
        if (txHash) insertData.tx_hash = txHash;
        return insertData;
    }

    it('should trim name whitespace', () => {
        const data = prepareInsertData({
            name: '  My Service  ', url: 'https://ex.com', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
        });
        assert.equal(data.name, 'My Service');
    });

    it('should trim url whitespace', () => {
        const data = prepareInsertData({
            name: 'Test', url: '  https://example.com  ', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
        });
        assert.equal(data.url, 'https://example.com');
    });

    it('should default description to empty string', () => {
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
        });
        assert.equal(data.description, '');
    });

    it('should trim description', () => {
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
            description: '  Hello  ',
        });
        assert.equal(data.description, 'Hello');
    });

    it('should default tags to empty array', () => {
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
        });
        assert.deepStrictEqual(data.tags, []);
    });

    it('should map price to price_usdc', () => {
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 0.05, ownerAddress: '0x' + 'a'.repeat(40),
        });
        assert.equal(data.price_usdc, 0.05);
    });

    it('should map ownerAddress to owner_address', () => {
        const addr = '0x' + 'b'.repeat(40);
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 1, ownerAddress: addr,
        });
        assert.equal(data.owner_address, addr);
    });

    it('should include tx_hash when provided', () => {
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
            txHash: '0x' + 'f'.repeat(64),
        });
        assert.equal(data.tx_hash, '0x' + 'f'.repeat(64));
    });

    it('should NOT include tx_hash when null', () => {
        const data = prepareInsertData({
            name: 'Test', url: 'https://ex.com', price: 1, ownerAddress: '0x' + 'a'.repeat(40),
        });
        assert.ok(!('tx_hash' in data));
    });
});
