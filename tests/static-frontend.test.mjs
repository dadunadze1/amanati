import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, it } from "node:test";

async function loadStaticFrontendContext() {
  const files = [
    "frontend/js/config.js",
    "frontend/js/state.js",
    "frontend/js/utils.js",
    "frontend/js/zones.js",
    "frontend/js/api.js",
  ];
  const source = `${(await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n")}
globalThis.__staticFrontendTest = {
  toDateKey,
  getStaticPartnerPickupCoords,
  getStaticPartnerPickupZoneId,
  getParcelStatsDateKey,
  parcelMatchesStatsDateRange,
  getStaticParcelWorkdayDateKey,
  staticParcelMatchesWorkdayDateRange,
  getStaticParcelSearchDateKeys,
  backfillStaticPartnerPickupZones,
};`;
  const context = {
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "static-frontend-bundle.js" });
  return context.__staticFrontendTest;
}

describe("static frontend helpers", () => {
  it("uses the Tbilisi calendar day for timestamp date keys", async () => {
    const helpers = await loadStaticFrontendContext();
    assert.equal(helpers.toDateKey("2026-08-26T20:30:00.000Z"), "2026-08-27");
    assert.equal(helpers.toDateKey("2026-08-27"), "2026-08-27");
  });

  it("uses real delivery dates before workday, finance, archive, or creation dates", async () => {
    const helpers = await loadStaticFrontendContext();
    const parcel = {
      id: "cross-day-delivery",
      status: "delivered",
      createdAt: "2026-08-25T09:00:00.000Z",
      workdayKey: "2026-08-25",
      completedWorkdayKey: "2026-08-25",
      financeDateKey: "2026-08-25",
      deliveredAt: "2026-08-27T10:00:00.000Z",
      completedAt: "2026-08-27T10:00:00.000Z",
      archivedAt: "2026-08-28T08:00:00.000Z",
      updatedAt: "2026-08-28T08:00:00.000Z",
    };

    assert.equal(helpers.getParcelStatsDateKey(parcel), "2026-08-27");
    assert.equal(helpers.parcelMatchesStatsDateRange(parcel, "2026-08-25", "2026-08-25"), false);
    assert.equal(helpers.parcelMatchesStatsDateRange(parcel, "2026-08-27", "2026-08-27"), true);
    assert.equal(helpers.getStaticParcelWorkdayDateKey(parcel), "2026-08-27");
    assert.deepEqual(Array.from(helpers.getStaticParcelSearchDateKeys(parcel)), ["2026-08-27"]);
    assert.equal(helpers.staticParcelMatchesWorkdayDateRange(parcel, { start: "2026-08-25", end: "2026-08-25" }), false);
    assert.equal(helpers.staticParcelMatchesWorkdayDateRange(parcel, { start: "2026-08-27", end: "2026-08-27" }), true);
  });

  it("detects partner pickup zones from both stored fields and raw coordinates", async () => {
    const helpers = await loadStaticFrontendContext();
    const coords = helpers.getStaticPartnerPickupCoords({ lat: 41.7151, lng: 44.8271 });
    assert.equal(coords.lat, 41.7151);
    assert.equal(coords.lng, 44.8271);
    assert.equal(helpers.getStaticPartnerPickupZoneId({ lat: 41.7151, lng: 44.8271 }), "center");
    assert.equal(helpers.getStaticPartnerPickupZoneId({ pickupLat: 41.7151, pickupLng: 44.8271 }), "center");
  });

  it("backfills missing partner pickup zone ids", async () => {
    const helpers = await loadStaticFrontendContext();
    const store = {
      users: [{
        role: "partner",
        username: "partner@test.local",
        pickupLat: 41.7151,
        pickupLng: 44.8271,
        pickupZoneId: "",
        pickupZoneName: "",
      }],
    };
    assert.equal(helpers.backfillStaticPartnerPickupZones(store), true);
    assert.equal(store.users[0].pickupZoneId, "center");
  });
});
