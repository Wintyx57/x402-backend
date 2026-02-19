// lib/logger.js — Structured JSON logger (no external deps)

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
