# x402 Bazaar - Contexte pour Claude

## Etat actuel du projet (07/02/2026 - session Vercel Fix)

### Architecture

```
HACKATHON/
├── x402-bazaar/          # Backend (Express API)
│   ├── server.js         # Serveur principal - réseau configurable (testnet/mainnet via NETWORK env)
│   ├── dashboard.html    # Ancien dashboard vanilla (obsolète, remplacé par le frontend React)
│   ├── agent-client.js   # Script démo agent IA (modifié avec fallback auto-financement)
│   ├── seed-services.js  # Script pour injecter 15 services proxy dans Supabase
│   ├── create-wallet.js  # Utilitaire création wallet
│   ├── server-seed.json  # Seed du wallet de test (NE PAS COMMIT)
│   ├── .env              # Variables prod (NE PAS LIRE)
│   ├── .env.example      # Template des env vars
│   └── package.json      # deps: express, cors, dotenv, @coinbase/coinbase-sdk, @supabase/supabase-js
│
└── x402-frontend/        # Frontend (React + Vite)
    ├── src/
    │   ├── main.jsx      # Entry point (WagmiProvider, QueryClient, BrowserRouter, LanguageProvider)
    │   ├── App.jsx       # Router (/, /services, /register, /developers)
    │   ├── index.css     # Tailwind v4 + custom utilities (glass, glow, gradient, animations)
    │   ├── config.js     # API_URL + USDC ABI
    │   ├── wagmi.js      # Config wagmi (Base + Base Sepolia, injected + coinbaseWallet connectors)
    │   ├── i18n/
    │   │   ├── translations.js    # EN + FR (~70 strings par langue)
    │   │   └── LanguageContext.jsx # React Context + useTranslation() hook + localStorage persistence
    │   ├── hooks/
    │   │   └── useReveal.js       # IntersectionObserver pour animations scroll
    │   ├── components/
    │   │   ├── Navbar.jsx         # Sticky glass navbar + gradient line + LanguageToggle
    │   │   ├── ConnectButton.jsx  # Wallet connect/disconnect/switch chain + i18n
    │   │   ├── ServiceCard.jsx    # Glass card avec glow hover + i18n
    │   │   └── LanguageToggle.jsx # Toggle pill FR/EN
    │   └── pages/
    │       ├── Home.jsx           # Hero glow orbs, stats glass, how-it-works, top services
    │       ├── Services.jsx       # Grid services + search glass input + skeleton loading
    │       ├── Register.jsx       # Form glass + USDC payment flow + i18n
    │       └── Developers.jsx     # Doc API glass + scroll reveal + i18n
    ├── vercel.json       # Config Vercel : framework vite, SPA rewrites, output dist
    ├── .env.example
    └── package.json      # deps: react, react-router-dom, wagmi, viem, @tanstack/react-query, tailwindcss
                          # engines: node >= 20

```

### Déploiements

| Service | URL | Statut |
|---------|-----|--------|
| Backend (Render) | https://x402-api.onrender.com | LIVE - mainnet Base |
| Frontend (Vercel) | https://x402-frontend-one.vercel.app | LIVE - glassmorphism + i18n OK |
| GitHub Backend | https://github.com/Wintyx57/x402-backend | A jour |
| GitHub Frontend | https://github.com/Wintyx57/x402-frontend | A jour (commit 4d06441) |

### Ce qui est FAIT et FONCTIONNE

1. **Backend production** (Render, mainnet Base) :
   - `/health` → 200 OK, `"network": "Base"`
   - Réseau configurable via `NETWORK` env var (testnet/mainnet)
   - USDC contract addresses correctes pour les 2 réseaux
   - CORS configuré pour le frontend
   - Vérification on-chain des paiements USDC sur Base mainnet
   - 17 services en base Supabase (15 seed + 1 test + 1 ancien)

2. **Crash test mainnet RÉUSSI** :
   - 1 USDC réel payé et vérifié on-chain
   - Cold wallet : `0xfb1c478BD5567BdcD39782E0D6D23418bFda2430`
   - Balance wallet : 9.50 USDC
   - Transaction visible sur BaseScan

3. **Frontend React — DÉPLOYÉ SUR VERCEL** :
   - Glassmorphism design (glass cards, glow effects, gradient buttons, animated hero)
   - i18n FR/EN avec toggle dans la navbar (localStorage persistence)
   - Wallet connect via wagmi (MetaMask + Coinbase Wallet)
   - Détection réseau + switch vers Base
   - Pages : Home, Services, Register, Developers
   - Build Vite réussi (0 erreurs)
   - **Vercel : production live avec le bon design**

4. **Supabase** :
   - URL : https://kucrowtjsgusdxnjglug.supabase.co
   - Table `services` avec RLS active
   - 17 services en base

### Problème Vercel résolu (07/02/2026)

**Cause racine** : Vercel ne lançait pas le build Vite (0ms build time). Il copiait les fichiers source bruts comme du statique, donc les `@utility` Tailwind v4 n'étaient jamais compilés → pas de glassmorphism dans le CSS.

**Ce qui a été fait pour corriger** :
1. Ajouté `vercel.json` avec `"framework": "vite"`, SPA rewrites pour React Router, output `dist`
2. Ajouté `"engines": { "node": ">=20.0.0" }` dans package.json
3. Corrigé l'email git (était `robin.fuchs1997gmail.com` sans @, changé en `robin.fuchs57@hotmail.com` pour matcher le compte Vercel)
4. Build local via `vercel build --prod` puis deploy via `vercel deploy --prebuilt --prod`
5. Alias forcé via `vercel alias` vers `x402-frontend-one.vercel.app`

**IMPORTANT pour les futurs deploys** : L'intégration GitHub → Vercel auto-deploy ne semble pas fonctionner (les push ne triggent pas de build). Pour déployer :
```bash
cd x402-frontend
vercel build --prod
vercel deploy --prebuilt --prod --yes
```
Si l'alias ne bascule pas automatiquement :
```bash
vercel alias <url-du-deploy> x402-frontend-one.vercel.app
```

### Credentials (NE PAS AFFICHER)

- Coinbase API Key : dans .env sur Render
- Cold wallet : `0xfb1c478BD5567BdcD39782E0D6D23418bFda2430`
- Réseau : Base mainnet (chainId 8453)
- Email git pour Vercel : `robin.fuchs57@hotmail.com`
- Vercel CLI installé globalement (v50.13.2), compte `wintyx57` connecté

### Variables d'environnement

**Backend (Render)** :
```
PORT=3000
NETWORK=mainnet
WALLET_ADDRESS=0xfb1c478BD5567BdcD39782E0D6D23418bFda2430
COINBASE_API_KEY=***
COINBASE_API_SECRET=***
SUPABASE_URL=https://kucrowtjsgusdxnjglug.supabase.co
SUPABASE_KEY=***
```

**Frontend (Vercel)** :
```
VITE_API_URL=https://x402-api.onrender.com
VITE_NETWORK=mainnet
```

### Prochaines étapes

1. Tester le toggle FR/EN en production
2. Tester le wallet connect + register flow sur le nouveau design en prod
3. Éventuellement : menu mobile (burger), améliorations responsive, animations supplémentaires
4. Investiguer pourquoi l'auto-deploy GitHub → Vercel ne fonctionne pas (optionnel, le deploy CLI marche)

### Commandes

```bash
# Backend
cd x402-bazaar && node server.js          # Démarrer le backend local
cd x402-bazaar && node seed-services.js   # Re-seeder la base

# Frontend
cd x402-frontend && npm run dev           # Dev server (localhost:5173)
cd x402-frontend && npm run build         # Build production

# Deploy Frontend (Vercel CLI)
cd x402-frontend && vercel build --prod && vercel deploy --prebuilt --prod --yes
# Si alias ne bascule pas :
# vercel alias <url-deploy> x402-frontend-one.vercel.app

# Git
cd x402-frontend && git push origin main  # Push GitHub
cd x402-bazaar && git push origin main    # Push + trigger Render
```
