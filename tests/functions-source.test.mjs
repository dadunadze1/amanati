import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("Firebase functions source guards", () => {
  it("keeps push notifications retryable when no devices are registered", async () => {
    const source = await readFile("functions/index.js", "utf8");

    assert.match(source, /class NoPushDevicesError extends Error/);
    assert.match(source, /throw new NoPushDevicesError\(notification\)/);
    assert.match(source, /isNoPushDevicesError\(error\)/);
    assert.match(source, /deliveryStatus: finalFailure \? "failed" : "pending"/);
    assert.doesNotMatch(source, /return \{[^}]*noDevices: true[^}]*\}/s);
  });

  it("retries direct admin notification collection documents on the scheduler", async () => {
    const source = await readFile("functions/index.js", "utf8");

    assert.match(source, /await processAdminNotificationCollection\(\)/);
    assert.match(source, /async function processAdminNotificationCollection\(\)/);
    assert.match(source, /shouldProcessCollectionNotification\(doc\.id, raw\)/);
  });
});
