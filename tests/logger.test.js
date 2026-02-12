// tests/logger.test.js — Unit tests for lib/logger.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../lib/logger');

describe('logger', () => {
    it('should export info, warn, and error functions', () => {
        assert.equal(typeof logger.info, 'function');
        assert.equal(typeof logger.warn, 'function');
        assert.equal(typeof logger.error, 'function');
    });

    it('info() should not throw', () => {
        assert.doesNotThrow(() => logger.info('test', 'hello'));
    });

    it('warn() should not throw', () => {
        assert.doesNotThrow(() => logger.warn('test', 'warning message'));
    });

    it('error() should not throw', () => {
        assert.doesNotThrow(() => logger.error('test', 'error message'));
    });

    it('should handle extra arguments without throwing', () => {
        assert.doesNotThrow(() => logger.info('ctx', 'msg', { key: 'val' }, 42));
        assert.doesNotThrow(() => logger.warn('ctx', 'msg', 'extra1', 'extra2'));
        assert.doesNotThrow(() => logger.error('ctx', 'msg', new Error('test')));
    });

    it('should handle empty strings without throwing', () => {
        assert.doesNotThrow(() => logger.info('', ''));
        assert.doesNotThrow(() => logger.warn('', ''));
        assert.doesNotThrow(() => logger.error('', ''));
    });
});
