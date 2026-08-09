import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const PORT = 5317;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `delivery-company-smoke-${process.pid}.json`);

let serverProcess;
let adminToken = "";
let courierToken = "";
let courierUsername = "";
let createdParcel;

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();
  return { response, payload };
}

async function api(path, options = {}) {
  const result = await request(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed with ${result.response.status}: ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const result = await request("/api/bootstrap");
      if (result.response.ok) return;
    } catch {
      // The child process may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Smoke test server did not start");
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.killed) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      serverProcess.kill("SIGKILL");
      resolve();
    }, 3000);
    serverProcess.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    serverProcess.kill("SIGTERM");
  });
}

before(async () => {
  await rm(DB_FILE, { force: true });
  serverProcess = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DB_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(async () => {
  await stopServer();
  await rm(DB_FILE, { force: true });
});

describe("local API smoke flow", () => {
  it("serves the app shell, push route, and versioned assets", async () => {
    const root = await fetch(`${BASE_URL}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /id="map"/);

    const push = await fetch(`${BASE_URL}/push`);
    assert.equal(push.status, 200);
    assert.match(await push.text(), /id="map"/);

    const script = await fetch(`${BASE_URL}/js/app.js?v=21`);
    assert.equal(script.status, 200);
    assert.equal(script.headers.get("cache-control"), "public, max-age=31536000, immutable");
  });

  it("creates an admin and rejects removed partner inbox API", async () => {
    const bootstrapBefore = await api("/api/bootstrap");
    assert.equal(bootstrapBefore.hasAdmin, false);

    const setup = await api("/api/setup-admin", {
      method: "POST",
      body: { username: "admin", password: "pass123" },
    });
    assert.ok(setup.token);
    adminToken = setup.token;
    assert.equal(setup.user.role, "admin");

    const inboxResult = await request("/api/partner-inbox/messages", { token: adminToken });
    assert.equal(inboxResult.response.status, 404);
  });

  it("creates users and filters parcels server-side", async () => {
    courierUsername = `courier-${Date.now()}`;
    const user = await api("/api/users", {
      method: "POST",
      token: adminToken,
      body: {
        username: courierUsername,
        password: "pass123",
        role: "courier",
        firstName: "Smoke",
        lastName: "Courier",
        phone: "555000111",
      },
    });
    assert.equal(user.user.username, courierUsername);

    const login = await api("/api/login", {
      method: "POST",
      body: { username: courierUsername, password: "pass123" },
    });
    courierToken = login.token;
    assert.ok(courierToken);

    const created = await api("/api/parcels", {
      method: "POST",
      token: adminToken,
      body: {
        courierUsername,
        city: "Tbilisi",
        address: "Smoke Street 12",
        fullAddress: "Tbilisi, Smoke Street 12",
        fullName: "Smoke Recipient",
        phone: "555123123",
        paymentAmount: 12.5,
        lat: 41.7151,
        lng: 44.8271,
      },
    });
    createdParcel = created.parcel;
    assert.ok(createdParcel.id);
    assert.equal(createdParcel.status, "pending");

    const pending = await api(`/api/parcels/search?status=pending&courier=${encodeURIComponent(courierUsername)}`, { token: adminToken });
    assert.equal(pending.parcels.length, 1);
    assert.equal(pending.parcels[0].id, createdParcel.id);

    const failed = await api(`/api/parcels/search?status=failed&courier=${encodeURIComponent(courierUsername)}`, { token: adminToken });
    assert.equal(failed.parcels.length, 0);

    const today = new Date().toISOString().slice(0, 10);
    const byDate = await api(`/api/parcels/search?dateFrom=${today}&dateTo=${today}`, { token: adminToken });
    assert.ok(byDate.parcels.some((parcel) => parcel.id === createdParcel.id));
  });

  it("allows courier status updates and archive flow", async () => {
    const delivered = await api(`/api/parcels/${createdParcel.id}/status`, {
      method: "PATCH",
      token: courierToken,
      body: { status: "delivered", expectedUpdatedAt: createdParcel.updatedAt },
    });
    assert.equal(delivered.parcel.status, "delivered");

    const archive = await api("/api/parcels/archive", {
      method: "POST",
      token: adminToken,
      body: { parcelIds: [createdParcel.id] },
    });
    assert.equal(archive.archived, 1);

    const history = await api(`/api/history?courier=${encodeURIComponent(courierUsername)}`, { token: adminToken });
    assert.ok(history.history.some((parcel) => parcel.id === createdParcel.id));
  });
});
