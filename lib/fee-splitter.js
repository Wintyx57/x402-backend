// lib/fee-splitter.js — FeeSplitter contract interaction (Polygon mainnet)
//
// Calls distribute(provider, amount) on the deployed FeeSplitter contract after
// a facilitator payment lands in the contract.  This splits funds 95% to the
// provider and 5% to the platform.
//
// Design goals:
//   - Fire-and-forget: callDistribute() never throws; errors are logged only.
//   - Lazy init: the viem walletClient is created once, on first real use, and
//     only when the required env vars are present.
//   - Zero crash on missing config: if FEE_SPLITTER_OPERATOR_KEY or
//     POLYGON_FEE_SPLITTER_CONTRACT is absent, every call returns null silently.

'use strict';

const logger = require('./logger');

// ---------------------------------------------------------------------------
// ABI (minimal — only the functions we call)
// ---------------------------------------------------------------------------
const FEE_SPLITTER_ABI = [
    {
        name: 'distribute',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'provider', type: 'address' },
            { name: 'amount',   type: 'uint256' },
        ],
        outputs: [],
    },
    {
        name: 'pendingBalance',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'previewSplit',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [
            { name: 'providerShare', type: 'uint256' },
            { name: 'platformShare', type: 'uint256' },
        ],
    },
];

// ---------------------------------------------------------------------------
// Config — read once at module load
// ---------------------------------------------------------------------------
const FEE_SPLITTER_ADDRESS = process.env.POLYGON_FEE_SPLITTER_CONTRACT || null;
const OPERATOR_KEY         = process.env.FEE_SPLITTER_OPERATOR_KEY || null;
const POLYGON_RPC          = 'https://polygon-bor-rpc.publicnode.com';

// ---------------------------------------------------------------------------
// Lazy-init state
// ---------------------------------------------------------------------------
let _initialized    = false;   // true once init() ran (success OR not-configured)
let _publicClient   = null;
let _walletClient   = null;
let _contractAddress = null;   // checksummed address string used by viem

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------
// Idempotent. Called on first use. Returns true when the clients are ready.
// ---------------------------------------------------------------------------
function init() {
    if (_initialized) return _walletClient !== null;

    _initialized = true;

    if (!FEE_SPLITTER_ADDRESS || !OPERATOR_KEY) {
        logger.info('FeeSplitter', 'Not configured — set FEE_SPLITTER_OPERATOR_KEY + POLYGON_FEE_SPLITTER_CONTRACT to enable distribute()');
        return false;
    }

    // Validate address format (basic check before handing to viem)
    if (!/^0x[a-fA-F0-9]{40}$/.test(FEE_SPLITTER_ADDRESS)) {
        logger.warn('FeeSplitter', `POLYGON_FEE_SPLITTER_CONTRACT is not a valid address: ${FEE_SPLITTER_ADDRESS}`);
        return false;
    }

    // Validate private key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(OPERATOR_KEY)) {
        logger.warn('FeeSplitter', 'FEE_SPLITTER_OPERATOR_KEY does not look like a valid private key (expected 0x + 64 hex chars)');
        return false;
    }

    try {
        // viem is already a backend dep (package.json: "viem": "^2.47.1")
        const viem = require('viem');
        const { privateKeyToAccount } = require('viem/accounts');

        const polygonChain = {
            id: 137,
            name: 'Polygon',
            nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
            rpcUrls: { default: { http: [POLYGON_RPC] } },
        };

        const account = privateKeyToAccount(/** @type {`0x${string}`} */ (OPERATOR_KEY));

        _publicClient = viem.createPublicClient({
            chain: polygonChain,
            transport: viem.http(POLYGON_RPC),
        });

        _walletClient = viem.createWalletClient({
            account,
            chain: polygonChain,
            transport: viem.http(POLYGON_RPC),
        });

        // viem requires checksummed addresses — getAddress() returns the checksum form
        _contractAddress = viem.getAddress(FEE_SPLITTER_ADDRESS);

        logger.info('FeeSplitter', `Initialized — contract ${_contractAddress}, operator ${account.address.slice(0, 10)}...`);
        return true;
    } catch (err) {
        logger.error('FeeSplitter', `Init failed: ${err.message}`);
        _walletClient = null;
        _publicClient = null;
        return false;
    }
}

// ---------------------------------------------------------------------------
// callDistribute(providerAddress, amountRaw)
// ---------------------------------------------------------------------------
// Sends a distribute(provider, amount) transaction on Polygon.
// Fire-and-forget: returns txHash on success, null on any error.
// NEVER throws — safe to call without try/catch.
//
// @param {string} providerAddress  — 0x-prefixed provider wallet address
// @param {number|bigint} amountRaw — amount in micro-USDC (6 decimals, e.g. 1000000 = 1 USDC)
// @returns {Promise<string|null>}   tx hash or null
// ---------------------------------------------------------------------------
async function callDistribute(providerAddress, amountRaw) {
    if (!init()) {
        // Not configured — silently return null (not an error state)
        return null;
    }

    // Validate provider address
    if (!/^0x[a-fA-F0-9]{40}$/.test(providerAddress)) {
        logger.warn('FeeSplitter', `callDistribute() — invalid providerAddress: ${String(providerAddress).slice(0, 20)}`);
        return null;
    }

    const amount = BigInt(amountRaw);
    if (amount <= 0n) {
        logger.warn('FeeSplitter', `callDistribute() — amountRaw must be > 0, got ${amountRaw}`);
        return null;
    }

    try {
        const viem = require('viem');
        const checksumProvider = viem.getAddress(providerAddress);

        const txHash = await _walletClient.writeContract({
            address: _contractAddress,
            abi: FEE_SPLITTER_ABI,
            functionName: 'distribute',
            args: [checksumProvider, amount],
        });

        const usdcHuman = (Number(amount) / 1e6).toFixed(6);
        logger.info('FeeSplitter', `distribute(${checksumProvider.slice(0, 10)}..., ${usdcHuman} USDC) — tx: ${txHash}`);
        return txHash;
    } catch (err) {
        logger.error('FeeSplitter', `distribute() failed for provider ${providerAddress.slice(0, 10)}...: ${err.message}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// getPendingBalance()
// ---------------------------------------------------------------------------
// Reads the current USDC balance held in the FeeSplitter contract.
// Returns the raw BigInt value (micro-USDC, 6 decimals), or null on error.
//
// @returns {Promise<bigint|null>}
// ---------------------------------------------------------------------------
async function getPendingBalance() {
    if (!init()) return null;

    try {
        const balance = await _publicClient.readContract({
            address: _contractAddress,
            abi: FEE_SPLITTER_ABI,
            functionName: 'pendingBalance',
        });
        return balance; // BigInt
    } catch (err) {
        logger.error('FeeSplitter', `getPendingBalance() failed: ${err.message}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// previewSplit(amountRaw)
// ---------------------------------------------------------------------------
// Reads the expected split for a given amount without sending a transaction.
// Returns { providerShare: bigint, platformShare: bigint } or null on error.
//
// @param {number|bigint} amountRaw — amount in micro-USDC
// @returns {Promise<{providerShare: bigint, platformShare: bigint}|null>}
// ---------------------------------------------------------------------------
async function previewSplit(amountRaw) {
    if (!init()) return null;

    try {
        const [providerShare, platformShare] = await _publicClient.readContract({
            address: _contractAddress,
            abi: FEE_SPLITTER_ABI,
            functionName: 'previewSplit',
            args: [BigInt(amountRaw)],
        });
        return { providerShare, platformShare };
    } catch (err) {
        logger.error('FeeSplitter', `previewSplit() failed: ${err.message}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// isConfigured()
// ---------------------------------------------------------------------------
// Synchronous helper — true when both required env vars are present and valid.
// Useful for conditional logic at startup without triggering full init.
// ---------------------------------------------------------------------------
function isConfigured() {
    return !!(
        FEE_SPLITTER_ADDRESS &&
        OPERATOR_KEY &&
        /^0x[a-fA-F0-9]{40}$/.test(FEE_SPLITTER_ADDRESS) &&
        /^0x[a-fA-F0-9]{64}$/.test(OPERATOR_KEY)
    );
}

module.exports = {
    init,
    callDistribute,
    getPendingBalance,
    previewSplit,
    isConfigured,
};
