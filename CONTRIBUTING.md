# Contributing to x402 Bazaar

Thanks for your interest in contributing to x402 Bazaar!

## Quick Start

1. Fork the repo
2. Clone your fork
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and fill in your values
5. Start the server: `npm run dev`

## Adding a New API Wrapper

1. Create your endpoint in `server.js` following the existing pattern
2. Add payment middleware with appropriate pricing
3. Add input validation and rate limiting
4. Update the discovery route (`GET /`)
5. Add to `seed-wrappers.js`
6. Document in `API_WRAPPERS.md`

## Code Style

- Use `const` over `let` where possible
- Add input validation for all user inputs
- Never expose `err.message` to clients
- Follow existing patterns for error responses

## Reporting Issues

- Use GitHub Issues with the provided templates
- Include reproduction steps and environment details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
