// lib/refund.js — Auto-refund engine for on-chain USDC refunds
//
// When shouldChargeForResponse() returns false (garbage response), the backend
// sends USDC back to the agent wallet on-chain.
//
// Uses REFUND_PRIVATE_KEY if set, otherwise falls back to AGENT_PRIVATE_KEY
// (same pattern as fee-splitter.js — avoids multiplying wallets).
//
// Design goals:
//   - Fire-and-forget: processRefund() never throws; errors are logged only.
//   - Lazy init: viem clients created once, on first real use.
//   - Graceful degradation: if no private key available, silently return not_configured.
//   - Anti-abuse: rate limit (5/10min/wallet), repeat tracker (3 per wallet+service = block 1h), daily cap.

'use strict';

const logger = require('./logger');
const { CHAINS, getChainConfig } = require('./chains');

// ---------------------------------------------------------------------------
// ERC-20 ABI (minimal — only transfer + balanceOf)
// ---------------------------------------------------------------------------
const ERC20_ABI = [
    {
        name: 'transfer',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
];

// ---------------------------------------------------------------------------
// Config — read once at module load
// ---------------------------------------------------------------------------
const REFUND_KEY = process.env.REFUND_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || null;
const DAILY_CAP = Number(process.env.REFUND_DAILY_CAP_USDC) || 50;

// ---------------------------------------------------------------------------
// Chain configs for refund engine
// ---------------------------------------------------------------------------
const CHAIN_CONFIGS = {
    base: {
        id: 8453,
        name: 'Base',
        rpc: 'https://mainnet.base.org',
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
    },
    skale: {
        id: 1187947933,
        name: 'SKALE on Base',
        rpc: 'https://skale-base.skalenodes.com/v1/base',
        usdc: '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20',
        decimals: 6,
    },
    polygon: {
        id: 137,
        name: 'Polygon',
        rpc: 'https://polygon-bor-rpc.publicnode.com',
        usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        decimals: 6,
    },
};

// ---------------------------------------------------------------------------
// Lazy-init state
// ---------------------------------------------------------------------------
let _initialized = false;
let _account = null;
const _clients = {};  // { base: { public, wallet }, ... }

// ---------------------------------------------------------------------------
// Anti-abuse state (in-memory)
// ---------------------------------------------------------------------------
const _balanceCache = {};     // { base: { balance: bigint, updatedAt: number }, ... }
const BALANCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const _refundRateLimit = new Map();  // agentWallet → { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes

const _repeatTracker = new Map();    // "wallet:serviceId" → { count, lastAt }
const REPEAT_MAX = 3;
const REPEAT_BLOCK_DURATION = 60 * 60 * 1000; // 1 hour

const _dailySpend = { base: 0, skale: 0, polygon: 0, resetAt: 0 };

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------
function init() {
    if (_initialized) return _account !== null;

    _initialized = true;

    if (!REFUND_KEY) {
        logger.info('Refund', 'Not configured — set REFUND_PRIVATE_KEY or AGENT_PRIVATE_KEY to enable auto-refunds');
        return false;
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(REFUND_KEY)) {
        logger.warn('Refund', 'REFUND_PRIVATE_KEY is not a valid private key (expected 0x + 64 hex chars)');
        return false;
    }

    try {
        const viem = require('viem');
        const { privateKeyToAccount } = require('viem/accounts');

        _account = privateKeyToAccount(/** @type {`0x${string}`} */ (REFUND_KEY));

        // Create clients for each chain
        for (const [key, cfg] of Object.entries(CHAIN_CONFIGS)) {
            const chain = {
                id: cfg.id,
                name: cfg.name,
                nativeCurrency: key === 'skale'
                    ? { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 }
                    : key === 'polygon'
                    ? { name: 'POL', symbol: 'POL', decimals: 18 }
                    : { name: 'ETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: { default: { http: [cfg.rpc] } },
            };

            _clients[key] = {
                public: viem.createPublicClient({
                    chain,
                    transport: viem.http(cfg.rpc),
                }),
                wallet: viem.createWalletClient({
                    account: _account,
                    chain,
                    transport: viem.http(cfg.rpc),
                }),
                usdcAddress: viem.getAddress(cfg.usdc),
            };
        }

        logger.info('Refund', `Initialized — refund wallet ${_account.address.slice(0, 10)}..., daily cap ${DAILY_CAP} USDC/chain`);
        return true;
    } catch (err) {
        logger.error('Refund', `Init failed: ${err.message}`);
        _account = null;
        return false;
    }
}

// ---------------------------------------------------------------------------
// isConfigured()
// ---------------------------------------------------------------------------
function isConfigured() {
    return !!(REFUND_KEY && /^0x[a-fA-F0-9]{64}$/.test(REFUND_KEY));
}

// ---------------------------------------------------------------------------
// getRefundWalletAddress()
// ---------------------------------------------------------------------------
function getRefundWalletAddress() {
    if (!init()) return null;
    return _account.address;
}

// ---------------------------------------------------------------------------
// getRefundStatus()
// ---------------------------------------------------------------------------
function getRefundStatus() {
    if (!init()) return null;

    _resetDailyIfNeeded();

    const keySource = process.env.REFUND_PRIVATE_KEY ? 'REFUND_PRIVATE_KEY' : 'AGENT_PRIVATE_KEY';
    return {
        configured: true,
        walletAddress: _account.address,
        keySource,
        dailyCap: DAILY_CAP,
        dailySpend: { ..._dailySpend },
        rateLimit: {
            maxPerWallet: RATE_LIMIT_MAX,
            windowMinutes: RATE_LIMIT_WINDOW / 60000,
        },
        repeatTracker: {
            maxPerWalletService: REPEAT_MAX,
            blockDurationMinutes: REPEAT_BLOCK_DURATION / 60000,
        },
        balanceCache: Object.fromEntries(
            Object.entries(_balanceCache).map(([k, v]) => [k, {
                balance_usdc: v.balance !== undefined ? (Number(v.balance) / 1e6).toFixed(6) : null,
                age_seconds: v.updatedAt ? Math.floor((Date.now() - v.updatedAt) / 1000) : null,
            }])
        ),
    };
}

// ---------------------------------------------------------------------------
// processRefund(agentWallet, amountUsdc, chainKey, serviceId, originalTxHash)
// ---------------------------------------------------------------------------
async function processRefund(agentWallet, amountUsdc, chainKey, serviceId, originalTxHash) {
    // 1. Init
    if (!init()) {
        return { refunded: false, reason: 'not_configured' };
    }

    // 2. Validate wallet format
    if (!agentWallet || !/^0x[a-fA-F0-9]{40}$/.test(agentWallet)) {
        return { refunded: false, reason: 'invalid_wallet' };
    }

    // 3. Validate chain
    const chainCfg = CHAIN_CONFIGS[chainKey];
    if (!chainCfg || !_clients[chainKey]) {
        return { refunded: false, reason: 'unsupported_chain' };
    }

    // 4. Rate limit: max 5 refunds / 10min / wallet
    const rlKey = agentWallet.toLowerCase();
    const rl = _refundRateLimit.get(rlKey);
    if (rl) {
        if (Date.now() < rl.resetAt) {
            if (rl.count >= RATE_LIMIT_MAX) {
                return { refunded: false, reason: 'rate_limited' };
            }
        } else {
            _refundRateLimit.set(rlKey, { count: 0, resetAt: Date.now() + RATE_LIMIT_WINDOW });
        }
    }

    // 5. Repeat tracker: 3+ refunds same (wallet, service) = blocked 1h
    const repeatKey = `${agentWallet.toLowerCase()}:${serviceId}`;
    const rt = _repeatTracker.get(repeatKey);
    if (rt) {
        if (rt.count >= REPEAT_MAX && Date.now() < rt.lastAt + REPEAT_BLOCK_DURATION) {
            return { refunded: false, reason: 'repeat_abuse' };
        }
        if (Date.now() >= rt.lastAt + REPEAT_BLOCK_DURATION) {
            // Reset after block period
            _repeatTracker.set(repeatKey, { count: 0, lastAt: Date.now() });
        }
    }

    // 6. Daily cap
    _resetDailyIfNeeded();
    if (_dailySpend[chainKey] + amountUsdc > DAILY_CAP) {
        return { refunded: false, reason: 'daily_cap_exceeded' };
    }

    // 7. Balance check (with cache)
    try {
        const balance = await _getBalance(chainKey);
        const amountRaw = BigInt(Math.round(amountUsdc * 1e6));
        if (balance < amountRaw) {
            return { refunded: false, reason: 'insufficient_balance' };
        }
    } catch (err) {
        logger.error('Refund', `Balance check failed on ${chainKey}: ${err.message}`);
        return { refunded: false, reason: 'balance_check_failed' };
    }

    // 8. Execute on-chain transfer
    try {
        const viem = require('viem');
        const client = _clients[chainKey];
        const amountRaw = BigInt(Math.round(amountUsdc * 1e6));
        const checksumRecipient = viem.getAddress(agentWallet);

        const txHash = await client.wallet.writeContract({
            address: client.usdcAddress,
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [checksumRecipient, amountRaw],
        });

        // 9. Update counters
        _updateRateLimit(rlKey);
        _updateRepeatTracker(repeatKey);
        _dailySpend[chainKey] += amountUsdc;
        // Invalidate balance cache
        delete _balanceCache[chainKey];

        logger.info('Refund', `Refunded ${amountUsdc} USDC to ${agentWallet.slice(0, 10)}... on ${chainKey} — tx: ${txHash}`);
        return { refunded: true, txHash };
    } catch (err) {
        logger.error('Refund', `Transfer failed on ${chainKey} to ${agentWallet.slice(0, 10)}...: ${err.message}`);
        return { refunded: false, reason: 'transfer_failed' };
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _getBalance(chainKey) {
    const cached = _balanceCache[chainKey];
    if (cached && Date.now() - cached.updatedAt < BALANCE_CACHE_TTL) {
        return cached.balance;
    }

    const client = _clients[chainKey];
    const balance = await client.public.readContract({
        address: client.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [_account.address],
    });

    _balanceCache[chainKey] = { balance, updatedAt: Date.now() };
    return balance;
}

function _updateRateLimit(walletKey) {
    const rl = _refundRateLimit.get(walletKey);
    if (rl && Date.now() < rl.resetAt) {
        rl.count += 1;
    } else {
        _refundRateLimit.set(walletKey, { count: 1, resetAt: Date.now() + RATE_LIMIT_WINDOW });
    }
}

function _updateRepeatTracker(repeatKey) {
    const rt = _repeatTracker.get(repeatKey);
    if (rt) {
        rt.count += 1;
        rt.lastAt = Date.now();
    } else {
        _repeatTracker.set(repeatKey, { count: 1, lastAt: Date.now() });
    }
}

function _resetDailyIfNeeded() {
    const now = Date.now();
    if (now >= _dailySpend.resetAt) {
        _dailySpend.base = 0;
        _dailySpend.skale = 0;
        _dailySpend.polygon = 0;
        // Reset at next midnight UTC
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 0, 0);
        _dailySpend.resetAt = tomorrow.getTime();
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
    init,
    isConfigured,
    getRefundWalletAddress,
    getRefundStatus,
    processRefund,
};
