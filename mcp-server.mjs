import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

function getPrivateKey() {
    if (process.env.AGENT_PRIVATE_KEY) {
        const key = process.env.AGENT_PRIVATE_KEY;
        return key.startsWith('0x') ? key : `0x${key}`;
    }

    // Legacy: encrypted agent-seed.json
    const seedPath = process.env.AGENT_SEED_PATH || join(__dirname, 'agent-seed.json');
    if (!fs.existsSync(seedPath)) {
        throw new Error(
            'No wallet configured. Set AGENT_PRIVATE_KEY in your .env file, ' +
            'or provide an agent-seed.json file. Run "npx x402-bazaar init" to set up automatically.'
        );
    }

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

function initWallet() {
    if (account) return;
    const privateKey = getPrivateKey();
    account = privateKeyToAccount(privateKey);
    console.error(`[Wallet] Initialized: ${account.address}`);
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

// ─── x402 Payment Flow (multi-chain, split-aware) ────────────────────
async function payAndRequest(url, options = {}, chainKey = DEFAULT_CHAIN_KEY) {
    const res = await fetch(url, options);
    const body = await res.json();

    if (res.status !== 402) {
        return body;
    }

    // HTTP 402 — Payment Required
    const details = body.payment_details;
    const cost = parseFloat(details.amount);

    // Budget check
    if (sessionSpending + cost > MAX_BUDGET) {
        throw new Error(
            `Budget limit reached. Spent: ${sessionSpending.toFixed(2)} USDC / ${MAX_BUDGET.toFixed(2)} USDC limit. ` +
            `This call costs ${cost} USDC. Increase MAX_BUDGET_USDC env var to allow more spending.`
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
            ...options.headers,
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
            ...options.headers,
            'X-Payment-TxHash': txHash,
            'X-Payment-Chain': cfg.paymentHeader,
        };
    }

    // Retry with payment proof
    const retryRes = await fetch(url, { ...options, headers: retryHeaders });
    const result = await retryRes.json();

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
    version: '2.3.0',
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
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" (default) or "skale" (ultra-low gas)'),
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
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" (default) or "skale" (ultra-low gas)'),
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
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" (default) or "skale" (ultra-low gas)'),
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
        body: z.record(z.any()).optional().describe('Optional JSON body to send with the request (for POST APIs)'),
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" (default) or "skale" (ultra-low gas)'),
    },
    async ({ service_id, body: requestBody, chain: chainKey }) => {
        const selectedChain = chainKey || DEFAULT_CHAIN_KEY;
        try {
            const proxyUrl = `${SERVER_URL}/api/call/${service_id}`;
            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody ? JSON.stringify(requestBody) : JSON.stringify({}),
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
        chain: z.enum(['base', 'skale']).optional().describe('Payment chain: "base" (default) or "skale" (ultra-low gas)'),
    },
    async ({ url, chain: chainKey }) => {
        const selectedChain = chainKey || DEFAULT_CHAIN_KEY;
        try {
            await validateUrlForSSRF(url);

            const res = await fetch(url);

            // ── x402 Payment Required ──────────────────────────────
            if (res.status === 402) {
                let body;
                try {
                    body = await res.json();
                } catch {
                    return {
                        content: [{ type: 'text', text: 'Error: API returned 402 Payment Required but response is not valid JSON' }],
                        isError: true,
                    };
                }

                const details = body.payment_details;
                if (!details || !details.amount || !details.recipient) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ error: 'Non-standard 402 response (missing payment_details)', raw: body }, null, 2) }],
                        isError: true,
                    };
                }

                const cost = parseFloat(details.amount);

                // Budget check
                if (sessionSpending + cost > MAX_BUDGET) {
                    return {
                        content: [{ type: 'text', text: `Error: Budget limit reached. Spent: ${sessionSpending.toFixed(2)} / ${MAX_BUDGET.toFixed(2)} USDC. This call costs ${cost} USDC. Increase MAX_BUDGET_USDC to allow more spending.` }],
                        isError: true,
                    };
                }

                const cfg = CHAINS[selectedChain];
                const isSplitMode = !!details.provider_wallet && details.payment_mode === 'split_native';
                let retryHeaders = {};

                if (isSplitMode) {
                    // ── Split mode: 95% to provider, 5% to platform ──
                    const totalRaw = BigInt(Math.round(cost * 1e6));
                    const providerRaw = details.split
                        ? BigInt(Math.round(parseFloat(details.split.provider_amount) * 1e6))
                        : totalRaw * 95n / 100n;
                    const platformRaw = totalRaw - providerRaw;

                    const txHashProvider = await sendUsdcTransfer(selectedChain, details.provider_wallet, providerRaw);

                    let txHashPlatform = null;
                    try {
                        txHashPlatform = await sendUsdcTransfer(selectedChain, details.recipient, platformRaw);
                    } catch (err) {
                        console.error(`[Split] Platform payment failed (fallback): ${err.message}`);
                    }

                    sessionSpending += cost;
                    sessionPayments.push({
                        amount: cost,
                        txHash: txHashProvider,
                        txHashPlatform,
                        chain: selectedChain,
                        splitMode: txHashPlatform ? 'split_complete' : 'provider_only',
                        timestamp: new Date().toISOString(),
                        endpoint: url,
                    });

                    retryHeaders = {
                        'X-Payment-TxHash-Provider': txHashProvider,
                        'X-Payment-Chain': cfg.paymentHeader,
                    };
                    if (txHashPlatform) {
                        retryHeaders['X-Payment-TxHash-Platform'] = txHashPlatform;
                    }
                } else {
                    // ── Legacy mode: single transfer ──
                    const amountInUnits = BigInt(Math.round(cost * 1e6));
                    const txHash = await sendUsdcTransfer(selectedChain, details.recipient, amountInUnits);

                    sessionSpending += cost;
                    sessionPayments.push({
                        amount: cost,
                        txHash,
                        chain: selectedChain,
                        timestamp: new Date().toISOString(),
                        endpoint: url,
                    });

                    retryHeaders = {
                        'X-Payment-TxHash': txHash,
                        'X-Payment-Chain': cfg.paymentHeader,
                    };
                }

                // Retry with payment proof
                const retryRes = await fetch(url, { headers: retryHeaders });

                const retryText = await retryRes.text();
                let result;
                try {
                    result = JSON.parse(retryText);
                } catch {
                    result = { response: retryText.slice(0, 5000) };
                }

                // Enrich with payment info
                const lastPmt = sessionPayments[sessionPayments.length - 1];
                result._payment = {
                    amount: details.amount,
                    currency: 'USDC',
                    txHash: lastPmt.txHash,
                    ...(lastPmt.txHashPlatform ? { txHashPlatform: lastPmt.txHashPlatform } : {}),
                    ...(lastPmt.splitMode ? { splitMode: lastPmt.splitMode } : {}),
                    chain: cfg.label,
                    explorer: `${cfg.explorer}/tx/${lastPmt.txHash}`,
                    session_spent: sessionSpending.toFixed(2),
                    session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
                };

                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };
            }

            // ── Normal response (non-402) ──────────────────────────
            const text = await res.text();
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = { response: text.slice(0, 5000) };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
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
            initWallet();
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
const LOCAL_VERSION = '2.3.0';
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
