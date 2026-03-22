#!/usr/bin/env node
// scripts/test-ozark-live.js — Live test: EIP-3009 signing against Ozark (Polygon USDC)
// Uses the MCP runtime .env at C:/Users/robin/x402-bazaar/.env for AGENT_PRIVATE_KEY
require('dotenv').config({ path: 'C:/Users/robin/x402-bazaar/.env' });

const crypto = require('crypto');
const { createPublicClient, createWalletClient, http, formatUnits } = require('viem');
const { polygon } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { normalize402 } = require('../lib/protocolAdapter');
const { getChainConfig } = require('../lib/chains');

const OZARK_URL = 'https://seats-plymouth-patients-century.trycloudflare.com/data/macro-calendar';

const EIP3009_DOMAIN = {
    name: 'USD Coin', version: '2', chainId: 137,
    verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

const USDC_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
];

async function main() {
    console.log('=== Ozark Live Test (EIP-3009 x402 Standard) ===\n');

    const pk = process.env.AGENT_PRIVATE_KEY;
    if (!pk) { console.error('Missing AGENT_PRIVATE_KEY'); process.exit(1); }
    const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
    console.log(`Wallet: ${account.address}`);

    const polygonCfg = getChainConfig('polygon');
    const publicClient = createPublicClient({ chain: polygon, transport: http(polygonCfg.rpcUrl) });
    const walletClient = createWalletClient({ account, chain: polygon, transport: http(polygonCfg.rpcUrl) });

    // Check balance
    const balance = await publicClient.readContract({
        address: polygonCfg.usdcContract, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address],
    });
    console.log(`USDC (Polygon): ${formatUnits(balance, 6)}`);

    // Step 1: Fetch 402
    console.log('\n[Step 1] Fetch 402...');
    const res402 = await fetch(OZARK_URL);
    if (res402.status !== 402) { console.log(`Not 402: ${res402.status}`); process.exit(0); }

    const headers402 = Object.fromEntries(res402.headers.entries());
    const body402 = await res402.json();
    const normalized = normalize402(402, headers402, body402);
    console.log(`Format: ${normalized.format}, protocolType: ${normalized.protocolType}, amount: ${normalized.amount}, chain: ${normalized.chain}`);
    console.log(`Recipient: ${normalized.payTo || normalized.recipient}`);

    // Step 2: Sign EIP-3009 (off-chain, $0 gas)
    const amountRaw = normalized.maxAmountRequired
        ? BigInt(normalized.maxAmountRequired)
        : BigInt(Math.round(parseFloat(normalized.amount) * 1e6));
    const recipient = normalized.payTo || normalized.recipient;
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 300;
    const nonce = '0x' + crypto.randomBytes(32).toString('hex');

    console.log(`\n[Step 2] Signing EIP-3009: ${amountRaw} atomic USDC to ${recipient}...`);

    const types = {
        TransferWithAuthorization: [
            { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
        ],
    };
    const message = { from: account.address, to: recipient, value: amountRaw, validAfter: BigInt(validAfter), validBefore: BigInt(validBefore), nonce };

    const signature = await walletClient.signTypedData({
        domain: EIP3009_DOMAIN, types, primaryType: 'TransferWithAuthorization', message,
    });
    console.log(`Signature: ${signature.slice(0, 20)}...`);

    // Step 3: Build X-PAYMENT header (x402 v1 standard format)
    const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'polygon',
        payload: {
            signature,
            authorization: {
                from: account.address, to: recipient, value: amountRaw.toString(),
                validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce,
            },
        },
    };
    const xPayment = Buffer.from(JSON.stringify(payload)).toString('base64');
    console.log(`X-PAYMENT header: ${xPayment.slice(0, 40)}... (${xPayment.length} chars)`);

    // Step 4: Send request with X-PAYMENT
    console.log('\n[Step 3] Sending request with X-PAYMENT header...');
    const res = await fetch(OZARK_URL, {
        headers: { 'X-PAYMENT': xPayment, 'X-Agent-Wallet': account.address },
    });
    console.log(`HTTP ${res.status}`);

    if (res.status === 200) {
        const data = await res.text();
        console.log('\n=== SUCCESS! ===');
        try { console.log(JSON.stringify(JSON.parse(data), null, 2).slice(0, 3000)); }
        catch { console.log(data.slice(0, 3000)); }
        console.log('\n=== Test PASSED ===');
    } else {
        const text = await res.text();
        console.log(`Response: ${text.slice(0, 500)}`);
        if (res.status === 402) {
            console.log('\nStill 402 — provider may require POSTing to their facilitator.');
            console.log('Signature was off-chain only (no USDC spent). Safe to retry.');
        }
    }
}

main().catch(err => { console.error('Fatal:', err.message || err); process.exit(1); });
