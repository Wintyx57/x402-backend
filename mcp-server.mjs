import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir, hostname, userInfo } from 'os';

// Load .env from the script's directory (not cwd)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, polygon } from 'viem/chains';

// ─── SKALE on Base chain definition ─────────────────────────────────
const skaleOnBase = defineChain({
    id: 1187947933,
    name: 'SKALE on Base',
    nativeCurrency: { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 },
    rpcUrls: { default: { http: ['https://skale-base.skalenodes.com/v1/base'] } },
    blockExplorers: { default: { name: 'SKALE Explorer', url: 'https://skale-base-explorer.skalenodes.com' } },
});

// ─── Multi-chain config ─────────────────────────────────────────────
const CHAINS = {
    base: {
        chain: base,
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        explorer: 'https://basescan.org',
        label: 'Base Mainnet',
        paymentHeader: 'base',
    },
    skale: {
        chain: skaleOnBase,
        usdc: '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20',
        decimals: 6, // USDC on SKALE on Base has 6 decimals (verified on-chain)
        explorer: 'https://skale-base-explorer.skalenodes.com',
        label: 'SKALE on Base (ultra-low gas)',
        paymentHeader: 'skale',
    },
    'base-sepolia': {
        chain: baseSepolia,
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        decimals: 6,
        explorer: 'https://sepolia.basescan.org',
        label: 'Base Sepolia',
        paymentHeader: 'base-sepolia',
    },
    polygon: {
        chain: polygon,
        usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        decimals: 6, // Circle native USDC on Polygon has 6 decimals
        explorer: 'https://polygonscan.com',
        label: 'Polygon (low gas)',
        paymentHeader: 'polygon',
        rpc: 'https://polygon-bor-rpc.publicnode.com',
        facilitator: process.env.POLYGON_FACILITATOR_URL || null,
        feeSplitterContract: process.env.POLYGON_FEE_SPLITTER_CONTRACT || null,
    },
};

// EIP-3009 domain separators per chain (for transferWithAuthorization signing)
// Only chains where USDC supports EIP-3009 are listed
const EIP3009_DOMAINS = {
    polygon: {
        name: 'USD Coin',
        version: '2',
        chainId: 137,
        verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    },
    base: {
        name: 'USD Coin',
        version: '2',
        chainId: 8453,
        verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
    // SKALE: custom USDC without EIP-3009 — uses direct transfer fallback
};

// ─── Helper: convert a USDC float amount to on-chain raw units ───────
// Uses the chain's USDC decimals (6 for all chains: Base, SKALE, Polygon).
function usdcToRaw(amount, chainKey) {
    const decimals = CHAINS[chainKey]?.decimals ?? 6;
    return BigInt(Math.round(amount * (10 ** decimals)));
}

const SERVER_URL = process.env.X402_SERVER_URL || 'https://x402-api.onrender.com';
const MAX_BUDGET = parseFloat(process.env.MAX_BUDGET_USDC || '1.00');
const DEFAULT_CHAIN_KEY = process.env.NETWORK === 'testnet' ? 'base-sepolia'
    : (process.env.NETWORK === 'base' ? 'base' : 'skale');

const USDC_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

// ─── Smart Chain: Balance Cache + Auto-Selection ─────────────────────
let balanceCache = { base: 0, skale: 0, polygon: 0, updatedAt: 0 };
const BALANCE_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function refreshBalanceCache() {
    if (!account) return;
    const now = Date.now();
    if (now - balanceCache.updatedAt < BALANCE_CACHE_TTL) return;

    const results = await Promise.allSettled(
        ['base', 'skale', 'polygon'].map(async (key) => {
            const cfg = CHAINS[key];
            const { public: pubClient } = getClients(key);
            const raw = await pubClient.readContract({
                address: cfg.usdc,
                abi: USDC_ABI,
                functionName: 'balanceOf',
                args: [account.address],
            });
            const decimals = cfg.decimals ?? 6;
            return { key, balance: Number(raw) / (10 ** decimals) };
        })
    );

    for (const r of results) {
        if (r.status === 'fulfilled') {
            balanceCache[r.value.key] = r.value.balance;
        }
    }
    balanceCache.updatedAt = now;
}

async function selectBestChain(requiredAmount) {
    await refreshBalanceCache();

    // Priority order: skale (cheapest gas) > polygon > base
    const priority = ['skale', 'polygon', 'base'];

    // Filter chains with sufficient balance
    const viable = priority.filter(key => balanceCache[key] >= requiredAmount);

    if (viable.length === 0) {
        // No chain has enough — surface a hard error instead of silently failing
        return { chain: null, error: `Insufficient balance on all chains for ${requiredAmount} USDC. Balances: Base=${(balanceCache.base || 0).toFixed(4)}, SKALE=${(balanceCache.skale || 0).toFixed(4)}, Polygon=${(balanceCache.polygon || 0).toFixed(4)}` };
    }

    // For SKALE, also check CREDITS balance for gas
    if (viable[0] === 'skale') {
        try {
            const { public: pubClient } = getClients('skale');
            const nativeBal = await pubClient.getBalance({ address: account.address });
            const credits = Number(nativeBal) / 1e18;
            if (credits < 0.001) {
                // Not enough CREDITS for gas — skip SKALE
                const fallback = viable.length > 1 ? viable[1] : 'skale';
                return { chain: fallback, warning: credits < 0.001 ? 'SKALE skipped: insufficient CREDITS for gas. Using ' + fallback + ' instead.' : undefined };
            }
        } catch {
            // If check fails, proceed with SKALE anyway
        }
    }

    return { chain: viable[0] };
}

// ─── Budget Tracking (persistent on disk) ────────────────────────────
const X402_DIR = join(homedir(), '.x402-bazaar');
const BUDGET_FILE_PATH = join(X402_DIR, 'session-budget.json');

// Ensure the ~/.x402-bazaar dir exists once at startup (wallet code also creates it, but belt+suspenders)
try { fs.mkdirSync(X402_DIR, { recursive: true }); } catch { /* already exists */ }

function getTodayDate() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function loadBudgetFromDisk() {
    try {
        const raw = JSON.parse(fs.readFileSync(BUDGET_FILE_PATH, 'utf-8'));
        if (raw.date !== getTodayDate()) return { spent: 0, payments: [] }; // new day → reset
        return { spent: raw.spent || 0, payments: raw.payments || [] };
    } catch {
        return { spent: 0, payments: [] };
    }
}

function saveBudgetToDisk() {
    try {
        fs.writeFileSync(BUDGET_FILE_PATH, JSON.stringify({
            date: getTodayDate(),
            spent: sessionSpending,
            payments: sessionPayments,
        }, null, 2), { mode: 0o600 });
    } catch (err) {
        // Use stderr directly — mcpLog may not be initialized yet at module load time
        process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', ctx: 'MCP', msg: `Failed to save budget to disk: ${err.message}` }) + '\n');
    }
}

const { spent: _initSpent, payments: _initPayments } = loadBudgetFromDisk();
let sessionSpending = _initSpent;
const sessionPayments = _initPayments;

// Pool of reusable tx hashes (from not_charged responses — consumer protection)
const reusableHashes = []; // { txHash, amount, chain, headers, timestamp, txHashPlatform? }
const REUSABLE_HASH_TTL = 10 * 60 * 1000; // 10 minutes

// ─── Auto-Discovery (Layer 4) ────────────────────────────────────────
const discoveryThrottle = new Map();
const DISCOVERY_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Find a reusable tx hash from a previous not_charged response.
 * Only reuses legacy hashes (single transfer to WALLET_ADDRESS).
 * Returns the hash object and removes it from the pool, or null.
 */
function findReusableHash(chainKey, cost) {
    const now = Date.now();
    // Purge expired hashes
    for (let i = reusableHashes.length - 1; i >= 0; i--) {
        if (now - reusableHashes[i].timestamp > REUSABLE_HASH_TTL) {
            reusableHashes.splice(i, 1);
        }
    }
    // Find compatible: same chain, amount >= cost, legacy only (no splitMode)
    const idx = reusableHashes.findIndex(h =>
        h.chain === chainKey && h.amount >= cost && !h.splitMode
    );
    if (idx === -1) return null;
    return reusableHashes.splice(idx, 1)[0];
}

// ─── Client-Side Validation (Zero Trust) ─────────────────────────────
const VALIDATION_SECRET = process.env.VALIDATION_SECRET || null;
const SERVICE_BLACKLIST_TTL = 10 * 60 * 1000; // 10 minutes
const serviceBlacklist = new Map(); // serviceId → { reason, until }

function addToBlacklist(serviceId, reason) {
    serviceBlacklist.set(serviceId, {
        reason,
        until: Date.now() + SERVICE_BLACKLIST_TTL,
    });
    mcpLog.warn('MCP', `Service ${serviceId} blacklisted for ${reason} (10 min)`);
}

function isBlacklisted(serviceId) {
    const entry = serviceBlacklist.get(serviceId);
    if (!entry) return null;
    if (Date.now() > entry.until) {
        serviceBlacklist.delete(serviceId);
        return null;
    }
    return entry;
}

/**
 * Quick client-side quality check — lightweight heuristic.
 * Returns a score 0.0-1.0 based on basic content analysis.
 */
function quickClientScore(data) {
    if (data == null) return 0;
    if (typeof data !== 'object') {
        return typeof data === 'string' && data.length > 0 ? 0.5 : 0.3;
    }
    const keys = Object.keys(data);
    if (keys.length === 0) return 0.1;
    // Count non-null, non-empty values
    let useful = 0;
    for (const k of keys) {
        const v = data[k];
        if (v !== null && v !== undefined && v !== '') useful++;
    }
    return Math.min(1, useful / Math.max(keys.length, 1));
}

/**
 * Verify HMAC signature on _validation metadata (anti-MITM).
 */
function verifyServerValidation(validation) {
    if (!VALIDATION_SECRET || !validation || !validation.signature) return true; // skip if no secret
    const { signature, ...meta } = validation;
    const sorted = Object.keys(meta).sort().reduce((o, k) => { o[k] = meta[k]; return o; }, {});
    const expected = crypto.createHmac('sha256', VALIDATION_SECRET).update(JSON.stringify(sorted)).digest('hex');
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/**
 * Client-side verification of server validation + independent quality check.
 * Returns { ok, reason } — if !ok, service should be blacklisted.
 */
function clientSideVerify(result, serviceId) {
    if (!result || !result._x402 || !result._x402._validation) return { ok: true };
    const v = result._x402._validation;

    // A. Verify HMAC signature
    if (VALIDATION_SECRET && !verifyServerValidation(v)) {
        addToBlacklist(serviceId, 'signature_mismatch');
        return { ok: false, reason: 'signature_mismatch' };
    }

    // B. Independent quality cross-check
    const clientScore = quickClientScore(result.data || result);
    if (v.quality_score > 0.7 && clientScore < 0.2) {
        addToBlacklist(serviceId, 'score_discrepancy');
        return { ok: false, reason: 'score_discrepancy' };
    }

    return { ok: true };
}

// ─── Wallet (viem — multi-chain, no Coinbase CDP dependency) ────────
let account = null;
const chainClients = {}; // { base: { public, wallet }, skale: { public, wallet } }

const AUTO_WALLET_PATH = join(X402_DIR, 'wallet.json');

// ─── Wallet encryption helpers (AES-256-GCM, machine-bound key) ─────
function getMachineKey() {
    // Derive a stable 256-bit key from machine identifiers.
    // Synchronous: uses already-imported 'os' named exports.
    const raw = `${hostname()}:${userInfo().username}:${homedir()}`;
    return crypto.createHash('sha256').update(raw).digest();
}

function encryptPrivateKey(privateKey) {
    const key = getMachineKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        encrypted: encrypted.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
    };
}

function decryptPrivateKey(data) {
    const key = getMachineKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
    return decipher.update(Buffer.from(data.encrypted, 'hex')) + decipher.final('utf8');
}

function getPrivateKey() {
    // Fallback 1: env var
    if (process.env.AGENT_PRIVATE_KEY) {
        const key = process.env.AGENT_PRIVATE_KEY;
        return key.startsWith('0x') ? key : `0x${key}`;
    }

    // Fallback 2: Legacy encrypted agent-seed.json
    const seedPath = process.env.AGENT_SEED_PATH || join(__dirname, 'agent-seed.json');
    if (fs.existsSync(seedPath)) {
        const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const walletId = Object.keys(seedData)[0];
        const { seed, iv, authTag, encrypted } = seedData[walletId];

        let decryptedSeed = seed;
        if (encrypted) {
            const ed2curve = await_import_ed2curve();
            const apiSecret = process.env.COINBASE_API_SECRET;
            if (!apiSecret) throw new Error('COINBASE_API_SECRET required to decrypt wallet seed');
            const decoded = Buffer.from(apiSecret, 'base64');
            const x25519Key = ed2curve.convertSecretKey(new Uint8Array(decoded.slice(0, 32)));
            const encKey = crypto.createHash('sha256').update(Buffer.from(x25519Key)).digest();
            const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'hex'));
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            decryptedSeed = Buffer.concat([
                decipher.update(Buffer.from(seed, 'hex')),
                decipher.final(),
            ]).toString('utf8');
        }

        const { HDKey } = await_import_hdkey();
        const hdKey = HDKey.fromMasterSeed(Buffer.from(decryptedSeed, 'hex'));
        const childKey = hdKey.derive("m/44'/60'/0'/0/0");
        return '0x' + Buffer.from(childKey.privateKey).toString('hex');
    }

    // Fallback 3: Auto-generated wallet persisted in ~/.x402-bazaar/wallet.json
    if (fs.existsSync(AUTO_WALLET_PATH)) {
        const saved = JSON.parse(fs.readFileSync(AUTO_WALLET_PATH, 'utf-8'));

        // Backward compat: plaintext format → migrate transparently to encrypted format
        if (saved.privateKey) {
            console.error('[Wallet] Migrating plaintext wallet to encrypted format...');
            const encFields = encryptPrivateKey(saved.privateKey);
            const migratedData = {
                encrypted: encFields.encrypted,
                iv: encFields.iv,
                tag: encFields.tag,
                address: saved.address,
                createdAt: saved.createdAt,
                note: saved.note || 'Auto-generated wallet for x402 Bazaar MCP. Fund with USDC on Base to use paid APIs.',
            };
            fs.writeFileSync(AUTO_WALLET_PATH, JSON.stringify(migratedData, null, 2), { mode: 0o600 });
            console.error('[Wallet] Migration complete — private key is now encrypted at rest.');
            return saved.privateKey;
        }

        // Encrypted format: decrypt and return
        return decryptPrivateKey(saved);
    }

    // Generate a new wallet and persist it (encrypted)
    const rawKey = crypto.randomBytes(32);
    const privateKey = `0x${rawKey.toString('hex')}`;
    const generatedAccount = privateKeyToAccount(privateKey);
    // X402_DIR is guaranteed to exist (created at module load in budget section)
    const encFields = encryptPrivateKey(privateKey);
    const walletData = {
        encrypted: encFields.encrypted,
        iv: encFields.iv,
        tag: encFields.tag,
        address: generatedAccount.address,
        createdAt: new Date().toISOString(),
        note: 'Auto-generated wallet for x402 Bazaar MCP. Fund with USDC on SKALE on Base (recommended — ultra-low gas) or Base.',
    };
    fs.writeFileSync(AUTO_WALLET_PATH, JSON.stringify(walletData, null, 2), { mode: 0o600 });
    console.error(`[Wallet] Auto-generated new wallet: ${generatedAccount.address}`);
    console.error(`[Wallet] Encrypted wallet stored at ${AUTO_WALLET_PATH}`);
    console.error(`[Wallet] ── SKALE on Base (RECOMMENDED) ──`);
    console.error(`[Wallet]   Ultra-low gas (~$0.0007/tx). Best for AI agents.`);
    console.error(`[Wallet]   Pass chain: "skale" to any paid tool.`);
    console.error(`[Wallet]   CREDITS auto-funded on first setup_wallet call.`);
    console.error(`[Wallet]   Fund USDC: https://x402bazaar.org/fund`);
    console.error(`[Wallet]   Explorer: https://skale-base-explorer.skalenodes.com`);
    console.error(`[Wallet] ── Base ──────────────────────`);
    console.error(`[Wallet]   Alternative: higher gas but same USDC payments.`);
    return privateKey;
}

function initWallet() {
    if (account) return;
    const privateKey = getPrivateKey();
    account = privateKeyToAccount(privateKey);
    console.error(`[Wallet] Initialized: ${account.address}`);
}

function tryInitWallet() {
    try {
        initWallet();
        return null;
    } catch (err) {
        return err.message;
    }
}

function getClients(chainKey) {
    initWallet();
    if (!chainClients[chainKey]) {
        const cfg = CHAINS[chainKey];
        if (!cfg) throw new Error(`Unknown chain: ${chainKey}. Use: ${Object.keys(CHAINS).join(', ')}`);
        const transport = cfg.rpc ? http(cfg.rpc) : http();
        chainClients[chainKey] = {
            public: createPublicClient({ chain: cfg.chain, transport }),
            wallet: createWalletClient({ account, chain: cfg.chain, transport }),
        };
        console.error(`[Wallet] Connected to ${cfg.label}`);
    }
    return chainClients[chainKey];
}

// Synchronous require for CommonJS deps (works in ESM via createRequire)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
function await_import_ed2curve() { return require('ed2curve'); }
function await_import_hdkey() { return require('@scure/bip32'); }
const { normalize402, buildProofHeaders, buildUniversalProofHeaders } = require('./lib/protocolAdapter');

// ─── Error sanitization: remove sensitive paths, IPs, and addresses from errors ─
function sanitizeError(msg) {
    if (!msg) return 'Unknown error';
    return String(msg)
        // Remove Windows and Unix absolute paths
        .replace(/[A-Z]:\\[^\s]*/gi, '[path]')
        .replace(/\/[^\s]*\/[^\s]+/g, '[path]')
        // Redact IP addresses
        .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[redacted]')
        // Redact full Ethereum addresses (40+ hex chars after 0x)
        .replace(/0x[a-fA-F0-9]{40,}/g, '0x...')
        // Truncate to reasonable length
        .slice(0, 500);
}

// ─── Error enrichment: suggest bridge when payment fails ─────────────
const FUND_HINT = '\n💰 Need USDC? Bridge from any chain → SKALE in 1 click: https://x402bazaar.org/fund | Polygon: https://portal.polygon.technology/bridge';
function enrichPaymentError(msg) {
    const sanitized = sanitizeError(msg);
    const lower = sanitized.toLowerCase();
    if (lower.includes('insufficient') || lower.includes('revert') || lower.includes('balance') || lower.includes('budget limit')) {
        return sanitized + FUND_HINT;
    }
    return sanitized;
}

// ─── USDC Transfer Helper ────────────────────────────────────────────
async function sendUsdcTransfer(chainKey, toAddress, amountRaw) {
    const cfg = CHAINS[chainKey];
    const { public: pubClient, wallet: walClient } = getClients(chainKey);

    const txHash = await walClient.writeContract({
        address: cfg.usdc,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [toAddress, amountRaw],
        ...(chainKey === 'skale' ? { type: 'legacy' } : {}),
    });

    const receipt = await pubClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 2,
        timeout: 120_000,
    });

    if (receipt.status !== 'success') {
        throw new Error(`Transaction failed: ${txHash}`);
    }

    return txHash;
}

// ─── EIP-3009 TransferWithAuthorization (Polygon facilitator — off-chain, no gas) ──
async function signEIP3009Auth(walletClient, amount, to, validAfter, validBefore, chainKey = 'polygon') {
    const domain = EIP3009_DOMAINS[chainKey];
    if (!domain) {
        throw new Error(`EIP-3009 not supported on chain "${chainKey}". Supported: ${Object.keys(EIP3009_DOMAINS).join(', ')}`);
    }

    const nonce = '0x' + crypto.randomBytes(32).toString('hex');

    const types = {
        TransferWithAuthorization: [
            { name: 'from',       type: 'address' },
            { name: 'to',         type: 'address' },
            { name: 'value',      type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore',type: 'uint256' },
            { name: 'nonce',      type: 'bytes32' },
        ],
    };

    const message = {
        from:        account.address,
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
            from:        account.address,
            to,
            value:       amount.toString(),
            validAfter:  validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
        },
    };
}

function buildX402StandardPayload(signature, authorization, chainKey, normalized) {
    // Use resolved chainKey as authoritative network (already mapped from CAIP-2)
    const network = chainKey;
    const payload = {
        x402Version: 1,
        scheme: 'exact',
        network,
        payload: { signature, authorization },
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

// ─── fetchWithTimeout: wraps fetch with an AbortController timeout ───
// Usage: fetchWithTimeout(url, options, timeoutMs)
// On timeout: throws an Error with a clear message (no process crash).
// clearTimeout is called on success to avoid timer leaks.
function fetchWithTimeout(url, opts = {}, ms = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal })
        .then(res => { clearTimeout(timer); return res; })
        .catch(err => {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                throw new Error(`Request timed out after ${ms / 1000}s: ${url}`);
            }
            throw err;
        });
}

// ─── Facilitator Payment Flow (Polygon Phase 2 — gas-free EIP-3009) ──
//
// Standard x402 facilitator flow:
//   1. payAndRequest() gets 402 from our backend (already consumed)
//   2. Sign EIP-3009 TransferWithAuthorization off-chain (zero gas)
//   3. POST to facilitator /settle → facilitator executes on-chain (sponsors gas)
//   4. Get back tx hash from facilitator
//   5. Retry API call with X-Payment-TxHash (standard payment proof)
//
// Called from payAndRequest() when chainKey === 'polygon' AND facilitator is set.
// Returns { data, txHash } — caller handles spending tracking.
//
async function sendViaFacilitator(walletClient, apiUrl, fetchOptions, details, chainConfig) {
    const cost = parseFloat(details.amount);
    const decimals = chainConfig.decimals ?? 6;
    const amountRaw = BigInt(Math.round(cost * (10 ** decimals)));

    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    // Recipient: FeeSplitter contract (handles 95/5 split on-chain) or fallback
    const recipient = chainConfig.feeSplitterContract || details.recipient;

    // Step 1: Sign EIP-3009 TransferWithAuthorization off-chain (zero gas)
    const { signature, authorization } = await signEIP3009Auth(
        walletClient,
        amountRaw.toString(),
        recipient,
        validAfter,
        validBefore,
        'polygon',
    );

    // Step 2: Build x402 paymentPayload (Version 1, exact scheme, EVM)
    const paymentPayload = {
        x402Version: 1,
        scheme:      'exact',
        network:     'polygon',
        payload:     { signature, authorization },
    };

    const paymentRequirements = {
        scheme:             'exact',
        network:            'polygon',
        maxAmountRequired:  amountRaw.toString(),
        resource:           apiUrl,
        description:        'x402 Bazaar API payment',
        mimeType:           'application/json',
        payTo:              recipient,
        asset:              chainConfig.usdc,
        maxTimeoutSeconds:  60,
    };

    // Step 3: POST to facilitator /settle — facilitator executes on-chain
    const settleUrl = `${chainConfig.facilitator}/settle`;
    const settleRes = await fetchWithTimeout(settleUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    }, 15_000);

    const settleData = await settleRes.json();
    if (!settleData.success) {
        throw new Error(
            `Facilitator settlement failed: ${settleData.errorReason || 'unknown'} — ${settleData.errorMessage || JSON.stringify(settleData)}`
        );
    }

    const txHash = settleData.transaction;

    // Step 4: Retry the API call with the tx hash (standard payment proof)
    const retryHeaders = {
        ...fetchOptions.headers,
        'X-Payment-TxHash': txHash,
        'X-Payment-Chain':  chainConfig.paymentHeader,
        'X-Agent-Wallet':   account.address,
    };

    const retryRes = await fetchWithTimeout(apiUrl, { ...fetchOptions, headers: retryHeaders }, 15_000);

    // Parse response
    let data;
    if (fetchOptions.textFallback) {
        const text = await retryRes.text();
        try {
            data = JSON.parse(text);
        } catch {
            data = { response: text.slice(0, 5000) };
        }
    } else {
        data = await retryRes.json();
    }

    return { data, txHash };
}

// ─── Services cache (anti-bypass) ────────────────────────────────────
let servicesCache = null;
let servicesCacheTime = 0;
const SERVICES_CACHE_TTL = 60_000; // 60s

async function getCachedServices() {
    if (servicesCache && Date.now() - servicesCacheTime < SERVICES_CACHE_TTL) {
        return servicesCache;
    }
    const res = await fetchWithTimeout(`${SERVER_URL}/api/services`, {}, 15_000);
    const data = await res.json();
    servicesCache = data.data || data.services || [];
    servicesCacheTime = Date.now();
    return servicesCache;
}

// ─── x402 Payment Flow (multi-chain, split-aware) ────────────────────
//
// Options:
//   - Standard fetch options (method, headers, body, etc.)
//   - textFallback {boolean}: if true, the retry response is parsed as text
//     with JSON.parse() + fallback to { response: text }, instead of strict
//     res.json(). Use this when the API may return non-JSON on success.
//
async function payAndRequest(url, options = {}, chainKey = DEFAULT_CHAIN_KEY) {
    const { textFallback = false, ...fetchOptions } = options;

    // ── Smart Chain: resolve 'auto' before proceeding ─────────────────
    let resolvedChainKey = chainKey;
    let autoChainWarning = null;
    if (chainKey === 'auto') {
        // We need to probe for the price first
        const probeRes = await fetchWithTimeout(url, { ...fetchOptions, headers: { ...fetchOptions.headers } }, 15_000);
        if (probeRes.status === 402) {
            let probeBody;
            try { probeBody = await probeRes.json(); } catch { probeBody = {}; }
            const probeNormalized = normalize402(probeRes.status, Object.fromEntries(probeRes.headers), probeBody);
            const cost = parseFloat(probeNormalized.amount || '0.01');
            const selection = await selectBestChain(cost);
            if (selection.error) {
                throw new Error(selection.error);
            }
            resolvedChainKey = selection.chain;
            autoChainWarning = selection.warning;
        } else {
            // Not a paid endpoint — any chain works, use default
            resolvedChainKey = DEFAULT_CHAIN_KEY;
            // Return the non-402 response directly
            if (textFallback) {
                const text = await probeRes.text();
                try { return JSON.parse(text); } catch { return { response: text.slice(0, 5000) }; }
            }
            return probeRes.json();
        }
    }

    // Always send X-Payment-Chain on the initial request so the backend
    // returns the correct payment_mode (e.g. 'fee_splitter' for Polygon).
    // X-Agent-Wallet enables auto-refund when the upstream returns garbage.
    const cfg = CHAINS[resolvedChainKey];
    const initialHeaders = {
        ...fetchOptions.headers,
        'X-Payment-Chain': cfg ? cfg.paymentHeader : resolvedChainKey,
        'X-Agent-Wallet': account.address,
    };
    const res = await fetchWithTimeout(url, { ...fetchOptions, headers: initialHeaders }, 15_000);

    // ── Non-402 response ──────────────────────────────────────────────
    if (res.status !== 402) {
        if (textFallback) {
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch {
                return { response: text.slice(0, 5000) };
            }
        }
        return res.json();
    }

    // ── HTTP 402 — Payment Required ───────────────────────────────────
    let body;
    try { body = await res.json(); } catch { body = {}; }

    const normalized = normalize402(res.status, Object.fromEntries(res.headers), body);

    // Layer 4: Auto-Discovery — log unregistered 402 APIs (fire-and-forget)
    const discoveryUrl = url;
    const lastDisc = discoveryThrottle.get(discoveryUrl);
    if (!lastDisc || Date.now() - lastDisc > DISCOVERY_THROTTLE_MS) {
        discoveryThrottle.set(discoveryUrl, Date.now());
        const rawStr = JSON.stringify(normalized.raw);
        const truncRaw = rawStr.length > 10240 ? null : normalized.raw;
        fetch(`${SERVER_URL}/api/discovered-apis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: discoveryUrl, format: normalized.format,
                amount: normalized.amount, currency: normalized.currency,
                recipient: normalized.recipient, chain: normalized.chain,
                agent_address: account?.address || null, raw_response: truncRaw,
            }),
            signal: AbortSignal.timeout(5000),
        }).catch(err => mcpLog.warn('MCP', `Discovery insert failed: ${err.message}`));
    }

    if (!normalized.payable) {
        throw new Error(JSON.stringify({
            error: '402 detected but payment not supported',
            format: normalized.format,
            message: `Protocol "${normalized.format}" detected but automatic USDC payment is not available.`,
            details: {
                amount: normalized.amount, currency: normalized.currency, recipient: normalized.recipient,
                ...(normalized.l402Invoice && { invoice: normalized.l402Invoice }),
                ...(normalized.mppMethod && { method: normalized.mppMethod }),
            },
            detectionPath: normalized.detectionPath,
        }));
    }
    if (!normalized.amount || !normalized.recipient) {
        throw new Error(`402 "${normalized.format}" missing amount or recipient: ${JSON.stringify(body)}`);
    }

    const cost = parseFloat(normalized.amount);
    const details = body.payment_details || {}; // backward compat for split_native + facilitator

    // Budget check
    if (sessionSpending + cost > MAX_BUDGET) {
        throw new Error(
            `Budget limit reached. Spent: ${sessionSpending.toFixed(2)} USDC / ${MAX_BUDGET.toFixed(2)} USDC. ` +
            `This call costs ${cost} USDC. ` +
            `To increase the limit, set MAX_BUDGET_USDC=X in your MCP config environment (e.g. MAX_BUDGET_USDC=5).`
        );
    }

    // cfg already resolved above (before initial fetch)
    const isSplitMode = normalized.paymentMode === 'split_native' || normalized.paymentMode === 'split_platform';
    const isExternalSplit = normalized.paymentMode === 'split_platform';
    let retryHeaders;

    if (isExternalSplit) {
        // ── External split: 100% to provider + platform fee ──────────────

        // If the provider specifies a chain, we MUST pay on that chain.
        const externalChain = normalized.chain;
        if (externalChain && CHAINS[externalChain] && externalChain !== resolvedChainKey) {
            mcpLog.info('MCP', `split_platform: provider requires chain "${externalChain}", overriding agent choice "${resolvedChainKey}"`);
            resolvedChainKey = externalChain;
        } else if (externalChain && !CHAINS[externalChain]) {
            throw new Error(`Provider requires payment on chain "${externalChain}" which is not supported. Supported: ${Object.keys(CHAINS).join(', ')}`);
        }

        const providerRaw = usdcToRaw(cost, resolvedChainKey);
        const platformFeeRaw = providerRaw * 5n / 95n;
        const totalCostRaw = providerRaw + platformFeeRaw;
        const totalCost = Number(totalCostRaw) / 1e6;

        if (sessionSpending + totalCost > MAX_BUDGET) {
            throw new Error(`Budget exceeded. Cost: ${totalCost.toFixed(4)} USDC (${cost} + ${(totalCost - cost).toFixed(4)} fee), remaining: ${(MAX_BUDGET - sessionSpending).toFixed(4)} USDC`);
        }

        // ── Route based on protocol type ──────────────────────────────────
        const isX402Standard = normalized.protocolType === 'x402-standard' && EIP3009_DOMAINS[resolvedChainKey];
        if (normalized.protocolType === 'x402-standard' && !EIP3009_DOMAINS[resolvedChainKey]) {
            mcpLog.info('MCP', `split_platform: x402-standard detected but chain "${resolvedChainKey}" has no EIP-3009 — falling back to direct transfer`);
        }
        let extResult;
        let txHashProvider;
        let retryAttempt = 0;
        let retryStatus;

        if (isX402Standard) {
            // ═══ x402 STANDARD PATH: EIP-3009 signature ═══
            mcpLog.info('MCP', `split_platform:x402-standard: signing EIP-3009 for ${cost} USDC on ${resolvedChainKey}`);

            // Amount: prefer maxAmountRequired (atomic), fallback to parsed amount
            const amountAtomic = normalized.maxAmountRequired
                ? BigInt(normalized.maxAmountRequired)
                : providerRaw;
            const recipient = normalized.payTo || normalized.providerWallet;
            const validAfter = 0;
            const validBefore = Math.floor(Date.now() / 1000) + Math.max(normalized.maxTimeoutSeconds || 60, 60);

            const { wallet: walClient } = getClients(resolvedChainKey);
            const { signature, authorization } = await signEIP3009Auth(
                walClient, amountAtomic.toString(), recipient, validAfter, validBefore, resolvedChainKey
            );

            // Build X-PAYMENT header (x402 v1 standard format)
            const xPayment = buildX402StandardPayload(signature, authorization, resolvedChainKey, normalized);

            // Send request with X-PAYMENT header
            const x402Headers = {
                ...fetchOptions.headers,
                'X-PAYMENT': xPayment,
                'X-Agent-Wallet': account.address,
            };

            const x402Res = await fetchWithTimeout(url, { ...fetchOptions, headers: x402Headers }, 30_000);
            retryStatus = x402Res.status;
            retryAttempt = 1;
            txHashProvider = `eip3009:${signature.slice(0, 18)}`;

            // Parse response
            if (textFallback) {
                const text = await x402Res.text();
                try { extResult = JSON.parse(text); } catch { extResult = { response: text.slice(0, 5000) }; }
            } else {
                extResult = await x402Res.json();
            }

            // TX2: platform fee (fire-and-forget)
            if (platformFeeRaw >= 100n) {
                sendUsdcTransfer(resolvedChainKey, process.env.WALLET_ADDRESS, platformFeeRaw)
                    .catch(err => mcpLog.warn('MCP', `split_platform:x402-standard TX2 fee failed: ${err.message}`));
            }

        } else {
            // ═══ DIRECT PATH: transfer + universal proof headers ═══
            txHashProvider = await sendUsdcTransfer(resolvedChainKey, normalized.providerWallet, providerRaw);

            // TX2: platform fee (fire-and-forget)
            if (platformFeeRaw >= 100n) {
                sendUsdcTransfer(resolvedChainKey, process.env.WALLET_ADDRESS, platformFeeRaw)
                    .catch(err => mcpLog.warn('MCP', `split_platform TX2 fee failed: ${err.message}`));
            }

            // Build UNIVERSAL proof headers
            const proof = buildUniversalProofHeaders(normalized, txHashProvider, resolvedChainKey, account.address);
            if (!proof.supported) throw new Error(proof.message);

            // Progressive retry with exponential backoff
            const RETRY_DELAYS = [2000, 5000, 8000];
            const extRetryHeaders = { ...fetchOptions.headers, ...proof.headers };
            let extRetryRes;

            for (const delay of RETRY_DELAYS) {
                await new Promise(r => setTimeout(r, delay));
                retryAttempt++;
                extRetryRes = await fetchWithTimeout(url, { ...fetchOptions, headers: extRetryHeaders }, 15_000);
                if (extRetryRes.status !== 402) {
                    mcpLog.info('MCP', `split_platform: retry ${retryAttempt} succeeded (HTTP ${extRetryRes.status})`);
                    break;
                }
                mcpLog.info('MCP', `split_platform: retry ${retryAttempt}/${RETRY_DELAYS.length} still 402 — waiting longer...`);
            }

            retryStatus = extRetryRes.status;
            if (textFallback) {
                const retryText = await extRetryRes.text();
                try { extResult = JSON.parse(retryText); } catch { extResult = { response: retryText.slice(0, 5000) }; }
            } else {
                extResult = await extRetryRes.json();
            }
        }

        // ── Common: update session + enrich result ────────────────────────
        sessionSpending += totalCost;
        if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] = Math.max(0, balanceCache[resolvedChainKey] - totalCost);
        sessionPayments.push({
            amount: totalCost,
            txHash: txHashProvider,
            chain: resolvedChainKey,
            splitMode: 'split_platform',
            protocol: isX402Standard ? 'x402-standard' : 'direct',
            timestamp: new Date().toISOString(),
            endpoint: url.replace(SERVER_URL, ''),
        });
        saveBudgetToDisk();

        extResult._payment = {
            amount: cost.toString(),
            platformFee: (totalCost - cost).toFixed(4),
            currency: 'USDC',
            txHash: txHashProvider,
            splitMode: 'split_platform',
            protocol: isX402Standard ? 'x402-standard' : 'direct',
            method: isX402Standard ? 'eip3009' : 'direct_transfer',
            chain: cfg.label,
            explorer: isX402Standard ? null : `${cfg.explorer}/tx/${txHashProvider}`,
            session_spent: sessionSpending.toFixed(2),
            session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
            retry_status: retryStatus,
            retry_attempts: retryAttempt,
            proof_format: normalized.format,
            signature_sent: isX402Standard ? true : undefined,
            proof_headers_sent: isX402Standard ? ['X-PAYMENT', 'X-Agent-Wallet'] : undefined,
        };

        if (retryStatus === 402 && isX402Standard) {
            extResult._payment.warning = 'EIP-3009 signature was sent via X-PAYMENT header. ' +
                'If the provider facilitator settled the payment, USDC has left your wallet. ' +
                'Contact the provider with the signature for resolution.';
        } else if (retryStatus === 402) {
            extResult._payment.warning = 'Payment sent on-chain but provider still returned 402 after retries. ' +
                'Your USDC was sent — contact the provider with the txHash for manual resolution.';
        }

        if (autoChainWarning) extResult._payment.auto_chain_warning = autoChainWarning;
        if (chainKey === 'auto') extResult._payment.auto_selected_chain = resolvedChainKey;
        return extResult;
    } else if (isSplitMode) {
        // ── Standard split: two sendUsdcTransfer calls (Base / SKALE) ──
        const totalRaw = usdcToRaw(cost, resolvedChainKey);
        const providerRaw = details.split
            ? usdcToRaw(parseFloat(details.split.provider_amount), resolvedChainKey)
            : totalRaw * 95n / 100n;
        const platformRaw = totalRaw - providerRaw;

        // Send 95% to provider
        const txHashProvider = await sendUsdcTransfer(resolvedChainKey, details.provider_wallet, providerRaw);

        // Send 5% to platform (best-effort)
        let txHashPlatform = null;
        try {
            txHashPlatform = await sendUsdcTransfer(resolvedChainKey, details.recipient, platformRaw);
        } catch (err) {
            mcpLog.warn('MCP', `Split: platform payment failed (fallback to pending payout): ${err.message}`);
        }

        // Track spending
        sessionSpending += cost;
        // Update balance cache after payment
        if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] = Math.max(0, balanceCache[resolvedChainKey] - cost);
        sessionPayments.push({
            amount: cost,
            txHash: txHashProvider,
            txHashPlatform,
            chain: resolvedChainKey,
            splitMode: txHashPlatform ? 'split_complete' : 'provider_only',
            timestamp: new Date().toISOString(),
            endpoint: url.replace(SERVER_URL, ''),
        });
        saveBudgetToDisk();

        retryHeaders = {
            ...fetchOptions.headers,
            'X-Payment-TxHash-Provider': txHashProvider,
            'X-Payment-Chain': cfg.paymentHeader,
            'X-Agent-Wallet': account.address,
        };
        if (txHashPlatform) {
            retryHeaders['X-Payment-TxHash-Platform'] = txHashPlatform;
        }
    } else {
        // ── Legacy mode: single transfer to platform (or facilitator for Polygon) ──
        const amountInUnits = usdcToRaw(cost, resolvedChainKey);

        // Use facilitator for ALL Polygon payments when available (gas-free flow).
        // The backend handles distribute() after verification — even for native wrappers,
        // distribute(WALLET_ADDRESS, amount) sends 100% to platform (95%+5% same wallet).
        const facilitatorUrl = cfg.facilitator || details.facilitator || null;

        if (facilitatorUrl) {
            // Polygon Phase 2 — EIP-3009 gas-free via facilitator /settle
            const { wallet: walClient } = getClients(resolvedChainKey);
            const effectiveChainConfig = { ...cfg, facilitator: facilitatorUrl };
            const { data: result, txHash: facilitatorTxHash } = await sendViaFacilitator(walClient, url, fetchOptions, details, effectiveChainConfig);

            // Track spending
            sessionSpending += cost;
            // Update balance cache after payment
            if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] = Math.max(0, balanceCache[resolvedChainKey] - cost);
            sessionPayments.push({
                amount: cost,
                txHash: facilitatorTxHash,
                chain: resolvedChainKey,
                paymentMode: 'facilitator',
                timestamp: new Date().toISOString(),
                endpoint: url.replace(SERVER_URL, ''),
            });
            saveBudgetToDisk();

            // Consumer protection: handle refunded for facilitator
            if (result && result._payment_status === 'refunded') {
                const facPayment = sessionPayments[sessionPayments.length - 1];
                sessionSpending = Math.max(0, sessionSpending - cost);
                if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] += cost;
                facPayment.status = 'refunded';
                facPayment.refundTxHash = result._x402?.refund_tx_hash || null;
                mcpLog.info('MCP', `Payment: facilitator response refunded — ${cost} USDC returned on-chain`);
                const facRefundMatch = url.match(/\/api\/call\/([0-9a-f-]{36})/i);
                if (facRefundMatch) addToBlacklist(facRefundMatch[1], 'refunded_bad_response');
                result._payment = {
                    amount: details.amount, currency: 'USDC', status: 'refunded',
                    paymentMode: 'facilitator',
                    refund_tx_hash: result._x402?.refund_tx_hash,
                    refund_wallet: result._x402?.refund_wallet,
                    chain: cfg.label,
                    session_spent: sessionSpending.toFixed(2),
                    session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
                };
                if (autoChainWarning) result._payment.auto_chain_warning = autoChainWarning;
                if (chainKey === 'auto') result._payment.auto_selected_chain = resolvedChainKey;
                return result;
            }

            // Consumer protection: handle not_charged for facilitator
            if (result && result._payment_status === 'not_charged') {
                const facPayment = sessionPayments[sessionPayments.length - 1];
                sessionSpending = Math.max(0, sessionSpending - cost);
                if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] += cost;
                facPayment.status = 'not_charged';
                mcpLog.info('MCP', `Payment: facilitator response not_charged — budget refunded`);
                result._payment = {
                    amount: details.amount, currency: 'USDC', status: 'not_charged',
                    paymentMode: 'facilitator', chain: cfg.label,
                    session_spent: sessionSpending.toFixed(2),
                    session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
                };
                if (autoChainWarning) result._payment.auto_chain_warning = autoChainWarning;
                if (chainKey === 'auto') result._payment.auto_selected_chain = resolvedChainKey;
                return result;
            }

            // Enrich result with payment info and return early
            result._payment = {
                amount:            details.amount,
                currency:          'USDC',
                paymentMode:       'facilitator',
                facilitator:       facilitatorUrl,
                txHash:            facilitatorTxHash,
                chain:             cfg.label,
                session_spent:     sessionSpending.toFixed(2),
                session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
            };
            if (autoChainWarning) result._payment.auto_chain_warning = autoChainWarning;
            if (chainKey === 'auto') result._payment.auto_selected_chain = resolvedChainKey;
            return result;
        }

        // Check for reusable tx hash from a previous not_charged response
        const reusable = findReusableHash(resolvedChainKey, cost);
        if (reusable) {
            mcpLog.info('MCP', `Payment: reusing tx hash from previous not_charged response (${reusable.amount} USDC on ${resolvedChainKey})`);
            retryHeaders = reusable.headers;
            sessionPayments.push({
                amount: cost,
                txHash: reusable.txHash,
                chain: resolvedChainKey,
                reused: true,
                timestamp: new Date().toISOString(),
                endpoint: url.replace(SERVER_URL, ''),
            });
            // Don't increment sessionSpending — it was already counted when first sent
        } else {
            // Standard on-chain transfer (Base / SKALE)
            const txHash = await sendUsdcTransfer(resolvedChainKey, details.recipient, amountInUnits);

            // Track spending
            sessionSpending += cost;
            // Update balance cache after payment
            if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] = Math.max(0, balanceCache[resolvedChainKey] - cost);
            sessionPayments.push({
                amount: cost,
                txHash,
                chain: resolvedChainKey,
                timestamp: new Date().toISOString(),
                endpoint: url.replace(SERVER_URL, ''),
            });
            saveBudgetToDisk();

            retryHeaders = { ...fetchOptions.headers };
            const proof = buildProofHeaders(normalized, txHash, resolvedChainKey, account.address);
            Object.assign(retryHeaders, proof.headers);
        }
    }

    // Retry with payment proof
    const retryRes = await fetchWithTimeout(url, { ...fetchOptions, headers: retryHeaders }, 15_000);

    // Parse retry response: use text+fallback when requested (call_api path)
    let result;
    if (textFallback) {
        const retryText = await retryRes.text();
        try {
            result = JSON.parse(retryText);
        } catch {
            result = { response: retryText.slice(0, 5000) };
        }
    } else {
        result = await retryRes.json();
    }

    // Consumer protection: only for Bazaar-native APIs (not external split_platform)
    const lastPayment = sessionPayments[sessionPayments.length - 1];
    if (!isExternalSplit) {
        // Consumer protection: handle refunded responses (auto-refund engine)
        if (result && result._payment_status === 'refunded') {
            if (lastPayment && !lastPayment.reused) {
                // USDC returned on-chain — reverse budget tracking
                sessionSpending = Math.max(0, sessionSpending - cost);
                if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] += cost;
                lastPayment.status = 'refunded';
                lastPayment.refundTxHash = result._x402?.refund_tx_hash || null;
                // DO NOT add to reusableHashes — tx consumed, USDC returned on-chain
                mcpLog.info('MCP', `Payment: response refunded — ${cost} USDC returned on-chain (tx: ${lastPayment.refundTxHash?.slice(0, 18) || 'n/a'})`);
            }
            // Blacklist service (still delivered garbage)
            // Extract serviceId from proxy URL (e.g., /api/call/uuid)
            const refundServiceMatch = url.match(/\/api\/call\/([0-9a-f-]{36})/i);
            if (refundServiceMatch) addToBlacklist(refundServiceMatch[1], 'refunded_bad_response');

            result._payment = {
                amount: details.amount, currency: 'USDC', status: 'refunded',
                refund_tx_hash: result._x402?.refund_tx_hash,
                refund_wallet: result._x402?.refund_wallet,
                chain: cfg.label,
                session_spent: sessionSpending.toFixed(2),
                session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
            };
            if (autoChainWarning) result._payment.auto_chain_warning = autoChainWarning;
            if (chainKey === 'auto') result._payment.auto_selected_chain = resolvedChainKey;
            return result;
        }

        // Consumer protection: handle not_charged responses (session 79)
        if (result && result._payment_status === 'not_charged') {
            if (lastPayment && !lastPayment.reused) {
                // Refund the budget — this payment wasn't consumed
                sessionSpending = Math.max(0, sessionSpending - cost);
                // Restore balance cache (USDC is on-chain but tx hash is reusable)
                if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] += cost;
                lastPayment.status = 'not_charged';
                lastPayment.reusable = true;

                // Store for reuse (legacy mode only — split has specific recipients)
                if (!lastPayment.splitMode) {
                    reusableHashes.push({
                        txHash: lastPayment.txHash,
                        amount: lastPayment.amount,
                        chain: lastPayment.chain,
                        headers: retryHeaders,
                        timestamp: Date.now(),
                    });
                    mcpLog.info('MCP', `Payment: response not_charged — tx hash stored for reuse (pool: ${reusableHashes.length})`);
                }
            }

            // Enrich response with reuse info
            result._payment = {
                amount: details.amount,
                currency: 'USDC',
                status: 'not_charged',
                reusable_tx_hash: true,
                txHash: lastPayment.txHash,
                chain: cfg.label,
                session_spent: sessionSpending.toFixed(2),
                session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
            };
            if (autoChainWarning) result._payment.auto_chain_warning = autoChainWarning;
            if (chainKey === 'auto') result._payment.auto_selected_chain = resolvedChainKey;
            return result;
        }
    }

    // Handle reused hash that succeeded — count spending now
    if (lastPayment && lastPayment.reused) {
        sessionSpending += cost;
        if (balanceCache.updatedAt > 0) balanceCache[resolvedChainKey] = Math.max(0, balanceCache[resolvedChainKey] - cost);
    }

    // Enrich result with payment info
    result._payment = {
        amount: details.amount,
        currency: 'USDC',
        txHash: lastPayment.txHash,
        ...(lastPayment.txHashPlatform ? { txHashPlatform: lastPayment.txHashPlatform } : {}),
        ...(lastPayment.splitMode ? { splitMode: lastPayment.splitMode } : {}),
        chain: cfg.label,
        explorer: `${cfg.explorer}/tx/${lastPayment.txHash}`,
        session_spent: sessionSpending.toFixed(2),
        session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
    };
    if (autoChainWarning) result._payment.auto_chain_warning = autoChainWarning;
    if (chainKey === 'auto') result._payment.auto_selected_chain = resolvedChainKey;

    return result;
}

// ─── MCP Logger (stderr JSON — stdout reserved for MCP protocol) ────
const mcpLog = {
    _write(level, ctx, msg, extra = {}) {
        const entry = JSON.stringify({ ts: new Date().toISOString(), level, ctx, msg, ...extra });
        process.stderr.write(entry + '\n');
    },
    debug(ctx, msg, extra) { mcpLog._write('debug', ctx, msg, extra); },
    info(ctx, msg, extra)  { mcpLog._write('info', ctx, msg, extra); },
    warn(ctx, msg, extra)  { mcpLog._write('warn', ctx, msg, extra); },
    error(ctx, msg, extra) { mcpLog._write('error', ctx, msg, extra); },
};

// ─── Service card helper: consistent shape across all discovery tools ─
/**
 * Map a raw service record from the backend to a compact card for MCP output.
 * Used by search_services, list_services, discover_marketplace, find_tool_for_task.
 */
function formatServiceCard(s, { includeOwner = false } = {}) {
    const card = {
        id: s.id,
        name: s.name,
        description: s.description,
        price_usdc: s.price_usdc,
        tags: s.tags || [],
        status: s.status || 'unknown',
    };
    if (includeOwner) card.owner_address = s.owner_address;
    return card;
}

// ─── MCP Server ─────────────────────────────────────────────────────
const server = new McpServer({
    name: 'x402-bazaar',
    version: '2.6.0',
});

// --- Tool: discover_marketplace (FREE) ---
server.tool(
    'discover_marketplace',
    'Discover the x402 Bazaar marketplace. Returns marketplace info, top 10 popular services, and available categories. Free — no payment needed. Start here to understand what APIs are available.',
    {},
    async () => {
        try {
            // Fetch marketplace root info + top services in parallel
            const [rootRes, topRes] = await Promise.allSettled([
                fetchWithTimeout(SERVER_URL, {}, 15_000),
                fetchWithTimeout(`${SERVER_URL}/api/services?limit=10`, {}, 15_000),
            ]);

            const rootData = rootRes.status === 'fulfilled' ? await rootRes.value.json() : {};

            let topServices = [];
            let categories = [];
            if (topRes.status === 'fulfilled') {
                const topData = await topRes.value.json();
                const raw = topData.data || topData.services || topData || [];
                topServices = Array.isArray(raw) ? raw.slice(0, 10).map(s => ({
                    ...formatServiceCard(s),
                    action: s.id
                        ? `call_service("${s.id}") — ${s.price_usdc} USDC`
                        : `call_api("${s.url}")`,
                })) : [];

                // Extract unique categories from tags
                const tagSet = new Set();
                for (const s of raw) {
                    if (Array.isArray(s.tags)) s.tags.forEach(t => tagSet.add(t));
                    else if (s.category) tagSet.add(s.category);
                }
                categories = [...tagSet].sort().slice(0, 30);
            }

            return {
                content: [{ type: 'text', text: JSON.stringify({
                    marketplace: {
                        name: 'x402 Bazaar',
                        description: 'Autonomous API marketplace for AI agents — pay per call with USDC, no subscriptions.',
                        base_url: SERVER_URL,
                        protocol: 'x402 (HTTP 402 + on-chain USDC payment)',
                        chains_supported: ['SKALE on Base (ultra-low gas ~$0.0007)', 'Base', 'Polygon'],
                        split: '95% to API provider / 5% platform fee',
                        ...rootData,
                    },
                    top_10_services: topServices,
                    available_categories: categories,
                    quick_start: [
                        '1. Call search_services("keyword") or list_services() to find APIs — FREE',
                        '2. Call get_service_schema(id) to see required parameters — FREE',
                        '3. Call call_service(id, body) to invoke the API — costs price_usdc USDC',
                        '4. Call get_wallet_balance() to check your USDC balance',
                        '5. Call setup_wallet() if you need to configure your wallet',
                    ],
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: search_services (FREE) ---
server.tool(
    'search_services',
    'Search for API services on x402 Bazaar by keyword. Free — no payment required. Use this to explore available APIs before calling them.',
    {
        query: z.string().describe('Search keyword (e.g. "weather", "crypto", "ai")'),
    },
    async ({ query }) => {
        mcpLog.info('MCP', `tool:search_services query="${query}"`);
        try {
            const res = await fetchWithTimeout(
                `${SERVER_URL}/api/services?search=${encodeURIComponent(query)}`,
                {},
                15_000,
            );
            const data = await res.json();
            const services = data.data || data.services || data || [];
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    query,
                    count: Array.isArray(services) ? services.length : 0,
                    services: Array.isArray(services) ? services.map(s => formatServiceCard(s)) : services,
                    hint: 'Use call_service(id) to call a service, or get_service_schema(id) to inspect parameters.',
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: list_services (FREE) ---
server.tool(
    'list_services',
    'List all API services available on x402 Bazaar. Free — no payment required. Filter by category or chain to narrow results.',
    {
        category: z.string().optional().describe('Optional category filter (e.g. "ai", "weather", "finance", "tools")'),
        chain: z.enum(['base', 'skale', 'polygon']).optional().describe('Optional chain filter'),
        limit: z.number().min(1).max(100).optional().describe('Max number of results (default: 50)'),
    },
    async ({ category, chain: chainFilter, limit = 50 }) => {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (category) params.set('category', category);
            if (chainFilter) params.set('chain', chainFilter);

            const res = await fetchWithTimeout(
                `${SERVER_URL}/api/services?${params.toString()}`,
                {},
                15_000,
            );
            const data = await res.json();
            const services = data.data || data.services || data || [];
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    count: Array.isArray(services) ? services.length : 0,
                    services: Array.isArray(services) ? services.map(s => formatServiceCard(s, { includeOwner: true })) : services,
                    hint: 'Use call_service(id) to call a service, or get_service_schema(id) to inspect parameters before paying.',
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: get_service_schema (FREE — inspect API parameters before paying) ---
server.tool(
    'get_service_schema',
    'Get the full schema of a Bazaar service: name, description, required parameters, price, tags, and status. Free — no payment required. Use this before call_service to understand what parameters are needed.',
    {
        service_id: z.string().uuid().describe('The service UUID (from list_services, search_services, or find_tool_for_task)'),
    },
    async ({ service_id }) => {
        try {
            const res = await fetchWithTimeout(`${SERVER_URL}/api/services/${service_id}`, {}, 15_000);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: `Service not found (HTTP ${res.status})`,
                        service_id,
                        details: errData.error || errData.message || '',
                    }, null, 2) }],
                    isError: true,
                };
            }
            const s = await res.json();
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    endpoint_url: s.url,
                    price_usdc: s.price_usdc,
                    tags: s.tags || [],
                    status: s.status || 'unknown',
                    last_checked_at: s.last_checked_at || null,
                    payment_protocol: s.payment_protocol || 'x402-bazaar',
                    required_parameters: s.required_parameters || null,
                    owner_address: s.owner_address,
                    hint: s.required_parameters?.required?.length
                        ? `Pass these required params in call_service body: ${s.required_parameters.required.join(', ')}`
                        : 'No required parameters — call with empty body or pass optional params.',
                    action: `call_service("${s.id}", { /* params */ }) — costs ${s.price_usdc} USDC`,
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: find_tool_for_task (FREE — smart service lookup via free search) ---
server.tool(
    'find_tool_for_task',
    'Describe what you need in plain English and get the top 3 matching API services ready to call. Free — uses the free search endpoint. Much faster than browsing manually.',
    {
        task: z.string().describe('What you need, in natural language (e.g. "get current weather for a city", "translate text to French", "get Bitcoin price")'),
    },
    async ({ task }) => {
        try {
            const res = await fetchWithTimeout(
                `${SERVER_URL}/api/services?search=${encodeURIComponent(task)}`,
                {},
                15_000,
            );
            const data = await res.json();
            const services = data.data || data.services || data || [];

            if (!Array.isArray(services) || services.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        found: false,
                        query_used: task,
                        message: `No services found matching "${task}". Try rephrasing or use search_services with different keywords.`,
                    }, null, 2) }],
                };
            }

            const polygonFacilitatorHint = CHAINS.polygon.facilitator
                ? ' Polygon gas-free payments available (set chain: "polygon").'
                : '';

            const buildResult = (s, role) => {
                const statusWarning = s.status === 'offline'
                    ? ' WARNING: This service is currently OFFLINE — payment may be wasted.'
                    : s.status === 'degraded'
                        ? ' This service is DEGRADED (partial responses).'
                        : '';
                return {
                    role,
                    ...formatServiceCard(s),
                    action: s.id
                        ? `call_service("${s.id}") — ${s.price_usdc} USDC${statusWarning}${polygonFacilitatorHint}`
                        : `call_api("${s.url}") — ${Number(s.price_usdc) === 0 ? 'free' : s.price_usdc + ' USDC'}${statusWarning}`,
                };
            };

            const top3 = services.slice(0, 3);
            const results = top3.map((s, i) =>
                buildResult(s, i === 0 ? 'recommended' : `alternative_${i}`)
            );

            return {
                content: [{ type: 'text', text: JSON.stringify({
                    found: true,
                    query_used: task,
                    total_matches: services.length,
                    results,
                    hint: 'Use get_service_schema(id) to inspect required parameters before calling. Then use call_service(id, body) to invoke.',
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: call_service (proxy route — supports 95/5 split payment) ---
server.tool(
    'call_service',
    `Call a Bazaar service through the platform proxy. This route enables native 95/5 revenue split: 95% goes directly to the API provider on-chain, 5% platform fee. Use this instead of call_api when calling Bazaar services by ID. Budget: ${MAX_BUDGET.toFixed(2)} USDC per session.`,
    {
        service_id: z.string().uuid().describe('The service UUID (from list_services or search_services)'),
        body: z.union([z.record(z.unknown()), z.string()]).optional().describe('Optional request body — pass a JSON object (preferred) or a JSON string. Example: {"query": "hello"} or \'{"query":"hello"}\''),
        chain: z.enum(['auto', 'base', 'skale', 'polygon']).optional().describe('Payment chain. "auto" (default) picks the cheapest chain with sufficient balance.'),
    },
    async ({ service_id, body: rawBody, chain: chainKey }) => {
        // Accept object or string; always pass a JSON string to the HTTP layer
        const requestBody = rawBody == null ? null
            : typeof rawBody === 'object' ? JSON.stringify(rawBody)
            : rawBody; // already a string — backward compat

        const selectedChain = chainKey || 'auto';
        mcpLog.info('MCP', `tool:call_service id=${service_id} chain=${selectedChain}`, { hasBody: !!requestBody });
        try {
            // --- BLACKLIST CHECK: block temporarily blacklisted services ---
            const blacklisted = isBlacklisted(service_id);
            if (blacklisted) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: 'Service temporarily blocked',
                        service_id,
                        reason: blacklisted.reason,
                        blocked_until: new Date(blacklisted.until).toISOString(),
                        message: `ALERT: Service '${service_id}' is temporarily blocked (reason: ${blacklisted.reason}). You were NOT charged. This service is blocked for 10 minutes. Recommendation: Use find_tool_for_task to find an alternative API.`,
                    }, null, 2) }],
                    isError: true,
                };
            }

            // --- GATEKEEPER: validate required params + status BEFORE payment ---
            let serviceName = service_id;
            try {
                const infoRes = await fetchWithTimeout(`${SERVER_URL}/api/services/${service_id}`, {}, 15_000);
                if (infoRes.ok) {
                    const serviceInfo = await infoRes.json();
                    serviceName = serviceInfo.name || service_id;

                    // Warn if service is offline (prevent USDC waste)
                    if (serviceInfo.status === 'offline') {
                        return {
                            content: [{ type: 'text', text: JSON.stringify({
                                error: 'Service is currently OFFLINE',
                                service: serviceInfo.name,
                                status: serviceInfo.status,
                                last_checked_at: serviceInfo.last_checked_at,
                                message: `⚠️ This service failed its last health check and is currently offline. Calling it would likely waste your USDC. Try again later or use search_services to find an alternative.`,
                            }, null, 2) }],
                            isError: true,
                        };
                    }

                    const schema = serviceInfo.required_parameters;
                    if (schema && schema.required && schema.required.length > 0) {
                        const userParams = requestBody ? (() => { try { return JSON.parse(requestBody); } catch { return {}; } })() : {};
                        const missing = schema.required.filter(p =>
                            userParams[p] === undefined || userParams[p] === null || userParams[p] === ''
                        );
                        if (missing.length > 0) {
                            return {
                                content: [{ type: 'text', text: JSON.stringify({
                                    error: 'Missing required parameters',
                                    missing,
                                    required_parameters: schema,
                                    message: `This service requires: ${missing.join(', ')}. No payment was made.`,
                                    hint: `Pass these in the "body" parameter as JSON, e.g.: ${JSON.stringify(Object.fromEntries(missing.map(p => [p, schema.properties?.[p]?.type === 'integer' ? 0 : 'value'])))}`,
                                }, null, 2) }],
                                isError: true,
                            };
                        }
                    }
                }
            } catch (err) {
                // Non-blocking: proceed without validation if service info fetch fails
                mcpLog.warn('MCP', `Gatekeeper: could not fetch service details: ${err.message}`);
            }

            const proxyUrl = `${SERVER_URL}/api/call/${service_id}`;
            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody || JSON.stringify({}),
            };

            const result = await payAndRequest(proxyUrl, options, selectedChain);

            // --- CLIENT-SIDE VERIFICATION (Zero Trust) ---
            const verification = clientSideVerify(result, service_id);
            if (!verification.ok) {
                // Refund session budget
                const cost = result?._payment?.amount ? parseFloat(result._payment.amount) : 0;
                if (cost > 0) {
                    sessionSpending = Math.max(0, sessionSpending - cost);
                }
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        ...result,
                        _client_verification: 'FAILED',
                        _alert: `ALERT: API '${serviceName}' returned invalid data (reason: ${verification.reason}). You were NOT charged (${cost} USDC refunded to session budget). This service is temporarily blocked for 10 minutes. Recommendation: Use find_tool_for_task to find an alternative API.`,
                    }, null, 2) }],
                    isError: true,
                };
            }

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${enrichPaymentError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: call_api (handles x402 payments automatically) ---
const PRIVATE_IP_REGEX = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/;
const BLOCKED_HOSTNAME_REGEX = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|fc00:|fe80:|::1|\[::1\]|\[::ffff:)/i;

async function validateUrlForSSRF(urlStr) {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP/HTTPS URLs allowed');
    }
    if (BLOCKED_HOSTNAME_REGEX.test(parsed.hostname)) {
        throw new Error('Internal URLs not allowed');
    }
    const dns = await import('dns');
    const { address } = await dns.promises.lookup(parsed.hostname);
    if (PRIVATE_IP_REGEX.test(address)) {
        throw new Error('Internal URLs not allowed');
    }
}

server.tool(
    'call_api',
    `Call an external API URL and return the response. If the API requires payment (HTTP 402), it is handled automatically: USDC is sent on-chain and the request is retried with the transaction hash. Budget: ${MAX_BUDGET.toFixed(2)} USDC per session. Check get_budget_status before calling if unsure about remaining budget.`,
    {
        url: z.string().url().describe('The full API URL to call'),
        chain: z.enum(['auto', 'base', 'skale', 'polygon']).optional().describe('Payment chain. "auto" (default) picks the cheapest chain with sufficient balance.'),
    },
    async ({ url, chain: chainKey }) => {
        const selectedChain = chainKey || 'auto';
        mcpLog.info('MCP', `tool:call_api url=${url} chain=${selectedChain}`);
        try {
            await validateUrlForSSRF(url);

            // ── Anti-bypass: redirect Bazaar internal URLs to proxy for split enforcement ──
            const parsedUrl = new URL(url);
            const serverParsed = new URL(SERVER_URL);
            if (parsedUrl.hostname === serverParsed.hostname) {
                try {
                    const services = await getCachedServices();
                    const matchingService = services.find(s => {
                        try {
                            const serviceUrlPath = new URL(s.url).pathname;
                            return parsedUrl.pathname === serviceUrlPath || parsedUrl.pathname.endsWith(serviceUrlPath);
                        } catch {
                            return false;
                        }
                    });

                    if (matchingService) {
                        mcpLog.info('MCP', `Split: redirected Bazaar URL to proxy: ${url} → /api/call/${matchingService.id}`);
                        const proxyUrl = `${SERVER_URL}/api/call/${matchingService.id}`;
                        // Preserve query params from original URL as body so proxy forwards them
                        const originalParams = Object.fromEntries(parsedUrl.searchParams.entries());
                        const result = await payAndRequest(
                            proxyUrl,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(originalParams) },
                            selectedChain,
                        );
                        result._split_enforced = true;
                        result._original_url = url;
                        return {
                            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        };
                    }
                } catch (err) {
                    mcpLog.warn('MCP', `Split: service lookup failed, proceeding with direct call: ${err.message}`);
                    // Fall through to direct call if lookup fails
                }
            }

            // ── Direct call (non-Bazaar URL or no matching service found) ──
            // textFallback: true ensures the retry response handles non-JSON APIs gracefully
            const result = await payAndRequest(url, { textFallback: true }, selectedChain);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${enrichPaymentError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: get_wallet_balance (FREE — queries all chains) ---
server.tool(
    'get_wallet_balance',
    `Check the USDC balance of the agent wallet on all supported chains (Base + SKALE + Polygon). Free. Note: Polygon supports gas-free payments via x402 facilitator when POLYGON_FACILITATOR_URL is configured — no POL needed for gas in that mode.`,
    {},
    async () => {
        try {
            const initError = tryInitWallet();
            if (initError) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: 'Wallet not configured',
                        details: initError,
                        tip: 'Use the setup_wallet tool to auto-generate a wallet, or set AGENT_PRIVATE_KEY in your MCP environment.',
                    }, null, 2) }],
                    isError: true,
                };
            }
            const balances = {};

            for (const [key, cfg] of Object.entries(CHAINS)) {
                if (key === 'base-sepolia') continue; // skip testnet
                try {
                    const { public: pubClient } = getClients(key);
                    const usdcBal = await pubClient.readContract({
                        address: cfg.usdc,
                        abi: USDC_ABI,
                        functionName: 'balanceOf',
                        args: [account.address],
                    });
                    const nativeBal = await pubClient.getBalance({ address: account.address });
                    balances[key] = {
                        network: cfg.label,
                        balance_usdc: (Number(usdcBal) / (10 ** cfg.decimals)).toFixed(6),
                        balance_native: (Number(nativeBal) / 1e18).toFixed(8),
                        explorer: `${cfg.explorer}/address/${account.address}`,
                    };
                } catch (err) {
                    balances[key] = { network: cfg.label, error: err.message };
                }
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            address: account.address,
                            chains: balances,
                            default_chain: DEFAULT_CHAIN_KEY,
                        }, null, 2),
                    },
                    {
                        type: 'text',
                        text: '💰 Need USDC? Bridge from any chain (ETH, Polygon, Arbitrum, Optimism, Base) → SKALE in 1 click: https://x402bazaar.org/fund (Trails SDK, 5-15 min)',
                    },
                ],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Auto-Faucet: request CREDITS from backend faucet for new wallets on SKALE ---
async function autoFundCredits(targetAddress) {
    try {
        const res = await fetch(`${SERVER_URL}/api/faucet/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: targetAddress }),
            signal: AbortSignal.timeout(45_000),
        });
        const data = await res.json();
        if (data.funded) {
            mcpLog.info('MCP', `Faucet: server funded CREDITS to ${targetAddress} — tx: ${data.tx_hash}`);
        }
        return data;
    } catch (err) {
        mcpLog.warn('MCP', `Faucet: backend request failed: ${err.message}`);
        return { funded: false, reason: 'error', error: err.message };
    }
}

// --- Tool: setup_wallet (FREE — plug-and-play onboarding) ---
server.tool(
    'setup_wallet',
    'Initialize your agent wallet (auto-generates one if needed). Returns your wallet address, default chain, explorer link, USDC balance, and instructions to fund it. Free — run this first before using paid APIs. Includes bridge instructions for funding via Trails SDK.',
    {},
    async () => {
        try {
            // Auto-generates and persists if no wallet configured
            initWallet();

            const isAutoGenerated = fs.existsSync(AUTO_WALLET_PATH) &&
                !process.env.AGENT_PRIVATE_KEY &&
                !fs.existsSync(process.env.AGENT_SEED_PATH || join(__dirname, 'agent-seed.json'));

            // Fetch balances for both chains
            const chains = {};

            // --- Base ---
            const baseCfg = CHAINS['base'];
            try {
                const { public: basePub } = getClients('base');
                const baseRaw = await basePub.readContract({
                    address: baseCfg.usdc, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address],
                });
                chains.base = {
                    network: baseCfg.label,
                    usdc_balance: `${(Number(baseRaw) / (10 ** baseCfg.decimals)).toFixed(6)} USDC`,
                    explorer: `${baseCfg.explorer}/address/${account.address}`,
                    how_to_fund: `Send USDC on Base to ${account.address} from any external wallet`,
                };
            } catch (err) {
                chains.base = { network: baseCfg.label, error: err.message };
            }

            // --- SKALE on Base ---
            const skaleCfg = CHAINS['skale'];
            try {
                const { public: skalePub } = getClients('skale');
                const [skaleRaw, creditsRaw] = await Promise.all([
                    skalePub.readContract({
                        address: skaleCfg.usdc, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address],
                    }),
                    skalePub.getBalance({ address: account.address }),
                ]);
                chains.skale = {
                    network: skaleCfg.label,
                    usdc_balance: `${(Number(skaleRaw) / (10 ** skaleCfg.decimals)).toFixed(6)} USDC`,
                    credits_balance: `${(Number(creditsRaw) / 1e18).toFixed(8)} CREDITS`,
                    explorer: `${skaleCfg.explorer}/address/${account.address}`,
                    gas_token: 'CREDITS (~$0.0007/tx — 40 CREDITS ≈ 10,000 transactions)',
                    how_to_fund: 'CREDITS auto-funded on first setup. Fund USDC via https://x402bazaar.org/fund | Explorer: https://skale-base-explorer.skalenodes.com',
                };
            } catch (err) {
                chains.skale = { network: skaleCfg.label, error: err.message };
            }

            // --- Auto-fund CREDITS only if balance is 0 or very low ---
            let autoFaucet = null;
            const creditsBalance = chains.skale?.credits_balance
                ? parseFloat(chains.skale.credits_balance)
                : 0;
            if (creditsBalance < 0.001) {
                try {
                    autoFaucet = await autoFundCredits(account.address);
                    if (autoFaucet.funded) {
                        // Re-fetch SKALE CREDITS balance after funding
                        const { public: skalePub } = getClients('skale');
                        const newBal = await skalePub.getBalance({ address: account.address });
                        if (chains.skale && !chains.skale.error) {
                            chains.skale.credits_balance = `${(Number(newBal) / 1e18).toFixed(8)} CREDITS`;
                        }
                    }
                } catch (_) { /* faucet failure is non-fatal */ }
            } else {
                autoFaucet = { funded: false, reason: 'already_has_credits', credits: creditsBalance.toFixed(8) };
            }

            // Determine overall USDC status
            const baseUsdcNum = chains.base?.usdc_balance ? parseFloat(chains.base.usdc_balance) : 0;
            const skaleUsdcNum = chains.skale?.usdc_balance ? parseFloat(chains.skale.usdc_balance) : 0;
            const totalUsdc = baseUsdcNum + skaleUsdcNum;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'ready',
                            address: account.address,
                            default_chain: CHAINS[DEFAULT_CHAIN_KEY].label,
                            wallet_source: isAutoGenerated ? 'auto-generated' : 'configured',
                            wallet_file: isAutoGenerated ? AUTO_WALLET_PATH : null,
                            chains,
                            auto_faucet: autoFaucet?.funded
                                ? { ...autoFaucet, message: `✅ 0.01 CREDITS auto-funded to your wallet (enough for ~100 transactions on SKALE)` }
                                : autoFaucet?.reason === 'already_has_credits'
                                    ? { ...autoFaucet, message: `✅ Wallet already has ${autoFaucet.credits} CREDITS for gas` }
                                    : autoFaucet?.reason === 'send_failed'
                                        ? { ...autoFaucet, message: `⚠️ CREDITS auto-fund failed. You can request CREDITS manually or use Base chain instead. Error: ${autoFaucet.error || 'unknown'}` }
                                        : autoFaucet,
                            next_steps: totalUsdc === 0
                                ? [
                                    'RECOMMENDED: Use chain: "skale" for ultra-low gas (~$0.0007/tx) — best for AI agents',
                                    `Send USDC to ${account.address} on Base or SKALE on Base`,
                                    '🔗 GET USDC ON SKALE: Bridge from any chain → SKALE in 1 click: https://x402bazaar.org/fund',
                                    '🔗 Alternative: SKALE native bridge: https://bridge.skale.space',
                                    'Minimum recommended: 1 USDC (covers ~20 API calls at 0.05 USDC each)',
                                    `Session budget: ${MAX_BUDGET.toFixed(2)} USDC (set MAX_BUDGET_USDC to change)`,
                                ]
                                : [
                                    `Wallet funded with ${totalUsdc.toFixed(6)} USDC total — ready to use paid APIs`,
                                    'TIP: Use chain: "skale" for ultra-low gas (~$0.0007/tx)',
                                    '🔗 Need more USDC? Bridge from any chain → SKALE: https://x402bazaar.org/fund',
                                    `Session budget: ${MAX_BUDGET.toFixed(2)} USDC (set MAX_BUDGET_USDC to change)`,
                                ],
                            wallet_backup_info: {
                                encryption: 'AES-256-GCM (machine-bound key)',
                                export_tool: 'Use export_private_key to reveal your key for backup',
                            },
                            recommended_chain: 'auto (smart selection based on balances)',
                        }, null, 2),
                    },
                    {
                        type: 'text',
                        text: totalUsdc === 0
                            ? `💰 Fund your wallet: Bridge USDC from any chain (ETH, Polygon, Arbitrum, Optimism, Base) → SKALE in 1 click at https://x402bazaar.org/fund (Trails SDK, 5-15 min)`
                            : `💰 Need more USDC? Bridge from any chain → SKALE in 1 click: https://x402bazaar.org/fund`,
                    },
                ],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error initializing wallet: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: export_private_key (FREE — backup info only, private key NEVER returned) ---
server.tool(
    'export_private_key',
    'Show where your wallet private key is stored so you can retrieve it manually for backup or import. The private key is NEVER returned in the chat — only its storage location is provided. Free — no payment needed.',
    {
        confirm: z.enum(['yes_i_understand_the_risks']).describe(
            'You MUST pass "yes_i_understand_the_risks" to confirm you want to know where your private key is stored. This is a safety measure.'
        ),
    },
    async ({ confirm: _confirm }) => {
        try {
            tryInitWallet();

            // Determine the key source WITHOUT reading or returning the key itself
            const isEnvKey = Boolean(process.env.AGENT_PRIVATE_KEY);
            const seedPath = process.env.AGENT_SEED_PATH || join(__dirname, 'agent-seed.json');
            const isLegacySeed = !isEnvKey && fs.existsSync(seedPath);
            const isAutoWallet = !isEnvKey && !isLegacySeed && fs.existsSync(AUTO_WALLET_PATH);

            let keySource;
            let instructions;

            if (isEnvKey) {
                keySource = 'environment_variable';
                instructions = [
                    'Your private key is stored in the AGENT_PRIVATE_KEY environment variable of your MCP configuration.',
                    'To retrieve it: open your MCP config file (claude_desktop_config.json or equivalent) and look for the AGENT_PRIVATE_KEY value under the x402-bazaar server env section.',
                    'NEVER paste or share this key in any chat, log, or unsecured document.',
                    'Store it in a secure password manager (e.g., 1Password, Bitwarden) if you have not already done so.',
                ];
            } else if (isLegacySeed) {
                keySource = 'legacy_seed_file';
                instructions = [
                    `Your wallet seed is stored (encrypted) at: ${seedPath}`,
                    'This is a legacy format. The private key is derived from the encrypted seed at runtime.',
                    'To extract the raw private key: read that file manually with a trusted offline tool on this machine only.',
                    'NEVER paste or share the seed or derived key in any chat, log, or unsecured document.',
                    'Consider migrating to the auto-wallet format by removing agent-seed.json (a new encrypted wallet will be auto-generated on next startup).',
                ];
            } else if (isAutoWallet) {
                keySource = 'auto_generated_encrypted_file';
                // Commande de déchiffrement locale — utilise des guillemets doubles pour éviter
                // les conflits avec les apostrophes JavaScript à l'intérieur de la chaîne
                const decryptCmd = "node -e \"const fs=require('fs'),os=require('os'),c=require('crypto');" +
                    "const d=JSON.parse(fs.readFileSync(os.homedir()+'/.x402-bazaar/wallet.json','utf-8'));" +
                    "const k=c.createHash('sha256').update(os.hostname()+':'+os.userInfo().username+':'+os.homedir()).digest();" +
                    "const dc=c.createDecipheriv('aes-256-gcm',k,Buffer.from(d.iv,'hex'));" +
                    "dc.setAuthTag(Buffer.from(d.tag,'hex'));" +
                    "console.log(dc.update(Buffer.from(d.encrypted,'hex'))+dc.final('utf8'))\"";
                instructions = [
                    `Your private key is stored encrypted (AES-256-GCM, machine-bound key) at: ${AUTO_WALLET_PATH}`,
                    'The file is readable only on this machine (the decryption key is derived from your hostname, username and home directory).',
                    'To retrieve the raw private key, run the following command in a LOCAL terminal on this machine (never share the output):',
                    decryptCmd,
                    'Copy the output directly into your password manager (1Password, Bitwarden, etc.), then close the terminal.',
                    'NEVER paste or share the output in any chat, log, screenshot, or unsecured document.',
                ];
            } else {
                keySource = 'unknown_or_not_initialized';
                instructions = [
                    'Could not determine the key storage location. The wallet may not be initialized yet.',
                    'Call the setup_wallet tool first to initialize or generate a wallet, then call this tool again.',
                ];
            }

            return {
                content: [{ type: 'text', text: JSON.stringify({
                    security_notice: 'The private key is NOT returned here. Only its storage location is shown. Retrieve it manually on your local machine — never in a chat window.',
                    address: account ? account.address : 'wallet not initialized',
                    key_source: keySource,
                    wallet_file: isAutoWallet ? AUTO_WALLET_PATH : null,
                    instructions,
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    error: 'Failed to locate private key storage',
                    message: sanitizeError(err.message),
                }, null, 2) }],
                isError: true,
            };
        }
    }
);

// --- Tool: import_openapi (FREE) ---
server.tool(
    'import_openapi',
    'Import all endpoints from an OpenAPI spec URL into x402 Bazaar. Each endpoint becomes a paid API service. Free — no payment needed. Provider keeps 95% of revenue.',
    {
        spec_url: z.string().url().describe('URL to the OpenAPI spec (JSON or YAML). Must be publicly accessible.'),
        default_price: z.number().min(0.001).max(1000).describe('Default price per call in USDC for all imported endpoints'),
        exclude_paths: z.array(z.string()).optional().describe('Optional: paths to exclude from import (e.g. ["/health", "/status"])'),
    },
    async ({ spec_url, default_price, exclude_paths }) => {
        if (!account) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: 'No wallet configured. Run setup_wallet first.',
                    }),
                }],
            };
        }

        try {
            const timestamp = Date.now();
            const message = `import-openapi:${account.address}:${timestamp}`;
            const signature = await account.signMessage({ message });

            const payload = {
                specUrl: spec_url,
                ownerAddress: account.address,
                defaultPrice: default_price,
                signature,
                timestamp,
            };
            if (exclude_paths && exclude_paths.length > 0) {
                payload.excludePaths = exclude_paths;
            }

            const res = await fetch(`${SERVER_URL}/api/import-openapi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(60000), // 60s timeout for large specs
            });

            const data = await res.json();

            if (!res.ok) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            error: data.error || 'Import failed',
                            message: data.message || '',
                            details: data.details || data.skipped_details || [],
                            status: res.status,
                        }, null, 2),
                    }],
                };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        spec_title: data.spec_title,
                        total_found: data.total_found,
                        imported: data.imported,
                        skipped: data.skipped,
                        skipped_details: data.skipped_details,
                        services: (data.services || []).map(s => ({
                            id: s.id,
                            name: s.name,
                            url: s.url,
                            price_usdc: s.price_usdc,
                            service_page: `https://x402bazaar.org/services/${s.id}`,
                        })),
                        message: `Successfully imported ${data.imported} endpoints from "${data.spec_title}". Each is now a paid API on x402 Bazaar.`,
                    }, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: 'Import failed',
                        message: err.message,
                    }),
                }],
            };
        }
    }
);

// --- Tool: import_rapidapi (FREE — RapidAPI shortcut) ---
server.tool(
    'import_rapidapi',
    'Import a RapidAPI API into x402 Bazaar. Provide the OpenAPI spec URL (downloaded from RapidAPI) and your X-RapidAPI-Key. Credentials (X-RapidAPI-Key + X-RapidAPI-Host) are auto-configured. Free. Provider keeps 95% of revenue.',
    {
        spec_url: z.string().url().describe('URL to the OpenAPI spec file downloaded from RapidAPI (JSON/YAML)'),
        rapidapi_key: z.string().min(10).describe('Your X-RapidAPI-Key from rapidapi.com/developer/apps'),
        default_price: z.number().min(0.001).max(1000).describe('Default price per API call in USDC'),
        exclude_paths: z.array(z.string()).optional().describe('API paths to exclude from import'),
    },
    async ({ spec_url, rapidapi_key, default_price, exclude_paths }) => {
        try {
            if (!account) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'No wallet configured. Run setup_wallet first.' }) }],
                    isError: true,
                };
            }

            // 1. Fetch the spec to detect RapidAPI host
            const specRes = await fetchWithTimeout(spec_url, {}, 30_000);
            if (!specRes.ok) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: `Failed to fetch spec: HTTP ${specRes.status}` }, null, 2) }],
                    isError: true,
                };
            }
            const specText = await specRes.text();
            let spec;
            try {
                spec = JSON.parse(specText);
            } catch {
                // Most RapidAPI specs are JSON — YAML not supported here
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'Could not parse spec as JSON. Please provide a JSON spec URL.' }, null, 2) }],
                    isError: true,
                };
            }

            // 2. Detect RapidAPI host from spec
            const serverUrl = spec.servers?.[0]?.url ||
                (spec.host ? `${(spec.schemes?.[0] || 'https')}://${spec.host}${spec.basePath || ''}` : '');
            let rapidapiHost = null;
            try { rapidapiHost = new URL(serverUrl).hostname; } catch {}

            if (!rapidapiHost || !rapidapiHost.includes('.p.rapidapi.com')) {
                mcpLog.warn('MCP', `import_rapidapi: spec host "${rapidapiHost}" does not look like RapidAPI (.p.rapidapi.com)`);
            }

            // 3. Build credentials (array format matching ServiceCredentialsSchema)
            const credentials = {
                type: 'header',
                credentials: [
                    { key: 'X-RapidAPI-Key', value: rapidapi_key },
                    ...(rapidapiHost ? [{ key: 'X-RapidAPI-Host', value: rapidapiHost }] : []),
                ],
            };

            // 4. Sign EIP-191
            const timestamp = Date.now();
            const message = `import-openapi:${account.address}:${timestamp}`;
            const signature = await account.signMessage({ message });

            // 5. Call existing import-openapi endpoint
            const payload = {
                specUrl: spec_url,
                ownerAddress: account.address,
                defaultPrice: default_price,
                signature,
                timestamp,
                ...(exclude_paths?.length ? { excludePaths: exclude_paths } : {}),
                credentials: JSON.stringify(credentials),
            };

            const importRes = await fetchWithTimeout(`${SERVER_URL}/api/import-openapi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, 60_000);

            const result = await importRes.json();

            if (!importRes.ok) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: result.error || 'Import failed', details: result }, null, 2) }],
                    isError: true,
                };
            }

            // 6. Enrich result with RapidAPI metadata
            result.rapidapi = {
                host: rapidapiHost,
                credentials_configured: true,
                headers: ['X-RapidAPI-Key', 'X-RapidAPI-Host'],
            };

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${sanitizeError(err.message)}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: create_payment_link (FREE) ---
server.tool(
    'create_payment_link',
    'Create a shareable payment link (paywall) for any URL. When someone visits the link, they must pay USDC to access the content. Free to create — you earn 95% of each payment.',
    {
        title: z.string().min(1).max(200).describe('Title shown on the paywall page'),
        target_url: z.string().url().describe('The URL to protect behind the paywall (PDF, article, API, etc.)'),
        price_usdc: z.number().min(0.001).max(10000).describe('Price in USDC to access the content'),
        description: z.string().max(1000).optional().describe('Optional description shown on the paywall'),
    },
    async ({ title, target_url, price_usdc, description }) => {
        if (!account) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'No wallet configured. Run setup_wallet first.' }) }] };
        }
        try {
            const timestamp = Date.now();
            const message = `create-payment-link:${account.address}:${timestamp}`;
            const signature = await account.signMessage({ message });

            const res = await fetch(`${SERVER_URL}/api/payment-links`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    targetUrl: target_url,
                    priceUsdc: price_usdc,
                    description: description || '',
                    ownerAddress: account.address,
                    signature,
                    timestamp,
                }),
                signal: AbortSignal.timeout(15000),
            });

            const data = await res.json();
            if (!res.ok) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: data.error || 'Creation failed', details: data.details || data.message }) }] };
            }

            const link = data.payment_link;
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: link.id,
                        title: link.title,
                        price_usdc: link.price_usdc,
                        paywall_url: link.paywall_url,
                        message: `Payment link created! Share this URL: ${link.paywall_url} — anyone who pays ${price_usdc} USDC gets access to the content.`,
                    }, null, 2),
                }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Creation failed', message: err.message }) }] };
        }
    }
);

// --- Tool: access_payment_link (PAID — requires USDC payment) ---
server.tool(
    'access_payment_link',
    'Pay and access a payment link (paywall). Sends USDC on-chain to the link creator, then retrieves the protected content URL. Costs the price set by the creator.',
    {
        link_id: z.string().uuid().describe('The payment link ID (UUID from the paywall URL)'),
        chain: z.enum(['auto', 'base', 'skale', 'polygon']).optional().describe('Chain for payment. Default: auto (picks cheapest)'),
    },
    async ({ link_id, chain }) => {
        if (!account) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'No wallet configured. Run setup_wallet first.' }) }] };
        }
        try {
            // 1. Get link info (returns 402 with payment requirements)
            const infoRes = await fetch(`${SERVER_URL}/api/payment-links/${link_id}`, {
                signal: AbortSignal.timeout(10000),
            });
            const infoData = await infoRes.json();

            if (infoRes.status !== 402) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: infoData.error || 'Link not found or inactive' }) }] };
            }

            const price = parseFloat(infoData.price_usdc);
            // Pay the platform (WALLET_ADDRESS) — backend handles 95/5 split to creator
            const linkNormalized = normalize402(infoRes.status, Object.fromEntries(infoRes.headers), infoData);
            const recipient = linkNormalized.recipient || infoData.payment_details?.recipient || process.env.WALLET_ADDRESS || infoData.owner_address;

            // Budget check
            if (sessionSpending + price > MAX_BUDGET) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: `Budget exceeded. Cost: ${price} USDC, remaining: ${(MAX_BUDGET - sessionSpending).toFixed(4)} USDC` }) }] };
            }

            // 2. Select chain
            const chainKey = (!chain || chain === 'auto') ? (await selectBestChain(price)).chain : chain;
            if (!chainKey) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: 'Insufficient USDC balance on all chains', balances: { base: balanceCache.base, skale: balanceCache.skale, polygon: balanceCache.polygon } }) }] };
            }
            const cfg = CHAINS[chainKey];
            const { wallet: walletClient, public: publicClient } = getClients(chainKey);

            // 3. Send USDC to the link creator
            const rawAmount = usdcToRaw(price, chainKey);
            const txHash = await walletClient.writeContract({
                address: cfg.usdc,
                abi: USDC_ABI,
                functionName: 'transfer',
                args: [recipient, rawAmount],
                ...(chainKey === 'skale' ? { type: 'legacy' } : {}),
            });

            // 4. Wait for confirmation
            await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 2, timeout: 30000 });

            // Track spending immediately after successful payment
            sessionSpending += price;
            sessionPayments.push({ service: `paylink:${link_id}`, cost: price, chain: chainKey, txHash, timestamp: Date.now() });
            saveBudgetToDisk();

            // 5. Access the link with payment proof
            const accessRes = await fetch(`${SERVER_URL}/api/payment-links/${link_id}/access`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Payment-TxHash': txHash,
                    'X-Payment-Chain': cfg.paymentHeader,
                    'X-Agent-Wallet': account.address,
                },
                signal: AbortSignal.timeout(15000),
            });

            const accessData = await accessRes.json();

            if (accessData.success && accessData.target_url) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            title: accessData.title || infoData.title,
                            target_url: accessData.target_url,
                            price_paid: price,
                            chain: chainKey,
                            tx_hash: txHash,
                            message: `Content unlocked! Access it at: ${accessData.target_url}`,
                        }, null, 2),
                    }],
                };
            } else {
                return { content: [{ type: 'text', text: JSON.stringify({ error: 'Payment verified but access denied', price_paid: price, chain: chainKey, tx_hash: txHash, details: accessData }) }] };
            }
        } catch (err) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Access failed', message: err.message }) }] };
        }
    }
);

// --- Tool: get_budget_status (FREE) ---
server.tool(
    'get_budget_status',
    'Check the session spending budget. Shows how much USDC has been spent, remaining budget, and a list of all payments made this session. Free — call this before paid requests to verify budget.',
    {},
    async () => {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    budget_limit: MAX_BUDGET.toFixed(2) + ' USDC',
                    spent: sessionSpending.toFixed(2) + ' USDC',
                    remaining: (MAX_BUDGET - sessionSpending).toFixed(2) + ' USDC',
                    payments_count: sessionPayments.length,
                    reusable_hashes: reusableHashes.length,
                    blacklisted_services: serviceBlacklist.size,
                    payments: sessionPayments,
                    default_chain: CHAINS[DEFAULT_CHAIN_KEY].label,
                    supported_chains: Object.entries(CHAINS)
                        .filter(([k]) => k !== 'base-sepolia')
                        .map(([k, v]) => ({ key: k, label: v.label })),
                    balances: {
                        base: balanceCache.base.toFixed(4) + ' USDC',
                        skale: balanceCache.skale.toFixed(4) + ' USDC',
                        polygon: balanceCache.polygon.toFixed(4) + ' USDC',
                        cache_age_seconds: balanceCache.updatedAt > 0 ? Math.round((Date.now() - balanceCache.updatedAt) / 1000) : 'not cached',
                    },
                }, null, 2),
            }],
        };
    }
);

// ─── Auto-update check (fire-and-forget) ────────────────────────────
const LOCAL_VERSION = '2.6.0';
(async () => {
    try {
        const res = await fetch(
            'https://raw.githubusercontent.com/Wintyx57/x402-backend/main/mcp-server.mjs',
            { signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) return;
        const text = await res.text();
        const match = text.match(/version:\s*'(\d+\.\d+\.\d+)'/);
        if (!match) return;
        const remote = match[1];
        if (remote !== LOCAL_VERSION) {
            console.error(`\n⚠️  MCP update available: ${LOCAL_VERSION} → ${remote}`);
            console.error(`   Run: cd ${__dirname} && git pull`);
            console.error(`   Then restart Claude Code / Cursor\n`);
        }
    } catch {
        // Silently ignore (offline, timeout, etc.)
    }
})();

// ─── Start ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
