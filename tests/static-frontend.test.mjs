import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, it } from "node:test";

async function loadStaticFrontendContext() {
  const files = [
    "frontend/js/config.js",
    "frontend/js/state.js",
    "frontend/js/zones.js",
    "frontend/js/api.js",
  ];
  const source = `${(await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n")}
globalThis.__staticFrontendTest = {
  toDateKey,
  getStaticPartnerPickupCoords,
  getStaticPartnerPickupZoneId,
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
