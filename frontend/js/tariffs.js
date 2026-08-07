"use strict";

const TARIFF_FIELDS = [
  { id: "city", title: "თბილისი", description: "ცენტრის და თბილისის ზონების შეკვეთები" },
  { id: "suburbs", title: "შემოგარენი", description: "თბილისის გარეთ ან ზონის გარეშე შეკვეთები" },
];

async function fetchTariffSettings() {
  try {
    const payload = await api("/api/tariffs");
    return normalizeTariffSettings(payload?.tariffs);
  } catch (error) {
    console.warn("Tariff settings unavailable", error);
    return normalizeTariffSettings();
  }
}


function normalizeTariffSettings(tariffs = {}) {
  const defaults = getDefaultTariffSettings();
  return {
    city: normalizeTariffRow(tariffs.city, defaults.city),
    suburbs: normalizeTariffRow(tariffs.suburbs, defaults.suburbs),
  };
}


function normalizeTariffRow(row = {}, fallback) {
  row = row && typeof row === "object" ? row : {};
  const partnerPrice = safeMoney(row.partnerPrice ?? row.deliveryTotalPrice ?? fallback.partnerPrice);
  const courierPay = safeMoney(row.courierPay ?? row.courierDeliveryPay ?? fallback.courierPay);
  return {
    id: fallback.id,
    label: fallback.label,
    partnerPrice,
    courierPay,
    companyProfit: safeMoney(Math.max(0, partnerPrice - courierPay)),
  };
}


async function openTariffSettingsDialog() {
  const tariffs = await fetchTariffSettings();
  const body = `
    <form id="tariffSettingsForm" class="tariff-settings-panel">
      ${TARIFF_FIELDS.map((field) => renderTariffSection(field, tariffs[field.id])).join("")}
      <p id="tariffSettingsMessage" class="form-message" role="alert"></p>
    </form>
  `;

  showDialog("ტარიფები", body, [
    { label: "შენახვა", variant: "primary", action: saveTariffSettings },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);

  document.getElementById("tariffSettingsForm")?.addEventListener("input", updateTariffProfitPreview);
  document.getElementById("tariffSettingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTariffSettings();
  });
  updateTariffProfitPreview();
}


function renderTariffSection(field, tariff) {
  return `
    <section class="tariff-settings-section" data-tariff-section="${escapeAttr(field.id)}">
      <div class="tariff-settings-head">
        <strong>${escapeHtml(field.title)}</strong>
        <span>${escapeHtml(field.description)}</span>
      </div>
      <div class="tariff-settings-grid">
        <label for="tariff-${escapeAttr(field.id)}-partner">
          პარტნიორის ფასი
          <input id="tariff-${escapeAttr(field.id)}-partner" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(formatTariffInput(tariff.partnerPrice))}" data-tariff-id="${escapeAttr(field.id)}" data-tariff-field="partnerPrice">
        </label>
        <label for="tariff-${escapeAttr(field.id)}-courier">
          კურიერის ანაზღაურება
          <input id="tariff-${escapeAttr(field.id)}-courier" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(formatTariffInput(tariff.courierPay))}" data-tariff-id="${escapeAttr(field.id)}" data-tariff-field="courierPay">
        </label>
      </div>
      <div class="tariff-profit-preview">
        <span>კომპანიის წილი</span>
        <strong id="tariff-${escapeAttr(field.id)}-profit">${escapeHtml(formatMoney(tariff.companyProfit))}</strong>
      </div>
    </section>
  `;
}


function formatTariffInput(value) {
  return safeMoney(value).toFixed(2);
}


function readTariffInput(fieldId, fieldName) {
  const input = document.querySelector(`[data-tariff-id="${fieldId}"][data-tariff-field="${fieldName}"]`);
  return parsePaymentAmount(input?.value);
}


function collectTariffSettingsFromForm() {
  return TARIFF_FIELDS.reduce((settings, field) => {
    const partnerPrice = readTariffInput(field.id, "partnerPrice");
    const courierPay = readTariffInput(field.id, "courierPay");
    if (!Number.isFinite(partnerPrice) || partnerPrice < 0 || !Number.isFinite(courierPay) || courierPay < 0) {
      throw new Error("შეიყვანეთ სწორი ტარიფები.");
    }
    settings[field.id] = {
      id: field.id,
      label: field.title,
      partnerPrice,
      courierPay,
      companyProfit: safeMoney(Math.max(0, partnerPrice - courierPay)),
    };
    return settings;
  }, {});
}


function updateTariffProfitPreview() {
  TARIFF_FIELDS.forEach((field) => {
    const partnerPrice = readTariffInput(field.id, "partnerPrice");
    const courierPay = readTariffInput(field.id, "courierPay");
    const profit = Number.isFinite(partnerPrice) && Number.isFinite(courierPay)
      ? safeMoney(Math.max(0, partnerPrice - courierPay))
      : 0;
    const target = document.getElementById(`tariff-${field.id}-profit`);
    if (target) target.textContent = formatMoney(profit);
  });
}


async function saveTariffSettings() {
  const message = document.getElementById("tariffSettingsMessage");
  try {
    const tariffs = collectTariffSettingsFromForm();
    await api("/api/tariffs", { method: "PUT", body: { tariffs } });
    showToast("ტარიფები შენახულია.");
    closeDialog();
    await refreshPins().catch(() => {});
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}
