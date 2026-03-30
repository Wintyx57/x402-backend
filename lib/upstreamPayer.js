// lib/upstreamPayer.js — Universal Upstream Payment Relay
"use strict";

const {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base, polygon } = require("viem/chains");
const logger = require("./logger");
const { CHAINS } = require("./chains");

const MAX_UPSTREAM_COST = 1_000_000; // $1.00 USDC (6 decimals)
const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SUPPORTED_RELAY_CHAINS = new Set(["base", "polygon", "skale"]);

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

const VIEM_CHAINS = {
  base,
  polygon,
  skale: {
    id: 1187947933,
    name: "SKALE on Base",
    nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
    rpcUrls: { default: { http: [CHAINS.skale.rpcUrl] } },
  },
};

const _clients = {};
let _account = null;

function _getAccount() {
  if (_account) return _account;
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) return null;
  _account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  return _account;
}

function _getClients(chainKey) {
  if (_clients[chainKey]) return _clients[chainKey];
  const account = _getAccount();
  if (!account) return null;
  const chainCfg = CHAINS[chainKey];
  if (!chainCfg) return null;
  const viemChain = VIEM_CHAINS[chainKey];
  if (!viemChain) return null;
  const transport = http(chainCfg.rpcUrl);
  const publicClient = createPublicClient({ chain: viemChain, transport });
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport,
  });
  _clients[chainKey] = {
    publicClient,
    walletClient,
    usdcContract: chainCfg.usdcContract,
  };
  return _clients[chainKey];
}

// Nonce mutex per chain
const _nonceLocks = {};
function _acquireLock(chainKey) {
  if (!_nonceLocks[chainKey]) _nonceLocks[chainKey] = Promise.resolve();
  let release;
  const prev = _nonceLocks[chainKey];
  _nonceLocks[chainKey] = new Promise((r) => {
    release = r;
  });
  return prev.then(() => release);
}

function isRelayConfigured() {
  return !!process.env.RELAY_PRIVATE_KEY;
}

function getRelayAddress() {
  const account = _getAccount();
  return account ? account.address : null;
}

function canPayUpstream(normalized) {
  if (!normalized.payable) return false;
  if (!normalized.amount || !normalized.recipient) return false;
  if (!WALLET_PATTERN.test(normalized.recipient)) return false;
  if (!normalized.chain || !SUPPORTED_RELAY_CHAINS.has(normalized.chain))
    return false;
  if (Number(normalized.amount) > MAX_UPSTREAM_COST) return false;
  return true;
}

async function payUpstream(normalized) {
  if (!isRelayConfigured())
    return { success: false, error: "Relay wallet not configured" };
  if (!canPayUpstream(normalized))
    return {
      success: false,
      error: `Cannot pay: format=${normalized.format}, chain=${normalized.chain}, amount=${normalized.amount}`,
    };

  const chainKey = normalized.chain;
  const clients = _getClients(chainKey);
  if (!clients)
    return { success: false, error: `No client for chain ${chainKey}` };

  const amount = BigInt(normalized.amount);
  const recipient = normalized.recipient;
  const release = await _acquireLock(chainKey);

  try {
    const balance = await clients.publicClient.readContract({
      address: clients.usdcContract,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [_getAccount().address],
    });
    if (balance < amount)
      return {
        success: false,
        error: `Insufficient relay balance on ${chainKey}: ${balance.toString()} < ${amount.toString()}`,
      };

    const txHash = await clients.walletClient.writeContract({
      address: clients.usdcContract,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [recipient, amount],
    });

    const receipt = await clients.publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: chainKey === "skale" ? 0 : chainKey === "polygon" ? 5 : 2,
      timeout: 30_000,
    });

    if (receipt.status !== "success")
      return { success: false, error: `TX reverted: ${txHash}` };

    logger.info(
      "UpstreamPayer",
      `Paid upstream ${Number(amount) / 1e6} USDC to ${recipient.slice(0, 10)}... on ${chainKey} (tx: ${txHash.slice(0, 18)}...)`,
    );
    return {
      success: true,
      txHash,
      chain: chainKey,
      amount: normalized.amount,
    };
  } catch (err) {
    logger.error(
      "UpstreamPayer",
      `Failed to pay upstream on ${chainKey}: ${err.message}`,
    );
    return { success: false, error: err.message };
  } finally {
    release();
  }
}

async function getRelayBalance(chainKey) {
  const clients = _getClients(chainKey);
  if (!clients) return null;
  try {
    const raw = await clients.publicClient.readContract({
      address: clients.usdcContract,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [_getAccount().address],
    });
    return { balance: Number(raw) / 1e6, address: _getAccount().address };
  } catch {
    return null;
  }
}

module.exports = {
  isRelayConfigured,
  getRelayAddress,
  canPayUpstream,
  payUpstream,
  getRelayBalance,
  MAX_UPSTREAM_COST,
};
