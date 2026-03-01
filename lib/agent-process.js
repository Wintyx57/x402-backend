// lib/agent-process.js — Spawn & manage the x402-community-agent companion process
// The agent runs on port 3500 (DASHBOARD_PORT) and is proxied via /admin/community-agent/*

const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

const AGENT_DIR = path.resolve(__dirname, '../../x402-community-agent');
const AGENT_SCRIPT = path.join(AGENT_DIR, 'dashboard.js');
const MAX_RESTARTS = 5;
const RESTART_BACKOFF_MS = 3000; // 3s base, doubles each restart

let agentProcess = null;
let restartCount = 0;
let restartTimer = null;
let stopping = false;

function startAgent() {
    if (agentProcess) return;
    if (stopping) return;

    // Check if agent directory exists
    const fs = require('fs');
    if (!fs.existsSync(AGENT_SCRIPT)) {
        logger.warn('CommunityAgent', `Agent script not found at ${AGENT_SCRIPT} — skipping`);
        return;
    }

    const port = process.env.COMMUNITY_AGENT_PORT || '3500';
    const env = {
        ...process.env,
        DASHBOARD_PORT: port,
        NODE_ENV: process.env.NODE_ENV || 'production',
    };

    // Debug: log which key env vars are being passed to the child
    const envKeys = ['AGENT_PRIVATE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_CHANNEL_ID', 'GEMINI_API_KEY', 'DISCORD_WEBHOOK_URL'];
    const envStatus = envKeys.map(k => `${k}=${env[k] ? 'SET' : 'MISSING'}`).join(', ');
    logger.info('CommunityAgent', `Spawning agent on port ${port} — env: ${envStatus}`);

    agentProcess = spawn('node', [AGENT_SCRIPT], {
        cwd: AGENT_DIR,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    agentProcess.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
            if (line) logger.info('CommunityAgent', line);
        }
    });

    agentProcess.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
            if (line) logger.error('CommunityAgent', line);
        }
    });

    agentProcess.on('exit', (code, signal) => {
        agentProcess = null;
        if (stopping) {
            logger.info('CommunityAgent', 'Agent stopped');
            return;
        }

        if (code !== 0) {
            logger.warn('CommunityAgent', `Agent exited (code=${code}, signal=${signal})`);
            scheduleRestart();
        } else {
            logger.info('CommunityAgent', 'Agent exited cleanly');
        }
    });

    agentProcess.on('error', (err) => {
        agentProcess = null;
        logger.error('CommunityAgent', `Spawn error: ${err.message}`);
        if (!stopping) scheduleRestart();
    });

    // Reset restart count on successful start (after 30s uptime)
    setTimeout(() => {
        if (agentProcess) restartCount = 0;
    }, 30000);
}

function scheduleRestart() {
    if (restartCount >= MAX_RESTARTS) {
        logger.error('CommunityAgent', `Max restarts (${MAX_RESTARTS}) reached — giving up`);
        return;
    }

    const delay = RESTART_BACKOFF_MS * Math.pow(2, restartCount);
    restartCount++;
    logger.info('CommunityAgent', `Restarting in ${delay / 1000}s (attempt ${restartCount}/${MAX_RESTARTS})`);

    restartTimer = setTimeout(() => {
        restartTimer = null;
        startAgent();
    }, delay);
}

function stopAgent() {
    stopping = true;
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    if (!agentProcess) return Promise.resolve();

    return new Promise((resolve) => {
        const killTimer = setTimeout(() => {
            if (agentProcess) {
                logger.warn('CommunityAgent', 'Force killing agent (SIGKILL)');
                agentProcess.kill('SIGKILL');
            }
            resolve();
        }, 5000);

        agentProcess.once('exit', () => {
            clearTimeout(killTimer);
            resolve();
        });

        logger.info('CommunityAgent', 'Sending SIGTERM to agent');
        agentProcess.kill('SIGTERM');
    });
}

module.exports = { startAgent, stopAgent };
