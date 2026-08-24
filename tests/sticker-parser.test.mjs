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
});
