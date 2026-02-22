// test-intelligence-paid.mjs — Tests réels des 8 intelligence APIs avec paiement USDC
// Utilise le wallet du community agent (4.95 USDC sur Base mainnet)

import { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = '0xf7b12d3428a6271978ccb19234676fb2d8482cab5b695f2ca16ee01947506540';
const SERVER_URL = 'https://x402-api.onrender.com';
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });

const USDC_ABI = [
    { name: 'transfer', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
    { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
];

async function payAndCall(method, path, body = null) {
    const url = `${SERVER_URL}${path}`;
    const opts = { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) };

    // 1. Premier appel → 402
    const res1 = await fetch(url, opts);
    if (res1.status !== 402) {
        const text = await res1.text();
        throw new Error(`Expected 402, got ${res1.status}: ${text.slice(0, 150)}`);
    }
    const payment = await res1.json();
    const amountUsdc = payment.payment_details.amount;
    const recipient = payment.payment_details.recipient;
    console.log(`   → Paiement ${amountUsdc} USDC vers ${recipient.slice(0, 14)}...`);

    // 2. Envoyer USDC on-chain
    const amount = parseUnits(amountUsdc.toString(), 6);
    const txHash = await walletClient.writeContract({
        address: USDC_CONTRACT,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [recipient, amount],
    });
    console.log(`   → Tx: ${txHash.slice(0, 20)}...`);
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

    // 3. Rappel avec preuve
    const res2 = await fetch(url, { ...opts, headers: { ...opts.headers, 'X-Payment-TxHash': txHash } });
    const data = await res2.json();
    if (res2.status !== 200) throw new Error(`Expected 200, got ${res2.status}: ${JSON.stringify(data).slice(0, 150)}`);
    return data;
}

const TESTS = [
    {
        name: 'Contract Risk Analyzer',
        method: 'POST', path: '/api/contract-risk',
        body: { text: 'The user accepts unlimited liability. The company may share data with third parties. This agreement auto-renews and may be changed unilaterally without notice.' },
        verify: d => d.overall_risk && Array.isArray(d.clauses),
        show: d => `risk=${d.overall_risk} score=${d.risk_score} clauses=${d.clauses?.length}`,
    },
    {
        name: 'Email CRM Parser',
        method: 'POST', path: '/api/email-parse',
        body: { email: 'Hi, I am John Smith from Acme Corp. I would like to buy your enterprise plan. Please contact me urgently at john@acme.com.' },
        verify: d => d.intent && d.sentiment,
        show: d => `intent=${d.intent} company=${d.company} urgency=${d.urgency}`,
    },
    {
        name: 'AI Code Review',
        method: 'POST', path: '/api/code-review',
        body: { code: 'function getUser(id) {\n  return db.query("SELECT * FROM users WHERE id = " + id);\n}', language: 'javascript' },
        verify: d => typeof d.quality_score === 'number',
        show: d => `score=${d.quality_score} issues=${d.issues?.length} lang=${d.language}`,
    },
    {
        name: 'Table Insights',
        method: 'POST', path: '/api/table-insights',
        body: { csv: 'month,revenue\nJan,12000\nFeb,15000\nMar,9000\nApr,18000\nMay,21000' },
        verify: d => Array.isArray(d.insights) && d.insights.length > 0,
        show: d => `insights=${d.insights?.length} trends=${d.trends?.length}`,
    },
    {
        name: 'Domain Intelligence Report',
        method: 'GET', path: '/api/domain-report?domain=stripe.com',
        verify: d => d.domain && d.dns,
        show: d => `score=${d.trust_score} ssl=${d.ssl} tech=${d.tech?.slice(0,3).join(',')}`,
    },
    {
        name: 'SEO Audit',
        method: 'GET', path: '/api/seo-audit?url=https://x402bazaar.org',
        verify: d => typeof d.score === 'number',
        show: d => `score=${d.score} grade=${d.grade} issues=${d.issues?.length}`,
    },
    {
        name: 'Lead Scoring',
        method: 'GET', path: '/api/lead-score?domain=stripe.com',
        verify: d => typeof d.score === 'number' && d.signals,
        show: d => `score=${d.score} grade=${d.grade} signals=${d.signals?.length}`,
    },
    {
        name: 'Crypto Intelligence',
        method: 'GET', path: '/api/crypto-intelligence?symbol=bitcoin',
        verify: d => d.symbol === 'BTC' && d.price_usd > 0,
        show: d => `${d.symbol} $${d.price_usd?.toLocaleString()} mcap=${(d.market_cap_usd/1e9).toFixed(1)}B`,
    },
];

async function main() {
    console.log('=== Test Intelligence APIs — Paiements réels Base mainnet ===\n');
    console.log(`Wallet : ${account.address}`);

    const bal = await publicClient.readContract({ address: USDC_CONTRACT, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] });
    console.log(`Solde  : ${(Number(bal) / 1e6).toFixed(4)} USDC\n`);

    const results = [];
    for (const test of TESTS) {
        console.log(`[TEST] ${test.name}`);
        try {
            const data = await payAndCall(test.method, test.path, test.body);
            if (!test.verify(data)) throw new Error(`Verify failed: ${JSON.stringify(data).slice(0, 150)}`);
            console.log(`   ✅ ${test.show(data)}\n`);
            results.push({ name: test.name, ok: true });
        } catch (err) {
            console.log(`   ❌ ${err.message}\n`);
            results.push({ name: test.name, ok: false, error: err.message });
        }
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log('=== Résumé ===');
    const passed = results.filter(r => r.ok).length;
    results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.error ? ' — ' + r.error.slice(0, 80) : ''}`));
    const balAfter = await publicClient.readContract({ address: USDC_CONTRACT, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] });
    console.log(`\nSolde restant : ${(Number(balAfter) / 1e6).toFixed(4)} USDC`);
    console.log(`${passed}/${results.length} tests passés`);
    process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
