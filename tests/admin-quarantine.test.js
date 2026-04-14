const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createAdminQuarantineRouter = require("../routes/admin-quarantine");

// Minimal mock helpers
function mockSupabase(overrides = {}) {
  const chainable = {
    select: () => chainable,
    eq: () => chainable,
    order: () => chainable,
    single: () => chainable,
    update: () => chainable,
    from: () => chainable,
    ...overrides,
  };
  // Allow terminal methods to return promises
  if (overrides.terminalData !== undefined) {
    chainable.single = () =>
      Promise.resolve({ data: overrides.terminalData, error: null });
    chainable.order = () =>
      Promise.resolve({ data: overrides.listData || [], error: null });
  }
  return { from: () => chainable };
}

function noopAuth(req, res, next) {
  next();
}

function noopActivity() {}

async function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const http = require("http");
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path,
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/quarantine
// ────────────────────────────────────────────────────────────────────
describe("admin-quarantine — GET /api/admin/quarantine", () => {
  it("returns empty list when no quarantined services", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "GET", "/api/admin/quarantine");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.count, 0);
    assert.deepStrictEqual(res.body.services, []);
    assert.ok(res.body.fetched_at);
  });

  it("returns quarantined services", async () => {
    const quarantined = [
      {
        id: "abc-123",
        name: "Broken API",
        url: "https://example.com/api",
        owner_address: "0x14B81D",
        status: "quarantined",
        verified_status: "bare_402",
        created_at: "2026-04-14T00:00:00Z",
      },
    ];
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: quarantined, error: null }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "GET", "/api/admin/quarantine");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.count, 1);
    assert.strictEqual(res.body.services[0].name, "Broken API");
  });

  it("returns 500 on DB error", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: null, error: { message: "DB down" } }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "GET", "/api/admin/quarantine");
    assert.strictEqual(res.status, 500);
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/unquarantine/:id
// ────────────────────────────────────────────────────────────────────
describe("admin-quarantine — POST /api/admin/unquarantine/:id", () => {
  it("successfully unquarantines a quarantined service", async () => {
    let updatedWith = null;
    const supabase = {
      from: () => ({
        select: () => ({
          eq: function () {
            // Chain eq calls, return single at the end
            return {
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "svc-1",
                      name: "Test API",
                      status: "quarantined",
                      verified_status: "bare_402",
                    },
                    error: null,
                  }),
              }),
              single: () =>
                Promise.resolve({
                  data: {
                    id: "svc-1",
                    name: "Test API",
                    status: "quarantined",
                    verified_status: "bare_402",
                  },
                  error: null,
                }),
            };
          },
        }),
        update: (payload) => {
          updatedWith = payload;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/unquarantine/svc-1", {
      reason: "Provider fixed their integration",
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.new_status, "unknown");
    assert.strictEqual(res.body.service_name, "Test API");
    assert.deepStrictEqual(updatedWith, {
      status: "unknown",
      verified_status: null,
    });
  });

  it("returns 404 when service not found", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: null, error: { message: "not found" } }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/unquarantine/nope");
    assert.strictEqual(res.status, 404);
  });

  it("returns 409 when service is not quarantined", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { id: "svc-2", name: "OK API", status: "online" },
                error: null,
              }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/unquarantine/svc-2");
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.current_status, "online");
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/quarantine/:id
// ────────────────────────────────────────────────────────────────────
describe("admin-quarantine — POST /api/admin/quarantine/:id", () => {
  it("successfully quarantines a service", async () => {
    let updatedWith = null;
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { id: "svc-3", name: "Shady API", status: "unknown" },
                error: null,
              }),
          }),
        }),
        update: (payload) => {
          updatedWith = payload;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/quarantine/svc-3", {
      reason: "Returns garbage data",
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.new_status, "quarantined");
    assert.deepStrictEqual(updatedWith, {
      status: "quarantined",
      verified_status: "Returns garbage data",
    });
  });

  it("defaults verified_status to manual_quarantine when no reason", async () => {
    let updatedWith = null;
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { id: "svc-4", name: "Bad API", status: "online" },
                error: null,
              }),
          }),
        }),
        update: (payload) => {
          updatedWith = payload;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/quarantine/svc-4");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(updatedWith, {
      status: "quarantined",
      verified_status: "manual_quarantine",
    });
  });

  it("returns 409 when service is already quarantined", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: "svc-5",
                  name: "Already Q",
                  status: "quarantined",
                },
                error: null,
              }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/quarantine/svc-5");
    assert.strictEqual(res.status, 409);
  });

  it("returns 404 when service does not exist", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: "not found" },
              }),
          }),
        }),
      }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminQuarantineRouter(supabase, noopAuth, noopActivity));

    const res = await request(app, "POST", "/api/admin/quarantine/nope");
    assert.strictEqual(res.status, 404);
  });
});
