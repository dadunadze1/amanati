import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("address directory data", () => {
  it("includes merged Georgian Tbilisi street data", async () => {
    const data = JSON.parse(await readFile("frontend/data/address-directory.json", "utf8"));
    const tbilisi = data.find((city) => city.city === "თბილისი");
    assert.ok(tbilisi);

    const streetsByDistrict = new Map((tbilisi.districts || []).map((district) => [district.name, district.streets || []]));
    const total = [...streetsByDistrict.values()].reduce((sum, streets) => sum + streets.length, 0);

    assert.ok(total >= 4159);
    assert.ok(streetsByDistrict.get("გლდანი")?.includes("9 აპრილის ქუჩა"));
    assert.ok(streetsByDistrict.get("ისანი")?.includes("ალექსანდრე როინაშვილის ქუჩა"));
    assert.ok(streetsByDistrict.get("დიდუბე")?.includes("გიორგი ბალანჩინის ქუჩა"));
    assert.ok(streetsByDistrict.get("კრწანისი")?.includes("გია გულუას ქ."));
  });
});
