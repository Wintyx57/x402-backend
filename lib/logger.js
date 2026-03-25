// lib/logger.js — Structured JSON logger (no external deps)
// Levels: debug < info < warn < error
// LOG_LEVEL env controls minimum level (default: info, set to debug for verbose)

let emitter = null;
function getEmitter() {
    if (!emitter) {
        try { emitter = require('./log-emitter'); } catch { /* intentionally silent — log-emitter is optional */ }
    }
    return emitter;
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, context, message, extra = {}) {
    if (LEVELS[level] < MIN_LEVEL) return;

    const entry = {
        ts: new Date().toISOString(),
        level,
        ctx: context,
        msg: message,
        ...extra,
    };
    const output = JSON.stringify(entry);
    if (level === 'error') {
        process.stderr.write(output + '\n');
    } else {
        process.stdout.write(output + '\n');
    }
    // Emit to SSE stream (non-blocking, fire-and-forget)
    try { getEmitter()?.emit('log', entry); } catch { /* intentionally silent — avoid infinite recursion in logger */ }
}

const logger = {
    debug(context, message, extra = {}) {
        log('debug', context, message, extra);
    },
    info(context, message, extra = {}) {
        log('info', context, message, extra);
    },
    warn(context, message, extra = {}) {
        log('warn', context, message, extra);
    },
    error(context, message, extra = {}) {
        log('error', context, message, extra);
    },
};

module.exports = logger;
