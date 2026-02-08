require('dotenv').config();
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');
const OpenAI = require('openai');

// ─── Config ──────────────────────────────────────────────────────────
const SERVER_URL = process.env.DEMO_SERVER_URL || 'http://localhost:3000';
const MISSION = process.argv[2] || 'Find the current weather in Paris and the price of Bitcoin in USD';
const MAX_TURNS = 10;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── ANSI Colors ─────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgBlue: '\x1b[44m',
    bgGreen: '\x1b[42m',
};

// ─── Terminal UI ─────────────────────────────────────────────────────
function box(title, content, color = c.cyan) {
    const width = 60;
    const line = '\u2500'.repeat(width - 2);
    console.log(`\n${color}\u250c${line}\u2510${c.reset}`);
    console.log(`${color}\u2502${c.reset} ${c.bold}${title}${c.reset}${' '.repeat(Math.max(0, width - title.length - 4))}${color}\u2502${c.reset}`);
    if (content) {
        console.log(`${color}\u251c${line}\u2524${c.reset}`);
        const lines = content.split('\n');
        for (const l of lines) {
            const trimmed = l.slice(0, width - 4);
            console.log(`${color}\u2502${c.reset} ${trimmed}${' '.repeat(Math.max(0, width - trimmed.length - 4))}${color}\u2502${c.reset}`);
        }
    }
    console.log(`${color}\u2514${line}\u2518${c.reset}\n`);
}

function step(num, text) {
    console.log(`${c.blue}${c.bold}[Step ${num}]${c.reset} ${text}`);
}

function payment(text) {
    console.log(`  ${c.yellow}\u26a1 ${text}${c.reset}`);
}

function success(text) {
    console.log(`  ${c.green}\u2713 ${text}${c.reset}`);
}

function info(text) {
    console.log(`  ${c.dim}${text}${c.reset}`);
}

function thinking(text) {
    console.log(`  ${c.magenta}\u2737 Agent thinking: ${text}${c.reset}`);
}

// ─── HTTP + 402 Payment Flow ─────────────────────────────────────────
let wallet = null;
let totalSpent = 0;

async function payAndRequest(url, options = {}) {
    const res = await fetch(url, options);
    const body = await res.json();

    if (res.status !== 402) {
        return body;
    }

    // HTTP 402 - Payment Required
    const details = body.payment_details;
    payment(`HTTP 402 - ${details.action} costs ${details.amount} USDC`);

    const transfer = await wallet.createTransfer({
        amount: details.amount,
        assetId: Coinbase.assets.Usdc,
        destination: details.recipient,
    });
    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();

    totalSpent += parseFloat(details.amount);
    success(`Paid ${details.amount} USDC (tx: ${txHash.slice(0, 16)}...)`);

    // Retry with payment proof
    const retryHeaders = { ...options.headers, 'X-Payment-TxHash': txHash };
    const retryRes = await fetch(url, { ...options, headers: retryHeaders });
    return retryRes.json();
}

// ─── Tool Definitions (OpenAI Function Calling) ──────────────────────
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
            description: 'Search for services on the marketplace by keyword. Returns matching services with name, description, URL, and price. Costs USDC (paid automatically).',
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
            description: 'List all services available on the marketplace. Returns the full catalog with names, descriptions, URLs, and prices. Costs USDC (paid automatically).',
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
                    url: { type: 'string', description: 'The full API URL to call (e.g. "https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current_weather=true")' }
                },
                required: ['url']
            }
        }
    }
];

// ─── Tool Execution ──────────────────────────────────────────────────
async function executeTool(name, args) {
    switch (name) {
        case 'discover_marketplace': {
            info(`GET ${SERVER_URL}/`);
            const res = await fetch(SERVER_URL);
            return await res.json();
        }
        case 'search_services': {
            const q = args.query;
            info(`GET ${SERVER_URL}/search?q=${q}`);
            return await payAndRequest(`${SERVER_URL}/search?q=${encodeURIComponent(q)}`);
        }
        case 'list_all_services': {
            info(`GET ${SERVER_URL}/services`);
            return await payAndRequest(`${SERVER_URL}/services`);
        }
        case 'call_api': {
            info(`GET ${args.url}`);
            try {
                const res = await fetch(args.url);
                const text = await res.text();
                try {
                    return JSON.parse(text);
                } catch {
                    // Not JSON — return as text (truncated)
                    return { response: text.slice(0, 2000) };
                }
            } catch (err) {
                return { error: err.message };
            }
        }
        default:
            return { error: `Unknown tool: ${name}` };
    }
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
    box('x402 BAZAAR - Autonomous AI Agent Demo', MISSION, c.cyan);

    // Step 1: Setup Coinbase SDK
    step(1, 'Initializing Coinbase SDK...');
    Coinbase.configure({
        apiKeyName: process.env.COINBASE_API_KEY,
        privateKey: process.env.COINBASE_API_SECRET,
    });
    success('Coinbase SDK configured');

    // Step 2: Create ephemeral wallet
    step(2, 'Creating ephemeral agent wallet on Base Sepolia...');
    wallet = await Wallet.create({ networkId: Coinbase.networks.BaseSepolia });
    const address = await wallet.getDefaultAddress();
    success(`Wallet: ${address.toString()}`);

    // Step 3: Fund from faucet
    step(3, 'Requesting testnet funds from faucet...');
    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    const faucetEth = await wallet.faucet(Coinbase.assets.Eth);
    await faucetEth.wait({ timeoutSeconds: 60 });
    success('ETH received');

    await delay(3000);

    try {
        const faucetUsdc = await wallet.faucet(Coinbase.assets.Usdc);
        await faucetUsdc.wait({ timeoutSeconds: 60 });
        success('USDC received from faucet');
    } catch {
        payment('Faucet rate-limited, funding from server wallet...');
        const serverWallet = await Wallet.fetch(process.env.WALLET_ID);
        const agentAddr = (await wallet.getDefaultAddress()).getId();
        const fundTransfer = await serverWallet.createTransfer({
            amount: 1.0,
            assetId: Coinbase.assets.Usdc,
            destination: agentAddr,
        });
        await fundTransfer.wait({ timeoutSeconds: 120 });
        success('1.0 USDC received from server wallet');
    }

    const balance = await wallet.getBalance(Coinbase.assets.Usdc);
    success(`Balance: ${balance} USDC`);

    if (Number(balance) < 0.05) {
        console.log(`\n${c.red}Not enough USDC to continue. Check server wallet balance.${c.reset}`);
        process.exit(1);
    }

    // Step 4: LLM Agent Loop
    step(4, 'Starting LLM agent loop (GPT-4o-mini)...');
    console.log('');

    const messages = [
        {
            role: 'system',
            content: `You are an autonomous AI agent operating on the x402 Bazaar marketplace.
Your job is to fulfill the user's mission by discovering services on the marketplace, paying for access with USDC, and calling the actual APIs to get real data.

Workflow:
1. First, discover the marketplace to understand what's available
2. Search for relevant services matching the mission
3. Call the actual API URLs to fetch the data you need
4. Synthesize the results into a clear, helpful answer

You have a USDC wallet that automatically handles payments when accessing paid marketplace endpoints.
Always explain your reasoning before each action.`
        },
        {
            role: 'user',
            content: `Mission: ${MISSION}`
        }
    ];

    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
        turnCount++;
        console.log(`${c.blue}--- Turn ${turnCount}/${MAX_TURNS} ---${c.reset}`);

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            tools,
            tool_choice: turnCount === 1 ? 'auto' : 'auto',
        });

        const msg = response.choices[0].message;
        messages.push(msg);

        // If the model wants to speak
        if (msg.content) {
            thinking(msg.content.slice(0, 200));
        }

        // If no tool calls, we're done
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            break;
        }

        // Execute each tool call
        for (const call of msg.tool_calls) {
            const fnName = call.function.name;
            const fnArgs = JSON.parse(call.function.arguments || '{}');

            console.log(`  ${c.cyan}\u2192 Calling: ${fnName}(${JSON.stringify(fnArgs)})${c.reset}`);

            const result = await executeTool(fnName, fnArgs);

            // Truncate large results for the LLM context
            let resultStr = JSON.stringify(result);
            if (resultStr.length > 3000) {
                resultStr = resultStr.slice(0, 3000) + '... [truncated]';
            }

            success(`Result received (${resultStr.length} chars)`);

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: resultStr,
            });
        }
    }

    // Extract final answer
    const lastMsg = messages[messages.length - 1];
    const finalAnswer = lastMsg.role === 'assistant' && lastMsg.content
        ? lastMsg.content
        : '(Agent completed without a final text response)';

    // Final output
    box('MISSION COMPLETE', finalAnswer, c.green);

    // Cost summary
    const finalBalance = await wallet.getBalance(Coinbase.assets.Usdc);
    box('COST SUMMARY', [
        `Marketplace payments: ${totalSpent.toFixed(4)} USDC`,
        `LLM turns used:       ${turnCount}/${MAX_TURNS}`,
        `Remaining balance:    ${finalBalance} USDC`,
    ].join('\n'), c.yellow);
}

main().catch(err => {
    console.error(`\n${c.red}Agent error: ${err.message}${c.reset}`);
    if (err.stack) console.error(c.dim + err.stack + c.reset);
    process.exit(1);
});
