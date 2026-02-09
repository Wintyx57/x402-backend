# x402 Bazaar - Contexte pour Claude

## PLAN DE ROUTE — Phase 1 "Developer Obsession" (Mis a jour: 09/02/2026 - 22h)

### Vue d'ensemble

```
Phase 1: Developer Obsession (Mois 1-2)
├── [x] Milestone 1: CLI "One-Line Install" (npx x402-bazaar init)
│     ├── [x] 1.1 Structure du package CLI (x402-bazaar-cli/)
│     ├── [x] 1.2 Detection d'environnement (Claude Desktop, Cursor, VS Code, generic)
│     ├── [x] 1.3 Flow interactif (prompts wallet, network, budget)
│     ├── [x] 1.4 Generateur de config MCP (merge avec config existante)
│     ├── [x] 1.5 Verification de connexion (status command)
│     ├── [x] 1.6 Mode "wallet existant" vs "read-only"
│     ├── [x] 1.7 Tests Windows (status, help, version, init --help, npm pack)
│     ├── [x] 1.8 .gitignore, README.md, LICENSE, package.json pour npm
│     └── [x] 1.9 Publication npm — PUBLIE: x402-bazaar@1.0.0 sur npmjs.com (09/02/2026)
│
├── [x] Milestone 1b: Integration CLI sur le site web (x402bazaar.org)
│     ├── [x] 1b.1 Home: one-liner `npx x402-bazaar init` dans le hero (click to copy)
│     ├── [x] 1b.2 MCP: refonte Installation (Quick Install CLI + manual en accordion)
│     ├── [x] 1b.3 Integrate: Get Started restructure (CLI primary + manual fallback)
│     ├── [x] 1b.4 Developers: bandeau CLI quick start en haut de page
│     ├── [x] 1b.5 Traductions EN+FR pour toutes les nouvelles cles
│     └── [x] 1b.6 Push + deploy Vercel (commit bd67cc0, 09/02/2026)
│
├── [ ] Milestone 2: Config Generator (Web + CLI)
│     ├── [x] 2.1 CLI: commande `npx x402-bazaar config` (FAIT dans Milestone 1)
│     ├── [ ] 2.2 Web: page /config dans le frontend React
│     ├── [ ] 2.3 Formulaire interactif + preview JSON temps reel
│     ├── [ ] 2.4 Bouton copier + detection OS automatique
│     └── [ ] 2.5 Lien dans la navbar du site
│
├── [ ] Milestone 3: Wrappers API x402 (bootstrapper la marketplace)
│     ├── [x] 3.1 Template de base pour wrapper x402
│     ├── [ ] 3.2 Wrapper Brave Search (recherche web)
│     ├── [ ] 3.3 Wrapper Twitter/X (lecture + ecriture)
│     ├── [ ] 3.4 Enregistrer les wrappers sur la marketplace
│     └── [x] 3.5 Doc: "Comment creer votre propre wrapper"
│
├── [ ] Milestone 4: Refonte /docs et /mcp
│     ├── [ ] 4.1 Page /docs avec navigation laterale
│     ├── [ ] 4.2 Page /mcp avec instructions CLI
│     ├── [ ] 4.3 Code examples avec copier en 1 clic
│     ├── [ ] 4.4 Section Quickstart (5 min to first call)
│     └── [ ] 4.5 API Reference auto-generee
│
└── [ ] Milestone 5: Marketing
      ├── [ ] 5.1 Landing page "Carte de credit illimitee pour agents"
      ├── [ ] 5.2 Video demo (agent autonome)
      ├── [ ] 5.3 Thread Twitter/X de lancement
      ├── [ ] 5.4 Post Hacker News / Reddit
      └── [ ] 5.5 Article blog
```

### CLI x402-bazaar (Milestone 1 - COMPLET, PUBLIE sur npm)

**Localisation:** `HACKATHON/x402-bazaar-cli/`
**npm package size:** 13.4 KB (11 fichiers)

```
x402-bazaar-cli/
├── package.json            # name: "x402-bazaar", type: "module", engines: node>=18
├── bin/cli.js              # Point d'entree CLI + global error handler + help par defaut
├── src/
│   ├── commands/
│   │   ├── init.js         # npx x402-bazaar init (5 etapes: detect, install, wallet, config, verify)
│   │   ├── config.js       # npx x402-bazaar config (generateur interactif)
│   │   └── status.js       # npx x402-bazaar status (health + stats + marketplace info)
│   ├── detectors/
│   │   └── environment.js  # Detection: Claude Desktop, Cursor, VS Code+Continue, Claude Code
│   ├── generators/
│   │   ├── mcp-config.js   # Generateur JSON MCP (merge avec config existante)
│   │   └── env-file.js     # Generateur .env
│   └── utils/
│       └── logger.js       # Output colore (chalk) + banner + box
├── README.md               # Documentation npm avec Quick Start
├── LICENSE                  # MIT
└── .gitignore              # node_modules, .env, *.seed.json
```

**Commandes:**
- `npx x402-bazaar` — Affiche l'aide rapide
- `npx x402-bazaar init` — Setup complet (detect env, install MCP, config wallet, verify)
- `npx x402-bazaar init --no-wallet` — Setup en mode lecture seule
- `npx x402-bazaar init --env claude-desktop` — Forcer l'environnement
- `npx x402-bazaar config` — Generer la config MCP interactivement
- `npx x402-bazaar config --output mcp.json` — Sauvegarder dans un fichier
- `npx x402-bazaar status` — Verifier la connexion au serveur live

**Fonctionnalites:**
- Detection automatique de l'environnement AI (Claude Desktop, Cursor, Claude Code, VS Code)
- Installation du serveur MCP + npm install automatique
- Merge intelligent avec la config existante (ne casse pas les autres MCP servers)
- Fallback: genere le mcp-server.mjs complet si pas de source locale
- Check Node >= 18, global error handler, AbortSignal timeout sur les fetches
- Banner colore + spinners + output structure

**Tests effectues (Windows):**
- `node bin/cli.js` — Help par defaut OK
- `node bin/cli.js --help` — Commander help OK
- `node bin/cli.js --version` — 1.0.0 OK
- `node bin/cli.js status` — Connexion au serveur live OK (70 services, 9.35 USDC)
- `node bin/cli.js init --help` — Options OK
- `npm pack --dry-run` — 11 fichiers, 13.4 KB OK

**Publie sur npm:** x402-bazaar@1.0.0 (09/02/2026) — https://www.npmjs.com/package/x402-bazaar
**Compte npm:** wintyx

### Pour reprendre le travail

1. **Lire ce fichier** pour savoir ou on en est
2. **Regarder les [ ] non coches** dans le plan ci-dessus
3. **Commencer par le premier milestone non termine**
4. **Cocher [x] chaque tache terminee** dans ce fichier

---

## Etat actuel du projet (09/02/2026 - session CLI + Roadmap)

### Architecture

```
HACKATHON/
├── x402-bazaar/          # Backend (Express API)
│   ├── server.js         # Serveur principal - helmet, CORS strict, anti-replay, rate limiting
│   ├── mcp-server.mjs    # Serveur MCP pour Claude/Cursor (x402 payment flow)
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
├── x402-bazaar-cli/      # CLI "One-Line Install" (npx x402-bazaar init)
│   ├── bin/cli.js         # Point d'entree CLI
│   ├── src/commands/      # init, config, status
│   ├── src/detectors/     # Detection environnement (Claude, Cursor, VS Code)
│   ├── src/generators/    # Generateur config MCP + .env
│   └── package.json       # deps: chalk, commander, inquirer, ora
│
├── x402-fast-monetization-template/  # Template Python pour creer un wrapper x402 (FastAPI)
│   ├── main.py            # Serveur FastAPI avec decorateur @x402_paywall
│   ├── x402_middleware.py # Middleware x402 (verification paiements, 402 response)
│   ├── requirements.txt   # deps: fastapi, uvicorn, httpx, pydantic
│   └── .env.example       # WALLET_ADDRESS, NETWORK, etc.
│
├── ROADMAP.md            # Plan de route detaille Phase 1
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

### Prochaines etapes (voir PLAN DE ROUTE en haut de ce fichier)

**FAIT:**
- [x] Milestone 1: CLI publie sur npm (x402-bazaar@1.0.0)
- [x] Milestone 1b: CLI reference sur toutes les pages du site (Home, MCP, Integrate, Developers)

**Prochain (Milestone 2):**
1. Config Generator web — page /config sur x402bazaar.org
   - Formulaire interactif (choix IDE, wallet, budget, network)
   - Preview JSON temps reel
   - Bouton copier + detection OS
   - Lien dans la navbar

**Ensuite (Milestone 3):**
2. Premiers wrappers API x402 (Brave Search, Twitter/X)
   - Template de base pour wrapper x402
   - Enregistrer sur la marketplace
   - Doc: "Comment creer votre propre wrapper"

**Maintenance:**
3. Soumettre le sitemap sur Google Search Console
4. Creer une image OG pour le partage social

### Commandes

```bash
# CLI (One-Line Install)
cd x402-bazaar-cli && node bin/cli.js init     # Setup complet
cd x402-bazaar-cli && node bin/cli.js config   # Generer config MCP
cd x402-bazaar-cli && node bin/cli.js status   # Verifier connexion
cd x402-bazaar-cli && npm publish              # Publier sur npm

# Backend
cd x402-bazaar && node server.js          # Demarrer le backend local
cd x402-bazaar && node seed-services.js   # Re-seeder la base
cd x402-bazaar && node demo-agent.js      # Lancer l'agent demo
cd x402-bazaar && node setup-activity.js  # Verifier la table activity

# Frontend
cd x402-frontend && npm run dev           # Dev server (localhost:5173)
cd x402-frontend && npm run build         # Build production

# Git (auto-deploy sur push)
cd x402-frontend && git push origin main  # Push -> Vercel auto-deploy
cd x402-bazaar && git push origin main    # Push -> Render auto-deploy
```

### Historique des commits récents

**Backend (x402-bazaar)** :
- `17286be` Add x402bazaar.org to CORS whitelist
- `cbac6c8` Security hardening: anti-replay, helmet, CORS whitelist, input validation
- `20ef904` Persist activity log and stats in Supabase
- `5856677` Fix dashboard BaseScan links for mainnet + agent mainnet support
- `ff4b71b` Add rate limiting, error monitoring, request logging and demo agent

**Frontend (x402-frontend)** :
- `bd67cc0` Add npx x402-bazaar init CLI references across all pages
- `7b54fb3` Add 'Use with AI' button on service cards + find_tool_for_task in MCP docs
- `40ecd7c` Fix search bar: sync navbar with Services page via URL params
- `f66be81` Update SEO URLs to x402bazaar.org domain
- `5c5e5ae` Add SEO: meta tags, Open Graph, sitemap, robots.txt
- `9227b16` Add /integrate page — agent integration guide with code examples
- `b07295e` Add mobile burger menu, responsive improvements, ScrollToTop

**CLI (x402-bazaar-cli)** :
- Publie sur npm: x402-bazaar@1.0.0 (09/02/2026)
- https://www.npmjs.com/package/x402-bazaar
