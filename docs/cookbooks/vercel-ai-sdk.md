# Cookbook: Vercel AI SDK with x402 Bazaar

**Time**: 10 minutes
**Runs in**: Next.js, Nuxt, SvelteKit, or any Node.js backend
**Prerequisites**: Node 20+, an OpenAI / Anthropic / Mistral API key

The Vercel AI SDK is the standard way to add AI to a web app in 2026. It ships `streamText`, `generateObject`, and tool-calling in one tight API. x402 Bazaar plugs in as a tool provider, so your Next.js chat UI can pay real APIs on-chain.

---

## 1. Install

```bash
npm install ai @ai-sdk/openai @wintyx/x402-sdk
```

---

## 2. Set up the wallet

In a file outside your Next.js route (e.g. `lib/x402.ts`):

```ts
import { createClient } from "@wintyx/x402-sdk";

export const x402 = createClient({
  autoWallet: true,        // creates/loads ~/.x402-bazaar/wallet.json
  network: "skale",        // cheapest gas
  maxBudget: 1.0,          // hard cap per process restart: $1 USDC
});

// Log the address on first load so you can fund it
console.log("x402 wallet:", await x402.getAddress());
```

Fund it via https://x402bazaar.org/fund.

---

## 3. Expose x402 services as Vercel AI tools

```ts
import { tool } from "ai";
import { z } from "zod";
import { x402 } from "./x402";

export const x402Tools = {
  get_news: tool({
    description: "Search recent news headlines on a topic",
    parameters: z.object({
      topic: z.string().describe("what to search for"),
    }),
    execute: async ({ topic }) => {
      const result = await x402.callService("news", { q: topic });
      return result.data;
    },
  }),
  translate_text: tool({
    description: "Translate text into another language",
    parameters: z.object({
      text: z.string(),
      target_lang: z.string().describe("e.g. 'es', 'fr', 'de'"),
    }),
    execute: async ({ text, target_lang }) => {
      const result = await x402.callService("translate", { text, target: target_lang });
      return result.data;
    },
  }),
  analyze_sentiment: tool({
    description: "Get the sentiment (positive/neutral/negative) of a text",
    parameters: z.object({ text: z.string() }),
    execute: async ({ text }) => {
      const result = await x402.callService("sentiment", { text });
      return result.data;
    },
  }),
};
```

---

## 4. Use in a Next.js API route

`app/api/chat/route.ts`:

```ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { x402Tools } from "@/lib/x402-tools";

export const runtime = "nodejs";      // NOT "edge" -- wallet signing needs Node APIs
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: "You help users by calling paid APIs. Be concise.",
    messages,
    tools: x402Tools,
    maxSteps: 5,                       // up to 5 tool calls per turn
  });

  return result.toDataStreamResponse();
}
```

Frontend (`app/page.tsx`):

```tsx
"use client";
import { useChat } from "ai/react";

export default function Page() {
  const { messages, input, handleSubmit, handleInputChange } = useChat();
  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role}:</strong> {m.content}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

That's it. Submit "Headlines about Paris in Spanish, with sentiment" and the model streams tokens while paying APIs behind the scenes.

---

## 5. Production cautions

### Wallet per tenant, not per app
The example above uses one shared wallet for all users. In production you almost always want:
- One wallet per end-user (session) — so Alice's budget doesn't affect Bob's
- Or a per-tenant pooled wallet with per-session `maxBudget`

```ts
const perUserClient = createClient({
  privateKey: fetchUserPrivateKey(userId),   // HSM, KMS, or vault — NEVER localStorage
  network: "skale",
  maxBudget: 0.10,                           // $0.10 per session
});
```

### Edge vs Node runtime
The x402 SDK needs Node APIs (crypto signing). **Do not deploy to edge runtime** — use `export const runtime = "nodejs"`.

### Streaming + tool calls
Vercel AI SDK `streamText` natively streams both tokens AND tool calls. Your UI sees each tool call as an event (`onToolCall`) — perfect for showing "Calling translate API... paid $0.005" in the chat.

### Rate limits
x402 Bazaar enforces per-wallet rate limits. If you hit 429, the SDK retries with exponential backoff. For a chat UI, wrap tool errors in a user-friendly message rather than crashing the stream.

---

## 6. What you just shipped

- A Next.js chat app with paid API tools
- Each message can trigger up to 5 tool calls, each an on-chain USDC payment
- Providers earn 95% instantly; you keep no inventory
- Costs scale linearly with usage — no subscriptions

---

## 7. Next steps

- Add more x402 tools: web search, scraping, ML inference, trading data — see https://x402bazaar.org/services
- Switch to Anthropic (`@ai-sdk/anthropic`) if you need longer context — the tools API is identical
- Add streaming markers to your UI to show which tool is being called in real time
- Read the [security docs](https://github.com/Wintyx57/x402-backend/blob/main/SECURITY.md) for wallet & rate-limit best practices

Questions / issues: https://github.com/Wintyx57/x402-backend/issues
