// routes/register.js — POST /register + deep auto-verification on registration

const express = require("express");
const multer = require("multer");
const { recoverMessageAddress } = require("viem");
const logger = require("../lib/logger");
const { notifyAdmin } = require("../lib/telegram-bot");
const {
  ServiceRegistrationSchema,
  QuickRegisterSchema,
  BatchRegisterSchema,
  OpenAPIImportSchema,
  ServiceCredentialsSchema,
} = require("../schemas");
const { encryptCredentials } = require("../lib/credentials");
const { validateCredentials } = require("../lib/credentialValidator");
const { verifyService } = require("../lib/service-verifier");
const { safeUrl } = require("../lib/safe-url");
const { registerAgent } = require("../lib/erc8004-registry");
const {
  parseSpec,
  extractEndpoints,
  resolveBaseUrl,
  detectRapidAPI,
} = require("../lib/openapi-parser");
const { probeProtocol } = require("../lib/protocolSniffer");

// Max allowed age for the signed timestamp (5 minutes)
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Verify an EIP-191 personal_sign signature for quick-register.
 * Expected signed message format: "quick-register:<url>:<ownerAddress>:<timestamp>"
 * Returns { valid: true } or { valid: false, reason: string }
 */
async function verifyQuickRegisterSignature({
  url,
  ownerAddress,
  timestamp,
  signature,
}) {
  // 1. Validate timestamp freshness (prevent replay attacks)
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || ts <= 0) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const age = Date.now() - ts;
  if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
    return { valid: false, reason: "timestamp_expired", age_ms: age };
  }

  // 2. Reconstruct the exact message that was signed
  const message = `quick-register:${url}:${ownerAddress}:${timestamp}`;

  // 3. Recover the signer address from the signature
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
      return { valid: false, reason: "signature_mismatch", recovered };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: "signature_recovery_failed",
      error: err.message,
    };
  }
}

async function verifyBatchRegisterSignature({
  ownerAddress,
  serviceCount,
  timestamp,
  signature,
}) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || ts <= 0) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const age = Date.now() - ts;
  if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
    return { valid: false, reason: "timestamp_expired", age_ms: age };
  }
  const message = `batch-register:${ownerAddress}:${serviceCount}:${timestamp}`;
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
      return { valid: false, reason: "signature_mismatch", recovered };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: "signature_recovery_failed",
      error: err.message,
    };
  }
}

async function verifyImportSignature({ ownerAddress, timestamp, signature }) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || ts <= 0) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const age = Date.now() - ts;
  if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
    return { valid: false, reason: "timestamp_expired", age_ms: age };
  }
  const message = `import-openapi:${ownerAddress}:${timestamp}`;
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
      return { valid: false, reason: "signature_mismatch", recovered };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: "signature_recovery_failed",
      error: err.message,
    };
  }
}

async function checkDuplicateUrl(supabase, url) {
  const { data } = await supabase
    .from("services")
    .select("id, name")
    .eq("url", url)
    .limit(1);
  if (data && data.length > 0) {
    return data[0];
  }
  return null;
}

/**
 * Validate credentials against the upstream service, then encrypt and store.
 * No longer fire-and-forget — callers must await and handle validation failures.
 *
 * @param {object} supabase
 * @param {string} serviceId
 * @param {string} serviceUrl - the upstream URL to validate against
 * @param {object|undefined} rawCredentials - untrusted input from req.body
 * @returns {Promise<{ attached: boolean, validation?: { status: string, message?: string }, error?: string }>}
 */
async function attachCredentials(
  supabase,
  serviceId,
  serviceUrl,
  rawCredentials,
) {
  if (!rawCredentials) return { attached: false };

  // Validate credentials structure with Zod
  const result = ServiceCredentialsSchema.safeParse(rawCredentials);
  if (!result.success) {
    const msg = (result.error?.issues || result.error?.errors || [])
      .map((e) => e.message)
      .join(", ");
    logger.warn(
      "Credentials",
      `Invalid credentials for service ${serviceId.slice(0, 8)}: ${msg}`,
    );
    return {
      attached: false,
      error: `Invalid credentials format: ${msg}`,
      validation: {
        status: "invalid",
        message: `Invalid credentials format: ${msg}`,
      },
    };
  }

  // Pre-validate credentials against the upstream service
  const validation = await validateCredentials(serviceUrl, result.data);

  if (!validation.valid) {
    logger.warn(
      "Credentials",
      `Credential validation failed for service ${serviceId.slice(0, 8)}: ${validation.error}`,
    );
    return {
      attached: false,
      error: validation.error,
      validation: { status: "invalid", message: validation.error },
    };
  }

  // Credentials accepted (possibly with a warning) — encrypt and store
  const encrypted = encryptCredentials(result.data);

  const { error } = await supabase
    .from("services")
    .update({
      encrypted_credentials: encrypted,
      credential_type: result.data.type,
    })
    .eq("id", serviceId);

  if (error) {
    logger.error(
      "Credentials",
      `Failed to store credentials for service ${serviceId.slice(0, 8)}: ${error.message}`,
    );
    return { attached: false, error: "Failed to store credentials" };
  }

  logger.info(
    "Credentials",
    `Credentials (type: ${result.data.type}) stored for service ${serviceId.slice(0, 8)}`,
  );

  if (validation.warning) {
    return {
      attached: true,
      validation: { status: "warning", message: validation.warning },
      detectedProtocol: validation.detectedProtocol || null,
    };
  }
  return {
    attached: true,
    validation: { status: "valid" },
    detectedProtocol: validation.detectedProtocol || null,
  };
}

/**
 * Store already-validated credentials for a service (skip upstream validation).
 * Used for batch/import flows where validation was already done once.
 */
async function storeCredentialsOnly(supabase, serviceId, rawCredentials) {
  if (!rawCredentials) return;

  const result = ServiceCredentialsSchema.safeParse(rawCredentials);
  if (!result.success) return;

  const encrypted = encryptCredentials(result.data);

  const { error } = await supabase
    .from("services")
    .update({
      encrypted_credentials: encrypted,
      credential_type: result.data.type,
    })
    .eq("id", serviceId);

  if (error) {
    logger.error(
      "Credentials",
      `Failed to store credentials for service ${serviceId.slice(0, 8)}: ${error.message}`,
    );
  }
}

function createRegisterRouter(
  supabase,
  logActivity,
  paymentMiddleware,
  registerLimiter,
) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const allowed = [".json", ".yaml", ".yml"];
      const ext = file.originalname
        .toLowerCase()
        .slice(file.originalname.lastIndexOf("."));
      cb(null, allowed.includes(ext));
    },
  });

  // Conditional multer: only process multipart/form-data, skip for JSON requests
  function optionalUpload(req, res, next) {
    const ct = req.headers["content-type"] || "";
    if (ct.startsWith("multipart/form-data")) {
      return upload.single("specFile")(req, res, next);
    }
    next();
  }

  router.post("/quick-register", registerLimiter, async (req, res) => {
    let validatedData;
    try {
      validatedData = QuickRegisterSchema.parse(req.body);
    } catch (zodError) {
      const errors = (zodError.issues || zodError.errors || []).map((err) => ({
        field: err.path.join(".") || "root",
        message: err.message,
      }));
      return res
        .status(400)
        .json({ error: "Validation failed", details: errors });
    }

    // EIP-191 wallet ownership proof
    const { signature, timestamp } = req.body;
    if (!signature || !timestamp) {
      return res.status(400).json({
        error: "Signature required",
        message:
          'Provide "signature" (EIP-191 personal_sign) and "timestamp" (unix ms). Sign the message: quick-register:<url>:<ownerAddress>:<timestamp>',
      });
    }

    const sigCheck = await verifyQuickRegisterSignature({
      url: validatedData.url,
      ownerAddress: validatedData.ownerAddress,
      timestamp,
      signature,
    });

    if (!sigCheck.valid) {
      logger.warn(
        "QuickRegister",
        `Signature rejected for ${validatedData.ownerAddress}: ${sigCheck.reason}`,
      );
      return res.status(401).json({
        error: "Invalid signature",
        reason: sigCheck.reason,
        message:
          "Could not verify wallet ownership. Ensure you signed: quick-register:<url>:<ownerAddress>:<timestamp> with timestamp within 5 minutes.",
      });
    }

    // SSRF protection
    try {
      await safeUrl(validatedData.url);
    } catch (urlErr) {
      return res.status(400).json({
        error: "Invalid service URL",
        message: "URL must point to a publicly reachable address",
      });
    }

    // Duplicate URL check
    const existingService = await checkDuplicateUrl(
      supabase,
      validatedData.url,
    );
    if (existingService) {
      return res.status(409).json({
        error: "URL already registered",
        existing_service_id: existingService.id,
        existing_service_name: existingService.name,
      });
    }

    // Auto-derive name from URL hostname if not provided
    const derivedName =
      validatedData.name ||
      (() => {
        try {
          const h = new URL(validatedData.url).hostname.replace(
            /^(www|api)\./,
            "",
          );
          return (
            h.split(".")[0].charAt(0).toUpperCase() + h.split(".")[0].slice(1)
          );
        } catch {
          return "API Service";
        }
      })();

    const insertData = {
      name: derivedName,
      url: validatedData.url,
      price_usdc: validatedData.price,
      owner_address: validatedData.ownerAddress,
      tags: ["utility"],
      quick_registered: true,
    };
    if (validatedData.logo_url) insertData.logo_url = validatedData.logo_url;
    // If credentials are provided, mark as pending_validation to hide from public queries
    // during the validation window (prevents race condition)
    if (req.body.credentials) insertData.status = "pending_validation";

    const { data, error } = await supabase
      .from("services")
      .insert([insertData])
      .select();

    if (error) {
      logger.error("Supabase", "/quick-register error:", error.message);
      return res.status(500).json({ error: "Registration failed" });
    }

    const service = data[0];
    const proxyUrl = `https://x402-api.onrender.com/api/call/${service.id}`;

    logger.info("Bazaar", `Quick registered: "${derivedName}" (${service.id})`);
    logActivity(
      "register",
      `Quick: "${derivedName}" (${service.id.slice(0, 8)})`,
    );

    // Validate and store credentials (blocking — reject if upstream returns 401/403)
    // For no-credential services, probe the URL to detect upstream payment protocol (Layer 1)
    let credentialValidation;
    let protocolProbe = null;
    if (req.body.credentials) {
      const credResult = await attachCredentials(
        supabase,
        service.id,
        validatedData.url,
        req.body.credentials,
      );
      if (credResult.error && credResult.validation?.status === "invalid") {
        // Credentials rejected — delete the service and return error
        await supabase.from("services").delete().eq("id", service.id);
        logger.warn(
          "QuickRegister",
          `Credential validation failed for "${derivedName}": ${credResult.error}`,
        );
        return res.status(400).json({
          error: "Credential validation failed",
          message: credResult.error,
        });
      }
      credentialValidation = credResult.validation;
      // Validation passed — make service publicly visible
      const updateData = { status: "unknown" };
      if (credResult?.detectedProtocol)
        updateData.payment_protocol = credResult.detectedProtocol;
      await supabase.from("services").update(updateData).eq("id", service.id);
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

    // Auto-test (fire-and-forget)
    autoTestService(service, supabase).catch((err) => {
      logger.error(
        "AutoTest",
        `Auto-test failed for "${derivedName}": ${err.message}`,
      );
    });

    // Notify admin
    notifyAdmin(
      `⚡ *Quick Register*\n*Name:* ${derivedName}\n*URL:* \`${validatedData.url}\`\n*Price:* ${validatedData.price} USDC\n*Owner:* \`${validatedData.ownerAddress.slice(0, 10)}...\`\n*ID:* \`${service.id.slice(0, 8)}...\``,
    ).catch(() => {});

    const response = {
      success: true,
      message: `Service "${derivedName}" registered! No payment required.`,
      data: service,
      proxy_url: proxyUrl,
      service_page: `https://x402bazaar.org/services/${service.id}`,
      embed: {
        curl: `curl -X POST "${proxyUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Payment-TxHash: YOUR_TX_HASH" \\\n  -H "X-Payment-Chain: skale"`,
        javascript: `const res = await fetch("${proxyUrl}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "X-Payment-TxHash": txHash,\n    "X-Payment-Chain": "skale"\n  }\n});\nconst data = await res.json();`,
        python: `import requests\n\nres = requests.post(\n    "${proxyUrl}",\n    headers={\n        "X-Payment-TxHash": tx_hash,\n        "X-Payment-Chain": "skale"\n    }\n)\nprint(res.json())`,
      },
    };
    if (credentialValidation)
      response.credential_validation = credentialValidation;
    if (protocolProbe?.is402) {
      response.protocol_detected = {
        protocol: protocolProbe.protocol,
        upstream_price: protocolProbe.upstreamPrice,
        upstream_recipient: protocolProbe.upstreamRecipient,
        upstream_chain: protocolProbe.upstreamChain,
        warning:
          protocolProbe.protocol !== "unknown"
            ? `Upstream uses ${protocolProbe.protocol} payment protocol. Your price must cover upstream cost.`
            : "Upstream requires payment (unknown protocol). Manual configuration may be needed.",
      };
    }
    res.status(201).json(response);
  });

  router.post(
    "/register",
    registerLimiter,
    paymentMiddleware(1000000, 1, "Register Service"),
    async (req, res) => {
      const txHash = req.headers["x-payment-txhash"] || null;

      // Validate request body using Zod schema
      let validatedData;
      try {
        validatedData = ServiceRegistrationSchema.parse(req.body);
      } catch (zodError) {
        // Return formatted validation errors
        const errors = (zodError.issues || zodError.errors || []).map(
          (err) => ({
            field: err.path.join(".") || "root",
            message: err.message,
          }),
        );
        return res.status(400).json({
          error: "Validation failed",
          details: errors,
        });
      }

      // SSRF protection: validate the service URL before inserting
      try {
        await safeUrl(validatedData.url);
      } catch (urlErr) {
        return res.status(400).json({
          error: "Invalid service URL",
          message: "URL must point to a publicly reachable address",
        });
      }

      // Duplicate URL check
      const existingService = await checkDuplicateUrl(
        supabase,
        validatedData.url,
      );
      if (existingService) {
        return res.status(409).json({
          error: "URL already registered",
          existing_service_id: existingService.id,
          existing_service_name: existingService.name,
        });
      }

      const insertData = {
        name: validatedData.name,
        description: validatedData.description,
        url: validatedData.url,
        price_usdc: validatedData.price,
        owner_address: validatedData.ownerAddress,
        tags: validatedData.tags,
      };
      if (txHash) insertData.tx_hash = txHash;
      if (validatedData.required_parameters) {
        insertData.required_parameters = validatedData.required_parameters;
      }
      if (validatedData.logo_url) insertData.logo_url = validatedData.logo_url;
      if (req.body.credentials) insertData.status = "pending_validation";

      const { data, error } = await supabase
        .from("services")
        .insert([insertData])
        .select();

      if (error) {
        logger.error("Supabase", "/register error:", error.message);
        return res.status(500).json({ error: "Registration failed" });
      }

      logger.info(
        "Bazaar",
        `New service registered: "${validatedData.name}" (${data[0].id})`,
      );
      logActivity(
        "register",
        `New service: "${validatedData.name}" (${data[0].id.slice(0, 8)})`,
      );

      // Validate and store credentials (blocking — reject if upstream returns 401/403)
      // For no-credential services, probe the URL to detect upstream payment protocol (Layer 1)
      let credentialValidation;
      if (req.body.credentials) {
        const credResult = await attachCredentials(
          supabase,
          data[0].id,
          validatedData.url,
          req.body.credentials,
        );
        if (credResult.error && credResult.validation?.status === "invalid") {
          await supabase.from("services").delete().eq("id", data[0].id);
          logger.warn(
            "Register",
            `Credential validation failed for "${validatedData.name}": ${credResult.error}`,
          );
          return res.status(400).json({
            error: "Credential validation failed",
            message: credResult.error,
          });
        }
        credentialValidation = credResult.validation;
        const updateData = { status: "unknown" };
        if (credResult?.detectedProtocol)
          updateData.payment_protocol = credResult.detectedProtocol;
        await supabase.from("services").update(updateData).eq("id", data[0].id);
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

      // Auto-test: ping the registered URL (fire-and-forget)
      autoTestService(data[0], supabase).catch((err) => {
        logger.error(
          "AutoTest",
          `Auto-test failed for "${validatedData.name}": ${err.message}`,
        );
      });

      // Notify Community Agent webhook (fire-and-forget)
      notifyCommunityAgent({
        name: validatedData.name,
        description: validatedData.description,
        price: validatedData.price,
      }).catch((err) => {
        logger.error(
          "Webhook",
          `Community agent webhook failed: ${err.message}`,
        );
      });

      // Register on ERC-8004 Identity Registry (fire-and-forget)
      registerOnChain(data[0], supabase).catch((err) => {
        logger.error(
          "ERC8004",
          `On-chain registration failed for "${validatedData.name}": ${err.message}`,
        );
      });

      const response = {
        success: true,
        message: `Service "${validatedData.name}" registered successfully!`,
        data: data[0],
      };
      if (credentialValidation)
        response.credential_validation = credentialValidation;
      res.status(201).json(response);
    },
  );

  router.post("/batch-register", registerLimiter, async (req, res) => {
    let validatedData;
    try {
      validatedData = BatchRegisterSchema.parse(req.body);
    } catch (zodError) {
      const errors = (zodError.issues || zodError.errors || []).map((err) => ({
        field: err.path.join(".") || "root",
        message: err.message,
      }));
      return res
        .status(400)
        .json({ error: "Validation failed", details: errors });
    }

    // Verify signature
    const sigCheck = await verifyBatchRegisterSignature({
      ownerAddress: validatedData.ownerAddress,
      serviceCount: validatedData.services.length,
      timestamp: validatedData.timestamp,
      signature: validatedData.signature,
    });

    if (!sigCheck.valid) {
      logger.warn(
        "BatchRegister",
        `Signature rejected for ${validatedData.ownerAddress}: ${sigCheck.reason}`,
      );
      return res.status(401).json({
        error: "Invalid signature",
        reason: sigCheck.reason,
        message:
          "Could not verify wallet ownership. Sign: batch-register:<ownerAddress>:<serviceCount>:<timestamp>",
      });
    }

    // SSRF check all URLs
    for (const svc of validatedData.services) {
      try {
        await safeUrl(svc.url);
      } catch (urlErr) {
        return res.status(400).json({
          error: "Invalid service URL",
          message: `URL "${svc.url}" must point to a publicly reachable address`,
          service_name: svc.name,
        });
      }
    }

    // Intra-batch duplicate check
    const urls = validatedData.services.map((s) => s.url);
    const uniqueUrls = new Set(urls);
    if (uniqueUrls.size !== urls.length) {
      return res.status(400).json({
        error: "Duplicate URLs in batch",
        message: "Each service must have a unique URL within the batch",
      });
    }

    // Check existing URLs in database
    const { data: existingServices } = await supabase
      .from("services")
      .select("id, name, url")
      .in("url", urls);

    if (existingServices && existingServices.length > 0) {
      return res.status(409).json({
        error: "URLs already registered",
        duplicates: existingServices.map((s) => ({
          url: s.url,
          existing_service_id: s.id,
          existing_service_name: s.name,
        })),
      });
    }

    // Build insert array
    const insertArray = validatedData.services.map((svc) => {
      const row = {
        name: svc.name,
        description: svc.description || "",
        url: svc.url,
        price_usdc: svc.price,
        owner_address: validatedData.ownerAddress,
        tags: svc.tags || [],
      };
      if (svc.required_parameters)
        row.required_parameters = svc.required_parameters;
      if (svc.logo_url) row.logo_url = svc.logo_url;
      return row;
    });

    // Insert all services
    const { data, error } = await supabase
      .from("services")
      .insert(insertArray)
      .select();

    if (error) {
      logger.error("Supabase", "/batch-register error:", error.message);
      return res.status(500).json({ error: "Batch registration failed" });
    }

    logger.info(
      "Bazaar",
      `Batch registered ${data.length} services for ${validatedData.ownerAddress.slice(0, 10)}`,
    );
    logActivity(
      "batch_register",
      `${data.length} services by ${validatedData.ownerAddress.slice(0, 8)}`,
    );

    // Validate and store credentials per service (blocking per service)
    const inputServicesByUrl = new Map(
      validatedData.services.map((s) => [s.url, s]),
    );
    const credentialErrors = [];
    const credentialWarnings = [];
    const failedServiceIds = new Set();
    for (const svc of data) {
      const input = inputServicesByUrl.get(svc.url);
      if (input && input.credentials) {
        const credResult = await attachCredentials(
          supabase,
          svc.id,
          svc.url,
          input.credentials,
        );
        if (credResult.error && credResult.validation?.status === "invalid") {
          // Delete this service and record the error
          await supabase.from("services").delete().eq("id", svc.id);
          failedServiceIds.add(svc.id);
          credentialErrors.push({
            id: svc.id,
            name: svc.name,
            url: svc.url,
            error: credResult.error,
          });
        } else if (credResult.validation?.status === "warning") {
          credentialWarnings.push({
            name: svc.name,
            warning: credResult.validation.message,
          });
        }
      }
    }

    // Filter by ID (not URL) to avoid string-matching issues after DB round-trip
    const successfulServices = data.filter(
      (svc) => !failedServiceIds.has(svc.id),
    );
    if (successfulServices.length === 0 && credentialErrors.length > 0) {
      return res.status(400).json({
        error: "All services failed credential validation",
        credential_errors: credentialErrors,
      });
    }

    // Auto-test in batches of 5 (fire-and-forget) — only successful services
    const BATCH_SIZE = 5;
    for (let i = 0; i < successfulServices.length; i += BATCH_SIZE) {
      const batch = successfulServices.slice(i, i + BATCH_SIZE);
      Promise.all(batch.map((svc) => autoTestService(svc, supabase))).catch(
        (err) => {
          logger.error("AutoTest", `Batch auto-test error: ${err.message}`);
        },
      );
    }

    // ERC-8004 registration sequential (fire-and-forget) — only successful services
    (async () => {
      for (const svc of successfulServices) {
        try {
          await registerOnChain(svc, supabase);
        } catch (err) {
          logger.error(
            "ERC8004",
            `Batch on-chain registration failed for "${svc.name}": ${err.message}`,
          );
        }
      }
    })();

    // Notify admin
    const serviceList = data
      .map((s) => `• ${s.name} ($${s.price_usdc})`)
      .join("\n");
    notifyAdmin(
      `📦 *Batch Register*\n*Owner:* \`${validatedData.ownerAddress.slice(0, 10)}...\`\n*Services (${data.length}):*\n${serviceList}`,
    ).catch(() => {});

    const batchResponse = {
      success: true,
      message: `${successfulServices.length} services registered successfully!`,
      data: successfulServices,
    };
    if (credentialErrors.length > 0) {
      batchResponse.credential_errors = credentialErrors;
      batchResponse.message = `${successfulServices.length}/${data.length} services registered (${credentialErrors.length} failed credential validation)`;
    }
    if (credentialWarnings.length > 0) {
      batchResponse.credential_warnings = credentialWarnings;
    }
    res.status(201).json(batchResponse);
  });

  router.post(
    "/api/import-openapi/preview",
    registerLimiter,
    optionalUpload,
    async (req, res) => {
      try {
        let source;
        if (req.file) {
          source = { buffer: req.file.buffer, filename: req.file.originalname };
        } else if (req.body.specUrl) {
          try {
            await safeUrl(req.body.specUrl);
          } catch (urlErr) {
            return res.status(400).json({
              error: "Invalid spec URL",
              message: "URL must be publicly reachable",
            });
          }
          source = { url: req.body.specUrl };
        } else {
          return res.status(400).json({
            error: "No spec provided",
            message: "Provide specFile (upload) or specUrl (JSON body)",
          });
        }

        const spec = await parseSpec(source);
        const baseUrl = req.body.baseUrl || resolveBaseUrl(spec);
        const endpoints = extractEndpoints(spec, {
          baseUrlOverride: req.body.baseUrl || undefined,
        });

        // Check which URLs are already registered
        const fullUrls = endpoints.map((e) => e.fullUrl);
        const { data: existing } = await supabase
          .from("services")
          .select("url")
          .in("url", fullUrls);
        const existingUrls = new Set((existing || []).map((s) => s.url));

        const enriched = endpoints.map((e) => ({
          ...e,
          full_url: e.fullUrl,
          already_registered: existingUrls.has(e.fullUrl),
        }));

        const rapidapi = detectRapidAPI(spec);

        res.json({
          spec_title: spec.info?.title || "Untitled",
          spec_version: spec.openapi || spec.swagger || "unknown",
          base_url: baseUrl,
          endpoints: enriched,
          total: enriched.length,
          already_registered_count: enriched.filter((e) => e.already_registered)
            .length,
          rapidapi,
        });
      } catch (err) {
        logger.error("ImportPreview", err.message);
        res
          .status(400)
          .json({ error: "Failed to parse spec", message: err.message });
      }
    },
  );

  router.post(
    "/api/import-openapi",
    registerLimiter,
    optionalUpload,
    async (req, res) => {
      // Parse body — multer with multipart puts fields in req.body as strings
      let body = req.body;
      // If multipart, parse numeric/JSON fields
      if (req.file) {
        if (body.defaultPrice)
          body.defaultPrice = parseFloat(body.defaultPrice);
        if (body.timestamp) body.timestamp = parseInt(body.timestamp, 10);
        if (body.priceOverrides && typeof body.priceOverrides === "string") {
          try {
            body.priceOverrides = JSON.parse(body.priceOverrides);
          } catch {
            /* ignore */
          }
        }
        if (body.excludePaths && typeof body.excludePaths === "string") {
          try {
            body.excludePaths = JSON.parse(body.excludePaths);
          } catch {
            /* ignore */
          }
        }
        if (body.defaultTags && typeof body.defaultTags === "string") {
          try {
            body.defaultTags = JSON.parse(body.defaultTags);
          } catch {
            /* ignore */
          }
        }
        if (body.credentials && typeof body.credentials === "string") {
          try {
            body.credentials = JSON.parse(body.credentials);
          } catch {
            /* ignore */
          }
        }
      }

      // Validate
      let validatedData;
      try {
        validatedData = OpenAPIImportSchema.parse(body);
      } catch (zodError) {
        const errors = (zodError.issues || zodError.errors || []).map(
          (err) => ({
            field: err.path.join(".") || "root",
            message: err.message,
          }),
        );
        return res
          .status(400)
          .json({ error: "Validation failed", details: errors });
      }

      // Verify signature
      const sigCheck = await verifyImportSignature({
        ownerAddress: validatedData.ownerAddress,
        timestamp: validatedData.timestamp,
        signature: validatedData.signature,
      });
      if (!sigCheck.valid) {
        logger.warn(
          "ImportOpenAPI",
          `Signature rejected for ${validatedData.ownerAddress}: ${sigCheck.reason}`,
        );
        return res.status(401).json({
          error: "Invalid signature",
          reason: sigCheck.reason,
          message: "Sign: import-openapi:<ownerAddress>:<timestamp>",
        });
      }

      try {
        // Parse spec
        let source;
        if (req.file) {
          source = { buffer: req.file.buffer, filename: req.file.originalname };
        } else if (validatedData.specUrl) {
          await safeUrl(validatedData.specUrl);
          source = { url: validatedData.specUrl };
        } else {
          return res.status(400).json({ error: "No spec provided" });
        }

        const spec = await parseSpec(source);
        const endpoints = extractEndpoints(spec, {
          excludePaths: validatedData.excludePaths,
          baseUrlOverride: validatedData.baseUrl,
        });

        // SSRF check all generated URLs
        for (const ep of endpoints) {
          try {
            await safeUrl(ep.fullUrl);
          } catch {
            // Skip endpoints with unsafe URLs
            ep._skip = true;
            ep._skipReason = "SSRF: unsafe URL";
          }
        }

        // Check existing URLs
        const fullUrls = endpoints
          .filter((e) => !e._skip)
          .map((e) => e.fullUrl);
        const { data: existing } = await supabase
          .from("services")
          .select("url")
          .in("url", fullUrls.length > 0 ? fullUrls : ["__none__"]);
        const existingUrls = new Set((existing || []).map((s) => s.url));

        // Filter endpoints
        const skipped = [];
        const toImport = [];
        for (const ep of endpoints) {
          if (ep._skip) {
            skipped.push({
              path: ep.path,
              method: ep.method,
              reason: ep._skipReason,
            });
          } else if (existingUrls.has(ep.fullUrl)) {
            skipped.push({
              path: ep.path,
              method: ep.method,
              reason: "already_registered",
            });
          } else {
            toImport.push(ep);
          }
        }

        if (toImport.length === 0) {
          return res.status(200).json({
            success: true,
            spec_title: spec.info?.title || "Untitled",
            total_found: endpoints.length,
            imported: 0,
            skipped: skipped.length,
            skipped_details: skipped,
            services: [],
          });
        }

        // Build service objects
        const insertArray = toImport.map((ep) => {
          const key = `${ep.method}:${ep.path}`;
          return {
            name: ep.name,
            url: ep.fullUrl,
            description: ep.description,
            price_usdc:
              validatedData.priceOverrides?.[key] || validatedData.defaultPrice,
            owner_address: validatedData.ownerAddress,
            tags: [
              ...new Set([...(validatedData.defaultTags || []), ...ep.tags]),
            ].slice(0, 10),
            required_parameters: ep.parameters,
          };
        });

        // Insert
        const { data, error } = await supabase
          .from("services")
          .insert(insertArray)
          .select();

        if (error) {
          logger.error("Supabase", "/import-openapi error:", error.message);
          return res
            .status(500)
            .json({ error: "Import failed", message: "Internal server error" });
        }

        logger.info(
          "Bazaar",
          `OpenAPI import: ${data.length} services for ${validatedData.ownerAddress.slice(0, 10)}`,
        );
        logActivity(
          "openapi_import",
          `${data.length} services from "${spec.info?.title || "spec"}" by ${validatedData.ownerAddress.slice(0, 8)}`,
        );

        // Validate shared credentials ONCE against the first service URL, then store for all
        let importCredentialValidation;
        const importCredentials = req.body.credentials || null;
        if (importCredentials && data.length > 0) {
          // Validate against the first imported endpoint
          const testUrl = data[0].url;
          const firstResult = await attachCredentials(
            supabase,
            data[0].id,
            testUrl,
            importCredentials,
          );

          if (
            firstResult.error &&
            firstResult.validation?.status === "invalid"
          ) {
            // Credentials rejected — delete ALL imported services
            const ids = data.map((s) => s.id);
            await supabase.from("services").delete().in("id", ids);
            logger.warn(
              "ImportOpenAPI",
              `Credential validation failed: ${firstResult.error}`,
            );
            return res.status(400).json({
              error: "Credential validation failed",
              message: firstResult.error,
              spec_title: spec.info?.title || "Untitled",
            });
          }

          importCredentialValidation = firstResult.validation;

          // Store credentials for remaining services (skip validation — already validated once)
          if (data.length > 1) {
            await Promise.allSettled(
              data
                .slice(1)
                .map((svc) =>
                  storeCredentialsOnly(supabase, svc.id, importCredentials),
                ),
            );
          }
        }

        // Auto-test in batches of 5 (fire-and-forget)
        const BATCH_SIZE = 5;
        const BATCH_DELAY = 1000;
        (async () => {
          for (let i = 0; i < data.length; i += BATCH_SIZE) {
            const batch = data.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
              batch.map((svc) => autoTestService(svc, supabase)),
            );
            if (i + BATCH_SIZE < data.length) {
              await new Promise((r) => setTimeout(r, BATCH_DELAY));
            }
          }
        })();

        // ERC-8004 sequential minting with 500ms throttle (fire-and-forget)
        (async () => {
          for (const svc of data) {
            try {
              await registerOnChain(svc, supabase);
            } catch (err) {
              logger.error(
                "ERC8004",
                `Import on-chain failed for "${svc.name}": ${err.message}`,
              );
            }
            await new Promise((r) => setTimeout(r, 500));
          }
        })();

        // Notify admin
        notifyAdmin(
          `📦 *OpenAPI Import*\n*Spec:* ${spec.info?.title || "Untitled"}\n*Owner:* \`${validatedData.ownerAddress.slice(0, 10)}...\`\n*Imported:* ${data.length}\n*Skipped:* ${skipped.length}`,
        ).catch(() => {});

        const importResponse = {
          success: true,
          spec_title: spec.info?.title || "Untitled",
          total_found: endpoints.length,
          imported: data.length,
          skipped: skipped.length,
          skipped_details: skipped,
          services: data,
        };
        if (importCredentialValidation)
          importResponse.credential_validation = importCredentialValidation;
        res.status(201).json(importResponse);
      } catch (err) {
        logger.error("ImportOpenAPI", err.message);
        res.status(400).json({ error: "Import failed", message: err.message });
      }
    },
  );

  return router;
}

// --- Auto-test: deep x402 verification and notify admin ---
async function autoTestService(service, supabase) {
  const { name, url, id, price_usdc } = service;

  const report = await verifyService(url);

  // Update service verified status in Supabase
  const updateData = {
    verified_status: report.verdict,
    verified_at: new Date().toISOString(),
  };

  // Auto-save detected required_parameters if provider didn't provide them
  if (report.detectedParams && !service.required_parameters) {
    updateData.required_parameters = report.detectedParams;
    logger.info(
      "AutoTest",
      `Auto-detected required params for "${name}": ${report.detectedParams.required.join(", ")}`,
    );
  }

  try {
    await supabase.from("services").update(updateData).eq("id", id);
  } catch {
    // Column might not exist yet, that's OK
  }

  // Notify admin via Telegram with rich details
  const VERDICT_EMOJI = {
    mainnet_verified: "\u2705", // ✅
    reachable: "\u2139\uFE0F", // ℹ️
    testnet: "\u26A0\uFE0F", // ⚠️
    wrong_chain: "\u26A0\uFE0F", // ⚠️
    no_x402: "\u2753", // ❓
    offline: "\uD83D\uDD34", // 🔴
    potential_wrapper: "\u26A0\uFE0F", // ⚠️
  };
  const VERDICT_LABEL = {
    mainnet_verified: "MAINNET VERIFIE",
    reachable: "ACCESSIBLE (pas de x402)",
    testnet: "TESTNET",
    wrong_chain: "CHAIN INCONNUE",
    no_x402: "PAS DE x402",
    offline: "HORS LIGNE",
    potential_wrapper: "WRAPPER POTENTIEL",
  };

  const emoji = VERDICT_EMOJI[report.verdict] || "\u2753";
  const label = VERDICT_LABEL[report.verdict] || report.verdict;

  const lines = [
    `${emoji} *Nouveau service — ${label}*`,
    ``,
    `*Nom:* ${name}`,
    `*URL:* \`${url}\``,
    `*Prix:* ${price_usdc} USDC`,
    `*HTTP:* ${report.httpStatus || "N/A"}`,
    `*Latence:* ${report.latency}ms`,
  ];

  if (report.x402 && report.x402.valid) {
    lines.push(`*Chain:* ${report.x402.chainLabel} (${report.x402.network})`);
    lines.push(
      `*USDC:* ${report.x402.asset ? report.x402.asset.slice(0, 10) + "..." : "N/A"} ${report.x402.isValidUsdc ? "\u2705" : "\u274C"}`,
    );
    lines.push(
      `*Mainnet:* ${report.x402.isMainnet ? "Oui \u2705" : "Non \u274C"}`,
    );
    if (report.x402.payTo)
      lines.push(`*PayTo:* \`${report.x402.payTo.slice(0, 10)}...\``);
  }

  if (report.endpoints.health) lines.push(`*/health:* accessible \u2705`);
  if (report.details) lines.push(`\n_${report.details}_`);
  if (report.potentialWrapper) {
    lines.push(`\n\u26A0\uFE0F *ATTENTION: Wrapper potentiel détecté*`);
    lines.push(`_${report.wrapperReason}_`);
  }
  lines.push(`\n*ID:* \`${id.slice(0, 8)}...\``);

  await notifyAdmin(lines.filter(Boolean).join("\n"));

  logger.info(
    "AutoTest",
    `Service "${name}" (${id.slice(0, 8)}): ${report.verdict} — ${report.details}`,
  );
}

// --- Notify Community Agent of new API registration ---
// Auto-derive webhook URL from COMMUNITY_AGENT_URL if explicit env not set
const COMMUNITY_AGENT_WEBHOOK =
  process.env.COMMUNITY_AGENT_WEBHOOK_URL ||
  (process.env.COMMUNITY_AGENT_URL
    ? `${process.env.COMMUNITY_AGENT_URL.replace(/\/$/, "")}/api/webhook/new-api`
    : "");
const WEBHOOK_TIMEOUT = 5000;

async function notifyCommunityAgent({ name, description, price }) {
  if (!COMMUNITY_AGENT_WEBHOOK) return;

  // SSRF protection: validate the webhook URL before fetching
  try {
    await safeUrl(COMMUNITY_AGENT_WEBHOOK);
  } catch (e) {
    logger.warn("Webhook", `Blocked unsafe webhook URL: ${e.message}`);
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

  try {
    const res = await fetch(COMMUNITY_AGENT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiName: name,
        apiDescription: description || "",
        apiPrice: `${price} USDC`,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    logger.info(
      "Webhook",
      `Community agent notified for "${name}" (HTTP ${res.status})`,
    );
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// --- Register service on ERC-8004 Identity Registry (fire-and-forget) ---
async function registerOnChain(service, supabase) {
  const result = await registerAgent(
    service.id,
    service.name,
    service.url,
    service.description || "",
  );

  if (result && result.agentId != null) {
    await supabase
      .from("services")
      .update({
        erc8004_agent_id: result.agentId,
        erc8004_registered_at: new Date().toISOString(),
      })
      .eq("id", service.id);

    logger.info(
      "ERC8004",
      `"${service.name}" on-chain: agentId=${result.agentId}`,
    );
    await notifyAdmin(
      `\u26D3 *ERC-8004 Agent Registered*\n*Service:* ${service.name}\n*Agent ID:* ${result.agentId}\n*TX:* \`${result.txHash.slice(0, 18)}...\``,
    ).catch(() => {});
  }
}

module.exports = createRegisterRouter;
