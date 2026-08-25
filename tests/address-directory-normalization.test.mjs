import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, it } from "node:test";

async function loadAddressDirectoryHelpers() {
  const source = `${await readFile("frontend/js/address-directory.js", "utf8")}
globalThis.__addressDirectoryHelpers = {
  setAddressDirectoryData,
  normalizeAddressDirectoryAddress,
};`;
  const context = {
    console,
    cleanAddressInput: (value) => String(value || "").replace(/\s+/g, " ").trim(),
    escapeAttr: (value) => String(value ?? ""),
    escapeHtml: (value) => String(value ?? ""),
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "address-directory-helpers.js" });
  context.__addressDirectoryHelpers.setAddressDirectoryData(JSON.parse(await readFile("frontend/data/address-directory.json", "utf8")));
  return context.__addressDirectoryHelpers;
}

describe("address directory normalization", () => {
  it("keeps the real street from OCR addresses instead of replacing it with a neighborhood", async () => {
    const helpers = await loadAddressDirectoryHelpers();

    const normalized = helpers.normalizeAddressDirectoryAddress("თბილისი, ორთაჭალა, გულუას ქ. 10");

    assert.equal(normalized.address, "თბილისი, ორთაჭალა, გულუას ქ. 10");
    assert.equal(normalized.neighborhood, "ორთაჭალა");
    assert.equal(normalized.streetPart, "გულუას ქ. 10");
    assert.match(normalized.match.street, /გულუა/);
  });

  it("preserves an explicit OCR neighborhood when the street is stored under a broader district", async () => {
    const helpers = await loadAddressDirectoryHelpers();

    const normalized = helpers.normalizeAddressDirectoryAddress("თბილისი, დიდი დიღომი, არჩილ მეფის 10");

    assert.equal(normalized.address, "თბილისი, დიდი დიღომი, არჩილ მეფის 10");
    assert.equal(normalized.neighborhood, "დიდი დიღომი");
    assert.equal(normalized.streetPart, "არჩილ მეფის 10");
  });

  it("does not match street names from substrings inside the city name", async () => {
    const helpers = await loadAddressDirectoryHelpers();

    const normalized = helpers.normalizeAddressDirectoryAddress("თბილისი, ტყიბულის ქუჩა");

    assert.equal(normalized.address, "თბილისი, ნაძალადევი, ტყიბულის ქუჩა");
    assert.equal(normalized.neighborhood, "ნაძალადევი");
    assert.equal(normalized.streetPart, "ტყიბულის ქუჩა");
    assert.match(normalized.match.street, /ტყიბულის/);
  });

  it("normalizes attached Georgian ordinal quarter numbers", async () => {
    const helpers = await loadAddressDirectoryHelpers();

    const normalized = helpers.normalizeAddressDirectoryAddress("ვაჟა ფშაველას მე6 კვარტალი");

    assert.equal(normalized.address, "თბილისი, ვაჟა-ფშაველა, ვაჟა ფშაველას მე6 კვარტალი");
    assert.equal(normalized.neighborhood, "ვაჟა-ფშაველა");
    assert.equal(normalized.match.street, "ვაჟა-ფშაველას VI კვარტალი");
  });

  it("matches Georgian quarter, microdistrict, and plateau aliases across districts", async () => {
    const helpers = await loadAddressDirectoryHelpers();
    const cases = [
      ["გლდანის მე2 მიკრო", "გლდანი", "გლდანის II მიკრორაიონი"],
      ["მუხიანის მე4 მიკრორაიონი", "მუხიანი", "მუხიანის IV მიკრორაიონი"],
      ["თემქის მე11 მ/რ", "თემქა", "თემქა XI მიკრორაიონი"],
      ["ნუცუბიძის მე2 პლატო", "ნუცუბიძე", "ნუცუბიძის II პლატო"],
      ["დიღმის მასივის მე6 კვარტალი", "დიღმის მასივი", "დიღმის მასივი VI კვარტალი"],
    ];

    for (const [address, neighborhood, street] of cases) {
      const normalized = helpers.normalizeAddressDirectoryAddress(address);
      assert.equal(normalized.neighborhood, neighborhood, address);
      assert.equal(normalized.match.street, street, address);
    }
  });

  it("does not coerce unmatched plateau quarters into microdistricts", async () => {
    const helpers = await loadAddressDirectoryHelpers();

    const normalized = helpers.normalizeAddressDirectoryAddress("ვარკეთილის პირველი პლატოს მეორე კვარტალი");

    assert.equal(normalized.address, "ვარკეთილის პირველი პლატოს მეორე კვარტალი");
    assert.equal(normalized.match, null);
  });
});
