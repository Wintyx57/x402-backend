# x402 Bazaar - Contexte pour Claude

## Etat actuel du projet (06/02/2026 - fin de session)

### Ce qui est FAIT et FONCTIONNE

1. **server.js** - Serveur Express complet avec :
   - Middleware de paiement parametrable (montant different par route)
   - Verification on-chain des tx USDC/ETH via RPC Base Sepolia
   - CRUD Supabase (plus de JSON local)
   - Activity log en memoire (50 derniers events)
   - Routes API dashboard : `/api/stats`, `/api/services`, `/api/activity`
   - Lecture du solde USDC on-chain du wallet serveur
   - Stockage du `tx_hash` dans Supabase a l'enregistrement
   - Route `/dashboard` qui sert le fichier HTML

2. **dashboard.html** - Dashboard web temps reel :
   - Design sombre, polling toutes les 3s
   - Stats cards (services, paiements, revenus)
   - Tableau des services avec liens BaseScan (owner + preuve tx)
   - Activity log avec liens BaseScan pour les paiements
   - Wallet cliquable dans le header + solde USDC on-chain
   - Zero dependance (HTML/CSS/JS vanilla)

3. **agent-client.js** - Script de demo :
   - 8 etapes : decouverte, wallet, faucet, recherche, enregistrement, verification
   - Helper `payAndRetry()` pour automatiser le flow 402 -> paiement -> retry
   - Inclut `ownerAddress` et `price` en numerique pour Supabase
   - 2 appels faucet USDC (besoin de 1.10 USDC total)

4. **Supabase** - Base PostgreSQL cloud :
   - URL : https://kucrowtjsgusdxnjglug.supabase.co
   - Table `services` avec colonnes : id, created_at, name, description, url, price_usdc, owner_address, tags (text[]), tx_hash
   - RLS active, policies lecture/insertion publiques

5. **.env** - 7 variables configurees :
   - PORT, WALLET_ADDRESS, WALLET_ID, COINBASE_API_KEY, COINBASE_API_SECRET, SUPABASE_URL, SUPABASE_KEY

### Ce qui BLOQUE

- **Faucet Coinbase USDC** : rate-limite depuis le 06/02 (trop de wallets crees pendant les tests). Le faucet ETH fonctionne, mais le faucet USDC refuse (`FaucetLimitReachedError`). Se reinitialise probablement sous 24h. Quand il revient, lancer `node agent-client.js` pour le test complet on-chain avec Supabase + dashboard.

### Tests deja valides

- **Phase 1** (JSON local) : flow complet on-chain valide (402 -> paiement USDC -> acces). Transactions reelles sur Base Sepolia. Solde wallet = 2.30 USDC.
- **Phase 2** (Supabase) : CRUD valide (insert, select, search ilike, tx_hash). Routes serveur OK.
- **Phase 3** (Dashboard) : toutes les routes API OK. Liens BaseScan OK. Solde on-chain lu correctement (2.30 USDC).
- **Manque** : test end-to-end `agent-client.js` avec Supabase + dashboard (bloque par le faucet).

### Fichiers du projet

```
x402-bazaar/
  .env                 # Variables d'environnement (NE PAS LIRE en entier)
  .gitignore
  server.js            # Serveur principal
  dashboard.html       # Dashboard web temps reel
  agent-client.js      # Script demo agent IA
  create-wallet.js     # Utilitaire creation wallet
  services.json        # Ancien stockage (obsolete, remplace par Supabase)
  package.json         # Dependencies: express, cors, dotenv, @coinbase/coinbase-sdk, @supabase/supabase-js
  RESUME.md            # Resume complet du projet (a jour)
  CLAUDE.md            # Ce fichier
```

### Prochaines etapes possibles

1. **Relancer `node agent-client.js`** quand le faucet revient - tester le flow complet avec dashboard live
2. **Deploy sur Render/Vercel** - mettre le serveur en ligne (ajouter les env vars dans le dashboard de l'hebergeur)
3. **Video de demo** pour le hackathon - montrer le dashboard + agent-client + BaseScan
4. **Ameliorations optionnelles** :
   - Recherche semantique avec pgvector (Supabase supporte)
   - Auto-tagging des services a partir de la description
   - Plus de services de demo pre-enregistres
   - Frontend public pour les humains (pas juste les agents)

### Wallet serveur

- Adresse : `0x5E83C116A603cD210B6A62e5Fe9D24529f92B5E1`
- Reseau : Base Sepolia
- Solde actuel : ~2.30 USDC (recus lors des tests Phase 1)

### Commandes rapides

```bash
node server.js           # Demarrer le serveur (puis ouvrir /dashboard)
node agent-client.js     # Lancer la demo complete
node create-wallet.js    # Creer un nouveau wallet
```
