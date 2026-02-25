// routes/wrappers/validation.js — Validation & parsing API wrappers
// validate-email, phone-validate, url-parse, json-validate, jwt-decode, password-strength, regex

const express = require('express');
const logger = require('../../lib/logger');

function createValidationRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- EMAIL VALIDATION API WRAPPER (0.003 USDC) ---
    router.get('/api/validate-email', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "Email Validation API"), async (req, res) => {
        const email = (req.query.email || '').trim().toLowerCase().slice(0, 320);

        if (!email) {
            return res.status(400).json({ error: "Parameter 'email' required. Ex: /api/validate-email?email=test@example.com" });
        }

        // Email format validation (RFC 5322 simplified)
        const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        const formatValid = emailRegex.test(email);

        if (!formatValid) {
            logActivity('api_call', `Email Validation API: ${email} (invalid format)`);
            return res.json({
                success: true,
                email,
                valid: false,
                format: false,
                mxRecords: false,
                domain: null
            });
        }

        // Extract domain
        const domain = email.split('@')[1];

        // DNS MX lookup
        let mxValid = false;
        try {
            const dnsPromises = require('dns/promises');
            const mxRecords = await dnsPromises.resolveMx(domain);
            mxValid = mxRecords && mxRecords.length > 0;
        } catch (err) {
            // MX lookup failed — expected for domains without mail servers
            logger.warn('EmailValidation', `MX lookup failed for ${domain}: ${err.message}`);
        }

        const isValid = formatValid && mxValid;

        logActivity('api_call', `Email Validation API: ${email} (${isValid ? 'valid' : 'invalid'})`);

        res.json({
            success: true,
            email,
            valid: isValid,
            format: formatValid,
            mxRecords: mxValid,
            domain
        });
    });

    // --- PHONE VALIDATE API (0.001 USDC) ---
    router.get('/api/phone-validate', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Phone Validate API"), async (req, res) => {
        const phone = (req.query.phone || req.query.number || '').trim().slice(0, 30);

        if (!phone) {
            return res.status(400).json({ error: "Parameter 'phone' required. Ex: /api/phone-validate?phone=+33612345678" });
        }

        // Strip all non-digit chars except leading +
        const cleaned = phone.replace(/(?!^\+)\D/g, '');
        const digits = cleaned.replace('+', '');

        // Country code detection (common codes)
        const countryCodes = {
            '1': { country: 'US/CA', format: '+1 (XXX) XXX-XXXX', len: [10] },
            '33': { country: 'FR', format: '+33 X XX XX XX XX', len: [9] },
            '44': { country: 'GB', format: '+44 XXXX XXXXXX', len: [10] },
            '49': { country: 'DE', format: '+49 XXX XXXXXXXX', len: [10, 11] },
            '81': { country: 'JP', format: '+81 XX XXXX XXXX', len: [10] },
            '86': { country: 'CN', format: '+86 XXX XXXX XXXX', len: [11] },
            '91': { country: 'IN', format: '+91 XXXXX XXXXX', len: [10] },
            '55': { country: 'BR', format: '+55 XX XXXXX XXXX', len: [10, 11] },
            '7': { country: 'RU', format: '+7 XXX XXX XX XX', len: [10] },
            '39': { country: 'IT', format: '+39 XXX XXX XXXX', len: [9, 10] },
            '34': { country: 'ES', format: '+34 XXX XXX XXX', len: [9] },
            '61': { country: 'AU', format: '+61 XXX XXX XXX', len: [9] }
        };

        let detectedCountry = null;
        let expectedFormat = null;
        const hasPlus = phone.startsWith('+');

        if (hasPlus) {
            for (const [code, info] of Object.entries(countryCodes).sort((a, b) => b[0].length - a[0].length)) {
                if (digits.startsWith(code)) {
                    const national = digits.slice(code.length);
                    if (info.len.includes(national.length)) {
                        detectedCountry = info.country;
                        expectedFormat = info.format;
                    }
                    break;
                }
            }
        }

        const valid = digits.length >= 7 && digits.length <= 15 && /^\d+$/.test(digits);

        logActivity('api_call', `Phone Validate API: ${detectedCountry || 'unknown'}`);
        res.json({
            success: true,
            input: phone,
            cleaned: hasPlus ? `+${digits}` : digits,
            digits_only: digits,
            digit_count: digits.length,
            valid,
            has_country_code: hasPlus,
            country: detectedCountry,
            expected_format: expectedFormat,
            type: digits.length <= 8 ? 'landline' : 'mobile'
        });
    });

    // --- URL PARSE API (0.001 USDC) ---
    router.get('/api/url-parse', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "URL Parse API"), async (req, res) => {
        const input = (req.query.url || '').trim().slice(0, 2000);

        if (!input) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/url-parse?url=https://example.com:8080/path?q=test#section" });
        }

        try {
            const parsed = new URL(input);
            const params = {};
            parsed.searchParams.forEach((v, k) => { params[k] = v; });

            logActivity('api_call', `URL Parse API: ${parsed.hostname}`);
            res.json({
                success: true,
                url: input,
                protocol: parsed.protocol.replace(':', ''),
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
                pathname: parsed.pathname,
                search: parsed.search,
                hash: parsed.hash,
                origin: parsed.origin,
                params,
                param_count: Object.keys(params).length,
                is_https: parsed.protocol === 'https:'
            });
        } catch (err) {
            return res.status(400).json({ error: 'Invalid URL', details: err.message });
        }
    });

    // --- JSON VALIDATOR API (0.001 USDC) ---
    function handleJsonValidate(req, res) {
        // Support both GET (?json=...) and POST ({json: ...})
        let input;
        if (req.method === 'GET') {
            input = req.query.json !== undefined ? req.query.json : null;
        } else {
            input = req.body && req.body.json !== undefined ? req.body.json : null;
        }

        if (input === null) {
            return res.status(400).json({ error: "Parameter 'json' required. GET: /api/json-validate?json={...} or POST with {\"json\": \"...\"}" });
        }

        const raw = typeof input === 'string' ? input : JSON.stringify(input);

        if (raw.length > 100000) {
            return res.status(400).json({ error: 'Input too large (max 100KB)' });
        }

        let valid = true;
        let parsed = null;
        let errorMsg = null;

        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            valid = false;
            errorMsg = err.message;
        }

        logActivity('api_call', `JSON Validator API: ${valid ? 'valid' : 'invalid'} (${raw.length} chars)`);

        const result = { success: true, valid, input_length: raw.length };
        if (valid) {
            result.formatted = JSON.stringify(parsed, null, 2);
            result.type = Array.isArray(parsed) ? 'array' : typeof parsed;
            if (typeof parsed === 'object' && parsed !== null) {
                result.keys_count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
            }
        } else {
            result.error_message = errorMsg;
        }
        res.json(result);
    }

    router.get('/api/json-validate', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "JSON Validator API"), handleJsonValidate);
    router.post('/api/json-validate', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "JSON Validator API"), handleJsonValidate);

    // --- JWT DECODE API (0.001 USDC) ---
    router.get('/api/jwt-decode', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "JWT Decode API"), async (req, res) => {
        const token = (req.query.token || '').trim().slice(0, 10000);

        if (!token) {
            return res.status(400).json({ error: "Parameter 'token' required. Ex: /api/jwt-decode?token=eyJhbGciOiJIUzI1NiIs..." });
        }

        const parts = token.split('.');
        if (parts.length !== 3) {
            return res.status(400).json({ error: 'Invalid JWT format (expected 3 parts separated by dots)' });
        }

        try {
            const decodeBase64Url = (str) => {
                const padded = str.replace(/-/g, '+').replace(/_/g, '/');
                return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
            };

            const header = decodeBase64Url(parts[0]);
            const payload = decodeBase64Url(parts[1]);

            const now = Math.floor(Date.now() / 1000);
            let expired = null;
            let expires_in = null;
            if (payload.exp) {
                expired = now > payload.exp;
                expires_in = payload.exp - now;
            }

            logActivity('api_call', `JWT Decode API: alg=${header.alg}`);
            res.json({
                success: true,
                header,
                payload,
                expired,
                expires_in_seconds: expires_in,
                issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
                expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
                note: 'Signature NOT verified (decode only, no secret key)'
            });
        } catch (err) {
            return res.status(400).json({ error: 'Failed to decode JWT', details: err.message });
        }
    });

    // --- PASSWORD STRENGTH API (0.001 USDC) ---
    router.get('/api/password-strength', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Password Strength API"), async (req, res) => {
        const password = (req.query.password || req.query.pw || '').slice(0, 200);

        if (!password) {
            return res.status(400).json({ error: "Parameter 'password' required. Ex: /api/password-strength?password=MyP@ssw0rd!" });
        }

        const checks = {
            length: password.length,
            has_lowercase: /[a-z]/.test(password),
            has_uppercase: /[A-Z]/.test(password),
            has_digits: /\d/.test(password),
            has_special: /[^a-zA-Z0-9]/.test(password),
            has_spaces: /\s/.test(password),
            is_common: ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome', 'monkey', 'dragon',
                '12345678', 'abc123', 'password1', 'iloveyou', 'trustno1', 'sunshine', 'princess',
                'football', 'charlie', 'shadow', 'master', '1234567890'].includes(password.toLowerCase())
        };

        // Score calculation (0-100)
        let score = 0;
        if (checks.length >= 8) score += 20;
        if (checks.length >= 12) score += 10;
        if (checks.length >= 16) score += 10;
        if (checks.has_lowercase) score += 10;
        if (checks.has_uppercase) score += 10;
        if (checks.has_digits) score += 10;
        if (checks.has_special) score += 15;
        if (!checks.is_common) score += 15;

        // Entropy estimation (bits)
        let charsetSize = 0;
        if (checks.has_lowercase) charsetSize += 26;
        if (checks.has_uppercase) charsetSize += 26;
        if (checks.has_digits) charsetSize += 10;
        if (checks.has_special) charsetSize += 32;
        const entropy = charsetSize > 0 ? +(checks.length * Math.log2(charsetSize)).toFixed(1) : 0;

        let strength;
        if (checks.is_common || score < 30) strength = 'very_weak';
        else if (score < 50) strength = 'weak';
        else if (score < 70) strength = 'fair';
        else if (score < 90) strength = 'strong';
        else strength = 'very_strong';

        const suggestions = [];
        if (checks.length < 12) suggestions.push('Use at least 12 characters');
        if (!checks.has_uppercase) suggestions.push('Add uppercase letters');
        if (!checks.has_digits) suggestions.push('Add numbers');
        if (!checks.has_special) suggestions.push('Add special characters (!@#$%...)');
        if (checks.is_common) suggestions.push('Avoid common passwords');

        logActivity('api_call', `Password Strength API: strength=${strength}`);
        res.json({ success: true, strength, score, entropy_bits: entropy, checks, suggestions });
    });

    // --- REGEX TESTER API (0.001 USDC) ---
    // ReDoS protection: reject patterns > 100 chars or containing catastrophic backtracking structures
    const REDOS_PATTERN = /(\(.+\+\))\+|(\(.+\*\))\*/;
    router.get('/api/regex', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Regex Tester API"), async (req, res) => {
        const pattern = (req.query.pattern || '').slice(0, 500);
        const text = (req.query.text || '').slice(0, 5000);
        const flags = (req.query.flags || 'g').slice(0, 10);

        if (!pattern || !text) {
            return res.status(400).json({ error: "Parameters 'pattern' and 'text' required. Ex: /api/regex?pattern=\\d+&text=abc123def456&flags=g" });
        }

        // ReDoS guard — reject before instantiating RegExp
        if (pattern.length > 100) {
            return res.status(400).json({ error: 'Pattern too long (max 100 characters)' });
        }
        if (REDOS_PATTERN.test(pattern)) {
            logger.warn('Regex', `Rejected potentially catastrophic pattern: ${pattern.slice(0, 50)}`);
            return res.status(400).json({ error: 'Pattern rejected: contains potentially catastrophic backtracking structure' });
        }

        try {
            // Validate flags
            if (!/^[gimsuy]*$/.test(flags)) {
                return res.status(400).json({ error: 'Invalid flags. Allowed: g, i, m, s, u, y' });
            }
            const regex = new RegExp(pattern, flags);
            const matches = [];
            let m;
            let safety = 0;
            if (flags.includes('g')) {
                while ((m = regex.exec(text)) !== null && safety < 100) {
                    matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
                    safety++;
                    if (m.index === regex.lastIndex) regex.lastIndex++;
                }
            } else {
                m = regex.exec(text);
                if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
            }

            logActivity('api_call', `Regex Tester API: /${pattern}/${flags} -> ${matches.length} matches`);
            res.json({ success: true, pattern, flags, text_length: text.length, match_count: matches.length, matches });
        } catch (err) {
            return res.status(400).json({ error: 'Invalid regex pattern', details: err.message });
        }
    });

    return router;
}

module.exports = createValidationRouter;
