// erc8004.js — ERC-8004 Trustless Agent Identity (Base mainnet)
// Read-only helpers for verifying and fetching on-chain agent identities.

const { createPublicClient, http } = require('viem');
const { base } = require('viem/chains');

// --- Contract addresses (Base mainnet) ---
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

// --- Minimal ABI (only functions we need) ---
const IDENTITY_ABI = [
    {
        name: 'ownerOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ name: '', type: 'address' }],
    },
    {
        name: 'tokenURI',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ name: '', type: 'string' }],
    },
    {
        name: 'getAgentWallet',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ name: '', type: 'address' }],
    },
    {
        name: 'getMetadata',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'metadataKey', type: 'string' },
        ],
        outputs: [{ name: '', type: 'bytes' }],
    },
    {
        name: 'register',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'agentURI', type: 'string' }],
        outputs: [{ name: 'agentId', type: 'uint256' }],
    },
];

// --- Public client (read-only, no wallet needed) ---
const client = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
});

/**
 * Verify that an agentId exists on-chain and return basic info.
 * @param {number|string} agentId
 * @returns {Promise<{exists: boolean, owner?: string, agentURI?: string, wallet?: string}>}
 */
async function verifyAgent(agentId) {
    try {
        const id = BigInt(agentId);

        const [owner, agentURI, wallet] = await Promise.all([
            client.readContract({
                address: IDENTITY_REGISTRY,
                abi: IDENTITY_ABI,
                functionName: 'ownerOf',
                args: [id],
            }),
            client.readContract({
                address: IDENTITY_REGISTRY,
                abi: IDENTITY_ABI,
                functionName: 'tokenURI',
                args: [id],
            }),
            client.readContract({
                address: IDENTITY_REGISTRY,
                abi: IDENTITY_ABI,
                functionName: 'getAgentWallet',
                args: [id],
            }).catch(() => null), // intentionally silent — getAgentWallet may not exist for all tokens
        ]);

        return { exists: true, owner, agentURI, wallet };
    } catch (err) {
        // ownerOf reverts for non-existent tokens
        if (err.message && (err.message.includes('ERC721') || err.message.includes('revert'))) {
            return { exists: false };
        }
        throw err;
    }
}

/**
 * Fetch agentURI from chain, then fetch + parse the registration JSON.
 * @param {number|string} agentId
 * @returns {Promise<object|null>}
 */
async function getAgentInfo(agentId) {
    const verification = await verifyAgent(agentId);
    if (!verification.exists) return null;

    let registration = null;
    if (verification.agentURI) {
        try {
            const res = await fetch(verification.agentURI, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                registration = await res.json();
            }
        } catch {
            // URI unreachable — still return on-chain data
        }
    }

    return {
        agentId: String(agentId),
        owner: verification.owner,
        wallet: verification.wallet,
        agentURI: verification.agentURI,
        registration,
        registry: IDENTITY_REGISTRY,
        chain: 'base',
        chainId: 8453,
    };
}

module.exports = {
    IDENTITY_REGISTRY,
    REPUTATION_REGISTRY,
    IDENTITY_ABI,
    client,
    verifyAgent,
    getAgentInfo,
};
