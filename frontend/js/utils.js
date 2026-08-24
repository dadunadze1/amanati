"use strict";



function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}


function roleLabel(role) {
  if (role === "partner") return "პარტნიორი";
  return role === "admin" ? "ადმინი" : "კურიერი";
}


function updateAppViewportVars() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const viewport = window.visualViewport;
  const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
  const width = Math.round(window.innerWidth || document.documentElement.clientWidth || viewport?.width || 0);
  if (height > 0) document.documentElement.style.setProperty("--app-viewport-height", `${height}px`);
  if (width > 0) document.documentElement.style.setProperty("--app-viewport-width", `${width}px`);
}


function bindAppViewportVars() {
  if (typeof window === "undefined") return;
  if (bindAppViewportVars.bound) {
    updateAppViewportVars();
    return;
  }
  bindAppViewportVars.bound = true;
  updateAppViewportVars();
  window.addEventListener("resize", updateAppViewportVars, { passive: true });
  window.addEventListener("orientationchange", () => {
    [0, 120, 360].forEach((delay) => window.setTimeout(updateAppViewportVars, delay));
  }, { passive: true });
  window.visualViewport?.addEventListener("resize", updateAppViewportVars, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateAppViewportVars, { passive: true });
}


function stabilizeAppViewportAfterLogin() {
  if (typeof window === "undefined") return;
  [0, 60, 160, 360, 720, 1200].forEach((delay) => {
    window.setTimeout(() => {
      updateAppViewportVars();
      state.map?.invalidateSize?.({ pan: false });
    }, delay);
  });
}


function getStatusLabel(status) {
  if (status === "partner_pending") return "ადმინის დასადასტურებელია";
  if (status === "delivered") return "ჩაბარდა";
  if (status === "failed") return "არ ჩაბარდა";
  return "პროცესშია";
}


function getPartnerOrderStatusLabel(parcel) {
  if (parcel?.status === "delivered") return "ჩაბარდა";
  if (parcel?.status === "failed") return "ვერ ჩაბარდა";
  if (!parcel?.courierUsername) return "ელოდება ადმინის დადასტურებას";
  return "კურიერზე მიბმულია";
}


function getStatusSortValue(status) {
  if (status === "pending") return 0;
  if (status === "failed") return 1;
  return 2;
}


function isCompletedParcelStatus(parcel) {
  return parcel?.status === "delivered";
}


function safeMoney(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}


function normalizeDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const text = value.trim();
    const plainDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (plainDateMatch) return `${plainDateMatch[1]}-${plainDateMatch[2]}-${plainDateMatch[3]}`;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match && !/[Tt]|[Zz]|[+-]\d{2}:?\d{2}$/.test(text)) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toDateKey(date);
}


function getParcelStatsDateKey(parcel) {
  if (!parcel || typeof parcel !== "object") return "";
  const statusDates = parcel.status === "delivered"
    ? [parcel.financeDateKey, parcel.completedWorkdayKey, parcel.workdayKey, parcel.deliveredAt, parcel.completedAt, parcel.archivedAt, parcel.updatedAt]
    : parcel.status === "failed"
      ? [parcel.completedWorkdayKey, parcel.workdayKey, parcel.failedAt, parcel.completedAt, parcel.archivedAt, parcel.updatedAt]
      : [parcel.workdayKey, parcel.assignedAt, parcel.createdAt, parcel.updatedAt];
  return statusDates.concat([parcel.createdAt]).map(normalizeDateKey).find(Boolean) || "";
}


function getParcelStatsDateKeys(parcel) {
  const dateKey = getParcelStatsDateKey(parcel);
  return dateKey ? [dateKey] : [];
}


function parcelMatchesStatsDate(parcel, dateKey) {
  return getParcelStatsDateKey(parcel) === normalizeDateKey(dateKey);
}


function parcelMatchesStatsDateRange(parcel, startDate, endDate) {
  const dateKey = getParcelStatsDateKey(parcel);
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate || startDate);
  if (!dateKey || !start || !end) return false;
  return start <= end ? dateKey >= start && dateKey <= end : dateKey >= end && dateKey <= start;
}


function userDisplayName(user) {
  if (user?.role === "partner") return user.companyName || user.contactPerson || user.username;
  const fullName = userFullName(user);
  return fullName ? `${fullName} (${user.username})` : user.username;
}


function userFullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
}


function parcelCourierDisplayName(parcel) {
  if (!parcel?.courierUsername) return "მიუბმელი";
  return userFullName(parcel.courier) || parcel.courierUsername;
}


function parcelCourierPhone(parcel) {
  return parcel?.courier?.phone || "";
}


function parcelZoneLabel(parcel) {
  return parcel?.zoneName || "ზონა არ მოიძებნა";
}


function parcelAutoAssignLabel(parcel) {
  return parcel?.autoAssigned ? "ავტომატურად მიება" : "ხელით/მიუბმელი";
}


function parcelAssignedDate(parcel) {
  if (!parcel?.courierUsername) return "";
  return parcel.assignedAt || parcel.createdAt || "";
}


function parcelFailureReason(parcel) {
  return parcel?.failureReason || parcel?.failedReason || parcel?.failReason || parcel?.reason || "";
}


function userProfileFields(user = {}) {
  return `
    <label for="userFirstName">სახელი</label>
    <input id="userFirstName" type="text" autocomplete="given-name" value="${escapeAttr(user.firstName || "")}">
    <label for="userLastName">გვარი</label>
    <input id="userLastName" type="text" autocomplete="family-name" value="${escapeAttr(user.lastName || "")}">
    <label for="userPhone">მობილურის ნომერი</label>
    <input id="userPhone" type="tel" autocomplete="tel" value="${escapeAttr(user.phone || "")}">
    <label for="userBankDetails">საბანკო რეკვიზიტები</label>
    <textarea id="userBankDetails" rows="3">${escapeHtml(user.bankDetails || "")}</textarea>
  `;
}


function readUserProfileFields() {
  return {
    firstName: document.getElementById("userFirstName")?.value.trim() || "",
    lastName: document.getElementById("userLastName")?.value.trim() || "",
    phone: document.getElementById("userPhone")?.value.trim() || "",
    bankDetails: document.getElementById("userBankDetails")?.value.trim() || "",
  };
}


function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}


function escapeAttr(value) {
  return escapeHtml(value);
}


function renderAppListPanel({ title = "", badges = [], headers = [], rows = [], emptyMessage = "ჩანაწერი არ არის" }) {
  const visibleRows = rows.filter(Boolean);
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
          ${visibleRows.length ? visibleRows.join("") : `<tr><td colspan="${Math.max(headers.length, 1)}">${escapeHtml(emptyMessage)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}


function renderAppTableText(title, subtitle = "") {
  return `
    <strong>${escapeHtml(title || "არ არის")}</strong>
    ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
  `;
}


function renderAppStatusBadge(status, label = "") {
  return `<span class="history-status status-${escapeAttr(status || "pending")}">${escapeHtml(label || getStatusLabel(status))}</span>`;
}


function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("ka-GE") : "";
}


function formatMoney(value) {
  const amount = safeMoney(value);
  return `${amount.toFixed(2)} ლარი`;
}


function formatPinMoney(value) {
  return `${Number(value).toLocaleString("ka-GE", { maximumFractionDigits: 2 })} ლარი`;
}


function formatDistance(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1000) return `${Math.round(value)} მ`;
  return `${(value / 1000).toFixed(1)} კმ`;
}


function formatMonthYear(date) {
  const months = [
    "იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
    "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი",
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}


function getPaymentAmount(parcel) {
  return [parcel?.paymentAmount, parcel?.cashAmount, parcel?.payment, parcel?.amount, parcel?.price, parcel?.codAmount]
    .map(safeMoney)
    .find((amount) => Number.isFinite(amount) && amount > 0) || 0;
}


function hasMoneyValue(value) {
  return value !== undefined && value !== null && value !== "";
}


function getDefaultTariffSettings() {
  const defaults = CONFIG.defaultTariffs || {};
  return {
    city: normalizeDefaultTariffRow(defaults.city, { id: "city", label: "თბილისი", partnerPrice: CONFIG.deliveryTotalPrice, courierPay: CONFIG.courierDeliveryPay }),
    suburbs: normalizeDefaultTariffRow(defaults.suburbs, { id: "suburbs", label: "შემოგარენი", partnerPrice: 8, courierPay: 5.5 }),
    volume_u5: normalizeDefaultTariffRow(defaults.volume_u5, { id: "volume_u5", label: "5 კგ-მდე", partnerPrice: 8, courierPay: CONFIG.courierDeliveryPay }),
    volume_5_10: normalizeDefaultTariffRow(defaults.volume_5_10, { id: "volume_5_10", label: "5-10 კგ", partnerPrice: 10, courierPay: CONFIG.courierDeliveryPay }),
    volume_10_15: normalizeDefaultTariffRow(defaults.volume_10_15, { id: "volume_10_15", label: "10-15 კგ", partnerPrice: 12, courierPay: CONFIG.courierDeliveryPay }),
    express: normalizeDefaultTariffRow(defaults.express, { id: "express", label: "ექსპრეს დელივერი", partnerPrice: 10, courierPay: CONFIG.courierDeliveryPay }),
  };
}


function normalizeDefaultTariffRow(row = {}, fallback) {
  return {
    id: fallback.id,
    label: isBrokenText(row?.label) ? fallback.label : row?.label || fallback.label,
    partnerPrice: safeMoney(row?.partnerPrice ?? fallback.partnerPrice),
    courierPay: safeMoney(row?.courierPay ?? fallback.courierPay),
  };
}


function isBrokenText(value) {
  const text = String(value || "").trim();
  return Boolean(text && /^[?\s]+$/.test(text));
}


function getKnownTariffIds() {
  return Object.keys(getDefaultTariffSettings());
}


function isKnownTariffId(value) {
  return getKnownTariffIds().includes(String(value || "").trim());
}


function isVolumeTariffId(value) {
  return String(value || "").startsWith("volume_");
}


function isExpressTariffId(value) {
  return String(value || "") === "express";
}


function getTbilisiHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tbilisi",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  return Number(hour);
}


function isExpressDeliveryAvailable(date = new Date()) {
  const hour = getTbilisiHour(date);
  return Number.isFinite(hour) && hour >= 14;
}


function getParcelTariffId(parcel = {}) {
  const explicit = String(parcel.tariffId || parcel.tariffType || parcel.deliveryTariffId || "").trim();
  if (isKnownTariffId(explicit)) return explicit;
  return parcel.zoneId ? "city" : "suburbs";
}


function getFallbackTariff(parcel = {}) {
  const tariffs = getDefaultTariffSettings();
  return tariffs[getParcelTariffId(parcel)] || tariffs.city;
}


function getCourierPay(parcel) {
  if (parcel?.status !== "delivered") return 0;
  if (hasMoneyValue(parcel.courierPay)) return safeMoney(parcel.courierPay);
  return getFallbackTariff(parcel).courierPay;
}


function getAdminProfit(parcel) {
  if (parcel?.status !== "delivered") return 0;
  if (hasMoneyValue(parcel.adminProfit)) return safeMoney(parcel.adminProfit);
  return safeMoney(Math.max(0, getDeliveryTotal(parcel) - getCourierPay(parcel)));
}


function getDeliveryTotal(parcel) {
  if (parcel?.status !== "delivered") return 0;
  if (hasMoneyValue(parcel.deliveryTotalPrice)) return safeMoney(parcel.deliveryTotalPrice);
  return getFallbackTariff(parcel).partnerPrice;
}


function parsePaymentAmount(value) {
  const normalized = String(value || "0")
    .trim()
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  if (!normalized) return 0;

  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
}


function openUrlInBlankWindow(url) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Some WebViews prevent touching the opened window. The rel flags above are enough.
    }
    return true;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}


function isMobileExternalNavigationContext() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile|wv/i.test(ua)
    || window.matchMedia?.("(max-width: 820px)")?.matches
    || window.navigator?.standalone === true;
}


function openUrlExternally(url) {
  const cordovaBrowser = window.cordova?.InAppBrowser;
  if (cordovaBrowser?.open) {
    cordovaBrowser.open(url, "_system", "location=yes");
    return true;
  }

  const systemWindow = window.open(url, "_system", "noopener,noreferrer");
  if (systemWindow) {
    try {
      systemWindow.opener = null;
    } catch {
      // Native WebViews may not expose the opened window object.
    }
    return true;
  }

  if (isMobileExternalNavigationContext()) {
    window.location.assign(url);
    return true;
  }

  return openUrlInBlankWindow(url);
}


function openExternalUrl(url) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) return false;

  const appLauncher = window.Capacitor?.Plugins?.AppLauncher
    || window.Capacitor?.AppLauncher
    || window.AppLauncher;

  if (appLauncher?.openUrl) {
    appLauncher.openUrl({ url: targetUrl }).catch(() => {
      openUrlExternally(targetUrl);
    });
    return true;
  }

  return openUrlExternally(targetUrl);
}


function sumPayments(parcels) {
  return getDeliveredParcels(parcels).reduce((total, parcel) => total + getPaymentAmount(parcel), 0);
}


function sumCourierPay(parcels) {
  return parcels.reduce((total, parcel) => total + getCourierPay(parcel), 0);
}


function calculateCourierPay(records, username, startDate, endDate) {
  if (typeof calculateFinanceSummary === "function") {
    return calculateFinanceSummary({ records }, { username, startDate, endDate }).finalPay;
  }
  return sumCourierPay(records);
}


function sumAdminProfit(parcels) {
  return parcels.reduce((total, parcel) => total + getAdminProfit(parcel), 0);
}


function sumDeliveryTotals(parcels) {
  return parcels.reduce((total, parcel) => total + getDeliveryTotal(parcel), 0);
}


function getDeliveredParcels(parcels) {
  return (Array.isArray(parcels) ? parcels : []).filter((parcel) => parcel?.status === "delivered");
}


function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}


function formatPhoneHref(phone) {
  const normalized = String(phone || "").replace(/[^\d+]/g, "");
  return `tel:${normalized || phone}`;
}


function cleanAddressInput(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if ([STRINGS.addressLoading, STRINGS.addressMissing].includes(text)) return "";
  if (/^(unknown|undefined|null)$/i.test(text)) return "";
  return text;
}


function isCoordinateLabel(value) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(String(value || "").trim());
}


function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}


function distanceInMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = degreesToRadians(b.lat - a.lat);
  const dLng = degreesToRadians(b.lng - a.lng);
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}


function degreesToRadians(value) {
  return value * Math.PI / 180;
}


function formatOptionalDateTime(value) {
  return value ? formatDateTime(value) : "არ არის";
}
