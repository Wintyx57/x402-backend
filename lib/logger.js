// lib/logger.js — Structured JSON logger (no external deps)

let emitter = null;
function getEmitter() {
    if (!emitter) {
        try { emitter = require('./log-emitter'); } catch { /* optional */ }
    }
    return emitter;
}

function log(level, context, message, extra = {}) {
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
    try { getEmitter()?.emit('log', entry); } catch { /* ignore */ }
}

const logger = {
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
