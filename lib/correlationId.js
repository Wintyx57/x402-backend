// lib/correlationId.js — Express middleware: attach a correlation ID to every request

const crypto = require('crypto');

function correlationId(req, res, next) {
    req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    res.setHeader('X-Correlation-ID', req.correlationId);
    next();
}

module.exports = correlationId;
