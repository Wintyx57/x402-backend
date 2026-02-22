// routes/community-agent.js — Proxy /admin/community-agent/* → community agent (port 3500)
//
// Toutes les routes sont protégées par adminAuth.
// L'agent tourne en companion process sur le même dyno Render.
// COMMUNITY_AGENT_URL env var permet de changer l'URL si nécessaire.

const express = require('express');
const http = require('http');
const https = require('https');

const AGENT_URL = process.env.COMMUNITY_AGENT_URL || 'http://localhost:3500';
const AGENT_TIMEOUT_MS = parseInt(process.env.COMMUNITY_AGENT_TIMEOUT_MS || '8000', 10);

// Headers HTTP hop-by-hop à ne pas forwarder
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
  'host', // on rewrite
]);

function buildAgentPath(reqPath, reqUrl) {
  // /admin/community-agent/foo → /api/foo
  const sub = reqPath === '/' ? '' : reqPath;
  const base = AGENT_URL.replace(/\/$/, '');
  const qs = reqUrl.includes('?') ? '?' + reqUrl.split('?')[1] : '';
  return base + '/api' + sub + qs;
}

function forwardRequest(req, res, agentFullUrl, body) {
  const parsed = new URL(agentFullUrl);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  // SSE connections must not timeout — detect by Accept header
  const isSSE = (req.headers.accept || '').includes('text/event-stream');

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 3500),
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: {},
    timeout: isSSE ? 0 : AGENT_TIMEOUT_MS,
  };

  // Forward headers (skip hop-by-hop)
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      options.headers[k] = v;
    }
  }

  // Set body + Content-Length if applicable
  if (body && body.length > 0) {
    options.headers['content-type'] = 'application/json';
    options.headers['content-length'] = Buffer.byteLength(body);
  }

  options.headers['host'] = parsed.host;

  const proxyReq = lib.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);
    // Forward response headers
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'community_agent_timeout', message: 'Community agent did not respond in time' });
    }
  });

  // For SSE: disable socket timeout on the client side too
  if (isSSE) {
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true);
  }

  proxyReq.on('error', (err) => {
    if (res.headersSent) return;
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'community_agent_unavailable', message: 'Community agent is not running' });
    }
    res.status(502).json({ error: 'community_agent_error', message: err.message });
  });

  if (body && body.length > 0) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

function createCommunityAgentRouter(adminAuth) {
  const router = express.Router();

  // Toutes les routes requièrent l'admin token
  router.use(adminAuth);

  // Wildcard proxy : /admin/community-agent/* → AGENT_URL/api/*
  router.all('{*path}', (req, res) => {
    const agentUrl = buildAgentPath(req.path, req.url);

    // Re-sérialise le body parsé par express.json() si nécessaire
    let body = '';
    if (req.body && Object.keys(req.body).length > 0) {
      body = JSON.stringify(req.body);
    }

    forwardRequest(req, res, agentUrl, body);
  });

  return router;
}

module.exports = { createCommunityAgentRouter };
