"use strict";



let parcelHistorySearchTimer = null;


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
          <button id="parcelHistoryExport" class="button secondary" type="button">CSV</button>
        </div>
        <div class="parcel-history-filters" aria-label="ამანათის ისტორიის ფილტრები">
          <select id="parcelHistoryStatus">
            <option value="">ყველა</option>
            <option value="delivered">ჩაბარებული</option>
            <option value="failed">არ ჩაბარებული</option>
            <option value="pending">პროცესში</option>
          </select>
          <label class="parcel-history-date-field" for="parcelHistoryDateFrom">
            <span>დან</span>
            <input id="parcelHistoryDateFrom" type="date" aria-label="თარიღიდან">
          </label>
          <label class="parcel-history-date-field" for="parcelHistoryDateTo">
            <span>მდე</span>
            <input id="parcelHistoryDateTo" type="date" aria-label="თარიღამდე">
          </label>
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
  document.getElementById("parcelHistoryQuery")?.addEventListener("input", scheduleParcelHistorySearch);
  document.getElementById("parcelHistoryExport")?.addEventListener("click", exportParcelHistoryCsv);
  ["parcelHistoryStatus", "parcelHistoryDateFrom", "parcelHistoryDateTo", "parcelHistoryCourier"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", searchParcelHistory);
  });
  await searchParcelHistory();
}


function scheduleParcelHistorySearch() {
  window.clearTimeout(parcelHistorySearchTimer);
  parcelHistorySearchTimer = window.setTimeout(searchParcelHistory, 280);
}


async function searchParcelHistory() {
  window.clearTimeout(parcelHistorySearchTimer);
  const query = document.getElementById("parcelHistoryQuery")?.value.trim() || "";
  const status = document.getElementById("parcelHistoryStatus")?.value || "";
  const dateFrom = document.getElementById("parcelHistoryDateFrom")?.value || "";
  const dateTo = document.getElementById("parcelHistoryDateTo")?.value || "";
  const courier = document.getElementById("parcelHistoryCourier")?.value || "";
  const message = document.getElementById("parcelHistoryMessage");
  const results = document.getElementById("parcelHistoryResults");
  if (message) message.textContent = "";
  if (results) results.innerHTML = "<p class=\"history-empty\">ისტორია იტვირთება...</p>";
  try {
    const parcels = (await searchParcels(query))
      .filter((parcel) => parcelMatchesHistoryFilters(parcel, { status, dateFrom, dateTo, courier }))
      .sort(sortParcelHistoryRecords);
    state.historySearchResults = parcels;
    await renderParcelHistoryResults(parcels);
    return parcels;
  } catch {
    state.historySearchResults = [];
    if (message) message.textContent = "ისტორიის ჩატვირთვა ვერ მოხერხდა";
    if (results) results.innerHTML = "<p class=\"history-empty\">ისტორიის ჩატვირთვა ვერ მოხერხდა</p>";
    return [];
  }
}


async function exportParcelHistoryCsv() {
  const button = document.getElementById("parcelHistoryExport");
  const previousLabel = button?.textContent || "CSV";
  if (button) {
    button.disabled = true;
    button.textContent = "მზადდება";
  }

  try {
    const parcels = await searchParcelHistory();
    if (!parcels.length) {
      showToast("საექსპორტო ჩანაწერი არ არის.");
      return;
    }
    downloadCsvFile(getParcelHistoryExportFilename(), buildParcelHistoryCsv(parcels));
    showToast(`CSV ექსპორტი მზადაა: ${parcels.length} ჩანაწერი`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }
}


function buildParcelHistoryCsv(parcels) {
  const headers = [
    "ID",
    "მიმღები",
    "ტელეფონი",
    "მისამართი",
    "სტატუსი",
    "კურიერის ლოგინი",
    "კურიერი",
    "კურიერის ტელეფონი",
    "ზონა",
    "ქეში",
    "კურიერის ანაზღაურება",
    "ადმინის მოგება",
    "შექმნა",
    "მიბმა",
    "ჩაბარდა",
    "ვერ ჩაბარდა",
    "ისტორიაში გადავიდა",
    "მიზეზი",
  ];
  const rows = parcels.map((item) => [
    item.id || "",
    item.fullName || "",
    item.phone || "",
    getParcelExportAddress(item),
    getStatusLabel(item.status),
    item.courierUsername || "მიუბმელი",
    parcelCourierDisplayName(item),
    parcelCourierPhone(item) || "",
    parcelZoneLabel(item),
    getPaymentAmount(item),
    getCourierPay(item),
    getAdminProfit(item),
    formatOptionalDateTime(item.createdAt),
    formatOptionalDateTime(item.assignedAt),
    formatOptionalDateTime(item.deliveredAt || (item.status === "delivered" ? item.completedAt : "")),
    formatOptionalDateTime(item.failedAt || (item.status === "failed" ? item.completedAt : "")),
    formatOptionalDateTime(item.archivedAt),
    parcelFailureReason(item),
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}


function getParcelExportAddress(parcel) {
  const cached = typeof getCachedParcelAddress === "function" ? getCachedParcelAddress(parcel.id) : "";
  const stored = typeof getStoredParcelAddress === "function" ? getStoredParcelAddress(parcel) : "";
  if (stored) return stored;
  if (cached) return cached;
  if (parcel.address) return parcel.address;
  if (Number.isFinite(Number(parcel.lat)) && Number.isFinite(Number(parcel.lng))) return `${Number(parcel.lat).toFixed(6)}, ${Number(parcel.lng).toFixed(6)}`;
  return STRINGS.addressMissing;
}


function escapeCsvCell(value) {
  const text = String(value ?? "").replace(/\r?\n|\r/g, " ");
  return /[",;]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}


function downloadCsvFile(filename, csvText) {
  const blob = new Blob([`\ufeff${csvText}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function getParcelHistoryExportFilename() {
  const dateFrom = document.getElementById("parcelHistoryDateFrom")?.value || "";
  const dateTo = document.getElementById("parcelHistoryDateTo")?.value || "";
  const suffix = [dateFrom, dateTo].filter(Boolean).join("_") || getTodayKey();
  return `amanatebi-history-${suffix}.csv`;
}


async function openCalendar(username, title) {
  state.calendarDate = new Date();
  await renderCalendarDialog(username, title);
}


async function renderCalendarDialog(username, title) {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = formatMonthYear(state.calendarDate);
  const [active, allHistory] = await Promise.all([getPins(username), getHistory(username)]);
  const allRecords = [...active, ...allHistory];
  const rows = [];
  let periodTotal = 0;

  for (let day = daysInMonth; day >= 1; day -= 1) {
    const dateKey = toDateKey(new Date(year, month, day));
    const summary = calculateFinanceSummary({ records: allRecords }, { username, startDate: dateKey, endDate: dateKey });
    if (!summary.records.length) continue;
    const deliveredCount = summary.delivered;
    const totalPay = summary.finalPay;
    const unitPay = deliveredCount ? summary.basePay / deliveredCount : 0;
    periodTotal += totalPay;
    rows.push(`
      <button class="history-ledger-row" type="button" data-action="calendarDay" data-value="${escapeAttr(dateKey)}">
        <span class="history-ledger-date">${escapeHtml(formatHistoryLedgerDate(dateKey))}</span>
        <span class="history-ledger-count">${deliveredCount}</span>
        <span class="history-ledger-unit">${escapeHtml(formatMoney(unitPay))}</span>
        <span class="history-ledger-amount">
          <strong>${escapeHtml(formatMoney(totalPay))}</strong>
          <em>${totalPay > 0 ? "გადახდილია" : "ჩანაწერი"}</em>
        </span>
      </button>
    `);
  }

  const body = `
    <div class="history-ledger-screen">
      <div class="history-ledger-toolbar">
        <button class="calendar-nav-button history-ledger-nav" type="button" data-action="previousMonth" aria-label="წინა თვე">&lt;</button>
        <div class="history-ledger-title">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(monthLabel)}</span>
        </div>
        <button class="calendar-nav-button history-ledger-nav" type="button" data-action="nextMonth" aria-label="შემდეგი თვე">▦</button>
      </div>
      <div class="history-ledger-table" role="table" aria-label="${escapeAttr(title)}">
        <div class="history-ledger-head" role="row">
          <span>თარიღი</span>
          <span>ამანათების რაოდენობა</span>
          <span>1 ამანათის საფასური</span>
          <span>ჯამი თანხა</span>
        </div>
        <div class="history-ledger-body">
          ${rows.join("") || "<div class=\"history-empty history-empty-card\">ამ თვეში ისტორია არ არის.</div>"}
        </div>
      </div>
      <div class="history-ledger-total">
        <span>სულ მიღებული (ამ პერიოდის ჯამი)</span>
        <strong>${escapeHtml(formatMoney(periodTotal))}</strong>
      </div>
      <div id="calendarResults" class="history-results history-ledger-details"></div>
    </div>
  `;

  showDialog(title, body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  els.dialogModal.classList.add("history-dialog");
  bindCalendarActions(username, title);
}


function bindCalendarActions(username, title) {
  els.dialogBody.querySelectorAll("[data-action='previousMonth'], [data-action='nextMonth'], [data-action='calendarDay']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.action === "previousMonth") {
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
        await renderCalendarDialog(username, title);
        return;
      }
      if (button.dataset.action === "nextMonth") {
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
        await renderCalendarDialog(username, title);
        return;
      }
      await renderHistoryForDate(username, button.dataset.value);
    });
  });
}


function formatHistoryLedgerDate(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString("ka-GE", { day: "numeric", month: "long", year: "numeric" });
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
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    const failureReason = parcelFailureReason(item);
    const dateLabel = item.archivedAt || item.completedAt || item.deliveredAt || item.failedAt || item.updatedAt || item.createdAt;
    return `
      <tr>
        <td>${renderAppTableText(item.fullName || "უსახელო მიმღები", item.phone || "ტელეფონი არ არის")}</td>
        <td>${renderAppTableText(address || STRINGS.addressMissing, item.status === "failed" && failureReason ? `მიზეზი: ${failureReason}` : "")}</td>
        <td>${renderAppStatusBadge(item.status, getStatusLabel(item.status))}</td>
        <td>${renderAppTableText(payment > 0 ? formatMoney(payment) : "არ აქვს", `კურიერი: ${formatMoney(itemCourierPay)}`)}</td>
        <td>${escapeHtml(formatDateTime(dateLabel))}</td>
      </tr>
  `;
  })));

  document.getElementById("calendarResults").innerHTML = `
    <div class="history-summary">
      <strong>${dateKey}</strong>
      <div class="history-metrics">
        <span><b>${delivered}</b> ჩაბარდა</span>
        <span><b>${failed}</b> არ ჩაბარდა</span>
        <span><b>${escapeHtml(formatMoney(outstandingCash))}</b> ჩასაბარებელი ქეში</span>
        <span><b>${escapeHtml(formatMoney(basePay))}</b> საბაზისო გამომუშავება</span>
        <span><b>${escapeHtml(formatAdjustmentDisplay(payAdjustment))}</b> ${escapeHtml(getAdjustmentDirectionLabel(payAdjustment))}</span>
        <span><b>${escapeHtml(formatMoney(courierPay))}</b> საბოლოო გამომუშავება</span>
      </div>
    </div>
    ${renderAppListPanel({
      title: "დღის ჩანაწერები",
      badges: [`სულ: ${records.length}`],
      headers: ["მიმღები", "მისამართი", "სტატუსი", "თანხა", "თარიღი"],
      emptyMessage: "ამ თარიღზე დახურული ამანათი არ არის.",
      rows,
    })}
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
  showDialog("დღის დახურვა", `<p>ისტორიაში გადავიდეს მხოლოდ ჩაბარებული ამანათები?</p><div class="stats-card">ქეში: <strong>${formatMoney(companyTotal)}</strong></div><div class="stats-card">საბაზისო გამომუშავება: <strong>${formatMoney(basePay)}</strong></div><div class="stats-card">${getAdjustmentDirectionLabel(payAdjustment)}: <strong>${formatAdjustmentDisplay(payAdjustment)}</strong></div><div class="stats-card">საბოლოო გამომუშავება: <strong>${formatMoney(courierPay)}</strong></div>`, [
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
  const archivedIds = new Set(deliveredPins.map((pin) => pin.id));
  state.activePins = state.activePins.filter((pin) => !archivedIds.has(pin.id));
  if (archivedIds.has(state.selectedPinId)) hideSelectedParcelCard();
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
  results.innerHTML = await renderParcelHistoryTable(parcels);
}


async function renderParcelHistoryTable(parcels) {
  const rows = await Promise.all(parcels.map(renderParcelHistoryTableRow));
  return `
    <div class="partner-table-wrap">
      <table class="partner-order-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>მიმღები</th>
            <th>მისამართი</th>
            <th>კურიერი</th>
            <th>სტატუსი</th>
            <th>ქეში</th>
            <th>თარიღი</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}


async function renderParcelHistoryTableRow(item) {
  const payment = getPaymentAmount(item);
  const address = await resolveParcelAddress(item);
  const courierPay = getCourierPay(item);
  const failureReason = parcelFailureReason(item);
  const canFocusMap = Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
  return `
    <tr>
      <td><span class="partner-tag">${escapeHtml(String(item.id || "").slice(0, 8) || "არ არის")}</span></td>
      <td>
        <strong>${escapeHtml(item.fullName || "უსახელო მიმღები")}</strong>
        <small>${escapeHtml(item.phone || "ტელეფონი არ არის")}</small>
      </td>
      <td>
        <strong>${escapeHtml(address || STRINGS.addressMissing)}</strong>
        ${item.status === "failed" && failureReason ? `<small>მიზეზი: ${escapeHtml(failureReason)}</small>` : ""}
      </td>
      <td>
        <strong>${escapeHtml(parcelCourierDisplayName(item))}</strong>
        <small>${escapeHtml(parcelCourierPhone(item) || item.courierUsername || "მიუბმელი")}</small>
      </td>
      <td><span class="history-status status-${escapeAttr(item.status)}">${escapeHtml(getStatusLabel(item.status))}</span></td>
      <td>
        <strong>${escapeHtml(payment > 0 ? formatMoney(payment) : "არ აქვს")}</strong>
        <small>კურიერი: ${escapeHtml(formatMoney(courierPay))}</small>
      </td>
      <td>${escapeHtml(formatOptionalDateTime(getParcelHistoryDisplayDate(item)))}</td>
      <td>${canFocusMap ? `<button class="mini-button" type="button" data-action="focusHistoryParcel" data-value="${escapeAttr(item.id)}">რუკა</button>` : ""}</td>
    </tr>
  `;
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


function getParcelHistoryDisplayDate(parcel) {
  return parcel.archivedAt || parcel.completedAt || parcel.deliveredAt || parcel.failedAt || parcel.updatedAt || parcel.assignedAt || parcel.createdAt || "";
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
    <div class="parcel-history-summary-item"><span>${escapeHtml(getAdjustmentDirectionLabel(payAdjustment))}</span><strong>${escapeHtml(formatAdjustmentDisplay(payAdjustment))}</strong></div>
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
  if (!parcelMatchesDateRangeFilter(parcel, filters.dateFrom, filters.dateTo)) return false;
  return true;
}


function parcelMatchesDateRangeFilter(parcel, dateFrom, dateTo) {
  const start = normalizeDateKey(dateFrom);
  const end = normalizeDateKey(dateTo);
  if (!start && !end) return true;

  const rangeStart = start && end ? (start <= end ? start : end) : (start || end);
  const rangeEnd = start && end ? (start <= end ? end : start) : (end || start);
  return getParcelHistoryDateKeys(parcel).some((dateKey) => dateKey >= rangeStart && dateKey <= rangeEnd);
}


function getParcelHistoryDateKeys(parcel) {
  return [parcel.createdAt, parcel.assignedAt, parcel.completedAt, parcel.deliveredAt, parcel.failedAt, parcel.updatedAt, parcel.archivedAt]
    .map(normalizeDateKey)
    .filter(Boolean);
}


function sortParcelHistoryRecords(a, b) {
  return getParcelHistorySortTime(b) - getParcelHistorySortTime(a);
}


function getParcelHistorySortTime(parcel) {
  const value = parcel.updatedAt || parcel.completedAt || parcel.deliveredAt || parcel.failedAt || parcel.archivedAt || parcel.assignedAt || parcel.createdAt;
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
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
