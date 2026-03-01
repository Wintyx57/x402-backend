// lib/service-verifier.js — Deep verification of x402 services (chain, USDC, headers)

const logger = require('./logger');

const VERIFY_TIMEOUT = 10000; // 10s

// Known chains — used to validate Payment-Required headers
const KNOWN_CHAINS = {
    'eip155:8453':       { label: 'Base',          mainnet: true,  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    'eip155:84532':      { label: 'Base Sepolia',  mainnet: false, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
    'eip155:2046399126': { label: 'SKALE Europa',  mainnet: true,  usdc: '0x5F795bb52dAc3085f578f4877D450e2929D2F13d' },
};

/**
 * Deep-verify an x402 service URL.
 *
 * Checks: reachability, 402 header, chain (mainnet vs testnet), USDC contract, /health endpoint.
 *
 * @param {string} url — The service URL to verify
 * @returns {Promise<object>} — Full verification report
 */
async function verifyService(url) {
    const report = {
        reachable: false,
        httpStatus: 0,
        latency: 0,
        x402: null,
        endpoints: { health: false },
        verdict: 'offline',
        details: '',
    };

    const start = Date.now();

    // --- Step 1: Hit the registered URL ---
    let response;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);
        response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'x402-bazaar-verifier/2.0' },
        });
        clearTimeout(timeoutId);
        report.latency = Date.now() - start;
        report.httpStatus = response.status;
        report.reachable = response.status >= 200 && response.status < 500;
    } catch (err) {
        report.latency = Date.now() - start;
        report.details = err.name === 'AbortError' ? 'Timeout (10s)' : err.message;
        report.verdict = 'offline';
        return report;
    }

    // --- Step 2: If 402, decode Payment-Required header ---
    if (response.status === 402) {
        const paymentHeader = response.headers.get('payment-required');
        if (paymentHeader) {
            report.x402 = decodePaymentHeader(paymentHeader);
        }
    }

    // --- Step 3: Also try POST to trigger 402 if GET didn't return one ---
    if (!report.x402 && response.status !== 402) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);
            const postRes = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'x402-bazaar-verifier/2.0',
                },
                body: JSON.stringify({ test: true }),
            });
            clearTimeout(timeoutId);
            if (postRes.status === 402) {
                const paymentHeader = postRes.headers.get('payment-required');
                if (paymentHeader) {
                    report.x402 = decodePaymentHeader(paymentHeader);
                }
            }
        } catch {
            // POST failed, that's OK — not all endpoints accept POST at root
        }
    }

    // --- Step 4: Check /health endpoint ---
    try {
        const baseUrl = new URL(url);
        const healthUrl = `${baseUrl.protocol}//${baseUrl.host}/health`;
        if (healthUrl !== url) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const healthRes = await fetch(healthUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'x402-bazaar-verifier/2.0' },
            });
            clearTimeout(timeoutId);
            report.endpoints.health = healthRes.status >= 200 && healthRes.status < 400;
        }
    } catch {
        // /health not available, that's OK
    }

    // --- Step 5: Determine verdict ---
    if (report.x402 && report.x402.valid) {
        if (report.x402.isMainnet && report.x402.isValidUsdc) {
            report.verdict = 'mainnet_verified';
            report.details = `x402 verified on ${report.x402.chainLabel}`;
        } else if (!report.x402.isMainnet) {
            report.verdict = 'testnet';
            report.details = `Service on ${report.x402.chainLabel} (testnet) — not usable by mainnet agents`;
        } else if (!report.x402.isValidUsdc) {
            report.verdict = 'wrong_chain';
            report.details = `Unknown USDC contract on ${report.x402.network}`;
        } else {
            report.verdict = 'wrong_chain';
            report.details = `Unrecognized chain: ${report.x402.network}`;
        }
    } else if (report.reachable) {
        if (response.status === 402) {
            report.verdict = 'no_x402';
            report.details = 'Returns 402 but Payment-Required header is missing or malformed';
        } else {
            report.verdict = 'reachable';
            report.details = `URL responds with HTTP ${report.httpStatus} (no x402 payment gate detected)`;
        }
    } else {
        report.verdict = 'offline';
        report.details = report.details || `HTTP ${report.httpStatus}`;
    }

    return report;
}

/**
 * Decode a base64-encoded Payment-Required header into structured x402 info.
 * @param {string} header — base64 string
 * @returns {object|null}
 */
function decodePaymentHeader(header) {
    try {
        const json = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
        const accepts = json.accepts && json.accepts[0];
        if (!accepts) return { valid: false };

        const network = accepts.network || '';
        const asset = accepts.asset || '';
        const amount = accepts.amount || '0';
        const payTo = accepts.payTo || '';

        // Match against known chains
        let chainInfo = KNOWN_CHAINS[network];
        let isSolana = false;

        if (!chainInfo && network.startsWith('solana:')) {
            chainInfo = { label: 'Solana', mainnet: true, usdc: null };
            isSolana = true;
        }

        const chainLabel = chainInfo ? chainInfo.label : 'Unknown';
        const isMainnet = chainInfo ? chainInfo.mainnet : false;
        const isValidUsdc = isSolana
            ? true // Solana USDC validation skipped (different format)
            : chainInfo ? asset.toLowerCase() === chainInfo.usdc.toLowerCase() : false;

        return {
            valid: true,
            version: json.x402Version || null,
            network,
            chainLabel,
            isMainnet,
            asset,
            isValidUsdc,
            amount,
            amountUsdc: parseInt(amount, 10) / 1e6,
            payTo,
        };
    } catch (err) {
        logger.warn('Verifier', `Failed to decode Payment-Required header: ${err.message}`);
        return { valid: false };
    }
}

module.exports = { verifyService, decodePaymentHeader, KNOWN_CHAINS };
