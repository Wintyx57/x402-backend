# x402 Bazaar - Contexte pour Claude

## PLAN DE ROUTE — Phase 1 "Developer Obsession" (Mis a jour: 13/02/2026 — PHASE 1 COMPLETE + MONITORING)

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
│     ├── [x] 3b.4 Total: 41 endpoints natifs enregistres dans Supabase (seed-wrappers.js)
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
      ├── [x] 6.6 79 tests e2e (node:test, zero deps)
      └── [x] 6.7 Auto-GPT plugin — COMPLET (x402-autogpt-plugin v0.1.0, 13/02/2026)
```

### CLI x402-bazaar (Milestone 1 - COMPLET, PUBLIE sur npm)

**Localisation:** `HACKATHON/x402-bazaar-cli/`
**npm package size:** 13.4 KB (11 fichiers)
**Version actuelle:** x402-bazaar@3.0.0

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
│   │   ├── call.js         # npx x402-bazaar call <endpoint> [--param key=value] [--key wallet.json]
│   │   └── wallet.js       # npx x402-bazaar wallet [--address]
│   ├── detectors/
│   │   └── environment.js  # Detection: Claude Desktop, Cursor, VS Code+Continue, Claude Code
│   ├── generators/
│   │   ├── mcp-config.js   # Generateur JSON MCP (merge avec config existante)
│   │   └── env-file.js     # Generateur .env
│   ├── lib/
│   │   └── payment.js      # Auto-payment avec USDC sur Base (viem)
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
- `npx x402-bazaar init --setup` — Mode setup guide interactif pour wallet
- `npx x402-bazaar config` — Generer la config MCP interactivement
- `npx x402-bazaar config --output mcp.json` — Sauvegarder dans un fichier
- `npx x402-bazaar status` — Verifier la connexion au serveur live
- `npx x402-bazaar list [--chain base|skale] [--category ai] [--free]` — Lister les services
- `npx x402-bazaar search <query>` — Chercher un service par nom/description
- `npx x402-bazaar call <endpoint> [--param key=value] [--key wallet.json]` — Appeler un service directement avec auto-payment USDC
- `npx x402-bazaar wallet [--address 0x...]` — Afficher/gerer la wallet agent

**Publie sur npm:** x402-bazaar@3.0.0 (12/02/2026) — https://www.npmjs.com/package/x402-bazaar
**Compte npm:** wintyx

---

## Etat actuel du projet (12/02/2026 — Phase 1 COMPLETE)

### Architecture

```
HACKATHON/
├── x402-bazaar/          # Backend (Express API)
│   ├── server.js         # Serveur principal - helmet, CORS strict, anti-replay, rate limiting
│   │                      # 41 endpoints natifs (x402-native)
│   │                      # routes/, lib/ modules (health, services, register, dashboard, wrappers, logger, chains, activity, payment)
│   ├── routes/           # Modularisation routes
│   │   ├── health.js     # GET /health
│   │   ├── services.js   # GET /api/services, GET /api/services/:id, POST /api/services/activity
│   │   ├── register.js   # POST /api/register, POST /api/image, POST /api/search, etc.
│   │   ├── dashboard.js  # GET /dashboard (admin), GET /api/analytics (enrichi)
│   │   ├── wrappers.js   # GET /api/[wrapper]
│   │   ├── monitoring.js # GET /api/status, /api/status/uptime, /api/status/history (public)
│   │   └── budget.js    # Budget Guardian: POST/GET/DELETE /api/budget, GET /api/budgets, POST /api/budget/check
│   ├── lib/              # Logique metier
│   │   ├── logger.js     # Winston logger
│   │   ├── chains.js     # Config networks (Base, SKALE)
│   │   ├── activity.js   # Activity tracking
│   │   ├── payment.js    # Payment verification (with budget integration)
│   │   ├── budget.js     # Budget Guardian (spending caps, alerts at 50/75/90%)
│   │   ├── monitor.js    # Monitoring engine (41 endpoints, 5min checks, Telegram alerts)
│   │   └── telegram-bot.js # Interactive Telegram bot (6 commands, polling, secured by chat_id)
│   ├── mcp-server.mjs    # Serveur MCP pour Claude/Cursor (x402 payment flow, call_api auto-payment)
│   ├── dashboard.html    # Dashboard admin redesigne (wallet balance hero, 5 stats, activity feed, glassmorphism)
│   ├── demo-agent.js     # Agent IA autonome (OpenAI GPT-4o-mini + Coinbase SDK)
│   ├── seed-services.js  # Script pour injecter 15 services proxy dans Supabase
│   ├── seed-wrappers.js  # Script pour injecter les 41 wrappers natifs dans Supabase
│   ├── setup-activity.js # Script pour verifier/creer la table activity
│   ├── create-wallet.js  # Utilitaire creation wallet
│   ├── API_WRAPPERS.md   # Documentation des 41 endpoints wrapper
│   ├── .env              # Variables prod (NE PAS LIRE)
│   ├── .env.example      # Template des env vars
│   ├── tests/
│   │   ├── e2e.test.js   # 79 tests e2e (node:test, zero deps)
│   │   └── telegram-bot.test.js # 13 tests (bot, register, dashboard, balance parsing)
│   └── package.json      # deps: express, cors, helmet, dotenv, express-rate-limit,
│                          #       @coinbase/coinbase-sdk, @supabase/supabase-js, openai,
│                          #       cheerio, turndown, zod
│
├── x402-bazaar-cli/      # CLI "One-Line Install" (npx x402-bazaar init) — npm x402-bazaar@3.0.0
│   ├── bin/cli.js         # Point d'entree CLI
│   ├── src/commands/      # init, config, status, list, search, call, wallet
│   ├── src/detectors/     # Detection environnement (Claude, Cursor, VS Code)
│   ├── src/generators/    # Generateur config MCP + .env
│   ├── src/lib/           # payment.js — auto-payment USDC sur Base (viem)
│   └── package.json       # deps: chalk, commander, inquirer, ora, viem
│
├── x402-langchain/       # Package Python LangChain (GitHub: Wintyx57/x402-langchain)
│   ├── x402_langchain/    # X402BazaarTool, X402Client, X402PaymentHandler
│   └── setup.py           # v0.1.0
│
├── x402-autogpt-plugin/  # Auto-GPT Plugin (GitHub: Wintyx57/x402-autogpt-plugin)
│   ├── src/x402_bazaar/   # X402BazaarPlugin (AutoGPTPluginTemplate) + X402Client
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
    │   ├── App.jsx       # Router (20 routes)
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
| GitHub Auto-GPT Plugin | https://github.com/Wintyx57/x402-autogpt-plugin | A jour |
| Dashboard | https://x402-api.onrender.com/dashboard | LIVE (protected ADMIN_TOKEN) |
| npm CLI | https://www.npmjs.com/package/x402-bazaar | v3.0.0 |

### Domaine x402bazaar.org

- **Registrar** : Namecheap
- **DNS** : A Record `@` → `76.76.21.21` + CNAME `www` → `cname.vercel-dns.com`
- **SSL** : Auto (Vercel Let's Encrypt)
- **SEO** : meta tags, Open Graph, Twitter Card, sitemap.xml, robots.txt, canonical URL, og-image.png, JSON-LD (Organization, WebSite, WebApplication, FAQPage, BreadcrumbList)
- **Google Search Console** : Vérifié et actif

### Ce qui est FAIT et FONCTIONNE

1. **Backend production** (Render, mainnet Base) :
   - `/health` → 200 OK, `"network": "Base"`
   - 41 endpoints natifs x402 : search, scrape, twitter, weather, crypto, joke, image, twitter-search, translate, summarize, code, dns, qrcode-gen, readability, sentiment, validate-email, hash, uuid, base64, password, currency, timestamp, lorem, headers, markdown, color, json-validate, useragent, +14 autres
   - Health-check endpoint pour monitoring des services
   - Analytics endpoint enrichi (walletBalance, recentActivity, avgPrice, activeServicesCount)
   - Dashboard admin `/dashboard` avec wallet balance hero, 5 stat cards, activity feed, glassmorphism
   - CORS whitelist strict (x402bazaar.org, Vercel, localhost)
   - Verification on-chain des paiements USDC sur Base mainnet
   - 70+ services en base Supabase
   - Backend refactoring en modules (routes/, lib/)
   - Monitoring: 41 endpoints checked every 5min, Telegram alerts on transitions, Supabase persistence
   - Status API: GET /api/status, /api/status/uptime, /api/status/history (public, free)
   - GPT Actions: Custom GPT with 30 operations (OpenAPI 3.1 spec)
   - Telegram bot: @x402_monitoradmin_bot (6 interactive commands, polling, secured by chat_id)
   - Auto-test on registration: ping URL + Telegram notification + verified_status update
   - Public stats: GET /api/public-stats (no auth, safe for frontend homepage)
   - Dashboard enriched: System Info panel (monitoring live, tests count, integrations with versions)
   - 361 tests total (271 unit + 90 e2e, node:test, zero deps)
   - Budget Guardian: spending controls for AI agents (5 API endpoints, alerts at 50/75/90%, auto-reset periods)

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

3. **Frontend React — 17 pages deployees (+3 en cours)** :
   - Glassmorphism design (glass cards, glow effects, gradient buttons, animated hero)
   - CountUp animations sur les stats
   - Compatible With section (5 logos)
   - How it works 3-step section
   - CTA glow effect
   - i18n FR/EN avec toggle (137+ cles pour blog bilingue)
   - useSEO hook pour meta tags dynamiques
   - Wallet connect via wagmi (MetaMask + Coinbase Wallet)
   - 17 routes live : /, /services, /register, /integrate, /developers, /mcp, /docs, /config, /about, /pricing, /blog, /faq, /demos, /status, /privacy, /terms, /playground
   - 3 pages wirees et live : /analytics, /compare, /for-providers
   - Documentation centralisee /docs (7 sections, sidebar sticky, scroll-spy, API reference auto-fetch)
   - Config Generator /config (formulaire + preview JSON + copier)
   - Playground interactif /playground (12 APIs, appels reels, JSON highlighting, code gen)
   - Filtres avances (chain, prix), badges enrichis, health check
   - FAQ, Demos, About avec section securite + SLA
   - Terms of Service /terms, Privacy /privacy
   - Cost Calculator dans Pricing
   - Blog 100% bilingue FR/EN
   - SEO complet (sitemap.xml, robots.txt, JSON-LD)
   - Google Search Console integre

4. **CLI** (npm x402-bazaar@3.0.0) :
   - `npx x402-bazaar init` — setup complet en 1 commande (avec --setup pour mode guide interactif)
   - `npx x402-bazaar config` — generateur de config MCP
   - `npx x402-bazaar status` — verification connexion
   - `npx x402-bazaar list` — lister les services (filtres chain, category, free)
   - `npx x402-bazaar search` — chercher un service
   - `npx x402-bazaar call` — appeler un service directement avec auto-payment USDC sur Base (--key wallet.json)
   - `npx x402-bazaar wallet` — gestion wallet agent

5. **Ecosysteme** :
   - x402-langchain : package Python sur GitHub (Wintyx57/x402-langchain)
   - x402-autogpt-plugin : plugin Auto-GPT v0.1.0 sur GitHub (Wintyx57/x402-autogpt-plugin)
   - x402-fast-monetization-template : template FastAPI
   - Marketing : 5 contenus prets (twitter, HN, Reddit, DoraHacks, video script)

6. **Supabase** :
   - URL : https://kucrowtjsgusdxnjglug.supabase.co
   - Tables : `services`, `activity`, `used_transactions`, `monitoring_checks`

### Credentials (NE PAS AFFICHER)

- Coinbase API Key : dans .env sur Render
- Wallet reception (MetaMask) : `0xfb1c478BD5567BdcD39782E0D6D23418bFda2430`
- Reseau : Base mainnet (chainId 8453)
- Email git pour Vercel : `robin.fuchs57@hotmail.com`
- Vercel CLI installe globalement, compte `wintyx57` connecte
- Domaine : x402bazaar.org (Namecheap)
- Google Search Console : Verifie (DNS TXT record)
- Telegram Bot : @x402_monitoradmin_bot (alertes monitoring → Robin)

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
TELEGRAM_BOT_TOKEN=***
TELEGRAM_CHAT_ID=***
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
- [x] Milestone 3b: 2 wrappers avances + 32 nouveaux (total: 41 endpoints natifs)
- [x] Milestone 4: Refonte /docs — documentation centralisee avec sidebar + scroll-spy
- [x] Milestone 4b: UX/UI & Trust Layer (FAQ, Demos, Dashboard, badges, health check, filtres)
- [x] Milestone 5: Marketing (landing page, thread Twitter, HN, Reddit, DoraHacks, video script)
- [x] Milestone 6: Ecosysteme (x402-langchain, guide LangChain, section securite, backend refactoring, SEO, tests)

**Phase 2 — COMPLETE:**
- [x] Atteindre 40+ services natifs (FAIT: 41 endpoints)
- [x] CLI v3 (paiement automatique via wallet) (FAIT: v3.0.0 avec auto-payment USDC)
- [x] Monitoring et alertes — DONE (lib/monitor.js, routes/monitoring.js, Status.jsx, Telegram @x402_monitoradmin_bot, Supabase monitoring_checks — 13/02/2026)
- [x] Auto-GPT plugin (x402-autogpt-plugin v0.1.0, Python, GitHub: Wintyx57/x402-autogpt-plugin — 13/02/2026)
- [x] Tests unitaires backend (254 unit tests — 13/02/2026)
- [x] Telegram bot interactif (6 commandes, polling, secured by chat_id — 13/02/2026)
- [x] Auto-test on registration (ping URL + Telegram notification — 13/02/2026)
- [x] Public stats endpoint enrichi (GET /api/public-stats: topEndpoints, uptimePercent, totalPayments — 13/02/2026)
- [x] Dashboard System Info panel (monitoring, tests, integrations — 13/02/2026)
- [x] ServiceCard verified badge ("Tested" for auto-tested services — 13/02/2026)
- [x] Trust Layer P0: Terms of Service, SLA section, Cost Calculator, Playground
- [x] Playground interactif /playground (12 APIs, appels reels, JSON highlighting, code gen — 13/02/2026)

**Phase 3 — COMPLETE (session 19, 13/02/2026):**

*P0 — Trust & Analytics — COMPLETE:*
- [x] Backend: /api/public-stats enrichi (topEndpoints, uptimePercent, totalPayments, recentCallCount24h)
- [x] Frontend: Analytics.jsx, Compare.jsx, ForProviders.jsx — 3 pages wirees + live
- [x] App.jsx: 20 routes (17 + analytics + compare + for-providers)
- [x] Navbar + Footer: liens analytics, compare, for-providers
- [x] translations.js: ~160 cles EN+FR (compare, forProviders, analytics extras)
- [x] FAQ expansion: 18 questions (q1-q18) + JSON-LD schema enrichi

*P1 — Product Features — COMPLETE:*
- [x] Quality Score badges dynamiques (Gold/Silver/Bronze par API basees uptime 7j)
- [x] Home.jsx: CTA "View Analytics" dans hero
- [x] Budget Guardian (backend: max spend caps par agent, alerts 50/75/90%) — DONE session 20

*P2 — Scale (long terme):*
- [ ] Solana support (multi-chain)
- [ ] Batch payments / Subscription tiers
- [ ] Provider outreach + first external provider

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
cd x402-bazaar && npm test                # Lancer les 79 tests e2e

# Frontend
cd x402-frontend && npm run dev           # Dev server (localhost:5173)
cd x402-frontend && npm run build         # Build production

# Git (auto-deploy sur push)
cd x402-frontend && git push origin main  # Push -> Vercel auto-deploy
cd x402-bazaar && git push origin main    # Push -> Render auto-deploy
```

### Historique des commits recents

**Backend (x402-bazaar)** :
- `c7cfadd` feat: add 12 new API wrappers (batch 2: hash, uuid, base64, password, currency, timestamp, lorem, headers, markdown, color, json-validate, useragent)
- `f4cc4d7` fix: translate wrapper fallback 'auto' to 'en'
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
- `44ce9b2` feat: CLI v3.0.0 — auto-payment with USDC on Base
- `404bd08` feat: CLI v2.0.0 — add list, search, call, wallet commands
- Publie sur npm: x402-bazaar@3.0.0 (12/02/2026)

*Derniere mise a jour: 13/02/2026 — Phase 1 COMPLETE + Phase 2 COMPLETE + Phase 3 COMPLETE (20 routes, 18 FAQ, Budget Guardian, quality badges, 361 tests, 6 integrations)*
