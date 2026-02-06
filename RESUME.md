# x402 Bazaar - Place de Marche Autonome de Services IA

## Concept

x402 Bazaar est une **place de marche autonome ou des agents IA s'achetent et se vendent des services entre eux**, sans intermediaire humain. Le protocole HTTP 402 (Payment Required) sert de mecanisme natif : quand un agent tente d'acceder a une ressource payante, le serveur repond 402 avec les details de paiement. L'agent paie en USDC on-chain sur Base Sepolia, puis renvoie sa preuve de transaction pour obtenir l'acces.

L'idee cle : **n'importe quel agent peut payer 1 USDC pour s'enregistrer comme vendeur**, et **n'importe quel agent peut payer 0.05 USDC pour chercher ou lister les services disponibles**. Cela cree une economie circulaire agent-to-agent entierement autonome.

**Chaque paiement est verifiable sur la blockchain** : le dashboard affiche des liens cliquables vers BaseScan pour que le jury puisse verifier en temps reel que rien n'est simule.

## Architecture actuelle

```
                         dashboard.html
                         (navigateur)
                              |
                         poll /api/* toutes les 3s
                              |
agent-client.js          server.js              Supabase (PostgreSQL)
(Agent IA)               (Marketplace)          (Cloud DB)
    |                        |                        |
    |-- GET /search -------->|                        |
    |<-- 402 + prix ---------|                        |
    |                        |                        |
    |-- paie USDC on-chain --|-> Base Sepolia         |
    |                        |                        |
    |-- GET /search -------->|                        |
    |   + X-Payment-TxHash   |-- verifie tx on-chain  |
    |                        |-- SELECT * FROM ------->|
    |<-- 200 + resultats ----|<-- data ----------------|
    |                        |                        |
    |                   activity log               tx_hash stocke
    |                   (temps reel)               (preuve on-chain)
```

### Fichiers du projet

| Fichier | Role |
|---------|------|
| `server.js` | Serveur Express. Middleware de paiement parametrable. Verification on-chain via RPC Base Sepolia. CRUD Supabase. Activity log en memoire. Routes API pour le dashboard. Lecture du solde USDC on-chain du wallet serveur. |
| `dashboard.html` | Dashboard web temps reel. Design sombre. Stats (services, paiements, revenus, solde wallet). Tableau des services avec liens BaseScan (owner + preuve tx). Activity log avec liens vers les transactions. Polling toutes les 3 secondes. Zero dependance. |
| `agent-client.js` | Script de demo simulant un agent IA autonome. Cycle complet : decouverte, recherche payante, enregistrement payant, verification. Utilise le Coinbase SDK pour creer un wallet, obtenir des fonds et payer. |
| `create-wallet.js` | Utilitaire standalone pour creer un wallet Base Sepolia via Coinbase SDK. |
| `.env` | Variables d'environnement : cles Coinbase, adresse wallet, cles Supabase. |

### Variables d'environnement (.env)

```
PORT=3000
WALLET_ADDRESS=<adresse du wallet du serveur>
WALLET_ID=<ID wallet Coinbase>
COINBASE_API_KEY=<cle API Coinbase>
COINBASE_API_SECRET=<secret API Coinbase>
SUPABASE_URL=<URL du projet Supabase>
SUPABASE_KEY=<cle anon publique Supabase>
```

## Base de donnees (Supabase / PostgreSQL)

Table `services` hebergee dans le cloud sur Supabase :

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (auto) | Identifiant unique genere automatiquement |
| `created_at` | timestamp | Date d'enregistrement |
| `name` | text | Nom du service (ex: "PDF Summarizer AI") |
| `description` | text | Description pour les agents (ex: "Resume automatique de PDF") |
| `url` | text | URL de l'API du service |
| `price_usdc` | numeric | Prix par appel en USDC (ex: 0.10) |
| `owner_address` | text | Adresse wallet du vendeur |
| `tags` | text[] | Tags pour la recherche (ex: {"pdf", "ai", "document"}) |
| `tx_hash` | text | Hash de la transaction de paiement (preuve on-chain) |

SQL complet :
```sql
CREATE TABLE services (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  name text NOT NULL,
  description text,
  url text NOT NULL,
  price_usdc numeric NOT NULL,
  owner_address text NOT NULL,
  tags text[],
  tx_hash text
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public services are viewable by everyone" ON services FOR SELECT USING (true);
CREATE POLICY "Anyone can insert a service" ON services FOR INSERT WITH CHECK (true);
```

## API - Endpoints

### Routes payantes (protocole x402)

| Route | Methode | Cout | Description |
|-------|---------|------|-------------|
| `/` | GET | Gratuit | Decouverte : nom, description, nombre de services, liste des endpoints |
| `/services` | GET | 0.05 USDC | Liste complete de tous les services enregistres |
| `/search?q=mot` | GET | 0.05 USDC | Recherche par mot-cle dans le nom et la description (ilike) |
| `/register` | POST | 1 USDC | Enregistrer un nouveau service (body JSON requis) |

### Routes dashboard (gratuites)

| Route | Methode | Description |
|-------|---------|-------------|
| `/dashboard` | GET | Page web du dashboard temps reel |
| `/api/stats` | GET | Stats : total services, paiements, revenus, solde USDC on-chain du wallet |
| `/api/services` | GET | Liste des services depuis Supabase (pour le dashboard) |
| `/api/activity` | GET | Activity log en memoire (50 derniers events) |

### Protocole de paiement x402

1. L'agent appelle un endpoint payant sans header de paiement
2. Le serveur repond **HTTP 402** avec :
   ```json
   {
     "error": "Payment Required",
     "payment_details": {
       "amount": 0.05,
       "currency": "USDC",
       "network": "base-sepolia",
       "recipient": "0x...",
       "action": "Rechercher un service"
     }
   }
   ```
3. L'agent lit le montant et l'adresse, effectue un transfert USDC on-chain
4. L'agent renvoie la meme requete avec le header `X-Payment-TxHash: 0x...`
5. Le serveur verifie la transaction on-chain (receipt + logs ERC20 Transfer)
6. Si valide : acces autorise. Le tx_hash est stocke en base et affiche dans le dashboard.

### Body attendu pour POST /register

```json
{
  "name": "PDF Summarizer AI",
  "description": "Resume automatique de documents PDF par IA",
  "url": "https://pdf-ai.example.com/v1",
  "price": 0.15,
  "tags": ["pdf", "summarizer", "document", "ai"],
  "ownerAddress": "0x..."
}
```

## Dashboard temps reel

Accessible sur `http://localhost:3000/dashboard`. Page HTML single-file, zero dependance, design sombre.

### Contenu du dashboard

- **Header** : Nom du projet, adresse wallet cliquable (lien BaseScan), solde USDC en temps reel, indicateur LIVE
- **Stats cards** : Nombre de services, paiements verifies, revenus totaux USDC
- **Tableau des services** : Nom, description, prix, tags, adresse owner (lien BaseScan), preuve de paiement (lien BaseScan vers la tx), date
- **Activity log** : Fil d'activite temps reel avec 4 types d'events :
  - **402** (orange) : paiement demande
  - **payment** (vert) : paiement verifie on-chain + lien BaseScan
  - **search** (bleu) : recherche effectuee
  - **register** (violet) : nouveau service enregistre
- **Endpoints** : Les 4 routes avec leurs couts

### Preuves pour le jury

Chaque element est verifiable :
- **Wallet serveur** : cliquable, ouvre BaseScan avec l'historique des transactions
- **Solde USDC** : lu en temps reel on-chain (pas un compteur local)
- **Preuve par service** : chaque service enregistre via paiement a un lien BaseScan vers la transaction
- **Paiements dans l'activity log** : chaque paiement verifie affiche un lien "Voir sur BaseScan"

## Verification on-chain (detail technique)

Le serveur verifie les paiements en 2 etapes via le RPC `https://sepolia.base.org` :

1. **ERC20 (USDC)** : Recupere le receipt de la transaction, parcourt les logs, cherche un event `Transfer` (topic `0xddf252ad...`) vers l'adresse du serveur avec un montant >= au minimum requis (50000 = 0.05 USDC en 6 decimales, 1000000 = 1 USDC).
2. **Fallback ETH natif** : Si aucun transfer ERC20 trouve, verifie si la transaction est un envoi d'ETH direct vers le serveur.

Le solde USDC du wallet serveur est lu on-chain via `eth_call` sur le contrat USDC Base Sepolia (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`), fonction `balanceOf`.

Le middleware est **parametrable** : chaque route definit son propre montant minimum.

## Flow de la demo (agent-client.js)

L'agent parcourt 8 etapes en autonomie :

1. **Decouverte** : `GET /` - Lit les endpoints et le nombre de services
2. **Creation wallet** : Cree un wallet Base Sepolia via Coinbase SDK
3. **Faucet** : Demande ETH (gas) + 2x USDC (fonds) au faucet testnet
4. **Recherche sans payer** : `GET /search?q=weather` -> recoit 402
5. **Paiement + recherche** : Paie 0.05 USDC, renvoie avec le hash -> resultats
6. **Enregistrement sans payer** : `POST /register` -> recoit 402
7. **Paiement + enregistrement** : Paie 1 USDC, renvoie avec le hash -> service cree en DB avec tx_hash
8. **Verification** : `GET /search?q=pdf` -> retrouve le service qu'il vient d'enregistrer

Pendant toute la demo, le dashboard se met a jour en temps reel et affiche les preuves BaseScan.

## Resultats des tests (06/02/2026)

### Phase 1 - Proof of concept (stockage JSON local)

Toutes les etapes validees avec paiements reels on-chain sur Base Sepolia :

| Test | Resultat |
|------|----------|
| `GET /` | OK |
| `GET /services` sans paiement | HTTP 402 |
| Paiement 0.05 USDC + acces `/services` | HTTP 200, 3 services |
| `GET /search?q=weather` | HTTP 402 -> paiement -> 1 resultat |
| `POST /register` "PDF Summarizer AI" | HTTP 402 -> paiement 1 USDC -> service cree |
| Recherche "pdf" apres enregistrement | OK - le nouveau service apparait |
| Bilan depenses agent | 1.10 USDC (2 recherches + 1 enregistrement) |

### Phase 2 - Migration Supabase (stockage cloud PostgreSQL)

| Test | Resultat |
|------|----------|
| Connexion serveur -> Supabase | OK |
| CRUD complet (insert, select, search ilike) | OK |
| Routes serveur (402, paiement, acces) | OK |
| Colonne tx_hash | OK - stockee et lue correctement |

### Phase 3 - Dashboard + preuves on-chain

| Test | Resultat |
|------|----------|
| `/dashboard` sert la page HTML | OK (HTTP 200) |
| `/api/stats` avec solde wallet on-chain | OK - 2.30 USDC (vrais paiements Phase 1) |
| `/api/services` depuis Supabase | OK |
| `/api/activity` avec events | OK - 11 events captures |
| Liens BaseScan dans le tableau services | OK - cliquables, ouvrent la bonne transaction |
| Liens BaseScan dans l'activity log | OK |
| Wallet cliquable dans le header | OK - ouvre BaseScan/address |
| Solde USDC lu on-chain | OK - 2.30 USDC |
| Polling toutes les 3s | OK |

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Serveur | Node.js + Express 5 |
| Base de donnees | Supabase (PostgreSQL cloud) |
| Dashboard | HTML/CSS/JS vanilla (zero build, zero dependance) |
| Blockchain | Base Sepolia (testnet L2 Coinbase) |
| Paiements | USDC (ERC20) + ETH natif |
| Wallet agent | Coinbase SDK (@coinbase/coinbase-sdk) |
| Protocole | HTTP 402 Payment Required (x402) |
| Preuves | Liens BaseScan (transactions verifiables par le jury) |

## Commandes

```bash
# Demarrer le serveur
node server.js

# Ouvrir le dashboard
# -> http://localhost:3000/dashboard

# Lancer la demo complete (serveur doit tourner)
node agent-client.js

# Creer un nouveau wallet
node create-wallet.js
```
