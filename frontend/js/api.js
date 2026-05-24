"use strict";

const STATIC_DEPLOY_STORAGE_KEY = "deliveryStaticBootstrap:v1";
const STATIC_SESSION_STORAGE_KEY = "deliveryStaticSession:v1";
const STATIC_DEMO_COURIER_USERNAMES = new Set(["courier1", "courier2"]);
const STATIC_DEMO_COURIER_IDS = new Set(["static-courier-1", "static-courier-2"]);
const STATIC_DEMO_COURIER_PHONES = new Set(["+995555000001", "+995555000002"]);
const STATIC_DEFAULT_ADMIN_PASSWORD = "123456";
let staticRealtimeRefreshTimer = null;

function isStaticDeploy() {
  const hostname = window.location.hostname;
  return (
    window.IS_STATIC_DEPLOY === true
    || hostname.includes("github.io")
    || hostname.endsWith(".web.app")
    || hostname.endsWith(".firebaseapp.com")
  );
}

async function loadStaticBootstrap() {
  if (loadStaticBootstrap.cache) return loadStaticBootstrap.cache;

  const fallback = {
    users: [],
    pending: [],
    parcels: [],
    history: [],
    zones: [],
    financeData: {},
    settings: {},
  };
  const stores = [fallback];

  try {
    const response = await fetch("./data/bootstrap.json", { cache: "no-store" });
    if (response.ok) stores.push(await response.json());
  } catch (error) {
    console.warn("Static bootstrap data unavailable", error);
  }

  try {
    const stored = loadData(STATIC_DEPLOY_STORAGE_KEY);
    if (stored && typeof stored === "object") stores.push(stored);
  } catch {
    clearData(STATIC_DEPLOY_STORAGE_KEY);
  }

  try {
    if (typeof loadFirebaseStaticStore === "function") {
      const firebaseStore = await loadFirebaseStaticStore();
      if (firebaseStore && typeof firebaseStore === "object") stores.push(firebaseStore);
    }
  } catch (error) {
    console.warn("Firebase static store unavailable", error);
  }

  loadStaticBootstrap.cache = normalizeStaticStore(mergeStaticStores(...stores));
  await backfillStaticPartnerOrderLocations(loadStaticBootstrap.cache);
  hydrateStaticFinanceStorage(loadStaticBootstrap.cache.financeData);
  saveStaticBootstrap();
  startStaticRealtimeSync();
  return loadStaticBootstrap.cache;
}

function mergeStaticStores(...stores) {
  return stores.filter((store) => store && typeof store === "object").reduce((merged, store) => {
    const users = normalizeStaticUsers(store).filter((user) => !isDemoStaticUser(user));
    const pending = (Array.isArray(store.pending) ? store.pending : [])
      .map((user) => normalizeStaticUser({ ...user, role: "courier", status: user?.status || "pending" }, { activatePendingCouriers: false }))
      .filter(Boolean)
      .filter((user) => !isDemoStaticUser(user));
    const parcels = (Array.isArray(store.parcels) ? store.parcels : []).filter((parcel) => !isDemoStaticParcel(parcel)).map(normalizeStaticParcelFinance);
    const history = (Array.isArray(store.history) ? store.history : []).filter((parcel) => !isDemoStaticParcel(parcel)).map(normalizeStaticParcelFinance);

    return {
      users: mergeStaticRecordsByKey(merged.users, users, getStaticUserKey, resolveStaticUserRecord),
      couriers: [],
      pending: mergeStaticRecordsByKey(merged.pending, pending, getStaticUserKey, resolveStaticUserRecord),
      parcels: mergeStaticRecordsByKey(merged.parcels, parcels, getStaticParcelKey, resolveStaticParcelRecord),
      history: mergeStaticRecordsByKey(merged.history, history, getStaticParcelKey, resolveStaticParcelRecord),
      zones: mergeStaticRecordsByKey(merged.zones, Array.isArray(store.zones) ? store.zones : [], getStaticZoneKey),
      financeData: mergeStaticFinanceData(merged.financeData, store.financeData),
      settings: {
        ...(merged.settings && typeof merged.settings === "object" ? merged.settings : {}),
        ...(store.settings && typeof store.settings === "object" ? store.settings : {}),
      },
    };
  }, {
    users: [],
    pending: [],
    parcels: [],
    history: [],
    zones: [],
    financeData: {},
    settings: {},
  });
}

function normalizeStaticStore(store) {
  const merged = mergeStaticStores(store);
  const mergedUsers = merged.users;
  return {
    users: mergedUsers,
    couriers: mergedUsers.filter((user) => user.role === "courier"),
    pending: merged.pending,
    parcels: merged.parcels,
    history: merged.history,
    zones: merged.zones,
    financeData: merged.financeData,
    settings: merged.settings,
  };
}

function normalizeStaticUsers(store) {
  const users = Array.isArray(store.users) ? store.users : [];
  const couriers = Array.isArray(store.couriers) ? store.couriers.map((courier) => ({ ...courier, role: "courier", status: courier.status || "active" })) : [];
  return [...users, ...couriers].map((user) => normalizeStaticUser(user)).filter(Boolean);
}

function normalizeStaticUser(user, options = {}) {
  if (!user || typeof user !== "object") return null;
  const role = user.role === "admin" ? "admin" : user.role === "partner" ? "partner" : "courier";
  const activatePendingCouriers = options.activatePendingCouriers !== false;
  const status = role === "courier" && activatePendingCouriers && user.status === "pending" ? "active" : user.status || "active";
  const normalizedUsername = normalizeUsername(user.username);
  const isSeedAdmin = role === "admin" && normalizedUsername === "admin" && String(user.id || "").toLowerCase() === "static-admin";
  return {
    ...user,
    role,
    status,
    password: user.password ?? (isSeedAdmin ? STATIC_DEFAULT_ADMIN_PASSWORD : user.password),
  };
}

function isDemoStaticUser(user) {
  const username = normalizeUsername(user?.username);
  const id = String(user?.id || "").trim().toLowerCase();
  const phone = String(user?.phone || "").trim();
  return user?.role !== "admin" && (STATIC_DEMO_COURIER_IDS.has(id) || (STATIC_DEMO_COURIER_USERNAMES.has(username) && STATIC_DEMO_COURIER_PHONES.has(phone)));
}

function isDemoStaticParcel(parcel) {
  const id = String(parcel?.id || "").trim().toLowerCase();
  return id.startsWith("static-parcel-") || id.startsWith("static-history-");
}

function mergeStaticRecordsByKey(baseRecords, nextRecords, getKey, resolveRecord = (current, next) => next) {
  const merged = new Map();
  [...(Array.isArray(baseRecords) ? baseRecords : []), ...(Array.isArray(nextRecords) ? nextRecords : [])].forEach((record) => {
    if (!record || typeof record !== "object") return;
    const key = getKey(record) || `missing-key-${merged.size}`;
    const current = merged.get(key);
    merged.set(key, current ? resolveRecord(current, record) : record);
  });
  return Array.from(merged.values());
}

function resolveStaticUserRecord(current, next) {
  const currentTime = getStaticRecordTimestamp(current, ["updatedAt", "approvedAt", "createdAt", "requestedAt"]);
  const nextTime = getStaticRecordTimestamp(next, ["updatedAt", "approvedAt", "createdAt", "requestedAt"]);
  return nextTime >= currentTime ? { ...current, ...next } : { ...next, ...current };
}

function resolveStaticParcelRecord(current, next) {
  const currentTime = getStaticRecordTimestamp(current);
  const nextTime = getStaticRecordTimestamp(next);
  const primary = nextTime >= currentTime ? next : current;
  const secondary = primary === next ? current : next;
  const merged = { ...secondary, ...primary };
  ["archivedAt", "deliveredAt", "completedAt", "failedAt", "updatedAt", "assignedAt", "createdAt"].forEach((field) => {
    merged[field] = primary[field] || secondary[field] || "";
  });
  if ((primary.archivedAt || secondary.archivedAt) && (primary.status === "delivered" || secondary.status === "delivered")) {
    merged.status = "delivered";
  }
  return normalizeStaticParcelFinance(merged);
}

function getStaticRecordTimestamp(record, fields = ["updatedAt", "archivedAt", "deliveredAt", "completedAt", "failedAt", "assignedAt", "createdAt"]) {
  return fields.reduce((latest, field) => {
    const time = Date.parse(record?.[field] || "");
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, 0);
}

function getStaticUserKey(user) {
  return normalizeUsername(user?.username) || String(user?.id || "").trim().toLowerCase();
}

function getStaticParcelKey(parcel) {
  const id = String(parcel?.id || "").trim().toLowerCase();
  if (id) return id;
  return [
    normalizeUsername(parcel?.courierUsername),
    parcel?.createdAt || parcel?.assignedAt || parcel?.completedAt || "",
    parcel?.phone || "",
    parcel?.lat || "",
    parcel?.lng || "",
  ].join("|");
}

function getStaticZoneKey(zone) {
  return String(zone?.id || zone?.name || "").trim().toLowerCase();
}

function mergeStaticFinanceData(baseFinance, nextFinance) {
  const base = baseFinance && typeof baseFinance === "object" ? baseFinance : {};
  const next = nextFinance && typeof nextFinance === "object" ? nextFinance : {};
  return {
    ...base,
    ...next,
    cashAdjustments: mergeStaticRecordsByKey(base.cashAdjustments, next.cashAdjustments, getStaticAdjustmentKey),
    payAdjustments: mergeStaticRecordsByKey(base.payAdjustments, next.payAdjustments, getStaticAdjustmentKey),
  };
}

function normalizeStaticParcelFinance(parcel) {
  if (!parcel || typeof parcel !== "object") return parcel;
  const paymentAmount = getStaticParcelPaymentAmount(parcel);
  const isDelivered = parcel.status === "delivered";
  const deliveryTotalPrice = getStaticMoney(parcel.deliveryTotalPrice);
  const courierPay = getStaticMoney(parcel.courierPay);
  const adminProfit = getStaticMoney(parcel.adminProfit);
  return {
    ...parcel,
    paymentAmount,
    cashAmount: paymentAmount,
    deliveryTotalPrice: isDelivered ? deliveryTotalPrice || CONFIG.deliveryTotalPrice : deliveryTotalPrice,
    courierPay: isDelivered ? courierPay || CONFIG.courierDeliveryPay : courierPay,
    adminProfit: isDelivered ? adminProfit || CONFIG.adminDeliveryProfit : adminProfit,
  };
}

function getStaticParcelPaymentAmount(parcel) {
  const value = parcel?.paymentAmount ?? parcel?.cashAmount ?? parcel?.payment ?? parcel?.amount ?? parcel?.price ?? parcel?.codAmount ?? 0;
  const amount = getStaticMoney(value);
  return amount > 0 ? amount : 0;
}

function getStaticMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function getStaticAdjustmentKey(adjustment) {
  const id = String(adjustment?.id || "").trim().toLowerCase();
  if (id) return id;
  return [
    normalizeUsername(adjustment?.courierId || adjustment?.username),
    adjustment?.date || adjustment?.dateKey || adjustment?.startDate || "",
    adjustment?.timestamp || adjustment?.updatedAt || adjustment?.createdAt || "",
    adjustment?.amount ?? adjustment?.delta ?? "",
  ].join("|");
}

function saveStaticBootstrap() {
  if (!loadStaticBootstrap.cache) return;
  saveData(STATIC_DEPLOY_STORAGE_KEY, loadStaticBootstrap.cache);
  if (typeof saveFirebaseStaticStore === "function") {
    saveFirebaseStaticStore(loadStaticBootstrap.cache).catch((error) => {
      console.warn("Firebase static store save failed", error);
    });
  }
}

function startStaticRealtimeSync() {
  if (!isStaticDeploy() || typeof startFirebaseStaticStoreListener !== "function") return;
  startFirebaseStaticStoreListener(applyFirebaseStaticStoreUpdate).catch((error) => {
    console.warn("Firebase realtime sync unavailable", error);
  });
}

async function applyFirebaseStaticStoreUpdate(store) {
  if (!store || typeof store !== "object") return;
  const normalizedStore = normalizeStaticStore(mergeStaticStores(loadStaticBootstrap.cache, store));
  const backfilled = await backfillStaticPartnerOrderLocations(normalizedStore);
  loadStaticBootstrap.cache = normalizedStore;
  saveData(STATIC_DEPLOY_STORAGE_KEY, normalizedStore);
  if (backfilled && typeof saveFirebaseStaticStore === "function") {
    saveFirebaseStaticStore(normalizedStore).catch((error) => {
      console.warn("Firebase static store save failed", error);
    });
  }
  hydrateStaticFinanceStorage(normalizedStore.financeData);

  if (!state.currentUser || !state.map || typeof refreshPins !== "function") return;
  window.clearTimeout(staticRealtimeRefreshTimer);
  staticRealtimeRefreshTimer = window.setTimeout(() => {
    refreshPins().catch((error) => {
      console.warn("Realtime refresh failed", error);
    });
  }, 350);
}

function hydrateStaticFinanceStorage(financeData = {}) {
  if (loadData(CONFIG.cashAdjustmentsStorageKey) === null && Array.isArray(financeData.cashAdjustments)) {
    saveData(CONFIG.cashAdjustmentsStorageKey, financeData.cashAdjustments);
  }
  if (loadData(CONFIG.partnerCashAdjustmentsStorageKey) === null && Array.isArray(financeData.partnerCashAdjustments)) {
    saveData(CONFIG.partnerCashAdjustmentsStorageKey, financeData.partnerCashAdjustments);
  }
  if (loadData(CONFIG.payAdjustmentsStorageKey) === null && Array.isArray(financeData.payAdjustments)) {
    saveData(CONFIG.payAdjustmentsStorageKey, financeData.payAdjustments);
  }
}

function getStaticFinanceData() {
  return loadStaticBootstrap.cache?.financeData || {};
}

function saveStaticFinanceData(financeData) {
  if (!loadStaticBootstrap.cache) return;
  loadStaticBootstrap.cache.financeData = financeData && typeof financeData === "object" ? financeData : {};
  saveStaticBootstrap();
}

function getStaticRetentionParcelDateKey(parcel) {
  return normalizeDateKey(parcel?.archivedAt || parcel?.completedAt || parcel?.deliveredAt || parcel?.failedAt || parcel?.updatedAt || parcel?.createdAt);
}

function isStaticRetentionParcelExpired(parcel, cutoffDate) {
  const dateKey = getStaticRetentionParcelDateKey(parcel);
  return Boolean(dateKey && cutoffDate && dateKey < cutoffDate);
}

function getStaticRetentionAdjustmentDateKey(adjustment) {
  return normalizeDateKey(adjustment?.date || adjustment?.dateKey || adjustment?.startDate || adjustment?.timestamp || adjustment?.updatedAt || adjustment?.createdAt);
}

function filterStaticRetentionAdjustments(adjustments, cutoffDate) {
  const items = Array.isArray(adjustments) ? adjustments : [];
  return items.filter((adjustment) => {
    const dateKey = getStaticRetentionAdjustmentDateKey(adjustment);
    return !dateKey || !cutoffDate || dateKey >= cutoffDate;
  });
}

function runStaticRetentionCleanup(store, cutoffDate) {
  const beforeHistory = store.history.length;
  const beforeParcels = store.parcels.length;
  const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
  const beforeCashAdjustments = Array.isArray(financeData.cashAdjustments) ? financeData.cashAdjustments.length : 0;
  const beforePartnerCashAdjustments = Array.isArray(financeData.partnerCashAdjustments) ? financeData.partnerCashAdjustments.length : 0;
  const beforePayAdjustments = Array.isArray(financeData.payAdjustments) ? financeData.payAdjustments.length : 0;

  store.history = store.history.filter((parcel) => !isStaticRetentionParcelExpired(parcel, cutoffDate));
  store.parcels = store.parcels.filter((parcel) => !parcel.archivedAt || !isStaticRetentionParcelExpired(parcel, cutoffDate));

  const cashAdjustments = filterStaticRetentionAdjustments(financeData.cashAdjustments, cutoffDate);
  const partnerCashAdjustments = filterStaticRetentionAdjustments(financeData.partnerCashAdjustments, cutoffDate);
  const payAdjustments = filterStaticRetentionAdjustments(financeData.payAdjustments, cutoffDate);
  store.financeData = {
    ...financeData,
    cashAdjustments,
    partnerCashAdjustments,
    payAdjustments,
  };
  saveData(CONFIG.cashAdjustmentsStorageKey, normalizeFinanceAdjustmentList(cashAdjustments, "cash"));
  saveData(CONFIG.partnerCashAdjustmentsStorageKey, normalizeFinanceAdjustmentList(partnerCashAdjustments, "partnerCash"));
  saveData(CONFIG.payAdjustmentsStorageKey, normalizeFinanceAdjustmentList(payAdjustments, "pay"));

  return {
    deletedParcels: (beforeHistory - store.history.length) + (beforeParcels - store.parcels.length),
    deletedCashAdjustments: beforeCashAdjustments - cashAdjustments.length,
    deletedPartnerCashAdjustments: beforePartnerCashAdjustments - partnerCashAdjustments.length,
    deletedPayAdjustments: beforePayAdjustments - payAdjustments.length,
  };
}

function publicStaticUser(user) {
  return {
    id: user.id || user.username,
    username: user.username,
    role: user.role || "courier",
    status: user.status || "active",
    companyName: user.companyName || "",
    contactPerson: user.contactPerson || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    phone: user.phone || "",
    bankDetails: user.bankDetails || "",
    zoneId: user.zoneId || "",
    zoneName: user.zoneName || "",
    createdAt: user.createdAt || "",
    requestedAt: user.requestedAt || "",
    approvedAt: user.approvedAt || "",
  };
}

function publicStaticParcel(store, parcel) {
  const courier = store.users.find((user) => normalizeUsername(user.username) === normalizeUsername(parcel.courierUsername));
  const normalizedParcel = normalizeStaticParcelFinance(parcel);
  return {
    ...normalizedParcel,
    status: normalizedParcel.status || "pending",
    courier: courier ? publicStaticUser(courier) : null,
  };
}

function parseStaticBody(options) {
  return options.body && typeof options.body === "object" ? options.body : {};
}

function createStaticToken(user) {
  return `static:${user.username}:${Date.now()}`;
}

function normalizeStaticGeocodeQuery(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/(?:\s*,\s*)+/g, ", ")
    .replace(/\s+/g, " ");
}

function buildStaticGeocodeQuery(value) {
  const normalized = normalizeStaticGeocodeQuery(value);
  if (!normalized) return "";
  if (/(თბილისი|tbilisi|georgia)/i.test(normalized)) return normalized;
  return `${normalized}, Tbilisi, Georgia`;
}

function buildStaticNominatimQuery(value) {
  const normalized = normalizeStaticGeocodeQuery(value);
  if (!normalized) return "";
  if (/(\u10D7\u10D1\u10D8\u10DA\u10D8\u10E1\u10D8|tbilisi|georgia)/i.test(normalized)) return normalized;
  return `${normalized}, Tbilisi, Georgia`;
}

function stripStaticPartnerAddressNoise(value) {
  return normalizeStaticGeocodeQuery(value)
    .replace(/\b(?:building|floor|apt|apartment|block|entrance)\s*[:#№-]?\s*[\wა-ჰ/-]+/gi, " ")
    .replace(/\b(?:შენობა|სართული|ბინა|კორპუსი|სადარბაზო)\s*[:#№-]?\s*[\wა-ჰ/-]+/gi, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "");
}

function extractStaticPartnerBuilding(body) {
  const direct = stripStaticPartnerAddressNoise(body.building || body.buildingNumber);
  if (direct) return direct;
  const source = String(body.address || body.fullAddress || "");
  const match = source.match(/\b(?:building|შენობა|კორპუსი)\s*[:#№-]?\s*([\wა-ჰ/-]+)/i);
  return match ? stripStaticPartnerAddressNoise(match[1]) : "";
}

function extractStaticPartnerStreet(body) {
  const direct = stripStaticPartnerAddressNoise(body.streetAddress || body.street);
  if (direct) return direct;

  const source = String(body.fullAddress || body.address || "");
  const cityToken = normalizeStaticAddressLookupToken(body.city);
  const districtToken = normalizeStaticAddressLookupToken(body.district || body.area);
  const parts = source.split(",").map(stripStaticPartnerAddressNoise).filter(Boolean);
  const streetPart = parts.find((part) => {
    const token = normalizeStaticAddressLookupToken(part);
    return token && token !== cityToken && token !== districtToken && !/^(building|floor|apt|apartment|შენობა|სართული|ბინა)\b/i.test(part);
  });
  return streetPart || stripStaticPartnerAddressNoise(source);
}

async function geocodeStaticPartnerOrder(body) {
  const city = stripStaticPartnerAddressNoise(body.city || "Tbilisi");
  const district = stripStaticPartnerAddressNoise(body.district || body.area || "");
  const street = extractStaticPartnerStreet(body);
  const building = extractStaticPartnerBuilding(body);
  const variants = [
    [city, district, [street, building].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [city, district, street].filter(Boolean).join(", "),
    [street, district, city].filter(Boolean).join(", "),
    [street, city, "Georgia"].filter(Boolean).join(", "),
  ].filter(Boolean);

  for (const variant of [...new Set(variants)]) {
    const result = await geocodeStaticPartnerQuery(variant);
    if (result) return result;
  }
  return localStaticPartnerAddressFallback(street, building);
}

async function geocodeStaticPartnerQuery(query) {
  const results = await fetchOsmJson("/search", {
    q: buildStaticNominatimQuery(query),
    format: "jsonv2",
    addressdetails: 1,
    limit: 5,
    "accept-language": "ka,en",
    bounded: 0,
    viewbox: getTbilisiViewbox(),
    countrycodes: "ge",
  }).catch(() => []);
  const items = Array.isArray(results) ? results : [];
  const first = items.find((item) => isStaticTbilisiCoords(getStaticResultCoords(item))) || items[0];
  const coords = getStaticResultCoords(first);
  return Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? coords : null;
}

function getStaticResultCoords(result) {
  return {
    lat: Number(result?.lat ?? result?.latitude),
    lng: Number(result?.lon ?? result?.lng ?? result?.longitude),
  };
}

function isStaticTbilisiCoords(coords) {
  return Number(coords?.lat) >= 41.55 && Number(coords?.lat) <= 41.88 && Number(coords?.lng) >= 44.60 && Number(coords?.lng) <= 45.05;
}

function localStaticPartnerAddressFallback(street, building) {
  const token = normalizeStaticAddressLookupToken(street);
  const known = [
    { tokens: ["pekini", "პეკინი", "პეკინის"], base: { lat: 41.72455, lng: 44.76835 }, step: { lat: -0.00001, lng: 0.00002 } },
    { tokens: ["university", "უნივერსიტეტის"], base: { lat: 41.7206, lng: 44.7219 }, step: { lat: 0.00001, lng: 0.00002 } },
    { tokens: ["abashidze", "აბაშიძე", "აბაშიძის"], base: { lat: 41.70717, lng: 44.77018 }, step: { lat: 0.000015, lng: -0.000035 } },
    { tokens: ["sairme", "საირმე", "საირმის"], base: { lat: 41.7190, lng: 44.7500 }, step: { lat: 0.000010, lng: 0.000020 } },
    { tokens: ["paliashvili", "ფალიაშვილი", "ფალიაშვილის"], base: { lat: 41.71001, lng: 44.75489 }, step: { lat: -0.000010, lng: 0.000020 } },
    { tokens: ["tsintsadze", "ცინცაძე", "ცინცაძის"], base: { lat: 41.72166, lng: 44.76621 }, step: { lat: -0.000015, lng: -0.000010 } },
    { tokens: ["taqtakishvili", "taktakishvili", "თაქთაქიშვილი", "თაქთაქიშვილის"], base: { lat: 41.70819, lng: 44.76478 }, step: { lat: 0.000010, lng: -0.000010 } },
    { tokens: ["rustaveli", "რუსთაველი", "რუსთაველის"], base: { lat: 41.70077, lng: 44.79561 }, step: { lat: 0.000010, lng: -0.000015 } },
  ];
  const match = known.find((item) => item.tokens.some((itemToken) => token.includes(normalizeStaticAddressLookupToken(itemToken))));
  if (!match) return null;
  const houseNumber = Number.parseInt(building || street, 10);
  const offset = Number.isFinite(houseNumber) ? Math.max(-80, Math.min(80, houseNumber - 12)) : 0;
  return {
    lat: match.base.lat + (offset * match.step.lat),
    lng: match.base.lng + (offset * match.step.lng),
  };
}

function normalizeStaticAddressLookupToken(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|tbilisi|georgia)\b/gi, " ")
    .replace(/\b(ქუჩა|ქ|გამზირი|გამზ|თბილისი|საქართველო)\b/gi, " ")
    .replace(/\d+[a-zა-ჰ/-]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStaticPartnerParcel(parcel) {
  return Boolean(parcel?.partnerId || parcel?.partnerUsername || parcel?.createdByRole === "partner");
}

function hasStaticParcelCoords(parcel) {
  return Number.isFinite(Number(parcel?.lat ?? parcel?.latitude)) && Number.isFinite(Number(parcel?.lng ?? parcel?.longitude));
}

async function backfillStaticPartnerOrderLocations(store) {
  if (!store || !Array.isArray(store.parcels)) return false;
  let changed = false;
  for (const parcel of store.parcels) {
    if (!parcel || parcel.archivedAt || !isStaticPartnerParcel(parcel) || hasStaticParcelCoords(parcel)) continue;
    const geocoded = await geocodeStaticPartnerOrder(parcel);
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
    changed = true;
  }
  return changed;
}

function saveStaticSession(user) {
  const session = { token: createStaticToken(user), user: publicStaticUser(user), savedAt: new Date().toISOString() };
  saveData(STATIC_SESSION_STORAGE_KEY, session);
  return session;
}

function loadStaticSessionPayload() {
  const session = loadData(STATIC_SESSION_STORAGE_KEY);
  if (!session?.user?.username) return null;
  return { token: session.token || createStaticToken(session.user), user: session.user, staticMode: true };
}

function clearStaticSession() {
  clearData(STATIC_SESSION_STORAGE_KEY);
}

function verifyStaticPassword(user, password) {
  const supplied = String(password || "");
  if (user?.password !== undefined) return supplied === String(user.password || "");
  return supplied === "";
}

async function staticApi(path, options = {}) {
  const store = await loadStaticBootstrap();
  const method = options.method || "GET";
  const url = new URL(path, window.location.href);
  const apiPath = url.pathname.replace(/^\/amanati/, "");
  const body = parseStaticBody(options);

  if (method === "GET" && apiPath === "/api/bootstrap") {
    return {
      hasAdmin: store.users.some((user) => user.role === "admin" && user.status === "active"),
      staticMode: true,
      defaultUser: store.settings.defaultUser || store.users.find((user) => user.role === "admin")?.username || store.users[0]?.username || "",
    };
  }

  if (method === "POST" && apiPath === "/api/login") {
    const requestedUsername = body.username || store.settings.defaultUser || store.users.find((user) => user.role === "admin")?.username || store.users[0]?.username;
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(requestedUsername));
    if (!user || user.status !== "active" || !verifyStaticPassword(user, body.password)) throw new Error(STRINGS.invalidLogin);
    return { ...saveStaticSession(user), staticMode: true };
  }

  if (method === "POST" && apiPath === "/api/setup-admin") {
    const username = String(body.username || "admin").trim();
    const user = { id: `user-${Date.now()}`, username, password: body.password || "", role: "admin", status: "active", createdAt: new Date().toISOString() };
    store.users.push(user);
    store.settings.defaultUser = username;
    saveStaticBootstrap();
    return { ...saveStaticSession(user), staticMode: true };
  }

  if (method === "POST" && apiPath === "/api/register") {
    const existing = store.users.find((user) => normalizeUsername(user.username) === normalizeUsername(body.username));
    if (existing) throw new Error("მომხმარებელი უკვე არსებობს.");
    const now = new Date().toISOString();
    const user = {
      id: `user-${Date.now()}`,
      username: body.username,
      password: body.password || "",
      firstName: body.firstName || "",
      lastName: body.lastName || "",
      phone: body.phone || "",
      role: "courier",
      status: "active",
      requestedAt: now,
      approvedAt: now,
      createdAt: now,
    };
    store.users.push(user);
    saveStaticBootstrap();
    return { ok: true, user: publicStaticUser(user) };
  }

  if (method === "POST" && apiPath === "/api/logout") {
    clearStaticSession();
    return { ok: true };
  }

  if (method === "GET" && apiPath === "/api/users") return { users: store.users.map(publicStaticUser) };

  if (method === "GET" && apiPath === "/api/partners") {
    return { partners: store.users.filter((user) => user.role === "partner").map(publicStaticUser) };
  }

  if (method === "GET" && apiPath === "/api/couriers") {
    return { couriers: store.users.filter((user) => user.role === "courier" && user.status === "active").map(publicStaticUser) };
  }

  if (method === "GET" && apiPath === "/api/pending") return { pending: store.pending.map(publicStaticUser) };

  if (method === "GET" && apiPath === "/api/zones") return { zones: store.zones };

  if (method === "GET" && apiPath === "/api/parcels") {
    const courier = url.searchParams.get("courier") || "";
    const partnerId = url.searchParams.get("partnerId") || "";
    return {
      parcels: store.parcels
        .filter((parcel) => {
          if (parcel.archivedAt) return false;
          if (state.isPartner) return parcel.partnerId === state.currentUserProfile?.id;
          if (partnerId && parcel.partnerId !== partnerId) return false;
          return !courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier);
        })
        .map((parcel) => publicStaticParcel(store, parcel)),
    };
  }

  if (method === "GET" && apiPath === "/api/history") {
    const courier = url.searchParams.get("courier") || "";
    return {
      history: [...store.history, ...store.parcels.filter((parcel) => parcel.archivedAt)]
        .filter((parcel) => !courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier))
        .map((parcel) => publicStaticParcel(store, parcel)),
    };
  }

  if (method === "GET" && apiPath === "/api/parcels/search") {
    const query = String(url.searchParams.get("q") || "").toLowerCase();
    const records = [...store.parcels, ...store.history];
    return {
      parcels: records
        .filter((parcel) => !query || [parcel.fullName, parcel.phone, parcel.address, parcel.courierUsername, parcel.status].some((value) => String(value || "").toLowerCase().includes(query)))
        .map((parcel) => publicStaticParcel(store, parcel)),
    };
  }

  if (method === "GET" && apiPath === "/api/geocode/search") {
    const rawQuery = String(url.searchParams.get("q") || "");
    const query = buildStaticNominatimQuery(rawQuery);
    if (!query) return [];

    const results = await fetchOsmJson("/search", {
      q: query,
      format: "jsonv2",
      addressdetails: 1,
      limit: 8,
      "accept-language": "ka",
      bounded: 1,
      viewbox: getTbilisiViewbox(),
    }).catch(() => []);

    return (Array.isArray(results) ? results : [])
      .filter((result) => isTbilisiOsmResult(result))
      .map((result) => ({
        ...result,
        lat: Number(result?.lat ?? result?.latitude),
        lng: Number(result?.lng ?? result?.lon ?? result?.longitude),
        display_name: result?.display_name || "",
        address: result?.address || {},
      }))
      .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng));
  }
  if (method === "GET" && apiPath === "/api/geocode/reverse") return {};

  if (method === "POST" && apiPath === "/api/users") {
    const now = new Date().toISOString();
    const user = {
      id: `user-${Date.now()}`,
      username: body.username,
      password: body.password || "",
      role: body.role || "courier",
      status: "active",
      firstName: body.firstName || "",
      lastName: body.lastName || "",
      phone: body.phone || "",
      bankDetails: body.bankDetails || "",
      zoneId: body.zoneId || "",
      zoneName: body.zoneName || "",
      requestedAt: now,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    saveStaticBootstrap();
    return { user: publicStaticUser(user) };
  }

  if (method === "POST" && apiPath === "/api/partners") {
    const now = new Date().toISOString();
    const user = {
      id: `partner-${Date.now()}`,
      username: body.username || body.email || "",
      password: body.password || "",
      role: "partner",
      status: body.status === "inactive" ? "inactive" : "active",
      companyName: body.companyName || "",
      contactPerson: body.contactPerson || "",
      firstName: body.contactPerson || "",
      phone: body.phone || "",
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    saveStaticBootstrap();
    return { partner: publicStaticUser(user) };
  }

  const pendingMatch = apiPath.match(/^\/api\/pending\/([^/]+)$/);
  if (pendingMatch && method === "POST") {
    const username = decodeURIComponent(pendingMatch[1]);
    const pending = store.pending.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (pending) {
      store.pending = store.pending.filter((item) => normalizeUsername(item.username) !== normalizeUsername(username));
      store.users.push({ ...pending, role: "courier", status: "active", approvedAt: new Date().toISOString() });
      saveStaticBootstrap();
    }
    return { ok: true };
  }
  if (pendingMatch && method === "DELETE") {
    const username = decodeURIComponent(pendingMatch[1]);
    store.pending = store.pending.filter((item) => normalizeUsername(item.username) !== normalizeUsername(username));
    saveStaticBootstrap();
    return { ok: true };
  }

  const userMatch = apiPath.match(/^\/api\/users\/([^/]+)$/);
  const partnerMatch = apiPath.match(/^\/api\/partners\/([^/]+)$/);
  if (partnerMatch && method === "PUT") {
    const username = decodeURIComponent(partnerMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username) && item.role === "partner");
    if (user) {
      Object.assign(user, {
        companyName: body.companyName || user.companyName || "",
        contactPerson: body.contactPerson || user.contactPerson || "",
        firstName: body.contactPerson || user.contactPerson || "",
        phone: body.phone || user.phone || "",
        status: body.status === "inactive" ? "inactive" : "active",
        updatedAt: new Date().toISOString(),
      });
      if (body.password) user.password = body.password;
    }
    saveStaticBootstrap();
    return { partner: user ? publicStaticUser(user) : null };
  }

  if (userMatch && method === "PUT") {
    const username = decodeURIComponent(userMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (user) Object.assign(user, body, { updatedAt: new Date().toISOString() });
    saveStaticBootstrap();
    return { user: user ? publicStaticUser(user) : null };
  }
  if (userMatch && method === "DELETE") {
    const username = decodeURIComponent(userMatch[1]);
    store.users = store.users.filter((item) => normalizeUsername(item.username) !== normalizeUsername(username));
    saveStaticBootstrap();
    return { ok: true };
  }

  const zoneMatch = apiPath.match(/^\/api\/users\/([^/]+)\/zone$/);
  if (zoneMatch && method === "PUT") {
    const username = decodeURIComponent(zoneMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (user) Object.assign(user, { zoneId: body.zoneId || "", zoneName: body.zoneName || "" });
    saveStaticBootstrap();
    return { user: user ? publicStaticUser(user) : null };
  }

  const courierPasswordMatch = apiPath.match(/^\/api\/couriers\/([^/]+)\/password$/);
  if (courierPasswordMatch && method === "PUT") {
    const username = decodeURIComponent(courierPasswordMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (!user || user.role !== "courier") throw new Error("კურიერი ვერ მოიძებნა.");
    user.password = String(body.password || "");
    user.updatedAt = new Date().toISOString();
    saveStaticBootstrap();
    return { ok: true };
  }

  if (method === "POST" && apiPath === "/api/parcels") {
    const now = new Date().toISOString();
    const partner = state.isPartner
      ? store.users.find((user) => user.id === state.currentUserProfile?.id)
      : store.users.find((user) => user.role === "partner" && (user.id === body.partnerId || normalizeUsername(user.username) === normalizeUsername(body.partnerUsername)));
    const geocoded = state.isPartner && (!Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lng)))
      ? await geocodeStaticPartnerOrder(body)
      : null;
    const latValue = Number(body.lat ?? body.latitude ?? geocoded?.lat);
    const lngValue = Number(body.lng ?? body.longitude ?? geocoded?.lng);
    const hasCoords = Number.isFinite(latValue) && Number.isFinite(lngValue);
    const fullAddress = stripStaticPartnerAddressNoise(body.fullAddress || body.address || [body.city, body.district || body.area, body.streetAddress || body.street].filter(Boolean).join(", "));
    const parcel = {
      id: `parcel-${Date.now()}`,
      courierUsername: body.courierUsername || "",
      ...(hasCoords ? { lat: latValue, lng: lngValue, latitude: latValue, longitude: lngValue } : {}),
      address: state.isPartner ? fullAddress : body.address || fullAddress,
      fullAddress,
      fullName: body.fullName || "",
      phone: body.phone || "",
      city: stripStaticPartnerAddressNoise(body.city || ""),
      district: stripStaticPartnerAddressNoise(body.district || body.area || ""),
      streetAddress: extractStaticPartnerStreet(body),
      building: state.isPartner ? "" : extractStaticPartnerBuilding(body),
      floor: state.isPartner ? "" : body.floor || "",
      apartment: state.isPartner ? "" : body.apartment || "",
      comment: state.isPartner ? "" : body.comment || body.notes || "",
      partnerId: partner?.id || "",
      partnerName: partner?.companyName || partner?.contactPerson || partner?.username || "",
      partnerUsername: partner?.username || "",
      createdByRole: state.isPartner ? "partner" : "admin",
      locationAccuracy: hasCoords ? state.isPartner ? "approximate" : "confirmed" : "missing",
      locationSource: hasCoords ? state.isPartner ? "partner_address_geocoded" : "admin_created" : "missing",
      locationConfirmedByAdmin: hasCoords && !state.isPartner,
      locationUpdatedAt: hasCoords ? now : "",
      paymentAmount: Number(body.paymentAmount ?? body.payment ?? body.cashAmount ?? 0),
      cashAmount: Number(body.paymentAmount ?? body.payment ?? body.cashAmount ?? 0),
      codAmount: Number(body.paymentAmount ?? body.payment ?? body.cashAmount ?? 0),
      zoneId: body.zoneId || "",
      zoneName: body.zoneName || "",
      autoAssigned: Boolean(body.autoAssigned),
      status: "pending",
      createdAt: now,
      assignedAt: body.courierUsername ? now : "",
    };
    store.parcels.push(parcel);
    saveStaticBootstrap();
    return { parcel: publicStaticParcel(store, parcel) };
  }

  if (method === "PATCH" && apiPath === "/api/parcels/assign") {
    const parcelIds = Array.isArray(body.parcelIds) ? body.parcelIds : [];
    const missingLocation = store.parcels.find((parcel) => parcelIds.includes(parcel.id) && (!Number.isFinite(Number(parcel.lat)) || !Number.isFinite(Number(parcel.lng))));
    if (missingLocation) throw new Error("Set order pin location before assigning courier.");
    store.parcels.forEach((parcel) => {
      if (parcelIds.includes(parcel.id)) {
        parcel.courierUsername = body.courierUsername || "";
        parcel.assignedAt = new Date().toISOString();
        parcel.autoAssigned = false;
      }
    });
    saveStaticBootstrap();
    return { assigned: parcelIds.length };
  }

  const statusMatch = apiPath.match(/^\/api\/parcels\/([^/]+)\/status$/);
  if (statusMatch && method === "PATCH") {
    const parcel = store.parcels.find((item) => item.id === decodeURIComponent(statusMatch[1]));
    if (!parcel) return { ok: false };
    if (body.status === "failed" && !String(body.failureReason || "").trim()) throw new Error("Failure reason is required.");
    const now = new Date().toISOString();
    parcel.status = body.status || parcel.status;
    parcel.updatedAt = now;
    if (parcel.status === "delivered") {
      parcel.completedAt = body.completedAt || now;
      parcel.deliveredAt = body.deliveredAt || parcel.completedAt;
      parcel.failedAt = "";
      parcel.failureReason = "";
      Object.assign(parcel, normalizeStaticParcelFinance(parcel));
    }
    if (parcel.status === "failed") {
      parcel.completedAt = body.completedAt || now;
      parcel.failedAt = body.failedAt || parcel.completedAt;
      parcel.deliveredAt = "";
      parcel.failureReason = body.failureReason || "";
    }
    if (parcel.status === "pending") {
      parcel.completedAt = "";
      parcel.deliveredAt = "";
      parcel.failedAt = "";
      parcel.failureReason = "";
    }
    saveStaticBootstrap();
    return { parcel: publicStaticParcel(store, parcel) };
  }

  if (method === "POST" && apiPath === "/api/parcels/archive") {
    const parcelIds = Array.isArray(body.parcelIds) ? new Set(body.parcelIds) : null;
    const courier = body.courierUsername || "";
    const now = new Date().toISOString();
    let archived = 0;
    store.parcels.forEach((parcel) => {
      if (
        !parcel.archivedAt
        && parcel.status === "delivered"
        && (!parcelIds || parcelIds.has(parcel.id))
        && (!courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier))
      ) {
        parcel.archivedAt = now;
        if (body.autoClosedDate) {
          parcel.autoClosedAt = now;
          parcel.autoClosedDate = body.autoClosedDate;
        }
        parcel.updatedAt = now;
        parcel.completedAt = parcel.completedAt || parcel.deliveredAt || now;
        parcel.deliveredAt = parcel.deliveredAt || parcel.completedAt;
        Object.assign(parcel, normalizeStaticParcelFinance(parcel));
        archived += 1;
      }
    });
    if (body.autoClosedDate) {
      store.settings.lastAutoCloseDate = body.autoClosedDate;
      store.settings.lastAutoCloseAt = now;
    }
    saveStaticBootstrap();
    return { archived };
  }

  const locationMatch = apiPath.match(/^\/api\/parcels\/([^/]+)\/location$/);
  if (locationMatch && method === "PATCH") {
    const parcel = store.parcels.find((item) => item.id === decodeURIComponent(locationMatch[1]));
    if (!parcel) return { ok: false };
    const lat = Number(body.lat ?? body.latitude);
    const lng = Number(body.lng ?? body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Valid latitude and longitude are required.");
    const now = new Date().toISOString();
    Object.assign(parcel, {
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      locationAccuracy: body.locationAccuracy === "approximate" ? "approximate" : "confirmed",
      locationSource: body.locationSource || "admin_manual_adjustment",
      locationConfirmedByAdmin: body.locationAccuracy !== "approximate",
      locationUpdatedAt: now,
      updatedAt: now,
    });
    saveStaticBootstrap();
    return { parcel: publicStaticParcel(store, parcel) };
  }

  if (method === "POST" && apiPath === "/api/maintenance/retention") {
    if (!state.isAdmin) throw new Error("მხოლოდ ადმინს შეუძლია ძველი მონაცემების გასუფთავება.");
    const cutoffDate = normalizeDateKey(body.cutoffDate);
    if (!cutoffDate) throw new Error("გასუფთავების თარიღი არასწორია.");
    const result = runStaticRetentionCleanup(store, cutoffDate);
    const now = new Date().toISOString();
    store.settings.lastRetentionCleanupDate = toDateKey(new Date());
    store.settings.lastRetentionCleanupAt = now;
    store.settings.retentionCutoffDate = cutoffDate;
    store.settings.retentionMonths = Number(body.retentionMonths || CONFIG.dataRetentionMonths || 8);
    saveStaticBootstrap();
    return {
      ...result,
      cutoffDate,
      retentionMonths: store.settings.retentionMonths,
    };
  }

  console.warn("Static API fallback returned empty response for", method, apiPath);
  return {};
}

async function api(path, options = {}) {
  if (isStaticDeploy() && path.startsWith("/api/")) return staticApi(path, options);

  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || STRINGS.serverFailed);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function getCouriers() {
  return applyLocalZoneAssignments((await api("/api/couriers")).couriers);
}

async function getUsers() {
  return applyLocalZoneAssignments((await api("/api/users")).users);
}

async function getPartners() {
  const payload = await api("/api/partners");
  return Array.isArray(payload.partners) ? payload.partners : [];
}

async function getPending() {
  return (await api("/api/pending")).pending;
}

async function getPins(username) {
  const query = username ? `?courier=${encodeURIComponent(username)}` : "";
  return (await api(`/api/parcels${query}`)).parcels;
}

async function getHistory(username) {
  const query = username ? `?courier=${encodeURIComponent(username)}` : "";
  return (await api(`/api/history${query}`)).history;
}

async function searchParcels(query) {
  return (await api(`/api/parcels/search?q=${encodeURIComponent(query || "")}`)).parcels;
}

async function getZones() {
  if (!CONFIG.useZonesApi) return normalizeZones([]);

  try {
    const zones = (await api("/api/zones")).zones;
    return normalizeZones(zones);
  } catch {
    return normalizeZones([]);
  }
}
