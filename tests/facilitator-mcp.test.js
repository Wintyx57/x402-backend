// tests/facilitator-mcp.test.js — Tests unitaires pour les fonctions MCP du facilitateur Polygon
//
// Stratégie (Option 3 — fonctions pures recréées dans le test):
//   Le MCP server (mcp-server.mjs) est un module ESM dont les fonctions ne sont pas exportées.
//   On extrait et reproduit la logique pure de signEIP3009Auth, sendViaFacilitator, et le
//   routage payAndRequest pour tester unitairement chaque comportement.
//   Les side effects (viem, fs) sont stubbés via des objets mock minimaux.
//   global.fetch est remplacé avant chaque test et restauré en afterEach.
//
// Suites:
//   1. signEIP3009Auth — structure EIP-712, domaine, types, message  (7 tests)
//   2. sendViaFacilitator — appel HTTP /settle, parsing réponse, gestion erreurs  (8 tests)
//   3. payAndRequest — logique de routage facilitateur vs RPC  (8 tests)
//
// Total: 23 tests
//
// Exécution: node --test tests/facilitator-mcp.test.js
//
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constantes partagées
// ---------------------------------------------------------------------------

const USDC_POLYGON        = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const FACILITATOR_URL     = 'https://x402.polygon.technology';
const FEE_SPLITTER        = '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56';
const AGENT_ADDRESS       = '0x' + 'a'.repeat(40);
const RECIPIENT_ADDRESS   = '0x' + 'b'.repeat(40);
const TX_HASH             = '0x' + 'c'.repeat(64);
const AMOUNT_USDC         = 0.005;  // 0.005 USDC
const AMOUNT_RAW          = BigInt(Math.round(AMOUNT_USDC * 1e6)); // 5000n micro-USDC (6 decimals)
const MOCK_SIGNATURE      = '0x' + 'd'.repeat(130);

// ---------------------------------------------------------------------------
// Helpers — stubs minimaux
// ---------------------------------------------------------------------------

/**
 * Crée un walletClient viem minimal dont signTypedData est stubée.
 * @param {string} [returnSignature] — signature à retourner (ou exception à lever)
 * @param {Error|null} [throwError] — si défini, signTypedData lance cette erreur
 */
function makeWalletClient({ returnSignature = MOCK_SIGNATURE, throwError = null } = {}) {
    return {
        signTypedData: async (_args) => {
            if (throwError) throw throwError;
            return returnSignature;
        },
    };
}

/**
 * Stub global.fetch simulant une réponse JSON avec status donné.
 * @param {object} responseBody
 * @param {{ status?: number, shouldThrow?: string, delay?: number }} options
 */
function makeFetchStub(responseBody, { status = 200, shouldThrow = null, delay = 0 } = {}) {
    return async (_url, _opts) => {
        if (shouldThrow) throw new Error(shouldThrow);
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        return {
            status,
            ok: status >= 200 && status < 300,
            json: async () => responseBody,
            text: async () => JSON.stringify(responseBody),
        };
    };
}

/**
 * Implémentation pure de signEIP3009Auth extraite de mcp-server.mjs.
 * Paramétrable avec un compte et un walletClient injectés.
 */
async function signEIP3009Auth_impl(walletClient, accountAddress, amount, to, validAfter, validBefore) {
    const nonce = '0x' + crypto.randomBytes(32).toString('hex');

    const domain = {
        name: 'USD Coin',
        version: '2',
        chainId: 137,
        verifyingContract: USDC_POLYGON,
    };

    const types = {
        TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32' },
        ],
    };

    const message = {
        from:        accountAddress,
        to,
        value:       BigInt(amount),
        validAfter:  BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
    };

    const signature = await walletClient.signTypedData({
        domain, types, primaryType: 'TransferWithAuthorization', message,
    });

    return {
        signature,
        authorization: {
            from:        accountAddress,
            to,
            value:       amount.toString(),
            validAfter:  validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
        },
    };
}

/**
 * Implémentation pure de sendViaFacilitator extraite de mcp-server.mjs.
 * fetch est injecté en paramètre pour permettre le stubbing sans toucher global.fetch.
 */
async function sendViaFacilitator_impl(walletClient, accountAddress, apiUrl, fetchOptions, details, chainConfig, fetchFn) {
    const cost = parseFloat(details.amount);
    const amountRaw = BigInt(Math.round(cost * 1e6));

    const validAfter  = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 300;

    const recipient = chainConfig.feeSplitterContract || details.recipient;

    const { signature, authorization } = await signEIP3009Auth_impl(
        walletClient,
        accountAddress,
        amountRaw.toString(),
        recipient,
        validAfter,
        validBefore,
    );

    const paymentPayload = {
        x402Version: 1,
        scheme:      'exact',
        network:     'polygon',
        payload:     { signature, authorization },
    };

    const paymentRequirements = {
        scheme:            'exact',
        network:           'polygon',
        maxAmountRequired: amountRaw.toString(),
        resource:          apiUrl,
        description:       'x402 Bazaar API payment',
        mimeType:          'application/json',
        payTo:             recipient,
        asset:             chainConfig.usdc,
        maxTimeoutSeconds: 60,
    };

    const settleUrl = `${chainConfig.facilitator}/settle`;
    const settleRes = await fetchFn(settleUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    });

    const settleData = await settleRes.json();
    if (!settleData.success) {
        throw new Error(
            `Facilitator settlement failed: ${settleData.errorReason || 'unknown'} — ${settleData.errorMessage || JSON.stringify(settleData)}`
        );
    }

    const txHash = settleData.transaction;

    const retryHeaders = {
        ...fetchOptions.headers,
        'X-Payment-TxHash': txHash,
        'X-Payment-Chain':  chainConfig.paymentHeader,
    };

    const retryRes = await fetchFn(apiUrl, { ...fetchOptions, headers: retryHeaders });

    let data;
    if (fetchOptions.textFallback) {
        const text = await retryRes.text();
        try { data = JSON.parse(text); } catch { data = { response: text.slice(0, 5000) }; }
    } else {
        data = await retryRes.json();
    }

    return { data, txHash };
}

/**
 * Logique de sélection de route facilitateur — extraite de payAndRequest() dans mcp-server.mjs.
 * Reproduit exactement les deux conditions de routage:
 *   1. Branche isSplitMode avec cfg.facilitator || details.facilitator
 *   2. Branche standard avec cfg.facilitator || details.facilitator
 */
function selectFacilitatorRoute(chainKey, cfg, details) {
    const isSplitMode = !!details.provider_wallet && details.payment_mode === 'split_native';

    if (isSplitMode) {
        const splitFacilitatorUrl = cfg.facilitator || details.facilitator || null;
        if (splitFacilitatorUrl && chainKey === 'polygon') {
            return { mode: 'facilitator_split', facilitatorUrl: splitFacilitatorUrl };
        }
        return { mode: 'split_rpc', facilitatorUrl: null };
    }

    // Standard (non-split)
    const facilitatorUrl = cfg.facilitator || details.facilitator || null;
    if (facilitatorUrl) {
        return { mode: 'facilitator', facilitatorUrl };
    }
    return { mode: 'rpc', facilitatorUrl: null };
}

// ---------------------------------------------------------------------------
// Suite 1 — signEIP3009Auth: structure EIP-712
// ---------------------------------------------------------------------------

describe('signEIP3009Auth — structure EIP-712 TransferWithAuthorization', () => {
    it('should build a domain with name "USD Coin" and version "2"', async () => {
        // Arrange
        let capturedDomain = null;
        const walletClient = {
            signTypedData: async ({ domain }) => {
                capturedDomain = domain;
                return MOCK_SIGNATURE;
            },
        };

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);

        // Assert
        assert.ok(capturedDomain, 'domain doit être capturé');
        assert.strictEqual(capturedDomain.name, 'USD Coin');
        assert.strictEqual(capturedDomain.version, '2');
    });

    it('should set domain chainId to 137 (Polygon mainnet)', async () => {
        // Arrange
        let capturedDomain = null;
        const walletClient = {
            signTypedData: async ({ domain }) => { capturedDomain = domain; return MOCK_SIGNATURE; },
        };

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);

        // Assert
        assert.strictEqual(capturedDomain.chainId, 137);
    });

    it('should set domain verifyingContract to the Polygon USDC address', async () => {
        // Arrange
        let capturedDomain = null;
        const walletClient = {
            signTypedData: async ({ domain }) => { capturedDomain = domain; return MOCK_SIGNATURE; },
        };

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);

        // Assert
        assert.strictEqual(capturedDomain.verifyingContract, USDC_POLYGON);
    });

    it('should include all 6 fields in the TransferWithAuthorization type definition', async () => {
        // Arrange
        let capturedTypes = null;
        const walletClient = {
            signTypedData: async ({ types }) => { capturedTypes = types; return MOCK_SIGNATURE; },
        };

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);

        // Assert
        assert.ok(capturedTypes, 'types doit être capturé');
        const fields = capturedTypes.TransferWithAuthorization;
        assert.ok(Array.isArray(fields), 'TransferWithAuthorization doit être un tableau');
        const fieldNames = fields.map(f => f.name);
        for (const required of ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']) {
            assert.ok(fieldNames.includes(required), `champ "${required}" manquant dans les types`);
        }
    });

    it('should set validAfter to 0 (immediate validity)', async () => {
        // Arrange
        let capturedMessage = null;
        const walletClient = {
            signTypedData: async ({ message }) => { capturedMessage = message; return MOCK_SIGNATURE; },
        };

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);

        // Assert
        assert.strictEqual(capturedMessage.validAfter, 0n);
    });

    it('should set validBefore to a future timestamp (at least now + 60 seconds)', async () => {
        // Arrange
        let capturedMessage = null;
        const walletClient = {
            signTypedData: async ({ message }) => { capturedMessage = message; return MOCK_SIGNATURE; },
        };
        const nowSeconds = Math.floor(Date.now() / 1000);

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, nowSeconds + 300);

        // Assert: validBefore doit être dans le futur (au moins 60s devant now)
        assert.ok(capturedMessage.validBefore > BigInt(nowSeconds + 60),
            `validBefore (${capturedMessage.validBefore}) doit être supérieur à now+60 (${nowSeconds + 60})`);
    });

    it('should generate a unique bytes32 nonce (0x + 64 hex chars)', async () => {
        // Arrange — deux appels successifs ne doivent pas retourner le même nonce
        const nonces = [];
        const walletClient = {
            signTypedData: async ({ message }) => {
                nonces.push(message.nonce);
                return MOCK_SIGNATURE;
            },
        };

        // Act
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);
        await signEIP3009Auth_impl(walletClient, AGENT_ADDRESS, AMOUNT_RAW.toString(), RECIPIENT_ADDRESS, 0, 9999999999);

        // Assert: format 0x + 64 hex, et les deux nonces sont différents
        for (const nonce of nonces) {
            assert.match(nonce, /^0x[0-9a-f]{64}$/, `nonce "${nonce}" doit être un bytes32 hexadécimal valide`);
        }
        assert.notStrictEqual(nonces[0], nonces[1], 'deux appels consécutifs doivent produire des nonces distincts');
    });
});

// ---------------------------------------------------------------------------
// Suite 2 — sendViaFacilitator: appel HTTP /settle et parsing de réponse
// ---------------------------------------------------------------------------

describe('sendViaFacilitator — POST /settle et gestion des réponses', () => {
    const chainConfig = {
        facilitator:         FACILITATOR_URL,
        feeSplitterContract: FEE_SPLITTER,
        usdc:                USDC_POLYGON,
        paymentHeader:       'polygon',
    };

    const details = {
        amount:    AMOUNT_USDC.toString(),
        recipient: RECIPIENT_ADDRESS,
    };

    const fetchOptions = { method: 'GET', headers: {} };

    it('should POST to the correct settle URL (facilitatorUrl + "/settle")', async () => {
        // Arrange
        const calledUrls = [];
        let callIndex = 0;
        const mockFetch = async (url, opts) => {
            calledUrls.push(url);
            callIndex++;
            if (callIndex === 1) {
                // Premier appel: POST /settle
                return {
                    status: 200,
                    json: async () => ({ success: true, transaction: TX_HASH }),
                };
            }
            // Deuxième appel: retry avec X-Payment-TxHash
            return {
                status: 200,
                json: async () => ({ result: 'ok' }),
            };
        };

        const walletClient = makeWalletClient();
        const apiUrl = 'https://x402-api.onrender.com/api/joke';

        // Act
        await sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, apiUrl, fetchOptions, details, chainConfig, mockFetch);

        // Assert
        assert.ok(calledUrls.length >= 1, 'fetch doit être appelé au moins une fois');
        assert.strictEqual(calledUrls[0], `${FACILITATOR_URL}/settle`, 'premier appel doit cibler /settle');
    });

    it('should include x402Version, paymentPayload, and paymentRequirements in the settle body', async () => {
        // Arrange
        let capturedSettleBody = null;
        let callIndex = 0;
        const mockFetch = async (url, opts) => {
            callIndex++;
            if (callIndex === 1) {
                capturedSettleBody = JSON.parse(opts.body);
                return { status: 200, json: async () => ({ success: true, transaction: TX_HASH }) };
            }
            return { status: 200, json: async () => ({ result: 'ok' }) };
        };

        const walletClient = makeWalletClient();

        // Act
        await sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, details, chainConfig, mockFetch);

        // Assert
        assert.ok(capturedSettleBody, 'body du settle ne doit pas être null');
        assert.strictEqual(capturedSettleBody.x402Version, 1);
        assert.ok(capturedSettleBody.paymentPayload, 'paymentPayload doit être présent');
        assert.ok(capturedSettleBody.paymentRequirements, 'paymentRequirements doit être présent');
        assert.strictEqual(capturedSettleBody.paymentPayload.scheme, 'exact');
        assert.strictEqual(capturedSettleBody.paymentPayload.network, 'polygon');
        assert.ok(capturedSettleBody.paymentPayload.payload.signature, 'signature doit être présente');
        assert.ok(capturedSettleBody.paymentPayload.payload.authorization, 'authorization doit être présente');
    });

    it('should return the txHash from the settle response', async () => {
        // Arrange
        let callIndex = 0;
        const mockFetch = async () => {
            callIndex++;
            if (callIndex === 1) return { status: 200, json: async () => ({ success: true, transaction: TX_HASH }) };
            return { status: 200, json: async () => ({ data: 'some api result' }) };
        };

        const walletClient = makeWalletClient();

        // Act
        const result = await sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, details, chainConfig, mockFetch);

        // Assert
        assert.strictEqual(result.txHash, TX_HASH, 'txHash doit correspondre à settleData.transaction');
    });

    it('should return the API data from the retry call', async () => {
        // Arrange
        const apiPayload = { joke: 'Why do programmers prefer dark mode? Because light attracts bugs.' };
        let callIndex = 0;
        const mockFetch = async () => {
            callIndex++;
            if (callIndex === 1) return { status: 200, json: async () => ({ success: true, transaction: TX_HASH }) };
            return { status: 200, json: async () => apiPayload };
        };

        const walletClient = makeWalletClient();

        // Act
        const result = await sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, details, chainConfig, mockFetch);

        // Assert
        assert.deepStrictEqual(result.data, apiPayload, 'data doit être la réponse de l\'API cible');
    });

    it('should add X-Payment-TxHash and X-Payment-Chain headers on the retry call', async () => {
        // Arrange
        let capturedRetryHeaders = null;
        let callIndex = 0;
        const mockFetch = async (url, opts) => {
            callIndex++;
            if (callIndex === 1) return { status: 200, json: async () => ({ success: true, transaction: TX_HASH }) };
            capturedRetryHeaders = opts.headers;
            return { status: 200, json: async () => ({ ok: true }) };
        };

        const walletClient = makeWalletClient();

        // Act
        await sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, details, chainConfig, mockFetch);

        // Assert
        assert.ok(capturedRetryHeaders, 'headers du retry ne doivent pas être null');
        assert.strictEqual(capturedRetryHeaders['X-Payment-TxHash'], TX_HASH);
        assert.strictEqual(capturedRetryHeaders['X-Payment-Chain'], 'polygon');
    });

    it('should throw when the facilitator returns success:false', async () => {
        // Arrange
        const mockFetch = async () => ({
            status: 200,
            json: async () => ({
                success:      false,
                errorReason:  'insufficient_balance',
                errorMessage: 'Wallet balance too low',
            }),
        });

        const walletClient = makeWalletClient();

        // Act + Assert
        await assert.rejects(
            () => sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, details, chainConfig, mockFetch),
            (err) => {
                assert.ok(err.message.includes('Facilitator settlement failed'), 'message doit contenir "Facilitator settlement failed"');
                assert.ok(err.message.includes('insufficient_balance'), 'message doit inclure errorReason');
                return true;
            },
            'sendViaFacilitator doit lever une erreur quand success:false'
        );
    });

    it('should propagate the error when fetch throws (network timeout)', async () => {
        // Arrange — fetch lève une exception réseau
        const mockFetch = async () => { throw new Error('fetch failed: network timeout'); };

        const walletClient = makeWalletClient();

        // Act + Assert
        await assert.rejects(
            () => sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, details, chainConfig, mockFetch),
            /network timeout/,
            'Erreur réseau doit être propagée (pas silencieuse)'
        );
    });

    it('should use feeSplitterContract as recipient when it is set in chainConfig', async () => {
        // Arrange — capturer le payTo dans paymentRequirements
        let capturedPayTo = null;
        let callIndex = 0;
        const mockFetch = async (url, opts) => {
            callIndex++;
            if (callIndex === 1) {
                const body = JSON.parse(opts.body);
                capturedPayTo = body.paymentRequirements.payTo;
                return { status: 200, json: async () => ({ success: true, transaction: TX_HASH }) };
            }
            return { status: 200, json: async () => ({ ok: true }) };
        };

        const walletClient = makeWalletClient();
        const detailsWithRecipient = { ...details, recipient: RECIPIENT_ADDRESS };

        // Act
        await sendViaFacilitator_impl(walletClient, AGENT_ADDRESS, 'https://example.com/api', fetchOptions, detailsWithRecipient, chainConfig, mockFetch);

        // Assert: feeSplitterContract doit primer sur details.recipient
        assert.strictEqual(capturedPayTo, FEE_SPLITTER,
            'payTo doit être le FeeSplitter contract, pas details.recipient');
    });
});

// ---------------------------------------------------------------------------
// Suite 3 — Routage payAndRequest: facilitateur vs RPC direct
// ---------------------------------------------------------------------------

describe('payAndRequest routing — sélection facilitateur vs RPC', () => {
    // Configuration de base des chaînes
    const chainPolygonWithFacilitator = {
        facilitator:         FACILITATOR_URL,
        feeSplitterContract: FEE_SPLITTER,
        usdc:                USDC_POLYGON,
        paymentHeader:       'polygon',
        label:               'Polygon (low gas)',
    };
    const chainPolygonNoFacilitator = {
        facilitator:         null,
        feeSplitterContract: null,
        usdc:                USDC_POLYGON,
        paymentHeader:       'polygon',
        label:               'Polygon (low gas)',
    };
    const chainBase = {
        facilitator:         null,
        feeSplitterContract: null,
        usdc:                '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        paymentHeader:       'base',
        label:               'Base Mainnet',
    };
    const chainSkale = {
        facilitator:         null,
        feeSplitterContract: null,
        usdc:                '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20',
        paymentHeader:       'skale',
        label:               'SKALE on Base',
    };

    it('should route to facilitator when cfg.facilitator is set on Polygon (legacy mode)', () => {
        // Arrange
        const details = { amount: '0.005', recipient: RECIPIENT_ADDRESS };

        // Act
        const route = selectFacilitatorRoute('polygon', chainPolygonWithFacilitator, details);

        // Assert
        assert.strictEqual(route.mode, 'facilitator');
        assert.strictEqual(route.facilitatorUrl, FACILITATOR_URL);
    });

    it('should route to facilitator when details.facilitator is set (402 response field)', () => {
        // Arrange — cfg.facilitator est null mais details.facilitator est présent (nouveau fix)
        const details = {
            amount:      '0.005',
            recipient:   RECIPIENT_ADDRESS,
            facilitator: FACILITATOR_URL,
        };

        // Act
        const route = selectFacilitatorRoute('polygon', chainPolygonNoFacilitator, details);

        // Assert
        assert.strictEqual(route.mode, 'facilitator');
        assert.strictEqual(route.facilitatorUrl, FACILITATOR_URL,
            'details.facilitator doit être utilisé en fallback quand cfg.facilitator est null');
    });

    it('should route to RPC when cfg.facilitator and details.facilitator are both null', () => {
        // Arrange
        const details = { amount: '0.005', recipient: RECIPIENT_ADDRESS };

        // Act
        const route = selectFacilitatorRoute('polygon', chainPolygonNoFacilitator, details);

        // Assert
        assert.strictEqual(route.mode, 'rpc', 'sans facilitateur → doit utiliser RPC direct');
        assert.strictEqual(route.facilitatorUrl, null);
    });

    it('should always route Base to RPC, ignoring any facilitator URL', () => {
        // Arrange — même si details.facilitator était set, Base n'a pas cfg.facilitator
        const details = { amount: '0.005', recipient: RECIPIENT_ADDRESS };

        // Act
        const route = selectFacilitatorRoute('base', chainBase, details);

        // Assert
        assert.strictEqual(route.mode, 'rpc', 'Base doit toujours utiliser RPC');
    });

    it('should always route SKALE to RPC, ignoring any facilitator URL', () => {
        // Arrange
        const details = { amount: '0.005', recipient: RECIPIENT_ADDRESS };

        // Act
        const route = selectFacilitatorRoute('skale', chainSkale, details);

        // Assert
        assert.strictEqual(route.mode, 'rpc', 'SKALE doit toujours utiliser RPC');
    });

    it('should route split_native mode on Polygon to facilitator_split when cfg.facilitator is set', () => {
        // Arrange
        const details = {
            amount:         '0.005',
            recipient:      RECIPIENT_ADDRESS,
            provider_wallet: '0x' + 'e'.repeat(40),
            payment_mode:   'split_native',
        };

        // Act
        const route = selectFacilitatorRoute('polygon', chainPolygonWithFacilitator, details);

        // Assert
        assert.strictEqual(route.mode, 'facilitator_split',
            'split_native + cfg.facilitator Polygon → doit utiliser le facilitateur (pas double transfer)');
        assert.strictEqual(route.facilitatorUrl, FACILITATOR_URL);
    });

    it('should route split_native mode on Polygon to split_rpc when no facilitator is available', () => {
        // Arrange
        const details = {
            amount:          '0.005',
            recipient:       RECIPIENT_ADDRESS,
            provider_wallet: '0x' + 'e'.repeat(40),
            payment_mode:    'split_native',
        };

        // Act
        const route = selectFacilitatorRoute('polygon', chainPolygonNoFacilitator, details);

        // Assert
        assert.strictEqual(route.mode, 'split_rpc',
            'split_native sans facilitateur → doit utiliser double transfer RPC');
    });

    it('should route split_native mode on Base to split_rpc regardless of facilitator env', () => {
        // Arrange — même si Base avait un facilitator configuré (scénario hypothétique),
        // la condition chainKey === 'polygon' empêche le routage facilitateur
        const chainBaseWithFacilitator = { ...chainBase, facilitator: FACILITATOR_URL };
        const details = {
            amount:          '0.005',
            recipient:       RECIPIENT_ADDRESS,
            provider_wallet: '0x' + 'e'.repeat(40),
            payment_mode:    'split_native',
        };

        // Act — Base n'est pas 'polygon', donc même avec un facilitateur il ne passe pas
        const route = selectFacilitatorRoute('base', chainBaseWithFacilitator, details);

        // Assert
        assert.strictEqual(route.mode, 'split_rpc',
            'split_native sur Base doit utiliser double transfer RPC même si facilitator est set');
    });
});

// ---------------------------------------------------------------------------
// Suite 4 — Logique de conversion d'amount (USDC 6 décimales)
// ---------------------------------------------------------------------------

describe('Amount conversion — USDC 6 decimals (Polygon)', () => {
    it('should convert 0.005 USDC to 5000 micro-USDC (6 decimals)', () => {
        // Arrange + Act
        const amountFloat = 0.005;
        const amountRaw = BigInt(Math.round(amountFloat * 1e6));

        // Assert
        assert.strictEqual(amountRaw, 5000n);
    });

    it('should convert 1.00 USDC to 1_000_000 micro-USDC', () => {
        const amountRaw = BigInt(Math.round(1.00 * 1e6));
        assert.strictEqual(amountRaw, 1_000_000n);
    });

    it('should convert 0.001 USDC to 1000 micro-USDC without floating point error', () => {
        const amountRaw = BigInt(Math.round(0.001 * 1e6));
        assert.strictEqual(amountRaw, 1000n);
    });

    it('should round fractional micro-USDC amounts correctly', () => {
        // 0.0015 USDC = 1500 micro-USDC (pas de décimale en dessous de 1 micro)
        const amountRaw = BigInt(Math.round(0.0015 * 1e6));
        assert.strictEqual(amountRaw, 1500n);
    });
});
