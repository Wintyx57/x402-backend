// lib/log-emitter.js — Singleton EventEmitter for real-time log/monitoring streams
// Emits:
//   'log'               — { ts, level, ctx, msg, ...extra }
//   'monitor-transition'— { endpoint, label, from, to, latency }

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // Support up to 100 concurrent SSE clients

module.exports = emitter;
