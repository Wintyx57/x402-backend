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

## Reporting Issues

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
