// lib/chains.js — Chain configuration (multi-chain support)

const NETWORK = process.env.NETWORK || 'testnet';

const CHAINS = {
    base: {
        rpcUrl: 'https://mainnet.base.org',
        usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        chainId: 8453,
        explorer: 'https://basescan.org',
        label: 'Base',
    },
    'base-sepolia': {
        rpcUrl: 'https://sepolia.base.org',
        usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        chainId: 84532,
        explorer: 'https://sepolia.basescan.org',
        label: 'Base Sepolia',
    },
    skale: {
        rpcUrl: 'https://mainnet.skalenodes.com/v1/elated-tan-skat',
        usdcContract: '0x5F795bb52dAc3085f578f4877D450e2929D2F13d',
        chainId: 2046399126,
        explorer: 'https://elated-tan-skat.explorer.mainnet.skalenodes.com',
        label: 'SKALE Europa',
    },
};

const DEFAULT_CHAIN_KEY = NETWORK === 'mainnet' ? 'base' : 'base-sepolia';
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
