import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, it } from "node:test";

async function loadMapAddressHelpers() {
  const source = `${await readFile("frontend/js/map.js", "utf8")}
globalThis.__mapAddressHelpers = {
  normalizeGeocodeQuery,
  parseAddressQuery,
  searchLocalAddressFallback,
};`;
  const context = {
    CONFIG: { useExternalAddressSearch: false },
    console,
    window: { addEventListener: () => {}, visualViewport: { addEventListener: () => {} } },
    document: { addEventListener: () => {} },
    state: {},
    els: {},
    cleanAddressInput: (value) => String(value || "").replace(/\s+/g, " ").trim(),
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "map-address-helpers.js" });
  return context.__mapAddressHelpers;
}

describe("address geocode normalization", () => {
  it("normalizes Georgian locative district suffixes before search", async () => {
    const helpers = await loadMapAddressHelpers();
    const parsed = helpers.parseAddressQuery("თბილისი, ორთაჭალაში გულუას ქ 10");

    assert.equal(parsed.original, "თბილისი, ორთაჭალა გულუას ქ 10");
    assert.equal(parsed.houseNumber, "10");
    assert.equal(parsed.street, "ორთაჭალა გულუას");
    assert.match(parsed.searchQuery, /ორთაჭალა/);
  });

  it("falls back locally for ortachala and gulua searches", async () => {
    const helpers = await loadMapAddressHelpers();
    const parsed = helpers.parseAddressQuery("თბილისი, ორთაჭალაში გულუას ქ 10");
    const results = helpers.searchLocalAddressFallback(parsed);

    assert.equal(results.length, 1);
    assert.equal(results[0].address, "ორთაჭალა 10");
  });
});
