# Tests x402 Bazaar

Suite de tests complète pour le backend x402 Bazaar en production.

## Tests e2e (End-to-End)

Fichier: `tests/e2e.test.js`

### Execution

```bash
npm run test:e2e
# ou
node --test tests/e2e.test.js
```

### Couverture

La suite de tests e2e couvre **10 catégories** avec **37 tests** au total:

#### 1. Health & Infrastructure (3 tests)
- ✓ GET /health - santé du serveur
- ✓ GET / - liste des endpoints
- ✓ Headers de sécurité (X-Content-Type-Options, HSTS, etc.)

#### 2. Services API publics (4 tests)
- ✓ GET /api/services - liste complète
- ✓ GET /api/services?search= - recherche
- ✓ GET /api/services?tag= - filtrage par tag
- ✓ Filtres multiples

#### 3. Endpoints gratuits (2 tests)
- ✓ GET /health
- ✓ GET /api/services

#### 4. Endpoints payants x402 (7 tests)
Tests des réponses 402 Payment Required sans paiement:
- ✓ GET /api/joke
- ✓ GET /api/search
- ✓ GET /api/weather
- ✓ GET /api/crypto
- ✓ GET /api/scrape
- ✓ GET /api/twitter
- ✓ GET /api/image

#### 5. Dashboard/Admin (5 tests)
Protection par X-Admin-Token header:
- ✓ GET /api/stats sans token → 401
- ✓ GET /api/stats avec token → 200
- ✓ GET /api/analytics sans token → 401
- ✓ GET /api/analytics avec token → 200
- ✓ GET /dashboard protection

#### 6. Register endpoint (3 tests)
- ✓ POST /register - paiement requis (1 USDC)
- ✓ Validation APRÈS paiement (pas avant)
- ✓ Gestion du rate limiting (429)

#### 7. Validation & Sécurité (4 tests)
- ✓ Content-type invalide
- ✓ Payload oversized (>10kb)
- ✓ SQL injection bloquée par Cloudflare (403)
- ✓ URL invalide (validation après paiement)

#### 8. Rate Limiting (1 test)
- ✓ 150 requêtes rapides - détection du rate limiting

#### 9. Edge Cases (7 tests)
- ✓ Recherche vide
- ✓ Filtres inexistants
- ✓ Paramètres manquants (validation après paiement)
- ✓ Endpoints inexistants (404)
- ✓ Méthodes HTTP incorrectes (405)

#### 10. CORS (1 test)
- ✓ Headers CORS présents

## Stratégie

### Approche "Pay-First"
Le backend x402 suit une stratégie **"pay-first"**: il demande le paiement AVANT de valider les paramètres. Cela signifie que:
- Les endpoints payants retournent toujours 402 même avec des params invalides
- La validation détaillée se fait APRÈS réception du paiement
- Cela protège contre les attaques par fuzzing/enumeration

### Sécurité multi-couches
1. **Cloudflare** - Bloque SQL injection et attaques DDoS (403)
2. **Rate Limiting** - 3 tiers (general, paid, register)
3. **Body Limit** - 10kb maximum
4. **Headers de sécurité** - Helmet (HSTS, X-Frame-Options, etc.)
5. **Validation stricte** - Après paiement

### Edge Cases identifiés

**Cas testés:**
- Paramètres manquants → 402 (payment d'abord)
- SQL injection → 403 (Cloudflare)
- URL javascript: → 402 (validation après paiement)
- Payload >10kb → 413 ou 402
- Content-type invalide → 402
- Rate limiting → 429

**Comportements confirmés:**
- Tous les wrappers natifs coûtent maintenant (même /api/joke = 0.01 USDC)
- /register coûte 1 USDC (pas 0.10)
- Les filtres tag/chain retournent parfois tous les services (à améliorer backend)
- Cloudflare WAF bloque automatiquement les patterns SQL injection

## Configuration

Tests exécutés contre:
- **Backend URL**: https://x402-api.onrender.com
- **Network**: Base mainnet
- **Admin Token**: Défini dans le fichier de test (à sécuriser en prod)
- **Timeout**: 30s par test (pour cold starts Render)

## Améliorations futures

- [ ] Tester avec de vrais paiements USDC (testnet)
- [ ] Vérifier la réponse après paiement valide
- [ ] Tester le replay protection (même tx_hash utilisé 2x)
- [ ] Mesurer la latence des cold starts Render
- [ ] Tests de charge (stress test)
- [ ] Monitoring des erreurs 5xx

## Notes techniques

- **Framework**: `node:test` natif (Node 18+)
- **Assertions**: `node:assert/strict`
- **Zero dépendances externes** (pas de Jest/Mocha/Vitest)
- **Fetch natif** (Node 18+)
- **Timeouts adaptatifs** pour cold starts
- **Pas de vrais paiements** dans les tests

---

**Dernière mise à jour**: 2026-02-12
**Statut**: ✅ Tous les tests passent (37/37)
