// tests/helpers.js — Shared test utilities
// Centralise les helpers dupliqués dans plusieurs fichiers de tests.
// Pattern: helper pur, sans dépendances externes, réutilisable partout.
'use strict';

/**
 * Génère un hash de transaction valide (0x + 64 chars hex).
 * @param {string} char - Caractère hex de remplissage (défaut: 'a')
 */
function makeHash(char = 'a') {
    return '0x' + char.repeat(64);
}

/**
 * Génère une adresse Ethereum valide (0x + 40 chars hex).
 * @param {string} suffix - Caractère ou suffixe de remplissage (défaut: 'a')
 */
function makeWallet(suffix = 'a') {
    return '0x' + suffix.padStart(40, '0');
}

/**
 * Retourne un UUID v4 fixe et valide pour les tests.
 */
function makeUUID() {
    return 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
}

/**
 * Crée un objet Express res() minimal compatible avec les handlers.
 * Chaînable : status().json(), set(), send()
 */
function mockRes() {
    const res = {
        _status: 200,
        _body: null,
        _headers: {},
    };
    res.status = (s) => { res._status = s; return res; };
    res.json   = (b) => { res._body = b; return res; };
    res.set    = (k, v) => { res._headers[k] = v; return res; };
    res.send   = (b) => { res._body = b; return res; };
    res.setHeader = (k, v) => { res._headers[k] = v; return res; };
    return res;
}

/**
 * Crée un objet Express req() minimal.
 * @param {object} overrides - Propriétés à fusionner (body, headers, params, query)
 */
function mockReq(overrides = {}) {
    return {
        body: {},
        headers: {},
        params: {},
        query: {},
        path: '/',
        method: 'GET',
        ...overrides,
    };
}

module.exports = { makeHash, makeWallet, makeUUID, mockRes, mockReq };
