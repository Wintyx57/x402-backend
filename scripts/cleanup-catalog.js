#!/usr/bin/env node
// Cleanup catalog: quarantine services with verified_status='no_x402' via admin endpoint.
// Counts NULL verified_status separately and reports without acting (require manual triage).
//
// Usage:
//   ADMIN_TOKEN=xxx API_BASE=https://x402-api.onrender.com node scripts/cleanup-catalog.js
//   ADMIN_TOKEN=xxx node scripts/cleanup-catalog.js --dry-run
//
// Output: structured JSON report (counts + per-service status), suitable for piping to jq.

const API_BASE = process.env.API_BASE || "https://x402-api.onrender.com";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");

if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN env var required");
  process.exit(1);
}

async function fetchJson(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": ADMIN_TOKEN,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listAllServices() {
  const res = await fetch(`${API_BASE}/api/services?limit=500`);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function main() {
  const services = await listAllServices();
  const noX402 = services.filter((s) => s.verified_status === "no_x402");
  const nullVerified = services.filter((s) => s.verified_status == null);
  const reachableButNotMainnet = services.filter(
    (s) => s.verified_status === "reachable",
  );

  const report = {
    api_base: API_BASE,
    dry_run: DRY_RUN,
    fetched_at: new Date().toISOString(),
    totals: {
      services: services.length,
      no_x402_to_quarantine: noX402.length,
      null_verified_status: nullVerified.length,
      reachable_but_not_mainnet: reachableButNotMainnet.length,
    },
    quarantined: [],
    skipped: [],
    errors: [],
  };

  for (const svc of noX402) {
    if (svc.status === "quarantined") {
      report.skipped.push({
        id: svc.id,
        name: svc.name,
        reason: "already_quarantined",
      });
      continue;
    }
    if (DRY_RUN) {
      report.quarantined.push({ id: svc.id, name: svc.name, dry_run: true });
      continue;
    }
    try {
      await fetchJson(`/api/admin/quarantine/${svc.id}`, {
        method: "POST",
        body: JSON.stringify({ reason: "auto_cleanup_no_x402" }),
      });
      report.quarantined.push({ id: svc.id, name: svc.name });
    } catch (err) {
      report.errors.push({ id: svc.id, name: svc.name, error: err.message });
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("FATAL", err.message);
  process.exit(1);
});
