import { expect, test } from "@playwright/test";

async function installLeafletMock(page) {
  await page.addInitScript(() => {
    const createLayer = () => ({
      addTo() { return this; },
      bindPopup() { return this; },
      closePopup() { return this; },
      getElement() {
        const element = document.createElement("div");
        element.className = "leaflet-marker-icon";
        return element;
      },
      getPopup() { return null; },
      getRadius() { return 9; },
      on() { return this; },
      openPopup() { return this; },
      remove() { return this; },
      setIcon() { return this; },
      setLatLng() { return this; },
      setPopupContent() { return this; },
      setRadius() { return this; },
      setStyle() { return this; },
      bringToFront() { return this; },
    });
    const createPoint = (x = 0, y = 0) => ({
      x,
      y,
      distanceTo(other = {}) {
        return Math.hypot(x - Number(other.x || 0), y - Number(other.y || 0));
      },
    });
    window.L = {
      control: { zoom: () => ({ addTo: () => ({}) }) },
      circleMarker: () => createLayer(),
      divIcon: (options = {}) => options,
      latLngBounds: (items = []) => ({ isValid: () => items.length > 0 }),
      map: (element) => {
        element.classList.add("leaflet-container");
        return {
          addLayer() { return this; },
          closePopup() { return this; },
          fitBounds() { return this; },
          getZoom() { return 15; },
          invalidateSize() { return this; },
          latLngToLayerPoint(value = {}) {
            return createPoint(Number(value.lng || value[1] || 0) * 1000, Number(value.lat || value[0] || 0) * 1000);
          },
          on() { return this; },
          removeLayer() { return this; },
          setView() { return this; },
        };
      },
      marker: () => createLayer(),
      point: createPoint,
      tileLayer: () => ({ addTo: () => ({}) }),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installLeafletMock(page);
});

test("admin app shell keeps the map and opens the push list", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#map")).toHaveClass(/leaflet-container/);
  await expect(page.locator("#setupModal")).toHaveClass(/active/);

  await page.locator("#setupUsername").fill("admin");
  await page.locator("#setupPassword").fill("pass123");
  await page.locator("#setupForm button[type='submit']").click();

  await expect(page.locator("#setupModal")).not.toHaveClass(/active/);
  await expect(page.locator("#actionPanel")).toBeVisible();
  await expect(page.locator("#actionPanel")).toContainText("ფუშები");

  await page.locator("#actionPanel [data-action='pushInbox']").click();
  await expect(page.locator("#dialogModal")).toHaveClass(/active/);
  await expect(page.locator("#dialogTitle")).toContainText("ფუშები");
  await expect(page.locator("#dialogBody")).toContainText("ფუშები");
  await expect(page.locator("#dialogBody")).not.toContainText("ინბოქსი");
});

test("push deep link serves the same map app shell", async ({ page }) => {
  await page.goto("/push");

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#map")).toHaveClass(/leaflet-container/);
  await expect(page.locator("#authModal, #setupModal").filter({ hasText: /ლოგინი|ადმინის შექმნა/ })).toHaveCount(1);
});
