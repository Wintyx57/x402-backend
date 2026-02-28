# Contributing to x402 Bazaar Backend

Thanks for your interest in contributing!

## Getting Started

1. Fork and clone the repo
2. Install dependencies: `npm install`
3. Copy environment config: `cp .env.example .env`
4. Fill in required env vars (see .env.example for docs)
5. Start the server: `node server.js`
6. Run tests: `npm test`

## Development

- **Runtime**: Node.js >= 18
- **Tests**: `node:test` (zero external dependencies)
- **Linting**: Follow existing code style
- **Logging**: Use `logger.*` from `lib/logger.js`, never `console.log`

## Making Changes

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Add tests if applicable
4. Run the test suite: `npm test`
5. Commit with a descriptive message
6. Open a Pull Request

## Adding a New API Wrapper

1. Add your route handler in `routes/wrappers/` (pick the right category file)
2. Register the endpoint in `seed-wrappers.js`
3. Add a test in `tests/`
4. Update `API_WRAPPERS.md`

## ERC-8004 Agent Identity

`erc8004.js` provides read-only helpers for verifying on-chain agent identities (Base mainnet).

**Contract addresses (Base mainnet):**
- `IDENTITY_REGISTRY` — `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- `REPUTATION_REGISTRY` — `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

**Exported helpers:**

```js
const { verifyAgent, getAgentInfo } = require('./erc8004');

// Check if an agent exists on-chain
const result = await verifyAgent(agentId);
// → { exists: true, owner, agentURI, wallet }

// Fetch full agent info (on-chain + registration JSON from agentURI)
const info = await getAgentInfo(agentId);
// → { agentId, owner, wallet, agentURI, registration, registry, chain, chainId }
```

**Notes:**
- Read-only — no wallet or private key required
- `verifyAgent` catches ERC721 reverts for non-existent tokens (returns `{ exists: false }`)
- `getAgentInfo` fetches the `agentURI` JSON with an 8s timeout; URI failures are silent (on-chain data still returned)
- `getAgentWallet` is optional per token — failures are silently ignored
- Uses `viem` with a public Base mainnet RPC (`https://mainnet.base.org`)

## Code Style

- Use `const` over `let` where possible
- Add input validation for all user inputs
- Never expose `err.message` to clients
- Follow existing patterns for error responses

## Reporting Issues

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
