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
  els.courierDashboard.hidden = true;
  els.courierDashboard.textContent = "";
  els.courierOrdersSheet.hidden = false;
  els.courierOrdersSheet.classList.remove("is-expanded");

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
  const statusLabel = escapeHtml(status.label);
  const todayPay = escapeHtml(formatMoney(todayStats.courierPay || 0));
  const routeActive = nearest ? state.routePinId === nearest.id : false;
  const selectedCard = nearest
    ? await renderCourierMobileDetailCard(nearest, {
      pending,
      deliveredToday,
      routeActive,
      status,
      todayPay,
      totalOrders: activePins.length,
      nearestDistance,
    })
    : `<div class="courier-empty-state">აქტიური შეკვეთა არ არის.</div>`;

  els.courierOrdersSheet.innerHTML = `
    <div class="courier-sheet-shell">
      <button class="courier-sheet-handle" type="button" data-courier-sheet-toggle aria-label="შეკვეთების პანელის გაშლა">
        <span></span>
      </button>
      ${selectedCard}
    </div>
  `;

  if (els.courierDashboard) els.courierDashboard.hidden = true;
  scheduleMapInvalidateSize();
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
  return { key, label: key === "online" ? "Online" : "Offline" };
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
  const eta = Number.isFinite(distance) ? estimateCourierEta(distance) : "GPS";
  const status = getStatusLabel(pin.status);
  const title = pin.fullName || "უსახელო შეკვეთა";
  const paymentLabel = payment > 0 ? formatMoney(payment) : "ქეში არ არის";
  const deliveryDistance = Number.isFinite(distance) ? `${formatDistance(distance)} · ETA ${eta}` : "GPS ლოკაციას ველოდებით";
  return `
    <article class="courier-mobile-order-card status-${escapeAttr(pin.status)}">
      <div class="courier-order-card-head">
        <div class="courier-order-card-head-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(address || STRINGS.addressMissing)}</span>
        </div>
        <div class="courier-order-badges">
          <span class="courier-order-status">${escapeHtml(status)}</span>
          <span class="courier-order-amount">${escapeHtml(paymentLabel)}</span>
        </div>
      </div>

      <div class="courier-accordion-list">
        ${renderCourierAccordionRow("pickup", "Pickup", "მომზადება და აღება", `
          <div class="courier-accordion-detail">
            ${renderCourierDetailLine("მიმღები", title)}
            ${renderCourierDetailLine("ტელეფონი", pin.phone || "ტელეფონი არ არის")}
          </div>
        `)}
        ${renderCourierAccordionRow("delivery", "Delivery", deliveryDistance, `
          <div class="courier-accordion-detail">
            ${renderCourierDetailLine("მისამართი", address || STRINGS.addressMissing)}
            ${renderCourierDetailLine("სტატუსი", status)}
          </div>
        `)}
        ${renderCourierAccordionRow("payment", "Payment", paymentLabel, `
          <div class="courier-accordion-detail">
            ${renderCourierDetailLine("ქეში", paymentLabel)}
            ${renderCourierDetailLine("ETA", `${eta} / ${Number.isFinite(distance) ? formatDistance(distance) : "GPS"}`)}
          </div>
        `)}
        ${renderCourierAccordionRow("status", "Status", status, `
          <div class="courier-accordion-detail">
            ${renderCourierDetailLine("მიმდინარე", status)}
            ${renderCourierDetailLine("დისტანცია", Number.isFinite(distance) ? formatDistance(distance) : "GPS")}
          </div>
        `)}
      </div>

      <div class="courier-order-actions">
        <button type="button" class="courier-order-action courier-order-action--ghost" data-action="focusCourierPin" data-value="${escapeAttr(pin.id)}">
          ${renderCourierActionIcon("map")}
          <span>რუკა</span>
        </button>
        <button type="button" class="courier-order-action courier-order-action--primary" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">
          ${renderCourierActionIcon("done")}
          <span>ჩაბარდა</span>
        </button>
        <button type="button" class="courier-order-action courier-order-action--danger" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">
          ${renderCourierActionIcon("failed")}
          <span>ვერ</span>
        </button>
      </div>
    </article>
  `;
}


async function renderCourierMobileDetailCard(pin, context = {}) {
  const address = await resolveParcelAddress(pin);
  const payment = getPaymentAmount(pin);
  const distance = Number.isFinite(context.nearestDistance) ? context.nearestDistance : (state.hasCurrentPosition ? distanceInMeters(state.currentPosition, pin) : NaN);
  const eta = Number.isFinite(distance) ? estimateCourierEta(distance) : "GPS";
  const statusText = getStatusLabel(pin.status);
  const routeActive = Boolean(context.routeActive);
  const phoneHref = pin.phone ? formatPhoneHref(pin.phone) : "";
  const failureReason = pin.status === "failed" ? parcelFailureReason(pin) : "";
  const totalOrders = Number.isFinite(context.totalOrders) ? context.totalOrders : 0;

  return `
    <article class="nearest-card courier-selected-card status-${escapeAttr(pin.status)}">
      <div class="nearest-card-header">
        <strong>${escapeHtml(pin.fullName || "აქტიური შეკვეთა")}</strong>
        <div class="nearest-card-actions">
          <button class="nearest-icon-button" type="button" data-action="focusCourierPin" data-value="${escapeAttr(pin.id)}" aria-label="ამანათის რუკაზე ჩვენება">რუკა</button>
          <button class="nearest-icon-button" type="button" data-action="routeCourierPin" data-value="${escapeAttr(pin.id)}" aria-label="მარშრუტის დაგეგმვა">მარშრუტი</button>
          ${routeActive ? `<button class="nearest-icon-button route-clear-button" type="button" data-action="clearSelectedRoute" aria-label="მარშრუტის გაუქმება">×</button>` : ""}
          <button class="nearest-icon-button" type="button" data-courier-sheet-toggle aria-label="დეტალების დახურვა">-</button>
        </div>
      </div>
      <div class="nearest-card-body">
        <section class="nearest-detail-section">
          <h3>კლიენტი</h3>
          <div class="nearest-detail">
            <span>მიმღები</span>
            <strong>${escapeHtml(pin.fullName || "უსახელო შეკვეთა")}</strong>
          </div>
          <div class="nearest-detail">
            <span>ტელეფონი</span>
            ${phoneHref ? `<a class="call-link" href="${escapeAttr(phoneHref)}" aria-label="მიმღებთან დარეკვა">დარეკვა</a>` : `<strong>ტელეფონი არ არის</strong>`}
          </div>
        </section>
        <section class="nearest-detail-section">
          <h3>შეკვეთა</h3>
          <div class="nearest-detail">
            <span>მისამართი</span>
            <strong>${escapeHtml(address || STRINGS.addressMissing)}</strong>
          </div>
          <div class="nearest-detail">
            <span>დისტანცია</span>
            <strong>${Number.isFinite(distance) ? formatDistance(distance) : "GPS"}</strong>
          </div>
          <div class="nearest-detail">
            <span>ETA</span>
            <strong>${escapeHtml(eta)}</strong>
          </div>
        </section>
        <section class="nearest-detail-section">
          <h3>სტატუსი</h3>
          <div class="nearest-detail">
            <span>სტატუსი</span>
            <strong class="status-${escapeAttr(pin.status)}">${escapeHtml(statusText)}</strong>
          </div>
          <div class="courier-mobile-status-actions">
            <button class="nearest-status-button delivered" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
            <button class="nearest-status-button failed" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">ვერ ჩაბარდა</button>
          </div>
          ${failureReason ? `
            <div class="nearest-detail">
              <span>მიზეზი</span>
              <strong>${escapeHtml(failureReason)}</strong>
            </div>
          ` : ""}
        </section>
        <section class="nearest-detail-section">
          <h3>მარშრუტი</h3>
          <div class="nearest-detail">
            <span>აქტიური</span>
            <strong>${routeActive ? "კი" : "არა"}</strong>
          </div>
          <div class="nearest-detail">
            <span>შეკვეთები</span>
            <strong>${totalOrders}</strong>
          </div>
          <div class="nearest-card-actions courier-selected-card-actions">
            <button class="nearest-icon-button" type="button" data-action="routeCourierPin" data-value="${escapeAttr(pin.id)}">რუკა + მარშრუტი</button>
            ${routeActive ? `<button class="nearest-icon-button route-clear-button" type="button" data-action="clearSelectedRoute">გაუქმება</button>` : ""}
          </div>
        </section>
        <section class="nearest-detail-section">
          <h3>თანხა</h3>
          <div class="nearest-detail">
            <span>ქეში</span>
            <strong>${payment > 0 ? escapeHtml(formatMoney(payment)) : "ქეში არ არის"}</strong>
          </div>
          <div class="nearest-detail">
            <span>საფეხური</span>
            <strong>${context.status?.label ? escapeHtml(context.status.label) : "აქტიური"}</strong>
          </div>
        </section>
      </div>
    </article>
  `;
}


function renderCourierAvatarIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 12.5a4.25 4.25 0 1 0-4.25-4.25A4.25 4.25 0 0 0 12 12.5Z" fill="currentColor" opacity="0.18"></path>
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
      <path d="M12 12.2a2.9 2.9 0 1 0-2.9-2.9A2.9 2.9 0 0 0 12 12.2Z" fill="currentColor"></path>
    </svg>
  `;
}


function renderCourierActionIcon(kind) {
  const icons = {
    route: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 18h7l9-12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="4.5" cy="18" r="1.7" fill="currentColor"></circle>
        <circle cx="12" cy="10" r="1.7" fill="currentColor"></circle>
        <circle cx="19.5" cy="6" r="1.7" fill="currentColor"></circle>
      </svg>
    `,
    call: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7.5 4.5h3l1.1 4.1-2 1.9a14.7 14.7 0 0 0 5 5l1.9-2 4.1 1.1v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 5 6.1 1.5 1.5 0 0 1 6.5 4.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      </svg>
    `,
    map: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m3.5 7 5-2 7 2 5-2v12l-5 2-7-2-5 2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
        <path d="M8.5 5v12M15.5 7v12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
      </svg>
    `,
    done: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `,
    failed: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 7 17 17M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"></path>
      </svg>
    `,
  };
  return icons[kind] || icons.map;
}


function renderCourierAccordionRow(kind, title, subtitle, body) {
  return `
    <div class="courier-accordion-item courier-accordion-item--${escapeAttr(kind)}">
      <button class="courier-accordion-toggle" type="button" data-courier-accordion-toggle aria-expanded="false">
        <span class="courier-accordion-icon courier-accordion-icon--${escapeAttr(kind)}" aria-hidden="true">
          ${renderCourierSectionIcon(kind)}
        </span>
        <span class="courier-accordion-copy">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </span>
        <span class="courier-accordion-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="courier-accordion-panel" hidden>
        ${body}
      </div>
    </div>
  `;
}


function renderCourierSectionIcon(kind) {
  const icons = {
    pickup: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 19V8l5-3 5 3v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
        <path d="M9 19v-5h6v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      </svg>
    `,
    delivery: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 21s6-4.8 6-10a6 6 0 1 0-12 0c0 5.2 6 10 6 10Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
        <circle cx="12" cy="11" r="2.1" fill="currentColor"></circle>
      </svg>
    `,
    payment: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="6" width="16" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path d="M4 10h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M8 15h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `,
    status: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <path d="M12 8.8v3.9l2.6 1.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `,
  };
  return icons[kind] || icons.payment;
}


function renderCourierDetailLine(label, value) {
  return `
    <div class="courier-accordion-detail-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
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
