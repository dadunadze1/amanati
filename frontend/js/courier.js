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
  if (state.isAdmin || state.isPartner || !state.currentUser) {
    els.appShell?.classList.remove("is-courier-mobile");
    els.courierDashboard.hidden = true;
    els.courierDashboard.textContent = "";
    els.courierOrdersSheet.hidden = true;
    els.courierOrdersSheet.textContent = "";
    return;
  }

  els.appShell?.classList.add("is-courier-mobile");
  els.courierDashboard.hidden = false;
  els.courierOrdersSheet.hidden = true;
  els.courierOrdersSheet.textContent = "";
  els.courierOrdersSheet.classList.remove("is-expanded");

  const activePins = typeof getCourierLivePins === "function" ? getCourierLivePins(pins) : (Array.isArray(pins) ? pins : []);
  const sortedPins = sortCourierPinsByStatusAndDistance(activePins);
  const todayStats = await calculateTodayStats(state.currentUser).catch(() => ({
    courierPay: 0,
    outstandingCash: 0,
    pending: activePins.filter((pin) => pin.status === "pending").length,
    delivered: activePins.filter((pin) => pin.status === "delivered").length,
  }));
  const pending = activePins.filter((pin) => pin.status === "pending").length;
  const status = getCourierPresenceStatus(activePins);
  const nearest = sortedPins.find((pin) => pin.status === "pending") || sortedPins[0];
  const nearestDistance = nearest && state.hasCurrentPosition ? distanceInMeters(state.currentPosition, nearest) : NaN;

  els.courierDashboard.innerHTML = `
    <div class="courier-status-row">
      <button class="courier-online-toggle courier-status-${escapeAttr(status.key)}" type="button" data-courier-presence-toggle data-mode="${escapeAttr(status.key)}">
        <span aria-hidden="true"></span>
        <strong>${escapeHtml(status.label)}</strong>
      </button>
      <div class="courier-day-pill">
        <span>დღის ₾</span>
        <strong>${escapeHtml(formatMoney(todayStats.courierPay || 0))}</strong>
      </div>
      <div class="courier-day-pill">
        <span>აქტიური</span>
        <strong>${pending}</strong>
      </div>
    </div>
    <button class="courier-mini-route" type="button" data-courier-current-order>
      <span>${nearest ? "შემდეგი მისამართი" : "შეკვეთა არ არის"}</span>
      <strong>${escapeHtml(nearest ? getParcelAddress(nearest) : "აქტიური შეკვეთა არ არის")}</strong>
      <small>${Number.isFinite(nearestDistance) ? `${escapeHtml(formatDistance(nearestDistance))} / ETA ${estimateCourierEta(nearestDistance)}` : "GPS ლოკაციას ველოდებით"}</small>
    </button>
  `;
  els.courierDashboard.querySelector("[data-courier-current-order]")?.addEventListener("click", openNearestCurrentCourierOrder);

  scheduleCourierViewportStabilization();
  scheduleMapInvalidateSize();
}


function updateCourierViewportVars() {
  updateAppViewportVars();
}


function scheduleCourierViewportStabilization() {
  if (state.isAdmin || state.isPartner || !state.currentUser) return;
  [0, 80, 220, 520, 1000].forEach((delay) => {
    window.setTimeout(() => {
      updateCourierViewportVars();
      state.map?.invalidateSize?.({ pan: false });
    }, delay);
  });
}


if (typeof window !== "undefined") {
  window.addEventListener("resize", updateCourierViewportVars, { passive: true });
  window.visualViewport?.addEventListener("resize", updateCourierViewportVars, { passive: true });
}


function getNearestCurrentCourierOrder() {
  const activePins = (state.activePins || []).filter((pin) => (
    normalizeUsername(pin.courierUsername) === normalizeUsername(state.currentUser)
    && pin.status !== "delivered"
    && !pin.archivedAt
    && Number.isFinite(Number(pin.lat))
    && Number.isFinite(Number(pin.lng))
  ));
  const pendingPins = activePins.filter((pin) => pin.status === "pending");
  const candidates = pendingPins.length ? pendingPins : activePins;
  return sortCourierPinsByStatusAndDistance(candidates)[0] || null;
}


function openNearestCurrentCourierOrder() {
  const pin = getNearestCurrentCourierOrder();
  if (!pin) {
    showToast("აქტიური შეკვეთა ვერ მოიძებნა");
    return;
  }

  const coords = toLeafletLatLng(pin);
  if (state.map?.flyTo) {
    state.map.flyTo(coords, Math.max(getMapZoom(), 17), { duration: 0.55, easeLinearity: 0.22 });
  } else {
    setMapView(pin, 17);
  }
  openParcelTab(pin.id, { focus: false });
  highlightCourierOrderPin(pin);
  scheduleMapInvalidateSize();
}


function highlightCourierOrderPin(pin) {
  if (!state.map || !window.L) return;
  const highlight = L.circleMarker(toLeafletLatLng(pin), {
    interactive: false,
    radius: 22,
    fillColor: "#facc15",
    fillOpacity: 0.24,
    color: "#f59e0b",
    opacity: 0.95,
    weight: 3,
    className: "courier-focus-highlight",
  }).addTo(state.map);
  window.setTimeout(() => highlight.remove(), 1450);
}


function getCourierPresenceStatus(pins) {
  const key = state.courierPresenceStatus === "offline" ? "offline" : "online";
  return { key, label: key === "online" ? "ონლაინ" : "ოფლაინ" };
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
  const pins = getCourierLivePins(await getPins(state.currentUser));
  const sortedPins = sortCourierPinsByStatusAndDistance(pins);
  const rows = await Promise.all(sortedPins.map((pin) => renderCourierParcelCard(pin, { includeCash: true, includePhone: true })));

  showDialog("ჩემი ამანათები", renderAppListPanel({
    title: "ჩემი ამანათები",
    badges: [`სულ: ${sortedPins.length}`],
    headers: ["მიმღები", "მისამართი", "სტატუსი", "ქეში", "ტელეფონი", ""],
    emptyMessage: "აქტიური ამანათი არ არის.",
    rows,
  }), [
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
  const pins = getCourierLivePins(await getPins(state.currentUser));
  const sortedPins = sortCourierPinsByStatusAndDistance(pins);
  const rows = await Promise.all(sortedPins.map((pin) => renderCourierParcelCard(pin, { includeCash: false, includePhone: false })));

  showDialog("სტატუსის შეცვლა", renderAppListPanel({
    title: "სტატუსის შეცვლა",
    badges: [`აქტიური: ${sortedPins.length}`],
    headers: ["მიმღები", "მისამართი", "სტატუსი", "ქეში", "ტელეფონი", ""],
    emptyMessage: "აქტიური ამანათი არ არის.",
    rows,
  }), [
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
    <tr>
      <td>${renderAppTableText(pin.fullName || "უსახელო", pin.id ? String(pin.id).slice(0, 8) : "")}</td>
      <td>${escapeHtml(address || STRINGS.addressMissing)}</td>
      <td>${renderAppStatusBadge(pin.status, status)}</td>
      <td>${options.includeCash ? escapeHtml(formatMoney(payment)) : "-"}</td>
      <td>${options.includePhone ? escapeHtml(pin.phone || "არ არის") : "-"}</td>
      <td>
        <div class="row-actions courier-parcel-actions">
          <button class="mini-button" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">${escapeHtml("რუკა")}</button>
          <button class="mini-button" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">${escapeHtml("ჩაბარდა")}</button>
          <button class="mini-button danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">${escapeHtml("ვერ ჩაბარდა")}</button>
        </div>
      </td>
    </tr>
  `;
}


async function openCourierRoute() {
  const pins = getCourierLivePins(await getPins(state.currentUser));
  const sortedPins = [...pins].sort((a, b) => {
    const statusDiff = getStatusSortValue(a.status) - getStatusSortValue(b.status);
    if (statusDiff) return statusDiff;
    return distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b);
  });

  const rows = await Promise.all(sortedPins.map(async (pin, index) => {
    const address = await resolveParcelAddress(pin);
    const distance = distanceInMeters(state.currentPosition, pin);
    return `
      <tr>
        <td>${renderAppTableText(`${index + 1}. ${pin.fullName || "უსახელო"}`, pin.phone || "ტელეფონი არ არის")}</td>
        <td>${escapeHtml(address || STRINGS.addressMissing)}</td>
        <td>${renderAppStatusBadge(pin.status, getStatusLabel(pin.status))}</td>
        <td>${escapeHtml(formatDistance(distance))}</td>
        <td>${escapeHtml(formatMoney(getPaymentAmount(pin)))}</td>
        <td>
          <div class="row-actions route-actions">
            <button class="mini-button" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">რუკა</button>
            <button class="mini-button" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
            <button class="mini-button danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">არ ჩაბარდა</button>
          </div>
        </td>
      </tr>
    `;
  }));

  showDialog("მარშრუტი", renderAppListPanel({
    title: "მარშრუტი",
    badges: [`აქტიური: ${sortedPins.length}`],
    headers: ["მიმღები", "მისამართი", "სტატუსი", "მანძილი", "ქეში", ""],
    emptyMessage: "აქტიური ამანათი არ არის.",
    rows,
  }), [
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
      <tr>
        <td>${renderAppTableText(item.fullName || "უსახელო მიმღები", item.phone || "ტელეფონი არ არის")}</td>
        <td>${renderAppTableText(address || STRINGS.addressMissing, item.status === "failed" && failureReason ? `მიზეზი: ${failureReason}` : "")}</td>
        <td>${renderAppStatusBadge(item.status, getStatusLabel(item.status))}</td>
        <td>${renderAppTableText(payment > 0 ? formatMoney(payment) : "არ აქვს", `კურიერი: ${formatMoney(itemCourierPay)}`)}</td>
        <td>${escapeHtml(formatOptionalDateTime(statusChangedAt || deliveredAt || failedAt))}</td>
      </tr>
  `;
  })));

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
        <span><b>${escapeHtml(formatAdjustmentDisplay(payAdjustment))}</b> ${escapeHtml(getAdjustmentDirectionLabel(payAdjustment))}</span>
        <span><b>${escapeHtml(formatMoney(stats.courierPay))}</b> საბოლოო გამომუშავება</span>
      </div>
    </div>
    ${renderAppListPanel({
      title: "დღის ამანათები",
      badges: [`სულ: ${stats.records.length}`],
      headers: ["მიმღები", "მისამართი", "სტატუსი", "თანხა", "თარიღი"],
      emptyMessage: "დღეს ამანათი არ არის.",
      rows,
    })}
  `;
}
