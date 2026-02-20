// lib/payment.js — Payment verification + middleware

const logger = require('./logger');
const { CHAINS, DEFAULT_CHAIN_KEY, DEFAULT_CHAIN, getChainConfig, NETWORK } = require('./chains');

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const RPC_TIMEOUT = 10000; // 10s

function fetchWithTimeout(url, options, timeout = RPC_TIMEOUT) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), timeout))
    ]);
}

// --- Cache des paiements verifies (memoire + Supabase persiste) ---
class BoundedSet {
    constructor(maxSize = 10000) {
        this.maxSize = maxSize;
        this.set = new Set();
    }
    has(key) { return this.set.has(key); }
    add(key) {
        if (this.set.size >= this.maxSize) {
            const first = this.set.values().next().value;
            this.set.delete(first);
        }
        this.set.add(key);
    }
    get size() { return this.set.size; }
}

const verifiedPayments = new BoundedSet(10000);

function createPaymentSystem(supabase, logActivity, budgetManager) {
    async function isTxAlreadyUsed(...keys) {
        // Check memory cache first
        for (const key of keys) {
            if (verifiedPayments.has(key)) return true;
        }
        // Check Supabase (single query for all keys)
        const { data } = await supabase
            .from('used_transactions')
            .select('tx_hash')
            .in('tx_hash', keys)
            .limit(1);
        if (data && data.length > 0) {
            data.forEach(d => verifiedPayments.add(d.tx_hash));
            return true;
        }
        return false;
    }

    async function markTxUsed(txHash, action) {
        // SECURITY: Use INSERT (not upsert) to atomically claim the tx hash.
        // If another request already claimed it, INSERT fails with duplicate key → race detected.
        const { error } = await supabase
            .from('used_transactions')
            .insert([{ tx_hash: txHash, action }]);
        if (error) {
            if (error.code === '23505' || (error.message && error.message.includes('duplicate'))) {
                logger.warn('Anti-replay', `Race condition detected for tx ${txHash.slice(0, 18)}...`);
                return false; // Another request won the race
            }
            logger.error('Anti-replay', 'markTxUsed error:', error.message);
            return false; // Fail closed
        }
        verifiedPayments.add(txHash);
        return true;
    }

    async function verifyPayment(txHash, minAmount, chainKey = DEFAULT_CHAIN_KEY) {
        const chain = getChainConfig(chainKey);
        // Normalize tx hash
        const normalizedTxHash = txHash.toLowerCase().trim();
        if (normalizedTxHash.length !== 66) {
            throw new Error('Invalid transaction hash length');
        }

        const serverAddress = process.env.WALLET_ADDRESS.toLowerCase();

        // 1. Recuperer le recu de transaction
        const receiptRes = await fetchWithTimeout(chain.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', method: 'eth_getTransactionReceipt',
                params: [normalizedTxHash], id: 1
            })
        });
        const { result: receipt } = await receiptRes.json();

        if (!receipt || receipt.status !== '0x1') {
            logger.info('x402', `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: echouee ou introuvable`);
            return false;
        }

        // 2. Verifier les Transfer ERC20 (USDC) vers notre wallet
        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

        for (const log of receipt.logs) {
            if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
                // SECURITY: Verify the log is from the correct USDC contract
                if (log.address.toLowerCase() !== chain.usdcContract.toLowerCase()) {
                    continue; // Skip transfers from other tokens
                }
                if (!log.topics[1] || !log.topics[2]) continue; // Skip malformed logs
                const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
                const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
                if (toAddress === serverAddress) {
                    const amount = BigInt(log.data);
                    if (amount >= BigInt(minAmount)) {
                        logger.info('x402', `Paiement USDC verifie on ${chain.label}: ${Number(amount) / 1e6} USDC from ${fromAddress.slice(0, 10)}...`);
                        return { valid: true, from: fromAddress };
                    } else {
                        logger.info('x402', `Montant insuffisant on ${chain.label}: ${Number(amount) / 1e6} USDC (min: ${Number(minAmount) / 1e6})`);
                    }
                }
            }
        }

        logger.info('x402', `Tx ${normalizedTxHash.slice(0, 18)}... on ${chain.label}: paiement non reconnu ou insuffisant`);
        return false;
    }

    function paymentMiddleware(minAmountRaw, displayAmount, displayLabel) {
        return async (req, res, next) => {
            const txHash = req.headers['x-payment-txhash'];
            const chainKey = req.headers['x-payment-chain'] || DEFAULT_CHAIN_KEY;

            // Validate chain key
            if (!CHAINS[chainKey]) {
                return res.status(400).json({
                    error: 'Invalid chain',
                    message: `Unsupported chain: ${chainKey}. Accepted: ${Object.keys(CHAINS).join(', ')}`
                });
            }

            // Budget Guardian: pre-check if agent has a budget cap
            const agentWallet = req.headers['x-agent-wallet'];
            if (agentWallet && budgetManager) {
                const check = budgetManager.checkBudget(agentWallet, displayAmount);
                if (!check.allowed) {
                    return res.status(403).json({
                        error: 'Budget Exceeded',
                        message: check.reason,
                        budget: check.budget ? {
                            max_usdc: check.budget.maxUsdc,
                            spent_usdc: check.budget.spentUsdc,
                            remaining_usdc: check.budget.remainingUsdc,
                        } : null,
                    });
                }
            }

            if (!txHash) {
                logger.info('x402', `402 -> ${req.method} ${req.path} (${displayLabel})`);
                logActivity('402', `${displayLabel} - paiement demande`);

                // Build available networks list based on environment
                const availableNetworks = Object.entries(CHAINS)
                    .filter(([key]) => NETWORK === 'mainnet' ? key !== 'base-sepolia' : key === 'base-sepolia')
                    .map(([key, cfg]) => ({
                        network: key,
                        chainId: cfg.chainId,
                        label: cfg.label,
                        usdc_contract: cfg.usdcContract,
                        explorer: cfg.explorer,
                        gas: key === 'skale' ? 'FREE (sFUEL)' : '~$0.001',
                    }));

                return res.status(402).json({
                    error: "Payment Required",
                    message: `This action costs ${displayAmount} USDC. Send payment then provide the transaction hash in the X-Payment-TxHash header.`,
                    payment_details: {
                        amount: displayAmount,
                        currency: "USDC",
                        // Backward compat: default network fields
                        network: DEFAULT_CHAIN_KEY,
                        chainId: DEFAULT_CHAIN.chainId,
                        // Multi-chain: all accepted networks
                        networks: availableNetworks,
                        recipient: process.env.WALLET_ADDRESS,
                        accepted: ["USDC"],
                        action: displayLabel
                    }
                });
            }

            // Validate tx hash format
            if (!TX_HASH_REGEX.test(txHash)) {
                return res.status(400).json({ error: 'Invalid transaction hash format' });
            }

            // Anti-replay: check if tx already used (prefix with chain for disambiguation)
            const replayKey = `${chainKey}:${txHash}`;
            try {
                // Check both prefixed and unprefixed forms in a single query
                const alreadyUsed = await isTxAlreadyUsed(txHash, replayKey);
                if (alreadyUsed) {
                    logger.info('x402', `Replay blocked for tx ${txHash.slice(0, 10)}... on ${chainKey}`);
                    return res.status(402).json({
                        error: "Payment Required",
                        message: "This transaction has already been used. Please send a new payment."
                    });
                }
            } catch (err) {
                logger.error('x402', 'Anti-replay check error:', err.message);
                // SECURITY: Fail closed - reject request if anti-replay check fails
                return res.status(503).json({
                    error: 'Service temporarily unavailable',
                    message: 'Payment verification system error. Please retry.'
                });
            }

            // Verification on-chain (chain-specific RPC)
            try {
                const result = await verifyPayment(txHash, minAmountRaw, chainKey);
                if (result && result.valid) {
                    // SECURITY: Atomically claim the tx — if another request won the race, block
                    const claimed = await markTxUsed(replayKey, displayLabel);
                    if (!claimed) {
                        logger.info('x402', `Replay blocked (race) for tx ${txHash.slice(0, 10)}... on ${chainKey}`);
                        return res.status(402).json({
                            error: "Payment Required",
                            message: "This transaction has already been used. Please send a new payment."
                        });
                    }
                    const chainLabel = getChainConfig(chainKey).label;
                    logActivity('payment', `${displayLabel} - ${displayAmount} USDC verifie on ${chainLabel}`, displayAmount, txHash);

                    // Budget Guardian: record spending and set response headers
                    if (agentWallet && budgetManager) {
                        const result = budgetManager.recordSpending(agentWallet, displayAmount);
                        if (result) {
                            res.setHeader('X-Budget-Remaining', result.remaining.toFixed(4));
                            res.setHeader('X-Budget-Used-Percent', result.pct.toFixed(1));
                            if (result.alerts.length > 0) {
                                res.setHeader('X-Budget-Alert', `${result.alerts[0]}% of budget used`);
                            }
                        }
                    }

                    return next();
                }
            } catch (err) {
                logger.error('x402', `Erreur de verification on ${chainKey}:`, err.message);
            }

            return res.status(402).json({
                error: "Payment Required",
                message: "Invalid transaction or insufficient payment."
            });
        };
    }

    return { paymentMiddleware, verifyPayment, fetchWithTimeout };
}

module.exports = { createPaymentSystem, BoundedSet, TX_HASH_REGEX, fetchWithTimeout: function(url, options, timeout = RPC_TIMEOUT) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), timeout))
    ]);
}};
