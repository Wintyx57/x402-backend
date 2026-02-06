require('dotenv').config();
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');

async function main() {
    Coinbase.configure({
        apiKeyName: process.env.COINBASE_API_KEY,
        privateKey: process.env.COINBASE_API_SECRET,
    });

    console.log("Création du wallet sur Base Sepolia...");
    const wallet = await Wallet.create({ networkId: Coinbase.networks.BaseSepolia });
    const address = await wallet.getDefaultAddress();

    console.log("\n=== WALLET CRÉÉ ===");
    console.log("Adresse:", address.toString());
    console.log("Wallet ID:", wallet.getId());
    console.log("\nCopie l'adresse ci-dessus dans ton .env comme WALLET_ADDRESS");
}

main().catch(err => {
    console.error("Erreur:", err.message);
});
