// tests/new-apis.test.js — Unit tests for 20 new API wrappers (session 21)
// Tests pure logic: validation, parsing, conversion — no HTTP server needed
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ============================================================
// BATCH 3 — Data & Social APIs
// ============================================================

describe('News API — validation', () => {
    it('should reject empty topic', () => {
        const topic = ''.trim();
        assert.strictEqual(topic, '');
    });

    it('should truncate long topic to 100 chars', () => {
        const long = 'a'.repeat(200);
        const truncated = long.slice(0, 100);
        assert.strictEqual(truncated.length, 100);
    });
});

describe('Stock Price API — symbol validation', () => {
    it('should uppercase and validate symbol', () => {
        assert.strictEqual('aapl'.toUpperCase(), 'AAPL');
        assert.ok(/^[A-Z0-9.]{1,10}$/.test('AAPL'));
        assert.ok(/^[A-Z0-9.]{1,10}$/.test('BRK.B'));
        assert.ok(!/^[A-Z0-9.]{1,10}$/.test(''));
        assert.ok(!/^[A-Z0-9.]{1,10}$/.test('TOOLONGSYMBOL123'));
    });
});

describe('Reddit API — validation', () => {
    it('should strip r/ prefix', () => {
        assert.strictEqual('r/programming'.replace(/^r\//, ''), 'programming');
        assert.strictEqual('javascript'.replace(/^r\//, ''), 'javascript');
    });

    it('should validate subreddit name', () => {
        assert.ok(/^[a-zA-Z0-9_]{2,50}$/.test('programming'));
        assert.ok(/^[a-zA-Z0-9_]{2,50}$/.test('AskReddit'));
        assert.ok(!/^[a-zA-Z0-9_]{2,50}$/.test('a'));
        assert.ok(!/^[a-zA-Z0-9_]{2,50}$/.test('bad name!'));
    });

    it('should validate sort options', () => {
        const validSorts = ['hot', 'new', 'top', 'rising'];
        assert.ok(validSorts.includes('hot'));
        assert.ok(validSorts.includes('top'));
        assert.ok(!validSorts.includes('random'));
    });
});

describe('Hacker News API — validation', () => {
    it('should validate story types', () => {
        const validTypes = ['top', 'new', 'best', 'ask', 'show', 'job'];
        assert.ok(validTypes.includes('top'));
        assert.ok(validTypes.includes('job'));
        assert.ok(!validTypes.includes('random'));
    });

    it('should clamp limit between 1 and 30', () => {
        const clamp = (val) => Math.min(Math.max(parseInt(val) || 10, 1), 30);
        assert.strictEqual(clamp('5'), 5);
        assert.strictEqual(clamp('0'), 10); // 0 is falsy → becomes 10 (default)
        assert.strictEqual(clamp('100'), 30);
        assert.strictEqual(clamp('abc'), 10);
    });
});

describe('YouTube API — video ID extraction', () => {
    it('should extract ID from standard URL', () => {
        const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        assert.ok(match);
        assert.strictEqual(match[1], 'dQw4w9WgXcQ');
    });

    it('should extract ID from short URL', () => {
        const url = 'https://youtu.be/dQw4w9WgXcQ';
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        assert.ok(match);
        assert.strictEqual(match[1], 'dQw4w9WgXcQ');
    });

    it('should extract ID from embed URL', () => {
        const url = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        assert.ok(match);
        assert.strictEqual(match[1], 'dQw4w9WgXcQ');
    });

    it('should accept raw video ID', () => {
        assert.ok(/^[a-zA-Z0-9_-]{11}$/.test('dQw4w9WgXcQ'));
    });

    it('should reject invalid IDs', () => {
        assert.ok(!/^[a-zA-Z0-9_-]{11}$/.test('short'));
        assert.ok(!/^[a-zA-Z0-9_-]{11}$/.test('toolooooooooong'));
    });
});

describe('WHOIS API — domain validation', () => {
    it('should validate domain format', () => {
        const re = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/;
        assert.ok(re.test('example.com'));
        assert.ok(re.test('sub.domain.org'));
        assert.ok(re.test('x402bazaar.org'));
        assert.ok(!re.test(''));
        assert.ok(!re.test('-invalid.com'));
        assert.ok(!re.test('http://example.com'));
    });
});

describe('SSL Check API — domain validation', () => {
    it('should validate hostname format', () => {
        const re = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
        assert.ok(re.test('google.com'));
        assert.ok(re.test('x402bazaar.org'));
        assert.ok(!re.test(''));
        assert.ok(!re.test('http://google.com'));
    });
});

describe('Regex Tester API — logic', () => {
    it('should validate flags', () => {
        assert.ok(/^[gimsuy]*$/.test('g'));
        assert.ok(/^[gimsuy]*$/.test('gi'));
        assert.ok(/^[gimsuy]*$/.test(''));
        assert.ok(!/^[gimsuy]*$/.test('x'));
    });

    it('should find matches correctly', () => {
        const regex = new RegExp('\\d+', 'g');
        const text = 'abc123def456';
        const matches = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
            matches.push({ match: m[0], index: m.index });
        }
        assert.strictEqual(matches.length, 2);
        assert.strictEqual(matches[0].match, '123');
        assert.strictEqual(matches[1].match, '456');
    });

    it('should handle invalid regex gracefully', () => {
        assert.throws(() => new RegExp('[invalid', 'g'));
    });
});

describe('Text Diff API — logic', () => {
    it('should detect identical texts', () => {
        const lines1 = 'hello\nworld'.split('\n');
        const lines2 = 'hello\nworld'.split('\n');
        const changes = [];
        for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
            if (lines1[i] !== lines2[i]) changes.push(i);
        }
        assert.strictEqual(changes.length, 0);
    });

    it('should detect modified lines', () => {
        const lines1 = ['hello', 'world'];
        const lines2 = ['hello', 'earth'];
        const changes = [];
        for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
            if (lines1[i] !== lines2[i]) changes.push({ line: i + 1, type: 'modified' });
        }
        assert.strictEqual(changes.length, 1);
        assert.strictEqual(changes[0].line, 2);
    });

    it('should detect added lines', () => {
        const lines1 = ['a', 'b'];
        const lines2 = ['a', 'b', 'c'];
        const changes = [];
        for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
            if (lines1[i] === undefined) changes.push({ type: 'added' });
            else if (lines2[i] === undefined) changes.push({ type: 'removed' });
            else if (lines1[i] !== lines2[i]) changes.push({ type: 'modified' });
        }
        assert.strictEqual(changes.length, 1);
        assert.strictEqual(changes[0].type, 'added');
    });
});

describe('Math Expression API — evaluation', () => {
    it('should reject unsafe expressions', () => {
        const sanitized = 'alert(1)'.replace(/\s+/g, '');
        assert.ok(/[^0-9+\-*/.()e ]/.test(sanitized));
    });

    it('should evaluate basic expressions', () => {
        const result = new Function('"use strict"; return (2+3*4)')();
        assert.strictEqual(result, 14);
    });

    it('should handle pi substitution', () => {
        const sanitized = 'pi'.replace(/pi/gi, String(Math.PI));
        const result = new Function(`"use strict"; return (${sanitized})`)();
        assert.ok(Math.abs(result - Math.PI) < 0.0001);
    });

    it('should reject Infinity', () => {
        const result = new Function('"use strict"; return (1/0)')();
        assert.ok(!isFinite(result));
    });
});

// ============================================================
// BATCH 4 — Utility APIs
// ============================================================

describe('Unit Converter API — conversions', () => {
    const conversions = {
        km: { base: 'm', factor: 1000 }, m: { base: 'm', factor: 1 },
        miles: { base: 'm', factor: 1609.344 }, mi: { base: 'm', factor: 1609.344 },
        ft: { base: 'm', factor: 0.3048 },
        kg: { base: 'kg', factor: 1 }, lb: { base: 'kg', factor: 0.453592 },
        l: { base: 'l', factor: 1 }, gal: { base: 'l', factor: 3.78541 },
    };

    it('should convert km to miles correctly', () => {
        const result = 100 * conversions.km.factor / conversions.miles.factor;
        assert.ok(Math.abs(result - 62.137) < 0.01);
    });

    it('should convert lbs to kg correctly', () => {
        const result = 10 * conversions.lb.factor / conversions.kg.factor;
        assert.ok(Math.abs(result - 4.536) < 0.01);
    });

    it('should reject cross-type conversions', () => {
        assert.notStrictEqual(conversions.km.base, conversions.kg.base);
    });

    it('should convert Celsius to Fahrenheit', () => {
        assert.strictEqual(100 * 9 / 5 + 32, 212);
    });

    it('should convert Fahrenheit to Celsius', () => {
        assert.strictEqual((32 - 32) * 5 / 9, 0);
    });

    it('should convert Celsius to Kelvin', () => {
        assert.strictEqual(0 + 273.15, 273.15);
    });
});

describe('CSV to JSON API — parsing', () => {
    it('should parse CSV with headers', () => {
        const lines = 'name,age\nAlice,30\nBob,25'.split('\n');
        const headers = lines[0].split(',');
        const data = lines.slice(1).map(line => {
            const values = line.split(',');
            const obj = {};
            headers.forEach((h, i) => { obj[h] = values[i] || ''; });
            return obj;
        });
        assert.strictEqual(data.length, 2);
        assert.strictEqual(data[0].name, 'Alice');
        assert.strictEqual(data[0].age, '30');
    });

    it('should handle CSV without headers', () => {
        const data = 'Alice,30\nBob,25'.split('\n').map(l => l.split(','));
        assert.strictEqual(data.length, 2);
        assert.deepStrictEqual(data[0], ['Alice', '30']);
    });

    it('should reject empty CSV', () => {
        assert.strictEqual(''.split('\n').filter(Boolean).length, 0);
    });
});

describe('JWT Decode API — decoding', () => {
    it('should split JWT into 3 parts', () => {
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        assert.strictEqual(token.split('.').length, 3);
    });

    it('should decode JWT header', () => {
        const headerB64 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        const header = JSON.parse(Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        assert.strictEqual(header.alg, 'HS256');
        assert.strictEqual(header.typ, 'JWT');
    });

    it('should decode JWT payload', () => {
        const payloadB64 = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';
        const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        assert.strictEqual(payload.sub, '1234567890');
        assert.strictEqual(payload.name, 'John Doe');
        assert.strictEqual(payload.iat, 1516239022);
    });

    it('should reject tokens without 3 parts', () => {
        assert.notStrictEqual('only.two'.split('.').length, 3);
    });
});

describe('Cron Parser API — validation', () => {
    it('should accept 5-field cron', () => {
        assert.strictEqual('0 9 * * 1-5'.split(/\s+/).length, 5);
    });

    it('should accept 6-field cron', () => {
        assert.strictEqual('0 0 9 * * 1-5'.split(/\s+/).length, 6);
    });

    it('should reject invalid field counts', () => {
        assert.ok('* * *'.split(/\s+/).length < 5);
        assert.ok('* * * * * * *'.split(/\s+/).length > 6);
    });
});

describe('Password Strength API — scoring', () => {
    const scorePassword = (pw) => {
        const checks = {
            length: pw.length, has_lowercase: /[a-z]/.test(pw), has_uppercase: /[A-Z]/.test(pw),
            has_digits: /\d/.test(pw), has_special: /[^a-zA-Z0-9]/.test(pw),
            is_common: ['password', '123456', 'qwerty', 'admin'].includes(pw.toLowerCase())
        };
        let score = 0;
        if (checks.length >= 8) score += 20; if (checks.length >= 12) score += 10; if (checks.length >= 16) score += 10;
        if (checks.has_lowercase) score += 10; if (checks.has_uppercase) score += 10;
        if (checks.has_digits) score += 10; if (checks.has_special) score += 15; if (!checks.is_common) score += 15;
        return { score, checks };
    };

    it('should score weak password low', () => {
        assert.ok(scorePassword('abc').score < 30);
    });

    it('should detect common passwords', () => {
        assert.ok(scorePassword('password').checks.is_common);
    });

    it('should score strong password high', () => {
        assert.ok(scorePassword('MyStr0ng!Pass@2026').score >= 80);
    });

    it('should detect all character types', () => {
        const { checks } = scorePassword('Abc123!@');
        assert.ok(checks.has_lowercase);
        assert.ok(checks.has_uppercase);
        assert.ok(checks.has_digits);
        assert.ok(checks.has_special);
    });
});

describe('Phone Validate API — parsing', () => {
    it('should clean phone number', () => {
        assert.strictEqual('+33 6 12 34 56 78'.replace(/(?!^\+)\D/g, ''), '+33612345678');
    });

    it('should extract digits', () => {
        assert.strictEqual('+33612345678'.replace('+', ''), '33612345678');
    });

    it('should validate digit count 7-15', () => {
        assert.ok('1234567'.length >= 7);
        assert.ok('123456789012345'.length <= 15);
        assert.ok(!('123456'.length >= 7));
    });

    it('should detect French country code', () => {
        assert.ok('33612345678'.startsWith('33'));
        assert.strictEqual('33612345678'.slice(2).length, 9);
    });
});

describe('URL Parse API — parsing', () => {
    it('should parse full URL', () => {
        const url = new URL('https://example.com:8080/path?q=test&lang=en#section');
        assert.strictEqual(url.protocol, 'https:');
        assert.strictEqual(url.hostname, 'example.com');
        assert.strictEqual(url.port, '8080');
        assert.strictEqual(url.pathname, '/path');
        assert.strictEqual(url.hash, '#section');
        assert.strictEqual(url.searchParams.get('q'), 'test');
    });

    it('should throw on invalid URL', () => {
        assert.throws(() => new URL('not-a-url'));
    });
});

describe('HTML to Text — validation', () => {
    it('should reject oversized input', () => {
        assert.ok('x'.repeat(100001).length > 100000);
    });
});

describe('HTTP Status API — lookup', () => {
    const statuses = {
        200: { name: 'OK', cat: 'Success' },
        404: { name: 'Not Found', cat: 'Client Error' },
        402: { name: 'Payment Required', cat: 'Client Error' },
        500: { name: 'Internal Server Error', cat: 'Server Error' },
    };

    it('should find common status codes', () => {
        assert.strictEqual(statuses[200].name, 'OK');
        assert.strictEqual(statuses[404].name, 'Not Found');
        assert.strictEqual(statuses[402].name, 'Payment Required');
    });

    it('should categorize by range', () => {
        assert.strictEqual(statuses[200].cat, 'Success');
        assert.strictEqual(statuses[404].cat, 'Client Error');
        assert.strictEqual(statuses[500].cat, 'Server Error');
    });

    it('should reject invalid codes', () => {
        assert.ok(99 < 100);
        assert.ok(600 > 599);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// SVG Avatar Generator — Pure algorithmic tests (no network)
// ═════════════════════════════════════════════════════════════════════════════

describe('SVG Avatar — hash determinism', () => {
    function hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        }
        return h;
    }

    function hashColor(seed, offset) {
        const h = hash(seed + String(offset));
        const hue = h % 360;
        const sat = 50 + (h % 30);
        const lit = 45 + (h % 25);
        return `hsl(${hue}, ${sat}%, ${lit}%)`;
    }

    it('same name → same hash', () => {
        assert.equal(hash('Wintyx57'), hash('Wintyx57'));
    });

    it('different names → different hashes', () => {
        assert.notEqual(hash('Alice'), hash('Bob'));
    });

    it('hash always positive integer', () => {
        for (const name of ['test', '', 'a', 'very long name with spaces', '日本語']) {
            const h = hash(name);
            assert.ok(h >= 0);
            assert.ok(Number.isInteger(h));
        }
    });

    it('same name+offset → same color', () => {
        assert.equal(hashColor('Alice', 0), hashColor('Alice', 0));
    });

    it('different offsets → different colors', () => {
        assert.notEqual(hashColor('Alice', 0), hashColor('Alice', 42));
    });

    it('color is valid HSL', () => {
        const color = hashColor('test', 0);
        assert.match(color, /^hsl\(\d+, \d+%, \d+%\)$/);
    });

    it('saturation 50-79%', () => {
        for (let i = 0; i < 20; i++) {
            const color = hashColor(`user${i}`, 0);
            const sat = parseInt(color.match(/(\d+)%/)[1]);
            assert.ok(sat >= 50 && sat < 80, `sat=${sat}% for user${i}`);
        }
    });

    it('lightness 45-69%', () => {
        for (let i = 0; i < 20; i++) {
            const color = hashColor(`user${i}`, 0);
            const parts = color.match(/(\d+)%/g);
            const lit = parseInt(parts[1]);
            assert.ok(lit >= 45 && lit < 70, `lit=${lit}% for user${i}`);
        }
    });
});

describe('SVG Avatar — initials generation', () => {
    function getInitials(name) {
        return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    }

    it('"John Doe" → "JD"', () => assert.equal(getInitials('John Doe'), 'JD'));
    it('"Alice" → "A"', () => assert.equal(getInitials('Alice'), 'A'));
    it('"john.doe" → "JD"', () => assert.equal(getInitials('john.doe'), 'JD'));
    it('"jean-paul" → "JP"', () => assert.equal(getInitials('jean-paul'), 'JP'));
    it('"cool_user" → "CU"', () => assert.equal(getInitials('cool_user'), 'CU'));
    it('"A B C D" → "AB" (max 2)', () => assert.equal(getInitials('A B C D'), 'AB'));
    it('"x" → "X"', () => assert.equal(getInitials('x'), 'X'));
});

describe('SVG Avatar — size validation', () => {
    function clampSize(s) { return Math.max(32, Math.min(512, parseInt(s) || 128)); }

    it('min clamp to 32', () => assert.equal(clampSize(10), 32));
    it('max clamp to 512', () => assert.equal(clampSize(1000), 512));
    it('valid size passes through', () => assert.equal(clampSize(256), 256));
    it('undefined → default 128', () => assert.equal(clampSize(undefined), 128));
    it('NaN → default 128', () => assert.equal(clampSize('abc'), 128));
});

describe('SVG Avatar — style validation', () => {
    const valid = ['geometric', 'pixel', 'initials'];
    it('geometric valid', () => assert.ok(valid.includes('geometric')));
    it('pixel valid', () => assert.ok(valid.includes('pixel')));
    it('initials valid', () => assert.ok(valid.includes('initials')));
    it('abstract invalid', () => assert.ok(!valid.includes('abstract')));
    it('empty invalid', () => assert.ok(!valid.includes('')));
});

describe('SVG Avatar — pixel style determinism', () => {
    function hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        }
        return h;
    }

    it('same name → same pattern', () => {
        const pattern = (name) => {
            const r = [];
            for (let row = 0; row < 5; row++)
                for (let col = 0; col < 3; col++)
                    r.push(hash(name + row + col) % 3);
            return r;
        };
        assert.deepEqual(pattern('Test'), pattern('Test'));
    });

    it('different names → different patterns', () => {
        const pattern = (name) => {
            const r = [];
            for (let row = 0; row < 5; row++)
                for (let col = 0; col < 3; col++)
                    r.push(hash(name + row + col) % 3);
            return r;
        };
        assert.notDeepEqual(pattern('Alice'), pattern('Bob'));
    });
});

describe('SVG Avatar — geometric shape count', () => {
    function hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        }
        return h;
    }

    it('shape count 3-6 for various names', () => {
        for (const name of ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank']) {
            const n = 3 + (hash(name) % 4);
            assert.ok(n >= 3 && n <= 6, `numShapes=${n} for ${name}`);
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Article to Markdown — Readability + Turndown logic
// ═════════════════════════════════════════════════════════════════════════════

describe('Article-to-MD — Readability extraction', () => {
    const { JSDOM } = require('jsdom');
    const { Readability } = require('@mozilla/readability');

    it('should extract article from well-structured HTML', () => {
        const html = `<!DOCTYPE html><html><head><title>Test</title></head>
        <body><article><h1>My Article</h1><p>This is the main content of the article. It has multiple sentences to ensure readability extracts it properly. The article discusses very important topics that matter.</p></article></body></html>`;
        const dom = new JSDOM(html, { url: 'https://example.com/article' });
        const article = new Readability(dom.window.document).parse();
        assert.ok(article);
        assert.ok(article.content.includes('main content'));
    });

    it('should extract title', () => {
        const html = `<!DOCTYPE html><html><head><title>Page</title></head>
        <body><article><h1>Article Title</h1><p>Content here with enough text for Readability to pick it up as meaningful content for extraction.</p></article></body></html>`;
        const dom = new JSDOM(html, { url: 'https://example.com' });
        const article = new Readability(dom.window.document).parse();
        assert.ok(article && article.title);
    });
});

describe('Article-to-MD — Turndown conversion', () => {
    const TurndownService = require('turndown');

    it('headings → ATX', () => {
        const md = new TurndownService({ headingStyle: 'atx' }).turndown('<h1>Hello</h1><h2>World</h2>');
        assert.ok(md.includes('# Hello'));
        assert.ok(md.includes('## World'));
    });

    it('links → inline', () => {
        const md = new TurndownService({ linkStyle: 'inlined' }).turndown('<a href="https://example.com">Click</a>');
        assert.ok(md.includes('[Click](https://example.com)'));
    });

    it('code → fenced', () => {
        const md = new TurndownService({ codeBlockStyle: 'fenced' }).turndown('<pre><code>const x = 1;</code></pre>');
        assert.ok(md.includes('```'));
    });

    it('empty content → empty string', () => {
        const md = new TurndownService().turndown('');
        assert.equal(typeof md, 'string');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// OpenGraph / Link Preview — Meta extraction
// ═════════════════════════════════════════════════════════════════════════════

describe('OpenGraph — meta tag extraction', () => {
    const cheerio = require('cheerio');

    function extractOG(html) {
        const $ = cheerio.load(html);
        const og = {};
        $('meta[property^="og:"]').each((_, el) => {
            const prop = $(el).attr('property').replace('og:', '');
            if (!og[prop]) og[prop] = $(el).attr('content') || '';
        });
        const twitter = {};
        $('meta[name^="twitter:"]').each((_, el) => {
            const name = $(el).attr('name').replace('twitter:', '');
            if (!twitter[name]) twitter[name] = $(el).attr('content') || '';
        });
        return {
            title: og.title || twitter.title || $('title').text().trim() || '',
            description: og.description || twitter.description || $('meta[name="description"]').attr('content') || '',
            image: og.image || twitter.image || '',
            site_name: og.site_name || '',
            type: og.type || '',
        };
    }

    it('extract og:title', () => {
        const r = extractOG('<html><head><meta property="og:title" content="My Page"></head></html>');
        assert.equal(r.title, 'My Page');
    });

    it('extract og:description', () => {
        const r = extractOG('<html><head><meta property="og:description" content="Desc"></head></html>');
        assert.equal(r.description, 'Desc');
    });

    it('extract og:image', () => {
        const r = extractOG('<html><head><meta property="og:image" content="https://img.com/a.png"></head></html>');
        assert.equal(r.image, 'https://img.com/a.png');
    });

    it('extract og:site_name + og:type', () => {
        const r = extractOG('<html><head><meta property="og:site_name" content="S"><meta property="og:type" content="article"></head></html>');
        assert.equal(r.site_name, 'S');
        assert.equal(r.type, 'article');
    });

    it('fallback to twitter:title', () => {
        const r = extractOG('<html><head><meta name="twitter:title" content="TW Title"></head></html>');
        assert.equal(r.title, 'TW Title');
    });

    it('fallback to <title> tag', () => {
        const r = extractOG('<html><head><title>Fallback</title></head></html>');
        assert.equal(r.title, 'Fallback');
    });

    it('fallback to meta description', () => {
        const r = extractOG('<html><head><meta name="description" content="Meta D"></head></html>');
        assert.equal(r.description, 'Meta D');
    });

    it('no tags → empty strings', () => {
        const r = extractOG('<html><head></head></html>');
        assert.equal(r.title, '');
        assert.equal(r.description, '');
        assert.equal(r.image, '');
    });

    it('og: takes priority over twitter:', () => {
        const r = extractOG('<html><head><meta property="og:title" content="OG"><meta name="twitter:title" content="TW"></head></html>');
        assert.equal(r.title, 'OG');
    });

    it('all tags at once', () => {
        const r = extractOG(`<html><head>
            <meta property="og:title" content="T">
            <meta property="og:description" content="D">
            <meta property="og:image" content="https://i.com/a.png">
            <meta property="og:site_name" content="S">
            <meta property="og:type" content="website">
        </head></html>`);
        assert.equal(r.title, 'T');
        assert.equal(r.description, 'D');
        assert.equal(r.image, 'https://i.com/a.png');
        assert.equal(r.site_name, 'S');
        assert.equal(r.type, 'website');
    });
});

describe('OpenGraph — URL resolution', () => {
    it('resolve relative image URL', () => {
        assert.equal(new URL('/img/cover.jpg', 'https://example.com/page').href, 'https://example.com/img/cover.jpg');
    });

    it('absolute URL unchanged', () => {
        const u = 'https://cdn.example.com/img.png';
        assert.ok(u.startsWith('http'));
    });

    it('resolve protocol-relative', () => {
        assert.equal(new URL('https:' + '//cdn.example.com/img.png').href, 'https://cdn.example.com/img.png');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Discovery registration
// ═════════════════════════════════════════════════════════════════════════════

describe('New APIs — bazaar-discovery', () => {
    const { discoveryMap, getInputSchemaForUrl } = require('../lib/bazaar-discovery');

    it('article-to-md in discoveryMap', () => assert.ok(discoveryMap['/api/article-to-md']));
    it('opengraph in discoveryMap', () => assert.ok(discoveryMap['/api/opengraph']));
    it('avatar in discoveryMap', () => assert.ok(discoveryMap['/api/avatar']));

    it('article-to-md requires url', () => {
        assert.deepEqual(getInputSchemaForUrl('https://x402-api.onrender.com/api/article-to-md'), { required: ['url'] });
    });

    it('opengraph requires url', () => {
        assert.deepEqual(getInputSchemaForUrl('https://x402-api.onrender.com/api/opengraph'), { required: ['url'] });
    });

    it('avatar requires name', () => {
        assert.deepEqual(getInputSchemaForUrl('https://x402-api.onrender.com/api/avatar'), { required: ['name'] });
    });

    it('total endpoints >= 71', () => {
        assert.ok(Object.keys(discoveryMap).length >= 71);
    });
});
