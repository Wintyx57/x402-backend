import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');

// ─── Config ──────────────────────────────────────────────────────────
const SERVER_URL = process.env.X402_SERVER_URL || 'https://x402-api.onrender.com';
const MAX_BUDGET = parseFloat(process.env.MAX_BUDGET_USDC || '1.00');
const NETWORK = process.env.NETWORK || 'mainnet';
const explorerBase = NETWORK === 'testnet'
    ? 'https://sepolia.basescan.org'
    : 'https://basescan.org';
const networkLabel = NETWORK === 'testnet' ? 'Base Sepolia' : 'Base Mainnet';

// ─── Budget Tracking ─────────────────────────────────────────────────
let sessionSpending = 0;
const sessionPayments = [];

// ─── Wallet ──────────────────────────────────────────────────────────
let wallet = null;
let walletReady = false;

async function initWallet() {
    if (walletReady) return;

    Coinbase.configure({
        apiKeyName: process.env.COINBASE_API_KEY,
        privateKey: process.env.COINBASE_API_SECRET,
    });

    const seedPath = process.env.AGENT_SEED_PATH || 'agent-seed.json';
    const fs = await import('fs');
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    const seedWalletId = Object.keys(seedData)[0];

    wallet = await Wallet.fetch(seedWalletId);
    await wallet.loadSeed(seedPath);
    walletReady = true;
}

// ─── x402 Payment Flow ──────────────────────────────────────────────
async function payAndRequest(url, options = {}) {
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

    await initWallet();

    const transfer = await wallet.createTransfer({
        amount: details.amount,
        assetId: Coinbase.assets.Usdc,
        destination: details.recipient,
    });
    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();

    // Track spending
    sessionSpending += cost;
    sessionPayments.push({
        amount: cost,
        txHash,
        timestamp: new Date().toISOString(),
        endpoint: url.replace(SERVER_URL, ''),
    });

    // Retry with payment proof (MCP always pays on Base)
    const retryHeaders = { ...options.headers, 'X-Payment-TxHash': txHash, 'X-Payment-Chain': 'base' };
    const retryRes = await fetch(url, { ...options, headers: retryHeaders });
    const result = await retryRes.json();

    // Enrich result with payment info
    result._payment = {
        amount: details.amount,
        currency: 'USDC',
        txHash,
        explorer: `${explorerBase}/tx/${txHash}`,
        session_spent: sessionSpending.toFixed(2),
        session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
    };

    return result;
}

// ─── MCP Server ─────────────────────────────────────────────────────
const server = new McpServer({
    name: 'x402-bazaar',
    version: '1.1.0',
});

// --- Tool: discover_marketplace (FREE) ---
server.tool(
    'discover_marketplace',
    'Discover the x402 Bazaar marketplace. Returns available endpoints, total services, and protocol info. Free — no payment needed. Supports payments on Base and SKALE Europa (zero gas fees).',
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
    { query: z.string().describe('Search keyword (e.g. "weather", "crypto", "ai")') },
    async ({ query }) => {
        try {
            const result = await payAndRequest(
                `${SERVER_URL}/search?q=${encodeURIComponent(query)}`
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
    {},
    async () => {
        try {
            const result = await payAndRequest(`${SERVER_URL}/services`);
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
    { task: z.string().describe('What you need, in natural language (e.g. "get current weather for a city", "translate text to French", "get Bitcoin price")') },
    async ({ task }) => {
        try {
            // Extract keywords: remove stop words, keep meaningful terms
            const stopWords = new Set(['i', 'need', 'want', 'to', 'a', 'an', 'the', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'that', 'this', 'get', 'find', 'me', 'my', 'some', 'can', 'you', 'do', 'is', 'it', 'be', 'have', 'use', 'please', 'should', 'would', 'could']);
            const keywords = task.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.has(w));
            const query = keywords.slice(0, 3).join(' ') || task.slice(0, 30);

            const result = await payAndRequest(
                `${SERVER_URL}/search?q=${encodeURIComponent(query)}`
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
                    action: `Call this API using call_api("${best.url}"). ${Number(best.price_usdc) === 0 ? 'This API is free.' : `This API costs ${best.price_usdc} USDC per call (paid directly to the API provider, not via x402).`}`,
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

// --- Tool: call_api (FREE — calls external APIs) ---
// SSRF protection helper
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
    // DNS resolution check
    const dns = await import('dns');
    const { address } = await dns.promises.lookup(parsed.hostname);
    if (PRIVATE_IP_REGEX.test(address)) {
        throw new Error('Internal URLs not allowed');
    }
}

server.tool(
    'call_api',
    'Call an external API URL and return the response. Use this to fetch real data from service URLs discovered on the marketplace. Free — no marketplace payment needed.',
    { url: z.string().url().describe('The full API URL to call') },
    async ({ url }) => {
        try {
            // SSRF protection (I8/M6)
            await validateUrlForSSRF(url);

            const res = await fetch(url);
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

// --- Tool: get_wallet_balance (FREE) ---
server.tool(
    'get_wallet_balance',
    'Check the USDC balance of the agent wallet on-chain. Free.',
    {},
    async () => {
        try {
            await initWallet();
            const balance = await wallet.getBalance(Coinbase.assets.Usdc);
            const address = (await wallet.getDefaultAddress()).getId();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        address,
                        balance_usdc: balance.toString(),
                        network: networkLabel,
                        explorer: `${explorerBase}/address/${address}`,
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
                    network: networkLabel,
                }, null, 2),
            }],
        };
    }
);

// ─── Start ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
