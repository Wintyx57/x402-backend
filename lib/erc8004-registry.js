// lib/erc8004-registry.js — ERC-8004 on-chain agent registration + reputation
// Étape 1: Register services as agents (Identity Registry, ERC-721 NFT)
// Étape 2: Push TrustScores on-chain as feedback (Reputation Registry)
//
// CRITICAL: Two separate wallets required by ERC-8004 spec:
//   - Registry wallet (AGENT_PRIVATE_KEY): owns agent NFTs
//   - Feedback wallet (ERC8004_FEEDBACK_KEY): submits reputation scores
//   The contract rejects feedback from the agent owner.

'use strict';

const { createPublicClient, createWalletClient, http, fallback, defineChain, keccak256, toBytes, decodeEventLog } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const logger = require('./logger');
const { CHAINS } = require('./chains');
const {
    IDENTITY_REGISTRY,
    REPUTATION_REGISTRY,
    IDENTITY_ABI,
    REPUTATION_ABI,
} = require('../erc8004');

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------
const CHAIN_KEY = 'skale';
const CHAIN_CFG = CHAINS[CHAIN_KEY];
const BATCH_SIZE = 5;
const BATCH_DELAY = 3000;            // ms between batches
const TX_TIMEOUT = 30_000;           // 30s receipt wait
const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://x402-api.onrender.com';

// ---------------------------------------------------------------------------
// CLIENTS (lazy-init)
// ---------------------------------------------------------------------------
let _publicClient = null;
let _registryAccount = null;
let _registryWalletClient = null;
let _feedbackAccount = null;
let _feedbackWalletClient = null;
let _registryNonce = null;
let _feedbackNonce = null;

// Race condition guard: prevents concurrent calls to pushAllTrustScores
// from two timers triggering simultaneously (e.g. startup timer + recalc interval).
let _pushInProgress = false;

// ---------------------------------------------------------------------------
// PUSH RESULT TRACKING (in-memory diagnostic)
// ---------------------------------------------------------------------------
let _lastPushResult = {
    timestamp: null,
    pushed: 0,
    failed: 0,
    total: 0,
    error: null,
    feedbackWalletConfigured: false,
    duration_ms: null,
};

function _buildChain() {
    return defineChain({
        id: CHAIN_CFG.chainId,
        name: CHAIN_CFG.label,
        nativeCurrency: { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 },
        rpcUrls: {
            default: { http: CHAIN_CFG.rpcUrls || [CHAIN_CFG.rpcUrl] },
        },
    });
}

function _buildTransport() {
    const urls = CHAIN_CFG.rpcUrls || [CHAIN_CFG.rpcUrl];
    return urls.length > 1 ? fallback(urls.map(u => http(u))) : http(urls[0]);
}

/**
 * Initialize viem clients for on-chain operations.
 * Called once at server startup. Non-blocking — logs warnings if keys missing.
 */
function initClients() {
    if (!CHAIN_CFG) {
        logger.warn('ERC8004', 'SKALE chain config not found — on-chain features disabled');
        return;
    }

    const chain = _buildChain();
    const transport = _buildTransport();

    _publicClient = createPublicClient({ chain, transport });

    // --- Registry wallet (owns agent NFTs) ---
    const registryKey = process.env.ERC8004_REGISTRY_KEY || process.env.AGENT_PRIVATE_KEY;
    if (registryKey) {
        const pk = registryKey.startsWith('0x') ? registryKey : `0x${registryKey}`;
        _registryAccount = privateKeyToAccount(pk);
        _registryWalletClient = createWalletClient({
            account: _registryAccount, chain, transport,
        });
        logger.info('ERC8004', `Registry wallet: ${_registryAccount.address.slice(0, 10)}...`);
    } else {
        logger.warn('ERC8004', 'No registry key (AGENT_PRIVATE_KEY) — agent registration disabled');
    }

    // --- Feedback wallet (submits reputation — MUST differ from registry) ---
    const feedbackKey = process.env.ERC8004_FEEDBACK_KEY;
    if (feedbackKey) {
        const pk = feedbackKey.startsWith('0x') ? feedbackKey : `0x${feedbackKey}`;
        _feedbackAccount = privateKeyToAccount(pk);

        // Safety: verify wallets are different (ERC-8004 rejects self-feedback)
        if (_registryAccount &&
            _feedbackAccount.address.toLowerCase() === _registryAccount.address.toLowerCase()) {
            logger.error('ERC8004', 'CRITICAL: ERC8004_FEEDBACK_KEY = same address as registry wallet! Feedback will be rejected.');
            _feedbackAccount = null;
            return;
        }

        _feedbackWalletClient = createWalletClient({
            account: _feedbackAccount, chain, transport,
        });
        logger.info('ERC8004', `Feedback wallet: ${_feedbackAccount.address.slice(0, 10)}...`);
    } else {
        logger.info('ERC8004', 'No ERC8004_FEEDBACK_KEY — on-chain reputation push disabled');
    }
}

// ---------------------------------------------------------------------------
// NONCE MANAGEMENT (same pattern as daily-tester.js)
// ---------------------------------------------------------------------------
async function _initNonce(account, label) {
    const nonce = await _publicClient.getTransactionCount({ address: account.address });
    logger.info('ERC8004', `${label} nonce initialized: ${nonce}`);
    return nonce;
}

/**
 * Returns true if the error looks like a network/timeout failure.
 * In that case, the TX may have been broadcast already — we must NOT
 * decrement the nonce blindly, and should re-fetch it from the chain.
 */
function _isTimeoutOrNetworkError(err) {
    const msg = err.message?.toLowerCase() || '';
    return (
        msg.includes('timeout') ||
        msg.includes('timed out') ||
        msg.includes('network') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('socket') ||
        msg.includes('fetch failed') ||
        msg.includes('failed to fetch')
    );
}

// ---------------------------------------------------------------------------
// ÉTAPE 1: REGISTER AGENT (Identity Registry)
// ---------------------------------------------------------------------------

/**
 * Register a service as an ERC-8004 agent on SKALE on Base.
 * @param {string} serviceId — UUID of the service in Supabase
 * @param {string} serviceName — Human-readable name
 * @param {string} serviceUrl — API endpoint URL
 * @param {string} serviceDescription — Description
 * @returns {Promise<{agentId: number, txHash: string}|null>}
 */
async function registerAgent(serviceId, serviceName, serviceUrl, serviceDescription) {
    if (!_registryWalletClient || !_registryAccount) {
        logger.warn('ERC8004', 'Registry wallet not configured — skipping on-chain registration');
        return null;
    }

    const agentURI = `${BACKEND_URL}/api/agents/${serviceId}/metadata.json`;

    try {
        if (_registryNonce === null) {
            _registryNonce = await _initNonce(_registryAccount, 'Registry');
        }

        const nonce = _registryNonce;
        _registryNonce++;

        const txHash = await _registryWalletClient.writeContract({
            address: IDENTITY_REGISTRY,
            abi: IDENTITY_ABI,
            functionName: 'register',
            args: [agentURI],
            nonce,
            type: 'legacy',
        });

        const receipt = await _publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
            timeout: TX_TIMEOUT,
        });

        // Parse agentId from Registered event
        let agentId = null;
        for (const log of receipt.logs) {
            try {
                const decoded = decodeEventLog({
                    abi: IDENTITY_ABI,
                    data: log.data,
                    topics: log.topics,
                });
                if (decoded.eventName === 'Registered') {
                    agentId = Number(decoded.args.agentId);
                    break;
                }
            } catch {
                // Not our event — skip
            }
        }

        logger.info('ERC8004', `Registered "${serviceName}" → agentId=${agentId} tx=${txHash.slice(0, 18)}...`);
        return { agentId, txHash };
    } catch (err) {
        // On timeout/network error, the TX may have already been broadcast.
        // Re-fetch nonce from chain to stay in sync instead of decrementing blindly.
        if (_registryNonce !== null && _isTimeoutOrNetworkError(err)) {
            logger.warn('ERC8004', `Registry TX timeout — re-fetching nonce from chain for "${serviceName}"`);
            try {
                _registryNonce = await _publicClient.getTransactionCount({ address: _registryAccount.address });
            } catch (nonceErr) {
                logger.warn('ERC8004', `Failed to re-fetch registry nonce: ${nonceErr.message}`);
            }
        } else if (_registryNonce !== null &&
            !err.message?.includes('already known') &&
            !err.message?.includes('nonce too low')) {
            // TX was not broadcast — safe to reclaim the nonce slot
            _registryNonce--;
        }
        logger.error('ERC8004', `Registration failed for "${serviceName}": ${err.message}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// ÉTAPE 2: PUSH TRUST SCORE (Reputation Registry)
// ---------------------------------------------------------------------------

/**
 * Push a single TrustScore as on-chain feedback.
 * @param {number} agentId — ERC-8004 agent ID (from Identity Registry)
 * @param {number} trustScore — Score 0-100
 * @param {string} serviceUrl — API endpoint
 * @returns {Promise<{txHash: string}|null>}
 */
async function pushTrustScoreFeedback(agentId, trustScore, serviceUrl) {
    if (!_feedbackWalletClient || !_feedbackAccount) {
        return null;
    }

    // Fixed-point: value=8700, decimals=2 → 87.00
    const value = BigInt(Math.round(trustScore * 100));
    const valueDecimals = 2;
    const tag1 = 'trust_score';
    const tag2 = 'x402_bazaar';
    const endpoint = serviceUrl || '';
    const feedbackURI = '';

    // feedbackHash: keccak256 of score data for verifiability
    const feedbackData = JSON.stringify({ score: trustScore, ts: Math.floor(Date.now() / 1000) });
    const feedbackHash = keccak256(toBytes(feedbackData));

    try {
        if (_feedbackNonce === null) {
            _feedbackNonce = await _initNonce(_feedbackAccount, 'Feedback');
        }

        const nonce = _feedbackNonce;
        _feedbackNonce++;

        const txHash = await _feedbackWalletClient.writeContract({
            address: REPUTATION_REGISTRY,
            abi: REPUTATION_ABI,
            functionName: 'giveFeedback',
            args: [BigInt(agentId), value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash],
            nonce,
            type: 'legacy',
        });

        await _publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
            timeout: TX_TIMEOUT,
        });

        return { txHash, agentId, score: trustScore };
    } catch (err) {
        // On timeout/network error, the TX may have already been broadcast.
        // Re-fetch nonce from chain to stay in sync instead of decrementing blindly.
        if (_feedbackNonce !== null && _isTimeoutOrNetworkError(err)) {
            logger.warn('ERC8004', `Feedback TX timeout — re-fetching nonce from chain for agentId=${agentId}`);
            try {
                _feedbackNonce = await _publicClient.getTransactionCount({ address: _feedbackAccount.address });
            } catch (nonceErr) {
                logger.warn('ERC8004', `Failed to re-fetch feedback nonce: ${nonceErr.message}`);
            }
        } else if (_feedbackNonce !== null &&
            !err.message?.includes('already known') &&
            !err.message?.includes('nonce too low')) {
            // TX was not broadcast — safe to reclaim the nonce slot
            _feedbackNonce--;
        }
        logger.warn('ERC8004', `Feedback failed agentId=${agentId}: ${err.message}`);
        return null;
    }
}

/**
 * Push all TrustScores on-chain (called after recalculateAllScores).
 * Fire-and-forget — errors are logged, never thrown.
 * Guard: concurrent calls are rejected to avoid nonce conflicts.
 */
async function pushAllTrustScores(supabase) {
    _lastPushResult.feedbackWalletConfigured = !!_feedbackWalletClient;

    if (!_feedbackWalletClient) {
        logger.info('ERC8004', 'Feedback wallet not configured — skipping reputation push');
        _lastPushResult.error = 'Feedback wallet not configured';
        _lastPushResult.timestamp = new Date().toISOString();
        return;
    }

    if (_pushInProgress) {
        logger.info('ERC8004', 'pushAllTrustScores already in progress — skipping concurrent call');
        return;
    }
    _pushInProgress = true;
    const startTime = Date.now();

    try {
        const { data: services, error } = await supabase
            .from('services')
            .select('id, name, url, trust_score, erc8004_agent_id')
            .not('trust_score', 'is', null)
            .not('erc8004_agent_id', 'is', null)
            .limit(500);

        if (error || !services || services.length === 0) {
            logger.info('ERC8004', 'No services with trust_score + erc8004_agent_id — skipping');
            _lastPushResult = {
                ..._lastPushResult,
                timestamp: new Date().toISOString(),
                pushed: 0, failed: 0, total: 0,
                error: error ? error.message : 'No services with trust_score + erc8004_agent_id',
                duration_ms: Date.now() - startTime,
            };
            return;
        }

        // Re-init nonce for this batch run
        _feedbackNonce = await _initNonce(_feedbackAccount, 'Feedback');

        let pushed = 0;
        let failed = 0;

        for (let i = 0; i < services.length; i += BATCH_SIZE) {
            const batch = services.slice(i, i + BATCH_SIZE);

            const results = await Promise.all(
                batch.map(svc =>
                    pushTrustScoreFeedback(svc.erc8004_agent_id, svc.trust_score, svc.url)
                        .catch(() => null)
                )
            );

            pushed += results.filter(r => r !== null).length;
            failed += results.filter(r => r === null).length;

            if (i + BATCH_SIZE < services.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        _lastPushResult = {
            timestamp: new Date().toISOString(),
            pushed,
            failed,
            total: services.length,
            error: null,
            feedbackWalletConfigured: true,
            duration_ms: Date.now() - startTime,
        };

        logger.info('ERC8004', `Reputation push: ${pushed} ok, ${failed} failed / ${services.length} total`);
    } catch (err) {
        _lastPushResult = {
            ..._lastPushResult,
            timestamp: new Date().toISOString(),
            error: err.message,
            duration_ms: Date.now() - startTime,
        };
        logger.error('ERC8004', `pushAllTrustScores failed: ${err.message}`);
    } finally {
        _pushInProgress = false;
    }
}

/**
 * Get the last push result (in-memory diagnostic).
 */
function getPushStatus() {
    return { ..._lastPushResult, pushInProgress: _pushInProgress };
}

/**
 * Get feedback wallet info (address + CREDITS balance).
 */
async function getFeedbackWalletInfo() {
    if (!_feedbackAccount) {
        return { configured: false, address: null, credits_balance: null };
    }
    let creditsBalance = null;
    if (_publicClient) {
        try {
            const balance = await _publicClient.getBalance({ address: _feedbackAccount.address });
            creditsBalance = (Number(balance) / 1e18).toFixed(6);
        } catch (err) {
            logger.warn('ERC8004', `Failed to read feedback wallet balance: ${err.message}`);
        }
    }
    return {
        configured: true,
        address: _feedbackAccount.address,
        credits_balance: creditsBalance,
    };
}

/**
 * Force push all trust scores (synchronous — waits for results, ignores _pushInProgress guard).
 * Used by admin endpoint for manual trigger.
 */
async function forcePushAllScores(supabase) {
    _lastPushResult.feedbackWalletConfigured = !!_feedbackWalletClient;

    if (!_feedbackWalletClient) {
        return { success: false, error: 'Feedback wallet not configured' };
    }

    const startTime = Date.now();

    const { data: services, error } = await supabase
        .from('services')
        .select('id, name, url, trust_score, erc8004_agent_id')
        .not('trust_score', 'is', null)
        .not('erc8004_agent_id', 'is', null)
        .limit(500);

    if (error) {
        return { success: false, error: error.message };
    }
    if (!services || services.length === 0) {
        return { success: true, pushed: 0, failed: 0, total: 0, message: 'No services with trust_score + erc8004_agent_id' };
    }

    // Re-init nonce
    _feedbackNonce = await _initNonce(_feedbackAccount, 'Feedback');

    let pushed = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < services.length; i += BATCH_SIZE) {
        const batch = services.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
            batch.map(async svc => {
                try {
                    const r = await pushTrustScoreFeedback(svc.erc8004_agent_id, svc.trust_score, svc.url);
                    return r ? { ...r, name: svc.name } : { agentId: svc.erc8004_agent_id, name: svc.name, error: 'returned null' };
                } catch (err) {
                    return { agentId: svc.erc8004_agent_id, name: svc.name, error: err.message };
                }
            })
        );

        for (const r of results) {
            if (r.txHash) {
                pushed++;
            } else {
                failed++;
                failures.push({ agentId: r.agentId, name: r.name, error: r.error });
            }
        }

        if (i + BATCH_SIZE < services.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }

    const result = {
        success: true,
        pushed,
        failed,
        total: services.length,
        duration_ms: Date.now() - startTime,
        ...(failures.length > 0 && { failures: failures.slice(0, 10) }),
    };

    // Update tracking
    _lastPushResult = {
        timestamp: new Date().toISOString(),
        pushed,
        failed,
        total: services.length,
        error: null,
        feedbackWalletConfigured: true,
        duration_ms: result.duration_ms,
    };

    logger.info('ERC8004', `Force push: ${pushed} ok, ${failed} failed / ${services.length} total (${result.duration_ms}ms)`);
    return result;
}

// ---------------------------------------------------------------------------
// AUTO-REPAIR: restore erc8004_agent_id mapping from on-chain data
// Called once at startup if the mapping was lost (e.g. after re-seed)
// ---------------------------------------------------------------------------
async function repairAgentMapping(supabase) {
    if (!_publicClient) return;

    // Check if mapping is already present
    const { data: existing } = await supabase
        .from('services')
        .select('id')
        .not('erc8004_agent_id', 'is', null)
        .limit(1);

    if (existing && existing.length > 0) return; // mapping intact

    logger.info('ERC8004', 'Agent mapping lost — restoring from on-chain data...');

    const { IDENTITY_ABI: ABI } = require('../erc8004');
    let restored = 0;

    // Scan agentIds 1-200 (our agents are in 16-89 range)
    for (let agentId = 1; agentId <= 200; agentId++) {
        try {
            const uri = await _publicClient.readContract({
                address: IDENTITY_REGISTRY,
                abi: ABI,
                functionName: 'tokenURI',
                args: [BigInt(agentId)],
            });
            const match = uri.match(/\/api\/agents\/([a-f0-9-]+)\/metadata\.json/);
            if (!match) continue;

            const serviceId = match[1];
            const { error } = await supabase.from('services').update({
                erc8004_agent_id: agentId,
                erc8004_registered_at: new Date().toISOString(),
            }).eq('id', serviceId);

            if (!error) restored++;
        } catch {
            // Token doesn't exist — stop scanning
            if (agentId > 100) break; // well past our range
        }
    }

    if (restored > 0) {
        logger.info('ERC8004', `Restored ${restored} agent-service mappings from on-chain`);
    }
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
    initClients,
    registerAgent,
    pushTrustScoreFeedback,
    pushAllTrustScores,
    repairAgentMapping,
    getPushStatus,
    getFeedbackWalletInfo,
    forcePushAllScores,
};
