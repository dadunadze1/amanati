import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const PORT = 5317;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `delivery-company-smoke-${process.pid}.json`);

let serverProcess;
let adminToken = "";
let courierToken = "";
let partnerToken = "";
let courierUsername = "";
let createdParcel;
let volumeParcel;

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

async function readTestDb() {
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function writeTestDb(db) {
  await writeFile(DB_FILE, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
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

    const script = await fetch(`${BASE_URL}/js/app.js?v=22`);
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
    await api(`/api/users/${encodeURIComponent(courierUsername)}/zone`, {
      method: "PUT",
      token: adminToken,
      body: { zoneIds: ["center"], zoneId: "center", zoneName: "ცენტრალური ზონა" },
    });

    const partnerUsername = `partner-${Date.now()}`;
    const partner = await api("/api/partners", {
      method: "POST",
      token: adminToken,
      body: {
        username: partnerUsername,
        password: "pass123",
        companyName: "Smoke Partner",
        contactPerson: "Partner Contact",
        phone: "555000222",
        pickupAddress: "Tbilisi, Smoke Pickup 7",
        pickupLat: 41.7151,
        pickupLng: 44.8271,
        pickupZoneId: "center",
      },
    });
    assert.equal(partner.partner.username, partnerUsername);
    assert.equal(partner.partner.pickupZoneId, "center");

    const partnerLogin = await api("/api/login", {
      method: "POST",
      body: { username: partnerUsername, password: "pass123" },
    });
    partnerToken = partnerLogin.token;
    const partnerTariffs = await api("/api/tariffs", { token: partnerToken });
    assert.equal(partnerTariffs.tariffs.volume_5_10.partnerPrice, 10);

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

    const legacyCodParcelId = `legacy-cod-${Date.now()}`;
    const codDb = await readTestDb();
    codDb.parcels.push({
      ...createdParcel,
      id: legacyCodParcelId,
      paymentAmount: 0,
      cashAmount: 0,
      codAmount: 77,
      status: "pending",
      archivedAt: "",
      deletedAt: "",
      updatedAt: new Date().toISOString(),
    });
    await writeTestDb(codDb);
    const legacyCodSearch = await api(`/api/parcels/search?status=pending&courier=${encodeURIComponent(courierUsername)}`, { token: adminToken });
    const legacyCodParcel = legacyCodSearch.parcels.find((parcel) => parcel.id === legacyCodParcelId);
    assert.equal(legacyCodParcel.paymentAmount, 77);

    const failed = await api(`/api/parcels/search?status=failed&courier=${encodeURIComponent(courierUsername)}`, { token: adminToken });
    assert.equal(failed.parcels.length, 0);

    const today = new Date().toISOString().slice(0, 10);
    const byDate = await api(`/api/parcels/search?dateFrom=${today}&dateTo=${today}`, { token: adminToken });
    assert.ok(byDate.parcels.some((parcel) => parcel.id === createdParcel.id));

    const paged = await api(`/api/parcels/search?status=pending&limit=1&offset=0`, { token: adminToken });
    assert.equal(paged.parcels.length, 1);
    assert.equal(paged.total >= 1, true);
    assert.equal(paged.limit, 1);
    assert.equal(paged.offset, 0);
    assert.equal(typeof paged.hasMore, "boolean");

    const volumeCreated = await api("/api/parcels", {
      method: "POST",
      token: adminToken,
      body: {
        courierUsername,
        partnerId: partner.partner.id,
        city: "Tbilisi",
        address: "Smoke Volume Street 12",
        fullAddress: "Tbilisi, Smoke Volume Street 12",
        fullName: "Volume Recipient",
        phone: "555123456",
        paymentAmount: 0,
        lat: 41.7151,
        lng: 44.8271,
        tariffId: "volume_5_10",
      },
    });
    assert.equal(volumeCreated.parcel.tariffId, "volume_5_10");
    assert.equal(volumeCreated.parcel.partnerName, "Smoke Partner");
    assert.equal(volumeCreated.parcel.deliveryTotalPrice, 10);
    assert.equal(volumeCreated.parcel.courierPay, 3.5);
    assert.equal(volumeCreated.parcel.adminProfit, 6.5);

    const adminPickups = await api("/api/partner-pickups", { token: adminToken });
    const adminPickup = adminPickups.pickups.find((pickup) => pickup.partnerUsername === partnerUsername);
    assert.equal(adminPickup.count, 1);
    assert.equal(adminPickup.zoneId, "center");

    const courierPickups = await api("/api/partner-pickups", { token: courierToken });
    assert.equal(courierPickups.pickups.some((pickup) => pickup.partnerUsername === partnerUsername), true);

    const pickupAck = await api(`/api/partners/${encodeURIComponent(partnerUsername)}/pickup-ack`, {
      method: "POST",
      token: courierToken,
    });
    assert.equal(pickupAck.acknowledgedCount, 1);

    const partnerParcelsAfterPickup = await api("/api/parcels", { token: partnerToken });
    const pickedUpParcel = partnerParcelsAfterPickup.parcels.find((parcel) => parcel.id === volumeCreated.parcel.id);
    assert.ok(pickedUpParcel.pickedUpAt);

    const pickedUpDelete = await request(`/api/parcels/${encodeURIComponent(volumeCreated.parcel.id)}`, {
      method: "DELETE",
      token: partnerToken,
      body: { expectedUpdatedAt: pickedUpParcel.updatedAt },
    });
    assert.equal(pickedUpDelete.response.status, 403);

    const hiddenPickups = await api("/api/partner-pickups", { token: adminToken });
    assert.equal(hiddenPickups.pickups.some((pickup) => pickup.partnerUsername === partnerUsername), false);

    const postAckCreated = await api("/api/parcels", {
      method: "POST",
      token: adminToken,
      body: {
        courierUsername,
        partnerId: partner.partner.id,
        city: "Tbilisi",
        address: "Smoke Pickup Return 12",
        fullAddress: "Tbilisi, Smoke Pickup Return 12",
        fullName: "Pickup Return Recipient",
        phone: "555123457",
        paymentAmount: 0,
        lat: 41.7151,
        lng: 44.8271,
      },
    });
    const returnedPickups = await api("/api/partner-pickups", { token: adminToken });
    const returnedPickup = returnedPickups.pickups.find((pickup) => pickup.partnerUsername === partnerUsername);
    assert.equal(returnedPickup.count, 1);
    assert.equal(returnedPickup.orderIds.includes(postAckCreated.parcel.id), true);

    const volumeDelivered = await api(`/api/parcels/${volumeCreated.parcel.id}/status`, {
      method: "PATCH",
      token: courierToken,
      body: { status: "delivered", expectedUpdatedAt: pickedUpParcel.updatedAt },
    });
    volumeParcel = volumeDelivered.parcel;
    assert.equal(volumeParcel.deliveryTotalPrice, 10);
    assert.equal(volumeParcel.courierPay, 3.5);
    assert.equal(volumeParcel.adminProfit, 6.5);
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

  it("advances finance workday only when admin closes the day", async () => {
    const initialWorkday = await api("/api/workday", { token: adminToken });
    const currentWorkdayKey = initialWorkday.workday.currentWorkdayKey;

    const firstCreated = await api("/api/parcels", {
      method: "POST",
      token: adminToken,
      body: {
        courierUsername,
        city: "Tbilisi",
        address: "Workday First Street 12",
        fullAddress: "Tbilisi, Workday First Street 12",
        fullName: "Workday First",
        phone: "555121001",
        paymentAmount: 25,
        lat: 41.7151,
        lng: 44.8271,
      },
    });
    assert.equal(firstCreated.parcel.workdayKey, currentWorkdayKey);

    const firstDelivered = await api(`/api/parcels/${firstCreated.parcel.id}/status`, {
      method: "PATCH",
      token: courierToken,
      body: { status: "delivered", expectedUpdatedAt: firstCreated.parcel.updatedAt },
    });
    assert.equal(firstDelivered.parcel.financeDateKey, currentWorkdayKey);

    const close = await api("/api/parcels/archive", {
      method: "POST",
      token: adminToken,
      body: {
        closeWorkday: true,
        workdayKey: currentWorkdayKey,
        parcelIds: [firstCreated.parcel.id],
      },
    });
    assert.equal(close.archived, 1);
    assert.notEqual(close.workday.currentWorkdayKey, currentWorkdayKey);

    const secondCreated = await api("/api/parcels", {
      method: "POST",
      token: adminToken,
      body: {
        courierUsername,
        city: "Tbilisi",
        address: "Workday Second Street 12",
        fullAddress: "Tbilisi, Workday Second Street 12",
        fullName: "Workday Second",
        phone: "555121002",
        paymentAmount: 40,
        lat: 41.7151,
        lng: 44.8271,
      },
    });
    assert.equal(secondCreated.parcel.workdayKey, close.workday.currentWorkdayKey);

    const secondDelivered = await api(`/api/parcels/${secondCreated.parcel.id}/status`, {
      method: "PATCH",
      token: courierToken,
      body: { status: "delivered", expectedUpdatedAt: secondCreated.parcel.updatedAt },
    });
    assert.equal(secondDelivered.parcel.financeDateKey, close.workday.currentWorkdayKey);

    const oldDayClose = await api("/api/parcels/archive", {
      method: "POST",
      token: adminToken,
      body: {
        closeWorkday: true,
        workdayKey: currentWorkdayKey,
        parcelIds: [secondCreated.parcel.id],
      },
    });
    assert.equal(oldDayClose.archived, 0);

    const liveWorkday = await api("/api/workday", { token: adminToken });
    const calendarDateKey = liveWorkday.workday.calendarDateKey;
    const staleWorkdayKey = addDaysToDateKey(calendarDateKey, -2);
    const staleNextDayKey = addDaysToDateKey(staleWorkdayKey, 1);
    const db = await readTestDb();
    db.settings = {
      ...(db.settings || {}),
      currentWorkdayKey: staleWorkdayKey,
      currentWorkdayStartedAt: `${staleWorkdayKey}T08:00:00.000Z`,
    };
    await writeTestDb(db);

    const staleCreated = await api("/api/parcels", {
      method: "POST",
      token: adminToken,
      body: {
        courierUsername,
        city: "Tbilisi",
        address: "Stale Workday Street 12",
        fullAddress: "Tbilisi, Stale Workday Street 12",
        fullName: "Stale Workday",
        phone: "555121003",
        paymentAmount: 30,
        lat: 41.7151,
        lng: 44.8271,
      },
    });
    assert.equal(staleCreated.parcel.workdayKey, staleWorkdayKey);

    const staleDelivered = await api(`/api/parcels/${staleCreated.parcel.id}/status`, {
      method: "PATCH",
      token: courierToken,
      body: { status: "delivered", expectedUpdatedAt: staleCreated.parcel.updatedAt },
    });
    assert.equal(staleDelivered.parcel.financeDateKey, staleWorkdayKey);

    const staleClose = await api("/api/parcels/archive", {
      method: "POST",
      token: adminToken,
      body: {
        closeWorkday: true,
        workdayKey: staleWorkdayKey,
        parcelIds: [staleCreated.parcel.id],
      },
    });
    assert.equal(staleClose.archived, 1);
    assert.equal(staleClose.workday.currentWorkdayKey >= calendarDateKey, true);
    assert.notEqual(staleClose.workday.currentWorkdayKey, staleNextDayKey);
  });
});
