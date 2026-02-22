// test-intelligence-paid.js — Test réel des 8 intelligence APIs avec paiement USDC
// Lance un wallet sur Base Sepolia, récupère du faucet, teste chaque endpoint

require('dotenv').config();
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3000';
const delay = (ms) => new Promise(r => setTimeout(r, ms));

Coinbase.configure({
    apiKeyName: process.env.COINBASE_API_KEY,
    privateKey: process.env.COINBASE_API_SECRET,
});

async function payAndCall(wallet, method, path, body = null) {
    const url = `${SERVER_URL}${path}`;
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    };

    // 1. Premier appel → 402
    const res1 = await fetch(url, opts);
    if (res1.status !== 402) {
        const text = await res1.text();
        throw new Error(`Expected 402, got ${res1.status}: ${text.slice(0, 200)}`);
    }

    const payment = await res1.json();
    const amount = payment.amount / 1e6; // microUSDC → USDC
    const recipient = payment.recipient;
    console.log(`   → Paiement ${amount} USDC vers ${recipient.slice(0, 14)}...`);

    // 2. Payer
    const transfer = await wallet.createTransfer({
        amount,
        assetId: Coinbase.assets.Usdc,
        destination: recipient,
    });
    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();
    console.log(`   → Tx: ${txHash.slice(0, 20)}...`);

    // 3. Rappel avec preuve
    const res2 = await fetch(url, {
        ...opts,
        headers: { ...opts.headers, 'X-Payment-TxHash': txHash },
    });

    const data = await res2.json();
    if (res2.status !== 200) throw new Error(`Expected 200, got ${res2.status}: ${JSON.stringify(data).slice(0, 200)}`);
    return data;
}

const TESTS = [
    {
        name: 'Contract Risk Analyzer',
        method: 'POST',
        path: '/api/contract-risk',
        body: { text: 'The user accepts unlimited liability for all damages. The company may share user data with third parties without consent. This agreement auto-renews annually and may be changed unilaterally.' },
        verify: (d) => d.overall_risk && d.clauses?.length > 0,
    },
    {
        name: 'Email CRM Parser',
        method: 'POST',
        path: '/api/email-parse',
        body: { email: 'Hi, my name is John Smith from Acme Corp. I am interested in purchasing your enterprise plan. Please contact me urgently at john@acme.com or +1-555-1234. Best regards, John' },
        verify: (d) => d.sender_name && d.company && d.intent,
    },
    {
        name: 'AI Code Review',
        method: 'POST',
        path: '/api/code-review',
        body: { code: 'function getUser(id) {\n  const query = "SELECT * FROM users WHERE id = " + id;\n  return db.execute(query);\n}', language: 'javascript' },
        verify: (d) => typeof d.quality_score === 'number' && d.issues?.length >= 0,
    },
    {
        name: 'Table Insights',
        method: 'POST',
        path: '/api/table-insights',
        body: { csv: 'month,revenue,customers\nJan,12000,150\nFeb,15000,180\nMar,9000,120\nApr,18000,220\nMay,21000,260' },
        verify: (d) => d.insights?.length > 0,
    },
    {
        name: 'Domain Intelligence Report',
        method: 'GET',
        path: '/api/domain-report?domain=stripe.com',
        verify: (d) => d.domain === 'stripe.com' && d.dns,
    },
    {
        name: 'SEO Audit',
        method: 'GET',
        path: '/api/seo-audit?url=https://example.com',
        verify: (d) => typeof d.score === 'number' && d.issues,
    },
    {
        name: 'Lead Scoring',
        method: 'GET',
        path: '/api/lead-score?domain=stripe.com',
        verify: (d) => typeof d.score === 'number' && d.signals?.length > 0,
    },
    {
        name: 'Crypto Intelligence',
        method: 'GET',
        path: '/api/crypto-intelligence?symbol=bitcoin',
        verify: (d) => d.symbol === 'BTC' && d.price_usd > 0,
    },
];

async function main() {
    console.log('=== Test Intelligence APIs — Paiements réels Base Sepolia ===\n');
    console.log(`Serveur : ${SERVER_URL}\n`);

    // Health check
    const health = await fetch(`${SERVER_URL}/health`).catch(() => null);
    if (!health || health.status !== 200) {
        console.error('❌ Serveur inaccessible. Lance le serveur avec: node server.js');
        process.exit(1);
    }
    console.log('✅ Serveur OK\n');

    // Création wallet + faucet
    console.log('[1] Création du wallet agent...');
    const wallet = await Wallet.create({ networkId: Coinbase.networks.BaseSepolia });
    const address = await wallet.getDefaultAddress();
    console.log(`    Adresse : ${address.toString()}`);

    console.log('[2] Faucet ETH...');
    const faucetEth = await wallet.faucet(Coinbase.assets.Eth);
    await faucetEth.wait({ timeoutSeconds: 60 });
    console.log('    ETH reçu');

    await delay(3000);

    console.log('[3] Faucet USDC...');
    let usdcOk = false;
    for (let i = 0; i < 3; i++) {
        try {
            const faucetUsdc = await wallet.faucet(Coinbase.assets.Usdc);
            await faucetUsdc.wait({ timeoutSeconds: 60 });
            usdcOk = true;
            break;
        } catch { await delay(3000); }
    }
    if (!usdcOk) { console.error('❌ Faucet USDC échoué'); process.exit(1); }
    console.log('    USDC reçu\n');

    // Tests
    const results = [];
    for (const test of TESTS) {
        process.stdout.write(`[TEST] ${test.name}...\n`);
        try {
            const data = await payAndCall(wallet, test.method, test.path, test.body);
            const ok = test.verify(data);
            if (!ok) throw new Error(`Verify failed: ${JSON.stringify(data).slice(0, 200)}`);
            console.log(`   ✅ OK — ${JSON.stringify(data).slice(0, 120)}\n`);
            results.push({ name: test.name, ok: true });
        } catch (err) {
            console.log(`   ❌ FAIL — ${err.message}\n`);
            results.push({ name: test.name, ok: false, error: err.message });
        }
        await delay(1000);
    }

    // Résumé
    console.log('=== Résumé ===');
    const passed = results.filter(r => r.ok).length;
    results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.error ? ` — ${r.error}` : ''}`));
    console.log(`\n${passed}/${results.length} tests passés`);
    process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
