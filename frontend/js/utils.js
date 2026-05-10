"use strict";



function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}


function roleLabel(role) {
  return role === "admin" ? "ადმინი" : "კურიერი";
}


function getStatusLabel(status) {
  if (status === "delivered") return "ჩაბარდა";
  if (status === "failed") return "არ ჩაბარდა";
  return "პროცესშია";
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
    const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toDateKey(date);
}


function getParcelStatsDateKey(parcel) {
  if (!parcel || typeof parcel !== "object") return "";
  const statusDates = parcel.status === "delivered"
    ? [parcel.deliveredAt, parcel.completedAt, parcel.updatedAt, parcel.archivedAt]
    : parcel.status === "failed"
      ? [parcel.failedAt, parcel.completedAt, parcel.updatedAt, parcel.archivedAt]
      : [parcel.assignedAt, parcel.createdAt, parcel.updatedAt];
  return statusDates.concat([parcel.createdAt]).map(normalizeDateKey).find(Boolean) || "";
}


function getParcelStatsDateKeys(parcel) {
  if (!parcel || typeof parcel !== "object") return [];
  const dateKey = getParcelStatsDateKey(parcel);
  return dateKey ? [dateKey] : [];
}


function parcelMatchesStatsDate(parcel, dateKey) {
  const normalizedDateKey = normalizeDateKey(dateKey);
  return Boolean(normalizedDateKey) && getParcelStatsDateKeys(parcel).includes(normalizedDateKey);
}


function parcelMatchesStatsDateRange(parcel, startDate, endDate) {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate || startDate);
  if (!start || !end) return false;
  const rangeStart = start <= end ? start : end;
  const rangeEnd = start <= end ? end : start;
  return getParcelStatsDateKeys(parcel).some((dateKey) => dateKey >= rangeStart && dateKey <= rangeEnd);
}


function userDisplayName(user) {
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
  const value = [parcel?.paymentAmount, parcel?.cashAmount, parcel?.payment, parcel?.amount, parcel?.price, parcel?.codAmount]
    .find((item) => item !== undefined && item !== null && item !== "");
  const amount = safeMoney(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}


function getCourierPay(parcel) {
  if (parcel?.status !== "delivered") return 0;
  const stored = safeMoney(parcel?.courierPay);
  return stored > 0 ? stored : CONFIG.courierDeliveryPay;
}


function getAdminProfit(parcel) {
  if (parcel?.status !== "delivered") return 0;
  const stored = safeMoney(parcel?.adminProfit);
  return stored > 0 ? stored : CONFIG.adminDeliveryProfit;
}


function getDeliveryTotal(parcel) {
  if (parcel?.status !== "delivered") return 0;
  const stored = safeMoney(parcel?.deliveryTotalPrice);
  return stored > 0 ? stored : CONFIG.deliveryTotalPrice;
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
