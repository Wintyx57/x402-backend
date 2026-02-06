require('dotenv').config();
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');

const SERVER_URL = 'http://localhost:3000';

// --- Initialiser le SDK Coinbase ---
Coinbase.configure({
    apiKeyName: process.env.COINBASE_API_KEY,
    privateKey: process.env.COINBASE_API_SECRET,
});

// --- Helper : payer et ré-essayer ---
async function payAndRetry(wallet, requestFn, paymentDetails) {
    const amount = paymentDetails.amount;
    const recipient = paymentDetails.recipient;

    console.log(`    → Paiement de ${amount} USDC vers ${recipient.slice(0, 10)}...`);
    const transfer = await wallet.createTransfer({
        amount: amount,
        assetId: Coinbase.assets.Usdc,
        destination: recipient,
    });
    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();
    console.log(`    → Tx confirmée : ${txHash.slice(0, 20)}...`);

    // Ré-essayer avec la preuve de paiement
    return requestFn(txHash);
}

async function main() {
    console.log('=== x402 BAZAAR - Démo Marketplace Autonome ===\n');

    // -------------------------------------------------------
    // ÉTAPE 1 : Découvrir la marketplace
    // -------------------------------------------------------
    console.log('[1] Découverte de la marketplace...');
    const resHome = await fetch(SERVER_URL);
    const home = await resHome.json();
    console.log(`    → ${home.name} : ${home.total_services} services listés`);
    console.log(`    → Endpoints disponibles :`);
    Object.entries(home.endpoints).forEach(([k, v]) => console.log(`       ${k} → ${v}`));

    // -------------------------------------------------------
    // ÉTAPE 2 : Créer un wallet agent + faucet
    // -------------------------------------------------------
    console.log('\n[2] Création du wallet agent...');
    const agentWallet = await Wallet.create({ networkId: Coinbase.networks.BaseSepolia });
    const agentAddress = await agentWallet.getDefaultAddress();
    console.log(`    → Adresse : ${agentAddress.toString()}`);

    console.log('\n[3] Faucet ETH + USDC...');
    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    const faucetEth = await agentWallet.faucet(Coinbase.assets.Eth);
    await faucetEth.wait({ timeoutSeconds: 60 });
    console.log('    → ETH reçu');

    let usdcFunded = false;
    await delay(3000);
    try {
        const faucetUsdc1 = await agentWallet.faucet(Coinbase.assets.Usdc);
        await faucetUsdc1.wait({ timeoutSeconds: 60 });
        console.log('    → USDC reçu (1/2)');
        usdcFunded = true;

        await delay(3000);
        try {
            const faucetUsdc2 = await agentWallet.faucet(Coinbase.assets.Usdc);
            await faucetUsdc2.wait({ timeoutSeconds: 60 });
            console.log('    → USDC reçu (2/2)');
        } catch (e) {
            console.log('    → Faucet 2/2 rate-limité, on continue avec ce qu\'on a');
        }
    } catch (e) {
        console.log(`    → Faucet USDC rate-limité, auto-financement via wallet serveur...`);

        // Importer le wallet serveur et envoyer 1.15 USDC à l'agent
        const serverWallet = await Wallet.fetch(process.env.WALLET_ID);
        const agentAddr = (await agentWallet.getDefaultAddress()).getId();
        const fundTransfer = await serverWallet.createTransfer({
            amount: 1.15,
            assetId: Coinbase.assets.Usdc,
            destination: agentAddr,
        });
        const fundConfirmed = await fundTransfer.wait({ timeoutSeconds: 120 });
        console.log(`    → 1.15 USDC envoyés depuis le wallet serveur (tx: ${fundConfirmed.getTransactionHash().slice(0, 20)}...)`);
        usdcFunded = true;
    }

    const balance = await agentWallet.getBalance(Coinbase.assets.Usdc);
    console.log(`    → Balance : ${balance} USDC`);

    if (Number(balance) < 0.05) {
        console.log('\n❌ Pas assez de USDC pour continuer la démo.');
        console.log('   Vérifiez le solde du wallet serveur.');
        process.exit(0);
    }

    // -------------------------------------------------------
    // ÉTAPE 3 : ACHETEUR - Chercher un service (0.05 USDC)
    // -------------------------------------------------------
    console.log('\n[4] Recherche "weather" (sans paiement)...');
    const resSearch1 = await fetch(`${SERVER_URL}/search?q=weather`);
    const bodySearch1 = await resSearch1.json();

    if (resSearch1.status === 402) {
        console.log(`    → HTTP 402 : ${bodySearch1.payment_details.action} coûte ${bodySearch1.payment_details.amount} USDC`);

        console.log('\n[5] Paiement + nouvelle recherche...');
        const searchResult = await payAndRetry(
            agentWallet,
            async (txHash) => {
                const r = await fetch(`${SERVER_URL}/search?q=weather`, {
                    headers: { 'X-Payment-TxHash': txHash }
                });
                return r.json();
            },
            bodySearch1.payment_details
        );

        console.log(`    → ${searchResult.count || 0} résultat(s) trouvé(s)`);
        if (searchResult.data && searchResult.data.length > 0) {
            searchResult.data.forEach(s => console.log(`       - ${s.name} (${s.price_usdc} USDC)`));
        } else {
            console.log('       (table vide, normal au premier lancement)');
        }
    }

    // -------------------------------------------------------
    // ÉTAPE 4 : VENDEUR - Enregistrer un nouveau service (1 USDC)
    // -------------------------------------------------------
    const agentAddr = (await agentWallet.getDefaultAddress()).getId();
    const newService = {
        name: "PDF Summarizer AI",
        description: "Résumé automatique de documents PDF par IA",
        url: "https://pdf-ai.example.com/v1",
        price: 0.15,
        tags: ["pdf", "summarizer", "document", "ai"],
        ownerAddress: agentAddr
    };

    console.log(`\n[6] Enregistrement du service "${newService.name}" (sans paiement)...`);
    const resReg1 = await fetch(`${SERVER_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newService)
    });
    const bodyReg1 = await resReg1.json();

    if (resReg1.status === 402) {
        console.log(`    → HTTP 402 : ${bodyReg1.payment_details.action} coûte ${bodyReg1.payment_details.amount} USDC`);

        console.log('\n[7] Paiement + enregistrement...');
        const regResult = await payAndRetry(
            agentWallet,
            async (txHash) => {
                const r = await fetch(`${SERVER_URL}/register`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Payment-TxHash': txHash
                    },
                    body: JSON.stringify(newService)
                });
                return r.json();
            },
            bodyReg1.payment_details
        );

        console.log(`    → ${regResult.message}`);
        console.log(`    → ID attribué : ${regResult.data.id}`);
    }

    // -------------------------------------------------------
    // ÉTAPE 5 : Vérifier que le service est bien listé
    // -------------------------------------------------------
    console.log('\n[8] Recherche "pdf" pour vérifier l\'enregistrement...');
    const resSearch2 = await payAndRetry(
        agentWallet,
        async (txHash) => {
            const r = await fetch(`${SERVER_URL}/search?q=pdf`, {
                headers: { 'X-Payment-TxHash': txHash }
            });
            return r.json();
        },
        { amount: 0.05, recipient: process.env.WALLET_ADDRESS }
    );

    console.log(`    → ${resSearch2.count} résultat(s) pour "pdf" :`);
    resSearch2.data.forEach(s => console.log(`       - ${s.name} (${s.price_usdc} USDC) [ID ${s.id.slice(0, 8)}]`));

    // -------------------------------------------------------
    // Résumé
    // -------------------------------------------------------
    const finalBalance = await agentWallet.getBalance(Coinbase.assets.Usdc);
    console.log(`\n=== RÉSUMÉ ===`);
    console.log(`Dépenses : recherche x2 (0.10 USDC) + enregistrement x1 (1.00 USDC) = 1.10 USDC`);
    console.log(`Balance restante : ${finalBalance} USDC`);
    console.log(`=== FIN DE LA DÉMO ===`);
}

main().catch(err => {
    console.error('Erreur agent :', err.message);
    process.exit(1);
});
