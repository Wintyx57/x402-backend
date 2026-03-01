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

    // Write a .env file for the community agent with forwarded env vars
    // (spawn env passing can be unreliable on some platforms)
    const FORWARD_VARS = [
        'AGENT_PRIVATE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_CHANNEL_ID',
        'GEMINI_API_KEY', 'DISCORD_WEBHOOK_URL', 'OPENAI_API_KEY',
        'TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET',
        'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD',
        'DEVTO_API_KEY', 'LINKEDIN_ACCESS_TOKEN',
        'FARCASTER_SIGNER_KEY', 'FARCASTER_FID', 'NEYNAR_API_KEY',
        'MAX_BUDGET_USDC', 'DEFAULT_LANGUAGE', 'GENERATE_IMAGES',
    ];
    const envLines = [`DASHBOARD_PORT=${port}`, `NODE_ENV=${process.env.NODE_ENV || 'production'}`];
    const statusParts = [];
    for (const key of FORWARD_VARS) {
        if (process.env[key]) {
            envLines.push(`${key}=${process.env[key]}`);
            statusParts.push(`${key}=SET`);
        } else {
            statusParts.push(`${key}=MISSING`);
        }
    }
    const envFilePath = path.join(AGENT_DIR, '.env');
    fs.writeFileSync(envFilePath, envLines.join('\n') + '\n', 'utf-8');
    logger.info('CommunityAgent', `Wrote .env (${envLines.length} vars) — ${statusParts.join(', ')}`);

    agentProcess = spawn('node', [AGENT_SCRIPT], {
        cwd: AGENT_DIR,
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
