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
});
