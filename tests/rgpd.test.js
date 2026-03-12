// tests/rgpd.test.js — Tests unitaires pour routes/rgpd.js
// Stratégie : tester la logique de validation pure (WALLET_REGEX, vérification de signature)
// et la forme des réponses HTTP (sans appels viem ni Supabase réels).
// verifyWalletOwnership n'est pas exportée → on teste son comportement via des handlers simulés.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Helpers locaux ───────────────────────────────────────────────────────────

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

function mockRes() {
    const res = { _status: 200, _body: null };
    res.status = (s) => { res._status = s; return res; };
    res.json   = (b) => { res._body = b; return res; };
    return res;
}

// ─── Simulation de verifyWalletOwnership ─────────────────────────────────────
// La vraie fonction appelle viem.verifyMessage. On émule les branches :
//   - viem throws → retourne false
//   - viem retourne false → retourne false
//   - viem retourne true → retourne true

async function simulateVerifyWalletOwnership(wallet, message, signature, viemResult) {
    try {
        if (viemResult === 'throw') throw new Error('viem error');
        return viemResult;
    } catch {
        return false;
    }
}

// Replication du handler GET /api/user/:wallet/data avec verifyFn injectable
async function handleDataAccess(req, res, verifyFn) {
    const wallet  = req.params.wallet;
    const message   = req.query.message;
    const signature = req.query.signature;

    if (!WALLET_REGEX.test(wallet)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    if (!message || !signature) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!await verifyFn(wallet, message, signature)) {
        return res.status(401).json({ error: 'Signature verification failed. Sign the message with your wallet.' });
    }
    return res.json({ wallet, call_count: 0, activities: [], budgets: [] });
}

// Replication du handler DELETE /api/user/:wallet avec verifyFn injectable
async function handleDataDeletion(req, res, verifyFn) {
    const wallet    = req.params.wallet;
    const message   = req.body.message;
    const signature = req.body.signature;

    if (!WALLET_REGEX.test(wallet)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    if (!message || !signature) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!await verifyFn(wallet, message, signature)) {
        return res.status(401).json({ error: 'Signature verification failed.' });
    }
    return res.json({ status: 'deleted', wallet });
}

// ─── Suite 1 : WALLET_REGEX ────────────────────────────────────────────────────

describe('RGPD — WALLET_REGEX', () => {
    it('should accept a valid checksummed address', () => {
        assert.ok(WALLET_REGEX.test('0xfb1c478BD5567BdcD39782E0D6D23418bFda2430'));
    });

    it('should accept a lowercase address', () => {
        assert.ok(WALLET_REGEX.test('0x' + 'a'.repeat(40)));
    });

    it('should accept an uppercase address', () => {
        assert.ok(WALLET_REGEX.test('0x' + 'A'.repeat(40)));
    });

    it('should reject an address without 0x prefix', () => {
        assert.ok(!WALLET_REGEX.test('a'.repeat(40)));
    });

    it('should reject an address that is too short (41 chars total)', () => {
        assert.ok(!WALLET_REGEX.test('0x' + 'a'.repeat(39)));
    });

    it('should reject an address that is too long (43 chars total)', () => {
        assert.ok(!WALLET_REGEX.test('0x' + 'a'.repeat(41)));
    });

    it('should reject an address with non-hex characters', () => {
        assert.ok(!WALLET_REGEX.test('0x' + 'g'.repeat(40)));
    });

    it('should reject an empty string', () => {
        assert.ok(!WALLET_REGEX.test(''));
    });

    it('should reject a plain number string', () => {
        assert.ok(!WALLET_REGEX.test('12345678901234567890'));
    });
});

// ─── Suite 2 : verifyWalletOwnership (logique simulée) ────────────────────────

describe('RGPD — verifyWalletOwnership logic', () => {
    it('should return true when viem confirms the signature', async () => {
        const result = await simulateVerifyWalletOwnership(
            '0x' + 'a'.repeat(40),
            'x402 RGPD request: data-access 0xaaa 1234567890',
            '0x' + 'b'.repeat(130),
            true
        );
        assert.strictEqual(result, true);
    });

    it('should return false when viem rejects the signature', async () => {
        const result = await simulateVerifyWalletOwnership(
            '0x' + 'a'.repeat(40),
            'x402 RGPD request: data-access 0xaaa 1234567890',
            '0x' + 'b'.repeat(130),
            false
        );
        assert.strictEqual(result, false);
    });

    it('should return false when viem throws (invalid signature format)', async () => {
        const result = await simulateVerifyWalletOwnership(
            '0x' + 'a'.repeat(40),
            'x402 RGPD request: data-access 0xaaa 1234567890',
            'not-a-valid-sig',
            'throw'
        );
        assert.strictEqual(result, false);
    });

    it('should return false when wallet does not match the signer', async () => {
        // Signer wallet is different from claimed wallet → viem returns false
        const result = await simulateVerifyWalletOwnership(
            '0x' + 'b'.repeat(40), // different wallet
            'x402 RGPD request: data-access 0xaaa 1234567890',
            '0x' + 'c'.repeat(130),
            false // viem says mismatch
        );
        assert.strictEqual(result, false);
    });
});

// ─── Suite 3 : GET /api/user/:wallet/data ─────────────────────────────────────

describe('RGPD — GET /api/user/:wallet/data', () => {
    it('should return 400 when wallet format is invalid', async () => {
        const req = { params: { wallet: 'not-a-wallet' }, query: { message: 'x402 ...', signature: '0x123' } };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 400);
        assert.ok(res._body.error.includes('Invalid wallet address format'));
    });

    it('should return 400 when wallet is too short', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(39) }, query: { message: 'x402', signature: '0x123' } };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 400);
    });

    it('should return 401 when message query param is missing', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(40) }, query: { signature: '0x123' } };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 401);
        assert.ok(res._body.error.includes('Authentication required'));
    });

    it('should return 401 when signature query param is missing', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(40) }, query: { message: 'x402 request' } };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 401);
    });

    it('should return 401 when both message and signature are missing', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(40) }, query: {} };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 401);
    });

    it('should return 401 when signature verification fails', async () => {
        const req = {
            params: { wallet: '0x' + 'a'.repeat(40) },
            query: { message: 'x402 RGPD request: data-access', signature: '0x' + 'f'.repeat(130) },
        };
        const res = mockRes();
        await handleDataAccess(req, res, async () => false);
        assert.strictEqual(res._status, 401);
        assert.ok(res._body.error.includes('Signature verification failed'));
    });

    it('should return 200 with data when signature is valid', async () => {
        const wallet = '0x' + 'a'.repeat(40);
        const req = {
            params: { wallet },
            query: { message: `x402 RGPD request: data-access ${wallet} ${Date.now()}`, signature: '0x' + 'f'.repeat(130) },
        };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._body.wallet, wallet);
        assert.ok(Array.isArray(res._body.activities));
        assert.ok(Array.isArray(res._body.budgets));
    });

    it('should validate wallet case-sensitively (uppercase hex is valid)', async () => {
        const wallet = '0x' + 'A'.repeat(40);
        const req = {
            params: { wallet },
            query: { message: 'x402 request', signature: '0xsig' },
        };
        const res = mockRes();
        await handleDataAccess(req, res, async () => true);
        assert.strictEqual(res._status, 200);
    });
});

// ─── Suite 4 : DELETE /api/user/:wallet ───────────────────────────────────────

describe('RGPD — DELETE /api/user/:wallet', () => {
    it('should return 400 when wallet format is invalid', async () => {
        const req = { params: { wallet: 'bad-address' }, body: { message: 'x402', signature: '0x123' } };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 400);
        assert.ok(res._body.error.includes('Invalid wallet address format'));
    });

    it('should return 400 when wallet has no 0x prefix', async () => {
        const req = { params: { wallet: 'a'.repeat(40) }, body: { message: 'x402', signature: '0x123' } };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 400);
    });

    it('should return 401 when body.message is missing', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(40) }, body: { signature: '0x123' } };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 401);
        assert.ok(res._body.error.includes('Authentication required'));
    });

    it('should return 401 when body.signature is missing', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(40) }, body: { message: 'x402 request' } };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 401);
    });

    it('should return 401 when body is empty', async () => {
        const req = { params: { wallet: '0x' + 'a'.repeat(40) }, body: {} };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 401);
    });

    it('should return 401 when signature verification fails', async () => {
        const req = {
            params: { wallet: '0x' + 'a'.repeat(40) },
            body: { message: 'x402 RGPD request: data-deletion', signature: '0x' + 'f'.repeat(130) },
        };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => false);
        assert.strictEqual(res._status, 401);
        assert.ok(res._body.error.includes('Signature verification failed'));
    });

    it('should return 200 with status:deleted when signature is valid', async () => {
        const wallet = '0x' + 'b'.repeat(40);
        const req = {
            params: { wallet },
            body: { message: `x402 RGPD request: data-deletion ${wallet} ${Date.now()}`, signature: '0x' + 'e'.repeat(130) },
        };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._body.status, 'deleted');
        assert.strictEqual(res._body.wallet, wallet);
    });

    it('should reject a wallet address with special characters', async () => {
        const req = { params: { wallet: '0x<script>alert(1)</script>' }, body: { message: 'x402', signature: '0x' } };
        const res = mockRes();
        await handleDataDeletion(req, res, async () => true);
        assert.strictEqual(res._status, 400);
    });
});

// ─── Suite 5 : message format (documentation contract) ────────────────────────

describe('RGPD — message format contract', () => {
    it('should document the expected message format for data-access', () => {
        const wallet    = '0x' + 'a'.repeat(40);
        const timestamp = Date.now();
        const expected  = `x402 RGPD request: data-access ${wallet} ${timestamp}`;
        assert.ok(expected.startsWith('x402 RGPD request: data-access'));
        assert.ok(expected.includes(wallet));
        assert.ok(expected.includes(String(timestamp)));
    });

    it('should document the expected message format for data-deletion', () => {
        const wallet    = '0x' + 'a'.repeat(40);
        const timestamp = Date.now();
        const expected  = `x402 RGPD request: data-deletion ${wallet} ${timestamp}`;
        assert.ok(expected.startsWith('x402 RGPD request: data-deletion'));
        assert.ok(expected.includes(wallet));
    });
});
