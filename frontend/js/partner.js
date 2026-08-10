"use strict";



function partnerName(partner) {
  return partner?.companyName || partner?.contactPerson || partner?.username || "";
}


function orderPartnerName(parcel) {
  return parcel?.partnerName || "პირადი";
}


function partnerCodPending(orders) {
  return orders
    .filter((order) => order.status !== "delivered" && getPaymentAmount(order) > 0)
    .reduce((sum, order) => sum + getPaymentAmount(order), 0);
}


function partnerCodCollected(orders) {
  return orders
    .filter((order) => order.status === "delivered")
    .reduce((sum, order) => sum + getPaymentAmount(order), 0);
}


function readLocalPartnerCashAdjustments() {
  try {
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.partnerCashAdjustmentsStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.partnerCashAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "partnerCash");
  } catch {
    return [];
  }
}


function readPartnerCashAdjustments() {
  if (state.partnerCashAdjustmentsLoaded && Array.isArray(state.partnerCashAdjustments)) {
    return normalizeFinanceAdjustmentList(state.partnerCashAdjustments, "partnerCash");
  }
  return readLocalPartnerCashAdjustments();
}


function writePartnerCashAdjustments(adjustments) {
  const normalized = normalizeFinanceAdjustmentList(adjustments, "partnerCash");
  state.partnerCashAdjustments = normalized;
  state.partnerCashAdjustmentsLoaded = true;
  if (typeof saveData === "function") saveData(CONFIG.partnerCashAdjustmentsStorageKey, normalized);
  else localStorage.setItem(CONFIG.partnerCashAdjustmentsStorageKey, JSON.stringify(normalized));
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    saveStaticFinanceData({ ...getStaticFinanceData(), partnerCashAdjustments: normalized });
  }
}


async function loadPartnerCashAdjustments() {
  try {
    const payload = await api("/api/partner-cash-adjustments");
    const adjustments = normalizeFinanceAdjustmentList(payload.adjustments || [], "partnerCash");
    state.partnerCashAdjustments = adjustments;
    state.partnerCashAdjustmentsLoaded = true;
    if (typeof saveData === "function") saveData(CONFIG.partnerCashAdjustmentsStorageKey, adjustments);
    return adjustments;
  } catch {
    const adjustments = readLocalPartnerCashAdjustments();
    state.partnerCashAdjustments = adjustments;
    state.partnerCashAdjustmentsLoaded = true;
    return adjustments;
  }
}


async function savePartnerCashAdjustmentToServer(adjustment) {
  if (typeof isStaticDeploy === "function" && isStaticDeploy()) {
    const next = [...readPartnerCashAdjustments(), adjustment];
    writePartnerCashAdjustments(next);
    return adjustment;
  }
  const payload = await api("/api/partner-cash-adjustments", { method: "POST", body: adjustment });
  const saved = normalizeFinanceAdjustment(payload.adjustment || adjustment, "partnerCash");
  state.partnerCashAdjustmentsLoaded = false;
  const latest = await loadPartnerCashAdjustments().catch(() => null);
  state.partnerCashAdjustments = normalizeFinanceAdjustmentList(latest || [...readPartnerCashAdjustments(), saved], "partnerCash");
  state.partnerCashAdjustmentsLoaded = true;
  return saved;
}


function partnerCashIdentity(partner = {}) {
  return partner.id || partner.username || "";
}


function orderBelongsToPartner(order, partner = {}) {
  const id = partnerCashIdentity(partner);
  return Boolean(
    (id && (order.partnerId === id || normalizeUsername(order.partnerUsername) === normalizeUsername(id)))
    || (partner.username && normalizeUsername(order.partnerUsername) === normalizeUsername(partner.username)),
  );
}


function getPartnerCashAdjustments(partner) {
  const id = partnerCashIdentity(partner);
  const username = partner.username || "";
  return readPartnerCashAdjustments().filter((item) => (
    (id && item.partnerId === id)
    || (username && normalizeUsername(item.partnerId) === normalizeUsername(username))
    || (username && normalizeUsername(item.partnerUsername || item.username) === normalizeUsername(username))
  ));
}


function calculatePartnerCashSummary(partner, records = []) {
  const orders = (Array.isArray(records) ? records : []).filter((order) => orderBelongsToPartner(order, partner));
  const cashOrders = orders.filter((order) => order.status === "delivered" && getPaymentAmount(order) > 0);
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const pendingOrders = orders.filter((order) => order.status !== "delivered" && order.status !== "failed");
  const pendingCashOrders = pendingOrders.filter((order) => getPaymentAmount(order) > 0);
  const totalCash = safeMoney(cashOrders.reduce((sum, order) => sum + getPaymentAmount(order), 0));
  const baseCash = safeMoney(deliveredOrders.reduce((sum, order) => sum + getPaymentAmount(order), 0));
  const pendingCash = safeMoney(pendingCashOrders.reduce((sum, order) => sum + getPaymentAmount(order), 0));
  const adjustmentTotal = safeMoney(getPartnerCashAdjustments(partner).reduce((sum, adjustment) => sum + getAdjustmentSignedAmount(adjustment), 0));
  const correctedTotalCash = Math.max(0, safeMoney(baseCash + adjustmentTotal));
  return {
    orders,
    deliveredOrders,
    pendingOrders,
    cashOrders,
    totalCash,
    correctedTotalCash,
    baseCash,
    pendingCash,
    adjustmentTotal,
    cashDue: Math.max(0, safeMoney(baseCash + adjustmentTotal)),
  };
}


async function getAllPartnerCashRecords() {
  return getPartnerOrderRecords();
}


function getPartnerOrderRetentionCutoffDateKey(referenceDate = new Date()) {
  const cutoff = new Date(referenceDate);
  cutoff.setHours(12, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - Number(CONFIG.partnerOrderRetentionMonths || 1));
  return toDateKey(cutoff);
}


function getPartnerOrderDisplayDateKey(order) {
  return normalizeDateKey(order?.archivedAt || order?.completedAt || order?.deliveredAt || order?.failedAt || order?.updatedAt || order?.createdAt);
}


function isPartnerOrderWithinRetention(order) {
  const dateKey = getPartnerOrderDisplayDateKey(order);
  const cutoffDate = getPartnerOrderRetentionCutoffDateKey();
  return !dateKey || !cutoffDate || dateKey >= cutoffDate;
}


function mergePartnerOrderRecords(...recordSets) {
  const byId = new Map();
  recordSets.flat().filter(Boolean).forEach((order) => {
    const key = order.id || `${order.partnerId || ""}:${order.createdAt || ""}:${order.fullName || ""}:${order.phone || ""}`;
    const current = byId.get(key);
    if (!current || String(order.updatedAt || order.archivedAt || order.createdAt || "") > String(current.updatedAt || current.archivedAt || current.createdAt || "")) {
      byId.set(key, order);
    }
  });
  return [...byId.values()]
    .filter((order) => order.partnerId || order.partnerUsername)
    .filter(isPartnerOrderWithinRetention)
    .sort((a, b) => String(getPartnerOrderDisplayDateKey(b) || "").localeCompare(String(getPartnerOrderDisplayDateKey(a) || "")));
}


async function getPartnerOrderRecords(partner = null) {
  const [pins, history] = await Promise.all([
    getPins(""),
    getHistory(""),
  ]);
  const orders = mergePartnerOrderRecords(pins, history);
  return partner ? orders.filter((order) => orderBelongsToPartner(order, partner)) : orders;
}


function getPartnerCashManagementRange() {
  const today = toDateKey(new Date());
  return normalizeDateRange(state.partnerCashRangeStart || today, state.partnerCashRangeEnd || state.partnerCashRangeStart || today);
}


function setPartnerCashManagementRange(start, end) {
  const range = normalizeDateRange(start, end);
  state.partnerCashRangeStart = range.start;
  state.partnerCashRangeEnd = range.end;
  return range;
}


function calculatePartnerCashForRange(partner, records, range = getPartnerCashManagementRange()) {
  if (typeof calculatePartnerCashSummaryForRange === "function") {
    return calculatePartnerCashSummaryForRange(partner, records, range.start, range.end);
  }
  return calculatePartnerCashSummary(partner, records);
}


async function renderPartnerDashboard(pins = state.activePins) {
  if (!els.partnerDashboard) return;
  if (!state.isPartner || !state.currentUser) {
    els.partnerDashboard.hidden = true;
    els.partnerDashboard.textContent = "";
    els.appShell?.classList.remove("is-partner-dashboard");
    return;
  }

  await loadPartnerCashAdjustments();
  const partner = state.currentUserProfile || { username: state.currentUser };
  const orders = await getPartnerOrderRecords(partner);
  const cash = calculatePartnerCashSummary(partner, orders);
  els.appShell?.classList.add("is-partner-dashboard");
  els.partnerDashboard.hidden = false;

  const activeOrders = orders.filter((order) => order.status !== "delivered" && order.status !== "failed" && !order.archivedAt);
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const failedOrders = orders.filter((order) => order.status === "failed");
  const recentOrders = [...orders]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 8);

  els.partnerDashboard.innerHTML = `
    <div class="partner-dashboard-head">
      <div>
        <span>პარტნიორი</span>
        <strong>${escapeHtml(partnerName(partner) || state.currentUser)}</strong>
      </div>
      <button class="button primary" type="button" data-action="partnerNewOrder">ახალი შეკვეთა</button>
    </div>
    <div class="partner-stat-grid">
      ${renderPartnerStat("სულ შეკვეთები", orders.length)}
      ${renderPartnerStat("აქტიური შეკვეთები", activeOrders.length)}
      ${renderPartnerStat("ჩაბარებული", deliveredOrders.length)}
      ${renderPartnerStat("ვერ ჩაბარდა", failedOrders.length)}
      ${renderPartnerStat("ჩასაბარებელი ქეში", formatMoney(cash.cashDue))}
      ${renderPartnerStat("მოლოდინში ქეში", formatMoney(cash.pendingCash))}
    </div>
    <section class="partner-panel">
      <div class="partner-panel-head">
        <h2>ბოლო შეკვეთები</h2>
        <button class="button secondary" type="button" data-action="partnerOrders">ყველა</button>
      </div>
      ${renderPartnerOrderTable(recentOrders, { includeActions: true })}
    </section>
  `;
}


function renderPartnerStat(label, value) {
  return `
    <article class="partner-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}


function formatPartnerOrderCash(order, options = {}) {
  if (options.showPendingCash || order?.status === "delivered") return formatMoney(getPaymentAmount(order));
  return "-";
}


function canAssignPartnerOrder(order) {
  return Boolean(order && !order.archivedAt && order.status !== "delivered" && order.status !== "failed");
}


function renderPartnerOrderActionCell(order, options = {}) {
  const actions = [];
  if (options.allowAssign && canAssignPartnerOrder(order)) {
    actions.push(`<button class="mini-button" type="button" data-action="assignPartnerOrder" data-value="${escapeAttr(order.id)}">${hasOrderLocation(order) ? "კურიერი" : "პინის დასმა"}</button>`);
  }
  if (canDeleteParcelRecord(order)) {
    actions.push(`<button class="mini-button danger" type="button" data-action="confirmParcelDelete" data-value="${escapeAttr(order.id)}">წაშლა</button>`);
  }
  return actions.length ? `<td><div class="row-actions">${actions.join("")}</div></td>` : "<td></td>";
}


function renderPartnerOrderTable(orders, options = {}) {
  if (!orders.length) return `<div class="history-empty history-empty-card">შეკვეთა ჯერ არ არის</div>`;
  const includePartner = Boolean(options.includePartner);
  const includeActions = Boolean(options.includeActions);
  return `
    <div class="partner-table-wrap">
      <table class="partner-order-table">
        <thead>
          <tr>
            <th>შეკვეთის ID</th>
            ${includePartner ? "<th>პარტნიორი</th>" : ""}
            <th>მომხმარებელი</th>
            <th>მისამართი</th>
            <th>კურიერი</th>
            <th>სტატუსი</th>
            ${includePartner ? "<th>ლოკაცია</th>" : ""}
            <th>ქეში</th>
            <th>თარიღი</th>
            ${includeActions ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${orders.map((order) => `
            <tr>
              <td>${escapeHtml(String(order.id || "").slice(0, 8))}</td>
              ${includePartner ? `<td><span class="partner-tag">${escapeHtml(orderPartnerName(order))}</span></td>` : ""}
              <td>${escapeHtml(order.fullName || "")}</td>
              <td>${escapeHtml(order.address || order.fullAddress || "")}</td>
              <td>${escapeHtml(parcelCourierDisplayName(order))}</td>
              <td><span class="history-status status-${escapeAttr(order.status || "pending")}">${escapeHtml(getPartnerOrderStatusLabel(order))}</span></td>
              ${includePartner ? `<td><span class="partner-tag location-${escapeAttr(order.locationAccuracy || "missing")}">${escapeHtml(getOrderLocationLabel(order))}</span></td>` : ""}
              <td>${escapeHtml(formatPartnerOrderCash(order, options))}</td>
              <td>${escapeHtml(formatOptionalDateTime(order.createdAt))}</td>
              ${includeActions ? renderPartnerOrderActionCell(order, options) : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}


function hasOrderLocation(order) {
  return Number.isFinite(Number(order?.lat)) && Number.isFinite(Number(order?.lng));
}


function getOrderLocationLabel(order) {
  if (!hasOrderLocation(order) || order.locationAccuracy === "missing") return "საჭიროა ლოკაციის გასწორება";
  if (order.locationAccuracy === "confirmed") return "დადასტურებული";
  return "მიახლოებითი";
}


async function openPartnerOrdersDialog() {
  const partner = state.currentUserProfile || { username: state.currentUser };
  const orders = await getPartnerOrderRecords(partner);
  showDialog("ჩემი შეკვეთები", renderPartnerOrderTable(orders, { includeActions: true }), [
    { label: "ახალი", variant: "primary", action: openPartnerNewOrderDialog },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function openPartnerNewOrderDialog() {
  const tariffs = await fetchTariffSettings();
  const body = `
    <form id="partnerOrderForm" class="partner-form partner-order-form">
      <section class="partner-order-section">
        ${typeof renderAddressDirectoryFields === "function" ? renderAddressDirectoryFields("partnerOrder") : ""}
      </section>
      <section class="partner-order-section partner-order-details">
        <div class="partner-form-field">
          <label for="partnerOrderName">მომხმარებლის სახელი</label>
          <input id="partnerOrderName" type="text" autocomplete="name" required>
        </div>
        <div class="partner-form-field">
          <label for="partnerOrderPhone">მომხმარებლის ნომერი</label>
          <input id="partnerOrderPhone" type="tel" autocomplete="tel" required>
        </div>
        <div class="partner-form-field">
          <label for="partnerOrderCash">ქეში</label>
          <input id="partnerOrderCash" type="text" inputmode="decimal" autocomplete="off" value="0">
        </div>
        <div class="partner-form-field partner-form-field--wide">
          ${renderParcelTariffSelect("partnerOrderTariff", tariffs)}
        </div>
      </section>
      <p class="form-message" id="partnerOrderMessage" role="alert"></p>
    </form>
  `;
  showDialog("ახალი შეკვეთა", body, [
    { label: "გაგზავნა", variant: "primary", action: savePartnerOrder },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  if (typeof bindAddressDirectoryControls === "function") {
    bindAddressDirectoryControls("partnerOrder");
  }
}


async function savePartnerOrder() {
  const message = document.getElementById("partnerOrderMessage");
  if (typeof ensureAddressDirectoryLoaded === "function") await ensureAddressDirectoryLoaded();
  const addressParts = typeof getAddressDirectoryValue === "function" ? getAddressDirectoryValue("partnerOrder") : {};
  const city = addressParts.city || document.getElementById("partnerOrderCity")?.value.trim();
  const district = addressParts.district || document.getElementById("partnerOrderDistrict")?.value.trim() || "";
  const street = addressParts.streetAddress || document.getElementById("partnerOrderAddress")?.value.trim();
  const fullName = document.getElementById("partnerOrderName")?.value.trim();
  const phone = document.getElementById("partnerOrderPhone")?.value.trim();
  const paymentAmount = parsePaymentAmount(document.getElementById("partnerOrderCash")?.value);
  const selectedTariffId = document.getElementById("partnerOrderTariff")?.value || "";
  if (!city || !street || !fullName || !phone) {
    if (message) message.textContent = STRINGS.emptyFields;
    return;
  }
  if (!Number.isFinite(paymentAmount) || paymentAmount < 0) {
    if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
    return;
  }

  const rawAddress = addressParts.fullAddress || [city, district, street].filter(Boolean).join(", ");
  const normalizedAddress = typeof normalizeAddressDirectoryAddress === "function"
    ? normalizeAddressDirectoryAddress(rawAddress, { city })
    : { address: rawAddress, corrected: false };
  const address = normalizedAddress.address || rawAddress;
  const finalDistrict = normalizedAddress.match?.district || district;
  const detectedTariffId = typeof getAddressDirectoryTariffIdFromAddress === "function"
    ? getAddressDirectoryTariffIdFromAddress(address || rawAddress)
    : "";
  const tariffId = selectedTariffId || detectedTariffId || addressParts.tariffId || "";

  try {
    const payload = await api("/api/parcels", {
      method: "POST",
      body: { city, district: finalDistrict, streetAddress: street, address, fullAddress: address, fullName, phone, paymentAmount, tariffId },
    });
    if (typeof publishParcelCreatedNotification === "function") {
      await publishParcelCreatedNotification(payload?.parcel).catch((error) => {
        console.warn("Partner parcel push notification failed", error);
      });
    }
    closeDialog();
    await refreshPins();
    const assigned = payload?.parcel?.courierUsername;
    showToast(assigned ? "შეკვეთა დაემატა და კურიერს მიება." : (payload?.assignmentMessage || "შეკვეთა დაემატა."));
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}


async function openPartnerManagement() {
  const partners = await getPartners();
  const range = getPartnerCashManagementRange();
  const [records] = await Promise.all([
    getAllPartnerCashRecords(),
    loadPartnerCashAdjustments(),
  ]);
  state.partnerCashRecords = records;
  const body = `
    <section class="partner-management-screen">
      <div class="partner-management-toolbar">
        <div class="partner-management-title">
          <strong>პარტნიორების სია</strong>
          <span>${escapeHtml(`სულ: ${partners.length} / პერიოდი: ${formatDateRangeLabel(range.start, range.end)}`)}</span>
        </div>
        <div class="partner-filter-row partner-management-filters">
          <label class="partner-cash-date-field" for="partnerCashDateFrom">
            <span>დან</span>
            <input id="partnerCashDateFrom" type="date" value="${escapeAttr(range.start)}">
          </label>
          <label class="partner-cash-date-field" for="partnerCashDateTo">
            <span>მდე</span>
            <input id="partnerCashDateTo" type="date" value="${escapeAttr(range.end)}">
          </label>
          <button class="button secondary" id="partnerCashRangeApply" type="button">ფილტრი</button>
          <button class="button secondary" type="button" data-action="adminPartnerOrders">შეკვეთები</button>
          <button class="button primary" type="button" data-action="createPartner">დამატება</button>
        </div>
      </div>
      ${renderPartnerTable(partners, range)}
    </section>
  `;
  showDialog("პარტნიორები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  document.getElementById("partnerCashRangeApply")?.addEventListener("click", async () => {
    setPartnerCashManagementRange(
      document.getElementById("partnerCashDateFrom")?.value,
      document.getElementById("partnerCashDateTo")?.value,
    );
    await openPartnerManagement();
  });
}


function renderPartnerTable(partners, range = getPartnerCashManagementRange()) {
  const headers = ["პარტნიორი", "ქეში", "მოლოდინი", "კორექტირება", "კონტაქტი", "სტატუსი", ""];
  const rows = partners.map((partner) => renderPartnerCard(partner, range)).filter(Boolean);
  return `
    <div class="partner-table-wrap partner-management-list">
      <table class="partner-order-table partner-management-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">პარტნიორი ჯერ არ არის</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}


function renderPartnerCard(partner, range = getPartnerCashManagementRange()) {
  const active = partner.status === "active";
  const cash = calculatePartnerCashForRange(partner, state.partnerCashRecords || [], range);
  return `
    <tr>
      <td data-label="პარტნიორი">${renderAppTableText(partnerName(partner), partner.username)}</td>
      <td data-label="ქეში">${escapeHtml(formatMoney(cash.cashDue))}</td>
      <td data-label="მოლოდინი">${escapeHtml(formatMoney(cash.pendingCash))}</td>
      <td data-label="კორექტირება">${renderAppTableText(formatAdjustmentDisplay(cash.adjustmentTotal), getAdjustmentDirectionLabel(cash.adjustmentTotal))}</td>
      <td data-label="კონტაქტი">${renderAppTableText(partner.contactPerson || "არ არის", partner.phone || "არ არის")}</td>
      <td data-label="სტატუსი">${renderAppStatusBadge(active ? "delivered" : "failed", active ? "აქტიური" : "არააქტიური")}</td>
      <td data-label="მოქმედება">
        <div class="row-actions admin-user-actions">
          <button class="mini-button" type="button" data-action="adjustPartnerCash" data-value="${escapeAttr(partner.username)}">ქეში</button>
          <button class="mini-button" type="button" data-action="editPartner" data-value="${escapeAttr(partner.username)}">რედაქტირება</button>
          <button class="mini-button ${active ? "danger" : ""}" type="button" data-action="togglePartnerStatus" data-value="${escapeAttr(partner.username)}">${active ? "დეაქტივაცია" : "აქტივაცია"}</button>
        </div>
      </td>
    </tr>
  `;
}


async function openPartnerCashAdjustmentDialog(username) {
  if (!state.isAdmin) return;
  const [partners, records] = await Promise.all([
    getPartners(),
    getAllPartnerCashRecords(),
    loadPartnerCashAdjustments(),
  ]);
  const partner = partners.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
  if (!partner) return;

  const range = getPartnerCashManagementRange();
  const summary = calculatePartnerCashForRange(partner, records, range);
  const content = `
    <div class="finance-card finance-mini-card finance-section stats-card">
      <strong>${escapeHtml(partnerName(partner))}</strong>
      <span>კომპანიისთვის მისაცემი ქეში: ${escapeHtml(formatMoney(summary.cashDue))}</span>
      <small>ჩაბარებული შეკვეთების ქეში: ${escapeHtml(formatMoney(summary.baseCash))}</small>
      <small>${escapeHtml(getAdjustmentDirectionLabel(summary.adjustmentTotal))}: ${escapeHtml(formatAdjustmentDisplay(summary.adjustmentTotal))}</small>
      <small>მოლოდინში ქეში: ${escapeHtml(formatMoney(summary.pendingCash))}</small>
      <small>აირჩიეთ მიმატება ან ჩამოკლება. ჩამოკლება ნაშთს 0-ს ქვემოთ არ უშვებს.</small>
    </div>
    ${renderAdjustmentModeSelect("partnerCashAdjustmentMode")}
    <label for="partnerCashAdjustmentAmount">თანხა</label>
    <input class="finance-input" id="partnerCashAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="">
    <p class="form-message" id="partnerCashAdjustmentMessage" role="alert"></p>
  `;
  showDialog("პარტნიორის ქეშის კორექტირება", content, [
    { label: "შენახვა", variant: "primary", action: () => savePartnerCashAdjustment(username) },
    { label: "განულება", variant: "danger", action: () => resetPartnerCashAdjustment(username) },
    { label: "უკან", variant: "secondary", action: openPartnerManagement },
  ]);
}


async function savePartnerCashAdjustment(username) {
  const message = document.getElementById("partnerCashAdjustmentMessage");
  const value = parsePaymentAmount(document.getElementById("partnerCashAdjustmentAmount")?.value);
  if (!Number.isFinite(value) || value < 0) {
    if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
    return;
  }
  document.querySelectorAll("#dialogActions button").forEach((button) => {
    button.disabled = true;
  });
  try {
    const mode = document.getElementById("partnerCashAdjustmentMode")?.value === "add" ? "add" : "subtract";
    await addPartnerCashAdjustment(username, value, mode);
    await loadPartnerCashAdjustments();
    await openPartnerManagement();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  } finally {
    document.querySelectorAll("#dialogActions button").forEach((button) => {
      button.disabled = false;
    });
  }
}


async function resetPartnerCashAdjustment(username) {
  const message = document.getElementById("partnerCashAdjustmentMessage");
  document.querySelectorAll("#dialogActions button").forEach((button) => {
    button.disabled = true;
  });
  try {
    await zeroPartnerCashAdjustment(username);
    await loadPartnerCashAdjustments();
    await openPartnerManagement();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  } finally {
    document.querySelectorAll("#dialogActions button").forEach((button) => {
      button.disabled = false;
    });
  }
}


async function addPartnerCashAdjustment(username, amount, mode = "subtract") {
  const [partners, records] = await Promise.all([
    getPartners(),
    getAllPartnerCashRecords(),
    loadPartnerCashAdjustments(),
  ]);
  const partner = partners.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
  if (!partner) return;

  const range = getPartnerCashManagementRange();
  const summary = calculatePartnerCashForRange(partner, records, range);
  const rawCashDue = safeMoney(summary.baseCash + summary.adjustmentTotal);
  const { correctionAmount, mode: appliedMode, nextAmount, nextDelta } = calculateAdjustmentDelta(summary.cashDue, amount, mode, rawCashDue);
  if (Math.abs(nextDelta) < 0.005) return;

  const now = new Date().toISOString();
  const adjustment = {
    id: createFinanceEntryId("partner-cash"),
    username: partner.username,
    partnerUsername: partner.username,
    partnerId: partnerCashIdentity(partner),
    amount: nextDelta,
    delta: nextDelta,
    targetAmount: nextAmount,
    correctionAmount,
    correctionMode: appliedMode,
    type: nextDelta < 0 ? "negative" : "positive",
    category: "partnerCash",
    dateKey: range.start,
    date: range.start,
    startDate: range.start,
    endDate: range.end,
    note: "პარტნიორის ქეშის კორექტირება",
    timestamp: now,
    createdAt: now,
  };
  await savePartnerCashAdjustmentToServer(adjustment);
}


async function zeroPartnerCashAdjustment(username) {
  const [partners, records] = await Promise.all([
    getPartners(),
    getAllPartnerCashRecords(),
    loadPartnerCashAdjustments(),
  ]);
  const partner = partners.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
  if (!partner) return;
  const range = getPartnerCashManagementRange();
  const summary = calculatePartnerCashForRange(partner, records, range);
  await addPartnerCashAdjustment(username, summary.cashDue);
}


function openPartnerCreateDialog() {
  openPartnerEditDialog("");
}


async function openPartnerEditDialog(username) {
  const partner = username ? (await getPartners()).find((item) => item.username === username) : {};
  if (username && !partner) return;
  const body = renderPartnerForm(partner);
  showDialog(username ? "პარტნიორის რედაქტირება" : "ახალი პარტნიორი", body, [
    { label: "შენახვა", variant: "primary", action: () => savePartner(username) },
    { label: "უკან", variant: "secondary", action: openPartnerManagement },
  ]);
}


function renderPartnerForm(partner = {}) {
  return `
    <label for="partnerCompanyName">კომპანიის/ბიზნესის სახელი</label>
    <input id="partnerCompanyName" type="text" value="${escapeAttr(partner.companyName || "")}">
    <label for="partnerContactPerson">საკონტაქტო პირი</label>
    <input id="partnerContactPerson" type="text" value="${escapeAttr(partner.contactPerson || "")}">
    <label for="partnerPhone">ტელეფონის ნომერი</label>
    <input id="partnerPhone" type="tel" value="${escapeAttr(partner.phone || "")}">
    <label for="partnerUsername">ელ-ფოსტა / ლოგინი</label>
    <input id="partnerUsername" type="email" autocomplete="username" value="${escapeAttr(partner.username || "")}" ${partner.username ? "disabled" : ""}>
    <label for="partnerPassword">პაროლი</label>
    <input id="partnerPassword" type="password" autocomplete="new-password" placeholder="${partner.username ? "ცარიელი დატოვე თუ არ იცვლება" : ""}">
    <label for="partnerStatus">სტატუსი</label>
    <select id="partnerStatus">
      <option value="active" ${partner.status !== "inactive" ? "selected" : ""}>აქტიური</option>
      <option value="inactive" ${partner.status === "inactive" ? "selected" : ""}>არააქტიური</option>
    </select>
    <p class="form-message" id="partnerFormMessage" role="alert"></p>
  `;
}


async function savePartner(username) {
  const message = document.getElementById("partnerFormMessage");
  const body = {
    companyName: document.getElementById("partnerCompanyName")?.value.trim(),
    contactPerson: document.getElementById("partnerContactPerson")?.value.trim(),
    phone: document.getElementById("partnerPhone")?.value.trim(),
    username: document.getElementById("partnerUsername")?.value.trim(),
    password: document.getElementById("partnerPassword")?.value.trim(),
    status: document.getElementById("partnerStatus")?.value || "active",
  };
  if (!body.companyName || !body.contactPerson || !body.phone || (!username && (!body.username || !body.password))) {
    if (message) message.textContent = STRINGS.emptyFields;
    return;
  }
  try {
    if (username) {
      await api(`/api/partners/${encodeURIComponent(username)}`, { method: "PUT", body });
    } else {
      await api("/api/partners", { method: "POST", body });
    }
    await openPartnerManagement();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}


async function togglePartnerStatus(username) {
  const partner = (await getPartners()).find((item) => item.username === username);
  if (!partner) return;
  await api(`/api/partners/${encodeURIComponent(username)}`, {
    method: "PUT",
    body: { ...partner, status: partner.status === "active" ? "inactive" : "active" },
  });
  await openPartnerManagement();
}


async function openAdminPartnerOrders(partnerId = "") {
  const partners = await getPartners();
  const orders = (await getPartnerOrderRecords()).filter((order) => !partnerId || order.partnerId === partnerId);
  const partnerOptions = partners.map((partner) => `<option value="${escapeAttr(partner.id)}" ${partner.id === partnerId ? "selected" : ""}>${escapeHtml(partnerName(partner))}</option>`).join("");
  const body = `
    <div class="partner-panel-head">
      <h2>პარტნიორის შეკვეთები</h2>
      <div class="partner-filter-row">
        <select id="adminPartnerOrdersFilter">
          <option value="">ყველა პარტნიორი</option>
          ${partnerOptions}
        </select>
        <button class="button secondary" type="button" data-action="adminPartnerOrdersFilter">ფილტრი</button>
      </div>
    </div>
    ${renderPartnerOrderTable(orders, { includePartner: true, includeActions: true, allowAssign: true, showPendingCash: true })}
  `;
  showDialog("პარტნიორის შეკვეთები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openPartnerOrderAssignDialog(parcelId) {
  const orders = state.activePins.length ? state.activePins : (await api("/api/parcels")).parcels;
  const order = orders.find((item) => item.id === parcelId);
  if (order && !hasOrderLocation(order)) {
    showDialog("ლოკაცია აუცილებელია", `<p>ლოკაცია ვერ მოიძებნა. კურიერის მიბმამდე პინი ხელით დასვით.</p><p>${escapeHtml(order.fullAddress || order.address || "")}</p>`, [
      { label: "პინის დასმა", variant: "primary", action: () => { closeDialog(); showSelectedParcelCard(parcelId, { focus: true }); startParcelLocationEdit(parcelId); } },
      { label: "უკან", variant: "secondary", action: openAdminPartnerOrders },
    ]);
    return;
  }
  const couriers = await getCouriers();
  const courierOptions = couriers.map((courier) => `<option value="${escapeAttr(courier.username)}">${escapeHtml(userDisplayName(courier))}</option>`).join("");
  const body = `
    <label for="partnerOrderCourier">კურიერი</label>
    <select id="partnerOrderCourier">${courierOptions}</select>
    <p id="partnerOrderAssignMessage" class="form-message" role="alert"></p>
  `;
  showDialog("კურიერის მიბმა", body, [
    { label: "მიბმა", variant: "primary", action: () => savePartnerOrderAssign(parcelId) },
    { label: "უკან", variant: "secondary", action: openAdminPartnerOrders },
  ]);
}


async function savePartnerOrderAssign(parcelId) {
  const courierUsername = document.getElementById("partnerOrderCourier")?.value;
  const message = document.getElementById("partnerOrderAssignMessage");
  if (!courierUsername) {
    if (message) message.textContent = "აირჩიეთ კურიერი.";
    return;
  }
  try {
    const orders = state.activePins.length ? state.activePins : (await api("/api/parcels")).parcels;
    const order = orders.find((item) => item.id === parcelId);
    await api("/api/parcels/assign", {
      method: "PATCH",
      body: { parcelIds: [parcelId], courierUsername, expectedUpdatedAtById: { [parcelId]: order?.updatedAt || "" } },
    });
    if (typeof publishParcelAssignedNotification === "function") {
      await publishParcelAssignedNotification({ ...order, courierUsername }, courierUsername).catch((error) => {
        console.warn("Courier assignment push notification failed", error);
      });
    }
    showToast("კურიერი მიება შეკვეთას.");
    await openAdminPartnerOrders();
    await refreshPins();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}
