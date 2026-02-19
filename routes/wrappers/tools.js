// routes/wrappers/tools.js — Developer tools API wrappers
// hash, qrcode-gen, password, color, cron-parse, http-status, unit-convert, url-shorten, ssl-check, whois, dns

const express = require('express');
const logger = require('../../lib/logger');
const { fetchWithTimeout } = require('../../lib/payment');

function createToolsRouter(logActivity, paymentMiddleware, paidEndpointLimiter, getOpenAI) {
    const router = express.Router();

    // --- HASH GENERATOR API (0.001 USDC) ---
    router.get('/api/hash', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Hash Generator API"), async (req, res) => {
        const text = (req.query.text || '').trim();
        const algo = (req.query.algo || 'sha256').trim().toLowerCase();

        if (!text) {
            return res.status(400).json({ error: "Parameter 'text' required. Ex: /api/hash?text=hello&algo=sha256" });
        }
        if (text.length > 10000) {
            return res.status(400).json({ error: 'Text too long (max 10000 characters)' });
        }

        const validAlgos = ['md5', 'sha1', 'sha256', 'sha512'];
        if (!validAlgos.includes(algo)) {
            return res.status(400).json({ error: `Invalid algorithm. Accepted: ${validAlgos.join(', ')}` });
        }

        const crypto = require('crypto');
        const hash = crypto.createHash(algo).update(text).digest('hex');

        logActivity('api_call', `Hash Generator API: ${algo} (${text.slice(0, 30)}...)`);

        res.json({ success: true, hash, algorithm: algo, input_length: text.length });
    });

    // --- QR CODE GENERATOR API WRAPPER (0.003 USDC) ---
    router.get('/api/qrcode-gen', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "QR Code Generator API"), async (req, res) => {
        const data = (req.query.data || '').trim().slice(0, 2000);
        let size = parseInt(req.query.size) || 300;

        if (!data) {
            return res.status(400).json({ error: "Parameter 'data' required. Ex: /api/qrcode-gen?data=https://example.com&size=300" });
        }

        size = Math.max(50, Math.min(1000, size));

        try {
            const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png`;

            logActivity('api_call', `QR Code Generator API: ${data.slice(0, 50)}... (${size}px)`);

            // Return JSON with the image URL instead of returning the image directly
            res.json({
                success: true,
                imageUrl: apiUrl,
                data: data,
                size: size
            });
        } catch (err) {
            logger.error('QR Code Generator API', err.message);
            return res.status(500).json({ error: 'QR Code Generator API request failed' });
        }
    });

    // --- PASSWORD GENERATOR API (0.001 USDC) ---
    router.get('/api/password', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Password Generator API"), async (req, res) => {
        let length = parseInt(req.query.length) || 16;
        length = Math.max(8, Math.min(128, length));
        const includeSymbols = req.query.symbols !== 'false';
        const includeNumbers = req.query.numbers !== 'false';
        const includeUppercase = req.query.uppercase !== 'false';

        let chars = 'abcdefghijklmnopqrstuvwxyz';
        if (includeUppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (includeNumbers) chars += '0123456789';
        if (includeSymbols) chars += '!@#$%^&*()-_=+[]{}|;:,.<>?';

        const crypto = require('crypto');
        const bytes = crypto.randomBytes(length);
        let password = '';
        for (let i = 0; i < length; i++) {
            password += chars[bytes[i] % chars.length];
        }

        logActivity('api_call', `Password Generator API: ${length} chars`);

        res.json({ success: true, password, length, options: { symbols: includeSymbols, numbers: includeNumbers, uppercase: includeUppercase } });
    });

    // --- COLOR CONVERTER API (0.001 USDC) ---
    router.get('/api/color', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Color Converter API"), async (req, res) => {
        const hex = (req.query.hex || '').trim().replace(/^#/, '');
        const rgb = (req.query.rgb || '').trim();

        if (!hex && !rgb) {
            return res.status(400).json({ error: "Parameter 'hex' or 'rgb' required. Ex: /api/color?hex=ff5733 or /api/color?rgb=255,87,51" });
        }

        let r, g, b;

        if (hex) {
            if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
                return res.status(400).json({ error: 'Invalid hex color (use 6 hex digits, e.g., ff5733)' });
            }
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        } else {
            const parts = rgb.split(',').map(s => parseInt(s.trim()));
            if (parts.length !== 3 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
                return res.status(400).json({ error: 'Invalid RGB (use 3 values 0-255, e.g., 255,87,51)' });
            }
            [r, g, b] = parts;
        }

        // Convert to HSL
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
            else if (max === gn) h = ((bn - rn) / d + 2) / 6;
            else h = ((rn - gn) / d + 4) / 6;
        }

        logActivity('api_call', `Color Converter API: #${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);

        res.json({
            success: true,
            hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
            rgb: { r, g, b },
            hsl: { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) },
            css_rgb: `rgb(${r}, ${g}, ${b})`,
            css_hsl: `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
        });
    });

    // --- CRON EXPRESSION PARSER API (0.001 USDC) ---
    router.get('/api/cron-parse', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Cron Parser API"), async (req, res) => {
        const expr = (req.query.expr || req.query.expression || '').trim().slice(0, 200);

        if (!expr) {
            return res.status(400).json({ error: "Parameter 'expr' required. Ex: /api/cron-parse?expr=0 9 * * 1-5" });
        }

        const parts = expr.split(/\s+/);
        if (parts.length < 5 || parts.length > 6) {
            return res.status(400).json({ error: 'Invalid cron expression. Expected 5 fields: minute hour day month weekday (optional: second)' });
        }

        const fieldNames = parts.length === 6
            ? ['second', 'minute', 'hour', 'day_of_month', 'month', 'day_of_week']
            : ['minute', 'hour', 'day_of_month', 'month', 'day_of_week'];

        const descriptions = {
            minute: { range: '0-59', special: ', - * /' },
            hour: { range: '0-23', special: ', - * /' },
            day_of_month: { range: '1-31', special: ', - * / ?' },
            month: { range: '1-12 or JAN-DEC', special: ', - * /' },
            day_of_week: { range: '0-7 or SUN-SAT (0=7=Sunday)', special: ', - * / ?' },
            second: { range: '0-59', special: ', - * /' }
        };

        const fields = {};
        fieldNames.forEach((name, i) => {
            fields[name] = { value: parts[parts.length === 6 ? i : i], ...descriptions[name] };
        });

        // Human-readable description
        const min = fields.minute?.value || parts[0];
        const hour = fields.hour?.value || parts[1];
        let description = '';
        if (min === '0' && hour === '0') description = 'At midnight every day';
        else if (min === '0' && hour !== '*') description = `At ${hour}:00`;
        else if (min !== '*' && hour !== '*') description = `At ${hour}:${min.padStart(2, '0')}`;
        else if (min === '*' && hour === '*') description = 'Every minute';
        else if (min.startsWith('*/')) description = `Every ${min.slice(2)} minutes`;
        else description = `Cron: ${expr}`;

        const dow = fields.day_of_week?.value || parts[parts.length === 6 ? 5 : 4];
        if (dow === '1-5') description += ' (weekdays only)';
        else if (dow === '0,6' || dow === '6,0') description += ' (weekends only)';

        logActivity('api_call', `Cron Parser API: ${expr}`);
        res.json({ success: true, expression: expr, fields, description, field_count: parts.length });
    });

    // --- HTTP STATUS CODE API (0.001 USDC) ---
    router.get('/api/http-status', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "HTTP Status API"), async (req, res) => {
        const code = parseInt(req.query.code || '');

        if (!code || code < 100 || code > 599) {
            return res.status(400).json({ error: "Parameter 'code' required (100-599). Ex: /api/http-status?code=404" });
        }

        const statuses = {
            100: { name: 'Continue', description: 'The server has received the request headers and the client should proceed to send the request body.', category: 'Informational' },
            101: { name: 'Switching Protocols', description: 'The server is switching protocols as requested by the client.', category: 'Informational' },
            200: { name: 'OK', description: 'The request was successful.', category: 'Success' },
            201: { name: 'Created', description: 'The request was successful and a new resource was created.', category: 'Success' },
            204: { name: 'No Content', description: 'The request was successful but there is no content to return.', category: 'Success' },
            301: { name: 'Moved Permanently', description: 'The resource has been permanently moved to a new URL.', category: 'Redirection' },
            302: { name: 'Found', description: 'The resource has been temporarily moved to a different URL.', category: 'Redirection' },
            304: { name: 'Not Modified', description: 'The resource has not been modified since the last request.', category: 'Redirection' },
            307: { name: 'Temporary Redirect', description: 'The resource has been temporarily moved. The client should use the same HTTP method.', category: 'Redirection' },
            308: { name: 'Permanent Redirect', description: 'The resource has been permanently moved. The client should use the same HTTP method.', category: 'Redirection' },
            400: { name: 'Bad Request', description: 'The server could not understand the request due to invalid syntax.', category: 'Client Error' },
            401: { name: 'Unauthorized', description: 'Authentication is required and has failed or not been provided.', category: 'Client Error' },
            402: { name: 'Payment Required', description: 'Payment is required to access this resource. Used by x402 protocol for machine-to-machine payments.', category: 'Client Error' },
            403: { name: 'Forbidden', description: 'The server understood the request but refuses to authorize it.', category: 'Client Error' },
            404: { name: 'Not Found', description: 'The requested resource could not be found on the server.', category: 'Client Error' },
            405: { name: 'Method Not Allowed', description: 'The HTTP method used is not allowed for this resource.', category: 'Client Error' },
            408: { name: 'Request Timeout', description: 'The server timed out waiting for the request.', category: 'Client Error' },
            409: { name: 'Conflict', description: 'The request conflicts with the current state of the resource.', category: 'Client Error' },
            410: { name: 'Gone', description: 'The resource is no longer available and will not be available again.', category: 'Client Error' },
            413: { name: 'Payload Too Large', description: 'The request body is larger than the server is willing to process.', category: 'Client Error' },
            418: { name: "I'm a Teapot", description: 'The server refuses to brew coffee because it is a teapot (RFC 2324).', category: 'Client Error' },
            422: { name: 'Unprocessable Entity', description: 'The request was well-formed but could not be followed due to semantic errors.', category: 'Client Error' },
            429: { name: 'Too Many Requests', description: 'The user has sent too many requests in a given amount of time (rate limiting).', category: 'Client Error' },
            500: { name: 'Internal Server Error', description: 'The server encountered an unexpected condition that prevented it from fulfilling the request.', category: 'Server Error' },
            501: { name: 'Not Implemented', description: 'The server does not support the functionality required to fulfill the request.', category: 'Server Error' },
            502: { name: 'Bad Gateway', description: 'The server received an invalid response from an upstream server.', category: 'Server Error' },
            503: { name: 'Service Unavailable', description: 'The server is currently unable to handle the request (overloaded or down for maintenance).', category: 'Server Error' },
            504: { name: 'Gateway Timeout', description: 'The server did not receive a timely response from an upstream server.', category: 'Server Error' }
        };

        const info = statuses[code];
        if (!info) {
            // Generic category
            let category;
            if (code < 200) category = 'Informational';
            else if (code < 300) category = 'Success';
            else if (code < 400) category = 'Redirection';
            else if (code < 500) category = 'Client Error';
            else category = 'Server Error';

            logActivity('api_call', `HTTP Status API: ${code} (unknown)`);
            return res.json({ success: true, code, name: 'Unknown', description: 'Non-standard or uncommon HTTP status code.', category });
        }

        logActivity('api_call', `HTTP Status API: ${code} ${info.name}`);
        res.json({ success: true, code, ...info });
    });

    // --- UNIT CONVERTER API (0.001 USDC) ---
    router.get('/api/unit-convert', paidEndpointLimiter, paymentMiddleware(1000, 0.001, "Unit Converter API"), async (req, res) => {
        const value = parseFloat(req.query.value);
        const from = (req.query.from || '').trim().toLowerCase();
        const to = (req.query.to || '').trim().toLowerCase();

        if (isNaN(value) || !from || !to) {
            return res.status(400).json({ error: "Parameters 'value', 'from', 'to' required. Ex: /api/unit-convert?value=100&from=km&to=miles" });
        }

        // Conversion factors to base unit per category
        const conversions = {
            // Length (base: meters)
            km: { base: 'm', factor: 1000 }, m: { base: 'm', factor: 1 }, cm: { base: 'm', factor: 0.01 },
            mm: { base: 'm', factor: 0.001 }, miles: { base: 'm', factor: 1609.344 }, mi: { base: 'm', factor: 1609.344 },
            yards: { base: 'm', factor: 0.9144 }, yd: { base: 'm', factor: 0.9144 },
            feet: { base: 'm', factor: 0.3048 }, ft: { base: 'm', factor: 0.3048 },
            inches: { base: 'm', factor: 0.0254 }, in: { base: 'm', factor: 0.0254 },
            nm: { base: 'm', factor: 1852 },
            // Weight (base: kg)
            kg: { base: 'kg', factor: 1 }, g: { base: 'kg', factor: 0.001 }, mg: { base: 'kg', factor: 0.000001 },
            lb: { base: 'kg', factor: 0.453592 }, lbs: { base: 'kg', factor: 0.453592 },
            oz: { base: 'kg', factor: 0.0283495 }, ton: { base: 'kg', factor: 1000 },
            // Temperature (special handling below)
            c: { base: 'temp', factor: 0 }, f: { base: 'temp', factor: 0 }, k: { base: 'temp', factor: 0 },
            celsius: { base: 'temp', factor: 0 }, fahrenheit: { base: 'temp', factor: 0 }, kelvin: { base: 'temp', factor: 0 },
            // Volume (base: liters)
            l: { base: 'l', factor: 1 }, ml: { base: 'l', factor: 0.001 },
            gal: { base: 'l', factor: 3.78541 }, gallon: { base: 'l', factor: 3.78541 },
            qt: { base: 'l', factor: 0.946353 }, pt: { base: 'l', factor: 0.473176 },
            cup: { base: 'l', factor: 0.236588 }, floz: { base: 'l', factor: 0.0295735 },
            // Speed (base: m/s)
            'km/h': { base: 'speed', factor: 0.277778 }, 'mph': { base: 'speed', factor: 0.44704 },
            'm/s': { base: 'speed', factor: 1 }, knots: { base: 'speed', factor: 0.514444 },
            // Data (base: bytes)
            b: { base: 'data', factor: 1 }, kb: { base: 'data', factor: 1024 },
            mb: { base: 'data', factor: 1048576 }, gb: { base: 'data', factor: 1073741824 },
            tb: { base: 'data', factor: 1099511627776 }
        };

        const fromUnit = conversions[from];
        const toUnit = conversions[to];

        if (!fromUnit || !toUnit) {
            const supported = Object.keys(conversions).join(', ');
            return res.status(400).json({ error: `Unknown unit. Supported: ${supported}` });
        }

        if (fromUnit.base !== toUnit.base) {
            return res.status(400).json({ error: `Cannot convert between different unit types (${from} -> ${to})` });
        }

        let result;
        const fromNorm = from.replace('celsius', 'c').replace('fahrenheit', 'f').replace('kelvin', 'k');
        const toNorm = to.replace('celsius', 'c').replace('fahrenheit', 'f').replace('kelvin', 'k');

        if (fromUnit.base === 'temp') {
            // Temperature special conversion
            let celsius;
            if (fromNorm === 'c') celsius = value;
            else if (fromNorm === 'f') celsius = (value - 32) * 5 / 9;
            else if (fromNorm === 'k') celsius = value - 273.15;
            else return res.status(400).json({ error: 'Invalid temperature unit' });

            if (toNorm === 'c') result = celsius;
            else if (toNorm === 'f') result = celsius * 9 / 5 + 32;
            else if (toNorm === 'k') result = celsius + 273.15;
            else return res.status(400).json({ error: 'Invalid temperature unit' });
        } else {
            // Standard conversion: value * fromFactor / toFactor
            result = value * fromUnit.factor / toUnit.factor;
        }

        logActivity('api_call', `Unit Converter API: ${value} ${from} -> ${result} ${to}`);
        res.json({ success: true, value, from, to, result: +result.toFixed(10), formula: `${value} ${from} = ${+result.toFixed(10)} ${to}` });
    });

    // --- URL SHORTENER API (0.003 USDC) ---
    router.get('/api/url-shorten', paidEndpointLimiter, paymentMiddleware(5000, 0.003, "URL Shortener API"), async (req, res) => {
        const url = (req.query.url || '').trim().slice(0, 2000);

        if (!url) {
            return res.status(400).json({ error: "Parameter 'url' required. Ex: /api/url-shorten?url=https://example.com/very-long-path" });
        }

        try {
            new URL(url); // Validate URL
        } catch {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        try {
            const apiUrl = `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`;
            const apiRes = await fetchWithTimeout(apiUrl, {}, 5000);
            const data = await apiRes.json();

            if (data.errorcode) {
                return res.status(400).json({ error: 'URL shortening failed', details: data.errormessage });
            }

            logActivity('api_call', `URL Shortener API: ${url.slice(0, 50)}...`);
            res.json({ success: true, original_url: url, short_url: data.shorturl });
        } catch (err) {
            logger.error('URL Shortener API', err.message);
            return res.status(500).json({ error: 'URL Shortener API request failed' });
        }
    });

    // --- SSL CERTIFICATE CHECK API (0.003 USDC) ---
    router.get('/api/ssl-check', paidEndpointLimiter, paymentMiddleware(10000, 0.003, "SSL Check API"), async (req, res) => {
        const hostname = (req.query.domain || req.query.host || '').trim().toLowerCase().slice(0, 253);

        if (!hostname) {
            return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/ssl-check?domain=google.com" });
        }
        if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(hostname)) {
            return res.status(400).json({ error: 'Invalid domain format' });
        }

        try {
            const tls = require('tls');
            const socket = tls.connect(443, hostname, { servername: hostname, timeout: 8000 });

            const result = await new Promise((resolve, reject) => {
                socket.on('secureConnect', () => {
                    const cert = socket.getPeerCertificate();
                    socket.destroy();
                    if (!cert || !cert.subject) {
                        return reject(new Error('No certificate'));
                    }
                    const now = Date.now();
                    const validFrom = new Date(cert.valid_from);
                    const validTo = new Date(cert.valid_to);
                    const daysRemaining = Math.floor((validTo - now) / 86400000);

                    resolve({
                        subject: cert.subject.CN || cert.subject.O || hostname,
                        issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
                        valid_from: validFrom.toISOString(),
                        valid_to: validTo.toISOString(),
                        days_remaining: daysRemaining,
                        is_valid: daysRemaining > 0,
                        serial_number: cert.serialNumber,
                        fingerprint: cert.fingerprint256 || cert.fingerprint,
                        san: (cert.subjectaltname || '').split(', ').map(s => s.replace('DNS:', ''))
                    });
                });
                socket.on('error', reject);
                socket.on('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')); });
            });

            logActivity('api_call', `SSL Check API: ${hostname} -> ${result.days_remaining} days`);
            res.json({ success: true, domain: hostname, certificate: result });
        } catch (err) {
            logger.error('SSL Check API', err.message);
            return res.status(500).json({ error: 'SSL check failed', domain: hostname, details: err.message });
        }
    });

    // --- WHOIS DOMAIN API (0.005 USDC) ---
    router.get('/api/whois', paidEndpointLimiter, paymentMiddleware(10000, 0.005, "WHOIS API"), async (req, res) => {
        const domain = (req.query.domain || '').trim().toLowerCase().slice(0, 253);

        if (!domain) {
            return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/whois?domain=example.com" });
        }
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain format' });
        }

        try {
            // Use RDAP (successor to WHOIS, free, JSON)
            const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
            const apiRes = await fetchWithTimeout(rdapUrl, {
                headers: { 'Accept': 'application/rdap+json' }
            }, 10000);

            if (!apiRes.ok) {
                return res.status(404).json({ error: 'Domain not found in RDAP', domain });
            }
            const data = await apiRes.json();

            const events = data.events || [];
            const getEvent = (action) => (events.find(e => e.eventAction === action) || {}).eventDate || null;
            const nameservers = (data.nameservers || []).map(ns => ns.ldhName).filter(Boolean);
            const statuses = data.status || [];

            logActivity('api_call', `WHOIS API: ${domain}`);
            res.json({
                success: true,
                domain: data.ldhName || domain,
                status: statuses,
                registered: getEvent('registration'),
                expires: getEvent('expiration'),
                last_updated: getEvent('last changed'),
                nameservers,
                registrar: data.entities?.find(e => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find(v => v[0] === 'fn')?.[3] || null
            });
        } catch (err) {
            logger.error('WHOIS API', err.message);
            return res.status(500).json({ error: 'WHOIS API request failed' });
        }
    });

    // --- DNS LOOKUP API WRAPPER (0.003 USDC) ---
    router.get('/api/dns', paidEndpointLimiter, paymentMiddleware(3000, 0.003, "DNS Lookup API"), async (req, res) => {
        const domain = (req.query.domain || '').trim().toLowerCase().slice(0, 255);
        const type = (req.query.type || 'A').trim().toUpperCase();

        if (!domain) {
            return res.status(400).json({ error: "Parameter 'domain' required. Ex: /api/dns?domain=google.com&type=A" });
        }

        // Validate domain format (basic check)
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain)) {
            return res.status(400).json({ error: 'Invalid domain name format' });
        }

        // Security: Block localhost, private IPs
        const blockedDomains = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|0\.0\.0\.0|0\.|169\.254\.|::1|fc00:|fe80:)/i;
        if (blockedDomains.test(domain)) {
            return res.status(400).json({ error: 'Internal domains not allowed' });
        }

        const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS', 'SOA', 'PTR', 'SRV'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `Invalid DNS type. Accepted: ${validTypes.join(', ')}` });
        }

        try {
            const dnsPromises = require('dns/promises');
            let records;

            switch (type) {
                case 'A':
                    records = await dnsPromises.resolve4(domain);
                    break;
                case 'AAAA':
                    records = await dnsPromises.resolve6(domain);
                    break;
                case 'MX':
                    records = await dnsPromises.resolveMx(domain);
                    break;
                case 'TXT':
                    records = await dnsPromises.resolveTxt(domain);
                    break;
                case 'CNAME':
                    records = await dnsPromises.resolveCname(domain);
                    break;
                case 'NS':
                    records = await dnsPromises.resolveNs(domain);
                    break;
                case 'SOA':
                    records = await dnsPromises.resolveSoa(domain);
                    break;
                case 'PTR':
                    records = await dnsPromises.resolvePtr(domain);
                    break;
                case 'SRV':
                    records = await dnsPromises.resolveSrv(domain);
                    break;
            }

            logActivity('api_call', `DNS Lookup API: ${domain} (${type})`);

            res.json({
                success: true,
                domain,
                type,
                records
            });
        } catch (err) {
            if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
                return res.status(404).json({ error: 'DNS records not found', domain, type });
            }
            logger.error('DNS Lookup API', err.message);
            return res.status(500).json({ error: 'DNS Lookup API request failed' });
        }
    });

    return router;
}

module.exports = createToolsRouter;
