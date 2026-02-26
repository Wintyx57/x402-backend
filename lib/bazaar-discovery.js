'use strict';

const { declareDiscoveryExtension } = require('@x402/extensions/bazaar');

// ─────────────────────────────────────────────────────────────────────────────
// WEB (7 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const searchDiscovery = declareDiscoveryExtension({
  input: { q: 'open source AI tools', max: 5 },
  inputSchema: {
    properties: {
      q:   { type: 'string', maxLength: 200 },
      max: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
    },
    required: ['q']
  },
  output: {
    example: {
      success: true,
      query: 'open source AI tools',
      results_count: 5,
      results: [
        { title: 'LangChain', url: 'https://langchain.com', snippet: 'Build LLM-powered apps.' }
      ]
    }
  }
});

const scrapeDiscovery = declareDiscoveryExtension({
  input: { url: 'https://example.com' },
  inputSchema: {
    properties: {
      url: { type: 'string', format: 'uri' }
    },
    required: ['url']
  },
  output: {
    example: {
      success: true,
      url: 'https://example.com',
      title: 'Example Domain',
      description: 'Illustrative example domain.',
      content: 'This domain is for use in illustrative examples...',
      content_length: 1270
    }
  }
});

const twitterDiscovery = declareDiscoveryExtension({
  input: { user: 'elonmusk', max: 5 },
  inputSchema: {
    properties: {
      user:   { type: 'string' },
      tweet:  { type: 'string' },
      search: { type: 'string' },
      max:    { type: 'integer' }
    },
    anyOf: [
      { required: ['user'] },
      { required: ['tweet'] },
      { required: ['search'] }
    ]
  },
  output: {
    example: {
      success: true,
      type: 'user',
      data: { username: 'elonmusk', followers: 180000000, bio: 'CEO of SpaceX and Tesla' }
    }
  }
});

const newsDiscovery = declareDiscoveryExtension({
  input: { topic: 'artificial intelligence', lang: 'en' },
  inputSchema: {
    properties: {
      topic: { type: 'string', maxLength: 100 },
      lang:  { type: 'string', default: 'en' }
    },
    required: ['topic']
  },
  output: {
    example: {
      success: true,
      topic: 'artificial intelligence',
      count: 5,
      articles: [
        { title: 'AI Breakthroughs in 2026', link: 'https://news.example.com/ai', source: 'TechNews', published: '2026-02-26' }
      ]
    }
  }
});

const redditDiscovery = declareDiscoveryExtension({
  input: { subreddit: 'programming', sort: 'hot', limit: 10 },
  inputSchema: {
    properties: {
      subreddit: { type: 'string' },
      sort:      { type: 'string', enum: ['hot', 'new', 'top', 'rising'] },
      limit:     { type: 'integer', minimum: 1, maximum: 25 }
    },
    required: ['subreddit']
  },
  output: {
    example: {
      success: true,
      posts: [
        { title: 'Show HN: My open source project', url: 'https://reddit.com/r/programming/...', score: 1200, author: 'dev42' }
      ]
    }
  }
});

const hnDiscovery = declareDiscoveryExtension({
  input: { type: 'top', limit: 10 },
  inputSchema: {
    properties: {
      type:  { type: 'string', enum: ['top', 'new', 'best', 'ask', 'show', 'job'] },
      limit: { type: 'integer', minimum: 1, maximum: 30 }
    },
    required: []
  },
  output: {
    example: {
      success: true,
      stories: [
        { id: 39881234, title: 'Launch HN: x402 Bazaar', url: 'https://x402bazaar.org', author: 'Wintyx57', score: 342 }
      ]
    }
  }
});

const youtubeDiscovery = declareDiscoveryExtension({
  input: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  inputSchema: {
    properties: {
      url: { type: 'string' },
      id:  { type: 'string' }
    },
    anyOf: [{ required: ['url'] }, { required: ['id'] }]
  },
  output: {
    example: {
      success: true,
      video_id: 'dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      author: 'Rick Astley',
      thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DATA (10 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const weatherDiscovery = declareDiscoveryExtension({
  input: { city: 'Paris' },
  inputSchema: {
    properties: {
      city: { type: 'string', maxLength: 100 }
    },
    required: ['city']
  },
  output: {
    example: {
      city: 'Paris',
      country: 'FR',
      temperature: 14.2,
      wind_speed: 12.5,
      weather_code: 1
    }
  }
});

const cryptoDiscovery = declareDiscoveryExtension({
  input: { coin: 'bitcoin' },
  inputSchema: {
    properties: {
      coin: { type: 'string' }
    },
    required: ['coin']
  },
  output: {
    example: {
      coin: 'bitcoin',
      usd: 67500.42,
      eur: 62100.18,
      usd_24h_change: 2.35
    }
  }
});

const stocksDiscovery = declareDiscoveryExtension({
  input: { symbol: 'AAPL' },
  inputSchema: {
    properties: {
      symbol: { type: 'string' }
    },
    required: ['symbol']
  },
  output: {
    example: {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 189.84,
      change: 1.23,
      change_percent: 0.65
    }
  }
});

const currencyDiscovery = declareDiscoveryExtension({
  input: { from: 'USD', to: 'EUR', amount: 100 },
  inputSchema: {
    properties: {
      from:   { type: 'string', minLength: 3, maxLength: 3 },
      to:     { type: 'string', minLength: 3, maxLength: 3 },
      amount: { type: 'number', default: 1 }
    },
    required: ['from', 'to']
  },
  output: {
    example: {
      from: 'USD',
      to: 'EUR',
      amount: 100,
      converted: 92.35,
      rate: 0.9235
    }
  }
});

const timeDiscovery = declareDiscoveryExtension({
  input: { timezone: 'America/New_York' },
  inputSchema: {
    properties: {
      timezone: { type: 'string' }
    },
    required: ['timezone']
  },
  output: {
    example: {
      timezone: 'America/New_York',
      datetime: '2026-02-26T10:30:00-05:00',
      utc_offset: '-05:00',
      unix_timestamp: 1740581400
    }
  }
});

const ipDiscovery = declareDiscoveryExtension({
  input: { address: '8.8.8.8' },
  inputSchema: {
    properties: {
      address: { type: 'string' }
    },
    required: ['address']
  },
  output: {
    example: {
      ip: '8.8.8.8',
      country: 'United States',
      region: 'California',
      city: 'Mountain View',
      latitude: 37.4056,
      longitude: -122.0775
    }
  }
});

const useragentDiscovery = declareDiscoveryExtension({
  input: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
  inputSchema: {
    properties: {
      ua: { type: 'string' }
    },
    required: ['ua']
  },
  output: {
    example: {
      browser_name: 'Chrome',
      browser_version: '120.0.0.0',
      os: 'Windows 10',
      device_type: 'desktop'
    }
  }
});

const loremDiscovery = declareDiscoveryExtension({
  input: { type: 'sentences', count: 3 },
  inputSchema: {
    properties: {
      type:  { type: 'string', enum: ['words', 'sentences', 'paragraphs'] },
      count: { type: 'integer', minimum: 1 }
    },
    required: []
  },
  output: {
    example: {
      text: 'Lorem ipsum dolor sit amet. Consectetur adipiscing elit. Sed do eiusmod tempor.'
    }
  }
});

const qrcodeDiscovery = declareDiscoveryExtension({
  input: { data: 'https://x402bazaar.org', size: 256 },
  inputSchema: {
    properties: {
      data: { type: 'string' },
      size: { type: 'integer', minimum: 50, maximum: 1000 }
    },
    required: ['data']
  },
  output: {
    example: {
      imageUrl: 'data:image/png;base64,iVBORw0KGgo...',
      data: 'https://x402bazaar.org',
      size: 256
    }
  }
});

const timestampDiscovery = declareDiscoveryExtension({
  input: { ts: 1700000000 },
  inputSchema: {
    properties: {
      ts:   { type: 'number', description: 'Unix timestamp to convert (optional)' },
      date: { type: 'string', description: 'ISO date string to convert (optional)' }
    },
    required: []
  },
  output: {
    example: {
      timestamp: 1700000000,
      iso: '2023-11-14T22:13:20.000Z',
      utc: 'Tue, 14 Nov 2023 22:13:20 GMT'
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEXT (9 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const translateDiscovery = declareDiscoveryExtension({
  input: { text: 'Hello, world!', from: 'auto', to: 'fr' },
  inputSchema: {
    properties: {
      text: { type: 'string', maxLength: 5000 },
      from: { type: 'string', default: 'auto' },
      to:   { type: 'string' }
    },
    required: ['text', 'to']
  },
  output: {
    example: {
      translatedText: 'Bonjour, le monde!',
      from: 'en',
      to: 'fr'
    }
  }
});

const summarizeDiscovery = declareDiscoveryExtension({
  input: { text: 'Artificial intelligence is transforming every industry...', maxLength: 150 },
  inputSchema: {
    properties: {
      text:      { type: 'string', minLength: 50, maxLength: 50000 },
      maxLength: { type: 'integer', minimum: 50, maximum: 2000 }
    },
    required: ['text']
  },
  output: {
    example: {
      summary: 'AI is transforming every industry by automating tasks and enabling new capabilities.',
      originalLength: 2540,
      summaryLength: 84
    }
  }
});

const markdownDiscovery = declareDiscoveryExtension({
  input: { text: '# Hello\n\nThis is **bold** text.' },
  inputSchema: {
    properties: {
      text: { type: 'string', maxLength: 50000 }
    },
    required: ['text']
  },
  output: {
    example: {
      html: '<h1>Hello</h1><p>This is <strong>bold</strong> text.</p>',
      input_length: 30,
      output_length: 58
    }
  }
});

const htmlToTextDiscovery = declareDiscoveryExtension({
  input: { html: '<h1>Title</h1><p>Some <b>bold</b> content.</p>' },
  inputSchema: {
    properties: {
      html: { type: 'string' }
    },
    required: ['html']
  },
  output: {
    example: {
      text: 'Title\n\nSome bold content.',
      text_length: 24,
      links_count: 0
    }
  }
});

const csvToJsonDiscovery = declareDiscoveryExtension({
  input: { csv: 'name,age\nAlice,30\nBob,25', delimiter: ',', header: true },
  inputSchema: {
    properties: {
      csv:       { type: 'string' },
      delimiter: { type: 'string', default: ',' },
      header:    { type: 'boolean', default: true }
    },
    required: ['csv']
  },
  output: {
    example: {
      data: [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }],
      columns: ['name', 'age'],
      row_count: 2
    }
  }
});

const base64Discovery = declareDiscoveryExtension({
  input: { text: 'Hello, World!', mode: 'encode' },
  inputSchema: {
    properties: {
      text: { type: 'string' },
      mode: { type: 'string', enum: ['encode', 'decode'] }
    },
    required: ['text', 'mode']
  },
  output: {
    example: {
      result: 'SGVsbG8sIFdvcmxkIQ==',
      mode: 'encode'
    }
  }
});

const diffDiscovery = declareDiscoveryExtension({
  input: { text1: 'Hello world', text2: 'Hello there' },
  inputSchema: {
    properties: {
      text1: { type: 'string' },
      text2: { type: 'string' }
    },
    required: ['text1', 'text2']
  },
  output: {
    example: {
      similarity_percent: 72.7,
      diffs: [
        { type: 'equal', value: 'Hello ' },
        { type: 'removed', value: 'world' },
        { type: 'added', value: 'there' }
      ],
      added_lines: 1,
      removed_lines: 1
    }
  }
});

const jsonFormatDiscovery = declareDiscoveryExtension({
  input: { json: '{"name":"Alice","age":30}', format: 'pretty' },
  inputSchema: {
    properties: {
      json:   { type: 'string' },
      format: { type: 'string', enum: ['pretty', 'minify'] }
    },
    required: ['json', 'format']
  },
  output: {
    example: {
      formatted: '{\n  "name": "Alice",\n  "age": 30\n}',
      valid: true,
      input_size: 24
    }
  }
});

const readabilityDiscovery = declareDiscoveryExtension({
  input: { url: 'https://en.wikipedia.org/wiki/Artificial_intelligence' },
  inputSchema: {
    properties: {
      url: { type: 'string', format: 'uri' }
    },
    required: ['url']
  },
  output: {
    example: {
      title: 'Artificial intelligence - Wikipedia',
      content: 'Artificial intelligence (AI) is intelligence demonstrated by machines...',
      reading_time_minutes: 12
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION (7 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const validateEmailDiscovery = declareDiscoveryExtension({
  input: { email: 'contact@x402bazaar.org' },
  inputSchema: {
    properties: {
      email: { type: 'string', format: 'email' }
    },
    required: ['email']
  },
  output: {
    example: {
      email: 'contact@x402bazaar.org',
      valid: true,
      format: true,
      mxRecords: true,
      domain: 'x402bazaar.org'
    }
  }
});

const phoneValidateDiscovery = declareDiscoveryExtension({
  input: { phone: '+33612345678' },
  inputSchema: {
    properties: {
      phone: { type: 'string' }
    },
    required: ['phone']
  },
  output: {
    example: {
      input: '+33612345678',
      valid: true,
      country: 'France',
      type: 'mobile'
    }
  }
});

const urlParseDiscovery = declareDiscoveryExtension({
  input: { url: 'https://api.example.com/v1/users?page=2&limit=10#section' },
  inputSchema: {
    properties: {
      url: { type: 'string' }
    },
    required: ['url']
  },
  output: {
    example: {
      protocol: 'https:',
      hostname: 'api.example.com',
      pathname: '/v1/users',
      params: { page: '2', limit: '10' }
    }
  }
});

const jsonValidateDiscovery = declareDiscoveryExtension({
  input: { json: '{"key":"value","count":42}' },
  inputSchema: {
    properties: {
      json: { type: 'string' }
    },
    required: ['json']
  },
  output: {
    example: {
      valid: true,
      type: 'object',
      keys_count: 2
    }
  }
});

const jwtDecodeDiscovery = declareDiscoveryExtension({
  input: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' },
  inputSchema: {
    properties: {
      token: { type: 'string' }
    },
    required: ['token']
  },
  output: {
    example: {
      valid: true,
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: '1234567890', iat: 1516239022 },
      expired: false
    }
  }
});

const passwordStrengthDiscovery = declareDiscoveryExtension({
  input: { password: 'Sup3rS3cur3!' },
  inputSchema: {
    properties: {
      password: { type: 'string' }
    },
    required: ['password']
  },
  output: {
    example: {
      strength: 'strong',
      score: 4,
      feedback: ['Good use of numbers', 'Special characters present']
    }
  }
});

const regexDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { pattern: '^[a-z]+$', text: 'hello world test', flags: 'g' },
  inputSchema: {
    properties: {
      pattern: { type: 'string' },
      text:    { type: 'string' },
      flags:   { type: 'string' }
    },
    required: ['pattern', 'text']
  },
  output: {
    example: {
      matches: ['hello', 'world', 'test'],
      match_count: 3
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOLS (13 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const hashDiscovery = declareDiscoveryExtension({
  input: { text: 'hello world', algo: 'sha256' },
  inputSchema: {
    properties: {
      text: { type: 'string' },
      algo: { type: 'string', enum: ['md5', 'sha1', 'sha256', 'sha512'] }
    },
    required: ['text']
  },
  output: {
    example: {
      hash: 'b94d27b9934d3e08a52e52d7da7dabfac484efe04294e576e86b742b92571f00',
      algorithm: 'sha256'
    }
  }
});

const passwordGenDiscovery = declareDiscoveryExtension({
  input: { length: 16, symbols: true, numbers: true },
  inputSchema: {
    properties: {
      length:  { type: 'integer', minimum: 8, maximum: 128 },
      symbols: { type: 'boolean' },
      numbers: { type: 'boolean' }
    },
    required: []
  },
  output: {
    example: {
      password: 'X#k9mP@2qLrT$vNw',
      length: 16
    }
  }
});

const qrcodeGenDiscovery = declareDiscoveryExtension({
  input: { data: 'https://x402bazaar.org', size: 300 },
  inputSchema: {
    properties: {
      data: { type: 'string', maxLength: 2000 },
      size: { type: 'integer', minimum: 50, maximum: 1000 }
    },
    required: ['data']
  },
  output: {
    example: {
      imageUrl: 'data:image/png;base64,iVBORw0KGgo...',
      data: 'https://x402bazaar.org',
      size: 300
    }
  }
});

const colorDiscovery = declareDiscoveryExtension({
  input: { hex: '#FF5733' },
  inputSchema: {
    properties: {
      hex: { type: 'string' },
      rgb: { type: 'string' }
    },
    anyOf: [{ required: ['hex'] }, { required: ['rgb'] }]
  },
  output: {
    example: {
      hex: '#FF5733',
      rgb: 'rgb(255, 87, 51)',
      hsl: 'hsl(11, 100%, 60%)'
    }
  }
});

const cronParseDiscovery = declareDiscoveryExtension({
  input: { expr: '0 9 * * 1-5' },
  inputSchema: {
    properties: {
      expr: { type: 'string' }
    },
    required: ['expr']
  },
  output: {
    example: {
      expression: '0 9 * * 1-5',
      description: 'At 09:00 AM, Monday through Friday',
      fields: { minute: '0', hour: '9', dayOfMonth: '*', month: '*', dayOfWeek: '1-5' }
    }
  }
});

const httpStatusDiscovery = declareDiscoveryExtension({
  input: { code: 404 },
  inputSchema: {
    properties: {
      code: { type: 'integer', minimum: 100, maximum: 599 }
    },
    required: ['code']
  },
  output: {
    example: {
      code: 404,
      name: 'Not Found',
      description: 'The server cannot find the requested resource.',
      category: 'Client Error'
    }
  }
});

const unitConvertDiscovery = declareDiscoveryExtension({
  input: { value: 100, from: 'km', to: 'miles' },
  inputSchema: {
    properties: {
      value: { type: 'number' },
      from:  { type: 'string' },
      to:    { type: 'string' }
    },
    required: ['value', 'from', 'to']
  },
  output: {
    example: {
      value: 100,
      from: 'km',
      to: 'miles',
      result: 62.137
    }
  }
});

const dnsDiscovery = declareDiscoveryExtension({
  input: { domain: 'x402bazaar.org', type: 'A' },
  inputSchema: {
    properties: {
      domain: { type: 'string' },
      type:   { type: 'string', enum: ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'] }
    },
    required: ['domain']
  },
  output: {
    example: {
      domain: 'x402bazaar.org',
      type: 'A',
      records: ['76.76.21.21']
    }
  }
});

const whoisDiscovery = declareDiscoveryExtension({
  input: { domain: 'x402bazaar.org' },
  inputSchema: {
    properties: {
      domain: { type: 'string' }
    },
    required: ['domain']
  },
  output: {
    example: {
      domain: 'x402bazaar.org',
      registrar: 'Namecheap, Inc.',
      created: '2024-01-15',
      expires: '2026-01-15',
      nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com']
    }
  }
});

const sslCheckDiscovery = declareDiscoveryExtension({
  input: { domain: 'x402bazaar.org' },
  inputSchema: {
    properties: {
      domain: { type: 'string' }
    },
    required: ['domain']
  },
  output: {
    example: {
      domain: 'x402bazaar.org',
      issuer: "Let's Encrypt",
      valid: true,
      days_remaining: 82
    }
  }
});

const uuidDiscovery = declareDiscoveryExtension({
  input: { count: 3, version: '4' },
  inputSchema: {
    properties: {
      count:   { type: 'integer' },
      version: { type: 'string', enum: ['4', '5'] }
    },
    required: []
  },
  output: {
    example: {
      uuids: [
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        'a8098c1a-f86e-11da-bd1a-00112444be1e',
        '1b671a64-40d5-491e-99b0-da01ff1f3341'
      ]
    }
  }
});

const headersDiscovery = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {}
  },
  output: {
    example: {
      headers: {
        'user-agent': 'Mozilla/5.0 ...',
        'accept': 'application/json',
        'x-forwarded-for': '192.168.1.1'
      },
      user_ip: '192.168.1.1'
    }
  }
});

const urlShortenDiscovery = declareDiscoveryExtension({
  input: { url: 'https://x402bazaar.org/services' },
  inputSchema: {
    properties: {
      url: { type: 'string', format: 'uri' }
    },
    required: ['url']
  },
  output: {
    example: {
      short_url: 'https://is.gd/abc123',
      original_url: 'https://x402bazaar.org/services'
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI (6 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const imageDiscovery = declareDiscoveryExtension({
  input: { prompt: 'A futuristic city at sunset with flying cars', size: '1024x1024', quality: 'standard' },
  inputSchema: {
    properties: {
      prompt:  { type: 'string', maxLength: 1000 },
      size:    { type: 'string', enum: ['1024x1024', '1024x1792', '1792x1024'] },
      quality: { type: 'string', enum: ['standard', 'hd'] }
    },
    required: ['prompt']
  },
  output: {
    example: {
      prompt: 'A futuristic city at sunset with flying cars',
      image_url: 'https://oaidalleapiprodscus.blob.core.windows.net/private/...',
      size: '1024x1024'
    }
  }
});

const sentimentDiscovery = declareDiscoveryExtension({
  input: { text: 'This product is absolutely amazing and exceeded all expectations!' },
  inputSchema: {
    properties: {
      text: { type: 'string', minLength: 5, maxLength: 10000 }
    },
    required: ['text']
  },
  output: {
    example: {
      sentiment: 'positive',
      score: 0.97,
      keywords: ['amazing', 'exceeded', 'expectations']
    }
  }
});

const codeExecDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { language: 'python', code: 'print("Hello, World!")' },
  inputSchema: {
    properties: {
      language: { type: 'string' },
      code:     { type: 'string', maxLength: 50000 }
    },
    required: ['language', 'code']
  },
  output: {
    example: {
      language: 'python',
      output: 'Hello, World!\n',
      stderr: ''
    }
  }
});

const codeReviewDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { code: 'def add(a, b):\n    return a + b', language: 'python' },
  inputSchema: {
    properties: {
      code:     { type: 'string', maxLength: 20000 },
      language: { type: 'string' }
    },
    required: ['code']
  },
  output: {
    example: {
      quality_score: 82,
      summary: 'Clean, minimal function with no issues.',
      issues: [],
      strengths: ['Clear naming', 'Single responsibility']
    }
  }
});

const mathDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { expr: 'sqrt(144) + log(1000)' },
  inputSchema: {
    properties: {
      expr: { type: 'string' }
    },
    required: ['expr']
  },
  output: {
    example: {
      result: 15,
      expression: 'sqrt(144) + log(1000)',
      valid: true
    }
  }
});

const textStatsDiscovery = declareDiscoveryExtension({
  input: { text: 'The quick brown fox jumps over the lazy dog.' },
  inputSchema: {
    properties: {
      text: { type: 'string' }
    },
    required: ['text']
  },
  output: {
    example: {
      word_count: 9,
      sentence_count: 1,
      character_count: 44
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MISC (12 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const jokeDiscovery = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {}
  },
  output: {
    example: {
      setup: 'Why do programmers prefer dark mode?',
      punchline: 'Because light attracts bugs!'
    }
  }
});

const wikipediaDiscovery = declareDiscoveryExtension({
  input: { q: 'blockchain technology' },
  inputSchema: {
    properties: {
      q: { type: 'string' }
    },
    required: ['q']
  },
  output: {
    example: {
      title: 'Blockchain',
      extract: 'A blockchain is a distributed ledger with growing list of records...',
      thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/thumb/...',
      url: 'https://en.wikipedia.org/wiki/Blockchain'
    }
  }
});

const dictionaryDiscovery = declareDiscoveryExtension({
  input: { word: 'serendipity' },
  inputSchema: {
    properties: {
      word: { type: 'string' }
    },
    required: ['word']
  },
  output: {
    example: {
      word: 'serendipity',
      phonetic: '/ˌsɛr.ənˈdɪp.ɪ.ti/',
      meanings: [
        { partOfSpeech: 'noun', definitions: [{ definition: 'The occurrence of events by chance in a happy or beneficial way.' }] }
      ]
    }
  }
});

const countriesDiscovery = declareDiscoveryExtension({
  input: { name: 'France' },
  inputSchema: {
    properties: {
      name: { type: 'string' }
    },
    required: ['name']
  },
  output: {
    example: {
      name: 'France',
      capital: 'Paris',
      population: 67750000,
      region: 'Europe',
      currencies: ['EUR'],
      flag: 'https://flagcdn.com/fr.svg'
    }
  }
});

const githubDiscovery = declareDiscoveryExtension({
  input: { user: 'Wintyx57' },
  inputSchema: {
    properties: {
      user: { type: 'string' },
      repo: { type: 'string' }
    },
    anyOf: [{ required: ['user'] }, { required: ['repo'] }]
  },
  output: {
    example: {
      login: 'Wintyx57',
      name: 'Robin',
      public_repos: 7,
      followers: 42,
      bio: 'Building x402 Bazaar'
    }
  }
});

const npmDiscovery = declareDiscoveryExtension({
  input: { package: 'express' },
  inputSchema: {
    properties: {
      package: { type: 'string' }
    },
    required: ['package']
  },
  output: {
    example: {
      name: 'express',
      version: '5.2.1',
      description: 'Fast, unopinionated, minimalist web framework for node.',
      license: 'MIT'
    }
  }
});

const holidaysDiscovery = declareDiscoveryExtension({
  input: { country: 'FR', year: 2026 },
  inputSchema: {
    properties: {
      country: { type: 'string' },
      year:    { type: 'integer' }
    },
    required: ['country']
  },
  output: {
    example: {
      holidays: [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-07-14', name: 'Bastille Day' }
      ]
    }
  }
});

const geocodeDiscovery = declareDiscoveryExtension({
  input: { address: '1600 Amphitheatre Parkway, Mountain View, CA' },
  inputSchema: {
    properties: {
      address: { type: 'string' }
    },
    required: ['address']
  },
  output: {
    example: {
      latitude: 37.4224428,
      longitude: -122.0842467,
      address: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA'
    }
  }
});

const airqualityDiscovery = declareDiscoveryExtension({
  input: { city: 'Beijing' },
  inputSchema: {
    properties: {
      city: { type: 'string' }
    },
    required: ['city']
  },
  output: {
    example: {
      city: 'Beijing',
      aqi: 142,
      pm25: 55.3,
      risk_level: 'Unhealthy for Sensitive Groups'
    }
  }
});

const quoteDiscovery = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {}
  },
  output: {
    example: {
      text: 'The best way to predict the future is to invent it.',
      author: 'Alan Kay'
    }
  }
});

const factsDiscovery = declareDiscoveryExtension({
  input: { type: 'useless' },
  inputSchema: {
    properties: {
      type: { type: 'string', enum: ['useless', 'trivia'] }
    },
    required: []
  },
  output: {
    example: {
      fact: 'A group of flamingos is called a flamboyance.',
      type: 'useless'
    }
  }
});

const dogsDiscovery = declareDiscoveryExtension({
  input: { breed: 'husky' },
  inputSchema: {
    properties: {
      breed: { type: 'string', description: 'Dog breed name (optional, random if omitted)' }
    },
    required: []
  },
  output: {
    example: {
      breed: 'husky',
      image_url: 'https://images.dog.ceo/breeds/husky/n02110185_1469.jpg'
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE (8 APIs)
// ─────────────────────────────────────────────────────────────────────────────

const contractRiskDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { text: 'This agreement shall be governed by... The contractor shall indemnify...' },
  inputSchema: {
    properties: {
      text: { type: 'string', maxLength: 30000 }
    },
    required: ['text']
  },
  output: {
    example: {
      overall_risk: 'medium',
      risk_score: 58,
      clauses: [
        { clause: 'Indemnification', risk: 'high', explanation: 'Broad indemnification clause with no cap.' }
      ]
    }
  }
});

const emailParseDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { email: 'From: john.doe@acme.com\nSubject: Partnership proposal\n\nHi, we are interested in integrating your API...' },
  inputSchema: {
    properties: {
      email: { type: 'string', maxLength: 10000 }
    },
    required: ['email']
  },
  output: {
    example: {
      sender_name: 'John Doe',
      company: 'Acme Corp',
      intent: 'partnership_inquiry',
      sentiment: 'positive',
      summary: 'Inbound partnership request from Acme Corp interested in API integration.'
    }
  }
});

const tableInsightsDiscovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { csv: 'month,revenue,users\nJan,12000,340\nFeb,15000,420\nMar,18500,510' },
  inputSchema: {
    properties: {
      csv:  { type: 'string', maxLength: 20000 },
      data: { type: 'string', maxLength: 20000 }
    },
    anyOf: [{ required: ['csv'] }, { required: ['data'] }]
  },
  output: {
    example: {
      rows: 3,
      columns: ['month', 'revenue', 'users'],
      insights: ['Revenue grew 54% from Jan to Mar.', 'Users increased 50% in Q1.'],
      trends: [{ column: 'revenue', direction: 'up', change_percent: 54.2 }]
    }
  }
});

const domainReportDiscovery = declareDiscoveryExtension({
  input: { domain: 'x402bazaar.org' },
  inputSchema: {
    properties: {
      domain: { type: 'string' }
    },
    required: ['domain']
  },
  output: {
    example: {
      domain: 'x402bazaar.org',
      trust_score: 87,
      dns: { a: ['76.76.21.21'], mx: ['mail.x402bazaar.org'] },
      ssl: { valid: true, issuer: "Let's Encrypt", days_remaining: 82 }
    }
  }
});

const seoAuditDiscovery = declareDiscoveryExtension({
  input: { url: 'https://x402bazaar.org' },
  inputSchema: {
    properties: {
      url: { type: 'string', format: 'uri' }
    },
    required: ['url']
  },
  output: {
    example: {
      url: 'https://x402bazaar.org',
      score: 91,
      grade: 'A',
      issues: ['Missing alt text on 2 images'],
      meta: { title: 'x402 Bazaar', description: 'Autonomous API marketplace', og_image: true }
    }
  }
});

const leadScoreDiscovery = declareDiscoveryExtension({
  input: { domain: 'openai.com' },
  inputSchema: {
    properties: {
      domain: { type: 'string' }
    },
    required: ['domain']
  },
  output: {
    example: {
      domain: 'openai.com',
      lead_score: 95,
      firmographic: {
        company: 'OpenAI',
        industry: 'Artificial Intelligence',
        size: 'large',
        funding: 'series-f',
        employees_estimate: 1700
      }
    }
  }
});

const cryptoIntelligenceDiscovery = declareDiscoveryExtension({
  input: { token: 'ethereum' },
  inputSchema: {
    properties: {
      token: { type: 'string' }
    },
    required: ['token']
  },
  output: {
    example: {
      name: 'Ethereum',
      price: 3200.45,
      market_cap: 384000000000,
      risk_score: 35,
      sentiment: 'bullish',
      social_volume_24h: 142000
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// discoveryMap — maps every API path to its discovery extension
// ─────────────────────────────────────────────────────────────────────────────

const discoveryMap = {
  // WEB
  '/api/search':       searchDiscovery,
  '/api/scrape':       scrapeDiscovery,
  '/api/twitter':      twitterDiscovery,
  '/api/news':         newsDiscovery,
  '/api/reddit':       redditDiscovery,
  '/api/hn':           hnDiscovery,
  '/api/youtube':      youtubeDiscovery,

  // DATA
  '/api/weather':      weatherDiscovery,
  '/api/crypto':       cryptoDiscovery,
  '/api/stocks':       stocksDiscovery,
  '/api/currency':     currencyDiscovery,
  '/api/time':         timeDiscovery,
  '/api/ip':           ipDiscovery,
  '/api/useragent':    useragentDiscovery,
  '/api/lorem':        loremDiscovery,
  '/api/qrcode':       qrcodeDiscovery,
  '/api/timestamp':    timestampDiscovery,

  // TEXT
  '/api/translate':    translateDiscovery,
  '/api/summarize':    summarizeDiscovery,
  '/api/markdown':     markdownDiscovery,
  '/api/html-to-text': htmlToTextDiscovery,
  '/api/csv-to-json':  csvToJsonDiscovery,
  '/api/base64':       base64Discovery,
  '/api/diff':         diffDiscovery,
  // json-format removed — endpoint does not exist in wrappers
  '/api/readability':  readabilityDiscovery,

  // VALIDATION
  '/api/validate-email':   validateEmailDiscovery,
  '/api/phone-validate':   phoneValidateDiscovery,
  '/api/url-parse':        urlParseDiscovery,
  '/api/json-validate':    jsonValidateDiscovery,
  '/api/jwt-decode':       jwtDecodeDiscovery,
  '/api/password-strength': passwordStrengthDiscovery,
  '/api/regex':            regexDiscovery,

  // TOOLS
  '/api/hash':         hashDiscovery,
  '/api/password':     passwordGenDiscovery,
  '/api/qrcode-gen':   qrcodeGenDiscovery,
  '/api/color':        colorDiscovery,
  '/api/cron-parse':   cronParseDiscovery,
  '/api/http-status':  httpStatusDiscovery,
  '/api/unit-convert': unitConvertDiscovery,
  '/api/dns':          dnsDiscovery,
  '/api/whois':        whoisDiscovery,
  '/api/ssl-check':    sslCheckDiscovery,
  '/api/uuid':         uuidDiscovery,
  '/api/headers':      headersDiscovery,
  '/api/url-shorten':  urlShortenDiscovery,

  // AI
  '/api/image':        imageDiscovery,
  '/api/sentiment':    sentimentDiscovery,
  '/api/code':         codeExecDiscovery,
  '/api/code-review':  codeReviewDiscovery,
  '/api/math':         mathDiscovery,
  // text-stats removed — endpoint does not exist in wrappers

  // MISC
  '/api/joke':         jokeDiscovery,
  '/api/wikipedia':    wikipediaDiscovery,
  '/api/dictionary':   dictionaryDiscovery,
  '/api/countries':    countriesDiscovery,
  '/api/github':       githubDiscovery,
  '/api/npm':          npmDiscovery,
  '/api/holidays':     holidaysDiscovery,
  '/api/geocoding':    geocodeDiscovery,
  '/api/airquality':   airqualityDiscovery,
  '/api/quote':        quoteDiscovery,
  '/api/facts':        factsDiscovery,
  '/api/dogs':         dogsDiscovery,

  // INTELLIGENCE
  '/api/contract-risk':       contractRiskDiscovery,
  '/api/email-parse':         emailParseDiscovery,
  '/api/table-insights':      tableInsightsDiscovery,
  '/api/domain-report':       domainReportDiscovery,
  '/api/seo-audit':           seoAuditDiscovery,
  '/api/lead-score':          leadScoreDiscovery,
  '/api/crypto-intelligence':  cryptoIntelligenceDiscovery,
};

// ─────────────────────────────────────────────────────────────────────────────
// generateDiscoveryForService — auto-generates a basic GET discovery extension
// from dynamic service metadata (external providers registered on the Bazaar).
//
// @param {object} service  Object with shape:
//   { name, description, url, method, price }
// @returns {object}  A discovery extension compatible with declareDiscoveryExtension
// ─────────────────────────────────────────────────────────────────────────────
function generateDiscoveryForService(service) {
  const { name = 'unknown', description = '', method = 'GET' } = service;
  const isPost = typeof method === 'string' && method.toUpperCase() === 'POST';

  if (isPost) {
    return declareDiscoveryExtension({
      bodyType: 'json',
      input: {},
      inputSchema: { properties: {} },
      output: {
        example: {
          success: true,
          service: name,
          description,
          data: null
        }
      }
    });
  }

  return declareDiscoveryExtension({
    input: {},
    inputSchema: { properties: {} },
    output: {
      example: {
        success: true,
        service: name,
        description,
        data: null
      }
    }
  });
}

module.exports = { discoveryMap, generateDiscoveryForService };
