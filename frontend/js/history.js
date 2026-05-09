"use strict";



async function openParcelHistorySearch() {
  const couriers = await getCouriers().catch(() => []);
  const courierOptions = couriers.map((courier) => `<option value="${escapeAttr(courier.username)}">${escapeHtml(userDisplayName(courier))}</option>`).join("");
  const body = `
    <div class="parcel-history-panel">
      <form id="parcelHistoryForm" class="parcel-history-search">
        <label for="parcelHistoryQuery">ძებნა</label>
        <div class="parcel-history-search-row">
          <input id="parcelHistoryQuery" type="search" autocomplete="off" placeholder="სახელი, ტელეფონი, მისამართი, კურიერი ან თარიღი">
          <button class="button primary" type="submit">ძებნა</button>
        </div>
        <div class="parcel-history-filters" aria-label="ამანათის ისტორიის ფილტრები">
          <select id="parcelHistoryStatus">
            <option value="">ყველა</option>
            <option value="delivered">ჩაბარებული</option>
            <option value="failed">არ ჩაბარებული</option>
            <option value="pending">პროცესში</option>
          </select>
          <input id="parcelHistoryDate" type="date" aria-label="თარიღის მიხედვით">
          <select id="parcelHistoryCourier" aria-label="კურიერის მიხედვით">
            <option value="">ყველა კურიერი</option>
            ${courierOptions}
          </select>
        </div>
        <p id="parcelHistoryMessage" class="form-message" role="alert"></p>
      </form>
      <div id="parcelHistorySummary" class="parcel-history-summary"></div>
      <div id="parcelHistoryResults" class="history-results parcel-history-results"></div>
    </div>
  `;
  showDialog("ამანათის ისტორია", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  els.dialogModal.classList.add("history-dialog");
  document.getElementById("parcelHistoryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    searchParcelHistory();
  });
  ["parcelHistoryStatus", "parcelHistoryDate", "parcelHistoryCourier"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", searchParcelHistory);
  });
  await searchParcelHistory();
}


async function searchParcelHistory() {
  const query = document.getElementById("parcelHistoryQuery")?.value.trim() || "";
  const status = document.getElementById("parcelHistoryStatus")?.value || "";
  const date = document.getElementById("parcelHistoryDate")?.value || "";
  const courier = document.getElementById("parcelHistoryCourier")?.value || "";
  const message = document.getElementById("parcelHistoryMessage");
  const results = document.getElementById("parcelHistoryResults");
  if (message) message.textContent = "";
  if (results) results.innerHTML = "<p class=\"history-empty\">ისტორია იტვირთება...</p>";
  try {
    const parcels = (await searchParcels(query)).filter((parcel) => parcelMatchesHistoryFilters(parcel, { status, date, courier }));
    state.historySearchResults = parcels;
    await renderParcelHistoryResults(parcels);
  } catch {
    state.historySearchResults = [];
    if (message) message.textContent = "ისტორიის ჩატვირთვა ვერ მოხერხდა";
    if (results) results.innerHTML = "<p class=\"history-empty\">ისტორიის ჩატვირთვა ვერ მოხერხდა</p>";
  }
}


function openCalendar(username, title) {
  state.calendarDate = new Date();
  renderCalendarDialog(username, title);
}


function renderCalendarDialog(username, title) {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const weekdays = ["ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ", "კვი"];

  let grid = weekdays.map((day) => `<div class="calendar-cell weekday">${day}</div>`).join("");
  for (let i = 0; i < offset; i += 1) grid += `<div class="calendar-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toDateKey(new Date(year, month, day));
    grid += `<button class="calendar-cell" type="button" data-action="calendarDay" data-value="${date}">${day}</button>`;
  }

  const monthLabel = formatMonthYear(state.calendarDate);
  const body = `
    <div class="calendar-panel">
      <div class="calendar-header">
      <button class="calendar-nav-button" type="button" data-action="previousMonth" aria-label="წინა თვე">&lt;</button>
      <strong>${monthLabel}</strong>
      <button class="calendar-nav-button" type="button" data-action="nextMonth" aria-label="შემდეგი თვე">&gt;</button>
      </div>
      <div class="calendar-grid">${grid}</div>
    </div>
    <div id="calendarResults" class="history-results"></div>
  `;

  showDialog(title, body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  bindCalendarActions(username, title);
}


function bindCalendarActions(username, title) {
  els.dialogBody.querySelectorAll("[data-action='previousMonth'], [data-action='nextMonth'], [data-action='calendarDay']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.action === "previousMonth") {
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
        renderCalendarDialog(username, title);
        return;
      }
      if (button.dataset.action === "nextMonth") {
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
        renderCalendarDialog(username, title);
        return;
      }
      await renderHistoryForDate(username, button.dataset.value);
    });
  });
}


async function renderHistoryForDate(username, dateKey) {
  const [active, allHistory] = await Promise.all([getPins(username), getHistory(username)]);
  const summary = calculateFinanceSummary({ records: [...active, ...allHistory] }, { username, startDate: dateKey, endDate: dateKey });
  const records = summary.records;
  const delivered = summary.delivered;
  const failed = summary.failed;
  const outstandingCash = summary.cashReceived;
  const basePay = summary.basePay;
  const courierPay = summary.finalPay;
  const payAdjustment = summary.adjustmentTotal;
  const rows = (await Promise.all(records.map(async (item) => {
    const payment = getPaymentAmount(item);
    const status = getStatusLabel(item.status);
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    const failureReason = parcelFailureReason(item);
    const dateLabel = item.archivedAt || item.completedAt || item.deliveredAt || item.failedAt || item.updatedAt || item.createdAt;
    return `
    <div class="history-row">
      <div class="history-row-main">
        <strong>${escapeHtml(item.fullName)}</strong>
        <span class="history-status status-${item.status}">${status}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      ${item.status === "failed" && failureReason ? `<div class="history-address">მიზეზი: ${escapeHtml(failureReason)}</div>` : ""}
      <div class="history-row-meta">
        <span>ქეში: ${escapeHtml(formatMoney(payment))}</span>
        <span class="history-pay">კურიერის ანაზღაურება: ${escapeHtml(formatMoney(itemCourierPay))}</span>
        <span>${formatDateTime(dateLabel)}</span>
      </div>
    </div>
  `;
  }))).join("");

  document.getElementById("calendarResults").innerHTML = `
    <div class="history-summary">
      <strong>${dateKey}</strong>
      <div class="history-metrics">
        <span><b>${delivered}</b> ჩაბარდა</span>
        <span><b>${failed}</b> არ ჩაბარდა</span>
        <span><b>${escapeHtml(formatMoney(outstandingCash))}</b> ჩასაბარებელი ქეში</span>
        <span><b>${escapeHtml(formatMoney(basePay))}</b> საბაზისო გამომუშავება</span>
        <span><b>${escapeHtml(formatMoney(payAdjustment))}</b> კორექტირება</span>
        <span><b>${escapeHtml(formatMoney(courierPay))}</b> საბოლოო გამომუშავება</span>
      </div>
    </div>
    <div class="history-list">${rows || "<p class=\"history-empty\">ამ თარიღზე დახურული ამანათი არ არის.</p>"}</div>
  `;
}


async function confirmEndDay() {
  const pins = await getPins(state.currentUser);
  const deliveredPins = pins.filter(isCompletedParcelStatus);
  const todayKey = toDateKey(new Date());
  const summary = calculateFinanceSummary({ records: deliveredPins }, { username: state.currentUser, startDate: todayKey, endDate: todayKey });
  const companyTotal = summary.cashReceived;
  const basePay = summary.basePay;
  const courierPay = summary.finalPay;
  const payAdjustment = summary.adjustmentTotal;
  showDialog("დღის დახურვა", `<p>ისტორიაში გადავიდეს მხოლოდ ჩაბარებული ამანათები?</p><div class="stats-card">ქეში: <strong>${formatMoney(companyTotal)}</strong></div><div class="stats-card">საბაზისო გამომუშავება: <strong>${formatMoney(basePay)}</strong></div><div class="stats-card">კორექტირება: <strong>${formatMoney(payAdjustment)}</strong></div><div class="stats-card">საბოლოო გამომუშავება: <strong>${formatMoney(courierPay)}</strong></div>`, [
    { label: "დახურვა", variant: "primary", action: archiveDay },
    { label: "გაუქმება", variant: "secondary", action: closeDialog },
  ]);
}


async function archiveDay() {
  const pins = await getPins(state.currentUser);
  const deliveredPins = pins.filter(isCompletedParcelStatus);
  if (!deliveredPins.length) {
    closeDialog();
    showToast("ჩაბარებული ამანათი არ არის.");
    return;
  }
  const todayKey = toDateKey(new Date());
  const summary = calculateFinanceSummary({ records: deliveredPins }, { username: state.currentUser, startDate: todayKey, endDate: todayKey });
  const companyTotal = summary.cashReceived;
  const courierPay = summary.finalPay;

  await api("/api/parcels/archive", {
    method: "POST",
    body: {
      courierUsername: state.currentUser,
      status: "delivered",
      parcelIds: deliveredPins.map((pin) => pin.id),
    },
  });
  closeDialog();
  await refreshPins();
  showToast(`${STRINGS.dayArchived} ქეში: ${formatMoney(companyTotal)}, კურიერის გამომუშავება: ${formatMoney(courierPay)}`);
}


async function calculateStats(username, sinceDate) {
  const active = await getPins(username);
  const history = await getHistory(username);
  const allRecords = [...active, ...history];
  const records = [...active, ...history]
    .filter((pin) => new Date(pin.completedAt || pin.archivedAt || pin.createdAt) >= sinceDate);
  const delivered = records.filter((pin) => pin.status === "delivered").length;
  const failed = records.filter((pin) => pin.status === "failed").length;
  const pending = records.filter((pin) => pin.status === "pending").length;
  const startDate = toDateKey(sinceDate);
  const endDate = toDateKey(new Date());
  const summary = calculateFinanceSummary({ records: allRecords }, { username, startDate, endDate });
  return { delivered, failed, pending, companyTotal: summary.totalOrdersAmount, outstandingCash: summary.cashReceived, courierPay: summary.finalPay, records };
}


async function renderParcelHistoryResults(parcels) {
  const summary = document.getElementById("parcelHistorySummary");
  const results = document.getElementById("parcelHistoryResults");
  if (summary) summary.innerHTML = renderParcelHistorySummary(parcels);
  if (!results) return;
  if (!parcels.length) {
    results.innerHTML = "<div class=\"history-empty history-empty-card\">ამანათი ვერ მოიძებნა</div>";
    return;
  }
  results.innerHTML = (await Promise.all(parcels.map(renderParcelHistoryCard))).join("");
}


async function renderParcelHistoryCard(item) {
  const payment = getPaymentAmount(item);
  const address = await resolveParcelAddress(item);
  const courierPay = getCourierPay(item);
  const deliveredAt = item.deliveredAt || (item.status === "delivered" ? item.completedAt : "");
  const failedAt = item.failedAt || (item.status === "failed" ? item.completedAt : "");
  const statusChangedAt = item.updatedAt || item.completedAt || "";
  const failureReason = parcelFailureReason(item);
  const canFocusMap = Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
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
        ${historyDetail("კურიერის ლოგინი", item.courierUsername || "მიუბმელი")}
        ${historyDetail("კურიერი", parcelCourierDisplayName(item))}
        ${historyDetail("კურიერის ტელეფონი", parcelCourierPhone(item) || "არ არის")}
        ${historyDetail("შექმნა", formatOptionalDateTime(item.createdAt))}
        ${historyDetail("მიბმა", formatOptionalDateTime(item.assignedAt))}
        ${historyDetail("სტატუსის ცვლილება", formatOptionalDateTime(statusChangedAt))}
        ${historyDetail("ზუსტი მიტანის დრო", formatOptionalDateTime(deliveredAt))}
        ${historyDetail("ვერ ჩაბარდა", formatOptionalDateTime(failedAt))}
        ${historyDetail("ქეში", payment > 0 ? formatMoney(payment) : "არ აქვს")}
        ${historyDetail("კურიერის ანაზღაურება", formatMoney(courierPay))}
        ${historyDetail("ზონა", item.zoneId || item.zoneName ? `${parcelZoneLabel(item)}${item.zoneId ? ` (${item.zoneId})` : ""}` : "არ არის")}
        ${historyDetail("მიბმის ტიპი", parcelAutoAssignLabel(item))}
      </div>
      ${item.status === "failed" && failureReason ? `<div class="parcel-history-note"><span>მიზეზი</span><strong>${escapeHtml(failureReason)}</strong></div>` : ""}
      <div class="parcel-history-actions">
        <span>${item.archivedAt ? `ისტორიაშია: ${escapeHtml(formatDateTime(item.archivedAt))}` : "აქტიურია"}</span>
        ${canFocusMap ? `<button class="mini-button" type="button" data-action="focusHistoryParcel" data-value="${escapeAttr(item.id)}">რუკაზე ნახვა</button>` : ""}
      </div>
    </article>
  `;
}


function renderParcelHistorySummary(parcels) {
  const delivered = parcels.filter((item) => item.status === "delivered").length;
  const failed = parcels.filter((item) => item.status === "failed").length;
  const dateKeys = parcels.flatMap(getParcelStatsDateKeys).filter(Boolean).sort();
  const rangeStart = dateKeys[0] || toDateKey(new Date());
  const rangeEnd = dateKeys[dateKeys.length - 1] || rangeStart;
  const courierUsernames = [...new Set(parcels.map((item) => normalizeUsername(item.courierUsername)).filter(Boolean))];
  const summaries = courierUsernames.map((username) => calculateFinanceSummary({ records: parcels }, { username, startDate: rangeStart, endDate: rangeEnd }));
  const outstandingCash = summaries.reduce((sum, summary) => sum + summary.cashReceived, 0);
  const basePay = summaries.reduce((sum, summary) => sum + summary.basePay, 0);
  const courierPay = summaries.reduce((sum, summary) => sum + summary.finalPay, 0);
  const payAdjustment = summaries.reduce((sum, summary) => sum + summary.adjustmentTotal, 0);
  return `
    <div class="parcel-history-summary-item"><span>სულ</span><strong>${parcels.length}</strong></div>
    <div class="parcel-history-summary-item"><span>ჩაბარებული</span><strong>${delivered}</strong></div>
    <div class="parcel-history-summary-item"><span>არ ჩაბარებული</span><strong>${failed}</strong></div>
    <div class="parcel-history-summary-item"><span>ჩასაბარებელი ქეში</span><strong>${escapeHtml(formatMoney(outstandingCash))}</strong></div>
    <div class="parcel-history-summary-item"><span>საბაზისო გამომუშავება</span><strong>${escapeHtml(formatMoney(basePay))}</strong></div>
    <div class="parcel-history-summary-item"><span>კორექტირება</span><strong>${escapeHtml(formatMoney(payAdjustment))}</strong></div>
    <div class="parcel-history-summary-item"><span>საბოლოო გამომუშავება</span><strong>${escapeHtml(formatMoney(courierPay))}</strong></div>
  `;
}


function historyDetail(label, value) {
  return `
    <div class="parcel-history-detail">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "არ არის")}</strong>
    </div>
  `;
}


function parcelMatchesHistoryFilters(parcel, filters) {
  if (filters.status && parcel.status !== filters.status) return false;
  if (filters.courier && normalizeUsername(parcel.courierUsername) !== normalizeUsername(filters.courier)) return false;
  if (filters.date && !parcelMatchesDate(parcel, filters.date)) return false;
  return true;
}


function parcelMatchesDate(parcel, dateKey) {
  return [parcel.createdAt, parcel.assignedAt, parcel.completedAt, parcel.deliveredAt, parcel.failedAt, parcel.updatedAt, parcel.archivedAt]
    .some((value) => toDateKey(new Date(value)) === dateKey);
}


function formatOptionalDateTime(value) {
  return value ? formatDateTime(value) : "არ არის";
}


function focusHistoryParcelOnMap(parcelId) {
  const parcel = state.historySearchResults.find((item) => item.id === parcelId);
  if (!parcel) return;
  closeDialog();
  const activePin = state.activePins.find((item) => item.id === parcelId);
  if (activePin) {
    openParcelTab(activePin.id, { focus: true });
    return;
  }
  clearHistoryPreviewMarker();
  setMapView(parcel, 17);
  if (!state.map || !window.L) return;
  const marker = L.layerGroup().addTo(state.map);
  L.circleMarker(toLeafletLatLng(parcel), {
    radius: 11,
    fillColor: getStatusColor(parcel.status),
    fillOpacity: 0.95,
    color: "#fff",
    weight: 2,
  }).addTo(marker);
  L.marker(toLeafletLatLng(parcel), {
    icon: L.divIcon({
      className: "pin-label-icon",
      html: `<div class="pin-label-card"><strong>${escapeHtml(parcel.fullName || "")}</strong><span>${escapeHtml(parcelZoneLabel(parcel))}</span><span>${escapeHtml(getStatusLabel(parcel.status))}</span></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
  }).addTo(marker);
  state.historyPreviewMarker = marker;
}


function clearHistoryPreviewMarker() {
  clearMapObject(state.historyPreviewMarker);
  state.historyPreviewMarker = null;
}


async function renderParcelHistoryRow(item) {
  return renderParcelHistoryCard(item);
}
