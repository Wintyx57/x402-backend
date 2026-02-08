require('dotenv').config();
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');
const OpenAI = require('openai');
const readline = require('readline');

// ─── Config ──────────────────────────────────────────────────────────
const SERVER_URL = 'https://x402-api.onrender.com';
const MAX_TURNS = 10;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── ANSI Colors & Styles ───────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    blink: '\x1b[5m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─── ASCII Art Banner ───────────────────────────────────────────────
const BANNER = `
${c.brightYellow}${c.bold}          ██╗  ██╗██╗  ██╗ ██████╗ ██████╗
          ╚██╗██╔╝██║  ██║██╔═══██╗╚════██╗
           ╚███╔╝ ███████║██║   ██║ █████╔╝
           ██╔██╗ ╚════██║██║   ██║██╔═══╝
          ██╔╝ ██╗     ██║╚██████╔╝███████╗
          ╚═╝  ╚═╝     ╚═╝ ╚═════╝ ╚══════╝${c.reset}
${c.white}${c.bold}          ━━━ B A Z A A R ━━━${c.reset}
${c.gray}        Autonomous AI Agent Demo${c.reset}
${c.gray}       Protocol: HTTP 402 Payment Required${c.reset}
${c.brightGreen}       Network:  Base Mainnet (Real USDC)${c.reset}
`;

// ─── Spinner Animation ─────────────────────────────────────────────
function createSpinner(text) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const interval = setInterval(() => {
        process.stdout.write(`\r  ${c.magenta}${frames[i % frames.length]}${c.reset} ${c.dim}${text}${c.reset}`);
        i++;
    }, 80);
    return {
        stop: (finalText) => {
            clearInterval(interval);
            process.stdout.write('\r' + ' '.repeat(text.length + 20) + '\r');
            if (finalText) console.log(finalText);
        }
    };
}

// ─── Typewriter Effect ──────────────────────────────────────────────
async function typewriter(text, speed = 20) {
    for (let i = 0; i < text.length; i++) {
        process.stdout.write(text[i]);
        if (text[i] === '\n') {
            await delay(speed * 2);
        } else {
            await delay(speed);
        }
    }
    console.log('');
}

// ─── UI Components ──────────────────────────────────────────────────
function horizontalRule(char = '━', length = 64, color = c.gray) {
    console.log(`${color}${char.repeat(length)}${c.reset}`);
}

function sectionHeader(title, icon = '▸') {
    console.log('');
    horizontalRule();
    console.log(`  ${c.brightWhite}${c.bold}${icon} ${title}${c.reset}`);
    horizontalRule();
}

function box(lines, borderColor = c.cyan, width = 60) {
    const h = '─'.repeat(width - 2);
    console.log(`  ${borderColor}┌${h}┐${c.reset}`);
    for (const line of lines) {
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
        const padding = Math.max(0, width - stripped.length - 4);
        console.log(`  ${borderColor}│${c.reset} ${line}${' '.repeat(padding)} ${borderColor}│${c.reset}`);
    }
    console.log(`  ${borderColor}└${h}┘${c.reset}`);
}

function keyValue(key, value, keyColor = c.gray, valueColor = c.white) {
    console.log(`  ${keyColor}${key}:${c.reset} ${valueColor}${value}${c.reset}`);
}

// ─── Payment Flow Visualization ─────────────────────────────────────
let wallet = null;
let totalSpent = 0;
let payments = [];

async function payAndRequest(url, options = {}) {
    const res = await fetch(url, options);
    const body = await res.json();

    if (res.status !== 402) {
        return body;
    }

    // HTTP 402 - Payment Required
    const details = body.payment_details;

    console.log('');
    console.log(`  ${c.brightYellow}${c.bold}⚡ HTTP 402 — Payment Required${c.reset}`);
    box([
        `${c.gray}Action:${c.reset}  ${c.white}${details.action}${c.reset}`,
        `${c.gray}Amount:${c.reset}  ${c.brightYellow}${c.bold}${details.amount} USDC${c.reset}`,
        `${c.gray}To:${c.reset}      ${c.cyan}${details.recipient.slice(0, 6)}...${details.recipient.slice(-4)}${c.reset}`,
        `${c.gray}Network:${c.reset} ${c.green}Base Mainnet${c.reset}`,
    ], c.yellow);

    // Animated payment
    const spinner = createSpinner('Sending USDC payment on Base...');

    const transfer = await wallet.createTransfer({
        amount: details.amount,
        assetId: Coinbase.assets.Usdc,
        destination: details.recipient,
    });

    spinner.stop();
    const spinner2 = createSpinner('Waiting for on-chain confirmation...');

    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();

    spinner2.stop();

    totalSpent += parseFloat(details.amount);
    payments.push({
        action: details.action,
        amount: parseFloat(details.amount),
        txHash,
        time: new Date().toISOString(),
    });

    console.log(`  ${c.brightGreen}${c.bold}✓ Payment confirmed!${c.reset}`);
    console.log(`  ${c.gray}Tx:${c.reset} ${c.cyan}${c.underline}https://basescan.org/tx/${txHash}${c.reset}`);
    console.log('');

    // Retry with payment proof
    const spinner3 = createSpinner('Accessing paid endpoint...');
    const retryHeaders = { ...options.headers, 'X-Payment-TxHash': txHash };
    const retryRes = await fetch(url, { ...options, headers: retryHeaders });
    const result = await retryRes.json();
    spinner3.stop(`  ${c.brightGreen}✓${c.reset} ${c.white}Data received${c.reset}`);

    return result;
}

// ─── Tool Definitions ───────────────────────────────────────────────
const tools = [
    {
        type: 'function',
        function: {
            name: 'discover_marketplace',
            description: 'Discover the x402 Bazaar marketplace. Returns name, description, available endpoints, and total services count. This is free (no payment needed).',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_services',
            description: 'Search for services on the marketplace by keyword. Returns matching services with name, description, URL, and price. Costs 0.05 USDC (paid automatically via x402 protocol).',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search keyword (e.g. "weather", "crypto", "currency")' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_all_services',
            description: 'List all services available on the marketplace. Returns the full catalog with names, descriptions, URLs, and prices. Costs 0.05 USDC (paid automatically via x402 protocol).',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'call_api',
            description: 'Call an external API URL directly and return the JSON response. Use this to fetch data from service URLs found on the marketplace.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The full API URL to call' }
                },
                required: ['url']
            }
        }
    }
];

// ─── Tool Execution ─────────────────────────────────────────────────
async function executeTool(name, args) {
    switch (name) {
        case 'discover_marketplace': {
            const spinner = createSpinner('Discovering marketplace...');
            const res = await fetch(SERVER_URL);
            const data = await res.json();
            spinner.stop(`  ${c.brightGreen}✓${c.reset} ${c.white}Marketplace discovered: ${c.bold}${data.total_services}${c.reset}${c.white} services available${c.reset}`);
            return data;
        }
        case 'search_services': {
            console.log(`  ${c.cyan}→${c.reset} ${c.white}Searching for "${c.bold}${args.query}${c.reset}${c.white}"...${c.reset}`);
            const result = await payAndRequest(`${SERVER_URL}/search?q=${encodeURIComponent(args.query)}`);
            if (result.data && result.data.length > 0) {
                console.log(`  ${c.brightGreen}✓${c.reset} ${c.white}Found ${c.bold}${result.count}${c.reset}${c.white} service(s):${c.reset}`);
                for (const s of result.data) {
                    console.log(`    ${c.gray}•${c.reset} ${c.white}${s.name}${c.reset} ${c.gray}—${c.reset} ${c.brightYellow}${s.price_usdc} USDC${c.reset}`);
                }
            } else {
                console.log(`  ${c.yellow}⚠${c.reset} ${c.white}No results for "${args.query}"${c.reset}`);
            }
            return result;
        }
        case 'list_all_services': {
            console.log(`  ${c.cyan}→${c.reset} ${c.white}Listing all services...${c.reset}`);
            const result = await payAndRequest(`${SERVER_URL}/services`);
            if (result.data) {
                console.log(`  ${c.brightGreen}✓${c.reset} ${c.white}${c.bold}${result.count}${c.reset}${c.white} services in catalog${c.reset}`);
            }
            return result;
        }
        case 'call_api': {
            console.log(`  ${c.cyan}→${c.reset} ${c.white}Calling API: ${c.dim}${args.url.slice(0, 60)}...${c.reset}`);
            const spinner = createSpinner('Fetching API response...');
            try {
                const res = await fetch(args.url);
                const text = await res.text();
                spinner.stop(`  ${c.brightGreen}✓${c.reset} ${c.white}API response received${c.reset}`);
                try {
                    return JSON.parse(text);
                } catch {
                    return { response: text.slice(0, 2000) };
                }
            } catch (err) {
                spinner.stop(`  ${c.red}✗${c.reset} ${c.white}API call failed: ${err.message}${c.reset}`);
                return { error: err.message };
            }
        }
        default:
            return { error: `Unknown tool: ${name}` };
    }
}

// ─── Mission Presets ────────────────────────────────────────────────
const MISSIONS = [
    'Find the current weather in Paris and the price of Bitcoin in USD',
    'Search the marketplace for AI services and list what\'s available',
    'Find a weather API and get the forecast for New York City',
    'Discover all available services and find the cheapest one',
];

async function selectMission() {
    const missionArg = process.argv[2];
    if (missionArg) return missionArg;

    console.log(`\n  ${c.brightWhite}${c.bold}Select a mission:${c.reset}\n`);
    MISSIONS.forEach((m, i) => {
        console.log(`  ${c.brightYellow}${i + 1}${c.reset} ${c.gray}›${c.reset} ${c.white}${m}${c.reset}`);
    });
    console.log(`  ${c.brightYellow}C${c.reset} ${c.gray}›${c.reset} ${c.white}Custom mission${c.reset}`);
    console.log('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`  ${c.brightCyan}Choice:${c.reset} `, async (answer) => {
            const num = parseInt(answer);
            if (num >= 1 && num <= MISSIONS.length) {
                rl.close();
                resolve(MISSIONS[num - 1]);
            } else if (answer.toLowerCase() === 'c') {
                rl.question(`  ${c.brightCyan}Enter your mission:${c.reset} `, (custom) => {
                    rl.close();
                    resolve(custom.trim() || MISSIONS[0]);
                });
            } else {
                rl.close();
                resolve(MISSIONS[0]);
            }
        });
    });
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
    console.clear();
    console.log(BANNER);
    await delay(500);

    const mission = await selectMission();

    // ─── Ready Screen (wait for OBS / presenter) ──────────────
    sectionHeader('MISSION', '🎯');
    await typewriter(`  ${c.brightWhite}${mission}${c.reset}`, 25);
    console.log('');
    console.log(`  ${c.bgYellow}${c.bold}${c.bgBlack}                                                        ${c.reset}`);
    console.log(`  ${c.bgYellow}${c.bold}${c.bgBlack}   ${c.brightYellow}▶  Press ENTER when ready to start the demo...${c.reset}${c.bgBlack}      ${c.reset}`);
    console.log(`  ${c.bgYellow}${c.bold}${c.bgBlack}                                                        ${c.reset}`);
    console.log('');

    await new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('', () => { rl.close(); resolve(); });
    });

    console.clear();
    console.log(BANNER);
    sectionHeader('MISSION', '🎯');
    console.log(`  ${c.brightWhite}${mission}${c.reset}`);
    console.log('');
    await delay(500);

    // ─── Step 1: Wallet Setup ───────────────────────────────────
    sectionHeader('STEP 1 — Wallet Initialization', '🔑');

    const spinner1 = createSpinner('Initializing Coinbase SDK...');
    Coinbase.configure({
        apiKeyName: process.env.COINBASE_API_KEY,
        privateKey: process.env.COINBASE_API_SECRET,
    });
    await delay(500);
    spinner1.stop(`  ${c.brightGreen}✓${c.reset} ${c.white}Coinbase SDK configured${c.reset}`);

    const spinner2 = createSpinner('Loading wallet on Base Mainnet...');
    const seedData = require('./agent-seed.json');
    const seedWalletId = Object.keys(seedData)[0];
    wallet = await Wallet.fetch(seedWalletId);
    await wallet.loadSeed('agent-seed.json');
    const address = await wallet.getDefaultAddress();
    spinner2.stop(`  ${c.brightGreen}✓${c.reset} ${c.white}Wallet loaded${c.reset}`);

    const spinner3 = createSpinner('Checking USDC balance...');
    const balance = await wallet.getBalance(Coinbase.assets.Usdc);
    spinner3.stop();

    const addrStr = address.getId();
    console.log('');
    box([
        `${c.gray}Address:${c.reset} ${c.cyan}${addrStr.slice(0, 6)}...${addrStr.slice(-4)}${c.reset}`,
        `${c.gray}Balance:${c.reset} ${c.brightGreen}${c.bold}${balance} USDC${c.reset}`,
        `${c.gray}Network:${c.reset} ${c.white}Base Mainnet (chainId 8453)${c.reset}`,
        `${c.gray}Explorer:${c.reset} ${c.cyan}${c.underline}https://basescan.org/address/${addrStr}${c.reset}`,
    ], c.green);

    if (Number(balance) < 0.05) {
        console.log(`\n  ${c.brightRed}${c.bold}✗ Insufficient USDC balance.${c.reset}`);
        console.log(`  ${c.gray}Need at least 0.05 USDC. Current: ${balance}${c.reset}`);
        process.exit(1);
    }

    await delay(500);

    // ─── Step 2: Agent Loop ─────────────────────────────────────
    sectionHeader('STEP 2 — AI Agent Loop (GPT-4o-mini)', '🤖');
    console.log(`  ${c.gray}The agent will autonomously discover, pay, and query APIs.${c.reset}`);
    console.log(`  ${c.gray}Every paid endpoint triggers the x402 protocol flow:${c.reset}`);
    console.log(`  ${c.gray}  Request → HTTP 402 → USDC Payment → On-chain verification → Data${c.reset}`);
    console.log('');
    await delay(1000);

    const messages = [
        {
            role: 'system',
            content: `You are an autonomous AI agent operating on the x402 Bazaar marketplace (${SERVER_URL}).
Your job is to fulfill the user's mission by discovering services on the marketplace, paying for access with USDC, and calling the actual APIs to get real data.

Workflow:
1. First, discover the marketplace to understand what's available
2. Search for relevant services matching the mission
3. Call the actual API URLs to fetch the data you need
4. Synthesize the results into a clear, helpful answer

You have a USDC wallet that automatically handles payments when accessing paid marketplace endpoints (x402 protocol).
Always explain your reasoning before each action. Be concise.`
        },
        {
            role: 'user',
            content: `Mission: ${mission}`
        }
    ];

    let turnCount = 0;
    const startTime = Date.now();

    while (turnCount < MAX_TURNS) {
        turnCount++;

        // Turn header
        console.log(`  ${c.bgBlue}${c.brightWhite}${c.bold} TURN ${turnCount}/${MAX_TURNS} ${c.reset}`);
        console.log('');

        // LLM thinking
        const spinnerLLM = createSpinner('Agent thinking...');
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            tools,
            tool_choice: 'auto',
        });
        const msg = response.choices[0].message;
        messages.push(msg);
        spinnerLLM.stop();

        // Display agent reasoning
        if (msg.content) {
            console.log(`  ${c.magenta}🧠 Agent:${c.reset}`);
            const lines = msg.content.split('\n');
            for (const line of lines) {
                console.log(`  ${c.dim}${c.italic}${line}${c.reset}`);
            }
            console.log('');
        }

        // If no tool calls, agent is done
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            break;
        }

        // Execute each tool call
        for (const call of msg.tool_calls) {
            const fnName = call.function.name;
            const fnArgs = JSON.parse(call.function.arguments || '{}');

            console.log(`  ${c.brightCyan}⚙${c.reset}  ${c.white}${c.bold}${fnName}${c.reset}${fnArgs.query ? `(${c.yellow}"${fnArgs.query}"${c.reset})` : fnArgs.url ? `(${c.dim}${fnArgs.url.slice(0, 50)}${c.reset})` : '()'}`);

            const result = await executeTool(fnName, fnArgs);

            // Truncate for LLM context
            let resultStr = JSON.stringify(result);
            if (resultStr.length > 3000) {
                resultStr = resultStr.slice(0, 3000) + '... [truncated]';
            }

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: resultStr,
            });
        }

        console.log('');
        horizontalRule('─', 64, c.gray);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ─── Final Answer ───────────────────────────────────────────
    sectionHeader('MISSION COMPLETE', '🏁');

    const lastMsg = messages[messages.length - 1];
    const finalAnswer = lastMsg.role === 'assistant' && lastMsg.content
        ? lastMsg.content
        : '(Agent completed without a final text response)';

    console.log('');
    await typewriter(`  ${c.brightWhite}${finalAnswer}${c.reset}`, 15);
    console.log('');

    // ─── Cost Summary ───────────────────────────────────────────
    sectionHeader('COST & PERFORMANCE REPORT', '📊');

    const finalBalance = await wallet.getBalance(Coinbase.assets.Usdc);

    console.log('');
    box([
        `${c.gray}Total spent:${c.reset}      ${c.brightYellow}${c.bold}${totalSpent.toFixed(4)} USDC${c.reset}  ${c.gray}(~$${totalSpent.toFixed(4)})${c.reset}`,
        `${c.gray}Payments made:${c.reset}    ${c.white}${payments.length}${c.reset}`,
        `${c.gray}LLM turns used:${c.reset}   ${c.white}${turnCount}/${MAX_TURNS}${c.reset}`,
        `${c.gray}Time elapsed:${c.reset}     ${c.white}${elapsed}s${c.reset}`,
        `${c.gray}Remaining balance:${c.reset} ${c.brightGreen}${finalBalance} USDC${c.reset}`,
    ], c.yellow, 60);

    // Payment Details
    if (payments.length > 0) {
        console.log('');
        console.log(`  ${c.brightWhite}${c.bold}On-chain transactions:${c.reset}`);
        console.log('');
        for (let i = 0; i < payments.length; i++) {
            const p = payments[i];
            console.log(`  ${c.gray}${i + 1}.${c.reset} ${c.white}${p.action}${c.reset} ${c.gray}—${c.reset} ${c.brightYellow}${p.amount} USDC${c.reset}`);
            console.log(`     ${c.cyan}${c.underline}https://basescan.org/tx/${p.txHash}${c.reset}`);
        }
    }

    // Protocol summary
    console.log('');
    horizontalRule();
    console.log(`  ${c.brightWhite}${c.bold}x402 Protocol Summary${c.reset}`);
    horizontalRule();
    console.log(`  ${c.gray}An AI agent autonomously:${c.reset}`);
    console.log(`  ${c.white}  1. Discovered a marketplace of ${c.bold}paid APIs${c.reset}`);
    console.log(`  ${c.white}  2. Hit ${c.brightYellow}HTTP 402${c.reset}${c.white} paywalls on each request${c.reset}`);
    console.log(`  ${c.white}  3. Paid ${c.brightYellow}${c.bold}real USDC${c.reset}${c.white} on ${c.brightGreen}Base mainnet${c.reset}`);
    console.log(`  ${c.white}  4. Got on-chain verification & received data${c.reset}`);
    console.log(`  ${c.white}  5. Synthesized results into a final answer${c.reset}`);
    console.log('');
    console.log(`  ${c.brightYellow}${c.bold}No API keys. No subscriptions. Just crypto.${c.reset}`);
    console.log(`  ${c.gray}${c.italic}x402 — the payment protocol for the agentic web.${c.reset}`);
    console.log('');
    horizontalRule('━', 64, c.brightYellow);
    console.log('');
}

main().catch(err => {
    console.error(`\n  ${c.brightRed}${c.bold}Agent Error:${c.reset} ${c.white}${err.message}${c.reset}`);
    if (err.stack) console.error(`${c.dim}${err.stack}${c.reset}`);
    process.exit(1);
});
