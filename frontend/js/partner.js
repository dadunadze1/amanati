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
    <div class="partner-dashboard-actions partner-dashboard-actions--inbox">
      <button class="button secondary" type="button" data-action="partnerInbox">ინბოქსი</button>
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


function openPartnerNewOrderDialog() {
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
  const tariffId = detectedTariffId || addressParts.tariffId || "";

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


function getPartnerInboxSnippet(message = {}) {
  const text = String(message.message || "").replace(/\s+/g, " ").trim();
  if (!text) return "ცარიელი შეტყობინება";
  return text.length > 78 ? `${text.slice(0, 78)}...` : text;
}


function getPartnerInboxTargetLabel(message = {}) {
  if (message.targetType === "all") return "ყველა პარტნიორი";
  return message.partnerName || message.partnerUsername || "პარტნიორი";
}


function isPartnerInboxRead(message = {}) {
  const current = normalizeUsername(state.currentUser);
  return (Array.isArray(message.readBy) ? message.readBy : []).some((username) => normalizeUsername(username) === current);
}


function getPartnerInboxDaysLeft(message = {}) {
  const expiresAt = Date.parse(message.expiresAt || "");
  if (!Number.isFinite(expiresAt)) return "";
  const days = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "დღეს იწმინდება";
  return `${days} დღე`;
}


function renderPartnerInboxCell(label, content, className = "") {
  return `<td ${className ? `class="${escapeAttr(className)}" ` : ""}data-label="${escapeAttr(label)}">${content}</td>`;
}


function renderPartnerInboxList(messages, options = {}) {
  const isAdminList = Boolean(options.admin);
  const items = Array.isArray(messages) ? messages : [];
  const rows = items.map((message) => renderPartnerInboxMailItem(message, { admin: isAdminList }));

  return `
    <div class="partner-mail-list" role="list">
      ${rows.join("") || `<div class="history-empty history-empty-card">შეტყობინება არ არის</div>`}
    </div>
  `;
}


function renderPartnerInboxMailItem(message, options = {}) {
  const isAdminList = Boolean(options.admin);
  const read = isPartnerInboxRead(message);
  const status = isAdminList ? "გაგზავნილი" : read ? "წაკითხული" : "ახალი";
  const target = getPartnerInboxTargetLabel(message);
  return `
    <article class="partner-mail-item ${read || isAdminList ? "" : "is-unread"}" role="listitem">
      <button class="partner-mail-open" type="button" data-action="openPartnerInboxMessage" data-value="${escapeAttr(message.id)}">
        <span class="partner-mail-avatar" aria-hidden="true">${isAdminList ? "↗" : "✉"}</span>
        <span class="partner-mail-main">
          <span class="partner-mail-line">
            <strong>${escapeHtml(isAdminList ? target : "ადმინი")}</strong>
            <time>${escapeHtml(formatOptionalDateTime(message.createdAt))}</time>
          </span>
          <span class="partner-mail-subject">${escapeHtml(getPartnerInboxSnippet(message))}</span>
          <span class="partner-mail-meta">
            <span>${escapeHtml(status)}</span>
            <span>${escapeHtml(getPartnerInboxDaysLeft(message) || "15 დღე")}</span>
            ${isAdminList && message.partnerUsername ? `<span>${escapeHtml(message.partnerUsername)}</span>` : ""}
          </span>
        </span>
      </button>
      ${isAdminList ? `<button class="partner-mail-delete" type="button" data-action="deletePartnerInboxMessage" data-value="${escapeAttr(message.id)}" aria-label="წერილის წაშლა">×</button>` : ""}
    </article>
  `;
}


function renderLegacyPartnerInboxList(messages, options = {}) {
  const isAdminList = Boolean(options.admin);
  const items = Array.isArray(messages) ? messages : [];
  const rows = items.map((message) => {
    const read = isPartnerInboxRead(message);
    const status = isAdminList ? "გაგზავნილი" : read ? "წაკითხული" : "ახალი";
    const cells = [
      isAdminList ? renderPartnerInboxCell("მიმღები", renderAppTableText(getPartnerInboxTargetLabel(message), message.partnerUsername || "")) : "",
      renderPartnerInboxCell("შეტყობინება", `
        <button class="partner-inbox-open" type="button" data-action="openPartnerInboxMessage" data-value="${escapeAttr(message.id)}">
          <strong>${escapeHtml(getPartnerInboxSnippet(message))}</strong>
          <small>${escapeHtml(message.createdBy ? `ადმინი: ${message.createdBy}` : "ადმინის შეტყობინება")}</small>
        </button>
      `, "partner-inbox-message-cell"),
      renderPartnerInboxCell("თარიღი", escapeHtml(formatOptionalDateTime(message.createdAt))),
      renderPartnerInboxCell("ვადა", escapeHtml(getPartnerInboxDaysLeft(message) || "15 დღე")),
      renderPartnerInboxCell("სტატუსი", renderAppStatusBadge(read || isAdminList ? "delivered" : "pending", status)),
      renderPartnerInboxCell("მოქმედება", `
        <div class="row-actions partner-inbox-actions">
          <button class="mini-button" type="button" data-action="openPartnerInboxMessage" data-value="${escapeAttr(message.id)}">გახსნა</button>
          ${isAdminList ? `<button class="mini-button danger" type="button" data-action="deletePartnerInboxMessage" data-value="${escapeAttr(message.id)}">წაშლა</button>` : ""}
        </div>
      `),
    ].filter(Boolean);
    return `<tr class="${read || isAdminList ? "" : "partner-inbox-row-unread"}">${cells.join("")}</tr>`;
  });

  return `
    <div class="partner-inbox-list">
      ${renderAppListPanel({
        title: isAdminList ? "გაგზავნილი შეტყობინებები" : "ჩემი ინბოქსი",
        badges: [`სულ: ${items.length}`],
        headers: isAdminList
          ? ["მიმღები", "შეტყობინება", "თარიღი", "ვადა", "სტატუსი", "მოქმედება"]
          : ["შეტყობინება", "თარიღი", "ვადა", "სტატუსი", "მოქმედება"],
        emptyMessage: "შეტყობინება არ არის",
        rows,
      })}
    </div>
  `;
}


function renderAdminMailTabs(activeView, counts = {}) {
  return `
    <div class="partner-mail-tabs" role="tablist" aria-label="ფოსტის ჩანართები">
      <button class="partner-mail-tab ${activeView === "messages" ? "is-active" : ""}" type="button" data-action="adminPartnerInboxTab" data-value="messages">
        <span>წერილები</span>
        <strong>${escapeHtml(counts.messages || 0)}</strong>
      </button>
      <button class="partner-mail-tab ${activeView === "push" ? "is-active" : ""}" type="button" data-action="adminPartnerInboxTab" data-value="push">
        <span>ფუშები</span>
        <strong>${escapeHtml(counts.push || 0)}</strong>
      </button>
    </div>
  `;
}


function renderPushMailList(notifications) {
  const items = Array.isArray(notifications) ? notifications : [];
  return `
    <div class="partner-mail-list partner-mail-list--push" role="list">
      ${items.map(renderPushMailItem).join("") || `<div class="history-empty history-empty-card">ფუში ჯერ არ არის შენახული.</div>`}
    </div>
  `;
}


function renderPushMailItem(notification) {
  const deliveryStatus = notification.deliveryStatus || "stored";
  const deliveryClass = deliveryStatus === "sent" ? "delivered" : deliveryStatus === "failed" ? "failed" : "pending";
  const typeLabel = getPushInboxTypeLabel(notification.type, notification.status);
  const body = notification.body || [notification.address, notification.fullName].filter(Boolean).join(", ") || "შინაარსი არ არის";
  return `
    <article class="partner-mail-item partner-mail-item--push" role="listitem">
      <div class="partner-mail-open">
        <span class="partner-mail-avatar" aria-hidden="true">↯</span>
        <span class="partner-mail-main">
          <span class="partner-mail-line">
            <strong>${escapeHtml(notification.title)}</strong>
            <time>${escapeHtml(formatPushInboxDate(notification.sentAt || notification.createdAt || notification.updatedAt))}</time>
          </span>
          <span class="partner-mail-subject">${escapeHtml(body)}</span>
          <span class="partner-mail-meta">
            <span class="history-status status-${escapeAttr(deliveryClass)}">${escapeHtml(getPushDeliveryStatusLabel(deliveryStatus))}</span>
            <span>${escapeHtml(typeLabel)}</span>
            <span>${escapeHtml(getPushInboxRecipientLabel(notification))}</span>
            ${notification.partnerName ? `<span>${escapeHtml(notification.partnerName)}</span>` : ""}
            ${notification.lastError ? `<span>${escapeHtml(notification.lastError)}</span>` : ""}
          </span>
        </span>
      </div>
      ${notification.parcelId ? `<button class="partner-mail-delete partner-mail-map" type="button" data-action="focusPushInboxParcel" data-value="${escapeAttr(notification.parcelId)}" aria-label="ამანათის ნახვა">⌖</button>` : ""}
    </article>
  `;
}


async function openAdminPartnerInbox(view = state.adminMailView || "messages") {
  if (!state.isAdmin) return;
  state.adminMailView = view === "push" ? "push" : "messages";
  const [partners, messages, pushNotifications] = await Promise.all([
    getPartners(),
    getPartnerInboxMessages(),
    typeof loadPushInboxNotifications === "function" ? loadPushInboxNotifications() : Promise.resolve([]),
  ]);
  const partnerOptions = partners.map((partner) => `<option value="${escapeAttr(partner.username)}">${escapeHtml(partnerName(partner))}</option>`).join("");
  const body = `
    <div class="partner-inbox-panel">
      ${renderAdminMailTabs(state.adminMailView, { messages: messages.length, push: pushNotifications.length })}
      ${state.adminMailView === "messages" ? `<section class="partner-inbox-compose">
        <div class="partner-inbox-compose-head">
          <strong>ახალი შეტყობინება</strong>
          <button class="button primary partner-inbox-send-button" type="button" data-action="sendAdminPartnerInboxMessage">გაგზავნა</button>
        </div>
        <div class="partner-inbox-compose-grid">
          <label for="partnerInboxTarget">
            <span>მიმღები</span>
            <select id="partnerInboxTarget">
              <option value="">ყველა პარტნიორი</option>
              ${partnerOptions}
            </select>
          </label>
          <label for="partnerInboxMessage">
            <span>შეტყობინება</span>
            <textarea id="partnerInboxMessage" rows="4" maxlength="4000" placeholder="ჩაწერეთ შეტყობინება"></textarea>
          </label>
        </div>
        <p class="form-message" id="partnerInboxAdminMessage" role="alert"></p>
      </section>` : ""}
      ${state.adminMailView === "push" ? renderPushMailList(pushNotifications) : renderPartnerInboxList(messages, { admin: true })}
    </div>
  `;
  showDialog("ფოსტა", body, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  els.dialogModal.classList.add("mail-dialog");
}


async function sendAdminPartnerInboxMessage() {
  const status = document.getElementById("partnerInboxAdminMessage");
  const target = document.getElementById("partnerInboxTarget")?.value || "";
  const message = document.getElementById("partnerInboxMessage")?.value.trim() || "";
  if (!message) {
    if (status) status.textContent = "შეტყობინების ტექსტი აუცილებელია.";
    return;
  }
  document.querySelectorAll("#dialogActions button, .partner-inbox-send-button").forEach((button) => {
    button.disabled = true;
  });
  try {
    const payload = await sendPartnerInboxMessage({
      targetType: target ? "partner" : "all",
      partnerUsername: target,
      message,
    });
    if (!(typeof isStaticDeploy === "function" && isStaticDeploy()) && typeof buildPartnerInboxNotification === "function") {
      await publishPushNotification(buildPartnerInboxNotification(payload?.message)).catch((error) => {
        console.warn("Partner inbox push notification failed", error);
      });
    }
    showToast("შეტყობინება გაიგზავნა.");
    await openAdminPartnerInbox();
  } catch (error) {
    if (status) status.textContent = error.message || STRINGS.serverFailed;
  } finally {
    document.querySelectorAll("#dialogActions button, .partner-inbox-send-button").forEach((button) => {
      button.disabled = false;
    });
  }
}


async function openPartnerInbox() {
  if (!state.isPartner) return;
  const messages = await getPartnerInboxMessages();
  const body = `
    <div class="partner-inbox-panel">
      <div class="partner-inbox-toolbar">
        <span>${escapeHtml(messages.filter((message) => !isPartnerInboxRead(message)).length)} ახალი წერილი</span>
        <button class="mini-button danger" type="button" data-action="clearPartnerInbox">გასუფთავება</button>
      </div>
      ${renderPartnerInboxList(messages)}
    </div>
  `;
  showDialog("ინბოქსი", body, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  els.dialogModal.classList.add("mail-dialog");
}


async function openPartnerInboxMessage(messageId) {
  const messages = await getPartnerInboxMessages();
  const message = messages.find((item) => item.id === messageId);
  if (!message) {
    showToast("შეტყობინება ვერ მოიძებნა.");
    return;
  }
  if (state.isPartner) {
    await markPartnerInboxMessageRead(messageId).catch(() => {});
  }
  const body = `
    <article class="partner-inbox-detail">
      <div class="partner-inbox-detail-meta">
        <span>${escapeHtml(getPartnerInboxTargetLabel(message))}</span>
        <strong>${escapeHtml(formatOptionalDateTime(message.createdAt))}</strong>
        <small>ვადა: ${escapeHtml(getPartnerInboxDaysLeft(message) || "15 დღე")}</small>
      </div>
      <p>${escapeHtml(message.message || "").replace(/\n/g, "<br>")}</p>
    </article>
  `;
  showDialog("შეტყობინება", body, [
    { label: "უკან", variant: "secondary", action: state.isAdmin ? openAdminPartnerInbox : openPartnerInbox },
  ]);
}


async function clearPartnerInbox() {
  if (!state.isPartner) return;
  await clearPartnerInboxMessages();
  showToast("ინბოქსი გასუფთავდა.");
  await openPartnerInbox();
}


async function removePartnerInboxMessage(messageId) {
  if (!state.isAdmin) return;
  await deletePartnerInboxMessage(messageId);
  showToast("შეტყობინება წაიშალა.");
  await openAdminPartnerInbox();
}


async function openPartnerManagement() {
  const partners = await getPartners();
  const [records] = await Promise.all([
    getAllPartnerCashRecords(),
    loadPartnerCashAdjustments(),
  ]);
  state.partnerCashRecords = records;
  const body = `
    <div class="partner-panel-head">
      <h2>პარტნიორები</h2>
      <div class="partner-filter-row">
        <button class="button secondary" type="button" data-action="adminPartnerOrders">შეკვეთები</button>
        <button class="button primary" type="button" data-action="createPartner">დამატება</button>
      </div>
    </div>
    ${renderPartnerTable(partners)}
  `;
  showDialog("პარტნიორები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


function renderPartnerTable(partners) {
  return renderAppListPanel({
    title: "პარტნიორების სია",
    badges: [`სულ: ${partners.length}`],
    headers: ["პარტნიორი", "ქეში", "მოლოდინი", "კორექტირება", "კონტაქტი", "სტატუსი", ""],
    emptyMessage: "პარტნიორი ჯერ არ არის",
    rows: partners.map(renderPartnerCard),
  });
}


function renderPartnerCard(partner) {
  const active = partner.status === "active";
  const cash = calculatePartnerCashSummary(partner, state.partnerCashRecords || []);
  return `
    <tr>
      <td>${renderAppTableText(partnerName(partner), partner.username)}</td>
      <td>${escapeHtml(formatMoney(cash.cashDue))}</td>
      <td>${escapeHtml(formatMoney(cash.pendingCash))}</td>
      <td>${renderAppTableText(formatAdjustmentDisplay(cash.adjustmentTotal), getAdjustmentDirectionLabel(cash.adjustmentTotal))}</td>
      <td>${renderAppTableText(partner.contactPerson || "არ არის", partner.phone || "არ არის")}</td>
      <td>${renderAppStatusBadge(active ? "delivered" : "failed", active ? "აქტიური" : "არააქტიური")}</td>
      <td>
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

  const summary = calculatePartnerCashSummary(partner, records);
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

  const summary = calculatePartnerCashSummary(partner, records);
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
    dateKey: toDateKey(new Date()),
    date: toDateKey(new Date()),
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
  const summary = calculatePartnerCashSummary(partner, records);
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
