#!/usr/bin/env node
// register-agent.js — One-time script to register x402 Bazaar on ERC-8004 (Base mainnet)
//
// Usage:  node register-agent.js
//
// Prerequisites:
//   - WALLET_ID, COINBASE_API_KEY, COINBASE_API_SECRET in .env
//   - The Coinbase SDK wallet must have ETH on Base for gas (~$0.01)
//
// After running, save the returned agentId as ERC8004_AGENT_ID in your .env.

require('dotenv').config();
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');
const { IDENTITY_REGISTRY, IDENTITY_ABI, verifyAgent } = require('./erc8004');

const AGENT_URI = 'https://x402-api.onrender.com/.well-known/agent-registration.json';

async function main() {
    console.log('\n--- ERC-8004 Agent Registration ---');
    console.log(`Registry : ${IDENTITY_REGISTRY}`);
    console.log(`Agent URI: ${AGENT_URI}\n`);

    // 1. Initialize Coinbase SDK
    if (!process.env.COINBASE_API_KEY || !process.env.COINBASE_API_SECRET) {
        console.error('ERROR: COINBASE_API_KEY and COINBASE_API_SECRET required in .env');
        process.exit(1);
    }

    const coinbase = new Coinbase({
        apiKeyName: process.env.COINBASE_API_KEY,
        privateKey: process.env.COINBASE_API_SECRET.replace(/\\n/g, '\n'),
    });

    // 2. Retrieve wallet
    if (!process.env.WALLET_ID) {
        console.error('ERROR: WALLET_ID required in .env');
        process.exit(1);
    }

    console.log(`Loading wallet ${process.env.WALLET_ID}...`);
    const wallet = await Wallet.fetch(process.env.WALLET_ID);
    await wallet.loadSeed();

    const address = await wallet.getDefaultAddress();
    console.log(`Wallet address: ${address}\n`);

    // 3. Call register(agentURI) on Identity Registry
    console.log('Sending register() transaction...');
    const invocation = await wallet.invokeContract({
        contractAddress: IDENTITY_REGISTRY,
        method: 'register',
        args: { agentURI: AGENT_URI },
        abi: IDENTITY_ABI,
    });

    console.log('Waiting for confirmation...');
    const result = await invocation.wait();
    const txHash = result.getTransactionHash();
    console.log(`\nTransaction confirmed: ${txHash}`);

    // 4. Parse agentId from transaction logs
    // The Registered event emits (uint256 indexed agentId, string agentURI, address indexed owner)
    const txLink = `https://basescan.org/tx/${txHash}`;
    console.log(`Explorer : ${txLink}`);

    // Try to extract agentId from the result
    console.log('\nCheck the transaction on BaseScan to find your agentId.');
    console.log('Then add to your .env:');
    console.log('  ERC8004_AGENT_ID=<your-agent-id>\n');

    // 5. Quick verification attempt — if agentId is in logs
    console.log('--- Registration complete ---\n');
}

main().catch((err) => {
    console.error('Registration failed:', err.message || err);
    process.exit(1);
});
