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
    if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof getStaticFinanceData === "function") {
      const financeData = getStaticFinanceData();
      return normalizeFinanceAdjustmentList(financeData.cashAdjustments || [], "cash");
    }
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.cashAdjustmentsStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.cashAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "cash");
  } catch {
    return [];
  }
}


async function writeCashAdjustments(adjustments) {
  const normalized = normalizeFinanceAdjustmentList(adjustments, "cash");
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    await saveStaticFinanceData({ ...getStaticFinanceData(), cashAdjustments: normalized });
    return normalized;
  }
  if (typeof saveData === "function") saveData(CONFIG.cashAdjustmentsStorageKey, normalized);
  else localStorage.setItem(CONFIG.cashAdjustmentsStorageKey, JSON.stringify(normalized));
  return normalized;
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


const FINANCE_RECORDS_CACHE_TTL_MS = 12000;
const financeRecordsCache = new Map();


function getFinanceRecordsCacheKey(options = {}) {
  const range = options.startDate || options.endDate || options.dateFrom || options.dateTo
    ? normalizeDateRange(options.startDate || options.dateFrom, options.endDate || options.dateTo || options.startDate || options.dateFrom)
    : null;
  return [
    normalizeUsername(options.username || ""),
    range?.start || "",
    range?.end || "",
    String(options.partnerId || ""),
  ].join("|");
}


function invalidateFinanceRecordsCache() {
  financeRecordsCache.clear();
  state.statisticsReport = null;
}


async function getAllFinanceRecords(options = {}) {
  const rangeStart = options.startDate || options.dateFrom;
  const rangeEnd = options.endDate || options.dateTo || rangeStart;
  const range = rangeStart || rangeEnd
    ? normalizeDateRange(rangeStart, rangeEnd)
    : null;
  const recordOptions = {
    ...(range ? { dateFrom: range.start, dateTo: range.end } : {}),
    ...(options.partnerId ? { partnerId: options.partnerId } : {}),
  };
  const cacheKey = getFinanceRecordsCacheKey({ ...options, ...recordOptions });
  const cached = financeRecordsCache.get(cacheKey);
  const now = Date.now();
  if (!options.forceRefresh && cached?.records && now - cached.at <= FINANCE_RECORDS_CACHE_TTL_MS) return cached.records;
  if (!options.forceRefresh && cached?.promise) return cached.promise;

  const promise = Promise.all([
    getPins(options.username || "", recordOptions),
    getHistory(options.username || "", recordOptions),
  ]).then(([pins, history]) => {
    const records = [...pins, ...history];
    financeRecordsCache.set(cacheKey, { at: Date.now(), records });
    return records;
  }).catch((error) => {
    financeRecordsCache.delete(cacheKey);
    throw error;
  });
  financeRecordsCache.set(cacheKey, { at: now, promise });
  return promise;
}


function readPayAdjustments() {
  try {
    if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof getStaticFinanceData === "function") {
      const financeData = getStaticFinanceData();
      return normalizeFinanceAdjustmentList(financeData.payAdjustments || [], "pay");
    }
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.payAdjustmentsStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.payAdjustmentsStorageKey) || "[]");
    return normalizeFinanceAdjustmentList(Array.isArray(parsed) ? parsed : [], "pay");
  } catch {
    return [];
  }
}


async function writePayAdjustments(adjustments) {
  const normalized = normalizeFinanceAdjustmentList(adjustments, "pay");
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    await saveStaticFinanceData({ ...getStaticFinanceData(), payAdjustments: normalized });
    return normalized;
  }
  if (typeof saveData === "function") saveData(CONFIG.payAdjustmentsStorageKey, normalized);
  else localStorage.setItem(CONFIG.payAdjustmentsStorageKey, JSON.stringify(normalized));
  return normalized;
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


function renderFinanceLoadingState(message = "იტვირთება...") {
  return renderFinanceModalLayout({
    content: `
      <div class="finance-workbench">
        <div class="history-empty history-empty-card finance-loading-state" aria-busy="true">
          <strong>${escapeHtml(message)}</strong>
          <span>მონაცემები ფონურად ახლდება.</span>
        </div>
      </div>
    `,
  });
}


function addDaysToDateKey(dateKey, days) {
  const normalizedDate = normalizeDateKey(dateKey) || toDateKey(new Date());
  const date = new Date(`${normalizedDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
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
      outstandingCash: 0,
      pendingCash: 0,
      serviceFees: 0,
      outstandingServiceFees: 0,
      pendingServiceFees: 0,
      adjustmentTotal: 0,
      netBalance: 0,
      partnerReturnDue: 0,
      partnerPaymentDue: 0,
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
  const serviceFees = safeMoney(deliveredOrders.reduce((sum, order) => sum + getPartnerOrderServiceFee(order), 0));
  const pendingServiceFees = safeMoney(pendingOrders.reduce((sum, order) => sum + getPartnerOrderServiceFee(order), 0));
  const adjustments = getPartnerCashAdjustmentsForRange(partner, range.start, range.end);
  const adjustmentTotal = safeMoney(adjustments.reduce((sum, adjustment) => sum + getAdjustmentSignedAmount(adjustment), 0));
  const netBalance = safeMoney(baseCash + adjustmentTotal - serviceFees);
  const partnerReturnDue = Math.max(0, netBalance);
  const partnerPaymentDue = Math.max(0, safeMoney(-netBalance));
  const outstandingCash = partnerReturnDue;
  const outstandingServiceFees = partnerPaymentDue;

  return {
    orders,
    deliveredOrders,
    pendingOrders,
    adjustments,
    baseCash,
    outstandingCash,
    pendingCash,
    serviceFees,
    outstandingServiceFees,
    pendingServiceFees,
    adjustmentTotal,
    netBalance,
    partnerReturnDue,
    partnerPaymentDue,
    cashDue: partnerReturnDue,
  };
}


function partnerSummaryHasOrders(summary) {
  return Array.isArray(summary?.orders) && summary.orders.length > 0;
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
    if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof getStaticFinanceData === "function") {
      const financeData = getStaticFinanceData();
      return (Array.isArray(financeData.dailyBalanceLedger) ? financeData.dailyBalanceLedger : []).map(normalizeDailyBalanceEntry);
    }
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.dailyBalanceLedgerStorageKey) || []
      : JSON.parse(localStorage.getItem(CONFIG.dailyBalanceLedgerStorageKey) || "[]");
    return (Array.isArray(parsed) ? parsed : []).map(normalizeDailyBalanceEntry);
  } catch {
    return [];
  }
}


async function writeDailyBalanceLedger(entries) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeDailyBalanceEntry);
  if (typeof isStaticDeploy === "function" && isStaticDeploy() && typeof saveStaticFinanceData === "function") {
    await saveStaticFinanceData({ ...getStaticFinanceData(), dailyBalanceLedger: normalized });
    return normalized;
  }
  if (typeof saveData === "function") saveData(CONFIG.dailyBalanceLedgerStorageKey, normalized);
  else localStorage.setItem(CONFIG.dailyBalanceLedgerStorageKey, JSON.stringify(normalized));
  return normalized;
}


async function loadDailyBalanceLedger() {
  try {
    const payload = await api("/api/daily-balance-ledger");
    const entries = (payload.entries || []).map(normalizeDailyBalanceEntry);
    await writeDailyBalanceLedger(entries);
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
    await writeDailyBalanceLedger([...entries, saved]);
    return saved;
  } catch (error) {
    const entries = readDailyBalanceLedger().filter((item) => item.id !== normalized.id);
    if (typeof isStaticDeploy === "function" && isStaticDeploy()) throw error;
    await writeDailyBalanceLedger([...entries, normalized]);
    return normalized;
  }
}


async function deleteDailyBalanceEntry(id) {
  if (!id) return;
  try {
    await api(`/api/daily-balance-ledger/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    if (typeof isStaticDeploy === "function" && isStaticDeploy()) throw error;
  }
  await writeDailyBalanceLedger(readDailyBalanceLedger().filter((entry) => entry.id !== id));
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
  return `<div class="finance-list-panel">${renderAppListPanel({ title, badges, headers, rows })}</div>`;
}


function renderFinanceTableText(title, subtitle = "") {
  return renderAppTableText(title, subtitle);
}


function renderFinanceTableAction(action, label, value = "", className = "mini-button") {
  return `<button class="${escapeAttr(className)}" type="button" data-action="${escapeAttr(action)}"${value ? ` data-value="${escapeAttr(value)}"` : ""}>${escapeHtml(label)}</button>`;
}


function renderFinanceCell(label, content, className = "") {
  return `<td ${className ? `class="${escapeAttr(className)}" ` : ""}data-label="${escapeAttr(label)}">${content}</td>`;
}


function renderFinanceDetailChips(items) {
  return `
    <div class="finance-detail-chips">
      ${items.map(({ label, value, tone = "" }) => `
        <span class="finance-detail-chip ${tone ? `finance-detail-chip--${escapeAttr(tone)}` : ""}">
          <small>${escapeHtml(label)}</small>
          <strong>${escapeHtml(value)}</strong>
        </span>
      `).join("")}
    </div>
  `;
}


function getPartnerSettlementState(summary) {
  const returnDue = safeMoney(summary.partnerReturnDue);
  const paymentDue = safeMoney(summary.partnerPaymentDue);
  if (returnDue > 0) {
    return {
      label: "გადასარიცხი პარტნიორს",
      shortLabel: "გადასარიცხი",
      amount: returnDue,
      tone: "pay",
      status: "pending",
    };
  }
  if (paymentDue > 0) {
    return {
      label: "მისაღებია პარტნიორისგან",
      shortLabel: "მისაღები",
      amount: paymentDue,
      tone: "collect",
      status: "pending",
    };
  }
  return {
    label: "ბალანსი დახურულია",
    shortLabel: "დახურული",
    amount: 0,
    tone: "closed",
    status: "delivered",
  };
}


function renderFinanceSettlementAmount(state) {
  return `
    <div class="finance-settlement finance-settlement--${escapeAttr(state.tone)}">
      <strong>${escapeHtml(formatMoney(state.amount))}</strong>
      <small>${escapeHtml(state.label)}</small>
    </div>
  `;
}


const FINANCE_ADMIN_VIEWS = [
  { id: "summary", label: "ყველა" },
  { id: "couriers", label: "კურიერები" },
  { id: "partners", label: "პარტნიორები" },
  { id: "orders", label: "შეკვეთები" },
  { id: "adjustments", label: "კორექტირებები" },
  { id: "close", label: "დახურვა" },
];


function getFinanceAdminView(view = state.financeAdminView) {
  return FINANCE_ADMIN_VIEWS.some((item) => item.id === view) ? view : "summary";
}


function normalizeFinanceSearch(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}


function financeSearchText(parts = []) {
  return normalizeFinanceSearch(parts.filter(Boolean).join(" "));
}


function financeMatchesSearch(parts = []) {
  const query = financeSearchText([state.financeAdminSearch || ""]);
  return !query || financeSearchText(parts).includes(query);
}


function getFinanceAdminAdjustmentRows(report) {
  const payAdjustments = getPayAdjustmentsForRange(report.range.start, report.range.end).map((adjustment) => ({
    ...adjustment,
    financeTypeLabel: "კურიერის ანაზღაურება",
    ownerLabel: adjustment.username || adjustment.courierId || "",
  }));
  const cashAdjustments = getCashAdjustmentsForRange(report.range.start, report.range.end).map((adjustment) => ({
    ...adjustment,
    financeTypeLabel: "კურიერის ქეში",
    ownerLabel: adjustment.username || adjustment.courierId || "",
  }));
  const partnerAdjustments = (typeof readPartnerCashAdjustments === "function" ? readPartnerCashAdjustments() : [])
    .filter((adjustment) => adjustmentMatchesDateRange(adjustment, report.range.start, report.range.end))
    .map((adjustment) => ({
      ...adjustment,
      financeTypeLabel: "პარტნიორის ქეში",
      ownerLabel: adjustment.partnerUsername || adjustment.username || adjustment.partnerId || "",
    }));

  return [...payAdjustments, ...cashAdjustments, ...partnerAdjustments]
    .sort((a, b) => Date.parse(getAdjustmentTimestamp(b)) - Date.parse(getAdjustmentTimestamp(a)));
}


async function getFinanceAdminReport() {
  const workday = typeof getWorkdayState === "function"
    ? await getWorkdayState().catch(() => null)
    : null;
  if (!state.financeWorkdayInitialized) {
    const today = toDateKey(new Date());
    setFinanceCourierRange(today, today);
    state.financeWorkdayInitialized = true;
  }
  const range = getFinanceCourierRange();
  const [users, records, partners] = await Promise.all([
    getUsers().catch(() => []),
    getAllFinanceRecords({ startDate: range.start, endDate: range.end }).catch(() => []),
    typeof getPartners === "function" ? getPartners().catch(() => []) : [],
    typeof loadPartnerCashAdjustments === "function" ? loadPartnerCashAdjustments().catch(() => []) : [],
  ]);
  const ledger = await loadDailyBalanceLedger().catch(() => readDailyBalanceLedger());
  const couriers = users.filter((user) => user.role === "courier");
  const pins = records.filter((record) => !record.archivedAt);
  const history = records.filter((record) => record.archivedAt);
  const partnerRecords = typeof mergePartnerOrderRecords === "function" ? mergePartnerOrderRecords(pins, history) : records;
  const daySummary = calculateFinanceSummary({ records }, { startDate: range.start, endDate: range.end });
  const courierSummaries = couriers.map((courier) => ({
    courier,
    summary: calculateFinanceSummary({ records }, { username: courier.username, startDate: range.start, endDate: range.end }),
  }));
  const partnerSummaries = (Array.isArray(partners) ? partners : []).map((partner) => ({
    partner,
    summary: (() => {
      const summary = calculatePartnerCashSummaryForRange(partner, partnerRecords, range.start, range.end);
      return applyPartnerPaidToSummary(summary, getPartnerPaidAmount(ledger, partner, range));
    })(),
  })).filter(({ summary }) => partnerSummaryHasOrders(summary));
  const totalCourierCash = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.cashReceived, 0));
  const totalCourierPay = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.finalPay, 0));
  const courierBasePay = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.basePay, 0));
  const courierAdjustments = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const partnerCashDue = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.partnerReturnDue, 0));
  const partnerServiceFees = safeMoney(partnerSummaries.reduce((sum, item) => sum + (item.summary.outstandingServiceFees ?? item.summary.serviceFees), 0));
  const partnerPendingServiceFees = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.pendingServiceFees, 0));
  const partnerPaymentDue = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.partnerPaymentDue, 0));
  const partnerNetBalance = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.netBalance, 0));
  const partnerPendingCash = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.pendingCash, 0));
  const partnerBaseCash = safeMoney(partnerSummaries.reduce((sum, item) => sum + (item.summary.outstandingCash ?? item.summary.baseCash), 0));
  const partnerAdjustments = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const paidCourierTotal = safeMoney(courierSummaries.reduce((sum, item) => (
    sum + (findDailyBalanceEntry(ledger, "courier", range, item.courier.username)?.amount || 0)
  ), 0));
  const paidPartnerTotal = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.paidAmount, 0));
  const closablePins = pins.filter((pin) => isCompletedParcelStatus(pin) && parcelMatchesStatsDateRange(pin, range.start, range.end));
  const deliveredOrders = daySummary.deliveredRecords || [];
  const snapshots = ledger
    .filter((entry) => entry.type === "snapshot" && entry.rangeStart === range.start && entry.rangeEnd === range.end)
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  const adjustedProfit = safeMoney(daySummary.deliveryFees - totalCourierPay);
  const adjustments = getFinanceAdminAdjustmentRows({ range });

  return {
    range,
    users,
    workday,
    couriers,
    pins,
    history,
    records,
    partners,
    partnerRecords,
    ledger,
    daySummary,
    courierSummaries,
    partnerSummaries,
    deliveredOrders,
    closablePins,
    snapshots,
    adjustments,
    totals: {
      totalCourierCash,
      totalCourierPay,
      courierBasePay,
      courierAdjustments,
      partnerCashDue,
      partnerServiceFees,
      partnerPendingServiceFees,
      partnerPaymentDue,
      partnerNetBalance,
      partnerPendingCash,
      partnerBaseCash,
      partnerAdjustments,
      paidCourierTotal,
      paidPartnerTotal,
      adjustedProfit,
      deliveryFees: daySummary.deliveryFees,
      delivered: daySummary.delivered,
      failed: daySummary.failed,
      pending: daySummary.pending,
    },
  };
}


function renderFinanceAdminTabs(activeView) {
  return `
    <div class="finance-admin-tabs" role="tablist" aria-label="ფინანსების განყოფილებები">
      ${FINANCE_ADMIN_VIEWS.map((item) => `
        <button class="finance-admin-tab ${activeView === item.id ? "is-active" : ""}" type="button" data-finance-dashboard-tab="${escapeAttr(item.id)}">
          ${escapeHtml(item.label)}
        </button>
      `).join("")}
    </div>
  `;
}


function renderFinanceAdminFilters(report, activeView) {
  const today = toDateKey(new Date());
  const yesterday = addDaysToDateKey(today, -1);
  const quickRanges = [
    { label: "დღეს", value: `${today}|${today}` },
    { label: "გუშინ", value: `${yesterday}|${yesterday}` },
    { label: "7 დღე", value: `${addDaysToDateKey(today, -6)}|${today}` },
    { label: "თვე", value: `${today.slice(0, 8) + "01"}|${today}` },
    { label: "CSV", value: "export" },
  ];
  const currentRangeValue = `${report.range.start}|${report.range.end}`;
  const workdayNotice = report.workday?.isStale
    ? `<p class="history-empty history-empty-card finance-workday-alert">სამუშაო დღე არ არის დახურული: ${escapeHtml(report.workday.currentWorkdayKey)} · კალენდარი: ${escapeHtml(report.workday.calendarDateKey || "")}</p>`
    : `<p class="finance-workday-label">სამუშაო დღე: <strong>${escapeHtml(today)}</strong></p>`;
  return `
    <div class="finance-workbench-head">
      ${workdayNotice}
      <div class="finance-workbench-topline">
        <div class="finance-toolbar finance-range-toolbar finance-workbench-range">
          <label>
            <span>საწყისი</span>
            <input class="finance-input" id="financeDashboardStartDate" type="date" value="${escapeAttr(report.range.start)}" aria-label="საწყისი თარიღი">
          </label>
          <label>
            <span>დასასრული</span>
            <input class="finance-input" id="financeDashboardEndDate" type="date" value="${escapeAttr(report.range.end)}" aria-label="დასრულების თარიღი">
          </label>
          <button class="mini-button finance-button-primary" type="button" data-finance-dashboard-apply>ნახვა</button>
        </div>
        <div class="finance-workbench-selects">
          <label class="finance-workbench-select">
            <span>პერიოდი</span>
            <select class="finance-input" data-finance-dashboard-range-select aria-label="სწრაფი პერიოდი">
              <option value="">პერიოდი</option>
              ${quickRanges.map((item) => `
                <option value="${escapeAttr(item.value)}" ${item.value === currentRangeValue ? "selected" : ""}>${escapeHtml(item.label)}</option>
              `).join("")}
            </select>
          </label>
          <label class="finance-workbench-select">
            <span>განყოფილება</span>
            <select class="finance-input" data-finance-dashboard-tab-select aria-label="ფინანსების განყოფილება">
              ${FINANCE_ADMIN_VIEWS.map((item) => `
                <option value="${escapeAttr(item.id)}" ${activeView === item.id ? "selected" : ""}>${escapeHtml(item.label)}</option>
              `).join("")}
            </select>
          </label>
        </div>
      </div>
    </div>
  `;
}


function renderFinanceAdminMetrics(report) {
  const totals = report.totals;
  const partnerSettlement = Math.max(totals.partnerCashDue, totals.partnerPaymentDue);
  const partnerSettlementLabel = totals.partnerCashDue > 0
    ? "პარტნიორებს გადასარიცხი"
    : "პარტნიორებიდან მისაღები";
  return `
    ${renderFinanceSummaryItem({ className: "finance-summary-item--hero finance-summary-item--final", icon: "₾", label: "მოგება", value: formatMoney(totals.adjustedProfit) })}
    ${renderFinanceSummaryItem({ className: "finance-summary-item--cash finance-summary-item--alert", icon: "₾", label: "კურიერის ქეში", value: formatMoney(totals.totalCourierCash) })}
    ${renderFinanceSummaryItem({ className: "finance-summary-item--base", icon: "₾", label: partnerSettlementLabel, value: formatMoney(partnerSettlement) })}
    ${renderFinanceSummaryItem({ className: "finance-summary-item--compact", icon: "◷", label: "პერიოდი", value: formatDateRangeLabel(report.range.start, report.range.end) })}
  `;
}


function renderFinanceAdminSummary(report) {
  const totals = report.totals;
  const actionRows = [
    {
      title: "კურიერის ქეში",
      label: "ჩასაბარებელია",
      value: formatMoney(totals.totalCourierCash),
      meta: `${report.couriers.length} კურიერი`,
      action: "couriers",
      actionLabel: "კურიერები",
      search: ["ქეში", "კურიერი", totals.totalCourierCash],
      tone: "collect",
    },
    {
      title: "პარტნიორების ბალანსი",
      label: totals.partnerCashDue > 0 ? "გადასარიცხია" : "მისაღებია",
      value: formatMoney(Math.max(totals.partnerCashDue, totals.partnerPaymentDue)),
      meta: `${report.partnerSummaries.length} პარტნიორი`,
      action: "partners",
      actionLabel: "პარტნიორები",
      search: ["პარტნიორი", "ბალანსი", "მომსახურება", totals.partnerCashDue, totals.partnerPaymentDue],
      tone: totals.partnerCashDue > 0 ? "pay" : "collect",
    },
    {
      title: "დღის დახურვა",
      label: "დასახურია",
      value: String(report.closablePins.length),
      meta: formatDateRangeLabel(report.range.start, report.range.end),
      action: "close",
      actionLabel: "დახურვა",
      search: ["დღის დახურვა", report.closablePins.length],
      tone: report.closablePins.length > 0 ? "pay" : "closed",
    },
  ];
  const actionQueue = `
    <section class="finance-action-queue" aria-label="სწრაფი ფინანსური მოქმედებები">
      ${actionRows.map((item) => `
        <article class="finance-action-card finance-action-card--${escapeAttr(item.tone)} finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(item.search))}">
          <div>
            <span>${escapeHtml(item.title)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.label)} · ${escapeHtml(item.meta)}</small>
          </div>
          <button class="mini-button finance-button-primary" type="button" data-finance-dashboard-tab="${escapeAttr(item.action)}">${escapeHtml(item.actionLabel)}</button>
        </article>
      `).join("")}
    </section>
  `;
  const content = renderFinanceListPanel({
    title: "ფინანსური ნაკადები",
    badges: [
      `კურიერი: ${report.couriers.length}`,
      `პარტნიორი: ${report.partnerSummaries.length}`,
      `ჩაბარებული: ${totals.delivered}`,
      `პერიოდი: ${formatDateRangeLabel(report.range.start, report.range.end)}`,
    ],
    headers: ["ნაკადი", "ბალანსი", "დეტალები", "მოქმედება"],
    rows: [
      `
        <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["ქეში", "კურიერი", totals.totalCourierCash]))}">
          ${renderFinanceCell("ნაკადი", renderFinanceTableText("კურიერები", "ქეში და ანაზღაურება"))}
          ${renderFinanceCell("ბალანსი", renderFinanceSettlementAmount({ amount: totals.totalCourierCash, label: "ჩასაბარებელი ქეში", tone: "collect" }))}
          ${renderFinanceCell("დეტალები", renderFinanceDetailChips([
            { label: "ქეში", value: formatMoney(totals.totalCourierCash), tone: "collect" },
            { label: "გადასახდელი", value: formatMoney(totals.totalCourierPay), tone: "pay" },
          ]))}
          ${renderFinanceCell("მოქმედება", `<button class="mini-button finance-button-primary" type="button" data-finance-dashboard-tab="couriers">გაშლა</button>`)}
        </tr>
      `,
      `
        <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["პარტნიორი", "ბალანსი", "მომსახურება", totals.partnerCashDue, totals.partnerPaymentDue]))}">
          ${renderFinanceCell("ნაკადი", renderFinanceTableText("პარტნიორები", "COD მინუს მომსახურება"))}
          ${renderFinanceCell("ბალანსი", renderFinanceSettlementAmount({
            amount: Math.max(totals.partnerCashDue, totals.partnerPaymentDue),
            label: totals.partnerCashDue > 0 ? "გადასარიცხი პარტნიორებს" : "მისაღებია პარტნიორებისგან",
            tone: totals.partnerCashDue > 0 ? "pay" : "collect",
          }))}
          ${renderFinanceCell("დეტალები", renderFinanceDetailChips([
            { label: "COD", value: formatMoney(totals.partnerBaseCash), tone: "collect" },
            { label: "მომსახურება", value: formatMoney(totals.partnerServiceFees), tone: "pay" },
            { label: "მისაღები", value: formatMoney(totals.partnerPaymentDue), tone: "collect" },
          ]))}
          ${renderFinanceCell("მოქმედება", `<button class="mini-button finance-button-primary" type="button" data-finance-dashboard-tab="partners">გაშლა</button>`)}
        </tr>
      `,
      `
        <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["მოგება", "მიტანა", totals.adjustedProfit]))}">
          ${renderFinanceCell("ნაკადი", renderFinanceTableText("კომპანიის მოგება", "მომსახურება - კურიერი"))}
          ${renderFinanceCell("ბალანსი", renderFinanceSettlementAmount({ amount: totals.adjustedProfit, label: "საბოლოო მოგება", tone: "closed" }))}
          ${renderFinanceCell("დეტალები", renderFinanceDetailChips([
            { label: "მომსახურება", value: formatMoney(totals.deliveryFees), tone: "collect" },
            { label: "კურიერი", value: formatMoney(totals.totalCourierPay), tone: "pay" },
          ]))}
          ${renderFinanceCell("მოქმედება", `<button class="mini-button finance-button-primary" type="button" data-finance-dashboard-tab="orders">შეკვეთები</button>`)}
        </tr>
      `,
      `
        <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["დღის დახურვა", report.closablePins.length]))}">
          ${renderFinanceCell("ნაკადი", renderFinanceTableText("დახურვა", "დასრულებული შეკვეთების ისტორიაში გადატანა"))}
          ${renderFinanceCell("ბალანსი", renderAppStatusBadge("delivered", String(report.closablePins.length)))}
          ${renderFinanceCell("დეტალები", renderFinanceDetailChips([
            { label: "ქეში", value: formatMoney(totals.totalCourierCash), tone: "collect" },
            { label: "მომსახურება", value: formatMoney(totals.deliveryFees), tone: "pay" },
          ]))}
          ${renderFinanceCell("მოქმედება", `<button class="mini-button finance-button-primary" type="button" data-finance-dashboard-tab="close">გაშლა</button>`)}
        </tr>
      `,
    ],
  });
  return `${actionQueue}${content}`;
}


function renderFinanceAdminCouriers(report) {
  const rows = report.courierSummaries
    .filter(({ courier, summary }) => financeMatchesSearch([
      userDisplayName(courier), courier.username, summary.cashReceived, summary.finalPay, summary.basePay,
    ]))
    .map(({ courier, summary }) => `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([userDisplayName(courier), courier.username, summary.cashReceived, summary.finalPay]))}">
        ${renderFinanceCell("კურიერი", renderFinanceTableText(userDisplayName(courier), courier.username))}
        ${renderFinanceCell("ჩასაბარებელი ქეში", escapeHtml(formatMoney(summary.cashReceived)))}
        ${renderFinanceCell("საბოლოო ანაზღაურება", escapeHtml(formatMoney(summary.finalPay)))}
        ${renderFinanceCell("საბაზისო", escapeHtml(formatMoney(summary.basePay)))}
        ${renderFinanceCell("კორექტირება", escapeHtml(`${getAdjustmentDirectionLabel(summary.adjustmentTotal)}: ${formatAdjustmentDisplay(summary.adjustmentTotal)}`))}
        ${renderFinanceCell("ჩაბარებული", renderAppStatusBadge("delivered", String(summary.delivered)))}
        ${renderFinanceCell("გადახდა", renderDailyBalancePaidControl("courier", report.range, courier.username, userDisplayName(courier), summary.finalPay, summary.delivered, report.ledger))}
        ${renderFinanceCell("მოქმედება", `
          <div class="row-actions">
            ${renderFinanceTableAction("openFinanceCourier", "დეტალურად", courier.username)}
            ${renderFinanceTableAction("adjustCourierCash", "ქეში", courier.username)}
            ${renderFinanceTableAction("adjustCourierPay", "ანაზღაურება", courier.username)}
          </div>
        `)}
      </tr>
    `);

  return renderFinanceListPanel({
    title: "კურიერები",
    badges: [
      `ქეში: ${formatMoney(report.totals.totalCourierCash)}`,
      `გადასახდელი: ${formatMoney(report.totals.totalCourierPay)}`,
      `გადახდილია: ${formatMoney(report.totals.paidCourierTotal)}`,
    ],
    headers: ["კურიერი", "ჩასაბარებელი ქეში", "საბოლოო ანაზღაურება", "საბაზისო", "კორექტირება", "ჩაბარებული", "გადახდა", ""],
    rows: rows.length ? rows : [`<tr><td colspan="8">კურიერი ვერ მოიძებნა.</td></tr>`],
  });
}


function renderFinanceAdminPartners(report) {
  const partnerTotals = report.partnerSummaries.reduce((totals, { summary }) => {
    totals.cod += Number(summary.outstandingCash ?? summary.baseCash) || 0;
    totals.service += Number(summary.outstandingServiceFees ?? summary.serviceFees) || 0;
    totals.returnDue += Number(summary.partnerReturnDue) || 0;
    totals.paymentDue += Number(summary.partnerPaymentDue) || 0;
    return totals;
  }, { cod: 0, service: 0, returnDue: 0, paymentDue: 0 });
  const rows = report.partnerSummaries
    .filter(({ partner, summary }) => financeMatchesSearch([
      partnerName(partner), partner.username, partner.contactPerson, partner.phone,
      summary.outstandingCash, summary.outstandingServiceFees, summary.partnerReturnDue, summary.partnerPaymentDue, summary.netBalance,
    ]))
    .map(({ partner, summary }) => {
      const codBalance = summary.outstandingCash ?? summary.baseCash;
      const serviceFeeBalance = summary.outstandingServiceFees ?? summary.serviceFees;
      const settlementAmount = Math.max(summary.partnerReturnDue, summary.partnerPaymentDue);
      const settlementState = getPartnerSettlementState(summary);
      return `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([partnerName(partner), partner.username, partner.contactPerson, partner.phone, codBalance, serviceFeeBalance, summary.netBalance]))}">
        ${renderFinanceCell("პარტნიორი", renderFinanceTableText(partnerName(partner), partner.username || partner.id || ""))}
        ${renderFinanceCell("ბალანსი", renderFinanceSettlementAmount(settlementState), "finance-cell-balance")}
        ${renderFinanceCell("დეტალები", renderFinanceDetailChips([
          { label: "COD", value: formatMoney(codBalance), tone: "collect" },
          { label: "მომსახურება", value: formatMoney(serviceFeeBalance), tone: "pay" },
          { label: "ნეტო", value: formatMoney(summary.netBalance), tone: settlementState.tone },
          { label: "მოლოდინში", value: formatMoney(summary.pendingCash) },
          { label: "კორექტირება", value: `${getAdjustmentDirectionLabel(summary.adjustmentTotal)}: ${formatAdjustmentDisplay(summary.adjustmentTotal)}` },
        ]))}
        ${renderFinanceCell("სტატუსი", renderAppStatusBadge(settlementState.status, settlementState.shortLabel))}
        ${renderFinanceCell("გადახდა", renderDailyBalancePaidControl("partner", report.range, partner.username || partner.id, partnerName(partner), settlementAmount, summary.deliveredOrders.length, report.ledger, { partnerId: partner.id || "", partnerUsername: partner.username || "" }))}
        ${renderFinanceCell("მოქმედება", renderFinanceTableAction("adjustPartnerCash", "გასწორება", partner.username, "mini-button finance-button-primary"))}
      </tr>
    `;
    });

  return renderFinanceListPanel({
    title: "პარტნიორები",
    badges: [
      `COD: ${formatMoney(partnerTotals.cod)}`,
      `მომსახურება: ${formatMoney(partnerTotals.service)}`,
      `გადასარიცხი: ${formatMoney(partnerTotals.returnDue)}`,
      `მისაღები: ${formatMoney(partnerTotals.paymentDue)}`,
      `გადახდილია: ${formatMoney(report.totals.paidPartnerTotal)}`,
    ],
    headers: ["პარტნიორი", "ბალანსი", "დეტალები", "სტატუსი", "გადახდა", ""],
    rows: rows.length ? rows : [`<tr><td colspan="6">პარტნიორი ვერ მოიძებნა.</td></tr>`],
  });
}


function renderFinanceAdminOrders(report) {
  const rows = report.deliveredOrders
    .filter((order) => financeMatchesSearch([
      order.fullName, order.phone, order.courierUsername, order.courierName, orderPartnerName(order),
      getPaymentAmount(order), getPartnerOrderServiceFee(order), getAdminProfit(order),
    ]))
    .sort((a, b) => String(getParcelStatsDateKey(b)).localeCompare(String(getParcelStatsDateKey(a))))
    .map((order) => {
      const cod = getPaymentAmount(order);
      const serviceFee = getPartnerOrderServiceFee(order);
      const partnerNet = safeMoney(cod - serviceFee);
      return `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([order.fullName, order.phone, order.courierUsername, orderPartnerName(order)]))}">
        ${renderFinanceCell("მიმღები", renderFinanceTableText(order.fullName || "უსახელო", order.phone || "ტელეფონი არ არის"))}
        ${renderFinanceCell("პარტნიორი", renderFinanceTableText(orderPartnerName(order), order.partnerUsername || order.partnerId || "პირადი"))}
        ${renderFinanceCell("კურიერი", renderFinanceTableText(order.courierName || order.courierUsername || "მიუბმელი", order.courierUsername || ""))}
        ${renderFinanceCell("COD", escapeHtml(formatMoney(cod)))}
        ${renderFinanceCell("მომსახურება", escapeHtml(formatMoney(serviceFee)))}
        ${renderFinanceCell("პარტნიორის ნეტო", escapeHtml(formatMoney(partnerNet)))}
        ${renderFinanceCell("კურიერი", escapeHtml(formatMoney(getCourierPay(order))))}
        ${renderFinanceCell("მოგება", escapeHtml(formatMoney(getAdminProfit(order))))}
        ${renderFinanceCell("თარიღი", escapeHtml(getParcelStatsDateKey(order)))}
      </tr>
    `;
    });

  return renderFinanceListPanel({
    title: "ჩაბარებული შეკვეთები",
    badges: [
      `სულ: ${report.deliveredOrders.length}`,
      `მომსახურება: ${formatMoney(report.totals.deliveryFees)}`,
      `მოგება: ${formatMoney(report.totals.adjustedProfit)}`,
    ],
    headers: ["მიმღები", "პარტნიორი", "კურიერი", "COD", "მომსახურება", "პარტნიორის ნეტო", "კურიერი", "მოგება", "თარიღი"],
    rows: rows.length ? rows : [`<tr><td colspan="9">ამ პერიოდში ჩაბარებული შეკვეთა არ არის.</td></tr>`],
  });
}


function renderFinanceAdminAdjustments(report) {
  const rows = report.adjustments
    .filter((adjustment) => financeMatchesSearch([
      adjustment.financeTypeLabel, adjustment.ownerLabel, adjustment.note, adjustment.amount, adjustment.targetAmount,
    ]))
    .map((adjustment) => `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([adjustment.financeTypeLabel, adjustment.ownerLabel, adjustment.note]))}">
        ${renderFinanceCell("ტიპი", renderFinanceTableText(adjustment.financeTypeLabel, adjustment.ownerLabel || "უცნობი"))}
        ${renderFinanceCell("თანხა", escapeHtml(formatMoney(Math.abs(getAdjustmentSignedAmount(adjustment)))))}
        ${renderFinanceCell("მოქმედება", renderAppStatusBadge(getAdjustmentSignedAmount(adjustment) >= 0 ? "delivered" : "pending", getAdjustmentSignedAmount(adjustment) >= 0 ? "მიმატება" : "ჩამოკლება"))}
        ${renderFinanceCell("ახალი ნაშთი", escapeHtml(formatMoney(adjustment.targetAmount || 0)))}
        ${renderFinanceCell("პერიოდი", escapeHtml(formatDateRangeLabel(adjustment.startDate || adjustment.dateKey, adjustment.endDate || adjustment.dateKey)))}
        ${renderFinanceCell("დრო", escapeHtml(formatOptionalDateTime(getAdjustmentTimestamp(adjustment))))}
        ${renderFinanceCell("შენიშვნა", escapeHtml(adjustment.note || ""))}
      </tr>
    `);

  return renderFinanceListPanel({
    title: "კორექტირებები",
    badges: [
      `სულ: ${report.adjustments.length}`,
      `კურიერი: ${formatAdjustmentDisplay(report.totals.courierAdjustments)}`,
      `პარტნიორი: ${formatAdjustmentDisplay(report.totals.partnerAdjustments)}`,
    ],
    headers: ["ტიპი", "თანხა", "მოქმედება", "ახალი ნაშთი", "პერიოდი", "დრო", "შენიშვნა"],
    rows: rows.length ? rows : [`<tr><td colspan="7">კორექტირება ვერ მოიძებნა.</td></tr>`],
  });
}


function renderFinanceAdminClose(report) {
  const delivered = report.closablePins.filter((pin) => pin.status === "delivered").length;
  const failed = report.closablePins.filter((pin) => pin.status === "failed").length;
  const rows = report.courierSummaries
    .filter(({ summary }) => summary.delivered || summary.failed || summary.pending)
    .map(({ courier, summary }) => `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([userDisplayName(courier), courier.username]))}">
        ${renderFinanceCell("კურიერი", renderFinanceTableText(userDisplayName(courier), courier.username))}
        ${renderFinanceCell("ჩაბარებული", renderAppStatusBadge("delivered", String(summary.delivered)))}
        ${renderFinanceCell("ვერ", renderAppStatusBadge("failed", String(summary.failed)))}
        ${renderFinanceCell("პროცესში", renderAppStatusBadge("pending", String(summary.pending)))}
        ${renderFinanceCell("ქეში", escapeHtml(formatMoney(summary.cashReceived)))}
        ${renderFinanceCell("ანაზღაურება", escapeHtml(formatMoney(summary.finalPay)))}
      </tr>
    `);

  return `
    <section class="finance-close-strip">
      <button class="button primary finance-button-primary" type="button" data-action="adminCloseDay">დღის დახურვა</button>
      <button class="button secondary" type="button" data-action="parcelHistory">ისტორია</button>
      <button class="button secondary" type="button" data-daily-balance-export>CSV</button>
      <button class="button secondary" type="button" data-daily-balance-snapshot>Snapshot</button>
    </section>
    ${renderFinanceListPanel({
      title: "დახურვის შემოწმება",
      badges: [
        `დასახური: ${report.closablePins.length}`,
        `ჩაბარდა: ${delivered}`,
        `ვერ: ${failed}`,
        `ქეში: ${formatMoney(report.totals.totalCourierCash)}`,
        `გადასახდელი: ${formatMoney(report.totals.totalCourierPay)}`,
      ],
      headers: ["კურიერი", "ჩაბარებული", "ვერ", "პროცესში", "ქეში", "ანაზღაურება"],
      rows: rows.length ? rows : [`<tr><td colspan="6">დასახური ჩანაწერი არ არის.</td></tr>`],
    })}
  `;
}


function renderFinanceAdminContent(report, activeView) {
  if (activeView === "couriers") return renderFinanceAdminCouriers(report);
  if (activeView === "partners") return renderFinanceAdminPartners(report);
  if (activeView === "orders") return renderFinanceAdminOrders(report);
  if (activeView === "adjustments") return renderFinanceAdminAdjustments(report);
  if (activeView === "close") return renderFinanceAdminClose(report);
  return renderFinanceAdminSummary(report);
}


function applyFinanceDashboardSearch() {
  const query = financeSearchText([state.financeAdminSearch || ""]);
  const rows = [...document.querySelectorAll(".finance-workbench-search-row[data-finance-search]")];
  let visibleCount = 0;
  rows.forEach((row) => {
    const visible = !query || (row.dataset.financeSearch || "").includes(query);
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = document.querySelector(".finance-workbench-empty");
  if (empty) empty.hidden = !query || visibleCount > 0;
}


function renderFinanceDashboardWorkbench(report) {
  return `
    <div class="finance-workbench">
      ${renderFinanceAdminContent(report, state.financeAdminView)}
      <p class="history-empty finance-workbench-empty" hidden>ჩანაწერი ვერ მოიძებნა.</p>
    </div>
  `;
}


function bindFinanceDashboardContentEvents(report) {
  document.querySelectorAll(".finance-workbench [data-finance-dashboard-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.financeAdminView = getFinanceAdminView(button.dataset.financeDashboardTab);
      updateFinanceDashboardContent(report);
    });
  });
  bindAdminDailyBalanceEvents({
    range: report.range,
    courierSummaries: report.courierSummaries,
    partnerSummaries: report.partnerSummaries,
    deliveredOrders: report.deliveredOrders,
    totals: {
      totalCourierPay: report.totals.totalCourierPay,
      totalPartnerCash: report.totals.partnerCashDue,
      partnerBaseCash: report.totals.partnerBaseCash,
      partnerServiceFees: report.totals.partnerServiceFees,
      partnerPaymentDue: report.totals.partnerPaymentDue,
      partnerNetBalance: report.totals.partnerNetBalance,
      partnerAdjustments: report.totals.partnerAdjustments,
      deliveryFees: report.totals.deliveryFees,
      adjustedProfit: report.totals.adjustedProfit,
      delivered: report.totals.delivered,
    },
  });
}


function updateFinanceDashboardContent(report) {
  const workbench = document.querySelector(".finance-workbench");
  if (!workbench) return;
  workbench.innerHTML = `
    ${renderFinanceAdminContent(report, state.financeAdminView)}
    <p class="history-empty finance-workbench-empty" hidden>ჩანაწერი ვერ მოიძებნა.</p>
  `;
  bindFinanceDashboardContentEvents(report);
  applyFinanceDashboardSearch();
}


function bindFinanceDashboardEvents(report) {
  document.querySelector("[data-finance-dashboard-apply]")?.addEventListener("click", async () => {
    const range = normalizeDateRange(
      document.getElementById("financeDashboardStartDate")?.value,
      document.getElementById("financeDashboardEndDate")?.value,
    );
    setFinanceCourierRange(range.start, range.end);
    await openFinanceDashboard();
  });
  document.querySelectorAll("[data-finance-dashboard-range]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [start, end] = String(button.dataset.financeDashboardRange || "").split("|");
      setFinanceCourierRange(start, end);
      await openFinanceDashboard();
    });
  });
  document.querySelector("[data-finance-dashboard-range-select]")?.addEventListener("change", async (event) => {
    const value = event.currentTarget.value;
    if (!value) return;
    if (value === "export") {
      exportAdminDailyBalanceCsv({
        range: report.range,
        courierSummaries: report.courierSummaries,
        partnerSummaries: report.partnerSummaries,
        deliveredOrders: report.deliveredOrders,
        totals: {
          totalCourierPay: report.totals.totalCourierPay,
          partnerBaseCash: report.totals.partnerBaseCash,
          partnerServiceFees: report.totals.partnerServiceFees,
          totalPartnerCash: report.totals.partnerCashDue,
          partnerPaymentDue: report.totals.partnerPaymentDue,
          partnerNetBalance: report.totals.partnerNetBalance,
          partnerAdjustments: report.totals.partnerAdjustments,
          deliveryFees: report.totals.deliveryFees,
          adjustedProfit: report.totals.adjustedProfit,
          delivered: report.totals.delivered,
        },
      });
      event.currentTarget.value = `${report.range.start}|${report.range.end}`;
      return;
    }
    const [start, end] = value.split("|");
    setFinanceCourierRange(start, end);
    await openFinanceDashboard();
  });
  document.querySelectorAll(".modal-filters [data-finance-dashboard-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.financeAdminView = getFinanceAdminView(button.dataset.financeDashboardTab);
      updateFinanceDashboardContent(report);
    });
  });
  document.querySelector("[data-finance-dashboard-tab-select]")?.addEventListener("change", (event) => {
    state.financeAdminView = getFinanceAdminView(event.currentTarget.value);
    updateFinanceDashboardContent(report);
  });
  const searchInput = document.getElementById("financeAdminSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.financeAdminSearch = searchInput.value;
      applyFinanceDashboardSearch();
    });
    applyFinanceDashboardSearch();
  }
  bindFinanceDashboardContentEvents(report);
}


async function openFinanceDashboard(options = {}) {
  if (!state.isAdmin) {
    await openFinanceCourier(state.currentUser);
    return;
  }
  state.financeAdminView = getFinanceAdminView(state.financeAdminView);
  if (!options.preserveSearch) state.financeAdminSearch = "";
  const requestToken = `finance:${Date.now()}:${Math.random()}`;
  state.financeDashboardRequestToken = requestToken;
  showDialog("ფინანსები", renderFinanceLoadingState("ფინანსური მონაცემები იტვირთება..."), [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  const report = await getFinanceAdminReport();
  if (state.financeDashboardRequestToken !== requestToken || state.activeDialogTitle !== "ფინანსები") return;
  const filters = renderFinanceAdminFilters(report, state.financeAdminView);
  const content = renderFinanceDashboardWorkbench(report);
  const body = renderFinanceModalLayout({ filters, content });
  showDialog("ფინანსები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  bindFinanceDashboardEvents(report);
}


function getPartnerPaidAmount(ledger, partner, range) {
  if (typeof getStatisticsPaidAmount === "function") {
    return safeMoney(getStatisticsPaidAmount(ledger, "partner", partner, range));
  }
  return safeMoney(findDailyBalanceEntry(ledger, "partner", range, partner?.username || partner?.id)?.amount || 0);
}


function applyPartnerPaidToSummary(summary, paidAmount) {
  const paid = Math.max(0, safeMoney(paidAmount));
  const returnDue = Math.max(0, safeMoney(summary?.partnerReturnDue) - paid);
  const paymentDue = Math.max(0, safeMoney(summary?.partnerPaymentDue) - paid);
  return {
    ...summary,
    netBalance: returnDue > 0 ? returnDue : paymentDue > 0 ? -paymentDue : 0,
    partnerReturnDue: returnDue,
    partnerPaymentDue: paymentDue,
    outstandingCash: returnDue,
    outstandingServiceFees: paymentDue,
    cashDue: returnDue,
    paidAmount: paid,
  };
}

const STATISTICS_VIEWS = [
  { id: "overview", label: "ყველა" },
  { id: "partners", label: "პარტნიორები" },
  { id: "couriers", label: "კურიერები" },
  { id: "daily", label: "დღეები" },
  { id: "failed", label: "ვერ ჩაბარდა" },
  { id: "payments", label: "გადახდები" },
  { id: "orders", label: "შეკვეთები" },
];


function getStatisticsView(view = state.statisticsView) {
  return STATISTICS_VIEWS.some((item) => item.id === view) ? view : "overview";
}


function getStatisticsRange(defaultDate = toDateKey(new Date())) {
  return normalizeDateRange(
    state.statisticsRangeStart || defaultDate,
    state.statisticsRangeEnd || state.statisticsRangeStart || defaultDate,
  );
}


function setStatisticsRange(start, end) {
  const range = normalizeDateRange(start, end);
  state.statisticsRangeStart = range.start;
  state.statisticsRangeEnd = range.end;
  return range;
}


function getStatisticsQuickRange(value, todayKey = toDateKey(new Date())) {
  const today = normalizeDateKey(todayKey) || toDateKey(new Date());
  const date = new Date(`${today}T12:00:00`);
  const weekday = date.getDay() || 7;
  if (value === "today") return { start: today, end: today };
  if (value === "yesterday") {
    const yesterday = addDaysToDateKey(today, -1);
    return { start: yesterday, end: yesterday };
  }
  if (value === "this-week") return { start: addDaysToDateKey(today, 1 - weekday), end: today };
  if (value === "last-week") {
    const end = addDaysToDateKey(today, -weekday);
    return { start: addDaysToDateKey(end, -6), end };
  }
  if (value === "this-month") return { start: `${today.slice(0, 8)}01`, end: today };
  if (value === "last-month") {
    const month = new Date(`${today.slice(0, 8)}01T12:00:00`);
    month.setMonth(month.getMonth() - 1);
    const start = toDateKey(month);
    month.setMonth(month.getMonth() + 1);
    month.setDate(0);
    return { start, end: toDateKey(month) };
  }
  return getStatisticsRange(today);
}


function getStatisticsRangeDayCount(range) {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}


function dedupeStatisticsRecords(records = []) {
  const byId = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = String(record?.id || "").trim() || `${record?.createdAt || ""}|${record?.phone || ""}|${record?.fullName || ""}`;
    const current = byId.get(key);
    if (!current || String(record?.updatedAt || record?.archivedAt || record?.createdAt || "") > String(current.updatedAt || current.archivedAt || current.createdAt || "")) {
      byId.set(key, record);
    }
  });
  return [...byId.values()];
}


function getStatisticsSuccessRate(delivered, failed) {
  const closed = Number(delivered || 0) + Number(failed || 0);
  return closed ? Math.round((Number(delivered || 0) / closed) * 1000) / 10 : 0;
}


function statisticsRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && endA >= startB;
}


function statisticsLedgerMatchesRange(entry, range) {
  const start = normalizeDateKey(entry.rangeStart || entry.dateKey);
  const end = normalizeDateKey(entry.rangeEnd || entry.dateKey || entry.rangeStart) || start;
  return statisticsRangesOverlap(start, end, range.start, range.end);
}


function getStatisticsPaidAmount(ledger, type, owner, range) {
  return safeMoney((Array.isArray(ledger) ? ledger : [])
    .filter((entry) => entry.status === "paid" && entry.type === type && statisticsLedgerMatchesRange(entry, range))
    .filter((entry) => {
      if (type === "courier") return normalizeUsername(entry.username) === normalizeUsername(owner);
      const partner = owner || {};
      const id = partnerCashIdentity(partner);
      return Boolean(
        (id && (entry.partnerId === id || normalizeUsername(entry.partnerUsername) === normalizeUsername(id)))
        || (partner.username && normalizeUsername(entry.partnerUsername || entry.username) === normalizeUsername(partner.username)),
      );
    })
    .reduce((sum, entry) => sum + safeMoney(entry.amount), 0));
}


function getStatisticsDailyBreakdown(records, range) {
  const days = [];
  for (let day = range.start; day <= range.end; day = addDaysToDateKey(day, 1)) {
    days.push({
      dateKey: day,
      total: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      cod: 0,
      deliveryRevenue: 0,
      courierEarnings: 0,
      companyRevenue: 0,
    });
    if (days.length > 370) break;
  }
  const byDay = new Map(days.map((day) => [day.dateKey, day]));
  (Array.isArray(records) ? records : []).forEach((order) => {
    const day = byDay.get(getParcelStatsDateKey(order));
    if (!day) return;
    day.total += 1;
    if (order.status === "delivered") {
      day.delivered += 1;
      day.cod = safeMoney(day.cod + getPaymentAmount(order));
      day.deliveryRevenue = safeMoney(day.deliveryRevenue + getDeliveryTotal(order));
      day.courierEarnings = safeMoney(day.courierEarnings + getCourierPay(order));
      day.companyRevenue = safeMoney(day.companyRevenue + getAdminProfit(order));
    } else if (order.status === "failed") {
      day.failed += 1;
    } else {
      day.pending += 1;
    }
  });
  return days;
}


function getStatisticsFailedReasons(records) {
  const grouped = new Map();
  (Array.isArray(records) ? records : [])
    .filter((order) => order.status === "failed")
    .forEach((order) => {
      const reason = String(order.failureReason || "მიზეზი არ არის მითითებული").trim();
      const current = grouped.get(reason) || { reason, count: 0, orders: [] };
      current.count += 1;
      current.orders.push(order);
      grouped.set(reason, current);
    });
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}


async function getStatisticsReport() {
  const workday = typeof getWorkdayState === "function"
    ? await getWorkdayState().catch(() => null)
    : null;
  if (!state.statisticsInitialized) {
    const today = toDateKey(new Date());
    setStatisticsRange(today, today);
    state.statisticsInitialized = true;
  }

  const range = getStatisticsRange(toDateKey(new Date()));
  const [users, recordsRaw, partners, ledger] = await Promise.all([
    getUsers().catch(() => []),
    getAllFinanceRecords({ startDate: range.start, endDate: range.end }).catch(() => []),
    typeof getPartners === "function" ? getPartners().catch(() => []) : [],
    (async () => {
      if (typeof loadPartnerCashAdjustments === "function") await loadPartnerCashAdjustments().catch(() => []);
      return loadDailyBalanceLedger().catch(() => readDailyBalanceLedger());
    })(),
  ]);

  const records = dedupeStatisticsRecords(recordsRaw)
    .filter((order) => parcelMatchesStatsDateRange(order, range.start, range.end));
  const couriers = users.filter((user) => user.role === "courier");
  const dayCount = getStatisticsRangeDayCount(range);
  const financeSummary = calculateFinanceSummary({ records }, { startDate: range.start, endDate: range.end });
  const delivered = financeSummary.delivered;
  const failed = financeSummary.failed;
  const pending = financeSummary.pending;
  const successRate = getStatisticsSuccessRate(delivered, failed);

  const courierSummaries = couriers.map((courier) => {
    const summary = calculateFinanceSummary({ records }, { username: courier.username, startDate: range.start, endDate: range.end });
    const assigned = summary.filteredOrdersCount;
    const paid = getStatisticsPaidAmount(ledger, "courier", courier.username, range);
    return {
      courier,
      summary,
      assigned,
      paid,
      remaining: Math.max(0, safeMoney(summary.finalPay - paid)),
      successRate: getStatisticsSuccessRate(summary.delivered, summary.failed),
      averagePerDay: summary.delivered / dayCount,
    };
  });

  const partnerSummaries = (Array.isArray(partners) ? partners : []).map((partner) => {
    const summary = calculatePartnerCashSummaryForRange(partner, records, range.start, range.end);
    const paid = getStatisticsPaidAmount(ledger, "partner", partner, range);
    return {
      partner,
      summary,
      paid,
      remainingToPay: Math.max(0, safeMoney(summary.partnerReturnDue - paid)),
      successRate: getStatisticsSuccessRate(summary.deliveredOrders.length, summary.orders.filter((order) => order.status === "failed").length),
      averagePerDay: summary.orders.length / dayCount,
    };
  }).filter(({ summary }) => summary.orders.length > 0);

  const totalCourierPaid = safeMoney(courierSummaries.reduce((sum, item) => sum + item.paid, 0));
  const totalPartnerPaid = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.paid, 0));
  const daily = getStatisticsDailyBreakdown(records, range);
  const failedReasons = getStatisticsFailedReasons(records);
  const paymentRows = (Array.isArray(ledger) ? ledger : [])
    .filter((entry) => entry.status === "paid" && statisticsLedgerMatchesRange(entry, range))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""));

  return {
    range,
    workday,
    users,
    couriers,
    partners,
    records,
    ledger,
    financeSummary,
    courierSummaries,
    partnerSummaries,
    daily,
    failedReasons,
    paymentRows,
    totals: {
      totalOrders: records.length,
      delivered,
      failed,
      pending,
      successRate,
      totalCod: financeSummary.totalOrdersAmount,
      deliveryRevenue: financeSummary.deliveryFees,
      partnerCodPayable: safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.partnerReturnDue, 0)),
      partnerPaid: totalPartnerPaid,
      partnerRemaining: safeMoney(partnerSummaries.reduce((sum, item) => sum + item.remainingToPay, 0)),
      courierEarnings: financeSummary.finalPay,
      courierPaid: totalCourierPaid,
      courierPayable: Math.max(0, safeMoney(financeSummary.finalPay - totalCourierPaid)),
      companyRevenue: safeMoney(financeSummary.deliveryFees - financeSummary.finalPay),
    },
  };
}


function renderStatisticsMetric(label, value, icon = "•", className = "") {
  return renderFinanceSummaryItem({ className, icon, label, value });
}


function renderStatisticsFilters(report) {
  const quickRanges = [
    { label: "დღეს", value: "today" },
    { label: "გუშინ", value: "yesterday" },
    { label: "ეს კვირა", value: "this-week" },
    { label: "წინა კვირა", value: "last-week" },
    { label: "ეს თვე", value: "this-month" },
    { label: "წინა თვე", value: "last-month" },
    { label: "CSV", value: "export" },
  ];
  return `
    <div class="finance-workbench-head statistics-head">
      <p class="finance-workday-label">პერიოდი: <strong>${escapeHtml(formatDateRangeLabel(report.range.start, report.range.end))}</strong></p>
      <div class="finance-workbench-topline">
        <div class="finance-toolbar finance-range-toolbar finance-workbench-range">
          <label>
            <span>საწყისი</span>
            <input class="finance-input" id="statisticsStartDate" type="date" value="${escapeAttr(report.range.start)}" aria-label="საწყისი თარიღი">
          </label>
          <label>
            <span>დასასრული</span>
            <input class="finance-input" id="statisticsEndDate" type="date" value="${escapeAttr(report.range.end)}" aria-label="დასრულების თარიღი">
          </label>
          <button class="mini-button finance-button-primary" type="button" data-statistics-apply>ნახვა</button>
        </div>
        <div class="finance-workbench-selects">
          <label class="finance-workbench-select">
            <span>პერიოდი</span>
            <select class="finance-input" data-statistics-range-select aria-label="სტატისტიკის პერიოდი">
              <option value="">Custom</option>
              ${quickRanges.map((item) => `<option value="${escapeAttr(item.value)}">${escapeHtml(item.label)}</option>`).join("")}
            </select>
          </label>
          <label class="finance-workbench-select">
            <span>განყოფილება</span>
            <select class="finance-input" data-statistics-view-select aria-label="სტატისტიკის განყოფილება">
              ${STATISTICS_VIEWS.map((item) => `<option value="${escapeAttr(item.id)}" ${getStatisticsView() === item.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
            </select>
          </label>
          <label class="finance-workbench-select">
            <span>ძებნა</span>
            <input class="finance-input" id="statisticsSearch" type="search" value="${escapeAttr(state.statisticsSearch || "")}" placeholder="ძებნა">
          </label>
        </div>
      </div>
    </div>
  `;
}


function renderStatisticsKpis(report) {
  const totals = report.totals;
  return `
    ${renderStatisticsMetric("Total Orders", String(totals.totalOrders), "Σ", "finance-summary-item--accent")}
    ${renderStatisticsMetric("Delivered", String(totals.delivered), "✓", "finance-summary-item--delivered")}
    ${renderStatisticsMetric("Failed", String(totals.failed), "!", "finance-summary-item--alert")}
    ${renderStatisticsMetric("Pending", String(totals.pending), "•", "finance-summary-item--compact")}
    ${renderStatisticsMetric("Success Rate", `${totals.successRate}%`, "%", "finance-summary-item--final")}
    ${renderStatisticsMetric("Total COD", formatMoney(totals.totalCod), "₾", "finance-summary-item--cash")}
    ${renderStatisticsMetric("Delivery Revenue", formatMoney(totals.deliveryRevenue), "₾", "finance-summary-item--base")}
    ${renderStatisticsMetric("Courier Earnings", formatMoney(totals.courierEarnings), "₾", "finance-summary-item--base")}
    ${renderStatisticsMetric("Courier Payable", formatMoney(totals.courierPayable), "₾", "finance-summary-item--alert")}
    ${renderStatisticsMetric("Partner COD Payable", formatMoney(totals.partnerRemaining), "₾", "finance-summary-item--partner")}
    ${renderStatisticsMetric("Company Revenue", formatMoney(totals.companyRevenue), "₾", "finance-summary-item--hero finance-summary-item--final")}
  `;
}


function renderStatisticsDailyChart(report) {
  const maxOrders = Math.max(1, ...report.daily.map((day) => day.total));
  return `
    <section class="finance-section statistics-chart-panel">
      <div class="finance-analytics-bars statistics-bars">
        ${report.daily.map((day) => {
          const height = Math.max(8, Math.round((day.total / maxOrders) * 100));
          const tooltip = `${day.dateKey}: ${day.total} order, ${day.delivered} delivered, ${formatMoney(day.companyRevenue)}`;
          return `
            <button class="finance-analytics-bar statistics-bar" type="button" data-action="statisticsDay" data-value="${escapeAttr(day.dateKey)}" data-tooltip="${escapeAttr(tooltip)}" aria-label="${escapeAttr(tooltip)}">
              <span style="--bar-height: ${height}%"></span>
              <small>${escapeHtml(day.dateKey.slice(5))}</small>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}


function renderStatisticsOverview(report) {
  return `
    ${renderStatisticsDailyChart(report)}
    <section class="finance-section finance-action-queue statistics-action-queue">
      <article class="finance-action-card finance-action-card--collect finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["partners", report.totals.partnerRemaining]))}">
        <div><strong>Partner Statistics</strong><span>${escapeHtml(`${report.partnerSummaries.length} პარტნიორი · ${formatMoney(report.totals.partnerRemaining)}`)}</span></div>
        <button class="mini-button finance-button-primary" type="button" data-action="statisticsView" data-value="partners">გაშლა</button>
      </article>
      <article class="finance-action-card finance-action-card--pay finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["couriers", report.totals.courierPayable]))}">
        <div><strong>Courier Statistics</strong><span>${escapeHtml(`${report.courierSummaries.length} კურიერი · ${formatMoney(report.totals.courierPayable)}`)}</span></div>
        <button class="mini-button finance-button-primary" type="button" data-action="statisticsView" data-value="couriers">გაშლა</button>
      </article>
      <article class="finance-action-card finance-action-card--closed finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText(["failed", report.totals.failed]))}">
        <div><strong>Failed Orders</strong><span>${escapeHtml(`${report.totals.failed} ვერ ჩაბარდა · ${report.failedReasons.length} მიზეზი`)}</span></div>
        <button class="mini-button finance-button-primary" type="button" data-action="statisticsView" data-value="failed">გაშლა</button>
      </article>
    </section>
    ${renderStatisticsPartnerTable(report, 5)}
    ${renderStatisticsCourierTable(report, 5)}
  `;
}


function renderStatisticsPartnerTable(report, limit = 0) {
  const rows = (limit ? report.partnerSummaries.slice(0, limit) : report.partnerSummaries).map(({ partner, summary, paid, remainingToPay, successRate, averagePerDay }) => {
    const failed = summary.orders.filter((order) => order.status === "failed").length;
    return `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([partnerName(partner), partner.username, summary.orders.length, summary.baseCash]))}">
        ${renderFinanceCell("პარტნიორი", renderFinanceTableText(partnerName(partner), partner.username || partner.id || ""))}
        ${renderFinanceCell("Orders", String(summary.orders.length))}
        ${renderFinanceCell("Delivered", String(summary.deliveredOrders.length))}
        ${renderFinanceCell("Failed", String(failed))}
        ${renderFinanceCell("Pending", String(summary.pendingOrders.length))}
        ${renderFinanceCell("Success", `${successRate}%`)}
        ${renderFinanceCell("COD", formatMoney(summary.baseCash))}
        ${renderFinanceCell("Service", formatMoney(summary.serviceFees))}
        ${renderFinanceCell("Net COD", formatMoney(summary.netBalance))}
        ${renderFinanceCell("Paid", formatMoney(paid))}
        ${renderFinanceCell("Remaining", formatMoney(remainingToPay))}
        ${renderFinanceCell("Avg / Day", averagePerDay.toFixed(1))}
        ${renderFinanceCell("მოქმედება", renderFinanceTableAction("statisticsPartner", "დეტალურად", partner.username || partner.id || "", "mini-button finance-button-primary"))}
      </tr>
    `;
  });
  return renderFinanceListPanel({
    title: "Partner Statistics",
    badges: [`პარტნიორი: ${report.partnerSummaries.length}`, `გადასარიცხი: ${formatMoney(report.totals.partnerRemaining)}`],
    headers: ["პარტნიორი", "Orders", "Delivered", "Failed", "Pending", "Success", "COD", "Service", "Net COD", "Paid", "Remaining", "Avg / Day", ""],
    rows: rows.length ? rows : [`<tr><td colspan="13">პარტნიორის შეკვეთები ამ პერიოდში არ არის</td></tr>`],
  });
}


function renderStatisticsCourierTable(report, limit = 0) {
  const rows = (limit ? report.courierSummaries.slice(0, limit) : report.courierSummaries).map(({ courier, summary, assigned, paid, remaining, successRate, averagePerDay }) => `
    <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([userDisplayName(courier), courier.username, assigned, summary.finalPay]))}">
      ${renderFinanceCell("კურიერი", renderFinanceTableText(userDisplayName(courier), courier.username))}
      ${renderFinanceCell("Assigned", String(assigned))}
      ${renderFinanceCell("Delivered", String(summary.delivered))}
      ${renderFinanceCell("Failed", String(summary.failed))}
      ${renderFinanceCell("Pending", String(summary.pending))}
      ${renderFinanceCell("Success", `${successRate}%`)}
      ${renderFinanceCell("Earnings", formatMoney(summary.finalPay))}
      ${renderFinanceCell("Paid", formatMoney(paid))}
      ${renderFinanceCell("Remaining", formatMoney(remaining))}
      ${renderFinanceCell("Avg / Day", averagePerDay.toFixed(1))}
      ${renderFinanceCell("მოქმედება", renderFinanceTableAction("statisticsCourier", "დეტალურად", courier.username, "mini-button finance-button-primary"))}
    </tr>
  `);
  return renderFinanceListPanel({
    title: "Courier Statistics",
    badges: [`კურიერი: ${report.courierSummaries.length}`, `გადასახდელი: ${formatMoney(report.totals.courierPayable)}`],
    headers: ["კურიერი", "Assigned", "Delivered", "Failed", "Pending", "Success", "Earnings", "Paid", "Remaining", "Avg / Day", ""],
    rows: rows.length ? rows : [`<tr><td colspan="11">კურიერი ჯერ არ არის დამატებული</td></tr>`],
  });
}


function renderStatisticsDailyTable(report) {
  const rows = report.daily.map((day) => `
    <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([day.dateKey, day.total, day.delivered, day.failed, day.pending]))}">
      ${renderFinanceCell("დღე", renderFinanceTableText(day.dateKey, `${getStatisticsSuccessRate(day.delivered, day.failed)}% success`))}
      ${renderFinanceCell("Orders", String(day.total))}
      ${renderFinanceCell("Delivered", String(day.delivered))}
      ${renderFinanceCell("Failed", String(day.failed))}
      ${renderFinanceCell("Pending", String(day.pending))}
      ${renderFinanceCell("COD", formatMoney(day.cod))}
      ${renderFinanceCell("Delivery", formatMoney(day.deliveryRevenue))}
      ${renderFinanceCell("Courier", formatMoney(day.courierEarnings))}
      ${renderFinanceCell("Company", formatMoney(day.companyRevenue))}
      ${renderFinanceCell("მოქმედება", renderFinanceTableAction("statisticsDay", "შეკვეთები", day.dateKey, "mini-button finance-button-primary"))}
    </tr>
  `);
  return renderFinanceListPanel({
    title: "Daily Statistics",
    badges: [`დღე: ${report.daily.length}`],
    headers: ["დღე", "Orders", "Delivered", "Failed", "Pending", "COD", "Delivery", "Courier", "Company", ""],
    rows,
  });
}


function renderStatisticsFailedTable(report) {
  const rows = report.failedReasons.map((item) => `
    <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([item.reason, item.count]))}">
      ${renderFinanceCell("მიზეზი", renderFinanceTableText(item.reason, `${item.orders.length} შეკვეთა`))}
      ${renderFinanceCell("რაოდენობა", String(item.count))}
      ${renderFinanceCell("მოქმედება", renderFinanceTableAction("statisticsOrders", "შეკვეთები", `failed|${item.reason}`, "mini-button finance-button-primary"))}
    </tr>
  `);
  return renderFinanceListPanel({
    title: "Failed Orders",
    badges: [`ვერ ჩაბარდა: ${report.totals.failed}`, `მიზეზი: ${report.failedReasons.length}`],
    headers: ["მიზეზი", "რაოდენობა", ""],
    rows: rows.length ? rows : [`<tr><td colspan="3">ამ პერიოდში ვერ ჩაბარებული შეკვეთა არ არის</td></tr>`],
  });
}


function renderStatisticsPaymentsTable(report) {
  const rows = report.paymentRows.map((entry) => {
    const owner = entry.type === "partner" ? entry.label || entry.partnerUsername || entry.partnerId : entry.label || entry.username;
    return `
      <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([entry.type, owner, entry.amount, entry.rangeStart, entry.rangeEnd]))}">
        ${renderFinanceCell("ტიპი", entry.type === "partner" ? "Partner" : "Courier")}
        ${renderFinanceCell("ვისზე", renderFinanceTableText(owner, formatDateRangeLabel(entry.rangeStart, entry.rangeEnd)))}
        ${renderFinanceCell("თანხა", formatMoney(entry.amount))}
        ${renderFinanceCell("დრო", formatDateTime(entry.updatedAt || entry.createdAt))}
        ${renderFinanceCell("შენიშვნა", escapeHtml(entry.note || ""))}
      </tr>
    `;
  });
  return renderFinanceListPanel({
    title: "Payment History",
    badges: [`ჩანაწერი: ${report.paymentRows.length}`, `კურიერი: ${formatMoney(report.totals.courierPaid)}`, `პარტნიორი: ${formatMoney(report.totals.partnerPaid)}`],
    headers: ["ტიპი", "ვისზე", "თანხა", "დრო", "შენიშვნა"],
    rows: rows.length ? rows : [`<tr><td colspan="5">ამ პერიოდში გადახდის ჩანაწერი არ არის</td></tr>`],
  });
}


function renderStatisticsOrdersTable(report, orders = report.records, title = "Orders") {
  const rows = (Array.isArray(orders) ? orders : []).map((order) => `
    <tr class="finance-workbench-search-row" data-finance-search="${escapeAttr(financeSearchText([order.fullName, order.phone, order.courierUsername, orderPartnerName(order), order.status]))}">
      ${renderFinanceCell("მიმღები", renderFinanceTableText(order.fullName || "სახელი არ არის", order.phone || ""))}
      ${renderFinanceCell("სტატუსი", renderAppStatusBadge(order.status || "pending", order.status || "pending"))}
      ${renderFinanceCell("პარტნიორი", escapeHtml(orderPartnerName(order)))}
      ${renderFinanceCell("კურიერი", escapeHtml(order.courierUsername || "მიუბმელი"))}
      ${renderFinanceCell("COD", formatMoney(getPaymentAmount(order)))}
      ${renderFinanceCell("Delivery", formatMoney(getDeliveryTotal(order)))}
      ${renderFinanceCell("Courier", formatMoney(getCourierPay(order)))}
      ${renderFinanceCell("Company", formatMoney(getAdminProfit(order)))}
      ${renderFinanceCell("დღე", escapeHtml(getParcelStatsDateKey(order)))}
      ${renderFinanceCell("მოქმედება", order.id ? renderFinanceTableAction("focusStatsParcel", "რუკა", order.id, "mini-button") : "")}
    </tr>
  `);
  return renderFinanceListPanel({
    title,
    badges: [`შეკვეთა: ${orders.length}`],
    headers: ["მიმღები", "სტატუსი", "პარტნიორი", "კურიერი", "COD", "Delivery", "Courier", "Company", "დღე", ""],
    rows: rows.length ? rows : [`<tr><td colspan="10">ამ პერიოდში შეკვეთა არ არის</td></tr>`],
  });
}


function renderStatisticsContent(report) {
  const view = getStatisticsView();
  if (view === "partners") return renderStatisticsPartnerTable(report);
  if (view === "couriers") return renderStatisticsCourierTable(report);
  if (view === "daily") return `${renderStatisticsDailyChart(report)}${renderStatisticsDailyTable(report)}`;
  if (view === "failed") return renderStatisticsFailedTable(report);
  if (view === "payments") return renderStatisticsPaymentsTable(report);
  if (view === "orders") return renderStatisticsOrdersTable(report);
  return renderStatisticsOverview(report);
}


function renderStatisticsDashboard(report) {
  return renderFinanceModalLayout({
    filters: renderStatisticsFilters(report),
    summary: renderStatisticsKpis(report),
    content: `<div class="finance-workbench statistics-workbench">${renderStatisticsContent(report)}<p class="history-empty finance-workbench-empty" hidden>ჩანაწერი ვერ მოიძებნა.</p></div>`,
  });
}


function bindStatisticsDashboardEvents(report) {
  document.querySelector("[data-statistics-apply]")?.addEventListener("click", async () => {
    const range = normalizeDateRange(
      document.getElementById("statisticsStartDate")?.value,
      document.getElementById("statisticsEndDate")?.value,
    );
    setStatisticsRange(range.start, range.end);
    await openStatisticsDashboard({ preserveSearch: true });
  });
  document.querySelector("[data-statistics-range-select]")?.addEventListener("change", async (event) => {
    const value = event.currentTarget.value;
    if (!value) return;
    if (value === "export") {
      exportStatisticsCsv(report);
      event.currentTarget.value = "";
      return;
    }
    const range = getStatisticsQuickRange(value, toDateKey(new Date()));
    setStatisticsRange(range.start, range.end);
    await openStatisticsDashboard({ preserveSearch: true });
  });
  document.querySelector("[data-statistics-view-select]")?.addEventListener("change", (event) => {
    state.statisticsView = getStatisticsView(event.currentTarget.value);
    const workbench = document.querySelector(".statistics-workbench");
    if (workbench) {
      workbench.innerHTML = `${renderStatisticsContent(report)}<p class="history-empty finance-workbench-empty" hidden>ჩანაწერი ვერ მოიძებნა.</p>`;
      applyFinanceDashboardSearch();
    }
  });
  const searchInput = document.getElementById("statisticsSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.statisticsSearch = searchInput.value;
      state.financeAdminSearch = state.statisticsSearch;
      applyFinanceDashboardSearch();
    });
    state.financeAdminSearch = state.statisticsSearch || "";
    applyFinanceDashboardSearch();
  }
}


async function openStatisticsDashboard(options = {}) {
  if (!state.isAdmin) return;
  state.statisticsView = getStatisticsView(state.statisticsView);
  if (!options.preserveSearch) state.statisticsSearch = "";
  const requestToken = `statistics:${Date.now()}:${Math.random()}`;
  state.statisticsDashboardRequestToken = requestToken;
  showDialog("სტატისტიკა", renderFinanceLoadingState("სტატისტიკა იტვირთება..."), [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  const report = await getStatisticsReport();
  if (state.statisticsDashboardRequestToken !== requestToken || state.activeDialogTitle !== "სტატისტიკა") return;
  state.statisticsReport = report;
  state.financeAdminSearch = state.statisticsSearch || "";
  showDialog("სტატისტიკა", renderStatisticsDashboard(report), [
    { label: "CSV", variant: "primary", action: () => exportStatisticsCsv(report) },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  bindStatisticsDashboardEvents(report);
}


async function getActiveStatisticsReport() {
  return state.statisticsReport || getStatisticsReport();
}


async function openStatisticsPartner(identity) {
  const report = await getActiveStatisticsReport();
  const partnerSummary = report.partnerSummaries.find(({ partner }) => (
    normalizeUsername(partner.username) === normalizeUsername(identity)
    || String(partner.id || "") === String(identity || "")
  ));
  if (!partnerSummary) return;
  const { partner, summary, paid, remainingToPay, successRate, averagePerDay } = partnerSummary;
  const daily = getStatisticsDailyBreakdown(summary.orders, report.range);
  const body = renderFinanceModalLayout({
    summary: `
      ${renderStatisticsMetric("Orders", String(summary.orders.length), "Σ", "finance-summary-item--accent")}
      ${renderStatisticsMetric("Delivered", String(summary.deliveredOrders.length), "✓", "finance-summary-item--delivered")}
      ${renderStatisticsMetric("Failed", String(summary.orders.filter((order) => order.status === "failed").length), "!", "finance-summary-item--alert")}
      ${renderStatisticsMetric("Success Rate", `${successRate}%`, "%", "finance-summary-item--final")}
      ${renderStatisticsMetric("Total COD", formatMoney(summary.baseCash), "₾", "finance-summary-item--cash")}
      ${renderStatisticsMetric("Delivery Cost", formatMoney(summary.serviceFees), "₾", "finance-summary-item--base")}
      ${renderStatisticsMetric("Net COD", formatMoney(summary.netBalance), "₾", "finance-summary-item--partner")}
      ${renderStatisticsMetric("Paid To Partner", formatMoney(paid), "₾", "finance-summary-item--base")}
      ${renderStatisticsMetric("Remaining To Pay", formatMoney(remainingToPay), "₾", "finance-summary-item--hero finance-summary-item--final")}
      ${renderStatisticsMetric("Avg Orders / Day", averagePerDay.toFixed(1), "∅", "finance-summary-item--compact")}
    `,
    content: `<div class="finance-workbench statistics-workbench">${renderStatisticsDailyTable({ ...report, daily })}${renderStatisticsOrdersTable(report, summary.orders, "Partner Orders")}</div>`,
  });
  showDialog(`${partnerName(partner)} სტატისტიკა`, body, [
    { label: "უკან", variant: "secondary", action: openStatisticsDashboard },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function openStatisticsCourier(username) {
  const report = await getActiveStatisticsReport();
  const courierSummary = report.courierSummaries.find(({ courier }) => normalizeUsername(courier.username) === normalizeUsername(username));
  if (!courierSummary) return;
  const { courier, summary, assigned, paid, remaining, successRate, averagePerDay } = courierSummary;
  const daily = getStatisticsDailyBreakdown(summary.records, report.range);
  const body = renderFinanceModalLayout({
    summary: `
      ${renderStatisticsMetric("Assigned", String(assigned), "Σ", "finance-summary-item--accent")}
      ${renderStatisticsMetric("Delivered", String(summary.delivered), "✓", "finance-summary-item--delivered")}
      ${renderStatisticsMetric("Failed", String(summary.failed), "!", "finance-summary-item--alert")}
      ${renderStatisticsMetric("Pending", String(summary.pending), "•", "finance-summary-item--compact")}
      ${renderStatisticsMetric("Success Rate", `${successRate}%`, "%", "finance-summary-item--final")}
      ${renderStatisticsMetric("Courier Earnings", formatMoney(summary.finalPay), "₾", "finance-summary-item--cash")}
      ${renderStatisticsMetric("Already Paid", formatMoney(paid), "₾", "finance-summary-item--base")}
      ${renderStatisticsMetric("Remaining To Pay", formatMoney(remaining), "₾", "finance-summary-item--hero finance-summary-item--final")}
      ${renderStatisticsMetric("Avg Deliveries / Day", averagePerDay.toFixed(1), "∅", "finance-summary-item--compact")}
    `,
    content: `<div class="finance-workbench statistics-workbench">${renderStatisticsDailyTable({ ...report, daily })}${renderStatisticsOrdersTable(report, summary.records, "Courier Orders")}</div>`,
  });
  showDialog(`${userDisplayName(courier)} სტატისტიკა`, body, [
    { label: "უკან", variant: "secondary", action: openStatisticsDashboard },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function openStatisticsDay(dateKey) {
  const report = await getActiveStatisticsReport();
  const day = normalizeDateKey(dateKey);
  if (!day) return;
  const orders = report.records.filter((order) => getParcelStatsDateKey(order) === day);
  const summary = calculateFinanceSummary({ records: orders }, { startDate: day, endDate: day });
  const body = renderFinanceModalLayout({
    summary: `
      ${renderStatisticsMetric("Orders", String(orders.length), "Σ", "finance-summary-item--accent")}
      ${renderStatisticsMetric("Delivered", String(summary.delivered), "✓", "finance-summary-item--delivered")}
      ${renderStatisticsMetric("Failed", String(summary.failed), "!", "finance-summary-item--alert")}
      ${renderStatisticsMetric("Pending", String(summary.pending), "•", "finance-summary-item--compact")}
      ${renderStatisticsMetric("COD", formatMoney(summary.totalOrdersAmount), "₾", "finance-summary-item--cash")}
      ${renderStatisticsMetric("Company", formatMoney(summary.adminProfit), "₾", "finance-summary-item--hero finance-summary-item--final")}
    `,
    content: `<div class="finance-workbench statistics-workbench">${renderStatisticsOrdersTable(report, orders, `${day} Orders`)}</div>`,
  });
  showDialog(`${day} სტატისტიკა`, body, [
    { label: "უკან", variant: "secondary", action: openStatisticsDashboard },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function openStatisticsOrders(value = "all") {
  const report = await getActiveStatisticsReport();
  const [status, reason] = String(value || "all").split("|");
  const orders = report.records.filter((order) => {
    if (status === "all") return true;
    if (order.status !== status) return false;
    return !reason || String(order.failureReason || "მიზეზი არ არის მითითებული").trim() === reason;
  });
  showDialog("შეკვეთები", renderFinanceModalLayout({
    content: `<div class="finance-workbench statistics-workbench">${renderStatisticsOrdersTable(report, orders)}</div>`,
  }), [
    { label: "უკან", variant: "secondary", action: openStatisticsDashboard },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


function setStatisticsView(value) {
  state.statisticsView = getStatisticsView(value);
  return openStatisticsDashboard({ preserveSearch: true });
}


function exportStatisticsCsv(report = state.statisticsReport) {
  if (!report) return;
  const rows = [
    ["range", report.range.start, report.range.end],
    ["totalOrders", report.totals.totalOrders],
    ["delivered", report.totals.delivered],
    ["failed", report.totals.failed],
    ["pending", report.totals.pending],
    ["successRate", report.totals.successRate],
    ["totalCod", report.totals.totalCod],
    ["deliveryRevenue", report.totals.deliveryRevenue],
    ["courierEarnings", report.totals.courierEarnings],
    ["courierPaid", report.totals.courierPaid],
    ["courierPayable", report.totals.courierPayable],
    ["partnerPaid", report.totals.partnerPaid],
    ["partnerRemaining", report.totals.partnerRemaining],
    ["companyRevenue", report.totals.companyRevenue],
    [],
    ["daily", "orders", "delivered", "failed", "pending", "cod", "deliveryRevenue", "courierEarnings", "companyRevenue"],
    ...report.daily.map((day) => [day.dateKey, day.total, day.delivered, day.failed, day.pending, day.cod, day.deliveryRevenue, day.courierEarnings, day.companyRevenue]),
    [],
    ["partners", "orders", "delivered", "failed", "pending", "cod", "service", "netCod", "paid", "remaining"],
    ...report.partnerSummaries.map(({ partner, summary, paid, remainingToPay }) => [
      partnerName(partner),
      summary.orders.length,
      summary.deliveredOrders.length,
      summary.orders.filter((order) => order.status === "failed").length,
      summary.pendingOrders.length,
      summary.baseCash,
      summary.serviceFees,
      summary.netBalance,
      paid,
      remainingToPay,
    ]),
    [],
    ["couriers", "assigned", "delivered", "failed", "pending", "earnings", "paid", "remaining"],
    ...report.courierSummaries.map(({ courier, summary, assigned, paid, remaining }) => [
      userDisplayName(courier),
      assigned,
      summary.delivered,
      summary.failed,
      summary.pending,
      summary.finalPay,
      paid,
      remaining,
    ]),
  ];
  downloadFinanceCsv(`statistics-${report.range.start}-${report.range.end}.csv`, rows);
  showToast("სტატისტიკის CSV მზადაა");
}


async function openAdminDailyBalance(startDate = state.financeRangeStart || state.financeDate || toDateKey(new Date()), endDate = state.financeRangeEnd || startDate) {
  if (!state.isAdmin) return;
  const range = normalizeDateRange(startDate, endDate);
  state.financeDate = range.start;
  setFinanceCourierRange(range.start, range.end);

  const [users, records, partners, ledger] = await Promise.all([
    getUsers().catch(() => []),
    getAllFinanceRecords({ startDate: range.start, endDate: range.end }),
    typeof getPartners === "function" ? getPartners().catch(() => []) : [],
    (async () => {
      if (typeof loadPartnerCashAdjustments === "function") await loadPartnerCashAdjustments().catch(() => []);
      return loadDailyBalanceLedger();
    })(),
  ]);
  const activeRecords = (Array.isArray(records) ? records : []).filter((parcel) => !parcel.archivedAt);
  const archivedRecords = (Array.isArray(records) ? records : []).filter((parcel) => parcel.archivedAt);
  const partnerRecords = typeof mergePartnerOrderRecords === "function" ? mergePartnerOrderRecords(activeRecords, archivedRecords) : records;

  const couriers = users.filter((user) => user.role === "courier");
  const courierSummaries = couriers.map((courier) => ({
    courier,
    summary: calculateFinanceSummary({ records }, { username: courier.username, startDate: range.start, endDate: range.end }),
  }));
  const partnerSummaries = (Array.isArray(partners) ? partners : []).map((partner) => ({
    partner,
    summary: (() => {
      const summary = calculatePartnerCashSummaryForRange(partner, partnerRecords, range.start, range.end);
      return applyPartnerPaidToSummary(summary, getPartnerPaidAmount(ledger, partner, range));
    })(),
  })).filter(({ summary }) => partnerSummaryHasOrders(summary));
  const daySummary = calculateFinanceSummary({ records }, { startDate: range.start, endDate: range.end });
  const deliveredOrders = daySummary.deliveredRecords || [];
  const totalCourierPay = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.finalPay, 0));
  const courierBasePay = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.basePay, 0));
  const courierAdjustments = safeMoney(courierSummaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const totalPartnerCash = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.partnerReturnDue, 0));
  const partnerBaseCash = safeMoney(partnerSummaries.reduce((sum, item) => sum + (item.summary.outstandingCash ?? item.summary.baseCash), 0));
  const partnerServiceFees = safeMoney(partnerSummaries.reduce((sum, item) => sum + (item.summary.outstandingServiceFees ?? item.summary.serviceFees), 0));
  const partnerPaymentDue = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.partnerPaymentDue, 0));
  const partnerNetBalance = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.netBalance, 0));
  const totalPartnerSettlement = safeMoney(totalPartnerCash + partnerPaymentDue);
  const partnerAdjustments = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const adjustedProfit = safeMoney(daySummary.deliveryFees - totalCourierPay);
  const paidCourierTotal = safeMoney(courierSummaries.reduce((sum, item) => (
    sum + (findDailyBalanceEntry(ledger, "courier", range, item.courier.username)?.amount || 0)
  ), 0));
  const paidPartnerTotal = safeMoney(partnerSummaries.reduce((sum, item) => sum + item.summary.paidAmount, 0));
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
          label: "პარტნიორებისთვის გადასარიცხი",
          value: formatMoney(totalPartnerCash),
        })}
        ${renderFinanceSummaryItem({
          className: "finance-summary-item--compact",
          icon: "₾",
          label: "პარტნიორის მომსახურება",
          value: formatMoney(partnerServiceFees),
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
    <article class="finance-card finance-mini-card finance-static-card finance-card--partner ${Math.max(partnerSummary.partnerReturnDue, partnerSummary.partnerPaymentDue) > 0 ? "finance-card--alert" : ""}">
      <span class="finance-summary-icon finance-summary-icon--cash" aria-hidden="true">₾</span>
      <span>${escapeHtml(partnerName(partner))}</span>
      <small>ჩაბარებული: ${escapeHtml(String(partnerSummary.deliveredOrders.length))}</small>
      <strong>${escapeHtml(formatMoney(partnerSummary.netBalance))}</strong>
      <small>COD: ${escapeHtml(formatMoney(partnerSummary.outstandingCash ?? partnerSummary.baseCash))} · მომსახურება: ${escapeHtml(formatMoney(partnerSummary.outstandingServiceFees ?? partnerSummary.serviceFees))}</small>
      <small>დასაბრუნებელი: ${escapeHtml(formatMoney(partnerSummary.partnerReturnDue))} · გადასახდელი: ${escapeHtml(formatMoney(partnerSummary.partnerPaymentDue))}</small>
      <small>${escapeHtml(getAdjustmentDirectionLabel(partnerSummary.adjustmentTotal))}: ${escapeHtml(formatAdjustmentDisplay(partnerSummary.adjustmentTotal))}</small>
      <small>მოლოდინში: ${escapeHtml(formatMoney(partnerSummary.pendingCash))}</small>
      ${renderDailyBalancePaidControl("partner", range, partner.username || partner.id, partnerName(partner), Math.max(partnerSummary.partnerReturnDue, partnerSummary.partnerPaymentDue), partnerSummary.deliveredOrders.length, ledger, { partnerId: partner.id || "", partnerUsername: partner.username || "" })}
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
      subtitle: `COD ${formatMoney(partnerBaseCash)}, მომსახურება ${formatMoney(partnerServiceFees)}, მისაღები ${formatMoney(partnerPaymentDue)}`,
      badge: `${formatMoney(paidPartnerTotal)} / ${formatMoney(totalPartnerSettlement)}`,
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
      partnerBaseCash,
      partnerServiceFees,
      partnerPaymentDue,
      partnerNetBalance,
      totalPartnerSettlement,
      partnerAdjustments,
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
      if (state.activeDialogTitle === "ფინანსები") await openFinanceDashboard();
      else await openAdminDailyBalance(report.range.start, report.range.end);
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
  if (state.activeDialogTitle === "ფინანსები") await openFinanceDashboard();
  else await openAdminDailyBalance(range.start, range.end);
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
    ["section", "name", "delivered", "cod", "service_fee", "partner_return_due", "partner_payment_due", "partner_net", "courier_pay", "profit", "adjustment", "period"],
    ["summary", "კურიერებზე გადასახდელი", totals.delivered, "", "", "", "", "", totals.totalCourierPay, "", "", formatDateRangeLabel(range.start, range.end)],
    ["summary", "პარტნიორების ბალანსი", "", totals.partnerBaseCash || 0, totals.partnerServiceFees || 0, totals.totalPartnerCash || 0, totals.partnerPaymentDue || 0, totals.partnerNetBalance || 0, "", totals.adjustedProfit, totals.partnerAdjustments || 0, formatDateRangeLabel(range.start, range.end)],
    ["summary", "კომპანიის მოგება", totals.delivered, "", totals.deliveryFees || 0, "", "", "", totals.totalCourierPay, totals.adjustedProfit, "", formatDateRangeLabel(range.start, range.end)],
    ...courierSummaries.map(({ courier, summary }) => [
      "courier",
      userDisplayName(courier),
      summary.delivered,
      "",
      "",
      "",
      "",
      "",
      summary.finalPay,
      "",
      summary.adjustmentTotal,
      formatDateRangeLabel(range.start, range.end),
    ]),
    ...partnerSummaries.map(({ partner, summary }) => [
      "partner",
      partnerName(partner),
      summary.deliveredOrders.length,
      summary.outstandingCash ?? summary.baseCash,
      summary.outstandingServiceFees ?? summary.serviceFees,
      summary.partnerReturnDue,
      summary.partnerPaymentDue,
      summary.netBalance,
      "",
      "",
      summary.adjustmentTotal,
      formatDateRangeLabel(range.start, range.end),
    ]),
    ...deliveredOrders.map((order) => {
      const cod = getPaymentAmount(order);
      const serviceFee = getPartnerOrderServiceFee(order);
      return [
        "order",
        order.fullName || "",
        1,
        cod,
        serviceFee,
        Math.max(0, safeMoney(cod - serviceFee)),
        Math.max(0, safeMoney(serviceFee - cod)),
        safeMoney(cod - serviceFee),
        getCourierPay(order),
        getAdminProfit(order),
        "",
        getParcelStatsDateKey(order),
      ];
    }),
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
  const recordOptions = { dateFrom: range.start, dateTo: range.end };
  const [users, pins, history] = await Promise.all([
    getUsers().catch(() => []),
    getPins(username, recordOptions),
    getHistory(username, recordOptions),
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
  const range = getFinanceCourierRange();
  const [users, records] = await Promise.all([
    getUsers(),
    getAllFinanceRecords({ startDate: range.start, endDate: range.end }),
  ]);
  const couriers = users.filter((user) => user.role === "courier");
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
  const range = getFinanceCourierRange();
  const [users, records] = await Promise.all([
    getUsers(),
    getAllFinanceRecords({ startDate: range.start, endDate: range.end }),
  ]);
  const couriers = users.filter((user) => user.role === "courier");
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
  const range = getFinanceCourierRange();
  const [partners, records, , ledger] = await Promise.all([
    getPartners().catch(() => []),
    getAllFinanceRecords({ startDate: range.start, endDate: range.end }),
    typeof loadPartnerCashAdjustments === "function" ? loadPartnerCashAdjustments().catch(() => []) : [],
    loadDailyBalanceLedger().catch(() => readDailyBalanceLedger()),
  ]);
  const summaries = partners.map((partner) => ({
    partner,
    summary: applyPartnerPaidToSummary(
      calculatePartnerCashSummaryForRange(partner, records, range.start, range.end),
      getPartnerPaidAmount(ledger, partner, range),
    ),
  }));
  const cashDue = safeMoney(summaries.reduce((sum, item) => sum + item.summary.cashDue, 0));
  const baseCash = safeMoney(summaries.reduce((sum, item) => sum + item.summary.baseCash, 0));
  const adjustmentTotal = safeMoney(summaries.reduce((sum, item) => sum + item.summary.adjustmentTotal, 0));
  const pendingCash = safeMoney(summaries.reduce((sum, item) => sum + item.summary.pendingCash, 0));
  const filters = renderDateRangeToolbar({
    startId: "financePartnerCashStartDate",
    endId: "financePartnerCashEndDate",
    start: range.start,
    end: range.end,
    applySelector: "data-finance-partner-cash-range-apply",
    className: "finance-range-toolbar",
  });
  const content = renderFinanceListPanel({
    title: "პარტნიორის ბალანსი",
    badges: [
      `სულ: ${formatMoney(cashDue)}`,
      `ჩაბარებული: ${formatMoney(baseCash)}`,
      `მოლოდინში: ${formatMoney(pendingCash)}`,
      formatDateRangeLabel(range.start, range.end),
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
  const body = renderFinanceModalLayout({ filters, content });
  showDialog("პარტნიორის ბალანსი", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
  bindDateRangeToolbar({
    startId: "financePartnerCashStartDate",
    endId: "financePartnerCashEndDate",
    applySelector: "[data-finance-partner-cash-range-apply]",
    onApply: async (selectedRange) => {
      setFinanceCourierRange(selectedRange.start, selectedRange.end);
      await openFinancePartnerCash();
    },
  });
}


async function openFinanceDayClose() {
  if (!state.isAdmin) return;
  const todayKey = toDateKey(new Date());
  const recordOptions = { dateFrom: todayKey, dateTo: todayKey };
  const [pins, history] = await Promise.all([getPins("", recordOptions), getHistory("", recordOptions)]);
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
          label: "დასახური დასრულებული პინები",
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
  const recordOptions = { dateFrom: range.start, dateTo: range.end };
  const [pins, history] = await Promise.all([getPins("", recordOptions), getHistory("", recordOptions)]);
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
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords({ startDate: range.start, endDate: range.end });
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
  const records = await getAllFinanceRecords({ startDate: range.start, endDate: range.end });
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
  await writeCashAdjustments([...readCashAdjustments(), adjustment]);
}


async function zeroCashAdjustment(username) {
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords({ startDate: range.start, endDate: range.end });
  const currentCash = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end }).cashReceived;
  await addCashAdjustment(username, currentCash);
}


async function openPayAdjustmentDialog(username) {
  if (!state.isAdmin) return;
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords({ startDate: range.start, endDate: range.end });
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
  const records = await getAllFinanceRecords({ startDate: range.start, endDate: range.end });
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
  await writePayAdjustments([...readPayAdjustments(), adjustment]);
}


async function zeroPayAdjustment(username) {
  const range = getFinanceCourierRange();
  const records = await getAllFinanceRecords({ startDate: range.start, endDate: range.end });
  const { finalPay: currentPay } = calculateFinanceSummary({ records }, { username, startDate: range.start, endDate: range.end });
  await addPayAdjustment(username, currentPay);
}
