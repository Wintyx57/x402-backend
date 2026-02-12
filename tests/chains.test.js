// tests/chains.test.js — Unit tests for lib/chains.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CHAINS, DEFAULT_CHAIN_KEY, DEFAULT_CHAIN, getChainConfig, NETWORK } = require('../lib/chains');

describe('chains', () => {
    describe('CHAINS object', () => {
        it('should contain base, base-sepolia, and skale', () => {
            assert.ok(CHAINS.base);
            assert.ok(CHAINS['base-sepolia']);
            assert.ok(CHAINS.skale);
        });

        it('each chain should have required fields', () => {
            for (const [key, chain] of Object.entries(CHAINS)) {
                assert.ok(chain.rpcUrl, `${key} missing rpcUrl`);
                assert.ok(chain.usdcContract, `${key} missing usdcContract`);
                assert.equal(typeof chain.chainId, 'number', `${key} chainId should be a number`);
                assert.ok(chain.explorer, `${key} missing explorer`);
                assert.ok(chain.label, `${key} missing label`);
            }
        });

        it('base chain should have correct chainId', () => {
            assert.equal(CHAINS.base.chainId, 8453);
        });

        it('base-sepolia chain should have correct chainId', () => {
            assert.equal(CHAINS['base-sepolia'].chainId, 84532);
        });

        it('skale chain should have correct chainId', () => {
            assert.equal(CHAINS.skale.chainId, 2046399126);
        });
    });

    describe('DEFAULT_CHAIN_KEY', () => {
        it('should be a string', () => {
            assert.equal(typeof DEFAULT_CHAIN_KEY, 'string');
        });

        it('should be a valid key in CHAINS', () => {
            assert.ok(CHAINS[DEFAULT_CHAIN_KEY], `DEFAULT_CHAIN_KEY "${DEFAULT_CHAIN_KEY}" not found in CHAINS`);
        });
    });

    describe('DEFAULT_CHAIN', () => {
        it('should match CHAINS[DEFAULT_CHAIN_KEY]', () => {
            assert.deepStrictEqual(DEFAULT_CHAIN, CHAINS[DEFAULT_CHAIN_KEY]);
        });
    });

    describe('getChainConfig()', () => {
        it('should return base config for "base"', () => {
            const cfg = getChainConfig('base');
            assert.equal(cfg.chainId, 8453);
            assert.equal(cfg.label, 'Base');
        });

        it('should return skale config for "skale"', () => {
            const cfg = getChainConfig('skale');
            assert.equal(cfg.chainId, 2046399126);
            assert.equal(cfg.label, 'SKALE Europa');
        });

        it('should return base-sepolia config for "base-sepolia"', () => {
            const cfg = getChainConfig('base-sepolia');
            assert.equal(cfg.chainId, 84532);
        });

        it('should fallback to DEFAULT_CHAIN for unknown chain key', () => {
            const cfg = getChainConfig('unknown-chain');
            assert.deepStrictEqual(cfg, CHAINS[DEFAULT_CHAIN_KEY]);
        });

        it('should fallback to DEFAULT_CHAIN for undefined', () => {
            const cfg = getChainConfig(undefined);
            assert.deepStrictEqual(cfg, CHAINS[DEFAULT_CHAIN_KEY]);
        });

        it('should fallback to DEFAULT_CHAIN for empty string', () => {
            const cfg = getChainConfig('');
            assert.deepStrictEqual(cfg, CHAINS[DEFAULT_CHAIN_KEY]);
        });
    });

    describe('NETWORK', () => {
        it('should be a string', () => {
            assert.equal(typeof NETWORK, 'string');
        });
    });
});
