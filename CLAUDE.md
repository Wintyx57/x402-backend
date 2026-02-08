# x402 Bazaar - Contexte pour Claude

## Etat actuel du projet (08/02/2026 - session Security + Domain)

### Architecture

```
HACKATHON/
├── x402-bazaar/          # Backend (Express API)
│   ├── server.js         # Serveur principal - helmet, CORS strict, anti-replay, rate limiting
│   ├── dashboard.html    # Dashboard admin (stats, services, activity log)
│   ├── demo-agent.js     # Agent IA autonome (OpenAI GPT-4o-mini + Coinbase SDK)
│   ├── seed-services.js  # Script pour injecter 15 services proxy dans Supabase
│   ├── setup-activity.js # Script pour vérifier/créer la table activity
│   ├── create-wallet.js  # Utilitaire création wallet
│   ├── server-seed.json  # Seed du wallet serveur (NE PAS COMMIT)
│   ├── agent-seed.json   # Seed du wallet agent (NE PAS COMMIT)
│   ├── .env              # Variables prod (NE PAS LIRE)
│   ├── .env.example      # Template des env vars
│   └── package.json      # deps: express, cors, helmet, dotenv, express-rate-limit,
│                          #       @coinbase/coinbase-sdk, @supabase/supabase-js, openai
│
└── x402-frontend/        # Frontend (React + Vite)
    ├── index.html        # SEO: meta tags, Open Graph, Twitter Card, canonical x402bazaar.org
    ├── public/
    │   ├── robots.txt    # Allow all crawlers + sitemap link
    │   └── sitemap.xml   # 5 pages indexées
    ├── src/
    │   ├── main.jsx      # Entry point (WagmiProvider, QueryClient, BrowserRouter, LanguageProvider)
    │   ├── App.jsx       # Router (/, /services, /register, /developers, /integrate)
    │   ├── index.css     # Tailwind v4 + custom utilities (glass, glow, gradient, animations)
    │   ├── config.js     # API_URL + USDC ABI
    │   ├── wagmi.js      # Config wagmi (Base + Base Sepolia, injected + coinbaseWallet connectors)
    │   ├── i18n/
    │   │   ├── translations.js    # EN + FR (~110 strings par langue)
    │   │   └── LanguageContext.jsx # React Context + useTranslation() hook + localStorage persistence
    │   ├── hooks/
    │   │   └── useReveal.js       # IntersectionObserver pour animations scroll
    │   ├── components/
    │   │   ├── Navbar.jsx         # Sticky glass navbar + burger menu mobile + LanguageToggle
    │   │   ├── ConnectButton.jsx  # Wallet connect/disconnect + responsive (compact mobile)
    │   │   ├── ServiceCard.jsx    # Glass card avec glow hover + i18n
    │   │   ├── ScrollToTop.jsx    # Reset scroll on route change
    │   │   └── LanguageToggle.jsx # Toggle pill FR/EN
    │   └── pages/
    │       ├── Home.jsx           # Hero glow orbs, stats glass, how-it-works, top services
    │       ├── Services.jsx       # Grid services + search glass input + skeleton loading
    │       ├── Register.jsx       # Form glass + USDC payment flow + i18n
    │       ├── Developers.jsx     # Doc API glass + scroll reveal + i18n
    │       └── Integrate.jsx      # Guide intégration agent (JS + Python, payAndRequest, use cases)
    ├── vercel.json       # Config Vercel : framework vite, SPA rewrites, output dist
    ├── .env.example
    └── package.json      # deps: react, react-router-dom, wagmi, viem, @tanstack/react-query, tailwindcss
                          # engines: node >= 20

```

### Déploiements

| Service | URL | Statut |
|---------|-----|--------|
| **Site (domaine custom)** | https://x402bazaar.org | LIVE - domaine Namecheap + Vercel |
| Backend (Render) | https://x402-api.onrender.com | LIVE - mainnet Base |
| Frontend (Vercel) | https://x402-frontend-one.vercel.app | LIVE - redirige aussi vers x402bazaar.org |
| GitHub Backend | https://github.com/Wintyx57/x402-backend | A jour |
| GitHub Frontend | https://github.com/Wintyx57/x402-frontend | A jour |
| Dashboard | https://x402-api.onrender.com/dashboard | LIVE |

### Domaine x402bazaar.org

- **Registrar** : Namecheap
- **DNS** : A Record `@` → `76.76.21.21` + CNAME `www` → `cname.vercel-dns.com`
- **SSL** : Auto (Vercel Let's Encrypt)
- **SEO** : meta tags, Open Graph, Twitter Card, sitemap.xml, robots.txt, canonical URL

### Ce qui est FAIT et FONCTIONNE

1. **Backend production** (Render, mainnet Base) :
   - `/health` → 200 OK, `"network": "Base"`
   - Réseau configurable via `NETWORK` env var (testnet/mainnet)
   - USDC contract addresses correctes pour les 2 réseaux
   - CORS whitelist strict (x402bazaar.org, Vercel, localhost)
   - Vérification on-chain des paiements USDC sur Base mainnet
   - 17 services en base Supabase (15 seed + 1 test + 1 ancien)

2. **Sécurité (audit 08/02/2026)** :
   - Helmet : headers de sécurité (X-Content-Type, HSTS, X-Frame-Options)
   - CORS whitelist strict (plus de wildcard `*`)
   - Anti-replay : tx hashes persistés dans Supabase `used_transactions`
   - Validation tx hash format (regex 0x + 64 hex)
   - Sanitization recherche (escape `%_\` pour Postgres LIKE)
   - Validation robuste /register (types, longueurs, format URL/wallet, prix 0-1000)
   - Body limit 10kb
   - RPC timeout 10s sur tous les appels on-chain
   - Wallet masqué dans les logs (0xfb1c...2430)
   - Rate limiting : 3 tiers (general 100/15min, paid 30/min, register 10/hr)
   - .gitignore renforcé (agent-seed.json, *.seed.json)

3. **Test agent mainnet RÉUSSI** :
   - Agent autonome (GPT-4o-mini + Coinbase SDK) testé sur Base mainnet
   - 3 paiements USDC réels (0.15 USDC total)
   - Agent wallet : 0xA986... (seed dans agent-seed.json)
   - Wallet réception paiements : 0xfb1c478BD5567BdcD39782E0D6D23418bFda2430 (MetaMask)

4. **Frontend React — DÉPLOYÉ SUR VERCEL + DOMAINE CUSTOM** :
   - Glassmorphism design (glass cards, glow effects, gradient buttons, animated hero)
   - i18n FR/EN avec toggle dans la navbar (localStorage persistence)
   - Wallet connect via wagmi (MetaMask + Coinbase Wallet)
   - Détection réseau + switch vers Base
   - Pages : Home, Services, Register, Developers, Integrate
   - Burger menu mobile + responsive complet
   - SEO complet (meta, OG, Twitter, sitemap, robots.txt)
   - Domaine custom : x402bazaar.org

5. **Supabase** :
   - URL : https://kucrowtjsgusdxnjglug.supabase.co
   - Tables :
     - `services` : catalogue des services (RLS active)
     - `activity` : log d'activité persisté (paiements, recherches, erreurs)
     - `used_transactions` : anti-replay tx hashes
   - 17 services en base

6. **Dashboard** (https://x402-api.onrender.com/dashboard) :
   - Stats temps réel : services, paiements, revenus, balance USDC on-chain
   - Liste des services avec liens BaseScan
   - Activity log (depuis Supabase)

### Credentials (NE PAS AFFICHER)

- Coinbase API Key : dans .env sur Render
- Wallet réception (MetaMask) : `0xfb1c478BD5567BdcD39782E0D6D23418bFda2430`
- Réseau : Base mainnet (chainId 8453)
- Email git pour Vercel : `robin.fuchs57@hotmail.com`
- Vercel CLI installé globalement, compte `wintyx57` connecté
- Domaine : x402bazaar.org (Namecheap)

### Variables d'environnement

**Backend (Render)** :
```
PORT=3000
NETWORK=mainnet
WALLET_ADDRESS=0xfb1c478BD5567BdcD39782E0D6D23418bFda2430
WALLET_ID=81a05b08-e58e-432f-99e6-586baa8552c3
COINBASE_API_KEY=***
COINBASE_API_SECRET=***
SUPABASE_URL=https://kucrowtjsgusdxnjglug.supabase.co
SUPABASE_KEY=***
OPENAI_API_KEY=***
```

**Frontend (Vercel)** :
```
VITE_API_URL=https://x402-api.onrender.com
VITE_NETWORK=mainnet
```

### Wallets

| Wallet | Adresse | Usage |
|--------|---------|-------|
| MetaMask (réception) | 0xfb1c478BD5567BdcD39782E0D6D23418bFda2430 | WALLET_ADDRESS - reçoit tous les paiements |
| Server wallet | WALLET_ID 81a05b08 (addr 0x5E83...) | Coinbase SDK, 2.3 USDC, 0 ETH |
| Agent wallet | Seed dans agent-seed.json (addr 0xA986...) | Utilisé pour la démo agent mainnet |
| Server seed wallet | Seed dans server-seed.json (wallet df759258) | Wallet vide, non utilisé |

### Prochaines étapes possibles

1. Soumettre le sitemap sur Google Search Console pour indexation rapide
2. Créer une image OG (1200x630 PNG) pour le partage social (Canva ou og-image.vercel.app)
3. Tester le wallet connect + register flow en production
4. Ajouter un sous-domaine api.x402bazaar.org pour le backend (optionnel)
5. Monitorer les paiements via le dashboard

### Commandes

```bash
# Backend
cd x402-bazaar && node server.js          # Démarrer le backend local
cd x402-bazaar && node seed-services.js   # Re-seeder la base
cd x402-bazaar && node demo-agent.js      # Lancer l'agent démo
cd x402-bazaar && node setup-activity.js  # Vérifier la table activity

# Frontend
cd x402-frontend && npm run dev           # Dev server (localhost:5173)
cd x402-frontend && npm run build         # Build production

# Git (auto-deploy sur push)
cd x402-frontend && git push origin main  # Push → Vercel auto-deploy
cd x402-bazaar && git push origin main    # Push → Render auto-deploy
```

### Historique des commits récents

**Backend (x402-bazaar)** :
- `17286be` Add x402bazaar.org to CORS whitelist
- `cbac6c8` Security hardening: anti-replay, helmet, CORS whitelist, input validation
- `20ef904` Persist activity log and stats in Supabase
- `5856677` Fix dashboard BaseScan links for mainnet + agent mainnet support
- `ff4b71b` Add rate limiting, error monitoring, request logging and demo agent

**Frontend (x402-frontend)** :
- `f66be81` Update SEO URLs to x402bazaar.org domain
- `5c5e5ae` Add SEO: meta tags, Open Graph, sitemap, robots.txt
- `9227b16` Add /integrate page — agent integration guide with code examples
- `b07295e` Add mobile burger menu, responsive improvements, ScrollToTop
