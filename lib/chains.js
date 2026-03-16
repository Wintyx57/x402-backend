// lib/chains.js — Chain configuration (multi-chain support)

const NETWORK = process.env.NETWORK || 'testnet';

const CHAINS = {
    base: {
        rpcUrl: 'https://mainnet.base.org',
        rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com', 'https://1rpc.io/base'],
        usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        usdcDecimals: 6,
        chainId: 8453,
        explorer: 'https://basescan.org',
        label: 'Base',
    },
    'base-sepolia': {
        rpcUrl: 'https://sepolia.base.org',
        rpcUrls: ['https://sepolia.base.org'],
        usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        usdcDecimals: 6,
        chainId: 84532,
        explorer: 'https://sepolia.basescan.org',
        label: 'Base Sepolia',
    },
    skale: {
        rpcUrl: 'https://skale-base.skalenodes.com/v1/base',
        rpcUrls: [
            'https://skale-base.skalenodes.com/v1/base',
            'https://1187947933.rpc.thirdweb.com',
        ],
        usdcContract: '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20',
        usdcDecimals: 6,
        chainId: 1187947933,
        explorer: 'https://skale-base-explorer.skalenodes.com',
        label: 'SKALE on Base',
    },
    polygon: {
        rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
        rpcUrls: ['https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic', 'https://rpc.ankr.com/polygon'],
        usdcContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        usdcDecimals: 6,
        chainId: 137,
        explorer: 'https://polygonscan.com',
        label: 'Polygon',
        // Phase 2: Polygon facilitator (gas-free payments via https://x402.polygon.technology)
        // When these vars are set, the backend uses HTTP verification instead of direct RPC.
        // When absent, falls back transparently to Phase 1 (direct on-chain RPC verification).
        facilitator: process.env.POLYGON_FACILITATOR_URL || null,
        feeSplitterContract: process.env.POLYGON_FEE_SPLITTER_CONTRACT || null,
    },
};

const DEFAULT_CHAIN_KEY = NETWORK === 'testnet' ? 'base-sepolia'
    : (NETWORK === 'base' ? 'base' : 'skale');

if (!['testnet', 'base', 'skale', 'polygon', 'mainnet'].includes(NETWORK)) {
    console.warn(`[chains] Unknown NETWORK="${NETWORK}" — defaulting to chain: ${DEFAULT_CHAIN_KEY}`);
}

const DEFAULT_CHAIN = CHAINS[DEFAULT_CHAIN_KEY];

function getChainConfig(chainKey) {
    return CHAINS[chainKey] || CHAINS[DEFAULT_CHAIN_KEY];
}

// Backward-compat aliases
const RPC_URL = DEFAULT_CHAIN.rpcUrl;
const USDC_CONTRACT = DEFAULT_CHAIN.usdcContract;
const EXPLORER_URL = DEFAULT_CHAIN.explorer;
const NETWORK_LABEL = DEFAULT_CHAIN.label;

module.exports = {
    NETWORK,
    CHAINS,
    DEFAULT_CHAIN_KEY,
    DEFAULT_CHAIN,
    getChainConfig,
    RPC_URL,
    USDC_CONTRACT,
    EXPLORER_URL,
    NETWORK_LABEL,
};
