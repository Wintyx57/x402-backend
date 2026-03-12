// erc8004.js — ERC-8004 Trustless Agent Identity & Reputation
// Read helpers + ABIs for on-chain agent registration and reputation.

const { createPublicClient, http } = require('viem');
const { base } = require('viem/chains');
const { safeUrl } = require('./lib/safe-url');

// --- Contract addresses (same deterministic addresses on all chains) ---
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

// --- Identity Registry ABI ---
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
    {
        name: 'setAgentURI',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'newURI', type: 'string' },
        ],
        outputs: [],
    },
    {
        name: 'Registered',
        type: 'event',
        inputs: [
            { name: 'agentId', type: 'uint256', indexed: true },
            { name: 'agentURI', type: 'string', indexed: false },
            { name: 'owner', type: 'address', indexed: true },
        ],
    },
];

// --- Reputation Registry ABI ---
const REPUTATION_ABI = [
    {
        name: 'giveFeedback',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'value', type: 'int128' },
            { name: 'valueDecimals', type: 'uint8' },
            { name: 'tag1', type: 'string' },
            { name: 'tag2', type: 'string' },
            { name: 'endpoint', type: 'string' },
            { name: 'feedbackURI', type: 'string' },
            { name: 'feedbackHash', type: 'bytes32' },
        ],
        outputs: [],
    },
    {
        name: 'getSummary',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'clientAddresses', type: 'address[]' },
            { name: 'tag1', type: 'string' },
            { name: 'tag2', type: 'string' },
        ],
        outputs: [
            { name: 'count', type: 'uint64' },
            { name: 'summaryValue', type: 'int128' },
            { name: 'summaryValueDecimals', type: 'uint8' },
        ],
    },
    {
        name: 'getClients',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ name: '', type: 'address[]' }],
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
            // SSRF protection: validate URL before fetching (blocks internal/private IPs)
            const validatedUrl = await safeUrl(verification.agentURI);
            const res = await fetch(validatedUrl.toString(), { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                registration = await res.json();
            }
        } catch {
            // URI unreachable or blocked — still return on-chain data
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
    REPUTATION_ABI,
    client,
    verifyAgent,
    getAgentInfo,
};
