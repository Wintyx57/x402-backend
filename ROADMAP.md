# x402 Bazaar - Roadmap Phase 1 "Developer Obsession"

**Date de creation:** 2026-02-09
**Statut:** Phase 1-3 COMPLETE + ERC-8004 + Polygon (13/03/2026)
**Objectif:** Rendre l'integration si facile que ne pas l'utiliser devient une erreur.

---

## Vue d'ensemble

```
Phase 1: Developer Obsession (Mois 1-2)
├── [x] Milestone 1: CLI "One-Line Install" (npx x402-bazaar init) — PUBLIE npm
├── [x] Milestone 1b: CLI reference sur le site web — DEPLOYE
├── [x] Milestone 2: Config Generator (Web + CLI) — COMPLET
├── [x] Milestone 3: 6 Wrappers API x402 natifs — LIVE
├── [x] Milestone 3b: Holy Trinity + Wrappers avances — COMPLET
├── [x] Milestone 4: Refonte /docs — Page documentation centralisee — COMPLET
├── [x] Milestone 4b: UX/UI & Trust Layer — COMPLET
├── [x] Milestone 5: Marketing "Carte de credit illimitee" — COMPLET
└── [x] Milestone 6: Ecosysteme & Integrations — COMPLET
```

---

## Milestone 1: CLI "One-Line Install" (`npx x402-bazaar init`)
**Priorite:** CRITIQUE - Premier point de contact developpeur
**Effort estime:** 2-3 jours
**Statut:** COMPLET — Publie sur npm (x402-bazaar@1.0.0, 09/02/2026)

### Objectif
Un developpeur doit pouvoir installer et configurer x402 Bazaar en UNE commande.

### Specification technique

```
npx x402-bazaar init
```

**Ce que la commande fait automatiquement:**

1. **Detection d'environnement:**
   - Claude Desktop (Windows/Mac) -> config dans `%APPDATA%/Claude/claude_desktop_config.json`
   - Cursor -> config dans `.cursor/mcp.json`
   - VS Code + Continue -> config dans `.continue/config.json`
   - Generic MCP client -> fichier JSON standalone

2. **Installation du serveur MCP:**
   - Clone/telecharge les fichiers necessaires (mcp-server.mjs + deps)
   - `npm install` automatique

3. **Configuration wallet:**
   - Option A: "J'ai deja un wallet Coinbase" -> demande les cles API
   - Option B: "Creer un nouveau wallet" -> guide pas-a-pas
   - Option C: "Mode lecture seule" -> pas de wallet, browse seulement

4. **Generation de config:**
   - Genere le JSON de config MCP adapte a l'environnement detecte
   - Ecrit le fichier au bon emplacement (ou affiche pour copier)

5. **Verification:**
   - Test de connexion au serveur x402 Bazaar
   - Affiche le statut (OK / erreurs)

### Structure du package CLI

```
x402-bazaar-cli/
├── package.json            # name: "x402-bazaar", bin: "x402-bazaar"
├── bin/
│   └── cli.js              # Point d'entree (#!/usr/bin/env node)
├── src/
│   ├── commands/
│   │   ├── init.js          # Commande principale
│   │   ├── config.js        # Generer/modifier la config
│   │   ├── status.js        # Verifier l'etat de la connexion
│   │   └── wallet.js        # Gestion wallet
│   ├── detectors/
│   │   └── environment.js   # Detection IDE/AI client
│   ├── generators/
│   │   ├── mcp-config.js    # Generateur de config MCP
│   │   └── env-file.js      # Generateur de .env
│   └── utils/
│       ├── prompts.js       # Prompts interactifs (inquirer)
│       ├── spinner.js       # Spinner CLI (ora)
│       └── logger.js        # Output colore (chalk)
└── templates/
    ├── claude-desktop.json  # Template config Claude Desktop
    ├── cursor.json          # Template config Cursor
    └── env.template         # Template .env
```

### Sous-taches

- [x] 1.1 Creer la structure du package CLI
- [x] 1.2 Implementer la detection d'environnement
- [x] 1.3 Implementer le flow interactif (prompts)
- [x] 1.4 Implementer le generateur de config MCP
- [x] 1.5 Implementer la verification de connexion
- [x] 1.6 Implementer le mode "wallet existant" vs "nouveau wallet"
- [x] 1.7 Tester sur Windows (status, help, version, init --help, npm pack)
- [x] 1.8 Publier sur npm (`npm publish`) — x402-bazaar@1.0.0

---

## Milestone 2: Config Generator
**Priorite:** HAUTE - Quick win a forte valeur
**Effort estime:** 1-2 jours
**Statut:** COMPLET — CLI (2.1) + Web page /config (2.2-2.5) deployes le 12/02/2026

### Objectif
L'utilisateur ne doit JAMAIS ecrire de JSON a la main.

### 2 versions:

#### 2A: Config Generator CLI (integre dans `npx x402-bazaar config`)
- Commande interactive qui pose les questions et genere le JSON
- `npx x402-bazaar config --env claude-desktop`
- `npx x402-bazaar config --env cursor`

#### 2B: Config Generator Web (page sur x402bazaar.org/config)
- Formulaire web avec:
  - Selection de l'environnement (dropdown)
  - Champs pour les cles API
  - Preview en temps reel du JSON genere
  - Bouton "Copier" one-click
  - Detection automatique de l'OS pour les chemins

### Sous-taches

- [x] 2.1 CLI: Ajouter la commande `config` au CLI — FAIT (existait deja)
- [x] 2.2 Web: Creer la page /config dans le frontend React — FAIT 12/02/2026
- [x] 2.3 Web: Formulaire interactif avec preview JSON — FAIT 12/02/2026
- [x] 2.4 Web: Bouton copier + detection OS — FAIT 12/02/2026
- [x] 2.5 Ajouter le lien dans la navbar du site — FAIT 12/02/2026

---

## Milestone 3: Wrappers API x402
**Priorite:** HAUTE - Resoudre le probleme de l'oeuf et de la poule
**Effort estime:** 1 semaine
**Statut:** COMPLET — 6 endpoints natifs live sur x402-api.onrender.com

### Objectif
Bootstrapper la marketplace avec des wrappers x402 pour les APIs les plus utiles aux agents.

### APIs prioritaires (Top 4 pour v1)

| # | API | Type | Utilite pour agents | Difficulte |
|---|-----|------|---------------------|------------|
| 1 | Brave Search | Search | Recherche web en temps reel | Facile |
| 2 | Twitter/X API | Social | Poster/lire des tweets | Moyenne |
| 3 | Render/Railway | Compute | Lancer des containers | Difficile |
| 4 | OpenAI / Anthropic | AI | LLM-as-a-service payable en crypto | Moyenne |

### Architecture d'un Wrapper

```
x402-wrapper-brave/
├── server.js          # Express + x402 payment middleware
├── package.json
├── .env.example       # BRAVE_API_KEY + WALLET_ADDRESS
└── README.md          # Comment deployer son propre wrapper
```

**Pattern:**
1. L'agent appelle le wrapper via x402
2. Le wrapper verifie le paiement on-chain
3. Le wrapper appelle l'API sous-jacente (Brave, Twitter...)
4. Le wrapper retourne les resultats

### Sous-taches

- [x] 3.1 Creer le template de base pour un wrapper x402
- [x] 3.2 Wrapper Web Search (DuckDuckGo) — /api/search (0.005 USDC)
- [x] 3.3 Wrapper Universal Scraper — /api/scrape (0.005 USDC)
- [x] 3.4 Wrapper Twitter/X (fxtwitter) — /api/twitter (0.005 USDC)
- [x] 3.5 Wrappers Weather, Crypto, Joke — /api/weather, /api/crypto, /api/joke
- [x] 3.6 Enregistrer les wrappers sur la marketplace (seed-wrappers.js)
- [x] 3.7 Documentation: API_WRAPPERS.md + template Python
- [x] 3.8 Badge "x402 Native" sur le frontend + compteur Live APIs

---

## Milestone 4: Refonte /docs — Page documentation centralisee
**Priorite:** MOYENNE
**Effort estime:** 2-3 jours
**Statut:** COMPLET — Page /docs deployee le 12/02/2026

### Objectif
Documentation de qualite Stripe/Vercel. Une page unique /docs avec sidebar sticky, scroll-spy, et API Reference auto-fetchee.

### Sous-taches

- [x] 4.1 Page /docs: 7 sections (Quickstart, Protocol, API Reference, Native Wrappers, MCP, Integration, Security)
- [x] 4.2 DocsSidebar: sticky desktop + drawer mobile avec scroll-spy
- [x] 4.3 Code examples interactifs (CopyButton + CodeBlock)
- [x] 4.4 Section "Quickstart" (5 min to first call) avec badge vert
- [x] 4.5 API Reference auto-fetchee depuis GET / (fallback statique)
- [x] 4.6 7 endpoints natifs documentes (params, curl, response JSON)
- [x] 4.7 ~100 cles EN + ~100 cles FR (bloc docs.*)
- [x] 4.8 Route /docs + lien "Docs" en 1ere position devLinks navbar

---

## Milestone 5: Marketing
**Priorite:** BASSE (apres les milestones techniques)
**Effort estime:** Continu
**Statut:** COMPLET — Landing page + contenu marketing le 12/02/2026

### Messaging principal
> "Donnez une carte de credit illimitee a votre Agent IA (sans risque)"
> Via x402, l'agent paie a l'acte, sans abonnement mensuel bloquant.

### Sous-taches

- [x] 5.1 Landing page avec le messaging — Value Proposition (4 cartes) + Social Proof ajoutes a Home.jsx — FAIT 12/02/2026
- [x] 5.2 Video demo script — Script 3 min (6 scenes) dans x402-marketing/video-script.md — FAIT 12/02/2026
- [x] 5.3 Thread Twitter/X de lancement — 12 tweets dans x402-marketing/twitter-thread.md — FAIT 12/02/2026
- [x] 5.4 Post Hacker News / Reddit — x402-marketing/hn-post.md + reddit-post.md — FAIT 12/02/2026
- [x] 5.5 DoraHacks submission — x402-marketing/dorahacks-submission.md — FAIT 12/02/2026

---

## Milestone 3b: Holy Trinity + Wrappers avances
**Priorite:** HAUTE - Les APIs les plus demandees par les agents
**Effort estime:** 2-3 jours
**Statut:** COMPLET — Image Generation (DALL-E 3) + Twitter Search + 8 nouveaux wrappers implementes le 12/02/2026

### Objectif
Completer le "Holy Trinity" des APIs pour agents : Oreilles (social), Yeux (search), Mains (creation).
Les wrappers search et twitter existent deja, mais il manque des capacites cles.

### Sous-taches

- [x] 3b.1 Twitter Search : `/api/twitter?search=keyword` via DuckDuckGo site:twitter.com + extraction auteur — FAIT 12/02/2026
- [x] 3b.2 Image Generation : `/api/image?prompt=...&size=...&quality=...` via DALL-E 3 reel (0.05 USDC) — FAIT 12/02/2026
- [x] 3b.3 8 nouveaux wrappers : translate, summarize, code, dns, qrcode-gen, readability, sentiment, validate-email — FAIT 12/02/2026
- [x] 3b.4 Enregistrer les nouveaux wrappers dans Supabase (seed-wrappers.js mis a jour) — FAIT 12/02/2026
- [x] 3b.5 Mettre a jour API_WRAPPERS.md avec la doc des nouveaux endpoints — FAIT 12/02/2026

### Notes techniques
- La cle OPENAI_API_KEY est deja configuree sur Render (utilisee par demo-agent.js)
- Twitter Search : fxtwitter ne supporte pas la recherche. Explorer nitter instances ou scraping direct
- Image : DALL-E 3 via openai SDK deja en dep. Endpoint retourne URL temporaire (1h) ou base64

---

## Milestone 4b: UX/UI & Trust Layer
**Priorite:** HAUTE - Transformer le prototype en produit credible
**Effort estime:** 3-4 jours
**Statut:** COMPLET — FAQ, Demos, Dashboard, badges, health check, filtres avances le 12/02/2026

### Objectif
Ajouter les signaux de confiance et les outils de decouverte qui manquent a la marketplace.

### Sous-taches

- [x] 4b.1 Badges enrichis sur ServiceCard : badge "x402 Native" (pour les wrappers internes), badge "Last active: Xh ago" (basé sur derniere activite en base)
- [x] 4b.2 Health check des services : endpoint `/api/health-check` qui ping les URLs des services listes. Cron toutes les heures. Badge "Online" / "Offline" sur les cards
- [x] 4b.3 Filtres avances dans Services.jsx : filtre par chain (Base / SKALE / Polygon), slider prix max
- [x] 4b.4 Dashboard avec charts : ajouter Chart.js au dashboard.html OU creer une page /analytics dans le frontend. Graphiques: volume de tx/jour, top services, revenus cumules
- [x] 4b.5 Galerie de demos agents : page /demos sur le frontend montrant des exemples d'agents en action (code + video embed). Showcaser demo-agent.js et des chains multi-API
- [x] 4b.6 Page FAQ : section FAQ sur /about ou page dediee /faq. Couvrir: "tx fail?", "comment lister?", "testnet?", "frais gas?"

### Notes techniques
- Les badges doivent etre traduits (i18n FR/EN)
- Le health check peut etre un simple HEAD request avec timeout 5s
- Chart.js est leger (~60KB) et fonctionne sans build
- La galerie peut reutiliser le code de demo-agent.js comme exemple

---

## Milestone 6: Ecosysteme & Integrations
**Priorite:** MOYENNE - Adoption organique via les ecosystemes IA
**Effort estime:** 3-5 jours
**Statut:** COMPLET — Package LangChain + guide + section securite + backend refactoring + SEO + tests le 12/02/2026

### Objectif
Permettre aux agents de TOUT ecosysteme (pas juste Claude/MCP) d'utiliser le Bazaar nativement.

### Sous-taches

- [x] 6.1 Package LangChain : x402-langchain v0.1.0 sur GitHub (Wintyx57/x402-langchain). X402BazaarTool (BaseTool), X402Client, X402PaymentHandler. 6 factory methods, multi-chain, budget tracking — FAIT 12/02/2026
- [x] 6.2 Guide LangChain : section ajoutee dans Integrate.jsx avec CodeBlock + badge pip + lien GitHub — FAIT 12/02/2026
- [x] 6.3 Section securite visible : section Security ajoutee dans About.jsx (6 features: anti-replay, on-chain verification, SSRF, rate limiting, budget control, spam prevention) — FAIT 12/02/2026
- [x] 6.4 Backend refactoring en modules : routes/ (health, services, register, dashboard, wrappers) et lib/ (logger, chains, activity, payment) — FAIT 12/02/2026
- [x] 6.5 SEO complet : sitemap.xml, robots.txt enrichi, useSEO hook, JSON-LD (Organization, WebSite, WebApplication, FAQPage, BreadcrumbList), vercel.json headers + cache, Google Search Console verifie — FAIT 12/02/2026
- [x] 6.6 71 tests e2e : tests/e2e.test.js (node:test, zero deps) — FAIT 12/02/2026
- [x] 6.7 Auto-GPT plugin : x402-autogpt-plugin v0.1.0 (X402Client, X402BazaarPlugin, AutoGPTPluginTemplate, 30+ tests, standalone usage, complete docs) — FAIT 13/02/2026
- [x] 6.8 n8n community node : n8n-nodes-x402-bazaar v1.4.0 (universal node, 5 ops incl Register + split, dynamic dropdown, auto x402 payment, viem CJS, budget tracking) — FAIT 03/03/2026

### Notes techniques
- Le MCP server (mcp-server.mjs) est deja l'equivalent pour Claude. LangChain = meme logique en Python
- Le template FastAPI (x402-fast-monetization-template/) peut servir de base pour le package Python
- La section securite est un ajout frontend simple (contenu statique + i18n)

---

## Phase 2: Scale & Polish (À definir)

### Réalisations hors-roadmap (12/02/2026)
- [x] Backend refactorisé en modules (routes/, lib/)
- [x] Dashboard admin sécurisé (ADMIN_TOKEN)
- [x] SEO complet (sitemap, JSON-LD, useSEO, Google Search Console)
- [x] 71 tests e2e (node:test, zero deps)
- [x] 8 nouveaux wrappers API (total: 29 services natifs)
- [x] Landing page polish (CountUp, Compatible With, How it works, CTA glow)
- [x] Blog 100% bilingue FR/EN (137 clés i18n)
- [x] CLI v2.0.0 (list, search, call, wallet)
- [x] 41 native API wrappers (12 new batch 2: hash, uuid, base64, password, currency, timestamp, lorem, headers, markdown, color, json-validate, useragent)
- [x] CLI v3.0.0 with auto-payment (viem, Base mainnet)
- [x] MCP call_api tested with real x402 payments
- [x] Translate wrapper bugfix (from=auto fallback to en)
- [x] Monitoring system (lib/monitor.js checks 41 endpoints every 5min, Telegram alerts on transitions, Supabase persistence)
- [x] Status API: GET /api/status, /api/status/uptime, /api/status/history (public, free)
- [x] Frontend /status page (overall badge, endpoint grid, uptime bars, auto-refresh 60s, i18n FR/EN)
- [x] 79 e2e tests (71 + 4 monitoring + 4 GPT actions)
- [x] 254 unit tests (6 test files: activity, monitor, middleware, services-logic, register-validation, telegram-bot)
- [x] Pricing page (41 endpoints in 6 price tiers + marketplace fees + FAQ)
- [x] GPT Actions (Custom GPT created, OpenAPI 3.1 spec with 30 operations, Privacy Policy page)

### À faire
- [x] Atteindre 40+ services natifs — DONE (41 services, 12 new batch 2: hash, uuid, base64, password, currency, timestamp, lorem, headers, markdown, color, json-validate, useragent — 12/02/2026)
- [x] CLI v3 (paiement automatique via wallet) — DONE (x402-bazaar@3.0.0 published on npm, auto-payment via viem on Base mainnet — 12/02/2026)
- [x] Monitoring et alertes — DONE (lib/monitor.js, routes/monitoring.js, 41 endpoints checked every 5min, Telegram alerts, Supabase persistence, /status page on frontend — 13/02/2026)
- [x] Auto-GPT plugin (6.7) — DONE (x402-autogpt-plugin v0.1.0, src/x402_bazaar/, 30+ tests, docs, examples — 13/02/2026)
- [x] Tests unitaires backend (254 unit tests, 6 fichiers — 13/02/2026)
- [x] Pricing page (41 endpoints en 6 tiers + marketplace fees — 13/02/2026)
- [x] GPT Actions (Custom GPT with 30 operations, OpenAPI 3.1 spec — 13/02/2026)
- [x] Telegram bot interactif (6 commandes, polling, secured by chat_id — 13/02/2026)
- [x] Auto-test on registration (ping URL + Telegram notification — 13/02/2026)
- [x] Public stats endpoint (GET /api/public-stats, no auth — 13/02/2026)
- [x] Dashboard System Info panel (monitoring, tests, integrations — 13/02/2026)
- [x] ServiceCard verified badge ("Tested" for auto-tested services — 13/02/2026)
- [x] HACKATHON/README.md global project presentation — 13/02/2026
- [x] Trust Layer P0: Terms of Service, SLA section, Cost Calculator, Playground interactif — 13/02/2026
- [x] Playground /playground (12 APIs, appels reels, JSON highlighting, code gen curl/JS/Python — 13/02/2026)
- [x] /api/public-stats enrichi (topEndpoints, uptimePercent, totalPayments, recentCallCount24h — 13/02/2026)
- [ ] Landing page: A/B testing, analytics conversion

---

## Phase 3: Trust & Growth (COMPLETE — session 19, 13/02/2026)

### P0 — COMPLETE
- [x] Backend: /api/public-stats enrichi (topEndpoints, uptimePercent, totalPayments, recentCallCount24h) — push 93698a1
- [x] Frontend: Analytics.jsx (page /analytics — stats publiques, monitoring, top endpoints)
- [x] Frontend: Compare.jsx (page /compare — x402 vs RapidAPI, 12 features, 6 advantages)
- [x] Frontend: ForProviders.jsx (page /for-providers — 5 etapes, 6 benefits, JSON spec, flow)
- [x] App.jsx: 3 lazy imports + 3 routes (17 → 20 routes)
- [x] Navbar.jsx + Footer.jsx: liens analytics, compare, for-providers
- [x] translations.js: sections compare + forProviders + analytics extras (~160 cles EN+FR)
- [x] FAQ.jsx: 8 nouvelles questions q11-q18 + JSON-LD schema enrichi
- [x] Build + push backend (93698a1) + frontend (7338567)

### P1 — Product Features
- [x] Quality Score / Badges dynamiques (Gold/Silver/Bronze par API basees uptime) — DONE session 19
- [x] Home.jsx: CTA "View Analytics" dans hero — DONE session 19
- [x] About.jsx: Section fondateur personnalisee ("Built by Robin") — DONE session 20
- [x] Services.jsx: Barre de recherche directe sur la page — DONE session 20
- [x] Budget Guardian (backend: max spend caps par agent, alerts 50/75/90%) — DONE session 20

### P1.5 — Reliability & MCP Verification (session 21, 13/02/2026)
- [x] MCP full API test: 41/41 APIs verified functional (43 on-chain payments, 0.21 USDC)
- [x] Rate limits optimized: paid requests (X-Payment-TxHash) bypass rate limiting (general 500/15min, paid 120/min)
- [x] /api/time: replaced unreliable worldtimeapi.org with native Intl.DateTimeFormat (zero external dependency)
- [x] /api/json-validate: added GET support alongside POST for MCP compatibility
- [x] 20 NEW API wrappers (41→61 total): news, stocks, reddit, hn, youtube, whois, ssl-check, regex, diff, math, unit-convert, csv-to-json, jwt-decode, cron-parse, password-strength, phone-validate, url-parse, url-shorten, html-to-text, http-status
- [x] 416 tests total (326 unit + 90 e2e), all passing
- [x] Monitoring updated (61 endpoints), seed-wrappers.js updated (61 services)
- [x] Commits: b4e297c, b20193c, 75ac845 (20 new APIs), 449caf6 (55 new tests)

### P1.6 — Frontend Polish & Provider Onboarding (sessions 22-23, 13/02/2026)
- [x] Accessibility audit + fixes: ConnectButton (Escape key + aria-haspopup), ServiceCard (alt text), FAQ (aria-controls + role=region on 18 items) — push 6362b17
- [x] Frontend polish: Navbar reorg (5 marketplace + 8 dev links), Footer reorg, outdated values fix (41→61, 333→416), i18n NotFound/Demos — push 24e8fee
- [x] Backend values sync: monitoring.js, dashboard.html, openapi.json, telegram-bot.js, server.js, e2e.test.js (41→61, 333→416) — push 65ee3d3
- [x] Register.jsx enhanced: category dropdown (7 cats), HTTP method toggle (GET/POST), live preview card, readiness checklist, i18n ~30 keys EN+FR — push ec71541
- [x] 416 tests verified (326 unit + 90 e2e), all passing
- [x] Frontend build verified, auto-deploy Vercel

### P1.7 — Telegram Expansion + Analytics + Wallet (session 24, 13/02/2026)
- [x] Telegram bot 6→11 commands: +/uptime (24h/7d/30d), /top (top 10 APIs), /revenue (7-day breakdown), /search <query>, /endpoint <name>
- [x] Enriched /stats (API calls, 24h count, avg price, monitoring), /recent (tx hash BaseScan links), /services (tags), /help (categorized)
- [x] Analytics.jsx: fix monitoring status color (operational=green), chart.js bar chart + doughnut, recent activity feed, error handling + retry
- [x] Wallet: featuredWalletIds (MetaMask/Coinbase/Trust/Rainbow), allWallets HIDE, disabled analytics/onramp/swaps, enableWalletConnect for mobile
- [x] 416 tests verified (326 unit + 90 e2e), all passing
- [x] Commits: e4e8c66 (backend telegram), df99d78 (frontend analytics + wallet)

### P1.8 — Budget Dashboard + Creator Portal + UX Polish (session 25, 14/02/2026)
- [x] Keep-alive fix: self-ping RENDER_EXTERNAL_URL/health every 10min (prevents Render free-tier spin-down)
- [x] Budget Dashboard (/budget): wallet input, budget config form, progress bars, alert thresholds 50/75/90%
- [x] Creator Portal — /creators: landing page (95% revenue share, stats, comparison chart)
- [x] Creator Portal — /creators/dashboard: provider dashboard (APIs by wallet, revenue tracking)
- [x] Creator Portal — /creators/onboarding: 4-step expandable guide
- [x] Dark/Light mode: ThemeContext + DarkModeToggle + localStorage persistence
- [x] UX polish: Skeleton loaders (Services, Playground), ServiceCard hover animations, page transitions
- [x] 24 routes total, ~220 new i18n keys (EN+FR)
- [x] 416 tests verified (326 unit + 90 e2e), all passing
- [x] Commits: 2794acc (backend keep-alive), 3793db7 (frontend budget + creators + polish)

### P1.9 — RainbowKit Migration + Wallet Fixes (session 26, 14/02/2026)
- [x] Migration Reown AppKit → RainbowKit (wagmi v3→v2, valtio dep)
- [x] CreatorDashboard: useAccount() auto-detection + /api/services (free endpoint)
- [x] Locale fix: locale="en" sur RainbowKitProvider
- [x] Explicit wallet groups: MetaMask/Coinbase/Trust/Rainbow + WalletConnect/Injected
- [x] Commits frontend: ded57cf, 9498eaa, 05729fd, 2261e11

---

## Phase 4: Community Agent & Growth

### P0 — Agent Community Manager Multi-Reseaux (NEXT)
**Objectif:** Agent IA autonome qui gere la communication x402 Bazaar sur 8+ reseaux sociaux, en utilisant les APIs du site lui-meme (dogfooding).
**Repo:** `x402-community-agent/`

**Sprint 1 — APIs de posting (backend, 8 nouvelles APIs):**
- [ ] `/api/twitter-post` — Publier sur Twitter/X (Twitter API v2, $100/mois)
- [ ] `/api/reddit-post` — Publier sur Reddit (Reddit API, gratuit)
- [ ] `/api/linkedin-post` — Publier sur LinkedIn (LinkedIn API, gratuit)
- [ ] `/api/devto-post` — Publier sur Dev.to (Dev.to API, gratuit)
- [ ] `/api/discord-webhook` — Poster via webhook Discord (gratuit)
- [ ] `/api/telegram-channel` — Poster dans un channel Telegram public (gratuit)
- [ ] `/api/farcaster-post` — Publier sur Farcaster/Warpcast (gratuit)
- [ ] `/api/hn-post` — Publier sur Hacker News (gratuit)

**Sprint 2 — Agent core (QUASI COMPLET — sessions 27-28):**
- [x] Dashboard V2 — SPA 6 pages (Tableau de bord, Automatisation, Studio, Config, Historique, Journaux)
- [x] Scheduler engine integre (60s tick, schedule par jour/heure, deduplication par jour)
- [x] Auto-publish per platform (toggle autoPublish, manual → awaiting_approval queue)
- [x] Content queue persistante (data/publication-queue.json, lifecycle: pending → published/failed/retry)
- [x] Auto-retry exponential backoff (5/30/60min, max 3 retries, retry only failed platforms)
- [x] Webhook /api/webhook/new-api (trigger new-api strategy on registration)
- [x] Real-time dashboard (15s auto-refresh, badge pending count, next post countdown)
- [x] 15 API routes (status, settings, stats, preview, scheduler, queue CRUD, webhook)
- [x] Settings management avec credential redaction (mergeSettings preserve secrets)
- [x] Calendrier editorial configurable (strategy@time per day)
- [x] Configurer Telegram bot + channel @x402bazaar (live, posts publies)
- [x] Content generation via x402 API /api/summarize (0.01 USDC/call, paiements on-chain)
- [x] Client x402 avec paiements auto USDC (wallet 0xB4C2...452a5 funde, operational)
- [x] Data files renommes (agent-config.json, publication-history.json, publication-queue.json)
- [ ] Configurer Discord webhook, Twitter API, Reddit, Dev.to, LinkedIn, Farcaster
- [ ] Integrer webhook dans backend x402 (POST /register → trigger webhook new-api)

**Sprint 3 — Go live:**
- [ ] Deploy agent sur Render (cron job)
- [ ] Semaine 1 en validation manuelle via Telegram
- [ ] Augmentation progressive de l'autonomie
- [ ] Tracking engagement dans Supabase

**APIs x402 existantes utilisees par l'agent:**
search, news, twitter (lecture), reddit (lecture), hn (lecture), summarize, translate, sentiment, image (DALL-E), markdown, code, html-to-text

**Plateformes ciblees (par priorite):**
- P0: Twitter/X, Reddit, LinkedIn, Telegram Channel
- P1: Hacker News, Dev.to, Discord, Farcaster/Warpcast
- P2: YouTube Shorts

### Session 58 — Full Production Audit + 34 Fixes + 159 Tests (10/03/2026)
- [x] **6-agent parallel audit**: security, code review, performance, tests, infrastructure, API design
- [x] **9 security fixes**: trust proxy, CORS null origin, err.message masking x3, faucet balance check, adminAuth brute-force, uncaughtException, prototype pollution
- [x] **7 performance fixes**: fetchWithTimeout timer leak, viem singleton, monitor LIMIT, stats LIMIT, enrichWithParams short-circuit, Cache-Control openapi
- [x] **10 infrastructure fixes**: Dockerfile x3, .node-version, CI SHA pins+permissions+security gate, .unref() timers x3, render.yaml, engines pin
- [x] **8 code quality fixes**: select(*) x5, float→integer split math, NETWORK warning, activity catch, dead schema, reviews signature mandatory
- [x] **159 new tests**: faucet(19), gatekeeper(57), payment-edge(31), proxy-unit(40), retention(12). Total 785 (772 pass, 0 fail)
- [x] Backend commit: `ef78ba3`. All pushed.

### Session 62 — Service Status Pipeline (11/03/2026)
- [x] **Migration 009**: `status TEXT DEFAULT 'unknown'` + `last_checked_at TIMESTAMPTZ` on services table
- [x] **daily-tester.js**: `updateServiceStatus()` — pass→online, partial→degraded, fail→offline after each test
- [x] **monitor.js**: `updateServicesStatus()` — batch-updates services.status every 5min (internal endpoints)
- [x] **services.js**: `status, last_checked_at` in SERVICE_COLUMNS → auto-propagated to all integrations
- [x] **MCP**: `call_service` blocks offline services before payment; `find_tool_for_task` adds status warnings
- [x] **Frontend**: removed healthMap + /api/health-check, uses `service.status` directly from DB
- [x] **Verified live**: monitor updates 69 internal services as 'online', daily-tester will update externals on next run
- [x] Backend commit: `308fadc`. Frontend commit: `4c93f47`. All pushed.

### Session 63-64 — SKALE Onboarding UX + OpenAI→Gemini (11-12/03/2026)
- [x] Weather API fix (axios), 3 new APIs (password-gen, user-agent-parse, color-convert)
- [x] Image generation restored via Gemini (was DALL-E 3)
- [x] TrustScore algorithm (Proof of Quality engine)
- [x] SKALE developer feedback: faucet auto-fund conditional, faucet drip 0.01→0.1 CREDITS
- [x] CLI v3.2.0→v3.2.5: SKALE default, Commander.js fix, setup_wallet mention
- [x] Backend commits: `00766bd`→`0e73594`. CLI: `61f4c41`→`ce6c8f3`. npm v3.2.5.

### Session 65 — ERC-8004 On-Chain Identity + Reputation (12/03/2026)
- [x] **10 files modified/created**: migration 011 (erc8004_agent_id + erc8004_registered_at), erc8004.js extended ABIs, lib/erc8004-registry.js (2-wallet init, registerAgent, pushTrustScoreFeedback, pushAllTrustScores), routes/health.js metadata endpoint, routes/register.js fire-and-forget on-chain, routes/services.js columns, lib/trust-score.js reputation push, server.js init, render.yaml, scripts/batch-register-erc8004.js
- [x] **Batch registration**: 74/74 services registered as agent NFTs → agentIds 16-89 on SKALE Identity Registry
- [x] **Contracts**: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (ERC-721), Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- [x] **2 wallets**: Registry `0xB4C2...a5` (AGENT_PRIVATE_KEY, owns NFTs) + Feedback `0x45B2...bAb` (ERC8004_FEEDBACK_KEY, submits scores)
- [x] **Metadata endpoint**: `GET /api/agents/:serviceId/metadata.json` (ERC-8004 compliant JSON)
- [x] **Reputation push**: TrustScores pushed on-chain every 6h after recalculation
- [x] 1022 tests pass. Backend commit: `6f41fe2`. All pushed.

### Session 59 — Hotfix Production Crash (10/03/2026)
- [x] **activity.js**: `.catch()` on Supabase PostgrestFilterBuilder (no `.catch()` method) → reverted to `.then(null, handler)`
- [x] **reviews.js**: express-rate-limit v7 IPv6 validation error with `trust proxy` → `validate: { keyGeneratorIpFallback: false }`
- [x] **Impact**: all paid endpoints returned 500 instead of 402 (cascade: logActivity crash in payment middleware + global error handler)
- [x] All 785 tests pass. Backend `f74d7e7`. All pushed.

### P1 — Scale & Polish
- [ ] Scale APIs 69→100 (curated, high quality)
- [x] Agent SDK JS/TS — @wintyx/x402-sdk v1.0.3 (auto-wallet AES-256-GCM, dual ESM+CJS, 55 tests) — DONE session 51
- [x] Ratings & Reviews marketplace — useReviews hook, ServiceDetail integration, ServiceCard stats — DONE session 51
- [x] Landing page hero refonte — DONE session 46
- [ ] A/B testing, analytics conversion

### P1.5 — Trails Bridge Integration (cross-chain onboarding) — FRONTEND DONE (session 60)
**Objectif:** Permettre aux devs de bridge USDC depuis n'importe quelle chain vers SKALE on Base en 1 clic.
**SDK:** `0xtrails@0.9.6` (Sequence, non-custodial, audite Quantstamp + Consensys)
**Workflow:** TrailsWidget mode="fund" → routes to Base USDC → IMA DepositBoxERC20 → SKALE (5-15 min)
**Demo repo:** `trails-skale-demo/` (Manuel Barbas, dev SKALE)

- [x] **Verifier support SKALE on Base** — confirme par Manuel Barbas (dev SKALE), demo repo fourni
- [x] **Frontend /fund page** — FundWallet.tsx: TrailsWidget + IMA bridge calldata + recipient input + success state + How it Works + FAQ + dark/light mode + i18n EN/FR (~60 cles)
- [x] **wagmi source chains** — mainnet, polygon, optimism, arbitrum ajoutes pour Trails routing
- [x] **Provider stack** — TrailsProvider entre QueryClientProvider et RainbowKitProvider
- [x] **Route + navigation** — lazy import /fund + lien dans Navbar Explore dropdown
- [x] **CSP** — sequence.app + trails.build domaines dans connect-src + frame-src
- [x] **Chunk splitting** — vendor-trails isole (2.5MB, gzip 660KB, lazy-loaded)
- [x] **Deps** — 0xtrails@0.9.6 + ethers + valtio (transitive deps)
- [ ] **Obtenir VITE_TRAILS_API_KEY** — contacter @build_with_trails sur Telegram
- [ ] **Configurer cle sur Vercel** — env var VITE_TRAILS_API_KEY
- [ ] **Test reel bridge** — 0.10 USDC depuis Base vers SKALE (apres deploy + API key)
- [ ] **MCP setup_wallet** — Ajouter instructions/lien /fund apres creation wallet
- [ ] **SDK helper** — `fundWallet()` dans @wintyx/x402-sdk
- [ ] **Landing page** — CTA "Works with any chain" + lien /fund

**Constantes IMA Bridge:**
- `DEPOSIT_BOX_ERC20 = 0x7f54e52D08C911eAbB4fDF00Ad36ccf07F867F61` (IMA sur Base)
- `SKALE_CHAIN_NAME = 'winged-bubbly-grumium'`
- `USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Fonction: `depositERC20Direct(schainName, erc20OnMainnet, amount, receiver)`

### P2 — Growth (long terme)
- [ ] Multi-chain Arbitrum/Optimism
- [ ] Batch payments / Subscription tiers
- [ ] Provider outreach + first external provider
- [ ] Creator recruitment (target 50, 95% revenue share)

---

### P0.5 — Community Agent Dashboard V2 + Automation (session 27, 14/02/2026) — DONE
- [x] Dashboard V2: SPA 6 pages (Tableau de bord, Automatisation, Studio, Config, Historique, Journaux)
- [x] Automation Engine: scheduler (60s tick), auto-publish per platform, content queue (persistent), auto-retry (exponential backoff), webhook, real-time refresh (15s)
- [x] 15 API routes on dashboard server (port 3500)
- [x] Settings management with credential redaction (mergeSettings)
- [x] Commits: cede76c (V2 fix + cleanup), 85e377e (full automation engine)

### P0.6 — SKALE on Base (sessions 30, 46, 47) — COMPLETE
- [x] Migrated from SKALE Europa (2046399126) to SKALE on Base (1187947933) — session 46
- [x] ChainSelector component: toggle Base / SKALE on Base (useSwitchChain wagmi v2)
- [x] Backend verifies SKALE payments on-chain (payment.js + X-Payment-Chain: skale)
- [x] MCP v2.4.0: multi-chain (Base + SKALE), confirmations:2, legacy tx type, 10 tools (incl export_private_key)
- [x] Marketing fix: "zero gas"/"FREE" → "ultra-low gas"/"~$0.0007" across all files — session 47
- [x] Payment verification fix: server-side retry (4 attempts × 3s) for receipt + confirmations
- [x] **SKALE payment tested & confirmed on-chain** (joke API paid via SKALE) — session 47
- Gas: ~$0.0007/tx via CREDITS token (10 USDC = 40 CREDITS = ~10K transfers)
- Agent wallet needs CREDITS for gas (send from MetaMask on SKALE on Base network)

### P0.7 — Polygon Integration (session 66) — COMPLETE
- [x] **Backend payment support**: payment.js + mcp-server.mjs verify Polygon mainnet (chain ID 137) payments on-chain
- [x] **MCP multi-chain**: setup_wallet now covers Base + SKALE + Polygon; call_service supports X-Payment-Chain: polygon header
- [x] **Frontend ChainSelector**: 3-way toggle (Base / SKALE on Base / Polygon)
- [x] **ServiceDetail**: code snippets include Polygon chain option, USDC contract address for Polygon
- [x] **USDC on Polygon**: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (6 decimals, native mainnet token)
- [x] **Gas economics**: ~$0.001-0.005 per transaction (MATIC token, ultra-low cost like SKALE)
- [x] **Routing**: Polygon prioritized for Trails SDK bridge routing (mainnet, polygon, optimism, arbitrum in wagmi)
- [x] **Documentation**: All READMEs + marketing updated (Base / SKALE / Polygon tri-chain)
- Gas: ~$0.001-0.005/tx via MATIC token (gas efficient alternative to Base + SKALE)
- RPC: eth_mainnet-compatible, supports eth_sendRawTransaction
- Supported in: MCP v2.4.1, CLI v3.2.5, Backend payment.js, Frontend ChainSelector, SDK v1.0.3, n8n v1.4.0

### P0.7b — Polygon Facilitator Integration (Phase 2) — COMPLETE
- [x] **verifyViaFacilitator()** implemented in lib/payment.js: HTTP verification via `chain.facilitator` URL
- [x] **FeeSplitter recipient validation**: checks `result.to === feeSplitterContract` before accepting payment
- [x] **Feature flag**: `POLYGON_FACILITATOR_URL` + `POLYGON_FEE_SPLITTER_CONTRACT` env vars — absent = Phase 1 fallback
- [x] **402 response enriched**: exposes `facilitator` URL in `networks[]` entry when configured
- [x] **recipient field**: 402 response uses `feeSplitterContract` address instead of `WALLET_ADDRESS` for Polygon Phase 2
- [x] **28 facilitator tests** in `tests/facilitator.test.js`: base64, payment requirements, HTTP mocks, feature flag, backward compat
- [x] Deploy FeeSplitter contract on Polygon mainnet (`0x820d4b07D09e5E07598464E6E36cB12561e0Ba56`) + verified on PolygonScan
- [x] Configure `POLYGON_FACILITATOR_URL=https://x402.polygon.technology` on Render
- [x] Configure `POLYGON_FEE_SPLITTER_CONTRACT=0x820d4b07D09e5E07598464E6E36cB12561e0Ba56` on Render
- [x] Configure `FEE_SPLITTER_OPERATOR_KEY` on Render (calls distribute() after facilitator payment)
- [x] End-to-end test: agent pays via facilitator (EIP-3009 TransferWithAuthorization, $0 gas) — **CONFIRMED ON-CHAIN** (0 POL, 9 transfers, 0.315 USDC in FeeSplitter)
- [x] **PIP-82 gas sponsorship**: facilitator sponsors gas from $1M POL pool
- [x] MCP: EIP-3009 signing + facilitator /settle + X-Payment-Chain on initial request
- [x] CLI: handleFacilitatorPayment() for fee_splitter mode
- [x] SDK v1.1.0: sendViaFacilitator() + Polygon chain config + 74 tests
- [x] n8n: Polygon CHAINS config + decimals fix
- Note: Base and SKALE are unaffected — they always use Phase 1 (direct RPC verification)

### Session 34 — Bugfix prod + UI polish + Bazaar Discovery (26/02/2026)
- [x] Fix page blanche x402bazaar.org (WalletConnect projectId crash → fallback sans WC dans wagmi.ts)
- [x] CSP elargi (unsafe-eval, wasm-unsafe-eval, domaines web3)
- [x] Hero glow animation: opacite augmentee pour visibilite dark mode
- [x] Navbar: 10+ liens a plat → 3 menus deroulants (Marketplace, Providers, Developers)
- [x] Bazaar Discovery: @x402/extensions v2.5.0, 69 declareDiscoveryExtension() avec inputSchema + exemples I/O
- [x] payment.js: reponse 402 inclut extensions discovery
- [x] generateDiscoveryForService() pour services externes dynamiques
- [x] Discovery map sync: 69 keys = 69 wrapper endpoints (correspondance exacte verifiee)
- Commits: 9aca511, 6b2aadb, 7edfe9c, f7ee1d2, 890601d, 4d9dbb1

### Session 55 — 4 DX Improvements: Gatekeeper + Export Key + SKALE Info + Chain Prompt (10/03/2026)
- [x] **Parameter Gatekeeper**: validates required params BEFORE payment — 400 + `_payment_status: not_charged`. 3-level coverage: (1) `_inputSchemaMap` in bazaar-discovery.js (62 internal endpoints), (2) `required_parameters` JSONB column for external services (migration 008), (3) auto-detected from 402 response body via `extractInputSchema()` in service-verifier.js
- [x] **export_private_key**: new MCP tool with `confirm: "yes_i_understand_the_risks"` safety gate
- [x] **setup_wallet enriched**: SKALE balance, `skale_info` (CREDITS gas token, faucet link, funding instructions), `wallet_backup_info`
- [x] **call_service pre-payment validation** in MCP: fetches service details, validates params before payment
- [x] **Frontend "Use with AI"**: prompt enriched with chain choice + service ID + required params warning
- [x] **ServiceDetail**: shows both chains (Base + SKALE + Polygon), code snippets include X-Payment-Chain header + example query strings
- [x] **Register form**: new Required Parameters field (comma-separated), persisted as `{ required: [...] }` in DB
- [x] **Auto-detect params**: service-verifier.js parses 402 response body for inputSchema (4 patterns), auto-saved on registration
- [x] **enrichWithParams()**: server-side enrichment of service lists with required_parameters from discoveryMap
- [x] **SKALE Credits faucet link**: added to MCP setup_wallet response
- [x] **All 10 GitHub repos synced**: 4 READMEs fixed (SKALE Europa → SKALE on Base + Polygon), 1 description updated
- [x] MCP v2.4.0 (10 tools). Backend commits: `4330db7`→`ed44e65`→`e93d7a7`→`01826b0`. Frontend commits: `0908a87`→`9e379e5`→`9aaee22`. All pushed.

### Session 56 — Auto-Faucet CREDITS + InputSchemaMap Fixes (10/03/2026)
- [x] **InputSchemaMap audit**: fixed 3 mismatches — airquality (`city`→`lat,lon`), geocoding (`address`→`city`), headers (missing→added `url`)
- [x] **Auto-Faucet CREDITS**: `autoFundCredits()` in mcp-server.mjs — sends 0.01 CREDITS (~10 tx) to new wallets with 0 balance on `setup_wallet`. Faucet wallet `0x73FE2Cb37A60Eda8d7F0d73326B9f3770fDCA30a` funded with 15 CREDITS (~1499 drips). `FAUCET_PRIVATE_KEY` env var.
- [x] **setup_wallet restructured**: separate `chains: { base: {...}, skale: {...}, polygon: {...} }` blocks, `auto_faucet` result in output
- [x] **MetaMask mentions removed** from MCP (export_private_key description, console.error at wallet creation)
- [x] **Live tested**: 0.01 CREDITS sent to fresh wallet — SUCCESS. FAUCET_PRIVATE_KEY configured on Render.
- [x] Backend commits: `d4fd558` (inputSchemaMap), `355467e` (auto-faucet). All pushed.

### Session 57 — Faucet Server-Side Migration + SKALE Emphasis (10/03/2026)
- [x] **Faucet migre cote serveur**: `POST /api/faucet/claim` dans routes/health.js — rate limit 3/hr/IP, validation adresse, check balance CREDITS, envoi 0.01 CREDITS via viem. Plus besoin de `FAUCET_PRIVATE_KEY` cote client.
- [x] **MCP autoFundCredits() simplifie**: appel HTTP au backend (~15 lignes vs ~40 avant). Tous les utilisateurs MCP beneficient du faucet automatiquement.
- [x] **SKALE emphasis**: 5 outils MCP payes recommandent SKALE, setup_wallet priorise SKALE dans next_steps
- [x] **Live tested sur Render**: 4 scenarios OK (already_has_credits, funded+tx_hash, invalid_address, rate_limited)
- [x] Backend commit: `cf8dece`. MCP copie dans runtime dir. All pushed → auto-deploy Render.

### Session 60 — Trails SDK Bridge Integration (11/03/2026)
- [x] **Trails SDK integration**: `0xtrails@0.9.6` installed (+ ethers, valtio transitive deps)
- [x] **FundWallet.tsx**: new page /fund — TrailsWidget mode="fund", IMA DepositBoxERC20 bridge calldata, recipient input, success state, How it Works (3 steps), FAQ (4 questions), dark/light mode via useTheme(), full i18n EN/FR
- [x] **wagmi.ts**: added mainnet, polygon, optimism, arbitrum as source chains for Trails routing
- [x] **main.tsx**: TrailsProvider added between QueryClientProvider and RainbowKitProvider
- [x] **App.tsx**: lazy import + route /fund
- [x] **Navbar.tsx**: Fund Wallet link in Explore dropdown
- [x] **translations.ts**: ~60 i18n keys EN + FR (fund section + nav.fund)
- [x] **vercel.json**: CSP extended — sequence.app + trails.build in connect-src + frame-src
- [x] **vite.config.js**: vendor-trails chunk splitting (2.5MB, gzip 660KB, isolated)
- [x] **.env.example**: VITE_TRAILS_API_KEY added
- [x] **Build**: 0 errors, vendor-trails chunk isolated, lazy-loaded page
- [x] Frontend commit: `9aa435e`. All pushed.
- [ ] **Pending**: VITE_TRAILS_API_KEY on Vercel + real bridge test

*Derniere mise a jour: 13/03/2026 — Phase 1-3 COMPLETE + 74 APIs + 10 integrations + SKALE on Base WORKING + Polygon WORKING + ERC-8004 On-Chain Identity + Reputation (74 agents, session 65) + Trails Bridge /fund LIVE + Auto-Faucet SERVER-SIDE + Parameter Gatekeeper + Service Status Pipeline + MCP v2.4.1 (tri-chain Base/SKALE/Polygon) + SDK v1.0.3 (tri-chain) + n8n v1.4.0 (tri-chain) + Session 66*
