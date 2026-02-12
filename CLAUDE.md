# x402 Bazaar - Contexte pour Claude

## PLAN DE ROUTE — Phase 1 "Developer Obsession" (Mis a jour: 12/02/2026 — PHASE 1 COMPLETE)

### Vue d'ensemble

```
Phase 1: Developer Obsession (Mois 1-2) — COMPLETE
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
├── [x] Milestone 2: Config Generator (Web + CLI) — COMPLET 12/02/2026
│     ├── [x] 2.1 CLI: commande `npx x402-bazaar config` (FAIT dans Milestone 1)
│     ├── [x] 2.2 Web: page /config dans le frontend React
│     ├── [x] 2.3 Formulaire interactif + preview JSON temps reel
│     ├── [x] 2.4 Bouton copier + detection OS automatique
│     └── [x] 2.5 Lien dans la navbar du site
│
├── [x] Milestone 3: Wrappers API x402 (bootstrapper la marketplace)
│     ├── [x] 3.1 Template de base pour wrapper x402
│     ├── [x] 3.2 Wrapper Web Search (DuckDuckGo, /api/search)
│     ├── [x] 3.3 Wrapper Twitter/X (fxtwitter, /api/twitter)
│     ├── [x] 3.4 Enregistrer les wrappers sur la marketplace (seed-wrappers.js)
│     ├── [x] 3.5 Doc: "Comment creer votre propre wrapper"
│     ├── [x] 3.6 Wrapper Universal Scraper (/api/scrape)
│     ├── [x] 3.7 Wrappers Weather, Crypto, Joke (/api/weather, /api/crypto, /api/joke)
│     └── [x] 3.8 Badge "x402 Native" sur le frontend + compteur Live APIs
│
├── [x] Milestone 3b: Holy Trinity + Wrappers avances — COMPLET 12/02/2026
│     ├── [x] 3b.1 Twitter Search: /api/twitter?search=keyword (DuckDuckGo site:twitter.com)
│     ├── [x] 3b.2 Image Generation: /api/image?prompt=... via DALL-E 3 reel (0.05 USDC)
│     ├── [x] 3b.3 8 nouveaux wrappers: translate, summarize, code, dns, qrcode-gen, readability, sentiment, validate-email
│     ├── [x] 3b.4 Total: 29 endpoints natifs enregistres dans Supabase (seed-wrappers.js)
│     └── [x] 3b.5 Mettre a jour route GET / avec la liste complete
│
├── [x] Milestone 4: Refonte /docs — Page documentation centralisee — COMPLET 12/02/2026
│     ├── [x] 4.1 Page /docs avec navigation laterale (DocsSidebar sticky + scroll-spy)
│     ├── [x] 4.2 7 sections (Quickstart, Protocol, API Reference, Native Wrappers, MCP, Integration, Security)
│     ├── [x] 4.3 Code examples interactifs (CopyButton + CodeBlock)
│     ├── [x] 4.4 Section Quickstart (5 min to first call) avec badge vert
│     └── [x] 4.5 API Reference auto-fetchee depuis GET / (fallback statique)
│
├── [x] Milestone 4b: UX/UI & Trust Layer — COMPLET 12/02/2026
│     ├── [x] 4b.1 Badges enrichis: "x402 Native", "Last active: Xh ago" sur ServiceCard
│     ├── [x] 4b.2 Health check services: ping URLs, badge Online/Offline
│     ├── [x] 4b.3 Filtres avances: filtre chain (Base/SKALE), slider prix max
│     ├── [x] 4b.4 Dashboard admin: page /dashboard avec stats, balance, activity feed (backend only)
│     ├── [x] 4b.5 Galerie demos agents: page /demos (code + video embed)
│     └── [x] 4b.6 Page FAQ: section FAQ couvrant tx fail, listing, testnet, gas
│
├── [x] Milestone 5: Marketing "Carte de credit illimitee" — COMPLET 12/02/2026
│     ├── [x] 5.1 Landing page value proposition (4 cartes) + social proof sur Home.jsx
│     ├── [x] 5.2 Video demo script (3 min, 6 scenes) — x402-marketing/video-script.md
│     ├── [x] 5.3 Thread Twitter/X (12 tweets) — x402-marketing/twitter-thread.md
│     ├── [x] 5.4 Post Hacker News + Reddit — x402-marketing/hn-post.md + reddit-post.md
│     └── [x] 5.5 DoraHacks submission — x402-marketing/dorahacks-submission.md
│
└── [x] Milestone 6: Ecosysteme & Integrations — COMPLET 12/02/2026
      ├── [x] 6.1 Package LangChain: x402-langchain v0.1.0 sur GitHub (Wintyx57/x402-langchain)
      ├── [x] 6.2 Guide LangChain dans Integrate.jsx (CodeBlock + badge pip + lien GitHub)
      ├── [x] 6.3 Section securite visible sur About.jsx (6 features securite)
      ├── [x] 6.4 Backend refactoring en modules (routes/, lib/)
      ├── [x] 6.5 SEO complet (sitemap.xml, robots.txt, useSEO hook, JSON-LD, Google Search Console)
      ├── [x] 6.6 37 tests e2e (node:test, zero deps)
      └── [ ] 6.7 (Optionnel) Auto-GPT plugin — non prioritaire
```

### CLI x402-bazaar (Milestone 1 - COMPLET, PUBLIE sur npm)

**Localisation:** `HACKATHON/x402-bazaar-cli/`
**npm package size:** 13.4 KB (11 fichiers)
**Version actuelle:** x402-bazaar@2.0.0

```
x402-bazaar-cli/
├── package.json            # name: "x402-bazaar", type: "module", engines: node>=18
├── bin/cli.js              # Point d'entree CLI + global error handler + help par defaut
├── src/
│   ├── commands/
│   │   ├── init.js         # npx x402-bazaar init (5 etapes: detect, install, wallet, config, verify)
│   │   ├── config.js       # npx x402-bazaar config (generateur interactif)
│   │   ├── status.js       # npx x402-bazaar status (health + stats + marketplace info)
│   │   ├── list.js         # npx x402-bazaar list [--chain] [--category] [--free]
│   │   ├── search.js       # npx x402-bazaar search <query>
│   │   ├── call.js         # npx x402-bazaar call <endpoint> [--param key=value]
│   │   └── wallet.js       # npx x402-bazaar wallet [--address]
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

**Commandes (7 principales):**
- `npx x402-bazaar` — Affiche l'aide rapide
- `npx x402-bazaar init` — Setup complet (detect env, install MCP, config wallet, verify)
- `npx x402-bazaar init --no-wallet` — Setup en mode lecture seule
- `npx x402-bazaar init --env claude-desktop` — Forcer l'environnement
- `npx x402-bazaar config` — Generer la config MCP interactivement
- `npx x402-bazaar config --output mcp.json` — Sauvegarder dans un fichier
- `npx x402-bazaar status` — Verifier la connexion au serveur live
- `npx x402-bazaar list [--chain base|skale] [--category ai] [--free]` — Lister les services
- `npx x402-bazaar search <query>` — Chercher un service par nom/description
- `npx x402-bazaar call <endpoint> [--param key=value]` — Appeler un service directement
- `npx x402-bazaar wallet [--address 0x...]` — Afficher/gerer la wallet agent

**Publie sur npm:** x402-bazaar@2.0.0 (12/02/2026) — https://www.npmjs.com/package/x402-bazaar
**Compte npm:** wintyx

---

## Etat actuel du projet (12/02/2026 — Phase 1 COMPLETE)

### Architecture

```
HACKATHON/
├── x402-bazaar/          # Backend (Express API)
│   ├── server.js         # Serveur principal - helmet, CORS strict, anti-replay, rate limiting
│   │                      # 29 endpoints natifs (x402-native)
│   │                      # routes/, lib/ modules (health, services, register, dashboard, wrappers, logger, chains, activity, payment)
│   ├── routes/           # Modularisation routes
│   │   ├── health.js     # GET /health
│   │   ├── services.js   # GET /api/services, GET /api/services/:id, POST /api/services/activity
│   │   ├── register.js   # POST /api/register, POST /api/image, POST /api/search, etc.
│   │   ├── dashboard.js  # GET /dashboard (admin), GET /api/analytics (enrichi)
│   │   └── wrappers.js   # GET /api/[wrapper]
│   ├── lib/              # Logique metier
│   │   ├── logger.js     # Winston logger
│   │   ├── chains.js     # Config networks (Base, SKALE)
│   │   ├── activity.js   # Activity tracking
│   │   └── payment.js    # Payment verification
│   ├── mcp-server.mjs    # Serveur MCP pour Claude/Cursor (x402 payment flow, call_api auto-payment)
│   ├── dashboard.html    # Dashboard admin redesigne (wallet balance hero, 5 stats, activity feed, glassmorphism)
│   ├── demo-agent.js     # Agent IA autonome (OpenAI GPT-4o-mini + Coinbase SDK)
│   ├── seed-services.js  # Script pour injecter 15 services proxy dans Supabase
│   ├── seed-wrappers.js  # Script pour injecter les 29 wrappers natifs dans Supabase
│   ├── setup-activity.js # Script pour verifier/creer la table activity
│   ├── create-wallet.js  # Utilitaire creation wallet
│   ├── API_WRAPPERS.md   # Documentation des 29 endpoints wrapper
│   ├── .env              # Variables prod (NE PAS LIRE)
│   ├── .env.example      # Template des env vars
│   ├── tests/
│   │   └── e2e.test.js   # 37 tests e2e (node:test, zero deps)
│   └── package.json      # deps: express, cors, helmet, dotenv, express-rate-limit,
│                          #       @coinbase/coinbase-sdk, @supabase/supabase-js, openai,
│                          #       cheerio, turndown, zod
│
├── x402-bazaar-cli/      # CLI "One-Line Install" (npx x402-bazaar init) — npm x402-bazaar@2.0.0
│   ├── bin/cli.js         # Point d'entree CLI
│   ├── src/commands/      # init, config, status, list, search, call, wallet
│   ├── src/detectors/     # Detection environnement (Claude, Cursor, VS Code)
│   ├── src/generators/    # Generateur config MCP + .env
│   └── package.json       # deps: chalk, commander, inquirer, ora
│
├── x402-langchain/       # Package Python LangChain (GitHub: Wintyx57/x402-langchain)
│   ├── x402_langchain/    # X402BazaarTool, X402Client, X402PaymentHandler
│   └── setup.py           # v0.1.0
│
├── x402-fast-monetization-template/  # Template Python pour creer un wrapper x402 (FastAPI)
│   ├── main.py            # Serveur FastAPI avec decorateur @x402_paywall
│   ├── x402_middleware.py # Middleware x402 (verification paiements, 402 response)
│   └── requirements.txt   # deps: fastapi, uvicorn, httpx, pydantic
│
├── x402-marketing/       # Contenu marketing (5 fichiers)
│   ├── twitter-thread.md  # 12 tweets de lancement
│   ├── hn-post.md         # Post Hacker News
│   ├── reddit-post.md     # Post Reddit
│   ├── dorahacks-submission.md  # Submission hackathon
│   └── video-script.md    # Script video 3 min (6 scenes)
│
├── ROADMAP.md            # Plan de route detaille Phase 1 (COMPLETE)
│
└── x402-frontend/        # Frontend (React + Vite + Tailwind v4)
    ├── index.html        # SEO: meta tags, Open Graph, Twitter Card, canonical x402bazaar.org, JSON-LD
    ├── public/
    │   ├── robots.txt    # Allow all crawlers + sitemap link (enrichi)
    │   ├── sitemap.xml   # Pages indexees (complet)
    │   └── og-image.png  # Image OG pour partage social
    ├── src/
    │   ├── main.jsx      # Entry point (WagmiProvider, QueryClient, BrowserRouter, LanguageProvider)
    │   ├── App.jsx       # Router (13 routes)
    │   ├── index.css     # Tailwind v4 + custom utilities (glass, glow, gradient, animations)
    │   ├── config.js     # API_URL + USDC ABI
    │   ├── wagmi.js      # Config wagmi (Base + Base Sepolia, injected + coinbaseWallet connectors)
    │   ├── i18n/
    │   │   ├── translations.js    # EN + FR (137 clés i18n pour blog complet)
    │   │   └── LanguageContext.jsx # React Context + useTranslation() hook + localStorage persistence
    │   ├── hooks/
    │   │   ├── useSEO.js          # SEO meta tags + JSON-LD pour chaque page
    │   │   └── useReveal.js       # IntersectionObserver pour animations scroll
    │   ├── components/
    │   │   ├── Navbar.jsx         # Sticky glass navbar + burger menu mobile + LanguageToggle
    │   │   ├── ConnectButton.jsx  # Wallet connect/disconnect + responsive (compact mobile)
    │   │   ├── ServiceCard.jsx    # Glass card avec glow hover + badges enrichis + i18n
    │   │   ├── DocsSidebar.jsx    # Sidebar sticky /docs avec scroll-spy
    │   │   ├── CategoryIcon.jsx   # Icones par categorie de service
    │   │   ├── ScrollToTop.jsx    # Reset scroll on route change
    │   │   └── LanguageToggle.jsx # Toggle pill FR/EN
    │   └── pages/
    │       ├── Home.jsx           # Hero glow orbs, CountUp stats, value prop (4 cards), social proof, top services
    │       ├── Services.jsx       # Grid services + search + filtres avances (chain, prix)
    │       ├── Register.jsx       # Form glass + USDC payment flow + spinner + i18n
    │       ├── Developers.jsx     # Doc API glass + scroll reveal + i18n
    │       ├── Integrate.jsx      # Guide integration agent (JS + Python + LangChain)
    │       ├── MCP.jsx            # Guide MCP (CLI quick install + manual)
    │       ├── Docs.jsx           # Documentation centralisee (7 sections, sidebar, API reference)
    │       ├── Config.jsx         # Config Generator (formulaire + preview JSON + copier)
    │       ├── About.jsx          # A propos + section securite (6 features)
    │       ├── Pricing.jsx        # Page tarifs
    │       ├── Blog.jsx           # Blog / actualites (100% bilingue FR/EN)
    │       ├── FAQ.jsx            # FAQ (tx fail, listing, testnet, gas)
    │       └── Demos.jsx          # Galerie demos agents (code + video)
    ├── vercel.json       # Config Vercel : framework vite, SPA rewrites, output dist, cache headers, CSP
    ├── .env.example
    └── package.json      # deps: react, react-router-dom, wagmi, viem, @tanstack/react-query, tailwindcss
                          # engines: node >= 20
```

### Deploiements

| Service | URL | Statut |
|---------|-----|--------|
| **Site (domaine custom)** | https://x402bazaar.org | LIVE - domaine Namecheap + Vercel |
| Backend (Render) | https://x402-api.onrender.com | LIVE - mainnet Base |
| Frontend (Vercel) | https://x402-frontend-one.vercel.app | LIVE - redirige aussi vers x402bazaar.org |
| GitHub Backend | https://github.com/Wintyx57/x402-backend | A jour |
| GitHub Frontend | https://github.com/Wintyx57/x402-frontend | A jour |
| GitHub LangChain | https://github.com/Wintyx57/x402-langchain | A jour |
| Dashboard | https://x402-api.onrender.com/dashboard | LIVE (protected ADMIN_TOKEN) |
| npm CLI | https://www.npmjs.com/package/x402-bazaar | v2.0.0 |

### Domaine x402bazaar.org

- **Registrar** : Namecheap
- **DNS** : A Record `@` → `76.76.21.21` + CNAME `www` → `cname.vercel-dns.com`
- **SSL** : Auto (Vercel Let's Encrypt)
- **SEO** : meta tags, Open Graph, Twitter Card, sitemap.xml, robots.txt, canonical URL, og-image.png, JSON-LD (Organization, WebSite, WebApplication, FAQPage, BreadcrumbList)
- **Google Search Console** : Vérifié et actif

### Ce qui est FAIT et FONCTIONNE

1. **Backend production** (Render, mainnet Base) :
   - `/health` → 200 OK, `"network": "Base"`
   - 29 endpoints natifs x402 (21 existants + 8 nouveaux) : search, scrape, twitter, weather, crypto, joke, image, twitter-search, translate, summarize, code, dns, qrcode-gen, readability, sentiment, validate-email, +14 autres
   - Health-check endpoint pour monitoring des services
   - Analytics endpoint enrichi (walletBalance, recentActivity, avgPrice, activeServicesCount)
   - Dashboard admin `/dashboard` avec wallet balance hero, 5 stat cards, activity feed, glassmorphism
   - CORS whitelist strict (x402bazaar.org, Vercel, localhost)
   - Verification on-chain des paiements USDC sur Base mainnet
   - 70+ services en base Supabase
   - Backend refactoring en modules (routes/, lib/)
   - 37 tests e2e (node:test, zero deps)

2. **Securite (audit 12/02/2026)** :
   - Helmet : headers de securite (X-Content-Type, HSTS, X-Frame-Options)
   - CSP header renforce + verification
   - CORS whitelist strict (plus de wildcard `*`)
   - Anti-replay : tx hashes persistes dans Supabase `used_transactions`
   - Validation tx hash format (regex 0x + 64 hex)
   - Sanitization recherche (escape `%_\` pour Postgres LIKE)
   - Validation robuste /register (types, longueurs, format URL/wallet, prix 0-1000)
   - Body limit 10kb
   - RPC timeout 10s sur tous les appels on-chain
   - Rate limiting : 3 tiers (general 100/15min, paid 30/min, register 10/hr)
   - Dashboard protege par ADMIN_TOKEN (X-Admin-Token header)

3. **Frontend React — 13 pages deployees** :
   - Glassmorphism design (glass cards, glow effects, gradient buttons, animated hero)
   - CountUp animations sur les stats
   - Compatible With section (5 logos)
   - How it works 3-step section
   - CTA glow effect
   - i18n FR/EN avec toggle (137 clés pour blog bilingue)
   - useSEO hook pour meta tags dynamiques
   - Wallet connect via wagmi (MetaMask + Coinbase Wallet)
   - 13 routes : /, /services, /register, /integrate, /developers, /mcp, /docs, /config, /about, /pricing, /blog, /faq, /demos (Analytics supprime du frontend public)
   - Documentation centralisee /docs (7 sections, sidebar sticky, scroll-spy, API reference auto-fetch)
   - Config Generator /config (formulaire + preview JSON + copier)
   - Filtres avances (chain, prix), badges enrichis, health check
   - FAQ, Demos, About avec section securite
   - Blog 100% bilingue FR/EN
   - SEO complet (sitemap.xml, robots.txt, JSON-LD)
   - Google Search Console intégré

4. **CLI** (npm x402-bazaar@2.0.0) :
   - `npx x402-bazaar init` — setup complet en 1 commande
   - `npx x402-bazaar config` — generateur de config MCP
   - `npx x402-bazaar status` — verification connexion
   - `npx x402-bazaar list` — lister les services (filtres chain, category, free)
   - `npx x402-bazaar search` — chercher un service
   - `npx x402-bazaar call` — appeler un service directement
   - `npx x402-bazaar wallet` — gestion wallet agent

5. **Ecosysteme** :
   - x402-langchain : package Python sur GitHub (Wintyx57/x402-langchain)
   - x402-fast-monetization-template : template FastAPI
   - Marketing : 5 contenus prets (twitter, HN, Reddit, DoraHacks, video script)

6. **Supabase** :
   - URL : https://kucrowtjsgusdxnjglug.supabase.co
   - Tables : `services`, `activity`, `used_transactions`

### Credentials (NE PAS AFFICHER)

- Coinbase API Key : dans .env sur Render
- Wallet reception (MetaMask) : `0xfb1c478BD5567BdcD39782E0D6D23418bFda2430`
- Reseau : Base mainnet (chainId 8453)
- Email git pour Vercel : `robin.fuchs57@hotmail.com`
- Vercel CLI installe globalement, compte `wintyx57` connecte
- Domaine : x402bazaar.org (Namecheap)
- Google Search Console : Verifie (DNS TXT record)

### Variables d'environnement

**Backend (Render)** :
```
PORT=3000
NETWORK=mainnet
WALLET_ADDRESS=0xfb1c478BD5567BdcD39782E0D6D23418bFda2430
WALLET_ID=81a05b08-e58e-432f-99e6-586baa8552c3
ADMIN_TOKEN=***
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
| MetaMask (reception) | 0xfb1c478BD5567BdcD39782E0D6D23418bFda2430 | WALLET_ADDRESS - recoit tous les paiements |
| Server wallet | WALLET_ID 81a05b08 (addr 0x5E83...) | Coinbase SDK, 2.3 USDC, 0 ETH |
| Agent wallet | Seed dans agent-seed.json (addr 0xA986...) | Utilise pour la demo agent mainnet |
| Server seed wallet | Seed dans server-seed.json (wallet df759258) | Wallet vide, non utilise |

### Prochaines etapes

**Phase 1 — COMPLETE (12/02/2026):**
- [x] Milestone 1: CLI publie sur npm (x402-bazaar@2.0.0)
- [x] Milestone 1b: CLI reference sur toutes les pages du site
- [x] Milestone 2: Config Generator (CLI + page /config)
- [x] Milestone 3: 6 wrappers API natifs (search, scrape, twitter, weather, crypto, joke)
- [x] Milestone 3b: 2 wrappers avances + 8 nouveaux (total: 29 endpoints natifs)
- [x] Milestone 4: Refonte /docs — documentation centralisee avec sidebar + scroll-spy
- [x] Milestone 4b: UX/UI & Trust Layer (FAQ, Demos, Dashboard, badges, health check, filtres)
- [x] Milestone 5: Marketing (landing page, thread Twitter, HN, Reddit, DoraHacks, video script)
- [x] Milestone 6: Ecosysteme (x402-langchain, guide LangChain, section securite, backend refactoring, SEO, tests)

**Phase 2 — A definir:**
- [ ] Atteindre 40+ services natifs
- [ ] CLI v3 (paiement automatique via wallet)
- [ ] Monitoring et alertes (uptime, erreurs)
- [ ] Auto-GPT plugin
- [ ] Tests unitaires backend
- [ ] Landing page A/B testing

**Maintenance:**
- [x] Google Search Console integre
- [x] Sitemap soumis
- [x] Dashboard admin sécurisé (ADMIN_TOKEN)

**Idees evaluees et rejetees (12/02/2026):**
- Recherche semantique (embeddings) : overkill pour 70 services, effort L, impact 2/5
- Mode "agent view" JSON-only : deja fait via /api/services
- Upgrade Web Search vers Brave/Tavily : DuckDuckGo suffit pour le hackathon

### Commandes

```bash
# CLI (One-Line Install)
cd x402-bazaar-cli && node bin/cli.js init     # Setup complet
cd x402-bazaar-cli && node bin/cli.js config   # Generer config MCP
cd x402-bazaar-cli && node bin/cli.js status   # Verifier connexion
cd x402-bazaar-cli && node bin/cli.js list     # Lister les services
cd x402-bazaar-cli && node bin/cli.js search   # Chercher un service
cd x402-bazaar-cli && node bin/cli.js call     # Appeler un service
cd x402-bazaar-cli && node bin/cli.js wallet   # Gestion wallet

# Backend
cd x402-bazaar && node server.js          # Demarrer le backend local
cd x402-bazaar && node seed-services.js   # Re-seeder la base
cd x402-bazaar && node seed-wrappers.js   # Re-seeder les wrappers natifs
cd x402-bazaar && node demo-agent.js      # Lancer l'agent demo
cd x402-bazaar && node setup-activity.js  # Verifier la table activity
cd x402-bazaar && npm test                # Lancer les 37 tests e2e

# Frontend
cd x402-frontend && npm run dev           # Dev server (localhost:5173)
cd x402-frontend && npm run build         # Build production

# Git (auto-deploy sur push)
cd x402-frontend && git push origin main  # Push -> Vercel auto-deploy
cd x402-bazaar && git push origin main    # Push -> Render auto-deploy
```

### Historique des commits recents

**Backend (x402-bazaar)** :
- `2159d83` fix: trim whitespace in adminAuth token comparison
- `cbcde3f` feat: add e2e test suite (37 tests)
- `4b42930` feat: add 8 new API wrappers (translate, summarize, code, dns, qrcode, readability, sentiment, validate-email)
- `12ff68f` feat: redesign admin dashboard — wallet balance hero, stats, activity feed, glassmorphism
- `ae6a5f7` feat: enrich /api/analytics — walletBalance, recentActivity, avgPrice
- `202fd15` feat: refactor backend into modules (routes/, lib/)
- `9161660` fix: lazy init OpenAI client to prevent crash on missing API key
- `ea44857` Add services/activity, health-check, and analytics endpoints
- `8510950` feat: add DALL-E 3 image generation + Twitter search endpoints
- `5aa0a98` chore: add GitHub templates and CONTRIBUTING.md

**Frontend (x402-frontend)** :
- `02bbda6` feat: complete SEO optimization (JSON-LD, sitemap, useSEO, cache headers)
- `75eddca` feat: add Google Search Console verification
- `ee6d19e` feat: landing page polish + blog FR translation
- `2263f30` feat: Milestone 5.1 + 6.2 + 6.3 — landing page value prop, security section, LangChain guide
- `94ce2bc` Add /docs page — centralized documentation with sidebar, scroll-spy, API reference
- `9bc8eb5` feat: add Config Generator page (Milestone 2)
- `59b5bab` Milestone 4b: FAQ, Demos, Analytics, badges, health check, advanced filters

**CLI (x402-bazaar-cli)** :
- `404bd08` feat: CLI v2.0.0 — add list, search, call, wallet commands
- Publie sur npm: x402-bazaar@2.0.0 (12/02/2026)

*Derniere mise a jour: 12/02/2026 — Phase 1 COMPLETE, CLAUDE.md synchronise avec ROADMAP.md*
