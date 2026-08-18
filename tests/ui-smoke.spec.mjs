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

async function ensureAdminSession(page) {
  if (await page.locator("#setupModal.active").isVisible()) {
    await page.locator("#setupUsername").fill("admin");
    await page.locator("#setupPassword").fill("pass123");
    await page.locator("#setupForm button[type='submit']").click();
    await expect(page.locator("#setupModal")).not.toHaveClass(/active/);
    return;
  }

  if (await page.locator("#authModal.active").isVisible()) {
    await page.locator("#loginUsername").fill("admin");
    await page.locator("#loginPassword").fill("pass123");
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#authModal")).not.toHaveClass(/active/);
  }
}

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

test("admin tariff settings expose volume and express prices", async ({ page }) => {
  await page.goto("/");

  await ensureAdminSession(page);
  await page.evaluate(() => window.openTariffSettingsDialog());

  await expect(page.locator("#dialogModal")).toHaveClass(/active/);
  await expect(page.locator("#dialogTitle")).toContainText("ტარიფები");
  await expect(page.locator("#dialogBody")).toContainText("5 კგ-მდე");
  await expect(page.locator("#dialogBody")).toContainText("5-10 კგ");
  await expect(page.locator("#dialogBody")).toContainText("10-15 კგ");
  await expect(page.locator("#dialogBody")).toContainText("ექსპრეს დელივერი");
});

test("finance dashboard lists partner service balances", async ({ page }) => {
  await page.goto("/");
  await ensureAdminSession(page);

  const batchId = Date.now();
  const result = await page.evaluate(async ({ batchId }) => {
    const adminToken = state.authToken;
    const apiRequest = async (path, options = {}) => {
      const response = await fetch(path, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.token || adminToken}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (!response.ok) throw new Error(`${options.method || "GET"} ${path} ${response.status}`);
      return response.json();
    };

    const courierUsername = `finance-courier-${batchId}`;
    await apiRequest("/api/users", {
      method: "POST",
      body: {
        username: courierUsername,
        password: "pass123",
        role: "courier",
        firstName: "Finance",
        lastName: "Courier",
        phone: "555330001",
      },
    });
    const courierLogin = await apiRequest("/api/login", {
      method: "POST",
      token: "",
      body: { username: courierUsername, password: "pass123" },
    });

    const createPartner = (suffix) => apiRequest("/api/partners", {
      method: "POST",
      body: {
        username: `finance-partner-${suffix}-${batchId}@test.local`,
        password: "pass123",
        companyName: `Finance Partner ${suffix}`,
        contactPerson: `Contact ${suffix}`,
        phone: suffix === "cod" ? "555330002" : "555330003",
      },
    });
    const partnerCod = await createPartner("cod");
    const partnerNoCod = await createPartner("nocod");
    const partnerUnused = await createPartner("unused");

    const createParcel = (partner, paymentAmount, fullName) => apiRequest("/api/parcels", {
      method: "POST",
      body: {
        courierUsername,
        partnerId: partner.partner.id,
        city: "Tbilisi",
        address: `${fullName} Street 12`,
        fullAddress: `Tbilisi, ${fullName} Street 12`,
        fullName,
        phone: "555123456",
        paymentAmount,
        lat: 41.7151,
        lng: 44.8271,
        tariffId: "volume_5_10",
      },
    });
    const codParcel = await createParcel(partnerCod, 100, "COD Recipient");
    const noCodParcel = await createParcel(partnerNoCod, 0, "No COD Recipient");

    const deliver = (parcel) => apiRequest(`/api/parcels/${parcel.parcel.id}/status`, {
      method: "PATCH",
      token: courierLogin.token,
      body: { status: "delivered", expectedUpdatedAt: parcel.parcel.updatedAt },
    });
    await deliver(codParcel);
    await deliver(noCodParcel);

    await window.openFinanceDashboard();
    return {
      partnerCodName: partnerCod.partner.companyName,
      partnerNoCodName: partnerNoCod.partner.companyName,
      partnerNoCodUsername: partnerNoCod.partner.username,
      partnerUnusedName: partnerUnused.partner.companyName,
    };
  }, { batchId });

  await expect(page.locator("#dialogModal")).toHaveClass(/active/);
  await expect(page.locator("[data-daily-balance-export]")).toBeVisible();
  await page.locator(".finance-admin-tabs [data-finance-dashboard-tab='partners']").click();

  await expect(page.locator("#dialogBody")).toContainText(result.partnerCodName);
  await expect(page.locator("#dialogBody")).toContainText(result.partnerNoCodName);
  await expect(page.locator("#dialogBody")).not.toContainText(result.partnerUnusedName);
  await expect(page.locator("#dialogBody")).toContainText("90.00");
  await expect(page.locator("#dialogBody")).toContainText("10.00");

  const resetSummary = await page.evaluate(async ({ username }) => {
    await window.resetPartnerCashAdjustment(username);
    await window.loadPartnerCashAdjustments();
    const partners = await window.getPartners();
    const records = await window.getAllPartnerCashRecords();
    const partner = partners.find((item) => item.username === username);
    return window.calculatePartnerCashForRange(partner, records, window.getPartnerCashManagementRange());
  }, { username: result.partnerNoCodUsername });

  expect(resetSummary.serviceFees).toBe(10);
  expect(resetSummary.outstandingServiceFees).toBe(0);
  expect(resetSummary.netBalance).toBe(0);
  expect(resetSummary.partnerPaymentDue).toBe(0);
});

test("admin partner management uses a tall scrollable list", async ({ page }) => {
  await page.goto("/");
  await ensureAdminSession(page);

  const batchId = Date.now();
  await page.evaluate(async ({ batchId }) => {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${state.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: `partner-ui-${batchId}-${index}@test.local`,
          password: "pass123",
          companyName: `Partner UI ${index + 1}`,
          contactPerson: `Contact ${index + 1}`,
          phone: `55520${String(index).padStart(4, "0")}`,
        }),
      });
      if (!response.ok) throw new Error(`partner-create-${index}`);
    }
  }, { batchId });

  await page.evaluate(() => window.openPartnerManagement());

  await expect(page.locator("#dialogModal")).toHaveClass(/active/);
  await expect(page.locator(".partner-management-screen")).toBeVisible();
  await expect.poll(async () => page.locator(".partner-management-table tbody tr").count()).toBeGreaterThanOrEqual(10);

  const metrics = await page.locator(".partner-management-list").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.clientHeight).toBeGreaterThan(300);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
});

test("push deep link serves the same map app shell", async ({ page }) => {
  await page.goto("/push");

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#map")).toHaveClass(/leaflet-container/);
  await expect(page.locator("#authModal, #setupModal").filter({ hasText: /ლოგინი|ადმინის შექმნა/ })).toHaveCount(1);
});
