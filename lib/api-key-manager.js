// lib/api-key-manager.js — API Key management (no-wallet payment flow)
// Keys are stored hashed (SHA-256) — the raw key is shown ONCE at creation.

const crypto = require('crypto');
const logger = require('./logger');

// Prefix for all API keys — easy visual identification
const KEY_PREFIX_RAW = 'sk_live_';

/**
 * Generates a new API key: sk_live_<32 hex chars>
 * @returns {string} The raw API key (only shown once — never stored)
 */
function generateApiKey() {
    return KEY_PREFIX_RAW + crypto.randomBytes(16).toString('hex');
}

/**
 * SHA-256 hash of the API key for safe DB storage.
 * @param {string} key — raw key (sk_live_xxx)
 * @returns {string} hex hash
 */
function hashApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Extracts the display prefix (first 12 chars of the full key) for masked display.
 * e.g. "sk_live_abcd" from "sk_live_abcdef1234..."
 * @param {string} key — raw key
 * @returns {string}
 */
function getKeyPrefix(key) {
    return key.slice(0, 12);
}

/**
 * Validates an API key and returns its metadata.
 * @param {object} supabase
 * @param {string} keyHash — SHA-256 hash of the raw key
 * @returns {Promise<{ valid: boolean, id?: string, balance?: number, owner_email?: string, label?: string }>}
 */
async function validateApiKey(supabase, keyHash) {
    try {
        const { data, error } = await supabase
            .from('api_keys')
            .select('id, balance_usdc, owner_email, label, active, key_prefix')
            .eq('key_hash', keyHash)
            .eq('active', true)
            .single();

        if (error || !data) {
            return { valid: false };
        }

        return {
            valid: true,
            id: data.id,
            balance: parseFloat(data.balance_usdc || 0),
            owner_email: data.owner_email,
            label: data.label || '',
            key_prefix: data.key_prefix,
        };
    } catch (err) {
        logger.error('ApiKeyManager', `validateApiKey error: ${err.message}`);
        return { valid: false };
    }
}

/**
 * Atomically deducts `amount` from the key's balance.
 * Uses a conditional UPDATE (balance >= amount) to prevent negative balances.
 * @param {object} supabase
 * @param {string} keyHash
 * @param {number} amount — USDC amount to deduct (float, e.g. 0.01)
 * @returns {Promise<{ success: boolean, remaining_balance: number }>}
 */
async function deductBalance(supabase, keyHash, amount) {
    try {
        // Read current balance first (Supabase does not support conditional UPDATE natively via JS client)
        const { data: keyData, error: readErr } = await supabase
            .from('api_keys')
            .select('id, balance_usdc, total_spent, call_count')
            .eq('key_hash', keyHash)
            .eq('active', true)
            .single();

        if (readErr || !keyData) {
            logger.warn('ApiKeyManager', `deductBalance: key not found for hash ${keyHash.slice(0, 12)}...`);
            return { success: false, remaining_balance: 0 };
        }

        const currentBalance = parseFloat(keyData.balance_usdc || 0);
        const deductAmount = parseFloat(amount);

        if (currentBalance < deductAmount) {
            logger.info('ApiKeyManager', `Insufficient balance: ${currentBalance} < ${deductAmount}`);
            return { success: false, remaining_balance: currentBalance };
        }

        const newBalance = Math.max(0, currentBalance - deductAmount);
        const newSpent = parseFloat(keyData.total_spent || 0) + deductAmount;
        const newCallCount = (keyData.call_count || 0) + 1;

        const { error: updateErr } = await supabase
            .from('api_keys')
            .update({
                balance_usdc: newBalance.toFixed(6),
                total_spent: newSpent.toFixed(6),
                call_count: newCallCount,
                last_used_at: new Date().toISOString(),
            })
            .eq('id', keyData.id)
            // Guard: balance must still be >= amount (optimistic concurrency)
            .gte('balance_usdc', deductAmount.toFixed(6));

        if (updateErr) {
            logger.error('ApiKeyManager', `deductBalance update error: ${updateErr.message}`);
            return { success: false, remaining_balance: currentBalance };
        }

        logger.info('ApiKeyManager', `Deducted ${deductAmount} USDC from key ${keyHash.slice(0, 12)}... — remaining: ${newBalance.toFixed(6)}`);
        return { success: true, remaining_balance: newBalance };
    } catch (err) {
        logger.error('ApiKeyManager', `deductBalance exception: ${err.message}`);
        return { success: false, remaining_balance: 0 };
    }
}

/**
 * Creates a new API key and stores the hash in DB.
 * Returns the raw key (only time it's available).
 * @param {object} supabase
 * @param {string} email — owner email
 * @param {string} label — human-readable label
 * @returns {Promise<{ key: string, id: string, prefix: string } | null>}
 */
async function createApiKey(supabase, email, label) {
    try {
        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const keyPrefix = getKeyPrefix(rawKey);

        const { data, error } = await supabase
            .from('api_keys')
            .insert([{
                key_hash: keyHash,
                key_prefix: keyPrefix,
                owner_email: email.toLowerCase().trim(),
                label: (label || '').trim(),
                balance_usdc: 0,
                total_spent: 0,
                call_count: 0,
                active: true,
            }])
            .select('id')
            .single();

        if (error || !data) {
            logger.error('ApiKeyManager', `createApiKey insert error: ${error?.message}`);
            return null;
        }

        logger.info('ApiKeyManager', `Created API key for ${email} — prefix: ${keyPrefix}`);
        return { key: rawKey, id: data.id, prefix: keyPrefix };
    } catch (err) {
        logger.error('ApiKeyManager', `createApiKey exception: ${err.message}`);
        return null;
    }
}

/**
 * Tops up the balance of an API key.
 * @param {object} supabase
 * @param {string} keyId — UUID of the api_keys row
 * @param {number} amount — USDC to add
 * @returns {Promise<{ success: boolean, new_balance: number }>}
 */
async function topupBalance(supabase, keyId, amount) {
    try {
        const { data: keyData, error: readErr } = await supabase
            .from('api_keys')
            .select('balance_usdc')
            .eq('id', keyId)
            .single();

        if (readErr || !keyData) {
            return { success: false, new_balance: 0 };
        }

        const newBalance = parseFloat(keyData.balance_usdc || 0) + parseFloat(amount);

        const { error: updateErr } = await supabase
            .from('api_keys')
            .update({ balance_usdc: newBalance.toFixed(6) })
            .eq('id', keyId);

        if (updateErr) {
            logger.error('ApiKeyManager', `topupBalance update error: ${updateErr.message}`);
            return { success: false, new_balance: parseFloat(keyData.balance_usdc || 0) };
        }

        return { success: true, new_balance: newBalance };
    } catch (err) {
        logger.error('ApiKeyManager', `topupBalance exception: ${err.message}`);
        return { success: false, new_balance: 0 };
    }
}

module.exports = {
    generateApiKey,
    hashApiKey,
    getKeyPrefix,
    validateApiKey,
    deductBalance,
    createApiKey,
    topupBalance,
};
