// lib/logger.js — Structured logger (no external deps)

function timestamp() {
    return new Date().toISOString();
}

const logger = {
    info(context, message, ...args) {
        console.log(`[${timestamp()}] [INFO] [${context}] ${message}`, ...args);
    },
    warn(context, message, ...args) {
        console.warn(`[${timestamp()}] [WARN] [${context}] ${message}`, ...args);
    },
    error(context, message, ...args) {
        console.error(`[${timestamp()}] [ERROR] [${context}] ${message}`, ...args);
    },
};

module.exports = logger;
