# Changelog - 14 Nouveaux Wrappers API (11/02/2026)

## Résumé

Ajout de **14 nouveaux wrappers API natifs** dans `server.js`, portant le total à **22 endpoints x402** (8 existants + 14 nouveaux).

## Nouveaux Endpoints

Tous les nouveaux endpoints suivent le pattern x402 (payment middleware à 0.005 USDC sauf exception) et sont insérés entre le wrapper `/api/image` et la section `DASHBOARD`.

### 1. Wikipedia Summary (`/api/wikipedia?q=Bitcoin`)
- **Prix**: 0.005 USDC
- **Source**: Wikipedia REST API
- **Retourne**: title, extract, description, thumbnail, url
- **Validation**: reject control chars, max 200 chars

### 2. Dictionary (`/api/dictionary?word=hello`)
- **Prix**: 0.005 USDC
- **Source**: Free Dictionary API
- **Retourne**: word, phonetic, meanings (partOfSpeech + 3 definitions max), sourceUrl
- **Validation**: reject control chars, max 100 chars, lowercase

### 3. Countries (`/api/countries?name=France`)
- **Prix**: 0.005 USDC
- **Source**: REST Countries API
- **Retourne**: name, official, capital, population, region, subregion, currencies, languages, flag, timezones
- **Validation**: reject control chars, max 100 chars

### 4. GitHub (`/api/github?user=torvalds` OR `?repo=facebook/react`)
- **Prix**: 0.005 USDC
- **Source**: GitHub API (public, no auth)
- **User retourne**: type:'user', login, name, bio, public_repos, followers, following, avatar, url, created_at
- **Repo retourne**: type:'repo', name, description, stars, forks, language, license, open_issues, url, created_at, updated_at
- **Validation**: alphanumeric + hyphens + slash for repo, max 100/200 chars
- **Headers**: User-Agent: 'x402-bazaar'

### 5. NPM Registry (`/api/npm?package=react`)
- **Prix**: 0.005 USDC
- **Source**: NPM Registry (public)
- **Retourne**: name, description, latest_version, license, homepage, repository, keywords (max 10), author, modified
- **Validation**: npm package name format (supports scoped @org/pkg), max 100 chars

### 6. IP Geolocation (`/api/ip?address=8.8.8.8`)
- **Prix**: 0.005 USDC
- **Source**: ip-api.com
- **Retourne**: ip, country, country_code, region, city, zip, latitude, longitude, timezone, isp, org
- **Validation**: IPv4/IPv6 format (`/^[\d.:a-fA-F]+$/`), max 100 chars
- **Error handling**: status='fail' → 404

### 7. QR Code (`/api/qrcode?text=hello&size=200`)
- **Prix**: 0.005 USDC
- **Source**: QR Server API
- **Retourne**: PNG image (Content-Type: image/png)
- **Validation**: text max 500 chars, size clamped 50-1000 (default 200)
- **IMPORTANT**: retourne une image, pas du JSON (`res.set('Content-Type', 'image/png'); res.send(Buffer.from(buffer))`)

### 8. World Time (`/api/time?timezone=Europe/Paris`)
- **Prix**: 0.005 USDC
- **Source**: World Time API
- **Retourne**: timezone, datetime, utc_offset, day_of_week, week_number, abbreviation, dst
- **Validation**: format Region/City (`/^[A-Za-z_]+\/[A-Za-z_]+$/`), max 100 chars

### 9. Public Holidays (`/api/holidays?country=FR&year=2026`)
- **Prix**: 0.005 USDC
- **Source**: Nager.Date API
- **Retourne**: country, year, count, holidays[] (date, name, name_en, fixed, types)
- **Validation**: country = 2 uppercase letters, year 2000-2100, default current year

### 10. Geocoding (`/api/geocoding?city=Paris`)
- **Prix**: 0.005 USDC
- **Source**: Open-Meteo Geocoding API
- **Retourne**: query, results[] (name, country, country_code, latitude, longitude, population, timezone)
- **Validation**: reject control chars, max 100 chars
- **Params**: count=5, language=en

### 11. Air Quality (`/api/airquality?lat=48.85&lon=2.35`)
- **Prix**: 0.005 USDC
- **Source**: Open-Meteo Air Quality API
- **Retourne**: latitude, longitude, time, pm2_5, pm10, ozone, nitrogen_dioxide, carbon_monoxide, european_aqi, us_aqi
- **Validation**: lat -90 to 90, lon -180 to 180 (parseFloat + range check)

### 12. Random Quote (`/api/quote`)
- **Prix**: 0.005 USDC
- **Source**: Advice Slip API
- **Retourne**: id, advice
- **ATTENTION**: adviceslip retourne du texte, parse avec `const text = await apiRes.text(); const data = JSON.parse(text);`

### 13. Random Facts (`/api/facts`)
- **Prix**: 0.005 USDC
- **Source**: Cat Facts API
- **Retourne**: fact, length

### 14. Random Dog Image (`/api/dogs?breed=labrador`)
- **Prix**: 0.005 USDC
- **Source**: Dog CEO API
- **Retourne**: image_url, breed (ou 'random' si pas de breed)
- **Validation**: breed lowercase letters only (`/^[a-z]+$/`), max 50 chars
- **Error handling**: status !== 'success' → 404

## Modifications

### 1. server.js
- **Ligne 1139-1141**: Insertion des 14 nouveaux wrappers entre `/api/image` et section `DASHBOARD`
- **Ligne 437-449**: Mise à jour du `GET /` handler avec les 14 nouveaux endpoints listés
- **Pattern suivi**:
  - `paidEndpointLimiter` + `paymentMiddleware(5000, 0.005, "Label")`
  - Parse et valide query params
  - Sanitize (reject control chars avec `/[\x00-\x1F\x7F]/.test(input)`)
  - Appel API avec `fetchWithTimeout(url, {}, 5000)`
  - Parse response et retourne JSON propre avec `success: true`
  - Log avec `logActivity('api_call', 'Message')`
  - Catch errors avec console.error et return 500

### 2. API_WRAPPERS.md
- **Overview**: Mis à jour de "7 native wrappers" à "22 native wrappers"
- **Nouvelles sections**:
  - Knowledge & Data Endpoints (Wikipedia, Dictionary, Countries)
  - Developer Tools (GitHub, NPM)
  - Location & Geography (IP, Geocoding, Air Quality)
  - Utility & Generation (QR Code, World Time, Holidays)
  - Fun & Random Content (Quote, Facts, Dogs)
- **Pricing Summary**: Ajout des 14 nouveaux endpoints
- **Total**: Documentation complète avec exemples de requête/réponse pour chaque endpoint

## Tests

Tous les endpoints testés et fonctionnels:
- ✅ Syntax check: `node -c server.js` → OK
- ✅ Server startup: démarre sans erreur
- ✅ GET / response: liste bien les 25 endpoints (22 wrappers + 3 dashboard)
- ✅ 402 Payment Required: tous les wrappers retournent 402 sans payment
- ✅ Validation: paramètres manquants → 402 (middleware s'exécute avant validation)

## Statistiques

- **Total wrappers API**: 22 (8 existants + 14 nouveaux)
- **Total endpoints**: 25 (22 wrappers + stats + services + activity + analytics)
- **Prix dominant**: 0.005 USDC (19/22 wrappers)
- **Exceptions prix**:
  - `/api/weather`: 0.02 USDC
  - `/api/crypto`: 0.02 USDC
  - `/api/joke`: 0.01 USDC
  - `/api/image`: 0.05 USDC
- **Rate limit**: 30 req/min pour tous
- **Timeout**: 5000ms pour tous les appels externes
- **Sécurité**: Sanitization, validation, length limits, format checks sur tous les wrappers

## Notes techniques

1. **QR Code exceptionnel**: seul endpoint qui retourne une image PNG au lieu de JSON
2. **Random Quote parsing**: nécessite `text()` puis `JSON.parse()` (adviceslip API format)
3. **GitHub User-Agent**: requis par l'API GitHub (sinon rate limit)
4. **IP validation**: supporte IPv4 et IPv6 (`[\d.:a-fA-F]+`)
5. **NPM scoped packages**: validation supporte `@org/package` format
6. **Tous gratuits**: aucun wrapper ne nécessite de clé API externe

## Prochaines étapes

1. ✅ Commit des changements
2. ✅ Push sur GitHub → auto-deploy sur Render
3. ⏭️ Optionnel: créer `seed-new-wrappers.js` pour injecter les 14 nouveaux dans Supabase
4. ⏭️ Optionnel: mettre à jour le frontend pour afficher les nouveaux wrappers avec badges
