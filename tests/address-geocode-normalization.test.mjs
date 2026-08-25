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

  it("uses the street segment from comma-separated OCR addresses", async () => {
    const helpers = await loadMapAddressHelpers();

    const gulua = helpers.parseAddressQuery("თბილისი, ორთაჭალა, გულუას ქ. 10");
    assert.equal(gulua.houseNumber, "10");
    assert.equal(gulua.street, "გულუას ქ.");

    const didiDighomi = helpers.parseAddressQuery("თბილისი, დიდი დიღომი, არჩილ მეფის 10");
    assert.equal(didiDighomi.houseNumber, "10");
    assert.equal(didiDighomi.street, "არჩილ მეფის");

    const vajaQuarter = helpers.parseAddressQuery("ვაჟა ფშაველას მე6 კვარტალი");
    assert.equal(vajaQuarter.street, "ვაჟა-ფშაველა 6 კვარტალი");
  });

  it("normalizes common Tbilisi neighborhood case forms", async () => {
    const helpers = await loadMapAddressHelpers();
    const cases = [
      ["ვაკეში აბაშიძის 12", "ვაკე აბაშიძის 12"],
      ["საბურთალოზე საირმის 8", "საბურთალო საირმის 8"],
      ["გლდანში ხიზანიშვილის 20", "გლდანი ხიზანიშვილის 20"],
      ["ისანში ქეთევან წამებულის 44", "ისანი ქეთევან წამებულის 44"],
      ["სამგორში მოსკოვის 15", "სამგორი მოსკოვის 15"],
      ["ავლაბარში მესხიშვილის 3", "ავლაბარი მესხიშვილის 3"],
      ["კრწანისში გორგასლის 9", "კრწანისი გორგასლის 9"],
      ["დიდ დიღომში მირიან მეფის 22", "დიდი დიღომი მირიან მეფის 22"],
      ["მთაწმინდაზე ჭონქაძის 6", "მთაწმინდა ჭონქაძის 6"],
      ["ნაძალადევში ცოტნე დადიანის 11", "ნაძალადევი ცოტნე დადიანის 11"],
    ];

    for (const [input, expected] of cases) {
      assert.equal(helpers.normalizeGeocodeQuery(input), expected, input);
    }
  });

  it("falls back locally for ortachala and gulua searches", async () => {
    const helpers = await loadMapAddressHelpers();
    const parsed = helpers.parseAddressQuery("თბილისი, ორთაჭალაში გულუას ქ 10");
    const results = helpers.searchLocalAddressFallback(parsed);

    assert.equal(results.length, 1);
    assert.equal(results[0].address, "გულუას ქუჩა 10");
  });
});
