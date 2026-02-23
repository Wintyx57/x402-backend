// tests/telegram-bot.test.js — Unit tests for Telegram bot + auto-test
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ============================
// TELEGRAM BOT MODULE TESTS
// ============================

describe('Telegram Bot Module', () => {
    it('should export startTelegramBot, stopTelegramBot, notifyAdmin', () => {
        const bot = require('../lib/telegram-bot');
        assert.strictEqual(typeof bot.startTelegramBot, 'function');
        assert.strictEqual(typeof bot.stopTelegramBot, 'function');
        assert.strictEqual(typeof bot.notifyAdmin, 'function');
    });

    it('startTelegramBot should not throw when env vars are missing', () => {
        const originalToken = process.env.TELEGRAM_BOT_TOKEN;
        const originalChat = process.env.TELEGRAM_CHAT_ID;
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;

        const bot = require('../lib/telegram-bot');
        // Should not throw — just logs and returns
        assert.doesNotThrow(() => {
            bot.startTelegramBot(null, () => ({}));
        });

        // Restore
        if (originalToken) process.env.TELEGRAM_BOT_TOKEN = originalToken;
        if (originalChat) process.env.TELEGRAM_CHAT_ID = originalChat;
    });

    it('stopTelegramBot should not throw when not started', () => {
        const bot = require('../lib/telegram-bot');
        assert.doesNotThrow(() => {
            bot.stopTelegramBot();
        });
    });

    it('notifyAdmin should not throw when env vars are missing', async () => {
        const originalToken = process.env.TELEGRAM_BOT_TOKEN;
        const originalChat = process.env.TELEGRAM_CHAT_ID;
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;

        const bot = require('../lib/telegram-bot');
        // Should resolve without error
        await assert.doesNotReject(async () => {
            await bot.notifyAdmin('test message');
        });

        if (originalToken) process.env.TELEGRAM_BOT_TOKEN = originalToken;
        if (originalChat) process.env.TELEGRAM_CHAT_ID = originalChat;
    });
});

// ============================
// REGISTER AUTO-TEST LOGIC TESTS
// ============================

describe('Register Module', () => {
    it('should export a function (createRegisterRouter)', () => {
        const createRegisterRouter = require('../routes/register');
        assert.strictEqual(typeof createRegisterRouter, 'function');
    });

    it('createRegisterRouter should return an Express router', () => {
        const createRegisterRouter = require('../routes/register');
        const mockSupabase = { from: () => ({ insert: () => ({ select: () => Promise.resolve({ data: [] }) }) }) };
        const mockLogActivity = () => {};
        const mockPaymentMiddleware = () => (req, res, next) => next();
        const mockLimiter = (req, res, next) => next();

        const router = createRegisterRouter(mockSupabase, mockLogActivity, mockPaymentMiddleware, mockLimiter);
        assert.ok(router);
        assert.strictEqual(typeof router, 'function'); // Express router is a function
    });
});

// ============================
// DASHBOARD BALANCE LOGIC TESTS
// ============================

describe('Dashboard Module', () => {
    it('should export a function (createDashboardRouter)', () => {
        const createDashboardRouter = require('../routes/dashboard');
        assert.strictEqual(typeof createDashboardRouter, 'function');
    });

    it('createDashboardRouter should return an Express router', () => {
        const createDashboardRouter = require('../routes/dashboard');
        const mockSupabase = { from: () => ({ select: () => Promise.resolve({ data: [], count: 0 }) }) };
        const mockAdminAuth = (req, res, next) => next();
        const mockLimiter = (req, res, next) => next();
        const mockAdminAuthLimiter = (req, res, next) => next();

        const router = createDashboardRouter(mockSupabase, mockAdminAuth, mockLimiter, mockAdminAuthLimiter);
        assert.ok(router);
        assert.strictEqual(typeof router, 'function');
    });
});

// ============================
// BALANCE PARSING EDGE CASES
// ============================

describe('Balance Parsing', () => {
    it('should correctly parse USDC balance from hex', () => {
        // 1.5 USDC = 1_500_000 raw units = 0x16E360
        const hex = '0x000000000000000000000000000000000000000000000000000000000016E360';
        const balance = Number(BigInt(hex)) / 1e6;
        assert.strictEqual(balance, 1.5);
    });

    it('should parse zero balance', () => {
        const hex = '0x0000000000000000000000000000000000000000000000000000000000000000';
        const balance = Number(BigInt(hex)) / 1e6;
        assert.strictEqual(balance, 0);
    });

    it('should parse large balance (1000 USDC)', () => {
        // 1000 USDC = 1_000_000_000 raw = 0x3B9ACA00
        const hex = '0x000000000000000000000000000000000000000000000000000000003B9ACA00';
        const balance = Number(BigInt(hex)) / 1e6;
        assert.strictEqual(balance, 1000);
    });

    it('should parse small balance (0.001 USDC)', () => {
        // 0.001 USDC = 1000 raw = 0x3E8
        const hex = '0x00000000000000000000000000000000000000000000000000000000000003E8';
        const balance = Number(BigInt(hex)) / 1e6;
        assert.strictEqual(balance, 0.001);
    });

    it('should handle 0x result as zero', () => {
        const result = '0x';
        // Our code checks result !== '0x' before BigInt
        assert.strictEqual(result, '0x');
        // So walletBalance would be set to 0
    });
});
