// tests/register-schema.test.js — Tests Zod pour ServiceRegistrationSchema (schemas/index.js)
// Stratégie : tester chaque contrainte de validation indépendamment (AAA).
// Zod v4 : les erreurs sont dans result.error.issues (plus result.error.errors).
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ServiceRegistrationSchema } = require("../schemas/index.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validPayload(overrides = {}) {
  return {
    name: "My Weather API",
    url: "https://api.example.com/weather",
    price: 0.01,
    ownerAddress: "0x" + "a".repeat(40),
    ...overrides,
  };
}

function firstIssueMessage(result) {
  return (
    result.error?.issues?.[0]?.message ||
    result.error?.message ||
    "(no message)"
  );
}

// ─── Suite 1 : cas nominal ────────────────────────────────────────────────────

describe("ServiceRegistrationSchema — cas nominal", () => {
  it("should accept a valid minimal payload", () => {
    const result = ServiceRegistrationSchema.safeParse(validPayload());
    assert.strictEqual(
      result.success,
      true,
      `Unexpected error: ${firstIssueMessage(result)}`,
    );
  });

  it("should accept price = 0 (gratuit)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: 0 }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept price = 1000 (maximum)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: 1000 }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept a name with exactly 1 character (minimum)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ name: "X" }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept a name with exactly 200 characters (maximum)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ name: "a".repeat(200) }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept an optional description", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ description: "A useful API" }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.description, "A useful API");
  });

  it("should default description to empty string when not provided", () => {
    const result = ServiceRegistrationSchema.safeParse(validPayload());
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.description, "");
  });

  it("should default tags to empty array when not provided", () => {
    const result = ServiceRegistrationSchema.safeParse(validPayload());
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data.tags, []);
  });

  it("should accept tags array with up to 10 items", () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const result = ServiceRegistrationSchema.safeParse(validPayload({ tags }));
    assert.strictEqual(result.success, true);
  });

  it("should trim whitespace from name", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ name: "  My API  " }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.name, "My API");
  });

  it("should accept required_parameters with only the required array", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ required_parameters: { required: ["q", "lang"] } }),
    );
    assert.strictEqual(result.success, true, firstIssueMessage(result));
  });

  it("should accept required_parameters as null", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ required_parameters: null }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept required_parameters as undefined (optional)", () => {
    const result = ServiceRegistrationSchema.safeParse(validPayload());
    assert.strictEqual(result.success, true);
    // required_parameters absent → undefined or not present
  });
});

// ─── Suite 2 : validation du prix ────────────────────────────────────────────

describe("ServiceRegistrationSchema — validation du prix", () => {
  it("should reject price above 1000", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: 1000.01 }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(
      firstIssueMessage(result).includes("1000"),
      `expected "1000" in message: ${firstIssueMessage(result)}`,
    );
  });

  it("should reject price = 1001", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: 1001 }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject negative price", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: -0.001 }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(
      firstIssueMessage(result).includes("0"),
      `expected "0" in message: ${firstIssueMessage(result)}`,
    );
  });

  it("should reject price = -1", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: -1 }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject price as string", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: "0.01" }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject price as null", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ price: null }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject missing price", () => {
    const payload = validPayload();
    delete payload.price;
    const result = ServiceRegistrationSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });
});

// ─── Suite 3 : validation du nom ─────────────────────────────────────────────

describe("ServiceRegistrationSchema — validation du nom", () => {
  it("should reject empty name", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ name: "" }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(
      firstIssueMessage(result).toLowerCase().includes("required") ||
        firstIssueMessage(result).includes("1"),
      `unexpected message: ${firstIssueMessage(result)}`,
    );
  });

  it("should reject name with only whitespace (trimmed to empty)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ name: "   " }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject name with 201 characters", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ name: "a".repeat(201) }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(firstIssueMessage(result).includes("200"));
  });

  it("should reject missing name field", () => {
    const payload = validPayload();
    delete payload.name;
    const result = ServiceRegistrationSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });
});

// ─── Suite 4 : validation de l'URL ───────────────────────────────────────────

describe("ServiceRegistrationSchema — validation de l'URL", () => {
  it("should accept https URL", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ url: "https://api.example.com/v2/data" }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept http URL (schema ne restreint pas au https)", () => {
    // Note: le schéma Zod accepte http et https (z.string().url())
    // La restriction https est faite au niveau de la route register.js
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ url: "http://example.com/api" }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should reject a non-URL string", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ url: "not-a-url" }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject URL longer than 500 characters", () => {
    const longUrl = "https://example.com/" + "a".repeat(490);
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ url: longUrl }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject empty URL", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ url: "" }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject missing URL field", () => {
    const payload = validPayload();
    delete payload.url;
    const result = ServiceRegistrationSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });

  it("should reject ftp:// URL (not http/https)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ url: "ftp://example.com/api" }),
    );
    assert.strictEqual(
      result.success,
      false,
      "ftp URLs must be rejected at schema level",
    );
  });
});

// ─── Suite 5 : validation ownerAddress ───────────────────────────────────────

describe("ServiceRegistrationSchema — validation ownerAddress", () => {
  it("should accept a valid checksummed address", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({
        ownerAddress: "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430",
      }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept a lowercase address", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ ownerAddress: "0x" + "a".repeat(40) }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should reject an address without 0x prefix", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ ownerAddress: "a".repeat(40) }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(
      firstIssueMessage(result).toLowerCase().includes("address") ||
        firstIssueMessage(result).includes("0x"),
      `unexpected message: ${firstIssueMessage(result)}`,
    );
  });

  it("should reject an address that is too short (41 chars total)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ ownerAddress: "0x" + "a".repeat(39) }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject an address that is too long (43 chars total)", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ ownerAddress: "0x" + "a".repeat(41) }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject an address with non-hex characters", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ ownerAddress: "0x" + "g".repeat(40) }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should reject a missing ownerAddress", () => {
    const payload = validPayload();
    delete payload.ownerAddress;
    const result = ServiceRegistrationSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });

  it("should reject null ownerAddress", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ ownerAddress: null }),
    );
    assert.strictEqual(result.success, false);
  });
});

// ─── Suite 6 : validation description ────────────────────────────────────────

describe("ServiceRegistrationSchema — validation description", () => {
  it("should accept description at exactly 1000 characters", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ description: "a".repeat(1000) }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should reject description longer than 1000 characters", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ description: "a".repeat(1001) }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(firstIssueMessage(result).includes("1000"));
  });

  it("should trim whitespace from description", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ description: "  A good API  " }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.description, "A good API");
  });
});

// ─── Suite 7 : validation tags ────────────────────────────────────────────────

describe("ServiceRegistrationSchema — validation tags", () => {
  it("should reject more than 10 tags", () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const result = ServiceRegistrationSchema.safeParse(validPayload({ tags }));
    assert.strictEqual(result.success, false);
  });

  it("should reject a tag longer than 50 characters", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ tags: ["a".repeat(51)] }),
    );
    assert.strictEqual(result.success, false);
  });

  it("should accept a tag with exactly 50 characters", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ tags: ["a".repeat(50)] }),
    );
    assert.strictEqual(result.success, true);
  });

  it("should accept an empty tags array", () => {
    const result = ServiceRegistrationSchema.safeParse(
      validPayload({ tags: [] }),
    );
    assert.strictEqual(result.success, true);
  });
});
