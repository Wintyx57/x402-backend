// routes/stream.js — Server-Sent Events (SSE) for real-time feeds
// Routes (admin-protected):
//   GET /admin/stream/logs        — Backend log stream
//   GET /admin/stream/monitoring  — Monitoring status transitions

const express = require('express');
const logEmitter = require('../lib/log-emitter');
const { getStatus } = require('../lib/monitor');

// SSE helper — writes a well-formed SSE event
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// SSE keep-alive — prevent proxy/loadbalancer timeouts
const SSE_KEEPALIVE_MS = 20000;

function createStreamRouter(adminAuth) {
  const router = express.Router();

  // All stream routes require admin auth (applied per-route, not globally)

  // GET /admin/stream/logs — backend structured logs (real-time)
  router.get('/admin/stream/logs', adminAuth, (req, res) => {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send current monitoring status as first event
    sseWrite(res, 'connected', { ts: new Date().toISOString(), message: 'Log stream connected' });

    const onLog = (entry) => {
      sseWrite(res, 'log', entry);
    };

    logEmitter.on('log', onLog);

    // Keep-alive ping
    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_KEEPALIVE_MS);

    req.on('close', () => {
      logEmitter.off('log', onLog);
      clearInterval(ping);
    });
  });

  // GET /admin/stream/monitoring — monitoring transitions (real-time)
  router.get('/admin/stream/monitoring', adminAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send current status snapshot as first event
    sseWrite(res, 'snapshot', getStatus());

    const onTransition = (transition) => {
      sseWrite(res, 'transition', { ...transition, ts: new Date().toISOString() });
    };

    logEmitter.on('monitor-transition', onTransition);

    // Keep-alive ping
    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_KEEPALIVE_MS);

    req.on('close', () => {
      logEmitter.off('monitor-transition', onTransition);
      clearInterval(ping);
    });
  });

  return router;
}

module.exports = createStreamRouter;
