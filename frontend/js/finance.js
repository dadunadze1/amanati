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
  const cashReceived = Math.max(0, safeMoney(totalOrdersAmount + cashAdjustmentTotal));
  const finalPay = Math.max(0, safeMoney(courierBasePay + payAdjustmentTotal));
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


function getAdjustmentDirectionLabel(total) {
  const amount = safeMoney(total);
  if (amount > 0) return "მიმატებული";
  return "კორექტირება";
}


function formatAdjustmentDisplay(total) {
  const amount = safeMoney(total);
  return formatMoney(amount > 0 ? amount : 0);
}


function renderAdjustmentModeSelect(id) {
  return `
    <label for="${escapeAttr(id)}">მოქმედება</label>
    <select class="finance-input" id="${escapeAttr(id)}">
      <option value="subtract" selected>ჩამოკლება</option>
      <option value="add">მიმატება</option>
    </select>
  `;
}


function readCashAdjustments() {
  try {
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.cashAdjustmentsStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.cashAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "cash");
  } catch {
    return [];
  }
}


function writeCashAdjustments(adjustments) {
  const normalized = normalizeFinanceAdjustmentList(adjustments, "cash");
  if (typeof saveData === "function") saveData(CONFIG.cashAdjustmentsStorageKey, normalized);
  else localStorage.setItem(CONFIG.cashAdjustmentsStorageKey, JSON.stringify(normalized));
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    saveStaticFinanceData({ ...getStaticFinanceData(), cashAdjustments: normalized });
  }
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
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.payAdjustmentsStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.payAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "pay");
  } catch {
    return [];
  }
}


function writePayAdjustments(adjustments) {
  const normalized = normalizeFinanceAdjustmentList(adjustments, "pay");
  if (typeof saveData === "function") saveData(CONFIG.payAdjustmentsStorageKey, normalized);
  else localStorage.setItem(CONFIG.payAdjustmentsStorageKey, JSON.stringify(normalized));
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    saveStaticFinanceData({ ...getStaticFinanceData(), payAdjustments: normalized });
  }
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


function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${normalizeDateKey(dateKey) || toDateKey(new Date())}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return toDateKey(date);
}


function getPartnerCashAdjustmentsForRange(partner, startDate, endDate) {
  if (typeof getPartnerCashAdjustments !== "function") return [];
  return getPartnerCashAdjustments(partner).filter((adjustment) => adjustmentMatchesDateRange(adjustment, startDate, endDate));
}


function calculatePartnerCashSummaryForRange(partner, records = [], startDate, endDate) {
  if (typeof orderBelongsToPartner !== "function") {
    return {
      orders: [],
      deliveredOrders: [],
      pendingOrders: [],
      baseCash: 0,
      pendingCash: 0,
      adjustmentTotal: 0,
      cashDue: 0,
    };
  }

  const range = normalizeDateRange(startDate, endDate);
  const orders = (Array.isArray(records) ? records : [])
    .filter((order) => orderBelongsToPartner(order, partner))
    .filter((order) => parcelMatchesStatsDateRange(order, range.start, range.end));
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const pendingOrders = orders.filter((order) => order.status !== "delivered" && order.status !== "failed");
  const baseCash = safeMoney(deliveredOrders.reduce((sum, order) => sum + getPaymentAmount(order), 0));
  const pendingCash = safeMoney(pendingOrders.reduce((sum, order) => sum + getPaymentAmount(order), 0));
  const adjustments = getPartnerCashAdjustmentsForRange(partner, range.start, range.end);
  const adjustmentTotal = safeMoney(adjustments.reduce((sum, adjustment) => sum + getAdjustmentSignedAmount(adjustment), 0));

  return {
    orders,
    deliveredOrders,
    pendingOrders,
    adjustments,
    baseCash,
    pendingCash,
    adjustmentTotal,
    cashDue: Math.max(0, safeMoney(baseCash + adjustmentTotal)),
  };
}


function normalizeDailyBalanceEntry(entry = {}) {
  const now = new Date().toISOString();
  const type = ["courier", "partner", "snapshot"].includes(entry.type) ? entry.type : "snapshot";
  return {
    ...entry,
    id: entry.id || createFinanceEntryId("daily-balance"),
    type,
    status: entry.status || (type === "snapshot" ? "saved" : "paid"),
    dateKey: normalizeDateKey(entry.dateKey || entry.rangeStart) || toDateKey(new Date()),
    rangeStart: normalizeDateKey(entry.rangeStart || entry.dateKey) || toDateKey(new Date()),
    rangeEnd: normalizeDateKey(entry.rangeEnd || entry.dateKey || entry.rangeStart) || normalizeDateKey(entry.rangeStart || entry.dateKey) || toDateKey(new Date()),
    username: entry.username || "",
    partnerUsername: entry.partnerUsername || "",
    partnerId: entry.partnerId || "",
    label: entry.label || "",
    amount: safeMoney(entry.amount),
    delivered: Number(entry.delivered || 0),
    payload: entry.payload && typeof entry.payload === "object" ? entry.payload : {},
    note: entry.note || "",
    createdAt: entry.createdAt || now,
    updatedAt: entry.updatedAt || entry.createdAt || now,
  };
}


function readDailyBalanceLedger() {
  try {
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.dailyBalanceLedgerStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.dailyBalanceLedgerStorageKey) || "[]");
    return (Array.isArray(parsed) ? parsed : []).map(normalizeDailyBalanceEntry);
  } catch {
    return [];
  }
}


function writeDailyBalanceLedger(entries) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeDailyBalanceEntry);
  if (typeof saveData === "function") saveData(CONFIG.dailyBalanceLedgerStorageKey, normalized);
  else localStorage.setItem(CONFIG.dailyBalanceLedgerStorageKey, JSON.stringify(normalized));
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    saveStaticFinanceData({ ...getStaticFinanceData(), dailyBalanceLedger: normalized });
  }
  return normalized;
}


async function loadDailyBalanceLedger() {
  try {
    const payload = await api("/api/daily-balance-ledger");
    const entries = (payload.entries || []).map(normalizeDailyBalanceEntry);
    writeDailyBalanceLedger(entries);
    return entries;
  } catch {
    return readDailyBalanceLedger();
  }
}


async function saveDailyBalanceEntry(entry) {
  const normalized = normalizeDailyBalanceEntry(entry);
  try {
    const payload = await api("/api/daily-balance-ledger", { method: "POST", body: normalized });
    const saved = normalizeDailyBalanceEntry(payload.entry || normalized);
    const entries = readDailyBalanceLedger().filter((item) => item.id !== saved.id);
    writeDailyBalanceLedger([...entries, saved]);
    return saved;
  } catch (error) {
    const entries = readDailyBalanceLedger().filter((item) => item.id !== normalized.id);
    writeDailyBalanceLedger([...entries, normalized]);
    return normalized;
  }
}


async function deleteDailyBalanceEntry(id) {
  if (!id) return;
  try {
    await api(`/api/daily-balance-ledger/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    // Local fallback below keeps static/offline mode usable.
  }
  writeDailyBalanceLedger(readDailyBalanceLedger().filter((entry) => entry.id !== id));
}


function createDailyBalanceEntryId(type, range, identity) {
  return ["daily-balance", type, range.start, range.end, normalizeUsername(identity)].join("|");
}


function findDailyBalanceEntry(entries, type, range, identity) {
  const id = createDailyBalanceEntryId(type, range, identity);
  return (Array.isArray(entries) ? entries : []).find((entry) => entry.id === id && entry.status === "paid");
}


function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}


function downloadFinanceCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
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
            <span class="finance-tag finance-adjustment-badge ${Number(adjustment.delta) >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatMoney(Math.abs(Number(adjustment.delta) || 0)))}</span>
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


function renderFinanceListPanel({ title = "", badges = [], headers = [], rows = [] }) {
  return `
    <div class="partner-panel-head">
      <h2>${escapeHtml(title)}</h2>
      <div class="partner-filter-row">
        ${badges.filter(Boolean).map((badge) => `<span class="partner-tag">${escapeHtml(badge)}</span>`).join("")}
      </div>
    </div>
    <div class="partner-table-wrap">
      <table class="partner-order-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    </div>
  `;
}


function renderFinanceTableText(title, subtitle = "") {
  return `
    <strong>${escapeHtml(title || "არ არის")}</strong>
    ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
  `;
}


function renderFinanceTableAction(action, label, value = "", className = "mini-button") {
  return `<button class="${escapeAttr(className)}" type="button" data-action="${escapeAttr(action)}"${value ? ` data-value="${escapeAttr(value)}"` : ""}>${escapeHtml(label)}</button>`;
}


async function openFinanceDashboard() {
  if (!state.isAdmin) {
    await openFinanceCourier(state.currentUser);
    return;
  }
  const todayKey = toDateKey(new Date());
  setFinanceCourierRange(todayKey, todayKey);
  const [users, pins, history, partners, partnerRecords] = await Promise.all([
    getUsers(),
    getPins(""),
    getHistory(""),
    typeof getPartners === "function" ? getPartners().catch(() => []) : [],
    typeof getAllPartnerCashRecords === "function" ? getAllPartnerCashRecords().catch(() => []) : [],
    typeof loadPartnerCashAdjustments === "function" ? loadPartnerCashAdjustments().catch(() => []) : [],
  ]);
  const couriers = users.filter((user) => user.role === "courier");
  const records = [...pins, ...history];
  const todaySummary = calculateFinanceSummary({ records }, { startDate: todayKey, endDate: todayKey });
  const courierSummaries = couriers.map((courier) => calculateFinanceSummary({ records }, { username: courier.username, startDate: todayKey, endDate: todayKey }));
  const totalOutstandingCash = safeMoney(courierSummaries.reduce((sum, summary) => sum + summary.cashReceived, 0));
  const totalCourierPay = safeMoney(courierSummaries.reduce((sum, summary) => sum + summary.finalPay, 0));
  const partnerCashDue = safeMoney((Array.isArray(partners) ? partners : []).reduce((sum, partner) => {
    if (typeof calculatePartnerCashSummary !== "function") return sum;
    return sum + calculatePartnerCashSummary(partner, partnerRecords).cashDue;
  }, 0));
  const closablePins = pins.filter(isCompletedParcelStatus);
  const deliveredToday = pins.filter((pin) => pin.status === "delivered").length;
  const content = renderFinanceListPanel({
    title: "ფინანსური სია",
    badges: [
      `კურიერი: ${couriers.length}`,
      `პარტნიორი: ${partners.length}`,
      `დღეს ჩაბარდა: ${deliveredToday}`,
    ],
    headers: ["განყოფილება", "თანხა / რაოდენობა", "სტატუსი", "აღწერა", ""],
    rows: [
      `
        <tr>
          <td>${renderFinanceTableText("კურიერების ქეში", "კურიერმა კომპანიას უნდა ჩააბაროს")}</td>
          <td>${escapeHtml(formatMoney(totalOutstandingCash))}</td>
          <td><span class="history-status status-pending">ჩასაბარებელი</span></td>
          <td>შეკვეთებიდან დაგროვებული ქეში და კორექტირებები</td>
          <td>${renderFinanceTableAction("openFinanceCash", "ნახვა")}</td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("კურიერის ანაზღაურება", "კომპანიამ კურიერებს უნდა გადაუხადოს")}</td>
          <td>${escapeHtml(formatMoney(totalCourierPay))}</td>
          <td><span class="history-status status-delivered">გადასახდელი</span></td>
          <td>საბაზისო ანაზღაურება და ხელფასის კორექტირებები</td>
          <td>${renderFinanceTableAction("openFinanceCourierPay", "ნახვა")}</td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("პარტნიორის ქეში", "ობიექტების კომპანიისთვის მისაცემი ქეში")}</td>
          <td>${escapeHtml(formatMoney(partnerCashDue))}</td>
          <td><span class="history-status status-pending">ჩასაბარებელი</span></td>
          <td>პარტნიორების ჩაბარებული შეკვეთები, მოლოდინი და კორექტირებები</td>
          <td>${renderFinanceTableAction("openFinancePartnerCash", "ნახვა")}</td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("დღიური ბალანსი", "კალენდრით დათვლა")}</td>
          <td>${escapeHtml(formatMoney(todaySummary.adminProfit))}</td>
          <td><span class="history-status status-delivered">მოგება</span></td>
          <td>კურიერი, პარტნიორი, snapshot, CSV და გადახდილად მონიშვნა</td>
          <td>${renderFinanceTableAction("adminDailyBalance", "ნახვა")}</td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("დღის დახურვა / ისტორია", `${deliveredToday} ჩაბარებული`)}</td>
          <td>${escapeHtml(String(closablePins.length))}</td>
          <td><span class="history-status status-delivered">დასახური</span></td>
          <td>დასრულებული ამანათების ისტორიაში გადატანა</td>
          <td>${renderFinanceTableAction("openFinanceDayClose", "ნახვა")}</td>
        </tr>
      `,
    ],
  });
  const body = renderFinanceModalLayout({ content });
  showDialog("ფინანსები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openAdminDailyBalance(startDate = state.financeRangeStart || state.financeDate || toDateKey(new Date()), endDate = state.financeRangeEnd || startDate) {
  if (!state.isAdmin) return;
  const range = normalizeDateRange(startDate, endDate);
  state.financeDate = range.start;
  setFinanceCourierRange(range.start, range.end);

  const [users, records, partners, partnerRecords, ledger] = await Promise.all([
    getUsers().catch(() => []),
    getAllFinanceRecords(),
    typeof getPartners === "function" ? getPartners().catch(() => []) : [],
    typeof getAllPartnerCashRecords === "function" ? getAllPartnerCashRecords().catch(() => []) : getAllFinanceRecords(),
    (async () => {
      if (typeof loadPartnerCashAdjustments === "function") await loadPartnerCashAdjustments().catch(() => []);
      return loadDailyBalanceLedger();
    })(),
  ]);

  const couriers = users.filter((user) => user.role === "courier");
  const courierSummaries = couriers.map((courier) => ({
    courier,
    summary: calculateFinanceSummary({ records }, { username: courier.username, startDate: range.start, endDate: range.end }),
  }));
  const partnerSummaries = (Array.isArray(partners) ? partners : []).map((partner) => ({
    partner,
    summary: calculatePartnerCashSummaryForRange(partner, partnerRecords, range.start, range.end),
  }));
  const daySummary = calculateFinanceSummary({ records }, { startDate: range.start, endDate: range.end });
  const deliveredOrders = daySummary.deliveredRecords || [];
  const totalCourierPay = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.finalPay, 0));
  const courierBasePay = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.basePay, 0));
  const courierAdjustments = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const totalPartnerCash = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.cashDue, 0));
  const partnerBaseCash = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.baseCash, 0));
  const partnerAdjustments = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const adjustedProfit = safeMoney(daySummary.deliveryFees - totalCourierPay);
  const paidCourierTotal = safeMoney(courierSummaries.reduce((sum, item) => (
    sum + (findDailyBalanceEntry(ledger, "courier", range, item.courier.username)?.amount || 0)
  ), 0));
  const paidPartnerTotal = safeMoney(partnerSummaries.reduce((sum, item) => (
    sum + (findDailyBalanceEntry(ledger, "partner", range, item.partner.username || item.partner.id)?.amount || 0)
  ), 0));
  const snapshots = ledger
    .filter((entry) => entry.type === "snapshot" && entry.rangeStart === range.start && entry.rangeEnd === range.end)
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  const snapshotCount = snapshots.length;

  const filters = `
    <div class="finance-toolbar finance-range-toolbar">
      <label>
        <span>საწყისი</span>
        <input class="finance-input" id="dailyBalanceStartDate" type="date" value="${escapeAttr(range.start)}" aria-label="საწყისი თარიღი">
      </label>
      <label>
        <span>დასასრული</span>
        <input class="finance-input" id="dailyBalanceEndDate" type="date" value="${escapeAttr(range.end)}" aria-label="დასრულების თარიღი">
      </label>
      <button class="mini-button finance-button-primary" type="button" data-daily-balance-apply>ნახვა</button>
      <button class="mini-button" type="button" data-daily-balance-range="${escapeAttr(toDateKey(new Date()))}|${escapeAttr(toDateKey(new Date()))}">დღეს</button>
      <button class="mini-button" type="button" data-daily-balance-range="${escapeAttr(addDaysToDateKey(toDateKey(new Date()), -1))}|${escapeAttr(addDaysToDateKey(toDateKey(new Date()), -1))}">გუშინ</button>
      <button class="mini-button" type="button" data-daily-balance-range="${escapeAttr(addDaysToDateKey(toDateKey(new Date()), -6))}|${escapeAttr(toDateKey(new Date()))}">7 დღე</button>
      <button class="mini-button" type="button" data-daily-balance-range="${escapeAttr(toDateKey(new Date()).slice(0, 8) + "01")}|${escapeAttr(toDateKey(new Date()))}">თვე</button>
      <button class="mini-button" type="button" data-daily-balance-export>CSV</button>
      <button class="mini-button" type="button" data-daily-balance-snapshot>Snapshot</button>
    </div>
  `;

  const summary = `
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--final",
          icon: "₾",
          label: "კურიერებზე გადასახდელი",
          value: formatMoney(totalCourierPay),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--cash finance-summary-item--alert",
          icon: "₾",
          label: "ობიექტების ქეში",
          value: formatMoney(totalPartnerCash),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--delivered",
          icon: "Σ",
          label: "ჩემი მოგება",
          value: formatMoney(adjustedProfit),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact",
          icon: "✓",
          label: "ჩაბარებული შეკვეთები",
          value: String(daySummary.delivered),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact",
          icon: "₾",
          label: "მიტანის ჯამი",
          value: formatMoney(daySummary.deliveryFees),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact",
          icon: "◷",
          label: "პერიოდი",
          value: formatDateRangeLabel(range.start, range.end),
        })}
  `;

  const courierRows = courierSummaries.map(({ courier, summary: courierSummary }) => `
    <article class="finance-card finance-mini-card finance-static-card finance-card--final">
      <span class="finance-summary-icon finance-summary-icon--final" aria-hidden="true">₾</span>
      <span>${escapeHtml(userDisplayName(courier))}</span>
      <small>ჩაბარებული: ${escapeHtml(String(courierSummary.delivered))}</small>
      <strong>${escapeHtml(formatMoney(courierSummary.finalPay))}</strong>
      <small>საბაზისო: ${escapeHtml(formatMoney(courierSummary.basePay))} · ${escapeHtml(getAdjustmentDirectionLabel(courierSummary.adjustmentTotal))}: ${escapeHtml(formatAdjustmentDisplay(courierSummary.adjustmentTotal))}</small>
      ${renderDailyBalancePaidControl("courier", range, courier.username, userDisplayName(courier), courierSummary.finalPay, courierSummary.delivered, ledger)}
    </article>
  `).join("");

  const partnerRows = partnerSummaries.map(({ partner, summary: partnerSummary }) => `
    <article class="finance-card finance-mini-card finance-static-card finance-card--partner ${partnerSummary.cashDue > 0 ? "finance-card--alert" : ""}">
      <span class="finance-summary-icon finance-summary-icon--cash" aria-hidden="true">₾</span>
      <span>${escapeHtml(partnerName(partner))}</span>
      <small>ჩაბარებული: ${escapeHtml(String(partnerSummary.deliveredOrders.length))}</small>
      <strong>${escapeHtml(formatMoney(partnerSummary.cashDue))}</strong>
      <small>ქეში: ${escapeHtml(formatMoney(partnerSummary.baseCash))} · ${escapeHtml(getAdjustmentDirectionLabel(partnerSummary.adjustmentTotal))}: ${escapeHtml(formatAdjustmentDisplay(partnerSummary.adjustmentTotal))}</small>
      <small>მოლოდინში: ${escapeHtml(formatMoney(partnerSummary.pendingCash))}</small>
      ${renderDailyBalancePaidControl("partner", range, partner.username || partner.id, partnerName(partner), partnerSummary.cashDue, partnerSummary.deliveredOrders.length, ledger, { partnerId: partner.id || "", partnerUsername: partner.username || "" })}
    </article>
  `).join("");

  const orderRows = deliveredOrders.map((order) => `
    <article class="finance-card finance-mini-card finance-static-card">
      <span class="finance-summary-icon" aria-hidden="true">✓</span>
      <span>${escapeHtml(order.fullName || "უსახელო")}</span>
      <small>კურიერი: ${escapeHtml(order.courierName || order.courierUsername || "მიუბმელი")}</small>
      <small>ობიექტი: ${escapeHtml(orderPartnerName(order))}</small>
      <strong>${escapeHtml(formatMoney(getAdminProfit(order)))}</strong>
      <small>ქეში: ${escapeHtml(formatMoney(getPaymentAmount(order)))} · კურიერი: ${escapeHtml(formatMoney(getCourierPay(order)))} · მიტანა: ${escapeHtml(formatMoney(getDeliveryTotal(order)))}</small>
    </article>
  `).join("");
  const snapshotRows = snapshots.map((entry) => `
    <article class="finance-card finance-mini-card finance-static-card">
      <span class="finance-summary-icon" aria-hidden="true">▦</span>
      <span>${escapeHtml(entry.label || "Snapshot")}</span>
      <small>${escapeHtml(formatOptionalDateTime(entry.createdAt))}</small>
      <strong>${escapeHtml(formatMoney(entry.amount))}</strong>
      <small>ჩაბარებული: ${escapeHtml(String(entry.delivered || entry.payload?.delivered || 0))} · კურიერები: ${escapeHtml(formatMoney(entry.payload?.totalCourierPay || 0))} · ობიექტები: ${escapeHtml(formatMoney(entry.payload?.totalPartnerCash || 0))}</small>
    </article>
  `).join("");

  const content = `
    ${renderFinanceCollapsibleSection({
      title: "კურიერები",
      subtitle: `საბაზისო ${formatMoney(courierBasePay)}, კორექტირება ${formatAdjustmentDisplay(courierAdjustments)}`,
      badge: `${formatMoney(paidCourierTotal)} / ${formatMoney(totalCourierPay)}`,
      className: "finance-collapsible--couriers",
      content: `<section class="finance-section finance-card-list finance-card-list--dashboard">${courierRows || "<div class=\"history-empty history-empty-card\">კურიერი ჯერ არ არის დამატებული</div>"}</section>`,
    })}
    ${renderFinanceCollapsibleSection({
      title: "ობიექტები / პარტნიორები",
      subtitle: `ქეში ${formatMoney(partnerBaseCash)}, კორექტირება ${formatAdjustmentDisplay(partnerAdjustments)}`,
      badge: `${formatMoney(paidPartnerTotal)} / ${formatMoney(totalPartnerCash)}`,
      className: "finance-collapsible--partners",
      content: `<section class="finance-section finance-card-list finance-card-list--dashboard">${partnerRows || "<div class=\"history-empty history-empty-card\">პარტნიორი ჯერ არ არის დამატებული</div>"}</section>`,
    })}
    ${renderFinanceCollapsibleSection({
      title: "ჩემი მოგება",
      subtitle: "პარტნიორის ქეში მოგებაში არ შედის",
      badge: formatMoney(adjustedProfit),
      className: "finance-collapsible--profit",
      content: `
        <section class="finance-section finance-explain-grid">
          <div class="finance-explain-row"><strong>მიტანის ჯამი</strong><span>${escapeHtml(formatMoney(daySummary.deliveryFees))}</span></div>
          <div class="finance-explain-row"><strong>კურიერებზე გადასახდელი</strong><span>${escapeHtml(formatMoney(totalCourierPay))}</span></div>
          <div class="finance-explain-row"><strong>ჩემი მოგება</strong><span>${escapeHtml(formatMoney(adjustedProfit))}</span></div>
          <div class="finance-explain-row"><strong>საბაზისო მოგება</strong><span>${escapeHtml(formatMoney(daySummary.adminProfit))}</span></div>
          <div class="finance-explain-row"><strong>Snapshot-ები</strong><span>${escapeHtml(String(snapshotCount))}</span></div>
        </section>
      `,
    })}
    ${renderFinanceCollapsibleSection({
      title: "Snapshot არქივი",
      subtitle: `${snapshotCount} შენახული snapshot`,
      badge: String(snapshotCount),
      className: "finance-collapsible--snapshots",
      collapseOnMobile: true,
      content: `<section class="finance-section finance-card-list finance-card-list--dashboard">${snapshotRows || "<div class=\"history-empty history-empty-card\">ამ პერიოდზე snapshot ჯერ არ არის შენახული</div>"}</section>`,
    })}
    ${renderFinanceCollapsibleSection({
      title: "დღის ჩაბარებული შეკვეთები",
      subtitle: `${deliveredOrders.length} ჩანაწერი`,
      badge: formatMoney(daySummary.deliveryFees),
      className: "finance-collapsible--orders",
      collapseOnMobile: true,
      content: `<section class="finance-section finance-card-list finance-card-list--dashboard">${orderRows || "<div class=\"history-empty history-empty-card\">ამ დღეს ჩაბარებული შეკვეთა არ არის</div>"}</section>`,
    })}
  `;

  const body = renderFinanceModalLayout({ filters, summary, content });
  showDialog("დღიური ბალანსი", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  bindAdminDailyBalanceEvents({
    range,
    courierSummaries,
    partnerSummaries,
    deliveredOrders,
    totals: {
      totalCourierPay,
      totalPartnerCash,
      deliveryFees: daySummary.deliveryFees,
      adjustedProfit,
      delivered: daySummary.delivered,
    },
  });
}


function renderDailyBalancePaidControl(type, range, identity, label, amount, delivered, ledger, extra = {}) {
  const paid = findDailyBalanceEntry(ledger, type, range, identity);
  if (paid) {
    return `
      <small class="finance-tag is-positive">გადახდილია: ${escapeHtml(formatMoney(paid.amount))} · ${escapeHtml(formatOptionalDateTime(paid.updatedAt || paid.createdAt))}</small>
      <button class="mini-button" type="button" data-daily-balance-unpay data-entry-id="${escapeAttr(paid.id)}">მონიშვნის მოხსნა</button>
    `;
  }
  if (safeMoney(amount) <= 0) return `<small class="finance-tag">გადასახდელი არ არის</small>`;
  return `
    <button class="mini-button finance-button-primary" type="button"
      data-daily-balance-pay
      data-type="${escapeAttr(type)}"
      data-identity="${escapeAttr(identity)}"
      data-label="${escapeAttr(label)}"
      data-amount="${escapeAttr(safeMoney(amount))}"
      data-delivered="${escapeAttr(delivered)}"
      data-partner-id="${escapeAttr(extra.partnerId || "")}"
      data-partner-username="${escapeAttr(extra.partnerUsername || "")}">
      გადახდილად მონიშვნა
    </button>
  `;
}


function bindAdminDailyBalanceEvents(report) {
  document.querySelector("[data-daily-balance-apply]")?.addEventListener("click", async () => {
    await openAdminDailyBalance(
      document.getElementById("dailyBalanceStartDate")?.value,
      document.getElementById("dailyBalanceEndDate")?.value,
    );
  });
  document.querySelectorAll("[data-daily-balance-range]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [start, end] = String(button.dataset.dailyBalanceRange || "").split("|");
      await openAdminDailyBalance(start, end);
    });
  });
  document.querySelector("[data-daily-balance-export]")?.addEventListener("click", () => {
    exportAdminDailyBalanceCsv(report);
  });
  document.querySelector("[data-daily-balance-snapshot]")?.addEventListener("click", async () => {
    await saveAdminDailyBalanceSnapshot(report);
  });
  document.querySelectorAll("[data-daily-balance-pay]").forEach((button) => {
    button.addEventListener("click", async () => {
      await markDailyBalancePaid(report.range, button.dataset);
    });
  });
  document.querySelectorAll("[data-daily-balance-unpay]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteDailyBalanceEntry(button.dataset.entryId);
      showToast("გადახდის მონიშვნა მოიხსნა");
      await openAdminDailyBalance(report.range.start, report.range.end);
    });
  });
}


async function markDailyBalancePaid(range, dataset) {
  const type = dataset.type === "partner" ? "partner" : "courier";
  const identity = dataset.identity || "";
  const amount = safeMoney(dataset.amount);
  const label = dataset.label || identity;
  if (!identity || amount <= 0) return;
  await saveDailyBalanceEntry({
    id: createDailyBalanceEntryId(type, range, identity),
    type,
    status: "paid",
    dateKey: range.start,
    rangeStart: range.start,
    rangeEnd: range.end,
    username: type === "courier" ? identity : "",
    partnerUsername: dataset.partnerUsername || (type === "partner" ? identity : ""),
    partnerId: dataset.partnerId || "",
    label,
    amount,
    delivered: Number(dataset.delivered || 0),
    note: "daily balance paid",
  });
  showToast(`${label}: მონიშნულია გადახდილად`);
  await openAdminDailyBalance(range.start, range.end);
}


async function saveAdminDailyBalanceSnapshot(report) {
  const { range, totals } = report;
  await saveDailyBalanceEntry({
    id: createFinanceEntryId("daily-balance-snapshot"),
    type: "snapshot",
    status: "saved",
    dateKey: range.start,
    rangeStart: range.start,
    rangeEnd: range.end,
    label: `Snapshot ${formatDateRangeLabel(range.start, range.end)}`,
    amount: totals.adjustedProfit,
    delivered: totals.delivered,
    payload: totals,
    note: "daily balance snapshot",
  });
  showToast("დღიური ბალანსის snapshot შენახულია");
  await openAdminDailyBalance(range.start, range.end);
}


function exportAdminDailyBalanceCsv(report) {
  const { range, courierSummaries, partnerSummaries, deliveredOrders, totals } = report;
  const rows = [
    ["section", "name", "delivered", "amount", "base", "adjustment", "cash", "courier_pay", "delivery", "profit", "period"],
    ["summary", "კურიერებზე გადასახდელი", totals.delivered, totals.totalCourierPay, "", "", "", "", totals.deliveryFees, totals.adjustedProfit, formatDateRangeLabel(range.start, range.end)],
    ["summary", "ობიექტების ქეში", "", totals.totalPartnerCash, "", "", totals.totalPartnerCash, "", "", "", formatDateRangeLabel(range.start, range.end)],
    ...courierSummaries.map(({ courier, summary }) => [
      "courier",
      userDisplayName(courier),
      summary.delivered,
      summary.finalPay,
      summary.basePay,
      summary.adjustmentTotal,
      "",
      summary.finalPay,
      "",
      "",
      formatDateRangeLabel(range.start, range.end),
    ]),
    ...partnerSummaries.map(({ partner, summary }) => [
      "partner",
      partnerName(partner),
      summary.deliveredOrders.length,
      summary.cashDue,
      summary.baseCash,
      summary.adjustmentTotal,
      summary.cashDue,
      "",
      "",
      "",
      formatDateRangeLabel(range.start, range.end),
    ]),
    ...deliveredOrders.map((order) => [
      "order",
      order.fullName || "",
      1,
      getPaymentAmount(order),
      "",
      "",
      getPaymentAmount(order),
      getCourierPay(order),
      getDeliveryTotal(order),
      getAdminProfit(order),
      getParcelStatsDateKey(order),
    ]),
  ];
  downloadFinanceCsv(`daily-balance-${range.start}-${range.end}.csv`, rows);
  showToast("CSV ექსპორტი მზადაა");
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
  const filters = renderDateRangeToolbar({
    startId: "financeCourierStartDate",
    endId: "financeCourierEndDate",
    start: range.start,
    end: range.end,
    applySelector: "data-finance-range-apply",
    className: "finance-range-toolbar",
  });
  const content = renderFinanceListPanel({
    title: "კურიერის ფინანსები",
    badges: [
      formatDateRangeLabel(range.start, range.end),
      `ჩაბარებული: ${delivered}`,
      `კორექტირება: ${formatAdjustmentDisplay(adjustmentTotal)}`,
    ],
    headers: ["მაჩვენებელი", "თანხა / რაოდენობა", "სტატუსი", "აღწერა", ""],
    rows: [
      `
        <tr>
          <td>${renderFinanceTableText("საბოლოო გამომუშავება", courier.username)}</td>
          <td>${escapeHtml(formatMoney(finalPay))}</td>
          <td><span class="history-status status-delivered">გადასახდელი</span></td>
          <td>საბაზისო ანაზღაურება + კორექტირება</td>
          <td>${state.isAdmin ? renderFinanceTableAction("adjustCourierPay", "გასწორება", username, "mini-button finance-button-primary") : ""}</td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("ჩასაბარებელი ქეში", courier.username)}</td>
          <td>${escapeHtml(formatMoney(cash))}</td>
          <td><span class="history-status status-pending">ჩასაბარებელი</span></td>
          <td>შეკვეთების ქეში + ქეშის კორექტირება</td>
          <td>${state.isAdmin ? renderFinanceTableAction("adjustCourierCash", "გასწორება", username, "mini-button finance-button-primary") : ""}</td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("ჩაბარებული", "არჩეულ პერიოდში")}</td>
          <td>${escapeHtml(String(delivered))}</td>
          <td><span class="history-status status-delivered">დასრულებული</span></td>
          <td>ჩაბარებული შეკვეთების რაოდენობა</td>
          <td></td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText(getAdjustmentDirectionLabel(adjustmentTotal), "ხელფასის კორექტირება")}</td>
          <td>${escapeHtml(formatAdjustmentDisplay(adjustmentTotal))}</td>
          <td><span class="history-status status-pending">კორექტირება</span></td>
          <td>საბოლოო ანაზღაურებაზე გავლენა</td>
          <td></td>
        </tr>
      `,
      `
        <tr>
          <td>${renderFinanceTableText("საბაზისო", "კორექტირებამდე")}</td>
          <td>${escapeHtml(formatMoney(basePay))}</td>
          <td><span class="history-status status-delivered">დარიცხული</span></td>
          <td>შეკვეთებიდან დათვლილი კურიერის ანაზღაურება</td>
          <td></td>
        </tr>
      `,
    ],
  });
  const footer = state.isAdmin ? `
        <div class="finance-actions finance-actions--dashboard" aria-label="ფინანსების მოქმედებები">
          <button class="mini-button finance-button-primary finance-action-button" type="button" data-action="adjustCourierCash" data-value="${escapeAttr(username)}">ქეშის გასწორება</button>
          <button class="mini-button finance-button-primary finance-action-button" type="button" data-action="adjustCourierPay" data-value="${escapeAttr(username)}">გამომუშავების გასწორება</button>
        </div>
      ` : "";
  const body = renderFinanceModalLayout({ filters, content, footer });
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
  const filters = renderDateRangeToolbar({
    startId: "financeCashStartDate",
    endId: "financeCashEndDate",
    start: range.start,
    end: range.end,
    applySelector: "data-finance-cash-range-apply",
    className: "finance-range-toolbar",
  });
  const totalCash = safeMoney(couriers.reduce((sum, courier) => (
    sum + calculateFinanceSummary({ records }, { username: courier.username, startDate: range.start, endDate: range.end }).cashReceived
  ), 0));
  const rows = couriers.map((courier) => {
    const username = courier.username;
    const courierSummary = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
    return `
      <tr>
        <td>${renderFinanceTableText(userDisplayName(courier), username)}</td>
        <td>${escapeHtml(formatMoney(courierSummary.cashReceived))}</td>
        <td>${escapeHtml(formatMoney(courierSummary.totalOrdersAmount))}</td>
        <td>${escapeHtml(`${getAdjustmentDirectionLabel(courierSummary.cashAdjustmentTotal)}: ${formatAdjustmentDisplay(courierSummary.cashAdjustmentTotal)}`)}</td>
        <td><span class="history-status status-pending">ჩასაბარებელი</span></td>
        <td>${renderFinanceTableAction("adjustCourierCash", "რედაქტირება", username, "mini-button finance-button-primary")}</td>
      </tr>
    `;
  });
  const content = renderFinanceListPanel({
    title: "კურიერების ქეში",
    badges: [
      `სულ: ${formatMoney(totalCash)}`,
      formatDateRangeLabel(range.start, range.end),
      `კურიერი: ${couriers.length}`,
    ],
    headers: ["კურიერი", "ჩასაბარებელი", "შეკვეთები", "კორექტირება", "სტატუსი", ""],
    rows: rows.length ? rows : [`<tr><td colspan="6">კურიერი ჯერ არ არის დამატებული</td></tr>`],
  });
  const body = renderFinanceModalLayout({ filters, content });
  showDialog("ქეში", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
  bindDateRangeToolbar({
    startId: "financeCashStartDate",
    endId: "financeCashEndDate",
    applySelector: "[data-finance-cash-range-apply]",
    onApply: async (selectedRange) => {
      setFinanceCourierRange(selectedRange.start, selectedRange.end);
      await openFinanceCash();
    },
  });
}


async function openFinanceCourierPay() {
  if (!state.isAdmin) return;
  const [users, records] = await Promise.all([getUsers(), getAllFinanceRecords()]);
  const couriers = users.filter((user) => user.role === "courier");
  const range = getFinanceCourierRange();
  const filters = renderDateRangeToolbar({
    startId: "financePayStartDate",
    endId: "financePayEndDate",
    start: range.start,
    end: range.end,
    applySelector: "data-finance-pay-range-apply",
    className: "finance-range-toolbar",
  });
  const summaries = couriers.map((courier) => ({
    courier,
    summary: calculateFinanceSummary({ records }, { username: courier.username, startDate: range.start, endDate: range.end }),
  }));
  const totalPay = safeMoney(summaries.reduce((sum, item) => sum + item.summary.finalPay, 0));
  const basePay = safeMoney(summaries.reduce((sum, item) => sum + item.summary.basePay, 0));
  const adjustmentTotal = safeMoney(summaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const content = renderFinanceListPanel({
    title: "კურიერის ანაზღაურება",
    badges: [
      `სულ: ${formatMoney(totalPay)}`,
      `საბაზისო: ${formatMoney(basePay)}`,
      `${getAdjustmentDirectionLabel(adjustmentTotal)}: ${formatAdjustmentDisplay(adjustmentTotal)}`,
    ],
    headers: ["კურიერი", "საბოლოო", "საბაზისო", "კორექტირება", "ჩაბარებული", ""],
    rows: summaries.length ? summaries.map(({ courier, summary: courierSummary }) => `
      <tr>
        <td>${renderFinanceTableText(userDisplayName(courier), courier.username)}</td>
        <td>${escapeHtml(formatMoney(courierSummary.finalPay))}</td>
        <td>${escapeHtml(formatMoney(courierSummary.basePay))}</td>
        <td>${escapeHtml(`${getAdjustmentDirectionLabel(courierSummary.adjustmentTotal)}: ${formatAdjustmentDisplay(courierSummary.adjustmentTotal)}`)}</td>
        <td><span class="history-status status-delivered">${escapeHtml(String(courierSummary.delivered))}</span></td>
        <td>
          <div class="row-actions">
            ${renderFinanceTableAction("adjustCourierPay", "რედაქტირება", courier.username, "mini-button finance-button-primary")}
            ${renderFinanceTableAction("openFinanceCourier", "დეტალურად", courier.username)}
          </div>
        </td>
      </tr>
    `) : [`<tr><td colspan="6">კურიერი ჯერ არ არის დამატებული</td></tr>`],
  });
  const body = renderFinanceModalLayout({ filters, content });
  showDialog("კურიერის ანაზღაურება", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
  bindDateRangeToolbar({
    startId: "financePayStartDate",
    endId: "financePayEndDate",
    applySelector: "[data-finance-pay-range-apply]",
    onApply: async (selectedRange) => {
      setFinanceCourierRange(selectedRange.start, selectedRange.end);
      await openFinanceCourierPay();
    },
  });
}


async function openFinancePartnerCash() {
  if (!state.isAdmin || typeof getPartners !== "function" || typeof calculatePartnerCashSummary !== "function") return;
  const [partners, records] = await Promise.all([
    getPartners().catch(() => []),
    typeof getAllPartnerCashRecords === "function" ? getAllPartnerCashRecords().catch(() => []) : getAllFinanceRecords(),
    typeof loadPartnerCashAdjustments === "function" ? loadPartnerCashAdjustments().catch(() => []) : [],
  ]);
  const summaries = partners.map((partner) => ({
    partner,
    summary: calculatePartnerCashSummary(partner, records),
  }));
  const cashDue = safeMoney(summaries.reduce((sum, item) => sum + item.summary.cashDue, 0));
  const baseCash = safeMoney(summaries.reduce((sum, item) => sum + item.summary.baseCash, 0));
  const adjustmentTotal = safeMoney(summaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const pendingCash = safeMoney(summaries.reduce((sum, item) => sum + item.summary.pendingCash, 0));
  const content = renderFinanceListPanel({
    title: "პარტნიორის ქეში",
    badges: [
      `სულ: ${formatMoney(cashDue)}`,
      `ჩაბარებული: ${formatMoney(baseCash)}`,
      `მოლოდინში: ${formatMoney(pendingCash)}`,
    ],
    headers: ["პარტნიორი", "მისაცემი ქეში", "ჩაბარებული", "მოლოდინში", "კორექტირება", ""],
    rows: summaries.length ? summaries.map(({ partner, summary: partnerSummary }) => `
      <tr>
        <td>${renderFinanceTableText(partnerName(partner), partner.username || partner.id || "")}</td>
        <td>${escapeHtml(formatMoney(partnerSummary.cashDue))}</td>
        <td>${escapeHtml(formatMoney(partnerSummary.baseCash))}</td>
        <td>${escapeHtml(formatMoney(partnerSummary.pendingCash))}</td>
        <td>${escapeHtml(`${getAdjustmentDirectionLabel(partnerSummary.adjustmentTotal)}: ${formatAdjustmentDisplay(partnerSummary.adjustmentTotal)}`)}</td>
        <td>${renderFinanceTableAction("adjustPartnerCash", "რედაქტირება", partner.username, "mini-button finance-button-primary")}</td>
      </tr>
    `) : [`<tr><td colspan="6">პარტნიორი ჯერ არ არის დამატებული</td></tr>`],
  });
  const body = renderFinanceModalLayout({ content });
  showDialog("პარტნიორის ქეში", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
}


async function openFinanceDayClose() {
  if (!state.isAdmin) return;
  const [pins, history] = await Promise.all([getPins(""), getHistory("")]);
  const todayKey = toDateKey(new Date());
  const records = [...pins, ...history];
  const todaySummary = calculateFinanceSummary({ records }, { startDate: todayKey, endDate: todayKey });
  const delivered = pins.filter((pin) => pin.status === "delivered").length;
  const failed = pins.filter((pin) => pin.status === "failed").length;
  const pending = pins.filter((pin) => pin.status === "pending").length;
  const closable = pins.filter(isCompletedParcelStatus).length;
  const summary = `
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--hero finance-summary-item--delivered",
          icon: "✓",
          label: "დასახური ჩაბარებული პინები",
          value: String(closable),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--final",
          icon: "₾",
          label: "დღევანდელი მოგება",
          value: formatMoney(todaySummary.adminProfit),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--cash",
          icon: "₾",
          label: "დღევანდელი ქეში",
          value: formatMoney(todaySummary.cashReceived),
        })}
  `;
  const content = `
      <section class="finance-section finance-explain-grid">
        <div class="finance-explain-row"><strong>ჩაბარდა</strong><span>${escapeHtml(String(delivered))}</span></div>
        <div class="finance-explain-row"><strong>ვერ ჩაბარდა</strong><span>${escapeHtml(String(failed))}</span></div>
        <div class="finance-explain-row"><strong>პროცესშია</strong><span>${escapeHtml(String(pending))}</span></div>
      </section>
      <section class="finance-section finance-action-grid">
        <button class="button primary finance-button-primary" type="button" data-action="adminCloseDay">დღის დახურვა</button>
        <button class="button secondary" type="button" data-action="parcelHistory">ისტორიის ნახვა</button>
        <button class="button secondary" type="button" data-action="openFinanceAdmin">კომპანიის ანგარიში</button>
      </section>
  `;
  const body = renderFinanceModalLayout({ summary, content });
  showDialog("დღის დახურვა / ისტორია", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
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
      <small>აირჩიეთ მიმატება ან ჩამოკლება. ჩამოკლება ნაშთს 0-ს ქვემოთ არ უშვებს.</small>
    </div>
    ${renderAdjustmentModeSelect("cashAdjustmentMode")}
    <label for="cashAdjustmentAmount">თანხა</label>
    <input class="finance-input" id="cashAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="">
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
  const mode = document.getElementById("cashAdjustmentMode")?.value === "add" ? "add" : "subtract";
  await addCashAdjustment(username, value, mode);
  await openFinanceCourier(username);
}


async function resetCashAdjustment(username) {
  await zeroCashAdjustment(username);
  await openFinanceCourier(username);
}


function calculateAdjustmentDelta(currentAmount, amount, mode = "subtract", rawCurrentAmount = currentAmount) {
  const current = Math.max(0, safeMoney(currentAmount));
  const rawCurrent = safeMoney(rawCurrentAmount);
  const normalizedAmount = Math.max(0, safeMoney(amount));
  const nextAmount = mode === "add"
    ? safeMoney(current + normalizedAmount)
    : Math.max(0, safeMoney(current - Math.min(normalizedAmount, current)));
  return {
    currentAmount: current,
    correctionAmount: mode === "add" ? normalizedAmount : Math.min(normalizedAmount, current),
    mode: mode === "add" ? "add" : "subtract",
    nextAmount,
    nextDelta: safeMoney(nextAmount - rawCurrent),
  };
}


async function addCashAdjustment(username, amount, mode = "subtract") {
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords();
  const summary = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
  const currentCash = summary.cashReceived;
  const rawCash = safeMoney(summary.totalOrdersAmount + summary.cashAdjustmentTotal);
  const dateKey = range.start;
  const now = new Date().toISOString();
  const { correctionAmount, mode: appliedMode, nextAmount, nextDelta } = calculateAdjustmentDelta(currentCash, amount, mode, rawCash);
  if (Math.abs(nextDelta) < 0.005) return;
  const adjustment = {
    id: createFinanceEntryId("cash"),
    username,
    courierId: username,
    amount: nextDelta,
    delta: nextDelta,
    targetAmount: nextAmount,
    correctionAmount,
    correctionMode: appliedMode,
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


async function zeroCashAdjustment(username) {
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords();
  const currentCash = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end }).cashReceived;
  await addCashAdjustment(username, currentCash);
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
          label: getAdjustmentDirectionLabel(adjustmentTotal),
          value: formatAdjustmentDisplay(adjustmentTotal),
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
          label: "კორექტირების თანხა",
          value: formatMoney(finalPay),
        })}
  `;
  const content = `
      <section class="finance-section finance-adjustment-panel">
        ${renderAdjustmentModeSelect("payAdjustmentMode")}
        <label for="payAdjustmentAmount">თანხა</label>
        <input class="finance-input" id="payAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="">
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
    const mode = document.getElementById("payAdjustmentMode")?.value === "add" ? "add" : "subtract";
    await addPayAdjustment(username, value, mode);
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
    await zeroPayAdjustment(username);
    await openFinanceCourier(username);
  } finally {
    payAdjustmentSaveLock = false;
    document.querySelectorAll('[data-action="savePayAdjustment"], [data-action="resetPayAdjustment"]').forEach((button) => {
      button.disabled = false;
    });
  }
}


async function addPayAdjustment(username, amount, mode = "subtract") {
  const range = getFinanceCourierRange();
  const records = [...await getPins(""), ...await getHistory("")];
  const summary = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
  const currentPay = summary.finalPay;
  const rawPay = safeMoney(summary.basePay + summary.adjustmentTotal);
  const { correctionAmount, mode: appliedMode, nextAmount, nextDelta } = calculateAdjustmentDelta(currentPay, amount, mode, rawPay);
  const now = new Date().toISOString();

  if (Math.abs(nextDelta) < 0.005) return;

  const adjustment = {
    id: createFinanceEntryId("pay"),
    username,
    courierId: username,
    amount: nextDelta,
    delta: nextDelta,
    targetAmount: nextAmount,
    correctionAmount,
    correctionMode: appliedMode,
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


async function zeroPayAdjustment(username) {
  const range = getFinanceCourierRange();
  const records = [...await getPins(""), ...await getHistory("")];
  const { finalPay: currentPay } = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
  await addPayAdjustment(username, currentPay);
}
