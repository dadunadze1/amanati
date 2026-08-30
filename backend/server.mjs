import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const initialPort = Number(process.env.PORT || 5173);
let currentPort = initialPort;
const host = "127.0.0.1";
const backendRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(backendRoot, "..");
const frontendRoot = resolve(projectRoot, "frontend");
const dbFile = process.env.DB_FILE ? resolve(process.env.DB_FILE) : resolve(backendRoot, "data", "delivery-db.json");
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
let apiQueue = Promise.resolve();

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

const emptyDb = () => ({
  users: [],
  parcels: [],
  settings: {},
});

const FINANCE = {
  deliveryTotalPrice: 6,
  courierDeliveryPay: 3.5,
  adminDeliveryProfit: 2.5,
};
const DEFAULT_TARIFFS = {
  city: { id: "city", label: "თბილისი", partnerPrice: 6, courierPay: 3.5 },
  suburbs: { id: "suburbs", label: "შემოგარენი", partnerPrice: 8, courierPay: 5.5 },
  volume_u5: { id: "volume_u5", label: "5 კგ-მდე", partnerPrice: 8, courierPay: 3.5 },
  volume_5_10: { id: "volume_5_10", label: "5-10 კგ", partnerPrice: 10, courierPay: 3.5 },
  volume_10_15: { id: "volume_10_15", label: "10-15 კგ", partnerPrice: 12, courierPay: 3.5 },
  express: { id: "express", label: "ექსპრეს დელივერი", partnerPrice: 10, courierPay: 3.5 },
};
const DATA_RETENTION_MONTHS = 8;
const PARTNER_ORDER_RETENTION_MONTHS = 1;
const WORKDAY_TIME_ZONE = "Asia/Tbilisi";
const WORKDAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: WORKDAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Zone configuration lives here so future boundary changes are one small edit.
// Polygon points are [lat, lng] and are checked with a standard point-in-polygon test.
const TBILISI_ZONES = {
  dighomi: {
    name: "დიღმის ზონა",
    districts: ["დიდი დიღომი", "დიღმის მასივი", "სოფელი დიღომი", "დიღომი"],
    polygon: [
      [41.732, 44.690],
      [41.817, 44.700],
      [41.822, 44.786],
      [41.774, 44.804],
      [41.730, 44.780],
    ],
  },
  north: {
    name: "ჩრდილოეთის ზონა",
    districts: ["გლდანი", "მუხიანი", "თემქა", "ავჭალა", "ზღვისუბანი"],
    polygon: [
      [41.760, 44.790],
      [41.865, 44.765],
      [41.870, 44.930],
      [41.770, 44.930],
      [41.742, 44.850],
    ],
  },
  east: {
    name: "აღმოსავლეთის ზონა",
    districts: ["ისანი", "სამგორი", "ვარკეთილი", "ვაზისუბანი", "ლილო", "ორხევი", "აეროპორტის დასახლება", "ფონიჭალა"],
    polygon: [
      [41.612, 44.812],
      [41.725, 44.835],
      [41.773, 45.070],
      [41.640, 45.095],
      [41.575, 44.930],
    ],
  },
  center: {
    name: "ცენტრალური ზონა",
    districts: ["ვაკე", "საბურთალო", "ვერა", "მთაწმინდა", "სოლოლაკი", "ავლაბარი", "ორთაჭალა", "კრწანისი", "ბაგები", "წყნეთი", "კოჯორი"],
    polygon: [
      [41.612, 44.635],
      [41.732, 44.650],
      [41.742, 44.835],
      [41.680, 44.875],
      [41.585, 44.785],
    ],
  },
  west_south: {
    name: "დასავლეთ-სამხრეთის ზონა",
    districts: ["დიდუბე", "ნაძალადევი", "კუკია", "ჩუღურეთი"],
    polygon: [
      [41.700, 44.760],
      [41.770, 44.760],
      [41.772, 44.840],
      [41.710, 44.858],
      [41.682, 44.805],
    ],
  },
};

async function readDb() {
  try {
    return { ...emptyDb(), ...JSON.parse(await readFile(dbFile, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeDb(emptyDb());
    return emptyDb();
  }
}

async function writeDb(db) {
  await mkdir(dirname(dbFile), { recursive: true });
  const tempFile = `${dbFile}.${process.pid}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await rename(tempFile, dbFile);
}

async function runQueuedApiOperation(operation) {
  const previous = apiQueue;
  let release;
  apiQueue = new Promise((resolveRelease) => {
    release = resolveRelease;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash).split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const hashedInput = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const stored = Buffer.from(hash, "hex");
  return hashedInput.length === stored.length && timingSafeEqual(hashedInput, stored);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function cleanUsername(username) {
  return String(username || "").trim();
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toWorkdayDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = WORKDAY_DATE_FORMATTER.formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToDateKey(dateKey, days) {
  if (!isDateKey(dateKey)) return "";
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function getDbSettings(db) {
  db.settings = db.settings && typeof db.settings === "object" ? db.settings : {};
  return db.settings;
}

function ensureWorkdayState(db, now = new Date()) {
  const settings = getDbSettings(db);
  const calendarDateKey = toWorkdayDateKey(now);
  if (!isDateKey(settings.currentWorkdayKey)) {
    settings.currentWorkdayKey = calendarDateKey;
    settings.currentWorkdayStartedAt = now.toISOString();
  }
  return {
    currentWorkdayKey: settings.currentWorkdayKey,
    calendarDateKey,
    lastClosedWorkdayKey: isDateKey(settings.lastClosedWorkdayKey) ? settings.lastClosedWorkdayKey : "",
    lastWorkdayClosedAt: settings.lastWorkdayClosedAt || "",
    currentWorkdayStartedAt: settings.currentWorkdayStartedAt || "",
    isStale: isDateKey(settings.currentWorkdayKey) && settings.currentWorkdayKey < calendarDateKey,
  };
}

function getCurrentWorkdayKey(db, now = new Date()) {
  return ensureWorkdayState(db, now).currentWorkdayKey;
}

function closeCurrentWorkday(db, workdayKey, now = new Date()) {
  const settings = getDbSettings(db);
  const state = ensureWorkdayState(db, now);
  const closedKey = isDateKey(workdayKey) ? workdayKey : state.currentWorkdayKey;
  const nextCandidateKey = addDaysToDateKey(closedKey, 1) || state.calendarDateKey;
  const nextWorkdayKey = nextCandidateKey > state.calendarDateKey ? nextCandidateKey : state.calendarDateKey;
  settings.lastClosedWorkdayKey = closedKey;
  settings.lastWorkdayClosedAt = now.toISOString();
  if (!isDateKey(settings.currentWorkdayKey) || settings.currentWorkdayKey <= closedKey) {
    settings.currentWorkdayKey = nextWorkdayKey;
    settings.currentWorkdayStartedAt = now.toISOString();
  }
  return ensureWorkdayState(db, now);
}

function getParcelWorkdayDateKey(parcel) {
  return toDateKey(getParcelEventDateValue(parcel));
}

function getParcelEventDateValue(parcel) {
  if (!parcel || typeof parcel !== "object") return "";
  const statusDates = parcel.status === "delivered"
    ? [parcel.deliveredAt, parcel.completedAt, parcel.financeDateKey, parcel.completedWorkdayKey, parcel.archivedAt, parcel.updatedAt]
    : parcel.status === "failed"
      ? [parcel.failedAt, parcel.completedAt, parcel.completedWorkdayKey, parcel.archivedAt, parcel.updatedAt]
      : [parcel.assignedAt, parcel.createdAt, parcel.workdayKey, parcel.updatedAt];
  return statusDates.concat([parcel.createdAt]).find((value) => toDateKey(value)) || "";
}

function publicUser(user) {
  const zoneIds = getUserZoneIds(user);
  const zoneId = zoneIds[0] || "";
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    companyName: user.companyName || "",
    contactPerson: user.contactPerson || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    phone: user.phone || "",
    bankDetails: user.bankDetails || "",
    pickupAddress: user.pickupAddress || "",
    pickupLat: user.pickupLat ?? "",
    pickupLng: user.pickupLng ?? "",
    pickupLatitude: user.pickupLatitude ?? user.pickupLat ?? "",
    pickupLongitude: user.pickupLongitude ?? user.pickupLng ?? "",
    pickupZoneId: user.pickupZoneId || "",
    pickupZoneName: user.pickupZoneName || getZoneName(user.pickupZoneId),
    pickupLocationSource: user.pickupLocationSource || "",
    pickupLocationUpdatedAt: user.pickupLocationUpdatedAt || "",
    lastPickupAcknowledgedAt: user.lastPickupAcknowledgedAt || "",
    lastPickupAcknowledgedBy: user.lastPickupAcknowledgedBy || "",
    lastPickupAcknowledgedByRole: user.lastPickupAcknowledgedByRole || "",
    zoneIds,
    zoneId,
    zoneName: getZoneNames(zoneIds),
    createdAt: user.createdAt,
    requestedAt: user.requestedAt,
    approvedAt: user.approvedAt,
  };
}

function publicParcel(db, parcel) {
  const courier = parcel.courierUsername ? findUser(db, parcel.courierUsername) : null;
  const paymentAmount = getParcelPaymentAmount(parcel);
  const finance = getParcelFinanceSnapshot(db, parcel);
  return {
    ...parcel,
    paymentAmount,
    cashAmount: paymentAmount,
    tariffId: finance.tariffId,
    tariffLabel: finance.tariffLabel,
    deliveryTotalPrice: finance.deliveryTotalPrice,
    courierPay: finance.courierPay,
    adminProfit: finance.adminProfit,
    zoneName: parcel.zoneName || getZoneName(parcel.zoneId),
    autoAssigned: Boolean(parcel.autoAssigned),
    deliveredAt: parcel.deliveredAt || (parcel.status === "delivered" ? parcel.completedAt || "" : ""),
    failedAt: parcel.failedAt || (parcel.status === "failed" ? parcel.completedAt || "" : ""),
    updatedAt: parcel.updatedAt || parcel.completedAt || parcel.assignedAt || parcel.createdAt || "",
    courier: courier ? publicUser(courier) : null,
  };
}

function findUser(db, username) {
  const normalized = normalizeUsername(username);
  return db.users.find((user) => normalizeUsername(user.username) === normalized);
}

function hasAdmin(db) {
  return db.users.some((user) => user.role === "admin" && user.status === "active");
}

function cleanRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "courier", "partner"].includes(value)) return value;
  throw httpError(400, "როლი უნდა იყოს ადმინი ან კურიერი.");
}

function cleanUserProfile(body) {
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    phone: String(body.phone || "").trim(),
    bankDetails: String(body.bankDetails || "").trim(),
  };
}

function parseOptionalPickupCoordinate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}


function getCleanPickupCoords(body) {
  const lat = parseOptionalPickupCoordinate(body?.pickupLat ?? body?.pickupLatitude);
  const lng = parseOptionalPickupCoordinate(body?.pickupLng ?? body?.pickupLongitude);
  if (lat === null || lng === null) return null;
  const coords = { lat, lng };
  return isTbilisiCoordinate(coords) ? coords : null;
}


function cleanPartnerProfile(body) {
  const pickupCoords = getCleanPickupCoords(body);
  const hasPickupCoords = Boolean(pickupCoords);
  const pickupZoneId = String(body.pickupZoneId || "").trim();
  const detectedPickupZoneId = hasPickupCoords
    ? TBILISI_ZONES[pickupZoneId] ? pickupZoneId : detectTbilisiZone(pickupCoords)?.id || ""
    : "";
  return {
    companyName: String(body.companyName || body.businessName || "").trim(),
    contactPerson: String(body.contactPerson || "").trim(),
    phone: String(body.phone || "").trim(),
    pickupAddress: String(body.pickupAddress || "").trim(),
    pickupLat: hasPickupCoords ? pickupCoords.lat : "",
    pickupLng: hasPickupCoords ? pickupCoords.lng : "",
    pickupLatitude: hasPickupCoords ? pickupCoords.lat : "",
    pickupLongitude: hasPickupCoords ? pickupCoords.lng : "",
    pickupZoneId: detectedPickupZoneId,
    pickupZoneName: getZoneName(detectedPickupZoneId),
    pickupLocationSource: hasPickupCoords ? String(body.pickupLocationSource || "admin_manual_pickup").trim() : "",
    pickupLocationUpdatedAt: hasPickupCoords ? String(body.pickupLocationUpdatedAt || new Date().toISOString()).trim() : "",
  };
}

function partnerDisplayName(user) {
  return user?.companyName || user?.contactPerson || user?.username || "";
}

function getPartnerPickupCoords(partner) {
  return getCleanPickupCoords(partner);
}

function getPartnerPickupZoneId(partner) {
  const storedZoneId = String(partner?.pickupZoneId || "").trim();
  if (TBILISI_ZONES[storedZoneId]) return storedZoneId;
  const coords = getPartnerPickupCoords(partner);
  return coords ? detectTbilisiZone(coords)?.id || "" : "";
}

function getParcelCreatedTime(parcel) {
  const value = Date.parse(parcel?.createdAt || parcel?.updatedAt || parcel?.assignedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function isPickupVisibleAfterAck(parcel, acknowledgedAt) {
  const ackTime = Date.parse(acknowledgedAt || "");
  if (!Number.isFinite(ackTime)) return true;
  return getParcelCreatedTime(parcel) > ackTime;
}

function getActivePartnerPickupParcels(db, partner, acknowledgedAt = partner?.lastPickupAcknowledgedAt || "") {
  return db.parcels
    .filter((parcel) => !parcel.archivedAt && !isDeletedParcel(parcel) && !isPickedUpPartnerParcel(parcel) && parcel.status !== "delivered" && parcel.status !== "failed")
    .filter((parcel) => parcelBelongsToPartner(parcel, partner))
    .filter((parcel) => isPickupVisibleAfterAck(parcel, acknowledgedAt));
}

function addPartnerPickupParcelGroup(groups, key, parcel) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (!groups.has(normalizedKey)) groups.set(normalizedKey, []);
  groups.get(normalizedKey).push(parcel);
}

function buildActivePartnerPickupParcelGroups(db) {
  const groups = new Map();
  db.parcels
    .filter((parcel) => !parcel.archivedAt && !isDeletedParcel(parcel) && !isPickedUpPartnerParcel(parcel) && parcel.status !== "delivered" && parcel.status !== "failed")
    .forEach((parcel) => {
      addPartnerPickupParcelGroup(groups, parcel.partnerId, parcel);
      const partnerIdUsername = normalizeUsername(parcel.partnerId);
      if (partnerIdUsername) addPartnerPickupParcelGroup(groups, `username:${partnerIdUsername}`, parcel);
      const username = normalizeUsername(parcel.partnerUsername);
      if (username) addPartnerPickupParcelGroup(groups, `username:${username}`, parcel);
    });
  return groups;
}

function getGroupedActivePartnerPickupParcels(groups, partner, acknowledgedAt = partner?.lastPickupAcknowledgedAt || "") {
  const partnerId = partnerCashIdentity(partner);
  const username = normalizeUsername(partner?.username);
  const seen = new Set();
  return [
    ...(partnerId ? groups.get(partnerId) || [] : []),
    ...(username ? groups.get(`username:${username}`) || [] : []),
  ].filter((parcel) => {
    const key = parcel.id || parcel.createdAt || `${parcel.partnerId}:${parcel.partnerUsername}:${parcel.address || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return isPickupVisibleAfterAck(parcel, acknowledgedAt);
  });
}

function publicPartnerPickup(db, partner, parcels) {
  const coords = getPartnerPickupCoords(partner);
  if (!coords || !parcels.length) return null;
  const zoneId = getPartnerPickupZoneId(partner);
  const sortedParcels = [...parcels].sort((a, b) => getParcelCreatedTime(b) - getParcelCreatedTime(a));
  return {
    id: `partner-pickup-${partner.id || partner.username}`,
    partnerId: partnerCashIdentity(partner),
    partnerUsername: partner.username || "",
    partnerName: partnerDisplayName(partner),
    phone: partner.phone || "",
    pickupAddress: partner.pickupAddress || "",
    lat: coords.lat,
    lng: coords.lng,
    latitude: coords.lat,
    longitude: coords.lng,
    zoneId,
    zoneName: getZoneName(zoneId),
    count: sortedParcels.length,
    orderIds: sortedParcels.map((parcel) => parcel.id).filter(Boolean),
    lastOrderAt: sortedParcels[0]?.createdAt || sortedParcels[0]?.updatedAt || "",
    lastPickupAcknowledgedAt: partner.lastPickupAcknowledgedAt || "",
    lastPickupAcknowledgedBy: partner.lastPickupAcknowledgedBy || "",
  };
}

function getPartnerPickupPinsForSession(db, session) {
  const sessionUser = findUser(db, session?.username) || session;
  const parcelGroups = buildActivePartnerPickupParcelGroups(db);
  return db.users
    .filter((user) => user.role === "partner" && user.status === "active")
    .map((partner) => {
      const pickup = publicPartnerPickup(db, partner, getGroupedActivePartnerPickupParcels(parcelGroups, partner));
      if (!pickup) return null;
      if (session.role === "admin") return pickup;
      if (session.role === "courier" && userHasZone(sessionUser, pickup.zoneId)) return pickup;
      if (session.role === "partner" && normalizeUsername(session.username) === normalizeUsername(partner.username)) return pickup;
      return null;
    })
    .filter(Boolean);
}

function getPartnerCashAdjustments(db) {
  const settings = db.settings && typeof db.settings === "object" ? db.settings : {};
  return Array.isArray(settings.partnerCashAdjustments) ? settings.partnerCashAdjustments : [];
}

function setPartnerCashAdjustments(db, adjustments) {
  db.settings = db.settings && typeof db.settings === "object" ? db.settings : {};
  db.settings.partnerCashAdjustments = Array.isArray(adjustments) ? adjustments : [];
}

function getDailyBalanceLedger(db) {
  const settings = db.settings && typeof db.settings === "object" ? db.settings : {};
  return Array.isArray(settings.dailyBalanceLedger) ? settings.dailyBalanceLedger : [];
}

function setDailyBalanceLedger(db, entries) {
  db.settings = db.settings && typeof db.settings === "object" ? db.settings : {};
  db.settings.dailyBalanceLedger = Array.isArray(entries) ? entries : [];
}

function cleanTariffMoney(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return storedMoney(fallback);
  const normalized = String(value).trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!normalized) return storedMoney(fallback);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "ტარიფი უნდა იყოს ნული ან მეტი.");
  return storedMoney(amount);
}

function normalizeTariffItem(input = {}, fallback = DEFAULT_TARIFFS.city) {
  input = input && typeof input === "object" ? input : {};
  const partnerPrice = cleanTariffMoney(input.partnerPrice ?? input.deliveryTotalPrice ?? input.totalPrice, fallback.partnerPrice);
  const courierPay = cleanTariffMoney(input.courierPay ?? input.courierDeliveryPay, fallback.courierPay);
  return {
    id: fallback.id,
    label: fallback.label,
    partnerPrice,
    courierPay,
    companyProfit: storedMoney(Math.max(0, partnerPrice - courierPay)),
  };
}

function normalizeTariffSettings(settings = {}) {
  const tariffs = settings.tariffs && typeof settings.tariffs === "object" ? settings.tariffs : settings;
  return Object.keys(DEFAULT_TARIFFS).reduce((normalized, id) => {
    normalized[id] = normalizeTariffItem(tariffs[id], DEFAULT_TARIFFS[id]);
    return normalized;
  }, {});
}

function getTariffSettings(db) {
  const settings = db?.settings && typeof db.settings === "object" ? db.settings : {};
  return normalizeTariffSettings(settings.tariffs);
}

function setTariffSettings(db, tariffs, username = "") {
  db.settings = db.settings && typeof db.settings === "object" ? db.settings : {};
  db.settings.tariffs = normalizeTariffSettings(tariffs);
  db.settings.tariffsUpdatedAt = new Date().toISOString();
  db.settings.tariffsUpdatedBy = username;
  return db.settings.tariffs;
}

function hasStoredMoney(value) {
  return value !== undefined && value !== null && value !== "";
}

function getParcelTariffId(parcel = {}) {
  const explicit = String(parcel.tariffId || parcel.tariffType || parcel.deliveryTariffId || "").trim();
  if (Object.prototype.hasOwnProperty.call(DEFAULT_TARIFFS, explicit)) return explicit;
  return parcel.zoneId ? "city" : "suburbs";
}

function cleanParcelTariffId(value) {
  const tariffId = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(DEFAULT_TARIFFS, tariffId) ? tariffId : "";
}

function isExpressTariffId(tariffId) {
  return tariffId === "express";
}

function isVolumeTariffId(tariffId) {
  return String(tariffId || "").startsWith("volume_");
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

function assertParcelTariffAllowed(tariffId, date = new Date()) {
  if (isExpressTariffId(tariffId) && !isExpressDeliveryAvailable(date)) {
    throw httpError(400, "ექსპრეს დელივერი ხელმისაწვდომია 14:00-ის შემდეგ.");
  }
}

function getParcelTariff(db, parcel = {}) {
  const tariffs = getTariffSettings(db);
  return tariffs[getParcelTariffId(parcel)] || tariffs.city;
}

function getParcelFinanceSnapshot(db, parcel = {}, options = {}) {
  const tariff = getParcelTariff(db, parcel);
  const hasFinanceSnapshot = !options.forceCurrentTariff && hasStoredMoney(parcel.deliveryTotalPrice)
    && (
      storedMoney(parcel.deliveryTotalPrice) > 0
      || storedMoney(parcel.courierPay) > 0
      || storedMoney(parcel.adminProfit) > 0
    );
  const deliveryTotalPrice = hasFinanceSnapshot ? storedMoney(parcel.deliveryTotalPrice) : tariff.partnerPrice;
  const courierPay = hasFinanceSnapshot ? storedMoney(parcel.courierPay) : tariff.courierPay;
  const adminProfit = hasFinanceSnapshot && hasStoredMoney(parcel.adminProfit) ? storedMoney(parcel.adminProfit) : storedMoney(Math.max(0, deliveryTotalPrice - courierPay));
  return {
    tariffId: getParcelTariffId(parcel),
    tariffLabel: tariff.label,
    deliveryTotalPrice,
    courierPay,
    adminProfit,
  };
}

function partnerCashIdentity(user = {}) {
  return user.id || user.username || "";
}

function publicPartnerCashAdjustment(adjustment) {
  const delta = Number(adjustment.delta ?? adjustment.amount ?? 0);
  const targetAmount = Number(adjustment.targetAmount || 0);
  const correctionAmount = Number(adjustment.correctionAmount ?? Math.abs(delta));
  const correctionMode = adjustment.correctionMode === "add" ? "add" : "subtract";
  return {
    id: adjustment.id || "",
    username: adjustment.username || adjustment.partnerUsername || "",
    partnerUsername: adjustment.partnerUsername || adjustment.username || "",
    partnerId: adjustment.partnerId || "",
    amount: delta,
    delta,
    targetAmount,
    correctionAmount: Number.isFinite(correctionAmount) ? Math.max(0, correctionAmount) : Math.abs(delta),
    correctionMode,
    type: adjustment.type || (delta < 0 ? "negative" : "positive"),
    category: "partnerCash",
    dateKey: adjustment.dateKey || adjustment.date || "",
    date: adjustment.date || adjustment.dateKey || "",
    note: adjustment.note || "",
    timestamp: adjustment.timestamp || adjustment.createdAt || "",
    createdAt: adjustment.createdAt || adjustment.timestamp || "",
  };
}

function partnerCashAdjustmentBelongsTo(adjustment, partner) {
  const id = partnerCashIdentity(partner);
  const username = partner.username || "";
  return Boolean(
    (id && adjustment.partnerId === id)
    || (username && normalizeUsername(adjustment.partnerId) === normalizeUsername(username))
    || (username && normalizeUsername(adjustment.partnerUsername || adjustment.username) === normalizeUsername(username))
  );
}

function publicDailyBalanceEntry(entry) {
  const type = ["courier", "partner", "snapshot"].includes(entry.type) ? entry.type : "snapshot";
  const amount = Number(entry.amount ?? 0);
  const now = new Date().toISOString();
  return {
    id: entry.id || "",
    type,
    status: entry.status === "paid" || entry.status === "saved" ? entry.status : type === "snapshot" ? "saved" : "paid",
    dateKey: entry.dateKey || entry.rangeStart || "",
    rangeStart: entry.rangeStart || entry.dateKey || "",
    rangeEnd: entry.rangeEnd || entry.dateKey || entry.rangeStart || "",
    username: entry.username || "",
    partnerUsername: entry.partnerUsername || "",
    partnerId: entry.partnerId || "",
    label: entry.label || "",
    amount: Number.isFinite(amount) ? amount : 0,
    delivered: Number(entry.delivered || 0),
    payload: entry.payload && typeof entry.payload === "object" ? entry.payload : {},
    note: entry.note || "",
    createdAt: entry.createdAt || now,
    updatedAt: entry.updatedAt || entry.createdAt || now,
  };
}

function findPartnerByIdOrUsername(db, value) {
  const normalized = normalizeUsername(value);
  return db.users.find((user) => (
    user.role === "partner"
    && (String(user.id || "") === String(value || "") || normalizeUsername(user.username) === normalized)
  ));
}

function cleanAddressPart(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function stripPartnerAddressNoise(value) {
  return cleanAddressPart(value)
    .replace(/\b(?:building|floor|apt|apartment|block|entrance)\s*[:#№-]?\s*[\wა-ჰ/-]+/gi, " ")
    .replace(/\b(?:შენობა|სართული|ბინა|კორპუსი|სადარბაზო)\s*[:#№-]?\s*[\wა-ჰ/-]+/gi, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "");
}

function extractPartnerBuilding(body) {
  const direct = cleanAddressPart(body.building || body.buildingNumber);
  if (direct) return direct;
  const source = cleanAddressPart(body.address || body.fullAddress);
  const match = source.match(/\b(?:building|შენობა|კორპუსი)\s*[:#№-]?\s*([\wა-ჰ/-]+)/i);
  return match ? cleanAddressPart(match[1]) : "";
}

function extractPartnerStreetAddress(body) {
  const direct = stripPartnerAddressNoise(body.streetAddress || body.street);
  if (direct) return direct;

  const source = cleanAddressPart(body.fullAddress || body.address);
  const cityToken = normalizeAddressLookupToken(body.city);
  const districtToken = normalizeAddressLookupToken(body.district || body.area);
  const parts = source.split(",").map(stripPartnerAddressNoise).filter(Boolean);
  const streetPart = parts.find((part) => {
    const token = normalizeAddressLookupToken(part);
    return token && token !== cityToken && token !== districtToken && !/^(building|floor|apt|apartment|შენობა|სართული|ბინა)\b/i.test(part);
  });
  return streetPart || stripPartnerAddressNoise(source);
}

function buildPartnerFullAddress(body) {
  const city = stripPartnerAddressNoise(body.city);
  const district = stripPartnerAddressNoise(body.district || body.area);
  const streetAddress = extractPartnerStreetAddress(body);
  const building = extractPartnerBuilding(body);
  return [city, district, [streetAddress, building].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

async function geocodePartnerAddress(body) {
  const city = stripPartnerAddressNoise(body.city || "Tbilisi");
  const district = stripPartnerAddressNoise(body.district || body.area);
  const streetAddress = extractPartnerStreetAddress(body);
  const building = extractPartnerBuilding(body);
  const streetWithBuilding = [streetAddress, building].filter(Boolean).join(" ");
  const variants = [
    [city, district, streetWithBuilding].filter(Boolean).join(", "),
    [city, district, streetAddress].filter(Boolean).join(", "),
    [streetWithBuilding, district, city].filter(Boolean).join(", "),
    [streetAddress, district, city].filter(Boolean).join(", "),
    [streetAddress, city, "Georgia"].filter(Boolean).join(", "),
    buildPartnerFullAddress(body),
  ].filter(Boolean);

  for (const query of [...new Set(variants)]) {
    const result = await geocodePartnerQuery(query);
    if (result) return result;
  }

  if (streetAddress) {
    const streetResult = await geocodePartnerStreetParam(streetAddress, city);
    if (streetResult) return streetResult;
  }

  return localPartnerAddressFallback({ streetAddress, building });
}

async function geocodePartnerQuery(query) {
  const results = await fetchNominatimJson("/search", {
    format: "jsonv2",
    q: /georgia|საქართველო|tbilisi|თბილისი/i.test(query) ? query : `${query}, Georgia`,
    addressdetails: 1,
    limit: 5,
    countrycodes: "ge",
    viewbox: "44.60,41.88,45.05,41.55",
    bounded: 0,
    "accept-language": "ka,en",
  }, []);
  return firstTbilisiGeocodeResult(results);
}

async function geocodePartnerStreetParam(street, city) {
  const results = await fetchNominatimJson("/search", {
    format: "jsonv2",
    street,
    city: city || "Tbilisi",
    country: "Georgia",
    addressdetails: 1,
    limit: 5,
    countrycodes: "ge",
    viewbox: "44.60,41.88,45.05,41.55",
    bounded: 0,
    "accept-language": "ka,en",
  }, []);
  return firstTbilisiGeocodeResult(results);
}

function firstTbilisiGeocodeResult(results) {
  const items = Array.isArray(results) ? results : [];
  const preferred = items.find((item) => isTbilisiCoordinate(getGeocodeCoords(item))) || items[0];
  const coords = getGeocodeCoords(preferred);
  return Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? coords : null;
}

function getGeocodeCoords(result) {
  return {
    lat: Number(result?.lat ?? result?.latitude),
    lng: Number(result?.lon ?? result?.lng ?? result?.longitude),
  };
}

function isTbilisiCoordinate(coords) {
  return Number(coords?.lat) >= 41.55 && Number(coords?.lat) <= 41.88 && Number(coords?.lng) >= 44.60 && Number(coords?.lng) <= 45.05;
}

function localPartnerAddressFallback({ streetAddress, building }) {
  const token = normalizeAddressLookupToken(streetAddress);
  if (!token) return null;
  const knownStreets = [
    { tokens: ["pekini", "პეკინი", "პეკინის"], base: { lat: 41.72455, lng: 44.76835 }, step: { lat: -0.00001, lng: 0.00002 } },
    { tokens: ["university", "უნივერსიტეტის"], base: { lat: 41.7206, lng: 44.7219 }, step: { lat: 0.00001, lng: 0.00002 } },
    { tokens: ["abashidze", "აბაშიძე", "აბაშიძის"], base: { lat: 41.70717, lng: 44.77018 }, step: { lat: 0.000015, lng: -0.000035 } },
    { tokens: ["sairme", "საირმე", "საირმის"], base: { lat: 41.7190, lng: 44.7500 }, step: { lat: 0.000010, lng: 0.000020 } },
    { tokens: ["paliashvili", "ფალიაშვილი", "ფალიაშვილის"], base: { lat: 41.71001, lng: 44.75489 }, step: { lat: -0.000010, lng: 0.000020 } },
    { tokens: ["tsintsadze", "ცინცაძე", "ცინცაძის"], base: { lat: 41.72166, lng: 44.76621 }, step: { lat: -0.000015, lng: -0.000010 } },
    { tokens: ["taqtakishvili", "taktakishvili", "თაქთაქიშვილი", "თაქთაქიშვილის"], base: { lat: 41.70819, lng: 44.76478 }, step: { lat: 0.000010, lng: -0.000010 } },
    { tokens: ["rustaveli", "რუსთაველი", "რუსთაველის"], base: { lat: 41.70077, lng: 44.79561 }, step: { lat: 0.000010, lng: -0.000015 } },
    { tokens: ["vazha pshavela", "ვაჟა ფშაველა", "ვაჟა-ფშაველა", "ვაჟაფშაველა"], base: { lat: 41.7240, lng: 44.7330 }, step: { lat: 0, lng: 0 } },
    { tokens: ["varketili", "ვარკეთილი", "ვარკეთილის"], base: { lat: 41.6940, lng: 44.8840 }, step: { lat: 0, lng: 0 } },
    { tokens: ["gldani", "გლდანი", "გლდანის"], base: { lat: 41.7930, lng: 44.8170 }, step: { lat: 0, lng: 0 } },
    { tokens: ["mukhiani", "მუხიანი", "მუხიანის"], base: { lat: 41.8050, lng: 44.8390 }, step: { lat: 0, lng: 0 } },
    { tokens: ["nutsubidze", "ნუცუბიძე", "ნუცუბიძის"], base: { lat: 41.7225, lng: 44.7290 }, step: { lat: 0, lng: 0 } },
    { tokens: ["temka", "თემქა", "თემქის"], base: { lat: 41.7770, lng: 44.8110 }, step: { lat: 0, lng: 0 } },
    { tokens: ["zgvisubani", "ზღვისუბანი", "ზღვისუბნის", "ზღვის უბანი"], base: { lat: 41.7860, lng: 44.8320 }, step: { lat: 0, lng: 0 } },
    { tokens: ["dighmis masivi", "დიღმის მასივი", "დიღმის მასივის"], base: { lat: 41.7590, lng: 44.7790 }, step: { lat: 0, lng: 0 } },
  ];
  const street = knownStreets.find((item) => item.tokens.some((itemToken) => token.includes(normalizeAddressLookupToken(itemToken))));
  if (!street) return null;
  const houseNumber = Number.parseInt(building || streetAddress, 10);
  const offset = Number.isFinite(houseNumber) ? Math.max(-80, Math.min(80, houseNumber - 12)) : 0;
  return {
    lat: street.base.lat + (offset * street.step.lat),
    lng: street.base.lng + (offset * street.step.lng),
  };
}

function normalizeAddressLookupToken(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|tbilisi|georgia)\b/gi, " ")
    .replace(/\b(ქუჩა|ქ|გამზირი|გამზ|თბილისი|საქართველო)\b/gi, " ")
    .replace(/\d+[a-zა-ჰ/-]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPartnerParcel(parcel) {
  return Boolean(parcel?.partnerId || parcel?.partnerUsername || parcel?.createdByRole === "partner");
}

function isDeletedParcel(parcel) {
  return Boolean(parcel?.deletedAt);
}

function isPickedUpPartnerParcel(parcel) {
  return Boolean(isPartnerParcel(parcel) && (parcel?.pickedUpAt || parcel?.partnerPickupAcknowledgedAt));
}

function parcelBelongsToPartner(parcel, partner) {
  if (!parcel || !partner) return false;
  const partnerId = partnerCashIdentity(partner);
  const username = partner.username || "";
  return Boolean(
    (partnerId && (parcel.partnerId === partnerId || normalizeUsername(parcel.partnerUsername) === normalizeUsername(partnerId)))
    || (username && (normalizeUsername(parcel.partnerId) === normalizeUsername(username) || normalizeUsername(parcel.partnerUsername) === normalizeUsername(username)))
  );
}

function parcelMatchesPartnerFilter(parcel, partnerId) {
  const value = String(partnerId || "").trim();
  if (!value) return true;
  return String(parcel?.partnerId || "") === value
    || normalizeUsername(parcel?.partnerId) === normalizeUsername(value)
    || normalizeUsername(parcel?.partnerUsername) === normalizeUsername(value);
}

function canDeleteParcel(session, db, parcel) {
  if (!session || !parcel || parcel.archivedAt || isDeletedParcel(parcel) || parcel.status === "delivered") return false;
  if (session.role === "admin") return true;
  if (isPickedUpPartnerParcel(parcel)) return false;
  if (session.role !== "partner") return false;
  const partner = findUser(db, session.username);
  return Boolean(partner && partner.role === "partner" && partner.status === "active" && isPartnerParcel(parcel) && parcelBelongsToPartner(parcel, partner));
}

function assertParcelVersion(parcel, expectedUpdatedAt) {
  const expected = String(expectedUpdatedAt || "").trim();
  if (!expected || !parcel?.updatedAt) return;
  if (String(parcel.updatedAt || "") !== expected) {
    throw httpError(409, "შეკვეთა უკვე შეიცვალა სხვა მომხმარებლის მიერ. განაახლეთ გვერდი და თავიდან სცადეთ.");
  }
}

function hasParcelCoords(parcel) {
  return Number.isFinite(Number(parcel?.lat ?? parcel?.latitude)) && Number.isFinite(Number(parcel?.lng ?? parcel?.longitude));
}

async function backfillPartnerParcelLocations(db) {
  let changed = false;
  for (const parcel of db.parcels) {
    if (!parcel || parcel.archivedAt || isDeletedParcel(parcel) || !isPartnerParcel(parcel) || hasParcelCoords(parcel)) continue;
    const geocoded = await geocodePartnerAddress(parcel);
    if (!geocoded) continue;

    const now = new Date().toISOString();
    parcel.lat = geocoded.lat;
    parcel.lng = geocoded.lng;
    parcel.latitude = geocoded.lat;
    parcel.longitude = geocoded.lng;
    parcel.locationAccuracy = "approximate";
    parcel.locationSource = "partner_address_geocoded_backfill";
    parcel.locationConfirmedByAdmin = false;
    parcel.locationUpdatedAt = now;
    parcel.updatedAt = now;
    const detectedZone = detectTbilisiZone(geocoded);
    if (detectedZone) {
      parcel.zoneId = parcel.zoneId || detectedZone.id;
      parcel.zoneName = parcel.zoneName || detectedZone.name;
    }
    changed = true;
  }
  if (changed) await writeDb(db);
  return changed;
}

function isCompletedParcel(parcel) {
  return parcel.status === "delivered";
}

function getZoneName(zoneId) {
  return TBILISI_ZONES[zoneId]?.name || "";
}

function getZoneNames(zoneIds) {
  return (Array.isArray(zoneIds) ? zoneIds : [])
    .map(getZoneName)
    .filter(Boolean)
    .join(", ");
}

function getUserZoneIds(user) {
  const values = [
    ...(Array.isArray(user?.zoneIds) ? user.zoneIds : []),
    user?.zoneId,
  ];
  return [...new Set(values.map((zoneId) => String(zoneId || "").trim()).filter((zoneId) => TBILISI_ZONES[zoneId]))];
}

function userHasZone(user, zoneId) {
  return getUserZoneIds(user).includes(String(zoneId || "").trim());
}

function publicZone(db, zoneId, zone) {
  return {
    id: zoneId,
    name: zone.name,
    districts: zone.districts,
    polygon: zone.polygon,
    couriers: db.users
      .filter((user) => user.role === "courier" && user.status === "active" && userHasZone(user, zoneId))
      .map(publicUser),
  };
}

function detectTbilisiZone(coords) {
  const point = { lat: Number(coords?.lat), lng: Number(coords?.lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const match = Object.entries(TBILISI_ZONES).find(([, zone]) => isPointInPolygon(point, zone.polygon));
  if (!match) return null;
  const [id, zone] = match;
  return { id, name: zone.name };
}

function isPointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const crossesLat = (latI > point.lat) !== (latJ > point.lat);
    const intersectLng = ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI || Number.EPSILON) + lngI;
    if (crossesLat && point.lng < intersectLng) inside = !inside;
  }
  return inside;
}

function getActiveParcelCount(db, username) {
  const normalized = normalizeUsername(username);
  return db.parcels.filter((parcel) => (
    !parcel.archivedAt
    && !isDeletedParcel(parcel)
    && !isCompletedParcel(parcel)
    && normalizeUsername(parcel.courierUsername) === normalized
  )).length;
}

function findLeastBusyCourierForZone(db, zoneId) {
  const couriers = db.users.filter((user) => (
    user.role === "courier"
    && user.status === "active"
    && userHasZone(user, zoneId)
  ));
  return couriers
    .map((courier) => ({ courier, activeCount: getActiveParcelCount(db, courier.username) }))
    .sort((a, b) => a.activeCount - b.activeCount || a.courier.username.localeCompare(b.courier.username, "ka"))[0]?.courier || null;
}

function cleanZoneId(zoneId) {
  const value = String(zoneId || "").trim();
  if (!value) return "";
  if (!TBILISI_ZONES[value]) throw httpError(400, "ზონა ვერ მოიძებნა.");
  return value;
}

function cleanZoneIds(zoneIds) {
  const values = Array.isArray(zoneIds) ? zoneIds : [zoneIds];
  return [...new Set(values.map(cleanZoneId).filter(Boolean))];
}

function buildNominatimUrl(endpoint, params) {
  const url = new URL(endpoint, "https://nominatim.openstreetmap.org");
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

async function fetchNominatimJson(endpoint, params, fallback) {
  try {
    const upstream = await fetch(buildNominatimUrl(endpoint, params), {
      headers: {
        Accept: "application/json",
        "User-Agent": "DeliveryCompanyDispatcher/1.0 (local development)",
      },
    });
    if (!upstream.ok) return fallback;
    return upstream.json();
  } catch {
    return fallback;
  }
}

function parcelSearchHaystack(db, parcel) {
  const courier = parcel.courierUsername ? findUser(db, parcel.courierUsername) : null;
  const values = [
    parcel.id,
    parcel.fullName,
    parcel.phone,
    parcel.address,
    parcel.partnerName,
    parcel.partnerUsername,
    parcel.createdByRole,
    parcel.comment,
    parcel.status,
    parcel.status === "delivered" ? "ჩაბარდა" : "",
    parcel.status === "failed" ? "არ ჩაბარდა" : "",
    parcel.status === "pending" ? "პროცესშია" : "",
    parcel.courierUsername,
    courier?.firstName,
    courier?.lastName,
    courier?.phone,
    parcel.zoneId,
    parcel.zoneName || getZoneName(parcel.zoneId),
    parcel.autoAssigned ? "ავტომატურად" : "ხელით",
    parcel.createdAt,
    parcel.assignedAt,
    parcel.completedAt,
    parcel.deliveredAt,
    parcel.failedAt,
    parcel.updatedAt,
    parcel.archivedAt,
    toDateKey(parcel.createdAt),
    toDateKey(parcel.assignedAt),
    toDateKey(parcel.completedAt),
    toDateKey(parcel.deliveredAt),
    toDateKey(parcel.failedAt),
    toDateKey(parcel.archivedAt),
  ];
  return values.filter(Boolean).join(" ").toLowerCase();
}

function getParcelSearchDateKeys(parcel) {
  const dateKey = getParcelWorkdayDateKey(parcel);
  return dateKey ? [dateKey] : [];
}

function parcelMatchesDateSearchFilter(parcel, dateFrom, dateTo) {
  const start = toDateKey(dateFrom);
  const end = toDateKey(dateTo);
  if (!start && !end) return true;
  const rangeStart = start && end ? (start <= end ? start : end) : (start || end);
  const rangeEnd = start && end ? (start <= end ? end : start) : (end || start);
  return getParcelSearchDateKeys(parcel).some((dateKey) => dateKey >= rangeStart && dateKey <= rangeEnd);
}

function parcelMatchesSearchFilters(parcel, filters = {}) {
  if (filters.status && parcel.status !== filters.status) return false;
  if (filters.courier && normalizeUsername(parcel.courierUsername) !== normalizeUsername(filters.courier)) return false;
  return parcelMatchesDateSearchFilter(parcel, filters.dateFrom, filters.dateTo);
}

function getParcelSearchFilters(url) {
  return {
    status: String(url.searchParams.get("status") || "").trim(),
    courier: String(url.searchParams.get("courier") || "").trim(),
    dateFrom: String(url.searchParams.get("dateFrom") || "").trim(),
    dateTo: String(url.searchParams.get("dateTo") || "").trim(),
  };
}

function getPaginationOptions(url) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 0), 0), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  return {
    limit: Number.isFinite(limit) ? Math.trunc(limit) : 0,
    offset: Number.isFinite(offset) ? Math.trunc(offset) : 0,
  };
}

function paginatedPayload(key, records, pagination) {
  if (!pagination.limit) return { [key]: records };
  const total = records.length;
  const offset = Math.min(pagination.offset, total);
  const items = records.slice(offset, offset + pagination.limit);
  return {
    [key]: items,
    total,
    limit: pagination.limit,
    offset,
    hasMore: offset + items.length < total,
  };
}

function toDateKey(value) {
  if (typeof value === "string") {
    const plainDateMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (plainDateMatch) return `${plainDateMatch[1]}-${plainDateMatch[2]}-${plainDateMatch[3]}`;
  }
  return toWorkdayDateKey(value);
}

function getRetentionParcelDateKey(parcel) {
  return toDateKey(parcel.archivedAt || parcel.completedAt || parcel.deliveredAt || parcel.failedAt || parcel.updatedAt || parcel.createdAt);
}

function getRetentionAdjustmentDateKey(adjustment) {
  return toDateKey(adjustment?.date || adjustment?.dateKey || adjustment?.startDate || adjustment?.timestamp || adjustment?.updatedAt || adjustment?.createdAt);
}

function isRetentionParcelExpired(parcel, cutoffDate) {
  const dateKey = getRetentionParcelDateKey(parcel);
  return Boolean(dateKey && cutoffDate && dateKey < cutoffDate);
}

function isRetentionAdjustmentExpired(adjustment, cutoffDate) {
  const dateKey = getRetentionAdjustmentDateKey(adjustment);
  return Boolean(dateKey && cutoffDate && dateKey < cutoffDate);
}

function distanceInMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = degreesToRadians(Number(b.lat) - Number(a.lat));
  const dLng = degreesToRadians(Number(b.lng) - Number(a.lng));
  const lat1 = degreesToRadians(Number(a.lat));
  const lat2 = degreesToRadians(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function createToken(user) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username: user.username, role: user.role, createdAt: Date.now() });
  return token;
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw httpError(413, "მოთხოვნის მოცულობა ძალიან დიდია.");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "მოთხოვნის ფორმატი არასწორია.");
  }
}

function getSession(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? sessions.get(token) : null;
  if (session && Date.now() - Number(session.createdAt || 0) > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session ? { ...session, token } : null;
}

function requireSession(request) {
  const session = getSession(request);
  if (!session) throw httpError(401, "სისტემაში შესვლა აუცილებელია.");
  return session;
}

function requireAdmin(request) {
  const session = requireSession(request);
  if (session.role !== "admin") throw httpError(403, "საჭიროა ადმინის უფლება.");
  return session;
}

function canAccessCourier(session, username) {
  return session.role === "admin" || normalizeUsername(session.username) === normalizeUsername(username);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function cleanPaymentAmount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const normalized = String(value).trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "თანხა უნდა იყოს ნული ან მეტი.");
  return Math.round(amount * 100) / 100;
}

function storedMoney(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function getParcelPaymentAmount(parcel) {
  return [parcel?.paymentAmount, parcel?.cashAmount, parcel?.payment, parcel?.amount, parcel?.price, parcel?.codAmount]
    .map(storedMoney)
    .find((amount) => Number.isFinite(amount) && amount > 0) || 0;
}

function applyDeliveredFinance(db, parcel, options = {}) {
  if (!parcel || parcel.status !== "delivered") return;
  const paymentAmount = getParcelPaymentAmount(parcel);
  const finance = getParcelFinanceSnapshot(db, parcel, options);
  parcel.paymentAmount = paymentAmount;
  parcel.cashAmount = paymentAmount;
  parcel.tariffId = finance.tariffId;
  parcel.tariffLabel = finance.tariffLabel;
  parcel.deliveryTotalPrice = finance.deliveryTotalPrice;
  parcel.courierPay = finance.courierPay;
  parcel.adminProfit = finance.adminProfit;
}

function getParcelDateRangeFilter(url) {
  const start = String(url.searchParams.get("dateFrom") || url.searchParams.get("startDate") || "").trim();
  const end = String(url.searchParams.get("dateTo") || url.searchParams.get("endDate") || start).trim();
  return {
    start: isDateKey(start) ? start : "",
    end: isDateKey(end) ? end : "",
  };
}

function parcelMatchesWorkdayDateRange(parcel, range) {
  if (!range.start && !range.end) return true;
  const dateKey = getParcelWorkdayDateKey(parcel);
  if (!dateKey) return false;
  const start = range.start || range.end;
  const end = range.end || range.start;
  return start <= end ? dateKey >= start && dateKey <= end : dateKey >= end && dateKey <= start;
}

function isCoordinateLabel(value) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(String(value || "").trim());
}

function hasHouseNumber(value) {
  return /\d/.test(String(value || ""));
}

async function handleApi(request, response, url) {
  const db = await readDb();
  const method = request.method || "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/bootstrap") {
    sendJson(response, 200, { hasAdmin: hasAdmin(db) });
    return;
  }

  if (method === "GET" && path === "/api/workday") {
    requireSession(request);
    const workday = ensureWorkdayState(db);
    await writeDb(db);
    sendJson(response, 200, { workday });
    return;
  }

  if (method === "POST" && path === "/api/setup-admin") {
    if (hasAdmin(db)) throw httpError(409, "ადმინის ანგარიში უკვე არსებობს.");
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    if (!username || !password) throw httpError(400, "ლოგინი და პაროლი აუცილებელია.");

    const now = new Date().toISOString();
    const profile = cleanUserProfile(body);
    const user = {
      id: randomBytes(12).toString("hex"),
      username,
      role: "admin",
      status: "active",
      passwordHash: hashPassword(password),
      ...profile,
      createdAt: now,
    };
    db.users.push(user);
    await writeDb(db);
    const token = createToken(user);
    sendJson(response, 201, { token, user: publicUser(user) });
    return;
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJsonBody(request);
    const user = findUser(db, body.username);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      throw httpError(401, "ლოგინი ან პაროლი არასწორია.");
    }
    if (user.status === "pending") throw httpError(403, "ანგარიში ადმინის დადასტურებას ელოდება.");
    if (user.status !== "active") throw httpError(403, "ანგარიში არააქტიურია.");
    const token = createToken(user);
    sendJson(response, 200, { token, user: publicUser(user) });
    return;
  }

  if (method === "POST" && path === "/api/logout") {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/register") {
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username);
    const password = String(body.password || "").trim();
    const profile = cleanUserProfile(body);
    if (!username || !password || !profile.firstName || !profile.lastName || !profile.phone) throw httpError(400, "შეავსეთ ყველა ველი.");
    if (findUser(db, username)) throw httpError(409, "ეს ლოგინი უკვე არსებობს.");

    const now = new Date().toISOString();
    db.users.push({
      id: randomBytes(12).toString("hex"),
      username,
      role: "courier",
      status: "pending",
      passwordHash: hashPassword(password),
      ...profile,
      requestedAt: now,
      approvedAt: "",
      createdAt: now,
    });
    await writeDb(db);
    sendJson(response, 201, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/pending") {
    requireAdmin(request);
    sendJson(response, 200, {
      pending: db.users.filter((user) => user.role === "courier" && user.status === "pending").map(publicUser),
    });
    return;
  }

  const pendingMatch = path.match(/^\/api\/pending\/([^/]+)$/);
  if (pendingMatch && method === "POST") {
    requireAdmin(request);
    const username = decodeURIComponent(pendingMatch[1]);
    const user = findUser(db, username);
    if (!user || user.role !== "courier" || user.status !== "pending") throw httpError(404, "მოთხოვნა ვერ მოიძებნა.");
    user.status = "active";
    user.approvedAt = new Date().toISOString();
    await writeDb(db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (pendingMatch && method === "DELETE") {
    requireAdmin(request);
    const username = decodeURIComponent(pendingMatch[1]);
    const before = db.users.length;
    db.users = db.users.filter((user) => !(normalizeUsername(user.username) === normalizeUsername(username) && user.role === "courier" && user.status === "pending"));
    if (db.users.length === before) throw httpError(404, "მოთხოვნა ვერ მოიძებნა.");
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/couriers") {
    requireSession(request);
    sendJson(response, 200, {
      couriers: db.users.filter((user) => user.role === "courier" && user.status === "active").map(publicUser),
    });
    return;
  }

  if (method === "GET" && path === "/api/zones") {
    requireAdmin(request);
    const zones = Object.entries(TBILISI_ZONES).map(([zoneId, zone]) => publicZone(db, zoneId, zone));
    sendJson(response, 200, {
      zones,
      unassignedCouriers: db.users
        .filter((user) => user.role === "courier" && user.status === "active" && !getUserZoneIds(user).length)
        .map(publicUser),
    });
    return;
  }

  if (method === "GET" && path === "/api/tariffs") {
    const session = requireSession(request);
    if (!["admin", "partner"].includes(session.role)) throw httpError(403, "წვდომა აკრძალულია.");
    sendJson(response, 200, { tariffs: getTariffSettings(db) });
    return;
  }

  if (method === "PUT" && path === "/api/tariffs") {
    const session = requireAdmin(request);
    const body = await readJsonBody(request);
    const tariffs = setTariffSettings(db, body.tariffs || body, session.username);
    await writeDb(db);
    sendJson(response, 200, { tariffs });
    return;
  }

  if (method === "GET" && path === "/api/users") {
    requireAdmin(request);
    sendJson(response, 200, {
      users: db.users.filter((user) => user.status === "active").map(publicUser),
    });
    return;
  }

  if (method === "GET" && path === "/api/partners") {
    requireAdmin(request);
    sendJson(response, 200, {
      partners: db.users.filter((user) => user.role === "partner").map(publicUser),
    });
    return;
  }

  if (method === "GET" && path === "/api/partner-pickups") {
    const session = requireSession(request);
    sendJson(response, 200, {
      pickups: getPartnerPickupPinsForSession(db, session),
    });
    return;
  }

  if (method === "GET" && path === "/api/partner-cash-adjustments") {
    const session = requireSession(request);
    const adjustments = getPartnerCashAdjustments(db).map(publicPartnerCashAdjustment);
    if (session.role === "admin") {
      sendJson(response, 200, { adjustments });
      return;
    }
    if (session.role === "partner") {
      const partner = findUser(db, session.username);
      sendJson(response, 200, {
        adjustments: adjustments.filter((adjustment) => partnerCashAdjustmentBelongsTo(adjustment, partner)),
      });
      return;
    }
    sendJson(response, 200, { adjustments: [] });
    return;
  }

  if (method === "POST" && path === "/api/partner-cash-adjustments") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const partner = findPartnerByIdOrUsername(db, body.partnerId || body.partnerUsername || body.username);
    if (!partner) throw httpError(404, "პარტნიორი ვერ მოიძებნა.");
    const delta = Number(body.delta ?? body.amount ?? 0);
    const targetAmount = Number(body.targetAmount ?? 0);
    if (!Number.isFinite(delta) || !Number.isFinite(targetAmount)) throw httpError(400, "თანხა არასწორია.");
    const now = new Date().toISOString();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateKey || body.date || ""))
      ? String(body.dateKey || body.date)
      : now.slice(0, 10);
    const adjustment = publicPartnerCashAdjustment({
      id: body.id || randomBytes(12).toString("hex"),
      username: partner.username,
      partnerUsername: partner.username,
      partnerId: partnerCashIdentity(partner),
      amount: delta,
      delta,
      targetAmount,
      correctionAmount: body.correctionAmount,
      correctionMode: body.correctionMode,
      type: delta < 0 ? "negative" : "positive",
      category: "partnerCash",
      dateKey,
      date: dateKey,
      note: body.note || "პარტნიორის ქეშის კორექტირება",
      timestamp: body.timestamp || now,
      createdAt: body.createdAt || now,
    });
    setPartnerCashAdjustments(db, [...getPartnerCashAdjustments(db), adjustment]);
    await writeDb(db);
    sendJson(response, 201, { adjustment });
    return;
  }

  if (method === "GET" && path === "/api/daily-balance-ledger") {
    requireAdmin(request);
    sendJson(response, 200, { entries: getDailyBalanceLedger(db).map(publicDailyBalanceEntry) });
    return;
  }

  if (method === "POST" && path === "/api/daily-balance-ledger") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const now = new Date().toISOString();
    const entry = publicDailyBalanceEntry({
      ...body,
      id: body.id || randomBytes(12).toString("hex"),
      createdAt: body.createdAt || now,
      updatedAt: now,
    });
    const entries = getDailyBalanceLedger(db).map(publicDailyBalanceEntry);
    const nextEntries = entries.filter((item) => item.id !== entry.id);
    nextEntries.push(entry);
    setDailyBalanceLedger(db, nextEntries);
    await writeDb(db);
    sendJson(response, 201, { entry });
    return;
  }

  const dailyBalanceLedgerMatch = path.match(/^\/api\/daily-balance-ledger\/([^/]+)$/);
  if (dailyBalanceLedgerMatch && method === "DELETE") {
    requireAdmin(request);
    const id = decodeURIComponent(dailyBalanceLedgerMatch[1]);
    const before = getDailyBalanceLedger(db).map(publicDailyBalanceEntry);
    const entries = before.filter((entry) => entry.id !== id);
    setDailyBalanceLedger(db, entries);
    await writeDb(db);
    sendJson(response, 200, { ok: true, deleted: before.length - entries.length });
    return;
  }

  if (method === "POST" && path === "/api/users") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username);
    const password = String(body.password || "").trim();
    const role = cleanRole(body.role);
    if (!username || !password) throw httpError(400, "ლოგინი და პაროლი აუცილებელია.");
    if (findUser(db, username)) throw httpError(409, "ეს ლოგინი უკვე არსებობს.");

    const now = new Date().toISOString();
    const user = {
      id: randomBytes(12).toString("hex"),
      username,
      role,
      status: "active",
      passwordHash: hashPassword(password),
      ...cleanUserProfile(body),
      ...(role === "partner" ? cleanPartnerProfile(body) : {}),
      createdAt: now,
      approvedAt: now,
    };
    db.users.push(user);
    await writeDb(db);
    sendJson(response, 201, { user: publicUser(user) });
    return;
  }

  if (method === "POST" && path === "/api/partners") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username || body.email);
    const password = String(body.password || "").trim();
    const profile = cleanPartnerProfile(body);
    if (!username || !password || !profile.companyName || !profile.contactPerson || !profile.phone) throw httpError(400, "შეავსეთ პარტნიორის ყველა სავალდებულო ველი.");
    if (findUser(db, username)) throw httpError(409, "ეს ლოგინი უკვე არსებობს.");

    const now = new Date().toISOString();
    const user = {
      id: randomBytes(12).toString("hex"),
      username,
      role: "partner",
      status: body.status === "inactive" ? "inactive" : "active",
      passwordHash: hashPassword(password),
      ...profile,
      firstName: profile.contactPerson,
      lastName: "",
      bankDetails: "",
      createdAt: now,
      approvedAt: now,
    };
    db.users.push(user);
    await writeDb(db);
    sendJson(response, 201, { partner: publicUser(user) });
    return;
  }

  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  const userZoneMatch = path.match(/^\/api\/users\/([^/]+)\/zone$/);
  const partnerMatch = path.match(/^\/api\/partners\/([^/]+)$/);
  const partnerPickupAckMatch = path.match(/^\/api\/partners\/([^/]+)\/pickup-ack$/);
  if (partnerPickupAckMatch && method === "POST") {
    const session = requireSession(request);
    if (!["admin", "courier"].includes(session.role)) throw httpError(403, "წვდომა აკრძალულია.");
    const username = decodeURIComponent(partnerPickupAckMatch[1]);
    const partner = findUser(db, username);
    if (!partner || partner.role !== "partner" || partner.status !== "active") throw httpError(404, "პარტნიორი ვერ მოიძებნა.");
    const zoneId = getPartnerPickupZoneId(partner);
    const sessionUser = findUser(db, session.username) || session;
    if (session.role === "courier" && !userHasZone(sessionUser, zoneId)) throw httpError(403, "ეს პარტნიორი თქვენს ზონაში არ არის.");
    const activeParcels = getActivePartnerPickupParcels(db, partner);
    const now = new Date().toISOString();
    activeParcels.forEach((parcel) => {
      parcel.pickedUpAt = now;
      parcel.pickedUpBy = session.username || "";
      parcel.pickedUpByRole = session.role || "";
      parcel.partnerPickupAcknowledgedAt = now;
      parcel.partnerPickupAcknowledgedBy = session.username || "";
      parcel.updatedAt = now;
    });
    partner.lastPickupAcknowledgedAt = now;
    partner.lastPickupAcknowledgedBy = session.username || "";
    partner.lastPickupAcknowledgedByRole = session.role || "";
    partner.updatedAt = now;
    await writeDb(db);
    sendJson(response, 200, {
      partner: publicUser(partner),
      acknowledgedAt: now,
      acknowledgedCount: activeParcels.length,
      pickup: publicPartnerPickup(db, partner, getActivePartnerPickupParcels(db, partner)),
    });
    return;
  }
  if (partnerMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(partnerMatch[1]);
    const user = findUser(db, username);
    if (!user || user.role !== "partner") throw httpError(404, "პარტნიორი ვერ მოიძებნა.");
    const body = await readJsonBody(request);
    Object.assign(user, cleanPartnerProfile(body));
    user.firstName = user.contactPerson;
    if (body.status === "active" || body.status === "inactive") user.status = body.status;
    if (body.password !== undefined) {
      const password = String(body.password || "").trim();
      if (password) user.passwordHash = hashPassword(password);
    }
    user.updatedAt = new Date().toISOString();
    db.parcels.forEach((parcel) => {
      if (parcelBelongsToPartner(parcel, user)) {
        parcel.partnerName = partnerDisplayName(user);
      }
    });
    await writeDb(db);
    sendJson(response, 200, { partner: publicUser(user) });
    return;
  }

  if (userZoneMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(userZoneMatch[1]);
    const user = findUser(db, username);
    if (!user || user.role !== "courier" || user.status !== "active") throw httpError(404, "კურიერი ვერ მოიძებნა.");
    const body = await readJsonBody(request);
    const zoneIds = cleanZoneIds(body.zoneIds !== undefined ? body.zoneIds : body.zoneId);
    user.zoneIds = zoneIds;
    user.zoneId = zoneIds[0] || "";
    await writeDb(db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (userMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(userMatch[1]);
    const user = findUser(db, username);
    if (!user || user.status !== "active") throw httpError(404, "ანგარიში ვერ მოიძებნა.");
    const body = await readJsonBody(request);
    Object.assign(user, cleanUserProfile(body));
    if (user.role === "partner") {
      const partnerProfile = cleanPartnerProfile(body);
      Object.assign(user, partnerProfile);
      user.firstName = partnerProfile.contactPerson;
    }
    if (body.password !== undefined) {
      const password = String(body.password || "").trim();
      if (password) user.passwordHash = hashPassword(password);
    }
    user.updatedAt = new Date().toISOString();
    await writeDb(db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (userMatch && method === "DELETE") {
    requireAdmin(request);
    const username = decodeURIComponent(userMatch[1]);
    const user = findUser(db, username);
    if (!user || user.status !== "active") throw httpError(404, "ანგარიში ვერ მოიძებნა.");
    if (user.role === "admin") throw httpError(403, "ადმინის დეაქტივაცია შეუძლებელია.");
    if (user.role === "partner") {
      user.status = "inactive";
      user.updatedAt = new Date().toISOString();
      await writeDb(db);
      sendJson(response, 200, { ok: true });
      return;
    }
    db.users = db.users.filter((item) => normalizeUsername(item.username) !== normalizeUsername(username));
    db.parcels = db.parcels.filter((parcel) => normalizeUsername(parcel.courierUsername) !== normalizeUsername(username));
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  const courierPasswordMatch = path.match(/^\/api\/couriers\/([^/]+)\/password$/);
  if (courierPasswordMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(courierPasswordMatch[1]);
    const body = await readJsonBody(request);
    const password = String(body.password || "").trim();
    if (!password) throw httpError(400, "პაროლი აუცილებელია.");
    const user = findUser(db, username);
    if (!user || user.role !== "courier" || user.status !== "active") throw httpError(404, "კურიერი ვერ მოიძებნა.");
    user.passwordHash = hashPassword(password);
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/geocode/search") {
    requireAdmin(request);
    const q = String(url.searchParams.get("q") || "").trim();
    const street = String(url.searchParams.get("street") || "").trim();
    if (!q && !street) {
      sendJson(response, 200, []);
      return;
    }
    const results = await fetchNominatimJson("/search", {
      format: "jsonv2",
      q,
      street,
      city: url.searchParams.get("city") || "",
      country: url.searchParams.get("country") || "",
      addressdetails: url.searchParams.get("addressdetails") || 1,
      limit: Math.min(Number(url.searchParams.get("limit") || 10), 10),
      countrycodes: "ge",
      viewbox: url.searchParams.get("viewbox") || "44.60,41.88,45.05,41.55",
      bounded: url.searchParams.get("bounded") || 1,
      "accept-language": url.searchParams.get("accept-language") || "ka,en",
    }, []);
    sendJson(response, 200, Array.isArray(results) ? results : []);
    return;
  }

  if (method === "GET" && path === "/api/geocode/reverse") {
    requireAdmin(request);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      sendJson(response, 200, {});
      return;
    }
    const result = await fetchNominatimJson("/reverse", {
      format: "jsonv2",
      lat,
      lon,
      zoom: url.searchParams.get("zoom") || 18,
      addressdetails: url.searchParams.get("addressdetails") || 1,
      "accept-language": url.searchParams.get("accept-language") || "ka,en",
    }, {});
    sendJson(response, 200, result && typeof result === "object" ? result : {});
    return;
  }

  if (method === "GET" && path === "/api/parcels") {
    const session = requireSession(request);
    await backfillPartnerParcelLocations(db);
    const partnerId = String(url.searchParams.get("partnerId") || "").trim();
    const dateRange = getParcelDateRangeFilter(url);
    const partnerUser = session.role === "partner" ? findUser(db, session.username) : null;
    const courier = session.role === "partner" ? "" : url.searchParams.get("courier") || (session.role === "admin" ? "" : session.username);
    if (courier && !canAccessCourier(session, courier)) throw httpError(403, "წვდომა აკრძალულია.");
    const parcels = db.parcels
      .filter((parcel) => {
        if (parcel.archivedAt || isDeletedParcel(parcel)) return false;
        if (!parcelMatchesWorkdayDateRange(parcel, dateRange)) return false;
        if (session.role === "partner") return parcelBelongsToPartner(parcel, partnerUser);
        if (session.role === "admin" && !parcelMatchesPartnerFilter(parcel, partnerId)) return false;
        return !courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier);
      })
      .map((parcel) => publicParcel(db, parcel));
    sendJson(response, 200, paginatedPayload("parcels", parcels, getPaginationOptions(url)));
    return;
  }

  if (method === "POST" && path === "/api/parcels") {
    const session = requireSession(request);
    if (!["admin", "partner"].includes(session.role)) throw httpError(403, "წვდომა აკრძალულია.");
    const body = await readJsonBody(request);
    const courierUsername = cleanUsername(body.courierUsername);
    if (session.role === "admin" && !canAccessCourier(session, courierUsername || session.username)) throw httpError(403, "წვდომა აკრძალულია.");
    if (session.role === "partner" && courierUsername) throw httpError(403, "პარტნიორს კურიერის მიბმა არ შეუძლია.");
    let courier = courierUsername ? findUser(db, courierUsername) : null;
    if (courierUsername && (!courier || courier.role !== "courier" || courier.status !== "active")) throw httpError(404, "კურიერი ვერ მოიძებნა.");

    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    let lat = Number(body.lat ?? body.latitude);
    let lng = Number(body.lng ?? body.longitude);
    const fullAddress = cleanAddressPart(body.fullAddress || buildPartnerFullAddress(body) || body.address);
    const address = stripPartnerAddressNoise(body.address || fullAddress);
    const paymentAmount = cleanPaymentAmount(body.paymentAmount ?? body.payment ?? body.cashAmount);
    const partnerUser = session.role === "partner" ? findUser(db, session.username) : null;
    const selectedPartner = session.role === "partner"
      ? partnerUser
      : findPartnerByIdOrUsername(db, body.partnerId || body.partnerUsername || "");
    if (session.role === "partner" && (!partnerUser || partnerUser.role !== "partner" || partnerUser.status !== "active")) throw httpError(403, "პარტნიორის ანგარიში არააქტიურია.");
    if (selectedPartner && selectedPartner.status !== "active") throw httpError(400, "პარტნიორის ანგარიში არააქტიურია.");
    if (session.role === "partner" && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
      const geocoded = await geocodePartnerAddress({ ...body, address: fullAddress || address });
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      }
    }
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    if (!fullName || !phone || (session.role === "admin" && !hasCoords)) throw httpError(400, "შეავსეთ შეკვეთის დეტალები.");
    if (!address || isCoordinateLabel(address) || (session.role === "admin" && !hasHouseNumber(address))) throw httpError(400, "ქუჩის მისამართი აუცილებელია.");

    const detectedZone = hasCoords ? detectTbilisiZone({ lat, lng }) : null;
    let autoAssigned = false;
    let assignmentMessage = "";
    if ((session.role === "admin" || session.role === "partner") && !courierUsername) {
      if (!detectedZone) {
        assignmentMessage = "ამ მისამართისთვის ზონა ვერ მოიძებნა";
      } else {
        courier = findLeastBusyCourierForZone(db, detectedZone.id);
        if (courier) {
          autoAssigned = true;
        } else {
          assignmentMessage = "ამ ზონაში კურიერი არ არის მიბმული";
        }
      }
    }

    const now = new Date().toISOString();
    const workdayKey = getCurrentWorkdayKey(db, new Date(now));
    const explicitTariffId = cleanParcelTariffId(body.tariffId || body.tariffType || body.deliveryTariffId);
    assertParcelTariffAllowed(explicitTariffId, new Date(now));
    const tariffId = explicitTariffId || (detectedZone ? "city" : "suburbs");
    const tariff = getTariffSettings(db)[tariffId] || getTariffSettings(db).city;
    const locationAccuracy = hasCoords
      ? session.role === "partner" ? "approximate" : String(body.locationAccuracy || "confirmed")
      : "missing";
    const locationSource = hasCoords
      ? session.role === "partner" ? "partner_address_geocoded" : String(body.locationSource || "admin_created")
      : "missing";
    const coords = hasCoords ? { lat, lng, latitude: lat, longitude: lng } : {};
    const parcel = {
      id: randomBytes(12).toString("hex"),
      courierUsername: courier?.username || "",
      ...coords,
      address,
      fullAddress: fullAddress || address,
      fullName,
      phone,
      city: stripPartnerAddressNoise(body.city),
      district: stripPartnerAddressNoise(body.district || body.area),
      streetAddress: extractPartnerStreetAddress(body),
      building: session.role === "partner" ? "" : extractPartnerBuilding(body),
      floor: session.role === "partner" ? "" : String(body.floor || "").trim(),
      apartment: session.role === "partner" ? "" : String(body.apartment || "").trim(),
      comment: session.role === "partner" ? "" : String(body.comment || body.notes || "").trim(),
      locationAccuracy,
      locationSource,
      locationConfirmedByAdmin: locationAccuracy === "confirmed",
      locationUpdatedAt: hasCoords ? now : "",
      partnerId: selectedPartner?.id || "",
      partnerName: selectedPartner ? partnerDisplayName(selectedPartner) : "",
      partnerUsername: selectedPartner?.username || "",
      createdByRole: session.role,
      paymentAmount,
      cashAmount: paymentAmount,
      codAmount: paymentAmount,
      deliveryTotalPrice: "",
      courierPay: "",
      adminProfit: "",
      tariffId,
      tariffLabel: tariff.label,
      volumeTariffId: isVolumeTariffId(tariffId) ? tariffId : "",
      expressDelivery: isExpressTariffId(tariffId),
      deliveryServiceType: isExpressTariffId(tariffId) ? "express" : isVolumeTariffId(tariffId) ? "volume" : "standard",
      zoneId: detectedZone?.id || "",
      zoneName: detectedZone?.name || "",
      autoAssigned,
      status: "pending",
      workdayKey,
      assignedAt: courier ? now : "",
      createdAt: now,
      updatedAt: now,
    };
    db.parcels.push(parcel);
    await writeDb(db);
    sendJson(response, 201, { parcel: publicParcel(db, parcel), assignmentMessage });
    return;
  }

  if (method === "PATCH" && path === "/api/parcels/assign") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const courierUsername = cleanUsername(body.courierUsername);
    const parcelIds = Array.isArray(body.parcelIds) ? body.parcelIds.map((id) => String(id)) : [];
    const expectedUpdatedAtById = body.expectedUpdatedAtById && typeof body.expectedUpdatedAtById === "object" ? body.expectedUpdatedAtById : {};
    const courier = findUser(db, courierUsername);
    if (!courier || courier.role !== "courier" || courier.status !== "active") throw httpError(404, "კურიერი ვერ მოიძებნა.");
    if (!parcelIds.length) throw httpError(400, "აირჩიეთ მინიმუმ ერთი ამანათი.");

    let assigned = 0;
    db.parcels.forEach((parcel) => {
      if (parcelIds.includes(parcel.id) && !parcel.archivedAt && !isDeletedParcel(parcel)) {
        if (!Number.isFinite(Number(parcel.lat ?? parcel.latitude)) || !Number.isFinite(Number(parcel.lng ?? parcel.longitude))) return;
        assertParcelVersion(parcel, expectedUpdatedAtById[parcel.id]);
        parcel.courierUsername = courier.username;
        parcel.assignedAt = new Date().toISOString();
        parcel.updatedAt = parcel.assignedAt;
        parcel.autoAssigned = false;
        assigned += 1;
      }
    });
    if (!assigned) throw httpError(400, "კურიერის მიბმამდე მიუთითეთ შეკვეთის პინის ლოკაცია.");
    await writeDb(db);
    sendJson(response, 200, { assigned });
    return;
  }

  const parcelLocationMatch = path.match(/^\/api\/parcels\/([^/]+)\/location$/);
  if (parcelLocationMatch && method === "PATCH") {
    const session = requireAdmin(request);
    const body = await readJsonBody(request);
    const lat = Number(body.lat ?? body.latitude);
    const lng = Number(body.lng ?? body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw httpError(400, "სწორი გრძედი და განედი აუცილებელია.");
    const parcel = db.parcels.find((item) => item.id === decodeURIComponent(parcelLocationMatch[1]));
    if (!parcel || parcel.archivedAt || isDeletedParcel(parcel)) throw httpError(404, "შეკვეთა ვერ მოიძებნა.");
    assertParcelVersion(parcel, body.expectedUpdatedAt);
    const now = new Date().toISOString();
    parcel.lat = lat;
    parcel.lng = lng;
    parcel.latitude = lat;
    parcel.longitude = lng;
    parcel.locationAccuracy = body.locationAccuracy === "approximate" ? "approximate" : "confirmed";
    parcel.locationSource = body.locationSource || (parcel.locationAccuracy === "confirmed" ? "admin_manual_adjustment" : "partner_address_geocoded");
    parcel.locationConfirmedByAdmin = parcel.locationAccuracy === "confirmed";
    parcel.locationUpdatedAt = now;
    parcel.updatedAt = now;
    await writeDb(db);
    sendJson(response, 200, { parcel: publicParcel(db, parcel), user: publicUser(findUser(db, session.username)) });
    return;
  }

  const parcelStatusMatch = path.match(/^\/api\/parcels\/([^/]+)\/status$/);
  if (parcelStatusMatch && method === "PATCH") {
    const session = requireSession(request);
    const body = await readJsonBody(request);
    const status = String(body.status || "");
    if (!["delivered", "failed", "pending"].includes(status)) throw httpError(400, "სტატუსი არასწორია.");
    const parcel = db.parcels.find((item) => item.id === decodeURIComponent(parcelStatusMatch[1]));
    if (!parcel || parcel.archivedAt || isDeletedParcel(parcel)) throw httpError(404, "ამანათი ვერ მოიძებნა.");
    assertParcelVersion(parcel, body.expectedUpdatedAt);
    if (!canAccessCourier(session, parcel.courierUsername)) throw httpError(403, "წვდომა აკრძალულია.");
    if (session.role !== "admin" && status === "pending") throw httpError(403, "ამანათის მოლოდინში დაბრუნება მხოლოდ ადმინს შეუძლია.");
    if (session.role !== "admin" && parcel.status === "delivered" && status === "failed") throw httpError(403, "ჩაბარებული შეკვეთის შეცვლა მხოლოდ ადმინს შეუძლია.");
    if (status === "failed" && !String(body.failureReason || "").trim()) throw httpError(400, "ვერ ჩაბარების მიზეზი აუცილებელია.");
    const now = new Date().toISOString();
    const wasDelivered = parcel.status === "delivered";
    parcel.status = status;
    parcel.updatedAt = now;
    if (status === "pending") {
      parcel.completedAt = "";
      parcel.deliveredAt = "";
      parcel.failedAt = "";
      parcel.failureReason = "";
      parcel.completedWorkdayKey = "";
      parcel.financeDateKey = "";
      parcel.deliveryTotalPrice = "";
      parcel.courierPay = "";
      parcel.adminProfit = "";
    }
    if (status === "delivered") {
      parcel.completedAt = now;
      parcel.deliveredAt = now;
      parcel.failedAt = "";
      parcel.failureReason = "";
      parcel.completedWorkdayKey = toDateKey(parcel.deliveredAt);
      parcel.financeDateKey = parcel.completedWorkdayKey;
      applyDeliveredFinance(db, parcel, { forceCurrentTariff: !wasDelivered });
    }
    if (status === "failed") {
      parcel.completedAt = now;
      parcel.failedAt = now;
      parcel.deliveredAt = "";
      parcel.failureReason = String(body.failureReason || "").trim();
      parcel.completedWorkdayKey = toDateKey(parcel.failedAt);
    }
    await writeDb(db);
    sendJson(response, 200, { parcel: publicParcel(db, parcel) });
    return;
  }

  const parcelDeleteMatch = path.match(/^\/api\/parcels\/([^/]+)$/);
  if (parcelDeleteMatch && method === "DELETE") {
    const session = requireSession(request);
    const body = await readJsonBody(request).catch(() => ({}));
    const parcel = db.parcels.find((item) => item.id === decodeURIComponent(parcelDeleteMatch[1]));
    if (!parcel || parcel.archivedAt || isDeletedParcel(parcel)) throw httpError(404, "შეკვეთა ვერ მოიძებნა.");
    if (!canDeleteParcel(session, db, parcel)) throw httpError(403, "ამ შეკვეთის წაშლა შეუძლებელია.");
    assertParcelVersion(parcel, body.expectedUpdatedAt);
    const now = new Date().toISOString();
    parcel.deletedAt = now;
    parcel.deletedBy = session.username;
    parcel.deletedByRole = session.role;
    parcel.deleteReason = String(body.reason || "").trim();
    parcel.updatedAt = now;
    await writeDb(db);
    sendJson(response, 200, { deleted: 1, parcel: publicParcel(db, parcel) });
    return;
  }

  if (method === "POST" && path === "/api/parcels/archive") {
    const session = requireSession(request);
    const body = await readJsonBody(request);
    const courier = session.role === "admin" ? cleanUsername(body.courierUsername || "") : session.username;
    const parcelIds = Array.isArray(body.parcelIds) ? new Set(body.parcelIds.map((id) => String(id))) : null;
    const closeWorkday = Boolean(body.closeWorkday);
    if (closeWorkday && session.role !== "admin") throw httpError(403, "სამუშაო დღის დახურვა მხოლოდ ადმინს შეუძლია.");
    const workdayState = ensureWorkdayState(db);
    const closeWorkdayKey = isDateKey(body.workdayKey) ? String(body.workdayKey) : workdayState.currentWorkdayKey;
    if (courier && !canAccessCourier(session, courier)) throw httpError(403, "წვდომა აკრძალულია.");
    const now = new Date().toISOString();
    let archived = 0;
    db.parcels.forEach((parcel) => {
      const matchesCloseWorkday = !closeWorkday || getParcelWorkdayDateKey(parcel) === closeWorkdayKey;
      if (!parcel.archivedAt && !isDeletedParcel(parcel) && isCompletedParcel(parcel) && matchesCloseWorkday && (!parcelIds || parcelIds.has(parcel.id)) && (!courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier))) {
        applyDeliveredFinance(db, parcel);
        parcel.archivedAt = now;
        if (body.autoClosedDate) {
          parcel.autoClosedAt = now;
          parcel.autoClosedDate = String(body.autoClosedDate);
        }
        parcel.updatedAt = now;
        archived += 1;
      }
    });
    const nextWorkday = closeWorkday ? closeCurrentWorkday(db, closeWorkdayKey, new Date(now)) : ensureWorkdayState(db, new Date(now));
    await writeDb(db);
    sendJson(response, 200, { archived, workday: nextWorkday, closedWorkdayKey: closeWorkday ? closeWorkdayKey : "" });
    return;
  }

  if (method === "POST" && path === "/api/maintenance/retention") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.cutoffDate || ""))
      ? String(body.cutoffDate)
      : toDateKey(body.cutoffDate);
    const partnerOrderCutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.partnerOrderCutoffDate || ""))
      ? String(body.partnerOrderCutoffDate)
      : toDateKey(body.partnerOrderCutoffDate);
    if (!cutoffDate) throw httpError(400, "გასუფთავების თარიღი არასწორია.");

    const beforeParcels = db.parcels.length;
    const beforePartnerCashAdjustments = getPartnerCashAdjustments(db).length;
    db.parcels = db.parcels.filter((parcel) => {
      if (!parcel.archivedAt) return true;
      const retentionCutoff = isPartnerParcel(parcel) && partnerOrderCutoffDate ? partnerOrderCutoffDate : cutoffDate;
      return !isRetentionParcelExpired(parcel, retentionCutoff);
    });
    setPartnerCashAdjustments(db, getPartnerCashAdjustments(db).filter((adjustment) => !isRetentionAdjustmentExpired(adjustment, partnerOrderCutoffDate || cutoffDate)));
    const now = new Date().toISOString();
    db.settings = {
      ...(db.settings && typeof db.settings === "object" ? db.settings : {}),
      lastRetentionCleanupDate: toDateKey(now),
      lastRetentionCleanupAt: now,
      retentionCutoffDate: cutoffDate,
      retentionMonths: Number(body.retentionMonths || DATA_RETENTION_MONTHS),
      partnerOrderRetentionCutoffDate: partnerOrderCutoffDate || cutoffDate,
      partnerOrderRetentionMonths: Number(body.partnerOrderRetentionMonths || PARTNER_ORDER_RETENTION_MONTHS),
    };
    await writeDb(db);
    sendJson(response, 200, {
      deletedParcels: beforeParcels - db.parcels.length,
      deletedCashAdjustments: 0,
      deletedPartnerCashAdjustments: beforePartnerCashAdjustments - getPartnerCashAdjustments(db).length,
      deletedPayAdjustments: 0,
      cutoffDate,
      retentionMonths: db.settings.retentionMonths,
      partnerOrderCutoffDate: db.settings.partnerOrderRetentionCutoffDate,
      partnerOrderRetentionMonths: db.settings.partnerOrderRetentionMonths,
    });
    return;
  }

  if (method === "GET" && path === "/api/history") {
    const session = requireSession(request);
    const dateRange = getParcelDateRangeFilter(url);
    const partnerUser = session.role === "partner" ? findUser(db, session.username) : null;
    const courier = session.role === "partner" ? "" : url.searchParams.get("courier") || (session.role === "admin" ? "" : session.username);
    if (courier && !canAccessCourier(session, courier)) throw httpError(403, "წვდომა აკრძალულია.");
    const history = db.parcels
      .filter((parcel) => {
        if (!parcel.archivedAt) return false;
        if (isDeletedParcel(parcel)) return false;
        if (!parcelMatchesWorkdayDateRange(parcel, dateRange)) return false;
        if (session.role === "partner") return parcelBelongsToPartner(parcel, partnerUser);
        return !courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier);
      })
      .map((parcel) => publicParcel(db, parcel));
    sendJson(response, 200, paginatedPayload("history", history, getPaginationOptions(url)));
    return;
  }

  if (method === "GET" && path === "/api/parcels/search") {
    requireAdmin(request);
    const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const filters = getParcelSearchFilters(url);
    const parcels = db.parcels.filter((parcel) => {
      if (isDeletedParcel(parcel)) return false;
      if (!query) return true;
      return parcelSearchHaystack(db, parcel).includes(query);
    }).filter((parcel) => parcelMatchesSearchFilters(parcel, filters));
    sendJson(response, 200, paginatedPayload("parcels", parcels.map((parcel) => publicParcel(db, parcel)), getPaginationOptions(url)));
    return;
  }

  throw httpError(404, "ვერ მოიძებნა.");
}

async function handleStatic(request, response, url) {
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(frontendRoot, normalizedPath));

  if (!filePath.startsWith(frontendRoot)) {
    response.writeHead(403);
    response.end("წვდომა აკრძალულია");
    return;
  }

  let content;
  let contentPath = filePath;
  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error.code !== "ENOENT" || !isPushAppShellRoute(url.pathname)) throw error;
    contentPath = resolve(frontendRoot, "index.html");
    content = await readFile(contentPath);
  }
  response.writeHead(200, {
    "Content-Type": contentTypes.get(extname(contentPath)) || "application/octet-stream",
    "Cache-Control": getStaticCacheControl(contentPath, url),
  });
  response.end(content);
}

function getStaticCacheControl(filePath, url) {
  const extension = extname(filePath);
  if (extension === ".html") return "no-store";
  if ([".js", ".css"].includes(extension) && url.search) return "public, max-age=31536000, immutable";
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"].includes(extension)) return "public, max-age=604800";
  return "no-store";
}

function isPushAppShellRoute(pathname) {
  const routePath = String(pathname || "").replace(/\/+$/, "");
  const route = routePath.split("/").filter(Boolean).pop() || "";
  return ["push", "pushes", "notifications", "notification", "ფუში", "ფუშები"].includes(route.toLowerCase());
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${currentPort}`);
    if (url.pathname.startsWith("/api/")) {
      await runQueuedApiOperation(() => handleApi(request, response, url));
      return;
    }
    await handleStatic(request, response, url);
  } catch (error) {
    const status = error.status || (error.code === "ENOENT" ? 404 : 500);
    const message = error.status ? error.message : status === 404 ? "ვერ მოიძებნა" : "სერვერის შეცდომა.";
    if ((request.url || "").startsWith("/api/")) {
      sendJson(response, status, { error: message });
      return;
    }
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(message);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && currentPort < initialPort + 20) {
    currentPort += 1;
    server.listen(currentPort, host);
    return;
  }
  throw error;
});

server.listen(currentPort, host, () => {
  console.log(`საკურიერო სისტემა გაშვებულია მისამართზე http://localhost:${currentPort}`);
});


