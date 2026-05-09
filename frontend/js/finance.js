"use strict";



function createFinanceEntryId(prefix = "finance") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


function getAdjustmentSignedAmount(adjustment) {
  const value = adjustment?.delta ?? adjustment?.amount ?? 0;
  return safeMoney(value);
}


function getAdjustmentDateKey(adjustment) {
  return normalizeDateKey(
    adjustment?.date
      || adjustment?.dateKey
      || adjustment?.startDate
      || adjustment?.timestamp
      || adjustment?.updatedAt
      || adjustment?.createdAt,
  );
}


function getAdjustmentTimestamp(adjustment) {
  return adjustment?.timestamp || adjustment?.updatedAt || adjustment?.createdAt || new Date().toISOString();
}


function getStableAdjustmentId(adjustment, category, index = 0) {
  if (adjustment?.id) return String(adjustment.id);
  return [
    category,
    normalizeUsername(adjustment?.courierId || adjustment?.username),
    getAdjustmentDateKey(adjustment),
    getAdjustmentTimestamp(adjustment),
    getAdjustmentSignedAmount(adjustment),
    safeMoney(adjustment?.targetAmount),
    index,
  ].map((part) => String(part || "").replace(/\W+/g, "_")).join("-");
}


function normalizeFinanceAdjustment(adjustment, category = "pay", index = 0) {
  if (!adjustment || typeof adjustment !== "object") return null;
  const dateKey = getAdjustmentDateKey(adjustment) || toDateKey(new Date());
  const delta = getAdjustmentSignedAmount(adjustment);
  const timestamp = getAdjustmentTimestamp(adjustment);
  const courierId = adjustment.courierId || adjustment.username || "";
  return {
    ...adjustment,
    id: getStableAdjustmentId(adjustment, category, index),
    username: adjustment.username || courierId,
    courierId,
    date: dateKey,
    dateKey,
    startDate: normalizeDateKey(adjustment.startDate) || dateKey,
    endDate: normalizeDateKey(adjustment.endDate) || normalizeDateKey(adjustment.startDate) || dateKey,
    amount: delta,
    delta,
    type: delta < 0 ? "negative" : "positive",
    category: adjustment.category || category,
    note: adjustment.note || "",
    timestamp,
    createdAt: adjustment.createdAt || timestamp,
  };
}


function normalizeFinanceAdjustmentList(adjustments, category = "pay") {
  const seen = new Set();
  return (Array.isArray(adjustments) ? adjustments : [])
    .map((item, index) => normalizeFinanceAdjustment(item, category, index))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}


function getFinanceSummaryRange(records, adjustments, filters = {}) {
  if (filters.includeAllDates) {
    const dates = [
      ...(Array.isArray(records) ? records : []).map(getParcelStatsDateKey),
      ...(Array.isArray(adjustments) ? adjustments : []).map(getAdjustmentDateKey),
    ].filter(Boolean).sort();
    return {
      start: dates[0] || toDateKey(new Date()),
      end: dates[dates.length - 1] || dates[0] || toDateKey(new Date()),
    };
  }
  return normalizeDateRange(filters.startDate || filters.start || filters.dateKey, filters.endDate || filters.end || filters.dateKey);
}


function filterAdjustmentsForSummary(adjustments, username, start, end, includeAllDates = false) {
  const normalizedUsername = normalizeUsername(username);
  return (Array.isArray(adjustments) ? adjustments : []).filter((item) => {
    if (normalizedUsername && normalizeUsername(item.courierId || item.username) !== normalizedUsername) return false;
    if (includeAllDates) return true;
    const dateKey = getAdjustmentDateKey(item);
    return dateKey >= start && dateKey <= end;
  });
}


function calculateFinanceSummary(data = {}, filters = {}) {
  const records = Array.isArray(data.records) ? data.records.slice() : [];
  const username = filters.username || filters.courierId || filters.courierUsername || "";
  const normalizedUsername = normalizeUsername(username);
  const payAdjustments = normalizeFinanceAdjustmentList(data.payAdjustments || readPayAdjustments(), "pay");
  const cashAdjustments = normalizeFinanceAdjustmentList(data.cashAdjustments || readCashAdjustments(), "cash");
  const range = getFinanceSummaryRange(records, [...payAdjustments, ...cashAdjustments], filters);

  const userRecords = normalizedUsername
    ? records.filter((parcel) => normalizeUsername(parcel?.courierUsername) === normalizedUsername)
    : records.slice();
  const filteredRecords = filters.includeAllDates
    ? userRecords
    : userRecords.filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const deliveredRecords = getDeliveredParcels(filteredRecords);
  const filteredPayAdjustments = filterAdjustmentsForSummary(payAdjustments, username, range.start, range.end, filters.includeAllDates);
  const filteredCashAdjustments = filterAdjustmentsForSummary(cashAdjustments, username, range.start, range.end, filters.includeAllDates);
  const payAdjustmentTotal = sumPayAdjustments(filteredPayAdjustments);
  const cashAdjustmentTotal = sumCashAdjustments(filteredCashAdjustments);
  const allCorrections = [...filteredPayAdjustments, ...filteredCashAdjustments].map(getAdjustmentSignedAmount);
  const positiveCorrections = allCorrections.filter((amount) => amount > 0).reduce((sum, amount) => sum + amount, 0);
  const negativeCorrections = Math.abs(allCorrections.filter((amount) => amount < 0).reduce((sum, amount) => sum + amount, 0));
  const totalOrdersAmount = sumPayments(deliveredRecords);
  const deliveryFees = sumDeliveryTotals(deliveredRecords);
  const courierBasePay = sumCourierPay(deliveredRecords);
  const adminProfit = sumAdminProfit(deliveredRecords);
  const cashReceived = safeMoney(totalOrdersAmount + cashAdjustmentTotal);
  const finalPay = safeMoney(courierBasePay + payAdjustmentTotal);
  const finalTotal = safeMoney(totalOrdersAmount + deliveryFees + cashReceived + positiveCorrections - negativeCorrections);

  const summary = {
    range,
    username,
    records: filteredRecords,
    deliveredRecords,
    payAdjustments: filteredPayAdjustments,
    cashAdjustments: filteredCashAdjustments,
    totalOrdersAmount,
    deliveryFees,
    cashReceived,
    positiveCorrections,
    negativeCorrections,
    finalTotal,
    delivered: deliveredRecords.length,
    failed: filteredRecords.filter((parcel) => parcel?.status === "failed").length,
    pending: filteredRecords.filter((parcel) => parcel?.status === "pending").length,
    basePay: courierBasePay,
    courierBasePay,
    adjustmentTotal: payAdjustmentTotal,
    payAdjustmentTotal,
    cashAdjustmentTotal,
    finalPay,
    adminProfit,
    filteredOrdersCount: filteredRecords.length,
    correctionsCount: filteredPayAdjustments.length + filteredCashAdjustments.length,
  };

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[finance summary]", {
      username: normalizedUsername || "all",
      startDate: range.start,
      endDate: range.end,
      filteredOrdersCount: summary.filteredOrdersCount,
      correctionsCount: summary.correctionsCount,
      totalOrdersAmount: summary.totalOrdersAmount,
      deliveryFees: summary.deliveryFees,
      cashReceived: summary.cashReceived,
      positiveCorrections: summary.positiveCorrections,
      negativeCorrections: summary.negativeCorrections,
      finalPay: summary.finalPay,
      finalTotal: summary.finalTotal,
    });
  }

  return summary;
}


function readCashAdjustments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG.cashAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "cash");
  } catch {
    return [];
  }
}


function writeCashAdjustments(adjustments) {
  localStorage.setItem(CONFIG.cashAdjustmentsStorageKey, JSON.stringify(normalizeFinanceAdjustmentList(adjustments, "cash")));
}


function getCashAdjustmentsForCourier(username) {
  const normalizedUsername = normalizeUsername(username);
  return readCashAdjustments().filter((item) => normalizeUsername(item.username) === normalizedUsername);
}


function getCashAdjustmentsForDate(dateKey) {
  return readCashAdjustments().filter((item) => getAdjustmentDateKey(item) === normalizeDateKey(dateKey));
}


function getCashAdjustmentsForMonth(monthKey) {
  return readCashAdjustments().filter((item) => getAdjustmentDateKey(item).startsWith(monthKey));
}


function sumCashAdjustments(adjustments) {
  return safeMoney((Array.isArray(adjustments) ? adjustments : []).reduce((total, item) => total + getAdjustmentSignedAmount(item), 0));
}


function getCourierOutstandingCash(username, allRecords) {
  return calculateFinanceSummary({ records: allRecords }, { username, includeAllDates: true }).cashReceived;
}


async function getAllFinanceRecords() {
  const [pins, history] = await Promise.all([
    getPins(""),
    getHistory(""),
  ]);
  return [...pins, ...history];
}


function readPayAdjustments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG.payAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "pay");
  } catch {
    return [];
  }
}


function writePayAdjustments(adjustments) {
  localStorage.setItem(CONFIG.payAdjustmentsStorageKey, JSON.stringify(normalizeFinanceAdjustmentList(adjustments, "pay")));
}


function getPayAdjustmentsForCourier(username) {
  const normalizedUsername = normalizeUsername(username);
  return readPayAdjustments().filter((item) => normalizeUsername(item.username) === normalizedUsername);
}


function getPayAdjustmentsForDate(dateKey) {
  return readPayAdjustments().filter((item) => getAdjustmentDateKey(item) === normalizeDateKey(dateKey));
}


function sumPayAdjustments(adjustments) {
  return safeMoney((Array.isArray(adjustments) ? adjustments : []).reduce((total, item) => total + getAdjustmentSignedAmount(item), 0));
}


function adjustmentMatchesDateRange(adjustment, start, end) {
  const dateKey = getAdjustmentDateKey(adjustment);
  const range = normalizeDateRange(start, end);
  return Boolean(dateKey) && dateKey >= range.start && dateKey <= range.end;
}


function getPayAdjustmentRangeKey(username, start, end) {
  return [
    normalizeUsername(username),
    String(start || ""),
    String(end || ""),
  ].join("|");
}


function getPayAdjustmentCreatedAt(adjustment) {
  return adjustment?.timestamp || adjustment?.updatedAt || adjustment?.createdAt || "";
}


function normalizePayAdjustment(adjustment) {
  return normalizeFinanceAdjustment(adjustment, "pay");
}


function dedupePayAdjustments(adjustments) {
  return normalizeFinanceAdjustmentList(adjustments, "pay");
}


function getCashAdjustmentsForRange(start, end) {
  return readCashAdjustments().filter((item) => adjustmentMatchesDateRange(item, start, end));
}


function getPayAdjustmentsForRange(start, end) {
  return readPayAdjustments().filter((item) => adjustmentMatchesDateRange(item, start, end));
}


function getCourierPayBreakdown(records, username, startDate, endDate) {
  const summary = calculateFinanceSummary({ records }, { username, startDate, endDate });
  return {
    basePay: summary.basePay,
    adjustmentTotal: summary.adjustmentTotal,
    finalPay: summary.finalPay,
  };
}


function getCourierPayAdjustments(username, startDate, endDate) {
  return getPayAdjustmentsForRange(startDate, endDate)
    .filter((item) => normalizeUsername(item.username) === normalizeUsername(username))
    .sort((a, b) => new Date(getPayAdjustmentCreatedAt(b)).getTime() - new Date(getPayAdjustmentCreatedAt(a)).getTime());
}


function renderFinanceSummaryItem({ className = "", icon = "", label = "", value = "" }) {
  const systemClass = className.includes("finance-summary-item--hero")
    ? "finance-hero-card"
    : "finance-mini-card";
  return `
    <div class="finance-card finance-summary-item ${systemClass} ${escapeAttr(className)}">
      <span class="finance-summary-icon" aria-hidden="true">${escapeHtml(icon)}</span>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}


function renderFinanceModalLayout({ header = "", filters = "", summary = "", content = "", footer = "" }) {
  return `
    <div class="finance-modal finance-panel">
      <section class="modal-header finance-modal-header">${header}</section>
      <section class="modal-filters finance-modal-filters">${filters}</section>
      <section class="modal-summary-grid finance-modal-summary-grid">${summary}</section>
      <section class="modal-content-sections finance-modal-content-sections">
        ${content}
      </section>
      <section class="modal-footer finance-modal-footer">${footer}</section>
    </div>
  `;
}


function isFinanceMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)")?.matches;
}


function renderFinanceCollapsibleSection({ title, subtitle = "", badge = "", className = "", content = "", collapseOnMobile = false }) {
  const isOpen = !(collapseOnMobile && isFinanceMobileViewport());
  return `
    <details class="finance-section finance-collapsible ${escapeAttr(className)}" ${isOpen ? "open" : ""}>
      <summary class="finance-collapsible-head">
        <span class="finance-collapsible-title">
          <strong>${escapeHtml(title)}</strong>
          ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
        </span>
        ${badge ? `<span class="finance-tag finance-collapsible-badge">${escapeHtml(badge)}</span>` : ""}
        <span class="finance-collapsible-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="finance-collapsible-content">
        ${content}
      </div>
    </details>
  `;
}


function getFinanceLastSevenDayStats(records) {
  const today = new Date();
  const dayKeys = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return toDateKey(date);
  });
  const daySet = new Set(dayKeys);
  const days = dayKeys.map((dateKey) => ({
    dateKey,
    label: dateKey.slice(5),
    total: 0,
    delivered: 0,
    income: 0,
  }));
  const dayMap = new Map(days.map((day) => [day.dateKey, day]));

  (Array.isArray(records) ? records : []).forEach((parcel) => {
    const dateKeys = typeof getParcelStatsDateKeys === "function" ? getParcelStatsDateKeys(parcel) : [];
    const dateKey = dateKeys.find((key) => daySet.has(key));
    if (!dateKey) return;

    const day = dayMap.get(dateKey);
    day.total += 1;
    if (parcel?.status === "delivered") {
      day.delivered += 1;
      day.income += getPaymentAmount(parcel);
    }
  });

  const delivered = days.reduce((total, day) => total + day.delivered, 0);
  const total = days.reduce((sum, day) => sum + day.total, 0);
  const income = days.reduce((sum, day) => sum + day.income, 0);

  return {
    days,
    avgParcelIncome: delivered ? income / delivered : 0,
    parcelsPerDay: delivered / 7,
    efficiency: total ? Math.round((delivered / total) * 100) : 0,
  };
}


function renderFinanceAnalyticsSection(records) {
  const stats = getFinanceLastSevenDayStats(records);
  const maxDelivered = Math.max(1, ...stats.days.map((day) => day.delivered));

  const content = `
    <section class="finance-section finance-analytics-panel" aria-label="ბოლო 7 დღის ფინანსური ანალიტიკა">
      <div class="finance-analytics-bars">
        ${stats.days.map((day) => {
          const height = Math.max(10, Math.round((day.delivered / maxDelivered) * 100));
          const isToday = day.dateKey === toDateKey(new Date());
          const tooltip = `${day.dateKey}: ${day.delivered} ჩაბარებული, ${formatMoney(day.income)}`;
          return `
            <div class="finance-analytics-bar ${isToday ? "is-active" : ""}" tabindex="0" data-tooltip="${escapeAttr(tooltip)}" aria-label="${escapeAttr(tooltip)}">
              <span style="--bar-height: ${height}%"></span>
              <small>${escapeHtml(day.label)}</small>
            </div>
          `;
        }).join("")}
      </div>
      <div class="finance-analytics-stats">
        <div class="finance-card finance-mini-card"><span>საშ. ამანათის შემოსავალი</span><strong>${escapeHtml(formatMoney(stats.avgParcelIncome))}</strong></div>
        <div class="finance-card finance-mini-card"><span>ამანათი დღეში</span><strong>${escapeHtml(stats.parcelsPerDay.toFixed(1))}</strong></div>
        <div class="finance-card finance-mini-card"><span>ეფექტურობა</span><strong>${escapeHtml(`${stats.efficiency}%`)}</strong></div>
      </div>
    </section>
  `;

  return renderFinanceCollapsibleSection({
    title: "ბოლო 7 დღე",
    subtitle: "მინი სტატისტიკა",
    badge: `${stats.efficiency}%`,
    className: "finance-collapsible--analytics",
    content,
    collapseOnMobile: true,
  });
}


function renderFinanceAdjustmentHistorySection(username, startDate, endDate) {
  const adjustments = getCourierPayAdjustments(username, startDate, endDate).slice(0, 6);
  const content = `
    <section class="finance-section finance-adjustments-panel">
      <div class="finance-adjustments-list">
        ${adjustments.length ? adjustments.map((adjustment) => `
          <article class="finance-card finance-mini-card finance-adjustment-row">
            <span class="finance-tag finance-adjustment-badge ${Number(adjustment.delta) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatMoney(Number(adjustment.delta) || 0))}</span>
            <div class="finance-adjustment-main">
              <strong>${escapeHtml(formatMoney(Number(adjustment.targetAmount) || 0))}</strong>
              <small>${escapeHtml(formatDateTime(adjustment.updatedAt || adjustment.createdAt))}</small>
            </div>
            <small class="finance-adjustment-range">${escapeHtml(formatDateRangeLabel(adjustment.startDate || startDate, adjustment.endDate || endDate))}</small>
          </article>
        `).join("") : `<div class="history-empty history-empty-card finance-empty-state">კორექტირებები ჯერ არ არის დამატებული</div>`}
      </div>
    </section>
  `;

  return renderFinanceCollapsibleSection({
    title: "ბოლო კორექტირებები",
    subtitle: "შენახული ცვლილებები და დრო",
    badge: String(adjustments.length),
    className: "finance-collapsible--adjustments",
    content,
  });
}


let payAdjustmentSaveLock = false;


function getFinanceCourierRange() {
  const today = toDateKey(new Date());
  const start = state.financeRangeStart || state.financeDate || today;
  const end = state.financeRangeEnd || start;
  return normalizeDateRange(start, end);
}


function setFinanceCourierRange(start, end) {
  const range = normalizeDateRange(start, end);
  state.financeRangeStart = range.start;
  state.financeRangeEnd = range.end;
  state.financeDate = range.start;
}


function getCourierStatsRange() {
  const today = toDateKey(new Date());
  const start = state.courierStats.rangeStart || state.courierStats.selectedDate || today;
  const end = state.courierStats.rangeEnd || start;
  return normalizeDateRange(start, end);
}


function setCourierStatsRange(start, end) {
  const range = normalizeDateRange(start, end);
  state.courierStats.rangeStart = range.start;
  state.courierStats.rangeEnd = range.end;
  state.courierStats.selectedDate = range.start;
}


function normalizeDateRange(start, end) {
  const today = toDateKey(new Date());
  const normalizedStart = normalizeDateKey(start);
  const normalizedEnd = normalizeDateKey(end);
  const startKey = isDateKey(normalizedStart) ? normalizedStart : today;
  const endKey = isDateKey(normalizedEnd) ? normalizedEnd : startKey;
  return startKey <= endKey
    ? { start: startKey, end: endKey }
    : { start: endKey, end: startKey };
}


function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}


function formatDateRangeLabel(start, end) {
  return start === end ? start : `${start} - ${end}`;
}


function renderDateRangeToolbar({ startId, endId, start, end, applySelector, className = "" }) {
  return `
    <div class="finance-toolbar ${escapeAttr(className)}">
      <label>
        <span>საწყისი თარიღი</span>
        <input class="finance-input" id="${escapeAttr(startId)}" type="date" value="${escapeAttr(start)}" aria-label="საწყისი თარიღი">
      </label>
      <label>
        <span>დასრულების თარიღი</span>
        <input class="finance-input" id="${escapeAttr(endId)}" type="date" value="${escapeAttr(end)}" aria-label="დასრულების თარიღი">
      </label>
      <button class="mini-button finance-button-primary" type="button" ${applySelector}>ნახვა</button>
    </div>
  `;
}


function bindDateRangeToolbar({ startId, endId, applySelector, onApply }) {
  const selector = String(applySelector || "").trim();
  const normalizedSelector = selector.startsWith("[") ? selector : `[${selector.replace(/^\[|\]$/g, "")}]`;
  const root = els.dialogBody || document;
  const applyButton = root.querySelector(normalizedSelector) || document.querySelector(normalizedSelector);

  applyButton?.addEventListener("click", async () => {
    const range = normalizeDateRange(
      document.getElementById(startId)?.value,
      document.getElementById(endId)?.value,
    );
    await onApply(range);
  });
}


async function openFinanceDashboard() {
  if (!state.isAdmin) {
    await openFinanceCourier(state.currentUser);
    return;
  }
  const todayKey = toDateKey(new Date());
  setFinanceCourierRange(todayKey, todayKey);
  const [users, pins, history] = await Promise.all([getUsers(), getPins(""), getHistory("")]);
  const couriers = users.filter((user) => user.role === "courier");
  const records = [...pins, ...history];
  const todaySummary = calculateFinanceSummary({ records }, { startDate: todayKey, endDate: todayKey });
  const totalOutstandingCash = couriers.reduce((sum, courier) => (
    sum + calculateFinanceSummary({ records }, { username: courier.username, startDate: todayKey, endDate: todayKey }).cashReceived
  ), 0);
  const courierCards = couriers.map((courier) => {
    const username = courier.username;
    const courierSummary = calculateFinanceSummary({ records }, { username, startDate: todayKey, endDate: todayKey });
    const cash = courierSummary.cashReceived;
    const pay = courierSummary.finalPay;
    return `
      <button class="finance-card finance-mini-card finance-card--dashboard" type="button" data-action="openFinanceCourier" data-value="${escapeAttr(username)}">
        <span class="finance-summary-icon finance-summary-icon--final" aria-hidden="true">₾</span>
        <span>${escapeHtml(userDisplayName(courier))}</span>
        <strong>${escapeHtml(formatMoney(pay))}</strong>
        <small>ჩასაბარებელი ქეში: ${escapeHtml(formatMoney(cash))}</small>
      </button>
    `;
  }).join("");
  const content = `
      <section class="finance-section finance-card-list finance-card-list--dashboard">
        ${courierCards || "<div class=\"history-empty history-empty-card\">კურიერი ჯერ არ არის დამატებული</div>"}
        <button class="finance-card finance-mini-card finance-card-accent finance-card--cash finance-card--alert" type="button" data-action="openFinanceCash">
          <span class="finance-summary-icon finance-summary-icon--cash" aria-hidden="true">₾</span>
          <span>ჩასაბარებელი ქეში</span>
          <strong>${escapeHtml(formatMoney(totalOutstandingCash))}</strong>
          <small>ქეშის მართვა</small>
        </button>
        <button class="finance-card finance-mini-card finance-card-accent finance-card--final" type="button" data-action="openFinanceAdmin">
          <span class="finance-summary-icon finance-summary-icon--final" aria-hidden="true">₾</span>
          <span>ადმინი</span>
          <strong>${escapeHtml(formatMoney(todaySummary.adminProfit))}</strong>
          <small>დღევანდელი მოგება</small>
        </button>
      </section>
  `;
  const body = renderFinanceModalLayout({ content });
  showDialog("ფინანსები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openFinanceCourier(username) {
  if (!state.isAdmin && normalizeUsername(username) !== normalizeUsername(state.currentUser)) return;
  if (normalizeUsername(state.selectedCourier) !== normalizeUsername(username) && state.activeDialogTitle !== "ფინანსები") {
    const todayKey = toDateKey(new Date());
    setFinanceCourierRange(todayKey, todayKey);
  }
  state.selectedCourier = username;
  const range = getFinanceCourierRange();
  const [users, pins, history] = await Promise.all([
    getUsers().catch(() => []),
    getPins(username),
    getHistory(username),
  ]);
  const courier = users.find((user) => normalizeUsername(user.username) === normalizeUsername(username)) || { username };
  const courierAllRecords = [...pins, ...history];
  const summaryResult = calculateFinanceSummary({ records: courierAllRecords }, { username, startDate: range.start, endDate: range.end });
  const delivered = summaryResult.delivered;
  const { basePay, adjustmentTotal, finalPay } = summaryResult;
  const cash = summaryResult.cashReceived;
  const recentAdjustments = renderFinanceAdjustmentHistorySection(username, range.start, range.end);
  const analytics = renderFinanceAnalyticsSection(courierAllRecords);
  const filters = renderDateRangeToolbar({
    startId: "financeCourierStartDate",
    endId: "financeCourierEndDate",
    start: range.start,
    end: range.end,
    applySelector: "data-finance-range-apply",
    className: "finance-range-toolbar",
  });
  const summary = `
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--final",
          icon: "₾",
          label: "საბოლოო გამომუშავება",
          value: formatMoney(finalPay),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--cash finance-summary-item--alert",
          icon: "₾",
          label: "ჩასაბარებელი ქეში",
          value: formatMoney(cash),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact finance-summary-item--delivered",
          icon: "✓",
          label: "ჩაბარებული",
          value: String(delivered),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact finance-summary-item--adjustment",
          icon: "↺",
          label: "კორექტირება",
          value: formatMoney(adjustmentTotal),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact finance-summary-item--period",
          icon: "◷",
          label: "პერიოდი",
          value: formatDateRangeLabel(range.start, range.end),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact finance-summary-item--base",
          icon: "Σ",
          label: "საბაზისო",
          value: formatMoney(basePay),
        })}
  `;
  const content = `
      ${recentAdjustments}
      ${analytics}
  `;
  const footer = state.isAdmin ? `
        <div class="finance-actions finance-actions--dashboard" aria-label="ფინანსების მოქმედებები">
          <button class="mini-button finance-button-primary finance-action-button" type="button" data-action="adjustCourierCash" data-value="${escapeAttr(username)}">ქეშის გასწორება</button>
          <button class="mini-button finance-button-primary finance-action-button" type="button" data-action="adjustCourierPay" data-value="${escapeAttr(username)}">გამომუშავების გასწორება</button>
        </div>
      ` : "";
  const body = renderFinanceModalLayout({ filters, summary, content, footer });
  showDialog(userDisplayName(courier), body, [
    state.isAdmin ? { label: "უკან", variant: "secondary", action: openFinanceDashboard } : { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  bindDateRangeToolbar({
    startId: "financeCourierStartDate",
    endId: "financeCourierEndDate",
    applySelector: "[data-finance-range-apply]",
    onApply: async (selectedRange) => {
      setFinanceCourierRange(selectedRange.start, selectedRange.end);
      await openFinanceCourier(username);
    },
  });
}


async function openFinanceCash() {
  if (!state.isAdmin) return;
  const [users, records] = await Promise.all([getUsers(), getAllFinanceRecords()]);
  const couriers = users.filter((user) => user.role === "courier");
  const range = getFinanceCourierRange();
  const content = `
      <section class="finance-section finance-card-list finance-card-list--dashboard">
        ${couriers.map((courier) => {
          const username = courier.username;
          const cash = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end }).cashReceived;
          return `
            <article class="finance-card finance-mini-card finance-static-card finance-card--cash finance-card--alert">
              <span class="finance-summary-icon finance-summary-icon--cash" aria-hidden="true">₾</span>
              <span>${escapeHtml(userDisplayName(courier))}</span>
              <small>ჩასაბარებელი ქეში</small>
              <strong>${escapeHtml(formatMoney(cash))}</strong>
              <button class="mini-button finance-button-primary" type="button" data-action="adjustCourierCash" data-value="${escapeAttr(username)}">რედაქტირება</button>
            </article>
          `;
        }).join("") || "<div class=\"history-empty history-empty-card\">კურიერი ჯერ არ არის დამატებული</div>"}
      </section>
  `;
  const body = renderFinanceModalLayout({ content });
  showDialog("ქეში", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
}


async function openFinanceAdmin() {
  if (!state.isAdmin) return;
  const range = getFinanceCourierRange();
  const [pins, history] = await Promise.all([getPins(""), getHistory("")]);
  const allRecords = [...pins, ...history];
  const summaryResult = calculateFinanceSummary({ records: allRecords }, { startDate: range.start, endDate: range.end });
  const delivered = summaryResult.delivered;
  const analytics = renderFinanceAnalyticsSection(allRecords);
  const filters = renderDateRangeToolbar({
    startId: "financeAdminStartDate",
    endId: "financeAdminEndDate",
    start: range.start,
    end: range.end,
    applySelector: "data-finance-admin-range-apply",
    className: "finance-range-toolbar",
  });
  const summary = `
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--accent finance-summary-item--period",
          icon: "◷",
          label: "არჩეული პერიოდი",
          value: formatDateRangeLabel(range.start, range.end),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--final",
          icon: "₾",
          label: "ადმინის მოგება",
          value: formatMoney(summaryResult.adminProfit),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--delivered",
          icon: "✓",
          label: "ჩაბარებული",
          value: String(delivered),
        })}
  `;
  const content = `
      ${analytics}
  `;
  const body = renderFinanceModalLayout({ filters, summary, content });
  showDialog("ადმინი", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
  bindDateRangeToolbar({
    startId: "financeAdminStartDate",
    endId: "financeAdminEndDate",
    applySelector: "[data-finance-admin-range-apply]",
    onApply: async (selectedRange) => {
      setFinanceCourierRange(selectedRange.start, selectedRange.end);
      await openFinanceAdmin();
    },
  });
}


async function openCashAdjustmentDialog(username) {
  if (!state.isAdmin) return;
  const records = await getAllFinanceRecords();
  const range = getFinanceCourierRange();
  const currentCash = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end }).cashReceived;
  const content = `
    <div class="finance-card finance-mini-card finance-section stats-card">
      <strong>${escapeHtml(username)}</strong>
      <span>ამჟამინდელი ჩასაბარებელი ქეში: ${escapeHtml(formatMoney(currentCash))}</span>
    </div>
    <label for="cashAdjustmentAmount">ახალი თანხა</label>
    <input class="finance-input" id="cashAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(String(currentCash))}">
    <p class="form-message" id="cashAdjustmentMessage" role="alert"></p>
  `;
  const body = renderFinanceModalLayout({ content });
  showDialog("ქეშის გასწორება", body, [
    { label: "შენახვა", variant: "primary", action: () => saveCashAdjustment(username) },
    { label: "განულება", variant: "danger", action: () => resetCashAdjustment(username) },
    { label: "უკან", variant: "secondary", action: () => openFinanceCourier(username) },
  ]);
}


async function saveCashAdjustment(username) {
  const message = document.getElementById("cashAdjustmentMessage");
  const value = parsePaymentAmount(document.getElementById("cashAdjustmentAmount")?.value);
  if (!Number.isFinite(value) || value < 0) {
    if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
    return;
  }
  await addCashAdjustment(username, value);
  await openFinanceCourier(username);
}


async function resetCashAdjustment(username) {
  await addCashAdjustment(username, 0);
  await openFinanceCourier(username);
}


async function addCashAdjustment(username, targetAmount) {
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords();
  const currentCash = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end }).cashReceived;
  const dateKey = range.start;
  const now = new Date().toISOString();
  const nextAmount = safeMoney(targetAmount);
  const nextDelta = safeMoney(nextAmount - currentCash);
  if (Math.abs(nextDelta) < 0.005) return;
  const adjustment = {
    id: createFinanceEntryId("cash"),
    username,
    courierId: username,
    amount: nextDelta,
    delta: nextDelta,
    targetAmount: nextAmount,
    type: nextDelta < 0 ? "negative" : "positive",
    category: "cash",
    dateKey,
    date: dateKey,
    startDate: dateKey,
    endDate: range.end,
    note: "cash correction",
    timestamp: now,
    createdAt: now,
  };
  writeCashAdjustments([...readCashAdjustments(), adjustment]);
}


async function openPayAdjustmentDialog(username) {
  if (!state.isAdmin) return;
  const range = getFinanceCourierRange();
  const records = [...await getPins(""), ...await getHistory("")];
  const { basePay, adjustmentTotal, finalPay } = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
  const recentAdjustments = renderFinanceAdjustmentHistorySection(username, range.start, range.end);
  const summary = `
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--accent",
          icon: "◉",
          label: "კურიერი",
          value: username,
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--period",
          icon: "◷",
          label: "პერიოდი",
          value: formatDateRangeLabel(range.start, range.end),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--base",
          icon: "Σ",
          label: "საბაზისო გამომუშავება",
          value: formatMoney(basePay),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--adjustment",
          icon: "↺",
          label: "კორექტირება",
          value: formatMoney(adjustmentTotal),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--final",
          icon: "₾",
          label: "საბოლოო გამომუშავება",
          value: formatMoney(finalPay),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--cash",
          icon: "₾",
          label: "შესაყვანი თანხა",
          value: formatMoney(finalPay),
        })}
  `;
  const content = `
      <section class="finance-section finance-adjustment-panel">
        <label for="payAdjustmentAmount">ახალი თანხა</label>
        <input class="finance-input" id="payAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(String(finalPay))}">
        <p class="form-message" id="payAdjustmentMessage" role="alert"></p>
      </section>
      ${recentAdjustments}
  `;
  const footer = `
        <div class="finance-adjustment-actions">
          <button class="button primary finance-button-primary" type="button" data-action="savePayAdjustment" data-value="${escapeAttr(username)}">შენახვა</button>
          <button class="button danger finance-button-danger" type="button" data-action="resetPayAdjustment" data-value="${escapeAttr(username)}">განულება</button>
        </div>
  `;
  const body = renderFinanceModalLayout({ summary, content, footer });
  showDialog("გამომუშავების გასწორება", body, [
    { label: "უკან", variant: "secondary", action: () => openFinanceCourier(username) },
  ]);
}


async function savePayAdjustment(username) {
  if (payAdjustmentSaveLock) return;
  payAdjustmentSaveLock = true;
  document.querySelectorAll('[data-action="savePayAdjustment"], [data-action="resetPayAdjustment"]').forEach((button) => {
    button.disabled = true;
  });

  const message = document.getElementById("payAdjustmentMessage");
  try {
    const rawValue = document.getElementById("payAdjustmentAmount")?.value ?? "";
    if (!String(rawValue).trim()) {
      if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
      return;
    }
    const value = parsePaymentAmount(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
      return;
    }
    await addPayAdjustment(username, value);
    await openFinanceCourier(username);
  } finally {
    payAdjustmentSaveLock = false;
    document.querySelectorAll('[data-action="savePayAdjustment"], [data-action="resetPayAdjustment"]').forEach((button) => {
      button.disabled = false;
    });
  }
}


async function resetPayAdjustment(username) {
  if (payAdjustmentSaveLock) return;
  payAdjustmentSaveLock = true;
  document.querySelectorAll('[data-action="savePayAdjustment"], [data-action="resetPayAdjustment"]').forEach((button) => {
    button.disabled = true;
  });
  try {
    await addPayAdjustment(username, 0);
    await openFinanceCourier(username);
  } finally {
    payAdjustmentSaveLock = false;
    document.querySelectorAll('[data-action="savePayAdjustment"], [data-action="resetPayAdjustment"]').forEach((button) => {
      button.disabled = false;
    });
  }
}


async function addPayAdjustment(username, targetAmount) {
  const range = getFinanceCourierRange();
  const records = [...await getPins(""), ...await getHistory("")];
  const { finalPay: currentPay } = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
  const nextAmount = safeMoney(targetAmount);
  const nextDelta = safeMoney(nextAmount - currentPay);
  const now = new Date().toISOString();

  if (Math.abs(nextDelta) < 0.005) return;

  const adjustment = {
    id: createFinanceEntryId("pay"),
    username,
    courierId: username,
    amount: nextDelta,
    delta: nextDelta,
    targetAmount: nextAmount,
    type: nextDelta < 0 ? "negative" : "positive",
    category: "pay",
    dateKey: range.start,
    date: range.start,
    startDate: range.start,
    endDate: range.end,
    note: "pay correction",
    timestamp: now,
    createdAt: now,
    updatedAt: now,
  };
  writePayAdjustments([...readPayAdjustments(), adjustment]);
}
