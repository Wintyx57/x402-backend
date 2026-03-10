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
import { base, baseSepolia } from 'viem/chains';

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
        explorer: 'https://basescan.org',
        label: 'Base Mainnet',
        paymentHeader: 'base',
    },
    skale: {
        chain: skaleOnBase,
        usdc: '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20',
        explorer: 'https://skale-base-explorer.skalenodes.com',
        label: 'SKALE on Base (ultra-low gas)',
        paymentHeader: 'skale',
    },
    'base-sepolia': {
        chain: baseSepolia,
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        explorer: 'https://sepolia.basescan.org',
        label: 'Base Sepolia',
        paymentHeader: 'base-sepolia',
    },
};

const SERVER_URL = process.env.X402_SERVER_URL || 'https://x402-api.onrender.com';
const MAX_BUDGET = parseFloat(process.env.MAX_BUDGET_USDC || '1.00');
const DEFAULT_CHAIN_KEY = process.env.NETWORK === 'skale' ? 'skale'
    : (process.env.NETWORK === 'testnet' ? 'base-sepolia' : 'base');

const USDC_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
]);

// ─── Budget Tracking ─────────────────────────────────────────────────
let sessionSpending = 0;
const sessionPayments = [];

// ─── Wallet (viem — multi-chain, no Coinbase CDP dependency) ────────
let account = null;
const chainClients = {}; // { base: { public, wallet }, skale: { public, wallet } }

const AUTO_WALLET_PATH = join(homedir(), '.x402-bazaar', 'wallet.json');

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
    const walletDir = join(homedir(), '.x402-bazaar');
    if (!fs.existsSync(walletDir)) {
        fs.mkdirSync(walletDir, { recursive: true });
    }
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
        chainClients[chainKey] = {
            public: createPublicClient({ chain: cfg.chain, transport: http() }),
            wallet: createWalletClient({ account, chain: cfg.chain, transport: http() }),
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

// ─── Services cache (anti-bypass) ────────────────────────────────────
let servicesCache = null;
let servicesCacheTime = 0;
const SERVICES_CACHE_TTL = 60_000; // 60s

async function getCachedServices() {
    if (servicesCache && Date.now() - servicesCacheTime < SERVICES_CACHE_TTL) {
        return servicesCache;
    }
    const res = await fetch(`${SERVER_URL}/api/services`);
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

    const res = await fetch(url, fetchOptions);

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
    try {
        body = await res.json();
    } catch {
        throw new Error('API returned 402 Payment Required but response is not valid JSON');
    }

    const details = body.payment_details;
    if (!details || !details.amount || !details.recipient) {
        throw new Error(
            `Non-standard 402 response (missing payment_details): ${JSON.stringify(body)}`
        );
    }

    const cost = parseFloat(details.amount);

    // Budget check
    if (sessionSpending + cost > MAX_BUDGET) {
        throw new Error(
            `Budget limit reached. Spent: ${sessionSpending.toFixed(2)} USDC / ${MAX_BUDGET.toFixed(2)} USDC. ` +
            `This call costs ${cost} USDC. ` +
            `To increase the limit, set MAX_BUDGET_USDC=X in your MCP config environment (e.g. MAX_BUDGET_USDC=5).`
        );
    }

    const cfg = CHAINS[chainKey];
    const isSplitMode = !!details.provider_wallet && details.payment_mode === 'split_native';
    let retryHeaders;

    if (isSplitMode) {
        // ── Split mode: 95% to provider, 5% to platform ──
        const totalRaw = BigInt(Math.round(cost * 1e6));
        const providerRaw = details.split
            ? BigInt(Math.round(parseFloat(details.split.provider_amount) * 1e6))
            : totalRaw * 95n / 100n;
        const platformRaw = totalRaw - providerRaw;

        // Send 95% to provider
        const txHashProvider = await sendUsdcTransfer(chainKey, details.provider_wallet, providerRaw);

        // Send 5% to platform (best-effort)
        let txHashPlatform = null;
        try {
            txHashPlatform = await sendUsdcTransfer(chainKey, details.recipient, platformRaw);
        } catch (err) {
            console.error(`[Split] Platform payment failed (fallback to pending payout): ${err.message}`);
        }

        // Track spending
        sessionSpending += cost;
        sessionPayments.push({
            amount: cost,
            txHash: txHashProvider,
            txHashPlatform,
            chain: chainKey,
            splitMode: txHashPlatform ? 'split_complete' : 'provider_only',
            timestamp: new Date().toISOString(),
            endpoint: url.replace(SERVER_URL, ''),
        });

        retryHeaders = {
            ...fetchOptions.headers,
            'X-Payment-TxHash-Provider': txHashProvider,
            'X-Payment-Chain': cfg.paymentHeader,
        };
        if (txHashPlatform) {
            retryHeaders['X-Payment-TxHash-Platform'] = txHashPlatform;
        }
    } else {
        // ── Legacy mode: single transfer to platform ──
        const amountInUnits = BigInt(Math.round(cost * 1e6));
        const txHash = await sendUsdcTransfer(chainKey, details.recipient, amountInUnits);

        // Track spending
        sessionSpending += cost;
        sessionPayments.push({
            amount: cost,
            txHash,
            chain: chainKey,
            timestamp: new Date().toISOString(),
            endpoint: url.replace(SERVER_URL, ''),
        });

        retryHeaders = {
            ...fetchOptions.headers,
            'X-Payment-TxHash': txHash,
            'X-Payment-Chain': cfg.paymentHeader,
        };
    }

    // Retry with payment proof
    const retryRes = await fetch(url, { ...fetchOptions, headers: retryHeaders });

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

    // Enrich result with payment info
    const lastPayment = sessionPayments[sessionPayments.length - 1];
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

    return result;
}

// ─── MCP Server ─────────────────────────────────────────────────────
const server = new McpServer({
    name: 'x402-bazaar',
    version: '2.4.0',
});

// --- Tool: discover_marketplace (FREE) ---
server.tool(
    'discover_marketplace',
    'Discover the x402 Bazaar marketplace. Returns available endpoints, total services, and protocol info. Free — no payment needed.',
    {},
    async () => {
        try {
            const res = await fetch(SERVER_URL);
            const data = await res.json();
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: search_services (0.05 USDC) ---
server.tool(
    'search_services',
    `Search for API services on x402 Bazaar by keyword. Costs 0.05 USDC (paid automatically). Budget: ${MAX_BUDGET.toFixed(2)} USDC per session. Check get_budget_status before calling if unsure about remaining budget.`,
    {
        query: z.string().describe('Search keyword (e.g. "weather", "crypto", "ai")'),
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" or "skale" (ultra-low gas)'),
    },
    async ({ query, chain: chainKey }) => {
        try {
            const result = await payAndRequest(
                `${SERVER_URL}/search?q=${encodeURIComponent(query)}`,
                {},
                chainKey || DEFAULT_CHAIN_KEY,
            );
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: list_services (0.05 USDC) ---
server.tool(
    'list_services',
    `List all API services available on x402 Bazaar. Costs 0.05 USDC (paid automatically). Budget: ${MAX_BUDGET.toFixed(2)} USDC per session.`,
    {
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" or "skale" (ultra-low gas)'),
    },
    async ({ chain: chainKey }) => {
        try {
            const result = await payAndRequest(`${SERVER_URL}/services`, {}, chainKey || DEFAULT_CHAIN_KEY);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: find_tool_for_task (0.05 USDC — smart service lookup) ---
server.tool(
    'find_tool_for_task',
    `Describe what you need in plain English and get the best matching API service ready to call. Returns the single best match with name, URL, price, and usage instructions. Much faster than searching + browsing results manually. Costs 0.05 USDC. Budget: ${MAX_BUDGET.toFixed(2)} USDC per session.`,
    {
        task: z.string().describe('What you need, in natural language (e.g. "get current weather for a city", "translate text to French", "get Bitcoin price")'),
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" or "skale" (ultra-low gas)'),
    },
    async ({ task, chain: chainKey }) => {
        try {
            const stopWords = new Set(['i', 'need', 'want', 'to', 'a', 'an', 'the', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'that', 'this', 'get', 'find', 'me', 'my', 'some', 'can', 'you', 'do', 'is', 'it', 'be', 'have', 'use', 'please', 'should', 'would', 'could']);
            const keywords = task.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.has(w));
            const query = keywords.slice(0, 3).join(' ') || task.slice(0, 30);

            const result = await payAndRequest(
                `${SERVER_URL}/search?q=${encodeURIComponent(query)}`,
                {},
                chainKey || DEFAULT_CHAIN_KEY,
            );

            const services = result.data || result.services || [];
            if (services.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        found: false,
                        query_used: query,
                        message: `No services found matching "${task}". Try rephrasing or use search_services with different keywords.`,
                        _payment: result._payment,
                    }, null, 2) }],
                };
            }

            const best = services[0];
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    found: true,
                    query_used: query,
                    service: {
                        name: best.name,
                        description: best.description,
                        url: best.url,
                        price_usdc: best.price_usdc,
                        tags: best.tags,
                    },
                    action: best.id
                        ? `Call this service using call_service("${best.id}"). This uses the Bazaar proxy with native 95/5 revenue split. Price: ${best.price_usdc} USDC.`
                        : `Call this API using call_api("${best.url}"). ${Number(best.price_usdc) === 0 ? 'This API is free.' : `This API costs ${best.price_usdc} USDC per call.`}`,
                    alternatives_count: services.length - 1,
                    _payment: result._payment,
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
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
        body: z.string().optional().describe('Optional JSON body string to send with the request (e.g. \'{"query":"hello"}\')'),
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" or "skale" (ultra-low gas)'),
    },
    async ({ service_id, body: requestBody, chain: chainKey }) => {
        const selectedChain = chainKey || DEFAULT_CHAIN_KEY;
        try {
            // --- GATEKEEPER: validate required params BEFORE payment ---
            try {
                const infoRes = await fetch(`${SERVER_URL}/api/services/${service_id}`);
                if (infoRes.ok) {
                    const serviceInfo = await infoRes.json();
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
                console.error(`[Gatekeeper] Could not fetch service details: ${err.message}`);
            }

            const proxyUrl = `${SERVER_URL}/api/call/${service_id}`;
            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody || JSON.stringify({}),
            };

            const result = await payAndRequest(proxyUrl, options, selectedChain);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
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
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" or "skale" (ultra-low gas)'),
    },
    async ({ url, chain: chainKey }) => {
        const selectedChain = chainKey || DEFAULT_CHAIN_KEY;
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
                        console.error(`[Split] Redirected Bazaar URL to proxy for split enforcement: ${url} → /api/call/${matchingService.id}`);
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
                    console.error(`[Split] Service lookup failed, proceeding with direct call: ${err.message}`);
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
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: get_wallet_balance (FREE — queries all chains) ---
server.tool(
    'get_wallet_balance',
    'Check the USDC balance of the agent wallet on all supported chains (Base + SKALE on Base). Free.',
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
                        balance_usdc: (Number(usdcBal) / 1e6).toFixed(6),
                        balance_native: (Number(nativeBal) / 1e18).toFixed(8),
                        explorer: `${cfg.explorer}/address/${account.address}`,
                    };
                } catch (err) {
                    balances[key] = { network: cfg.label, error: err.message };
                }
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        address: account.address,
                        chains: balances,
                        default_chain: DEFAULT_CHAIN_KEY,
                    }, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
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
            console.error(`[Faucet] Server funded 0.01 CREDITS to ${targetAddress} — tx: ${data.tx_hash}`);
        }
        return data;
    } catch (err) {
        console.error(`[Faucet] Backend faucet request failed: ${err.message}`);
        return { funded: false, reason: 'error', error: err.message };
    }
}

// --- Tool: setup_wallet (FREE — plug-and-play onboarding) ---
server.tool(
    'setup_wallet',
    'Initialize your agent wallet (auto-generates one if needed). Returns your wallet address, default chain, explorer link, USDC balance, and instructions to fund it. Free — run this first before using paid APIs.',
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
                    usdc_balance: `${(Number(baseRaw) / 1e6).toFixed(6)} USDC`,
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
                    usdc_balance: `${(Number(skaleRaw) / 1e6).toFixed(6)} USDC`,
                    credits_balance: `${(Number(creditsRaw) / 1e18).toFixed(8)} CREDITS`,
                    explorer: `${skaleCfg.explorer}/address/${account.address}`,
                    gas_token: 'CREDITS (~$0.0007/tx — 40 CREDITS ≈ 10,000 transactions)',
                    how_to_fund: 'CREDITS auto-funded on first setup. Bridge USDC from Base via https://bridge.skale.space',
                };
            } catch (err) {
                chains.skale = { network: skaleCfg.label, error: err.message };
            }

            // --- Auto-fund CREDITS if balance is 0 ---
            let autoFaucet = null;
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

            // Determine overall USDC status
            const baseUsdcNum = chains.base?.usdc_balance ? parseFloat(chains.base.usdc_balance) : 0;
            const skaleUsdcNum = chains.skale?.usdc_balance ? parseFloat(chains.skale.usdc_balance) : 0;
            const totalUsdc = baseUsdcNum + skaleUsdcNum;

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'ready',
                        address: account.address,
                        default_chain: CHAINS[DEFAULT_CHAIN_KEY].label,
                        wallet_source: isAutoGenerated ? 'auto-generated' : 'configured',
                        wallet_file: isAutoGenerated ? AUTO_WALLET_PATH : null,
                        chains,
                        auto_faucet: autoFaucet?.funded ? autoFaucet : (autoFaucet?.reason === 'no_faucet_configured' ? undefined : autoFaucet),
                        next_steps: totalUsdc === 0
                            ? [
                                'RECOMMENDED: Use chain: "skale" for ultra-low gas (~$0.0007/tx) — best for AI agents',
                                `Send USDC to ${account.address} on Base or SKALE on Base`,
                                'Minimum recommended: 1 USDC (covers ~20 API calls at 0.05 USDC each)',
                                `Session budget: ${MAX_BUDGET.toFixed(2)} USDC (set MAX_BUDGET_USDC to change)`,
                            ]
                            : [
                                `Wallet funded with ${totalUsdc.toFixed(6)} USDC total — ready to use paid APIs`,
                                'TIP: Use chain: "skale" for ultra-low gas (~$0.0007/tx)',
                                `Session budget: ${MAX_BUDGET.toFixed(2)} USDC (set MAX_BUDGET_USDC to change)`,
                            ],
                        wallet_backup_info: {
                            file_path: AUTO_WALLET_PATH,
                            encryption: 'AES-256-GCM (machine-bound key)',
                            export_tool: 'Use export_private_key to reveal your key for backup',
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error initializing wallet: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// --- Tool: export_private_key (FREE — backup only) ---
server.tool(
    'export_private_key',
    'Export your wallet private key for backup or to import into any external wallet. WARNING: This reveals your private key — handle with extreme care. Never share it with anyone. Free — no payment needed.',
    {
        confirm: z.enum(['yes_i_understand_the_risks']).describe(
            'You MUST pass "yes_i_understand_the_risks" to confirm you want to export your private key. This is a safety measure.'
        ),
    },
    async ({ confirm: _confirm }) => {
        try {
            const pk = getPrivateKey();
            tryInitWallet();
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    warning: 'SENSITIVE DATA — DO NOT SHARE WITH ANYONE',
                    address: account.address,
                    private_key: pk,
                    wallet_file: AUTO_WALLET_PATH,
                    instructions: [
                        'Store this private key in a secure password manager (e.g., 1Password, Bitwarden).',
                        'You can import it into any wallet (e.g. MetaMask, Coinbase Wallet, Rainbow): Settings → Import Account → Paste private key.',
                        'If you lose this key and your wallet file is deleted, your funds will be PERMANENTLY LOST.',
                        'This key controls all USDC on Base and SKALE on Base in this wallet.',
                    ],
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    error: 'Failed to export private key',
                    message: err.message,
                }, null, 2) }],
                isError: true,
            };
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
                    payments: sessionPayments,
                    default_chain: CHAINS[DEFAULT_CHAIN_KEY].label,
                    supported_chains: Object.entries(CHAINS)
                        .filter(([k]) => k !== 'base-sepolia')
                        .map(([k, v]) => ({ key: k, label: v.label })),
                }, null, 2),
            }],
        };
    }
);

// ─── Auto-update check (fire-and-forget) ────────────────────────────
const LOCAL_VERSION = '2.4.0';
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
