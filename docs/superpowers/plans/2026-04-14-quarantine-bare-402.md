# Quarantine Bare-402 APIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the x402 Bazaar catalog from non-functional APIs that return empty 402 responses (no x402 payment details), by quarantining existing offenders, adding registration validation, upgrading monitoring, and guarding the relay wallet.

**Architecture:** Add a `quarantined` status to the service lifecycle. At registration, `probeProtocol()` already runs — add a blocking check when it detects `is402 + protocol === "unknown"`. In monitoring, distinguish "402 with valid protocol" from "bare 402". In the proxy, add an explicit early-return for unknown 402 formats before entering the relay payment logic. All existing x402 protocols (x402-v1, x402-v2, x402-bazaar, mpp, flat, header-based, etc.) remain fully supported — only `format: "unknown"` is affected.

**Tech Stack:** Node.js, Express, Supabase, node:test, protocolAdapter.js (normalize402), protocolSniffer.js (probeProtocol)

---

### Task 1: Filter quarantined services from public queries

**Files:**
- Modify: `routes/services.js:86,178`
- Modify: `lib/smart-search.js:169,183,316`
- Modify: `routes/provider.js:195`
- Test: `tests/quarantine.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/quarantine.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("quarantine — status filtering", () => {
  it("quarantined status should be a valid service status", () => {
    const VALID_STATUSES = ["online", "offline", "degraded", "unknown", "pending_validation", "quarantined"];
    assert.ok(VALID_STATUSES.includes("quarantined"));
  });

  it("public query filters should exclude quarantined and pending_validation", () => {
    const FILTERED_STATUSES = ["pending_validation", "quarantined"];
    assert.ok(FILTERED_STATUSES.includes("quarantined"));
    assert.ok(FILTERED_STATUSES.includes("pending_validation"));
    assert.strictEqual(FILTERED_STATUSES.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `node --test tests/quarantine.test.js`
Expected: PASS (these are structural assertions)

- [ ] **Step 3: Add .neq("status", "quarantined") to services.js**

In `routes/services.js`, add the quarantine filter after each existing `pending_validation` filter:

Line 86 — after `.neq("status", "pending_validation")`:
```javascript
      .neq("status", "quarantined")
```

Line 178 — after `.neq("status", "pending_validation")`:
```javascript
      .neq("status", "quarantined");
```

- [ ] **Step 4: Add .neq("status", "quarantined") to smart-search.js**

In `lib/smart-search.js`, add the quarantine filter after each existing `pending_validation` filter at lines 169, 183, and 316:
```javascript
      .neq("status", "quarantined")
```

- [ ] **Step 5: Add .neq("status", "quarantined") to provider.js**

In `routes/provider.js` at line 195, after `.neq("status", "pending_validation")`:
```javascript
      .neq("status", "quarantined")
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add routes/services.js lib/smart-search.js routes/provider.js tests/quarantine.test.js
git commit -m "feat: add quarantined status filtering to public queries"
```

---

### Task 2: Protocol validation gate in register.js

**Files:**
- Modify: `routes/register.js:435-448,609-622`
- Test: `tests/quarantine.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/quarantine.test.js`:

```javascript
describe("quarantine — bare 402 detection logic", () => {
  it("should identify bare 402 (is402 + unknown protocol) as needing quarantine", () => {
    // Simulates probeProtocol() result for a bare 402
    const probeResult = { is402: true, protocol: "unknown", normalized: { format: "unknown", payable: false } };
    const shouldBlock = probeResult.is402 && probeResult.protocol === "unknown";
    assert.strictEqual(shouldBlock, true);
  });

  it("should NOT block valid x402 protocols", () => {
    const validProtocols = ["x402-v1", "x402-v2", "x402-bazaar", "x402-variant", "mpp", "flat", "header-based", "l402", "l402-protocol", "stripe402"];
    for (const protocol of validProtocols) {
      const probeResult = { is402: true, protocol, normalized: { format: protocol, payable: true } };
      const shouldBlock = probeResult.is402 && probeResult.protocol === "unknown";
      assert.strictEqual(shouldBlock, false, `Should NOT block protocol: ${protocol}`);
    }
  });

  it("should NOT block open APIs (200 OK, no 402)", () => {
    const probeResult = { is402: false, protocol: "open", normalized: null };
    const shouldBlock = probeResult.is402 && probeResult.protocol === "unknown";
    assert.strictEqual(shouldBlock, false);
  });

  it("should NOT block API-key protected services (401/403)", () => {
    const probeResult = { is402: false, protocol: "api-key", normalized: null };
    const shouldBlock = probeResult.is402 && probeResult.protocol === "unknown";
    assert.strictEqual(shouldBlock, false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/quarantine.test.js`
Expected: PASS

- [ ] **Step 3: Add protocol validation gate to quick-register (lines 435-448)**

In `routes/register.js`, replace the block at lines 435-448:

```javascript
    } else {
      // No credentials — probe the URL to detect upstream payment protocol
      protocolProbe = await probeProtocol(validatedData.url);
      if (protocolProbe.is402 && protocolProbe.protocol !== "unknown") {
        await supabase
          .from("services")
          .update({ payment_protocol: protocolProbe.protocol })
          .eq("id", service.id);
        logger.info(
          "ProtocolSniffer",
          `Detected ${protocolProbe.protocol} for "${derivedName}" at registration`,
        );
      }
    }
```

Replace with:

```javascript
    } else {
      // No credentials — probe the URL to detect upstream payment protocol
      protocolProbe = await probeProtocol(validatedData.url);
      if (protocolProbe.is402 && protocolProbe.protocol === "unknown") {
        // Bare 402 with no x402 payment details — quarantine
        await supabase
          .from("services")
          .update({ status: "quarantined", verified_status: "bare_402" })
          .eq("id", service.id);
        logger.warn(
          "Register",
          `Quarantined "${derivedName}": upstream returns 402 without x402 payment details`,
        );
      } else if (protocolProbe.is402 && protocolProbe.protocol !== "unknown") {
        await supabase
          .from("services")
          .update({ payment_protocol: protocolProbe.protocol })
          .eq("id", service.id);
        logger.info(
          "ProtocolSniffer",
          `Detected ${protocolProbe.protocol} for "${derivedName}" at registration`,
        );
      }
    }
```

- [ ] **Step 4: Add protocol validation gate to paid register (lines 609-622)**

In `routes/register.js`, replace the block at lines 609-622:

```javascript
      } else {
        // No credentials — probe the URL to detect upstream payment protocol
        const protocolProbe = await probeProtocol(validatedData.url);
        if (protocolProbe.is402 && protocolProbe.protocol !== "unknown") {
          await supabase
            .from("services")
            .update({ payment_protocol: protocolProbe.protocol })
            .eq("id", data[0].id);
          logger.info(
            "ProtocolSniffer",
            `Detected ${protocolProbe.protocol} for "${validatedData.name}" at registration`,
          );
        }
      }
```

Replace with:

```javascript
      } else {
        // No credentials — probe the URL to detect upstream payment protocol
        const protocolProbe = await probeProtocol(validatedData.url);
        if (protocolProbe.is402 && protocolProbe.protocol === "unknown") {
          // Bare 402 with no x402 payment details — quarantine
          await supabase
            .from("services")
            .update({ status: "quarantined", verified_status: "bare_402" })
            .eq("id", data[0].id);
          logger.warn(
            "Register",
            `Quarantined "${validatedData.name}": upstream returns 402 without x402 payment details`,
          );
        } else if (protocolProbe.is402 && protocolProbe.protocol !== "unknown") {
          await supabase
            .from("services")
            .update({ payment_protocol: protocolProbe.protocol })
            .eq("id", data[0].id);
          logger.info(
            "ProtocolSniffer",
            `Detected ${protocolProbe.protocol} for "${validatedData.name}" at registration`,
          );
        }
      }
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add routes/register.js tests/quarantine.test.js
git commit -m "feat: quarantine services with bare 402 responses at registration"
```

---

### Task 3: Relay guard in proxy-execute.js

**Files:**
- Modify: `routes/proxy-execute.js:398-405`
- Test: `tests/quarantine.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/quarantine.test.js`:

```javascript
describe("quarantine — relay guard for unknown 402", () => {
  it("should detect unknown format as non-relayable", () => {
    const normalized = { format: "unknown", payable: false, amount: null, recipient: null, chain: null };
    const isUnknownBare402 = normalized.format === "unknown" && !normalized.payable;
    assert.strictEqual(isUnknownBare402, true);
  });

  it("should NOT block valid relayable formats", () => {
    const relayable = [
      { format: "x402-v2", payable: true, amount: "5000", recipient: "0x" + "a".repeat(40), chain: "base" },
      { format: "x402-bazaar", payable: true, amount: "3000", recipient: "0x" + "b".repeat(40), chain: "skale" },
      { format: "mpp", payable: true, amount: "10000", recipient: "0x" + "c".repeat(40), chain: "polygon" },
    ];
    for (const normalized of relayable) {
      const isUnknownBare402 = normalized.format === "unknown" && !normalized.payable;
      assert.strictEqual(isUnknownBare402, false, `Should NOT block format: ${normalized.format}`);
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/quarantine.test.js`
Expected: PASS

- [ ] **Step 3: Add explicit early-return for unknown 402 in proxy-execute.js**

In `routes/proxy-execute.js`, after the DB update block (line 397) and before the relay check (line 399), insert:

```javascript
          // --- GUARD: bare 402 with no parseable payment details ---
          if (normalized.format === "unknown") {
            logger.warn(
              "Proxy",
              `Bare 402 from "${service.name}" — no x402 payment details, skipping relay`,
              { correlationId: cid },
            );
            // Auto-quarantine (fire-and-forget)
            if (supabase) {
              supabase
                .from("services")
                .update({ status: "quarantined", verified_status: "bare_402" })
                .eq("id", service.id)
                .then(null, () => {});
            }
            if (inflightKey) _proxyInFlight.delete(inflightKey);
            return res.status(502).json({
              error: "UPSTREAM_BARE_402",
              message: `Service "${service.name}" returns 402 without x402 payment details. The upstream API is not properly integrated.`,
              _payment_status: "not_charged",
            });
          }
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add routes/proxy-execute.js tests/quarantine.test.js
git commit -m "feat: relay guard — early return for bare 402 upstream, auto-quarantine"
```

---

### Task 4: Protocol-aware monitoring

**Files:**
- Modify: `lib/monitor.js:288-309,314-319`
- Test: `tests/quarantine.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/quarantine.test.js`:

```javascript
describe("quarantine — monitoring protocol-aware status", () => {
  it("402 with valid protocol should be online", () => {
    const httpStatus = 402;
    const detectedProtocol = "x402-bazaar";
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const status = isBare402 ? "degraded" : "online";
    assert.strictEqual(status, "online");
  });

  it("402 with unknown/null protocol should be degraded", () => {
    const httpStatus = 402;
    const detectedProtocol = null; // normalize402 returned "unknown" → detectedProtocol stays null
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const status = isBare402 ? "degraded" : "online";
    assert.strictEqual(status, "degraded");
  });

  it("200 OK should be online regardless of protocol", () => {
    const httpStatus = 200;
    const detectedProtocol = null;
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const isOnline = httpStatus === 200 || httpStatus === 400 || httpStatus === 429;
    const status = isBare402 ? "degraded" : isOnline ? "online" : "offline";
    assert.strictEqual(status, "online");
  });
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/quarantine.test.js`
Expected: PASS

- [ ] **Step 3: Update monitoring status logic in monitor.js**

In `lib/monitor.js`, replace the status determination block at lines 311-319:

```javascript
    // 402 = payment required (alive), 400 = missing param (alive), 200 = OK, 429 = rate limited (alive)
    // 401/403 = auth failed but server responded (alive — treat as online for credential-based services)
    const hasCredentials = !!endpoint.encryptedCredentials;
    const isOnline =
      httpStatus === 402 ||
      httpStatus === 400 ||
      httpStatus === 200 ||
      httpStatus === 429 ||
      (hasCredentials && (httpStatus === 401 || httpStatus === 403));
```

Replace with:

```javascript
    // 402 = payment required (alive), 400 = missing param (alive), 200 = OK, 429 = rate limited (alive)
    // 401/403 = auth failed but server responded (alive — treat as online for credential-based services)
    // BARE 402 = 402 without x402 payment details → degraded (not callable through proxy)
    const hasCredentials = !!endpoint.encryptedCredentials;
    const isBare402 = httpStatus === 402 && !detectedProtocol;
    const isOnline =
      (httpStatus === 402 && !isBare402) ||
      httpStatus === 400 ||
      httpStatus === 200 ||
      httpStatus === 429 ||
      (hasCredentials && (httpStatus === 401 || httpStatus === 403));
```

Then update the return statement at line 324:

```javascript
      status: isBare402 ? "degraded" : isOnline ? "online" : "offline",
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/monitor.js tests/quarantine.test.js
git commit -m "feat: protocol-aware monitoring — bare 402 = degraded, not online"
```

---

### Task 5: Quarantine the 21 existing APIs

**Files:** None (database operation)

- [ ] **Step 1: Quarantine via backend admin API or direct Supabase**

```bash
# Via curl to the backend (using admin token)
curl -X PATCH "https://x402-api.onrender.com/api/services/batch-update" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"owner_address": "0x14B81D8aB44cC1C1a2e8895BF8aCa2C2867aa81D", "update": {"status": "quarantined", "verified_status": "bare_402"}}'
```

If no batch-update endpoint exists, add a one-off script:

```javascript
// scripts/quarantine-bare-402.js
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data, error } = await supabase
    .from("services")
    .update({ status: "quarantined", verified_status: "bare_402" })
    .eq("owner_address", "0x14B81D8aB44cC1C1a2e8895BF8aCa2C2867aa81D");

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
  console.log(`Quarantined ${data?.length || "?"} services`);
}

main();
```

- [ ] **Step 2: Run the script**

Run: `cd x402-bazaar && node scripts/quarantine-bare-402.js`
Expected: `Quarantined 21 services`

- [ ] **Step 3: Verify quarantine**

```bash
curl -s "https://x402-api.onrender.com/api/services?limit=200" | python3 -c "
import json, sys
data = json.load(sys.stdin)
services = data if isinstance(data, list) else data.get('services', data.get('data', []))
target = '0x14B81D8aB44cC1C1a2e8895BF8aCa2C2867aa81D'
count = sum(1 for s in services if s.get('owner_address') == target)
print(f'Provider services visible in public API: {count} (should be 0)')
"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/quarantine-bare-402.js
git commit -m "feat: quarantine 21 bare-402 APIs from provider 0x14B81D"
```

---

### Task 6: MCP call_service guard for quarantined services

**Files:**
- Modify: `mcp-server.mjs` (call_service tool handler)
- Test: `tests/quarantine.test.js` (append)

- [ ] **Step 1: Write the test**

Append to `tests/quarantine.test.js`:

```javascript
describe("quarantine — MCP service status guard", () => {
  it("should block quarantined services before payment", () => {
    const blockedStatuses = new Set(["offline", "quarantined"]);
    assert.ok(blockedStatuses.has("quarantined"));
    assert.ok(blockedStatuses.has("offline"));
    assert.ok(!blockedStatuses.has("online"));
    assert.ok(!blockedStatuses.has("degraded"));
  });
});
```

- [ ] **Step 2: Update MCP call_service to block quarantined**

In `mcp-server.mjs`, find the existing check that blocks offline services. Add `quarantined` to the same check:

Find: `service.status === "offline"`
Replace with: `service.status === "offline" || service.status === "quarantined"`

If the error message mentions "offline", update it to be generic:
```javascript
`Service "${service.name}" is currently ${service.status} and cannot be called.`
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add mcp-server.mjs tests/quarantine.test.js
git commit -m "feat: MCP blocks quarantined services before payment"
```

---

### Task 7: Run full test suite and push

- [ ] **Step 1: Run full test suite**

Run: `cd x402-bazaar && npm test`
Expected: All tests PASS, 0 failures

- [ ] **Step 2: Push to GitHub**

Run: `cd x402-bazaar && git push origin main`
Expected: Auto-deploy on Render

- [ ] **Step 3: Verify on production**

After Render deploy completes (~2 min), verify:
- `curl https://x402-api.onrender.com/health` → 200 OK
- Provider 0x14B81D services no longer visible in public API
- MCP list_services no longer returns quarantined services
