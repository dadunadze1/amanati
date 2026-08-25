import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

process.env.DELIVERY_FUNCTIONS_TEST_EXPORTS = "1";

const require = createRequire(import.meta.url);
const functions = require("../functions/index.js");
const { parseStickerText } = functions.__test;

describe("sticker OCR parser", () => {
  it("extracts Georgian parcel sticker fields from mixed delivery notes", () => {
    const parsed = parseStickerText(`
      დავით
      577788686
      18:00 საათამდე თუ მოიტანენ მაქ
      ინ ორთაჭალაში გულუას ქ 10
      1 ცალი 12 ვოლტი (31₾ კურიერთან)
    `);

    assert.equal(parsed.fullName, "დავით");
    assert.equal(parsed.phone, "+995577788686");
    assert.equal(parsed.paymentAmount, 31);
    assert.equal(parsed.address, "თბილისი, ორთაჭალა, გულუას ქ. 10");
    assert.deepEqual(parsed.warnings, []);
  });

  it("does not treat house, corpus, or floor numbers as COD without payment keywords", () => {
    const parsed = parseStickerText(`
      მარი მელაშვილი
      577 595 595
      ნუცუბიძის პირველი პლატო,
      კორპ 5 / სართ 1.
      შემოსასვლელი ეზოდან.
      თუ ქუჩებზე მოუნევს - მითითებულ მისამართზე კონები.
      დანიშნეთ დღეებში 12:00-19:00მდე ჯამბაკურ ორბელიანის 24.
    `);

    assert.equal(parsed.fullName, "მარი მელაშვილი");
    assert.equal(parsed.phone, "+995577595595");
    assert.equal(parsed.paymentAmount, 0);
    assert.equal(parsed.address, "თბილისი, ნუცუბიძის პირველი პლატო 5");
  });

  it("combines short Georgian sticker address lines", () => {
    const parsed = parseStickerText(`
      თამარ ტაბატაძე
      593799966
      დიდი დიღომი, არჩილ მეფის
      10, ფარნავაზის შენობაა,
      სართული 5
    `);

    assert.equal(parsed.fullName, "თამარ ტაბატაძე");
    assert.equal(parsed.phone, "+995593799966");
    assert.equal(parsed.paymentAmount, 0);
    assert.equal(parsed.address, "თბილისი, დიდი დიღომი, არჩილ მეფის 10");
  });

  it("keeps numbered apartment style addresses separate from payment amounts", () => {
    const parsed = parseStickerText(`
      სოდა ზურიკო
      +995
      ლაშა ოთიძე
      593338770
      ლერმონტოვის #9
    `);

    assert.equal(parsed.fullName, "ლაშა ოთიძე");
    assert.equal(parsed.phone, "+995593338770");
    assert.equal(parsed.paymentAmount, 0);
    assert.equal(parsed.address, "თბილისი, ლერმონტოვის 9");
  });

  it("keeps full street words intact on simple white-background labels", () => {
    const parsed = parseStickerText(`
      ტყიბულის ქუჩა
      110 ლარი
      ნომერი 599489320
      სახელი. სადნრო დადუნაძე
    `);

    assert.equal(parsed.fullName, "სადნრო დადუნაძე");
    assert.equal(parsed.phone, "+995599489320");
    assert.equal(parsed.paymentAmount, 110);
    assert.equal(parsed.address, "თბილისი, ტყიბულის ქუჩა");
  });

  it("extracts numbered quarter addresses from plain labels", () => {
    const parsed = parseStickerText(`
      ვაჟა ფშაველას მე6 კვარტალი
      110 ლარი
      ნომერი 599489320
      სახელი. სადნრო დადუნაძე
    `);

    assert.equal(parsed.fullName, "სადნრო დადუნაძე");
    assert.equal(parsed.phone, "+995599489320");
    assert.equal(parsed.paymentAmount, 110);
    assert.equal(parsed.address, "თბილისი, ვაჟა ფშაველას 6 კვარტალი");
  });
});
