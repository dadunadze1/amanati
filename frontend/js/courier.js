"use strict";



function confirmCourierDelivered(pinId) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;
  if (pin.status === "delivered") {
    openParcelTab(pinId, { focus: true });
    return;
  }

  showDialog("დადასტურება", `
    <div class="route-prompt">
      <strong>შეკვეთა მოვნიშნოთ ჩაბარებულად?</strong>
      <span>${escapeHtml(pin.fullName || "")}</span>
    </div>
  `, [
    {
      label: "კი",
      variant: "primary",
      action: () => confirmCourierDeliveredYes(pinId),
    },
    {
      label: "არა",
      variant: "secondary",
      action: () => cancelCourierDeliveredConfirm(pinId),
    },
  ]);
}


async function confirmCourierDeliveredYes(pinId) {
  closeDialog();
  try {
    await updatePinStatus(pinId, "delivered");
  } catch (error) {
    showToast(error.message || STRINGS.serverFailed);
    openParcelTab(pinId, { focus: true });
  }
}


function cancelCourierDeliveredConfirm(pinId) {
  closeDialog();
  openParcelTab(pinId, { focus: true });
}


async function renderCourierMobileDashboard(pins = state.activePins) {
  if (!els.courierDashboard || !els.courierOrdersSheet) return;
  if (state.isAdmin || !state.currentUser) {
    els.appShell?.classList.remove("is-courier-mobile");
    els.courierDashboard.hidden = true;
    els.courierDashboard.textContent = "";
    els.courierOrdersSheet.hidden = true;
    els.courierOrdersSheet.textContent = "";
    return;
  }

  els.appShell?.classList.add("is-courier-mobile");
  els.courierDashboard.hidden = false;
  els.courierOrdersSheet.hidden = false;

  const activePins = Array.isArray(pins) ? pins : [];
  const sortedPins = sortCourierPinsByStatusAndDistance(activePins);
  const todayStats = await calculateTodayStats(state.currentUser).catch(() => ({
    courierPay: 0,
    outstandingCash: 0,
    pending: activePins.filter((pin) => pin.status === "pending").length,
    delivered: activePins.filter((pin) => pin.status === "delivered").length,
  }));
  const pending = activePins.filter((pin) => pin.status === "pending").length;
  const deliveredToday = todayStats.delivered || 0;
  const status = getCourierPresenceStatus(activePins);
  const nearest = sortedPins.find((pin) => pin.status === "pending") || sortedPins[0];
  const nearestDistance = nearest && state.hasCurrentPosition ? distanceInMeters(state.currentPosition, nearest) : NaN;
  const pendingPins = sortedPins.filter((pin) => pin.status === "pending");
  const activeDeliveryPins = sortedPins.filter((pin) => pin.status !== "pending");
  const pendingCards = (await Promise.all(pendingPins.map(renderCourierMobileOrderCard))).join("");
  const activeCards = (await Promise.all(activeDeliveryPins.map(renderCourierMobileOrderCard))).join("");

  els.courierDashboard.innerHTML = `
    <div class="courier-status-row">
      <button class="courier-online-toggle courier-status-${escapeAttr(status.key)}" type="button" data-courier-presence-toggle data-mode="${escapeAttr(status.key)}">
        <span aria-hidden="true"></span>
        <strong>${escapeHtml(status.label)}</strong>
      </button>
      <div class="courier-day-pill">
        <span>დღეს</span>
        <strong>${escapeHtml(formatMoney(todayStats.courierPay || 0))}</strong>
      </div>
      <div class="courier-day-pill">
        <span>აქტიური</span>
        <strong>${pending}</strong>
      </div>
    </div>
    <div class="courier-mini-route">
      <span>${nearest ? "შემდეგი მისამართი" : "შეკვეთა არ არის"}</span>
      <strong>${escapeHtml(nearest ? getParcelAddress(nearest) : "აქტიური შეკვეთა არ არის")}</strong>
      <small>${Number.isFinite(nearestDistance) ? `${escapeHtml(formatDistance(nearestDistance))} / ETA ${estimateCourierEta(nearestDistance)}` : "GPS ლოკაციას ველოდებით"}</small>
    </div>
  `;

  els.courierOrdersSheet.innerHTML = `
    <button class="courier-sheet-handle" type="button" data-courier-sheet-toggle aria-label="შეკვეთების პანელის გაშლა">
      <span></span>
    </button>
    <div class="courier-sheet-head">
      <div>
        <span>შეკვეთები</span>
        <strong>${pending} აქტიური</strong>
      </div>
      <button class="courier-sheet-action" type="button" data-action="nearestParcel">უახლოესი</button>
    </div>
    <div class="courier-sheet-stats">
      <span><b>${activePins.length}</b> ყველა</span>
      <span><b>${pending}</b> pending</span>
      <span><b>${deliveredToday}</b> delivered</span>
      <span><b>${escapeHtml(formatMoney(todayStats.courierPay || 0))}</b> დღეს</span>
    </div>
    <div class="courier-orders-list">
      ${pendingCards ? `<div class="courier-sheet-section-title">Pending deliveries</div>${pendingCards}` : ""}
      ${activeCards ? `<div class="courier-sheet-section-title">Active deliveries</div>${activeCards}` : ""}
      ${!pendingCards && !activeCards ? `<div class="courier-empty-state">აქტიური შეკვეთა არ არის.</div>` : ""}
    </div>
    ${nearest ? `
      <div class="courier-sticky-actions">
        <button type="button" data-action="focusAdminPin" data-value="${escapeAttr(nearest.id)}">მიღება</button>
        <button type="button" data-action="routeCourierPin" data-value="${escapeAttr(nearest.id)}">გზაში</button>
        <button class="is-success" type="button" data-action="setStatus" data-value="${escapeAttr(nearest.id)}" data-status="delivered">ჩაბარდა</button>
        <button class="is-danger" type="button" data-action="setStatus" data-value="${escapeAttr(nearest.id)}" data-status="failed">ვერ</button>
      </div>
    ` : ""}
  `;
}


function getCourierPresenceStatus(pins) {
  if (!state.hasCurrentPosition) return { key: "offline", label: "Offline" };
  if (state.routePinId) return { key: "delivering", label: "Delivering" };
  if ((pins || []).some((pin) => pin.status === "pending")) return { key: "busy", label: "Busy" };
  return { key: "online", label: "Online" };
}


function estimateCourierEta(distance) {
  if (!Number.isFinite(distance)) return "";
  const minutes = Math.max(3, Math.round(distance / 350));
  return `${minutes} წთ`;
}


async function renderCourierMobileOrderCard(pin) {
  const address = await resolveParcelAddress(pin);
  const payment = getPaymentAmount(pin);
  const distance = state.hasCurrentPosition ? distanceInMeters(state.currentPosition, pin) : NaN;
  return `
    <article class="courier-mobile-order-card status-${escapeAttr(pin.status)}">
      <div class="courier-order-topline">
        <span class="courier-order-status">${escapeHtml(getStatusLabel(pin.status))}</span>
        <strong class="courier-order-amount">${payment > 0 ? escapeHtml(formatMoney(payment)) : "ქეში არ არის"}</strong>
      </div>
      <h3>${escapeHtml(address || STRINGS.addressMissing)}</h3>
      <div class="courier-order-meta">
        <span class="courier-order-client">${escapeHtml(pin.fullName || "უსახელო")}</span>
        <span>${Number.isFinite(distance) ? `${escapeHtml(formatDistance(distance))} / ETA ${estimateCourierEta(distance)}` : "GPS ელოდება"}</span>
      </div>
      <div class="courier-quick-actions">
        <button type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">მიღება</button>
        <button type="button" data-action="routeCourierPin" data-value="${escapeAttr(pin.id)}">გზაში</button>
        <button class="is-success" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
        <button class="is-danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">ვერ</button>
        <a href="${escapeAttr(formatPhoneHref(pin.phone))}">ზარი</a>
        <button type="button" data-action="routeCourierPin" data-value="${escapeAttr(pin.id)}">ნავიგაცია</button>
      </div>
    </article>
  `;
}


async function openTodayStats() {
  const stats = await calculateTodayStats(state.currentUser);
  showDialog("ჩემი დღე", await renderStats(stats), [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openCourierParcels() {
  const pins = await getPins(state.currentUser);
  const sortedPins = sortCourierPinsByStatusAndDistance(pins);
  const rows = (await Promise.all(sortedPins.map((pin) => renderCourierParcelCard(pin, { includeCash: true, includePhone: true })))).join("");

  showDialog("ჩემი ამანათები", `<div class="courier-menu-list">${rows || `<p class="history-empty">${escapeHtml("აქტიური ამანათი არ არის.")}</p>`}</div>`, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function openNearestParcel() {
  if (!state.hasCurrentPosition) {
    showToast("მდებარეობა ჯერ არ არის განსაზღვრული.");
    return;
  }

  const pins = await getPins(state.currentUser);
  const nearest = pins
    .filter((pin) => pin.status === "pending")
    .sort((a, b) => distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b))[0];

  if (!nearest) {
    showToast("აქტიური ამანათი არ არის.");
    return;
  }

  openParcelTab(nearest.id, { focus: true });
}


async function openCourierStatusPanel() {
  const pins = await getPins(state.currentUser);
  const sortedPins = sortCourierPinsByStatusAndDistance(pins);
  const rows = (await Promise.all(sortedPins.map((pin) => renderCourierParcelCard(pin, { includeCash: false, includePhone: false })))).join("");

  showDialog("სტატუსის შეცვლა", `<div class="courier-menu-list">${rows || `<p class="history-empty">${escapeHtml("აქტიური ამანათი არ არის.")}</p>`}</div>`, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


function sortCourierPinsByStatusAndDistance(pins) {
  return [...pins].sort((a, b) => {
    const statusDiff = getStatusSortValue(a.status) - getStatusSortValue(b.status);
    if (statusDiff) return statusDiff;
    if (state.hasCurrentPosition) return distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b);
    return String(a.fullName || "").localeCompare(String(b.fullName || ""), "ka");
  });
}


async function renderCourierParcelCard(pin, options = {}) {
  const address = await resolveParcelAddress(pin);
  const status = getStatusLabel(pin.status);
  const payment = getPaymentAmount(pin);

  return `
    <article class="courier-parcel-card">
      <div class="history-row-main">
        <strong>${escapeHtml(pin.fullName || "")}</strong>
        <span class="history-status status-${escapeAttr(pin.status)}">${escapeHtml(status)}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      <div class="history-row-meta">
        ${options.includePhone ? `<span>${escapeHtml("ტელეფონი")}: ${escapeHtml(pin.phone || "")}</span>` : ""}
        ${options.includeCash ? `<span>${escapeHtml("ქეში")}: ${escapeHtml(formatMoney(payment))}</span>` : ""}
      </div>
      <div class="courier-parcel-actions">
        <button class="button secondary" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">${escapeHtml("რუკა")}</button>
        <button class="button" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">${escapeHtml("ჩაბარდა")}</button>
        <button class="button danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">${escapeHtml("ვერ ჩაბარდა")}</button>
      </div>
    </article>
  `;
}


async function openCourierRoute() {
  const pins = await getPins(state.currentUser);
  const sortedPins = [...pins].sort((a, b) => {
    const statusDiff = getStatusSortValue(a.status) - getStatusSortValue(b.status);
    if (statusDiff) return statusDiff;
    return distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b);
  });

  const rows = (await Promise.all(sortedPins.map(async (pin, index) => {
    const address = await resolveParcelAddress(pin);
    const distance = distanceInMeters(state.currentPosition, pin);
    return `
      <div class="history-row">
        <div class="history-row-main">
          <strong>${index + 1}. ${escapeHtml(pin.fullName)}</strong>
          <span class="history-status status-${pin.status}">${escapeHtml(getStatusLabel(pin.status))}</span>
        </div>
        <div class="history-address">${escapeHtml(address)}</div>
        <div class="history-row-meta">
          <span>მანძილი: ${escapeHtml(formatDistance(distance))}</span>
          <span>მობილური: ${escapeHtml(pin.phone || "")}</span>
          <span>ქეში: ${escapeHtml(formatMoney(getPaymentAmount(pin)))}</span>
        </div>
        <div class="route-actions">
          <button class="button secondary" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">რუკა</button>
          <button class="button" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
          <button class="button danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">არ ჩაბარდა</button>
        </div>
      </div>
    `;
  }))).join("");

  showDialog("მარშრუტი", rows || "<p class=\"history-empty\">აქტიური ამანათი არ არის.</p>", [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function calculateTodayStats(username) {
  const todayKey = toDateKey(new Date());
  const active = await getPins(username);
  const history = await getHistory(username);
  const allRecords = [...active, ...history];
  const summary = calculateFinanceSummary({ records: allRecords }, { username, startDate: todayKey, endDate: todayKey });
  const records = summary.records;
  const delivered = summary.delivered;
  const failed = summary.failed;
  const pending = summary.pending;

  return {
    delivered,
    failed,
    pending,
    companyTotal: summary.totalOrdersAmount,
    outstandingCash: summary.cashReceived,
    courierPay: summary.finalPay,
    records,
  };
}


async function renderStats(stats) {
  const todayKey = toDateKey(new Date());
  const summary = calculateFinanceSummary({ records: stats.records }, { username: state.currentUser, startDate: todayKey, endDate: todayKey });
  const basePay = summary.basePay;
  const payAdjustment = summary.adjustmentTotal;
  const rows = (await Promise.all(stats.records.map(async (item) => {
    const payment = getPaymentAmount(item);
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    const deliveredAt = item.deliveredAt || (item.status === "delivered" ? item.completedAt : "");
    const failedAt = item.failedAt || (item.status === "failed" ? item.completedAt : "");
    const statusChangedAt = item.updatedAt || item.completedAt || "";
    const failureReason = parcelFailureReason(item);
    return `
    <article class="parcel-history-card">
      <div class="parcel-history-card-head">
        <div>
          <strong>${escapeHtml(item.fullName || "უსახელო მიმღები")}</strong>
          <span>${escapeHtml(item.phone || "ტელეფონი არ არის")}</span>
        </div>
        <span class="history-status status-${escapeAttr(item.status)}">${escapeHtml(getStatusLabel(item.status))}</span>
      </div>
      <div class="parcel-history-address">${escapeHtml(address || STRINGS.addressMissing)}</div>
      <div class="parcel-history-grid">
        ${historyDetail("ქეში", payment > 0 ? formatMoney(payment) : "არ აქვს")}
        ${historyDetail("ჩასაბარებელი ქეში", formatMoney(stats.outstandingCash ?? stats.companyTotal))}
        ${historyDetail("კურიერის ანაზღაურება", formatMoney(itemCourierPay))}
        ${historyDetail("სტატუსის ცვლილება", formatOptionalDateTime(statusChangedAt))}
        ${historyDetail("მიტანის დრო", formatOptionalDateTime(deliveredAt))}
        ${historyDetail("ვერ ჩაბარდა დრო", formatOptionalDateTime(failedAt))}
      </div>
      ${item.status === "failed" && failureReason ? `<div class="parcel-history-note"><span>მიზეზი</span><strong>${escapeHtml(failureReason)}</strong></div>` : ""}
      <div class="parcel-history-actions">
        <span>${escapeHtml(formatDateTime(item.completedAt || item.archivedAt || item.updatedAt || item.createdAt))}</span>
      </div>
    </article>
  `;
  }))).join("");

  return `
    <div class="history-summary">
      <strong>დღეს</strong>
      <div class="history-metrics">
        <span><b>${stats.delivered}</b> ჩაბარდა</span>
        <span><b>${stats.failed}</b> არ ჩაბარდა</span>
        <span><b>${stats.pending}</b> პროცესში</span>
        <span><b>${stats.records.length}</b> ამანათი</span>
        <span><b>${escapeHtml(formatMoney(stats.outstandingCash ?? stats.companyTotal))}</b> ჩასაბარებელი ქეში</span>
        <span><b>${escapeHtml(formatMoney(basePay))}</b> საბაზისო გამომუშავება</span>
        <span><b>${escapeHtml(formatMoney(payAdjustment))}</b> კორექტირება</span>
        <span><b>${escapeHtml(formatMoney(stats.courierPay))}</b> საბოლოო გამომუშავება</span>
      </div>
    </div>
    <div class="history-list">${rows || "<p class=\"history-empty\">დღეს ამანათი არ არის.</p>"}</div>
  `;
}
