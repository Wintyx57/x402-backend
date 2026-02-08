import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');

// ─── Config ──────────────────────────────────────────────────────────
const SERVER_URL = process.env.X402_SERVER_URL || 'https://x402-api.onrender.com';

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
    await initWallet();

    const details = body.payment_details;
    const transfer = await wallet.createTransfer({
        amount: details.amount,
        assetId: Coinbase.assets.Usdc,
        destination: details.recipient,
    });
    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();

    // Retry with payment proof
    const retryHeaders = { ...options.headers, 'X-Payment-TxHash': txHash };
    const retryRes = await fetch(url, { ...options, headers: retryHeaders });
    const result = await retryRes.json();

    // Enrich result with payment info
    result._payment = {
        amount: details.amount,
        currency: 'USDC',
        txHash,
        explorer: `https://basescan.org/tx/${txHash}`,
    };

    return result;
}

// ─── MCP Server ─────────────────────────────────────────────────────
const server = new McpServer({
    name: 'x402-bazaar',
    version: '1.0.0',
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
    'Search for API services on x402 Bazaar by keyword. Returns matching services with name, description, URL, price, and tags. Costs 0.05 USDC (paid automatically via x402 protocol).',
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
    'List all API services available on x402 Bazaar. Returns the full catalog with names, descriptions, URLs, prices, and tags. Costs 0.05 USDC (paid automatically via x402 protocol).',
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

// --- Tool: call_api (FREE — calls external APIs) ---
server.tool(
    'call_api',
    'Call an external API URL and return the response. Use this to fetch real data from service URLs discovered on the marketplace. Free — no marketplace payment needed.',
    { url: z.string().url().describe('The full API URL to call') },
    async ({ url }) => {
        try {
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

// --- Tool: get_wallet_balance (FREE — check agent balance) ---
server.tool(
    'get_wallet_balance',
    'Check the USDC balance of the agent wallet. Free — useful to know how much budget is left before making paid requests.',
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
                        network: 'Base Mainnet',
                        explorer: `https://basescan.org/address/${address}`,
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

// ─── Start ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
