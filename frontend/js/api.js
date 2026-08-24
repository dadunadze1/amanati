"use strict";

const STATIC_DEPLOY_STORAGE_KEY = "deliveryStaticBootstrap:v2";
const STATIC_LEGACY_DEPLOY_STORAGE_KEYS = ["deliveryStaticBootstrap:v1"];
const STATIC_SESSION_STORAGE_KEY = "deliveryStaticSession:v1";
const STATIC_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STATIC_DEMO_COURIER_USERNAMES = new Set(["courier1", "courier2"]);
const STATIC_DEMO_COURIER_IDS = new Set(["static-courier-1", "static-courier-2"]);
const STATIC_DEMO_COURIER_PHONES = new Set(["+995555000001", "+995555000002"]);
const STATIC_PUSH_EVENT_RETENTION_DAYS = 14;
const STATIC_AUTO_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATIC_BOOTSTRAP_SAVE_DEBOUNCE_MS = 450;
let staticRealtimeRefreshTimer = null;
let staticBootstrapSaveTimer = null;
let staticBootstrapSavePending = false;

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
  clearLegacyStaticBootstrapStores();

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
  archiveStaticCompletedParcels(loadStaticBootstrap.cache);
  runStaticAutomaticCleanup(loadStaticBootstrap.cache);
  await backfillStaticPartnerOrderLocations(loadStaticBootstrap.cache);
  hydrateStaticFinanceStorage(loadStaticBootstrap.cache.financeData);
  saveStaticBootstrap({ immediate: true });
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
    const adminNotifications = mergeStaticAdminNotifications(merged.adminNotifications, store.adminNotifications);

    return {
      users: mergeStaticRecordsByKey(merged.users, users, getStaticUserKey, resolveStaticUserRecord),
      couriers: [],
      pending: mergeStaticRecordsByKey(merged.pending, pending, getStaticUserKey, resolveStaticUserRecord),
      parcels: mergeStaticRecordsByKey(merged.parcels, parcels, getStaticParcelKey, resolveStaticParcelRecord),
      history: mergeStaticRecordsByKey(merged.history, history, getStaticParcelKey, resolveStaticParcelRecord),
      zones: mergeStaticRecordsByKey(merged.zones, Array.isArray(store.zones) ? store.zones : [], getStaticZoneKey),
      financeData: mergeStaticFinanceData(merged.financeData, store.financeData),
      adminNotifications,
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
    adminNotifications: {},
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
    adminNotifications: merged.adminNotifications || {},
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
  return {
    ...user,
    role,
    status,
    password: user.password,
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
  if (current?.archivedAt || next?.archivedAt) {
    const archived = current?.archivedAt ? current : next;
    const active = archived === current ? next : current;
    const merged = { ...active, ...archived };
    ["deletedAt", "archivedAt", "deliveredAt", "completedAt", "failedAt", "updatedAt", "assignedAt", "createdAt"].forEach((field) => {
      merged[field] = archived[field] || active[field] || "";
    });
    if (archived.status === "delivered" || active.status === "delivered") merged.status = "delivered";
    return normalizeStaticParcelFinance(merged);
  }
  const currentTime = getStaticRecordTimestamp(current);
  const nextTime = getStaticRecordTimestamp(next);
  const primary = nextTime >= currentTime ? next : current;
  const secondary = primary === next ? current : next;
  const merged = { ...secondary, ...primary };
  ["deletedAt", "archivedAt", "deliveredAt", "completedAt", "failedAt", "updatedAt", "assignedAt", "createdAt"].forEach((field) => {
    merged[field] = primary[field] || secondary[field] || "";
  });
  if ((primary.archivedAt || secondary.archivedAt) && (primary.status === "delivered" || secondary.status === "delivered")) {
    merged.status = "delivered";
  }
  return normalizeStaticParcelFinance(merged);
}

function getStaticRecordTimestamp(record, fields = ["updatedAt", "deletedAt", "archivedAt", "deliveredAt", "completedAt", "failedAt", "assignedAt", "createdAt"]) {
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
    partnerCashAdjustments: mergeStaticRecordsByKey(base.partnerCashAdjustments, next.partnerCashAdjustments, getStaticAdjustmentKey),
    payAdjustments: mergeStaticRecordsByKey(base.payAdjustments, next.payAdjustments, getStaticAdjustmentKey),
    dailyBalanceLedger: mergeStaticRecordsByKey(base.dailyBalanceLedger, next.dailyBalanceLedger, getStaticAdjustmentKey),
  };
}

function mergeStaticAdminNotifications(baseNotifications, nextNotifications) {
  const merged = { ...(baseNotifications && typeof baseNotifications === "object" ? baseNotifications : {}) };
  const next = nextNotifications && typeof nextNotifications === "object" ? nextNotifications : {};
  Object.entries(next).forEach(([key, notification]) => {
    if (!notification || typeof notification !== "object") return;
    const current = merged[key];
    merged[key] = current ? resolveStaticAdminNotificationRecord(current, notification) : notification;
  });
  return merged;
}

function resolveStaticAdminNotificationRecord(current, next) {
  const currentStatusRank = getStaticNotificationStatusRank(current?.deliveryStatus);
  const nextStatusRank = getStaticNotificationStatusRank(next?.deliveryStatus);
  if (currentStatusRank !== nextStatusRank) {
    return currentStatusRank > nextStatusRank ? { ...next, ...current } : { ...current, ...next };
  }
  const currentTime = getStaticRecordTimestamp(current, ["sentAt", "updatedAt", "lastAttemptAt", "createdAt"]);
  const nextTime = getStaticRecordTimestamp(next, ["sentAt", "updatedAt", "lastAttemptAt", "createdAt"]);
  const primary = nextTime >= currentTime ? next : current;
  const secondary = primary === next ? current : next;
  return {
    ...secondary,
    ...primary,
    attempts: Math.max(Number(current?.attempts || 0), Number(next?.attempts || 0)),
  };
}

function getStaticNotificationStatusRank(status) {
  const value = String(status || "pending");
  if (value === "sent") return 4;
  if (value === "processing") return 3;
  if (value === "failed") return 2;
  return 1;
}

function clearLegacyStaticBootstrapStores() {
  STATIC_LEGACY_DEPLOY_STORAGE_KEYS.forEach((key) => {
    if (key !== STATIC_DEPLOY_STORAGE_KEY) clearData(key);
  });
}

function normalizeStaticParcelFinance(parcel, store = loadStaticBootstrap.cache) {
  if (!parcel || typeof parcel !== "object") return parcel;
  const paymentAmount = getStaticParcelPaymentAmount(parcel);
  const isDelivered = parcel.status === "delivered";
  const finance = getStaticParcelFinanceSnapshot(parcel, store);
  return {
    ...parcel,
    paymentAmount,
    cashAmount: paymentAmount,
    tariffId: finance.tariffId,
    tariffLabel: finance.tariffLabel,
    deliveryTotalPrice: isDelivered ? finance.deliveryTotalPrice : getStaticOptionalMoney(parcel.deliveryTotalPrice),
    courierPay: isDelivered ? finance.courierPay : getStaticOptionalMoney(parcel.courierPay),
    adminProfit: isDelivered ? finance.adminProfit : getStaticOptionalMoney(parcel.adminProfit),
  };
}

function getStaticDefaultTariffs() {
  const defaults = CONFIG.defaultTariffs || {};
  return {
    city: normalizeStaticTariffItem(defaults.city, { id: "city", label: "თბილისი", partnerPrice: 6, courierPay: 3.5 }),
    suburbs: normalizeStaticTariffItem(defaults.suburbs, { id: "suburbs", label: "შემოგარენი", partnerPrice: 8, courierPay: 5.5 }),
    volume_u5: normalizeStaticTariffItem(defaults.volume_u5, { id: "volume_u5", label: "5 კგ-მდე", partnerPrice: 8, courierPay: 3.5 }),
    volume_5_10: normalizeStaticTariffItem(defaults.volume_5_10, { id: "volume_5_10", label: "5-10 კგ", partnerPrice: 10, courierPay: 3.5 }),
    volume_10_15: normalizeStaticTariffItem(defaults.volume_10_15, { id: "volume_10_15", label: "10-15 კგ", partnerPrice: 12, courierPay: 3.5 }),
    express: normalizeStaticTariffItem(defaults.express, { id: "express", label: "ექსპრეს დელივერი", partnerPrice: 10, courierPay: 3.5 }),
  };
}

function normalizeStaticTariffItem(input = {}, fallback) {
  input = input && typeof input === "object" ? input : {};
  const partnerPrice = getStaticMoney(input.partnerPrice ?? input.deliveryTotalPrice ?? fallback.partnerPrice);
  const courierPay = getStaticMoney(input.courierPay ?? input.courierDeliveryPay ?? fallback.courierPay);
  return {
    id: fallback.id,
    label: fallback.label,
    partnerPrice,
    courierPay,
    companyProfit: getStaticMoney(Math.max(0, partnerPrice - courierPay)),
  };
}

function normalizeStaticTariffSettings(settings = {}) {
  const values = settings.tariffs && typeof settings.tariffs === "object" ? settings.tariffs : settings;
  const defaults = getStaticDefaultTariffs();
  return Object.keys(defaults).reduce((normalized, id) => {
    normalized[id] = normalizeStaticTariffItem(values[id], defaults[id]);
    return normalized;
  }, {});
}

function getStaticTariffSettings(store = loadStaticBootstrap.cache) {
  return normalizeStaticTariffSettings(store?.settings?.tariffs);
}

function getStaticParcelTariffId(parcel = {}) {
  const explicit = String(parcel.tariffId || parcel.tariffType || parcel.deliveryTariffId || "").trim();
  if (Object.prototype.hasOwnProperty.call(getStaticDefaultTariffs(), explicit)) return explicit;
  return parcel.zoneId ? "city" : "suburbs";
}

function cleanStaticParcelTariffId(value) {
  const tariffId = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(getStaticDefaultTariffs(), tariffId) ? tariffId : "";
}

function assertStaticParcelTariffAllowed(tariffId) {
  if (tariffId === "express" && typeof isExpressDeliveryAvailable === "function" && !isExpressDeliveryAvailable()) {
    throw new Error("ექსპრეს დელივერი ხელმისაწვდომია 14:00-ის შემდეგ.");
  }
}

function getStaticParcelFinanceSnapshot(parcel = {}, store = loadStaticBootstrap.cache) {
  const tariffs = getStaticTariffSettings(store);
  const tariffId = getStaticParcelTariffId(parcel);
  const tariff = tariffs[tariffId] || tariffs.city;
  const hasFinanceSnapshot = hasStaticMoneyValue(parcel.deliveryTotalPrice)
    && (
      getStaticMoney(parcel.deliveryTotalPrice) > 0
      || getStaticMoney(parcel.courierPay) > 0
      || getStaticMoney(parcel.adminProfit) > 0
    );
  const deliveryTotalPrice = hasFinanceSnapshot ? getStaticMoney(parcel.deliveryTotalPrice) : tariff.partnerPrice;
  const courierPay = hasFinanceSnapshot ? getStaticMoney(parcel.courierPay) : tariff.courierPay;
  const adminProfit = hasFinanceSnapshot && hasStaticMoneyValue(parcel.adminProfit) ? getStaticMoney(parcel.adminProfit) : getStaticMoney(Math.max(0, deliveryTotalPrice - courierPay));
  return {
    tariffId,
    tariffLabel: tariff.label,
    deliveryTotalPrice,
    courierPay,
    adminProfit,
  };
}

function getStaticParcelPaymentAmount(parcel) {
  const value = parcel?.paymentAmount ?? parcel?.cashAmount ?? parcel?.payment ?? parcel?.amount ?? parcel?.price ?? parcel?.codAmount ?? 0;
  const amount = getStaticMoney(value);
  return amount > 0 ? amount : 0;
}

function hasStaticMoneyValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function getStaticOptionalMoney(value) {
  return hasStaticMoneyValue(value) ? getStaticMoney(value) : 0;
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

function persistStaticBootstrapNow() {
  if (!loadStaticBootstrap.cache) return;
  saveData(STATIC_DEPLOY_STORAGE_KEY, loadStaticBootstrap.cache);
  if (typeof saveFirebaseStaticStore === "function") {
    saveFirebaseStaticStore(loadStaticBootstrap.cache).catch((error) => {
      console.warn("Firebase static store save failed", error);
    });
  }
}

function flushStaticBootstrapSave() {
  if (staticBootstrapSaveTimer) {
    window.clearTimeout(staticBootstrapSaveTimer);
    staticBootstrapSaveTimer = null;
  }
  if (!loadStaticBootstrap.cache || !staticBootstrapSavePending) return;
  staticBootstrapSavePending = false;
  persistStaticBootstrapNow();
}

function saveStaticBootstrap(options = {}) {
  if (!loadStaticBootstrap.cache) return;
  if (options.immediate || typeof window === "undefined") {
    staticBootstrapSavePending = false;
    if (staticBootstrapSaveTimer) {
      window.clearTimeout(staticBootstrapSaveTimer);
      staticBootstrapSaveTimer = null;
    }
    persistStaticBootstrapNow();
    return;
  }

  staticBootstrapSavePending = true;
  if (staticBootstrapSaveTimer) return;
  staticBootstrapSaveTimer = window.setTimeout(flushStaticBootstrapSave, STATIC_BOOTSTRAP_SAVE_DEBOUNCE_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushStaticBootstrapSave);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushStaticBootstrapSave();
  });
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
  refreshStaticCurrentUserProfile(normalizedStore);
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

function refreshStaticCurrentUserProfile(store = loadStaticBootstrap.cache) {
  if (!state.currentUser || !store || !Array.isArray(store.users)) return null;
  const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(state.currentUser));
  if (!user) return null;
  const profile = publicStaticUser(user);
  state.currentUserProfile = {
    ...(state.currentUserProfile && typeof state.currentUserProfile === "object" ? state.currentUserProfile : {}),
    ...profile,
  };
  state.isAdmin = profile.role === "admin";
  state.isPartner = profile.role === "partner";
  return state.currentUserProfile;
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
  if (loadData(CONFIG.dailyBalanceLedgerStorageKey) === null && Array.isArray(financeData.dailyBalanceLedger)) {
    saveData(CONFIG.dailyBalanceLedgerStorageKey, financeData.dailyBalanceLedger);
  }
}

function queueStaticPushNotification(store, notification) {
  if (!store || !notification) return;
  const key = getStaticPushNotificationKey(notification.eventKey || `${notification.parcelId || "parcel"}-${notification.status || Date.now()}`);
  const existing = store.adminNotifications && typeof store.adminNotifications === "object" ? store.adminNotifications[key] : null;
  if (existing?.deliveryStatus === "sent" || existing?.deliveryStatus === "processing") return;
  const now = new Date().toISOString();
  store.adminNotifications = {
    ...(store.adminNotifications && typeof store.adminNotifications === "object" ? store.adminNotifications : {}),
    [key]: {
      ...(existing && typeof existing === "object" ? existing : {}),
      ...notification,
      id: key,
      deliveryStatus: existing?.deliveryStatus || "pending",
      attempts: Number(existing?.attempts || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      nextAttemptAt: existing?.nextAttemptAt || now,
    },
  };
}

function getStaticPushNotificationKey(value) {
  try {
    return btoa(unescape(encodeURIComponent(String(value || ""))))
      .replace(/[+/=]/g, "_")
      .slice(0, 180) || `push_${Date.now()}`;
  } catch {
    return String(value || `push_${Date.now()}`).replace(/[.[\]*`/]/g, "_").slice(0, 180);
  }
}

function getStaticParcelPushAddress(parcel) {
  return String(
    parcel?.address
    || parcel?.fullAddress
    || [parcel?.city, parcel?.district, parcel?.streetAddress, parcel?.building].filter(Boolean).join(", ")
    || ""
  ).trim();
}

function getStaticParcelPushDetails(parcel) {
  const address = getStaticParcelPushAddress(parcel);
  const fullName = String(parcel?.fullName || parcel?.customerName || parcel?.name || "").trim();
  return {
    address,
    fullName,
    details: [address, fullName].filter(Boolean).join(", "),
  };
}

function buildStaticParcelCreatedNotification(parcel) {
  const { address, fullName, details } = getStaticParcelPushDetails(parcel);
  const courierUsername = String(parcel?.courierUsername || "").trim();
  const partnerName = String(parcel?.partnerName || parcel?.partnerUsername || "პარტნიორი").trim();
  return {
    type: "parcel_created",
    status: "created",
    recipientRoles: courierUsername ? ["admin", "courier"] : ["admin"],
    title: "პარტნიორმა ახალი ამანათი დაამატა",
    body: `${partnerName || "პარტნიორი"} - ${details || "ახალი ამანათი დაემატა"}`,
    parcelId: String(parcel?.id || ""),
    address,
    fullName,
    failureReason: "",
    partnerId: String(parcel?.partnerId || parcel?.partnerUsername || ""),
    partnerUsername: String(parcel?.partnerUsername || ""),
    partnerName,
    courierUsername,
    eventKey: `${parcel?.id || "parcel"}-created-${courierUsername || "admin"}-${parcel?.createdAt || "now"}`,
  };
}

function buildStaticParcelAssignedNotification(parcel, courierUsername) {
  const { address, fullName, details } = getStaticParcelPushDetails(parcel);
  return {
    type: "parcel_assigned",
    status: "assigned",
    recipientRoles: ["courier"],
    title: "ახალი ამანათი გაქვთ",
    body: details || "ახალი ამანათი გაქვთ",
    parcelId: String(parcel?.id || ""),
    address,
    fullName,
    failureReason: "",
    partnerId: String(parcel?.partnerId || parcel?.partnerUsername || ""),
    partnerUsername: String(parcel?.partnerUsername || ""),
    partnerName: String(parcel?.partnerName || ""),
    courierUsername: String(courierUsername || parcel?.courierUsername || ""),
    eventKey: `${parcel?.id || "parcel"}-assigned-${courierUsername || parcel?.courierUsername || "courier"}`,
  };
}

function buildStaticParcelStatusNotification(parcel, status, options = {}) {
  const { address, fullName, details } = getStaticParcelPushDetails(parcel);
  const failureReason = String(options.failureReason || parcel?.failureReason || "").trim();
  const isFailed = status === "failed";
  const body = isFailed && failureReason ? `${details || "შეკვეთის სტატუსი შეიცვალა"}\nმიზეზი: ${failureReason}` : (details || "შეკვეთის სტატუსი შეიცვალა");
  const statusTime = options.completedAt || options.deliveredAt || options.failedAt || parcel?.completedAt || parcel?.deliveredAt || parcel?.failedAt || "";
  return {
    type: isFailed ? "parcel_failed" : "parcel_delivered",
    status,
    recipientRoles: parcel?.partnerId || parcel?.partnerUsername ? ["admin", "partner"] : ["admin"],
    title: isFailed ? "შეკვეთა ვერ ჩაბარდა" : "შეკვეთა ჩაბარდა",
    body,
    parcelId: String(parcel?.id || ""),
    address,
    fullName,
    failureReason,
    partnerId: String(parcel?.partnerId || parcel?.partnerUsername || ""),
    partnerUsername: String(parcel?.partnerUsername || ""),
    partnerName: String(parcel?.partnerName || ""),
    courierUsername: String(parcel?.courierUsername || ""),
    eventKey: `${parcel?.id || "parcel"}-${status}-${statusTime || "now"}`,
  };
}

function getStaticFinanceData() {
  return loadStaticBootstrap.cache?.financeData || {};
}

function saveStaticFinanceData(financeData) {
  if (!loadStaticBootstrap.cache) return;
  loadStaticBootstrap.cache.financeData = financeData && typeof financeData === "object" ? financeData : {};
  saveStaticBootstrap();
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return toDateKey(date);
}

function getStaticRetentionParcelDateKey(parcel) {
  return normalizeDateKey(parcel?.archivedAt || parcel?.completedAt || parcel?.deliveredAt || parcel?.failedAt || parcel?.updatedAt || parcel?.createdAt);
}

function getStaticParcelSearchDateKeys(parcel) {
  return [parcel?.createdAt, parcel?.assignedAt, parcel?.completedAt, parcel?.deliveredAt, parcel?.failedAt, parcel?.updatedAt, parcel?.archivedAt]
    .map(normalizeDateKey)
    .filter(Boolean);
}

function staticParcelMatchesDateSearchFilter(parcel, dateFrom, dateTo) {
  const start = normalizeDateKey(dateFrom);
  const end = normalizeDateKey(dateTo);
  if (!start && !end) return true;
  const rangeStart = start && end ? (start <= end ? start : end) : (start || end);
  const rangeEnd = start && end ? (start <= end ? end : start) : (end || start);
  return getStaticParcelSearchDateKeys(parcel).some((dateKey) => dateKey >= rangeStart && dateKey <= rangeEnd);
}

function staticParcelMatchesSearchFilters(parcel, filters = {}) {
  if (filters.status && parcel?.status !== filters.status) return false;
  if (filters.courier && normalizeUsername(parcel?.courierUsername) !== normalizeUsername(filters.courier)) return false;
  return staticParcelMatchesDateSearchFilter(parcel, filters.dateFrom, filters.dateTo);
}

function getStaticParcelSearchFilters(url) {
  return {
    status: String(url.searchParams.get("status") || "").trim(),
    courier: String(url.searchParams.get("courier") || "").trim(),
    dateFrom: String(url.searchParams.get("dateFrom") || "").trim(),
    dateTo: String(url.searchParams.get("dateTo") || "").trim(),
  };
}

function getStaticPaginationOptions(url) {
  const rawLimit = Number(url.searchParams.get("limit") || 0);
  const rawOffset = Number(url.searchParams.get("offset") || 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 0), 500) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  return { limit, offset };
}

function isStaticDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function addStaticDaysToDateKey(dateKey, days) {
  if (!isStaticDateKey(dateKey)) return "";
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return toDateKey(date);
}

function ensureStaticWorkdayState(store, now = new Date()) {
  store.settings = store.settings && typeof store.settings === "object" ? store.settings : {};
  const calendarDateKey = toDateKey(now);
  if (!isStaticDateKey(store.settings.currentWorkdayKey)) {
    store.settings.currentWorkdayKey = calendarDateKey;
    store.settings.currentWorkdayStartedAt = now.toISOString();
  }
  return {
    currentWorkdayKey: store.settings.currentWorkdayKey,
    calendarDateKey,
    lastClosedWorkdayKey: isStaticDateKey(store.settings.lastClosedWorkdayKey) ? store.settings.lastClosedWorkdayKey : "",
    lastWorkdayClosedAt: store.settings.lastWorkdayClosedAt || "",
    currentWorkdayStartedAt: store.settings.currentWorkdayStartedAt || "",
    isStale: isStaticDateKey(store.settings.currentWorkdayKey) && store.settings.currentWorkdayKey < calendarDateKey,
  };
}

function closeStaticCurrentWorkday(store, workdayKey, now = new Date()) {
  const state = ensureStaticWorkdayState(store, now);
  const closedKey = isStaticDateKey(workdayKey) ? workdayKey : state.currentWorkdayKey;
  const nextWorkdayKey = addStaticDaysToDateKey(closedKey, 1) || state.calendarDateKey;
  store.settings.lastClosedWorkdayKey = closedKey;
  store.settings.lastWorkdayClosedAt = now.toISOString();
  if (!isStaticDateKey(store.settings.currentWorkdayKey) || store.settings.currentWorkdayKey <= closedKey) {
    store.settings.currentWorkdayKey = nextWorkdayKey;
    store.settings.currentWorkdayStartedAt = now.toISOString();
  }
  return ensureStaticWorkdayState(store, now);
}

function getStaticCurrentWorkdayKey(store, now = new Date()) {
  return ensureStaticWorkdayState(store, now).currentWorkdayKey;
}

function getStaticParcelWorkdayDateKey(parcel) {
  if (!parcel || typeof parcel !== "object") return "";
  const statusDates = parcel.status === "delivered"
    ? [parcel.financeDateKey, parcel.completedWorkdayKey, parcel.workdayKey, parcel.deliveredAt, parcel.completedAt, parcel.archivedAt, parcel.updatedAt]
    : parcel.status === "failed"
      ? [parcel.completedWorkdayKey, parcel.workdayKey, parcel.failedAt, parcel.completedAt, parcel.archivedAt, parcel.updatedAt]
      : [parcel.workdayKey, parcel.assignedAt, parcel.createdAt, parcel.updatedAt];
  return statusDates.concat([parcel.createdAt]).map(normalizeDateKey).find(Boolean) || "";
}

function staticPaginatedPayload(key, records, pagination) {
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

function shouldArchiveStaticParcelToHistory(parcel) {
  return Boolean(parcel?.archivedAt && !isStaticDeletedParcel(parcel) && ["delivered", "failed"].includes(parcel.status));
}

function archiveStaticCompletedParcels(store) {
  if (!store || !Array.isArray(store.parcels)) return 0;
  const beforeHistory = Array.isArray(store.history) ? store.history : [];
  const nextHistory = [...beforeHistory];
  const nextParcels = [];
  let moved = 0;

  store.parcels.forEach((parcel) => {
    if (!shouldArchiveStaticParcelToHistory(parcel)) {
      nextParcels.push(parcel);
      return;
    }
    nextHistory.push(parcel);
    moved += 1;
  });

  store.history = mergeStaticRecordsByKey([], nextHistory, getStaticParcelKey, resolveStaticParcelRecord);
  const archivedKeys = new Set(store.history.map(getStaticParcelKey).filter(Boolean));
  const filteredParcels = nextParcels.filter((parcel) => !archivedKeys.has(getStaticParcelKey(parcel)));
  const removedDuplicates = nextParcels.length - filteredParcels.length;
  if (!moved && !removedDuplicates) return 0;
  store.parcels = filteredParcels;
  return moved + removedDuplicates;
}

function pruneStaticPushEvents(store, referenceDate = new Date()) {
  if (!store || typeof store !== "object") return 0;
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - STATIC_PUSH_EVENT_RETENTION_DAYS);
  const cutoffMs = cutoff.getTime();
  const notifications = store.adminNotifications && typeof store.adminNotifications === "object" ? store.adminNotifications : {};
  const sent = store.sentAdminNotificationIds && typeof store.sentAdminNotificationIds === "object" ? store.sentAdminNotificationIds : {};
  let deleted = 0;

  Object.entries(notifications).forEach(([id, item]) => {
    const status = String(item?.deliveryStatus || "");
    const dateMs = Date.parse(item?.sentAt || item?.createdAt || item?.updatedAt || "");
    if (status === "sent" && Number.isFinite(dateMs) && dateMs < cutoffMs) {
      delete notifications[id];
      delete sent[id];
      deleted += 1;
    }
  });

  store.adminNotifications = notifications;
  store.sentAdminNotificationIds = sent;
  return deleted;
}

function runStaticRetentionCleanup(store, cutoffDate, partnerOrderCutoffDate = cutoffDate) {
  archiveStaticCompletedParcels(store);
  const beforeHistory = store.history.length;
  const beforeParcels = store.parcels.length;
  const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
  const beforeCashAdjustments = Array.isArray(financeData.cashAdjustments) ? financeData.cashAdjustments.length : 0;
  const beforePartnerCashAdjustments = Array.isArray(financeData.partnerCashAdjustments) ? financeData.partnerCashAdjustments.length : 0;
  const beforePayAdjustments = Array.isArray(financeData.payAdjustments) ? financeData.payAdjustments.length : 0;
  const beforeDailyBalanceLedger = Array.isArray(financeData.dailyBalanceLedger) ? financeData.dailyBalanceLedger.length : 0;

  store.history = store.history.filter((parcel) => !isStaticRetentionParcelExpired(parcel, isStaticPartnerParcel(parcel) ? partnerOrderCutoffDate : cutoffDate));
  store.parcels = store.parcels.filter((parcel) => {
    if (!parcel.archivedAt) return true;
    return !isStaticRetentionParcelExpired(parcel, isStaticPartnerParcel(parcel) ? partnerOrderCutoffDate : cutoffDate);
  });
  pruneStaticPushEvents(store);

  const cashAdjustments = filterStaticRetentionAdjustments(financeData.cashAdjustments, cutoffDate);
  const partnerCashAdjustments = filterStaticRetentionAdjustments(financeData.partnerCashAdjustments, partnerOrderCutoffDate);
  const payAdjustments = filterStaticRetentionAdjustments(financeData.payAdjustments, cutoffDate);
  const dailyBalanceLedger = filterStaticRetentionAdjustments(financeData.dailyBalanceLedger, cutoffDate);
  store.financeData = {
    ...financeData,
    cashAdjustments,
    partnerCashAdjustments,
    payAdjustments,
    dailyBalanceLedger,
  };
  saveData(CONFIG.cashAdjustmentsStorageKey, normalizeFinanceAdjustmentList(cashAdjustments, "cash"));
  saveData(CONFIG.partnerCashAdjustmentsStorageKey, normalizeFinanceAdjustmentList(partnerCashAdjustments, "partnerCash"));
  saveData(CONFIG.payAdjustmentsStorageKey, normalizeFinanceAdjustmentList(payAdjustments, "pay"));
  saveData(CONFIG.dailyBalanceLedgerStorageKey, dailyBalanceLedger);

  return {
    deletedParcels: (beforeHistory - store.history.length) + (beforeParcels - store.parcels.length),
    deletedCashAdjustments: beforeCashAdjustments - cashAdjustments.length,
    deletedPartnerCashAdjustments: beforePartnerCashAdjustments - partnerCashAdjustments.length,
    deletedPayAdjustments: beforePayAdjustments - payAdjustments.length,
    deletedDailyBalanceLedger: beforeDailyBalanceLedger - dailyBalanceLedger.length,
  };
}

function runStaticAutomaticCleanup(store) {
  if (!store?.settings) return null;
  const now = new Date();
  const lastRun = Date.parse(store.settings.lastAutomaticCleanupAt || "");
  if (Number.isFinite(lastRun) && now.getTime() - lastRun < STATIC_AUTO_RETENTION_INTERVAL_MS) return null;

  const cutoffDate = addDaysToDateKey(getTodayKey(), -30 * Number(CONFIG.dataRetentionMonths || 8));
  const partnerOrderCutoffDate = addDaysToDateKey(getTodayKey(), -30 * Number(CONFIG.partnerOrderRetentionMonths || 1));
  const result = runStaticRetentionCleanup(store, cutoffDate, partnerOrderCutoffDate || cutoffDate);
  store.settings.lastAutomaticCleanupAt = now.toISOString();
  store.settings.lastAutomaticCleanupDate = toDateKey(now);
  return result;
}

function assertStaticParcelVersion(parcel, expectedUpdatedAt) {
  const expected = String(expectedUpdatedAt || "").trim();
  if (!expected || !parcel?.updatedAt) return;
  if (String(parcel.updatedAt || "") !== expected) {
    const error = new Error("შეკვეთა უკვე შეიცვალა სხვა მომხმარებლის მიერ. განაახლეთ გვერდი და თავიდან სცადეთ.");
    error.status = 409;
    error.code = "parcel_conflict";
    throw error;
  }
}

function publicStaticUser(user) {
  const zoneIds = getStaticUserZoneIds(user);
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
    pickupAddress: user.pickupAddress || "",
    pickupLat: user.pickupLat ?? "",
    pickupLng: user.pickupLng ?? "",
    pickupLatitude: user.pickupLatitude ?? user.pickupLat ?? "",
    pickupLongitude: user.pickupLongitude ?? user.pickupLng ?? "",
    pickupZoneId: user.pickupZoneId || "",
    pickupZoneName: user.pickupZoneName || getStaticZoneNames([user.pickupZoneId]) || "",
    pickupLocationSource: user.pickupLocationSource || "",
    pickupLocationUpdatedAt: user.pickupLocationUpdatedAt || "",
    lastPickupAcknowledgedAt: user.lastPickupAcknowledgedAt || "",
    lastPickupAcknowledgedBy: user.lastPickupAcknowledgedBy || "",
    lastPickupAcknowledgedByRole: user.lastPickupAcknowledgedByRole || "",
    zoneIds,
    zoneId: zoneIds[0] || "",
    zoneName: getStaticZoneNames(zoneIds) || user.zoneName || "",
    createdAt: user.createdAt || "",
    requestedAt: user.requestedAt || "",
    approvedAt: user.approvedAt || "",
  };
}

function parseOptionalStaticPickupCoordinate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}


function getStaticPartnerPickupCoords(partner) {
  const lat = parseOptionalStaticPickupCoordinate(partner?.pickupLat ?? partner?.pickupLatitude);
  const lng = parseOptionalStaticPickupCoordinate(partner?.pickupLng ?? partner?.pickupLongitude);
  if (lat === null || lng === null) return null;
  const coords = { lat, lng };
  return isStaticTbilisiCoords(coords) ? coords : null;
}

function getStaticPartnerPickupZoneId(partner) {
  const storedZoneId = String(partner?.pickupZoneId || "").trim();
  if ((DEFAULT_ZONES || []).some((zone) => String(zone.id || "") === storedZoneId)) return storedZoneId;
  const coords = getStaticPartnerPickupCoords(partner);
  if (!coords || typeof coordsMatchZone !== "function") return "";
  return (DEFAULT_ZONES || []).find((zone) => coordsMatchZone(coords, zone))?.id || "";
}

function getStaticParcelCreatedTime(parcel) {
  const value = Date.parse(parcel?.createdAt || parcel?.updatedAt || parcel?.assignedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function staticPickupVisibleAfterAck(parcel, acknowledgedAt) {
  const ackTime = Date.parse(acknowledgedAt || "");
  if (!Number.isFinite(ackTime)) return true;
  return getStaticParcelCreatedTime(parcel) > ackTime;
}

function getStaticActivePartnerPickupParcels(store, partner, acknowledgedAt = partner?.lastPickupAcknowledgedAt || "") {
  return (Array.isArray(store.parcels) ? store.parcels : [])
    .filter((parcel) => !parcel.archivedAt && !isStaticDeletedParcel(parcel) && !isPickedUpStaticPartnerParcel(parcel) && parcel.status !== "delivered" && parcel.status !== "failed")
    .filter((parcel) => staticParcelBelongsToPartner(parcel, partner))
    .filter((parcel) => staticPickupVisibleAfterAck(parcel, acknowledgedAt));
}

function addStaticPartnerPickupParcelGroup(groups, key, parcel) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (!groups.has(normalizedKey)) groups.set(normalizedKey, []);
  groups.get(normalizedKey).push(parcel);
}

function buildStaticActivePartnerPickupParcelGroups(store) {
  const groups = new Map();
  (Array.isArray(store.parcels) ? store.parcels : [])
    .filter((parcel) => !parcel.archivedAt && !isStaticDeletedParcel(parcel) && !isPickedUpStaticPartnerParcel(parcel) && parcel.status !== "delivered" && parcel.status !== "failed")
    .forEach((parcel) => {
      addStaticPartnerPickupParcelGroup(groups, parcel.partnerId, parcel);
      const partnerIdUsername = normalizeUsername(parcel.partnerId);
      if (partnerIdUsername) addStaticPartnerPickupParcelGroup(groups, `username:${partnerIdUsername}`, parcel);
      const username = normalizeUsername(parcel.partnerUsername);
      if (username) addStaticPartnerPickupParcelGroup(groups, `username:${username}`, parcel);
    });
  return groups;
}

function getGroupedStaticActivePartnerPickupParcels(groups, partner, acknowledgedAt = partner?.lastPickupAcknowledgedAt || "") {
  const partnerId = partner?.id || partner?.username || "";
  const username = normalizeUsername(partner?.username);
  const seen = new Set();
  return [
    ...(partnerId ? groups.get(partnerId) || [] : []),
    ...(username ? groups.get(`username:${username}`) || [] : []),
  ].filter((parcel) => {
    const key = parcel.id || parcel.createdAt || `${parcel.partnerId}:${parcel.partnerUsername}:${parcel.address || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return staticPickupVisibleAfterAck(parcel, acknowledgedAt);
  });
}

function publicStaticPartnerPickup(store, partner, parcels) {
  const coords = getStaticPartnerPickupCoords(partner);
  if (!coords || !parcels.length) return null;
  const zoneId = getStaticPartnerPickupZoneId(partner);
  const sortedParcels = [...parcels].sort((a, b) => getStaticParcelCreatedTime(b) - getStaticParcelCreatedTime(a));
  return {
    id: `partner-pickup-${partner.id || partner.username}`,
    partnerId: partner.id || partner.username || "",
    partnerUsername: partner.username || "",
    partnerName: userDisplayName(partner),
    phone: partner.phone || "",
    pickupAddress: partner.pickupAddress || "",
    lat: coords.lat,
    lng: coords.lng,
    latitude: coords.lat,
    longitude: coords.lng,
    zoneId,
    zoneName: getStaticZoneNames([zoneId]) || "",
    count: sortedParcels.length,
    orderIds: sortedParcels.map((parcel) => parcel.id).filter(Boolean),
    lastOrderAt: sortedParcels[0]?.createdAt || sortedParcels[0]?.updatedAt || "",
    lastPickupAcknowledgedAt: partner.lastPickupAcknowledgedAt || "",
    lastPickupAcknowledgedBy: partner.lastPickupAcknowledgedBy || "",
  };
}

function getStaticPartnerPickupPinsForCurrentUser(store) {
  const currentProfile = refreshStaticCurrentUserProfile(store) || state.currentUserProfile || {};
  const role = currentProfile.role || "";
  const currentZoneIds = new Set(getStaticUserZoneIds(currentProfile));
  const parcelGroups = buildStaticActivePartnerPickupParcelGroups(store);
  return (Array.isArray(store.users) ? store.users : [])
    .filter((user) => user.role === "partner" && user.status !== "inactive")
    .map((partner) => {
      const pickup = publicStaticPartnerPickup(store, partner, getGroupedStaticActivePartnerPickupParcels(parcelGroups, partner));
      if (!pickup) return null;
      if (role === "admin") return pickup;
      if (role === "courier" && pickup.zoneId && currentZoneIds.has(pickup.zoneId)) return pickup;
      if (role === "partner" && normalizeUsername(state.currentUser) === normalizeUsername(partner.username)) return pickup;
      return null;
    })
    .filter(Boolean);
}

function getStaticUserZoneIds(user) {
  const values = [
    ...(Array.isArray(user?.zoneIds) ? user.zoneIds : []),
    user?.zoneId,
  ];
  const allowed = new Set((Array.isArray(DEFAULT_ZONES) ? DEFAULT_ZONES : []).map((zone) => String(zone.id || "").trim()));
  return [...new Set(values.map((zoneId) => String(zoneId || "").trim()).filter((zoneId) => zoneId && (!allowed.size || allowed.has(zoneId))))];
}

function getStaticZoneNames(zoneIds) {
  return (Array.isArray(zoneIds) ? zoneIds : [])
    .map((zoneId) => (DEFAULT_ZONES || []).find((zone) => String(zone.id || "") === zoneId)?.name || "")
    .filter(Boolean)
    .join(", ");
}

function publicStaticParcel(store, parcel) {
  const courier = store.users.find((user) => normalizeUsername(user.username) === normalizeUsername(parcel.courierUsername));
  const normalizedParcel = normalizeStaticParcelFinance(parcel, store);
  return {
    ...normalizedParcel,
    status: normalizedParcel.status || "pending",
    courier: courier ? publicStaticUser(courier) : null,
  };
}

function isStaticDeletedParcel(parcel) {
  return Boolean(parcel?.deletedAt);
}

function isPickedUpStaticPartnerParcel(parcel) {
  return Boolean(isStaticPartnerParcel(parcel) && (parcel?.pickedUpAt || parcel?.partnerPickupAcknowledgedAt));
}

function canDeleteStaticParcel(parcel) {
  if (!parcel || parcel.archivedAt || isStaticDeletedParcel(parcel) || parcel.status === "delivered") return false;
  if (state.isAdmin) return true;
  if (isPickedUpStaticPartnerParcel(parcel)) return false;
  if (!state.isPartner) return false;
  const partner = state.currentUserProfile || {};
  return Boolean(
    isStaticPartnerParcel(parcel)
    && staticParcelBelongsToPartner(parcel, partner)
  );
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
    { tokens: ["vazha pshavela", "ვაჟა ფშაველა", "ვაჟა-ფშაველა", "ვაჟაფშაველა"], base: { lat: 41.7240, lng: 44.7330 }, step: { lat: 0, lng: 0 } },
    { tokens: ["varketili", "ვარკეთილი", "ვარკეთილის"], base: { lat: 41.6940, lng: 44.8840 }, step: { lat: 0, lng: 0 } },
    { tokens: ["gldani", "გლდანი", "გლდანის"], base: { lat: 41.7930, lng: 44.8170 }, step: { lat: 0, lng: 0 } },
    { tokens: ["mukhiani", "მუხიანი", "მუხიანის"], base: { lat: 41.8050, lng: 44.8390 }, step: { lat: 0, lng: 0 } },
    { tokens: ["nutsubidze", "ნუცუბიძე", "ნუცუბიძის"], base: { lat: 41.7225, lng: 44.7290 }, step: { lat: 0, lng: 0 } },
    { tokens: ["temka", "თემქა", "თემქის"], base: { lat: 41.7770, lng: 44.8110 }, step: { lat: 0, lng: 0 } },
    { tokens: ["zgvisubani", "ზღვისუბანი", "ზღვისუბნის", "ზღვის უბანი"], base: { lat: 41.7860, lng: 44.8320 }, step: { lat: 0, lng: 0 } },
    { tokens: ["dighmis masivi", "დიღმის მასივი", "დიღმის მასივის"], base: { lat: 41.7590, lng: 44.7790 }, step: { lat: 0, lng: 0 } },
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

function staticParcelBelongsToPartner(parcel, partner = {}) {
  if (!parcel || !partner) return false;
  const id = String(partner.id || "").trim();
  const username = String(partner.username || state.currentUser || "").trim();
  const partnerId = String(parcel.partnerId || "").trim();
  const partnerUsername = String(parcel.partnerUsername || "").trim();
  return Boolean(
    (id && (partnerId === id || normalizeUsername(partnerUsername) === normalizeUsername(id)))
    || (username && (normalizeUsername(partnerId) === normalizeUsername(username) || normalizeUsername(partnerUsername) === normalizeUsername(username)))
  );
}

function staticParcelMatchesPartnerFilter(parcel, partnerId) {
  const value = String(partnerId || "").trim();
  if (!value) return true;
  return String(parcel?.partnerId || "") === value
    || normalizeUsername(parcel?.partnerId) === normalizeUsername(value)
    || normalizeUsername(parcel?.partnerUsername) === normalizeUsername(value);
}

function hasStaticParcelCoords(parcel) {
  return Number.isFinite(Number(parcel?.lat ?? parcel?.latitude)) && Number.isFinite(Number(parcel?.lng ?? parcel?.longitude));
}

async function backfillStaticPartnerOrderLocations(store) {
  if (!store || !Array.isArray(store.parcels)) return false;
  let changed = false;
  for (const parcel of store.parcels) {
    if (!parcel || parcel.archivedAt || isStaticDeletedParcel(parcel) || !isStaticPartnerParcel(parcel) || hasStaticParcelCoords(parcel)) continue;
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
  const savedAt = Date.parse(session.savedAt || "");
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > STATIC_SESSION_TTL_MS) {
    clearStaticSession();
    return null;
  }
  return { token: session.token || createStaticToken(session.user), user: session.user, staticMode: true };
}

function clearStaticSession() {
  clearData(STATIC_SESSION_STORAGE_KEY);
}

function verifyStaticPassword(user, password) {
  const supplied = String(password || "");
  if (user?.password !== undefined) return supplied === String(user.password || "");
  return false;
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
    const pendingUser = store.pending.find((item) => normalizeUsername(item.username) === normalizeUsername(requestedUsername));
    const loginUser = user || pendingUser;
    if (!loginUser || !verifyStaticPassword(loginUser, body.password)) throw new Error(STRINGS.invalidLogin);
    if (loginUser.status === "pending") throw new Error("\u10d0\u10dc\u10d2\u10d0\u10e0\u10d8\u10e8\u10d8 \u10d0\u10d3\u10db\u10d8\u10dc\u10d8\u10e1 \u10d3\u10d0\u10d3\u10d0\u10e1\u10e2\u10e3\u10e0\u10d4\u10d1\u10d0\u10e1 \u10d4\u10da\u10dd\u10d3\u10d4\u10d1\u10d0.");
    if (loginUser.status !== "active") throw new Error("\u10d0\u10dc\u10d2\u10d0\u10e0\u10d8\u10e8\u10d8 \u10d0\u10e0\u10d0\u10d0\u10e5\u10e2\u10d8\u10e3\u10e0\u10d8\u10d0.");
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
    const existing = [...store.users, ...store.pending].find((user) => normalizeUsername(user.username) === normalizeUsername(body.username));
    if (existing) throw new Error("\u10db\u10dd\u10db\u10ee\u10db\u10d0\u10e0\u10d4\u10d1\u10d4\u10da\u10d8 \u10e3\u10d9\u10d5\u10d4 \u10d0\u10e0\u10e1\u10d4\u10d1\u10dd\u10d1\u10e1.");
    const now = new Date().toISOString();
    const user = {
      id: `user-${Date.now()}`,
      username: body.username,
      password: body.password || "",
      firstName: body.firstName || "",
      lastName: body.lastName || "",
      phone: body.phone || "",
      role: "courier",
      status: "pending",
      requestedAt: now,
      approvedAt: "",
      createdAt: now,
    };
    store.pending.push(user);
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

  if (method === "GET" && apiPath === "/api/partner-pickups") {
    return { pickups: getStaticPartnerPickupPinsForCurrentUser(store) };
  }

  if (method === "GET" && apiPath === "/api/partner-cash-adjustments") {
    const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
    const adjustments = normalizeFinanceAdjustmentList(financeData.partnerCashAdjustments || [], "partnerCash");
    if (state.isPartner) {
      const partner = state.currentUserProfile || {};
      const id = partner.id || partner.username || "";
      return {
        adjustments: adjustments.filter((item) => (
          (id && item.partnerId === id)
          || normalizeUsername(item.partnerUsername || item.username) === normalizeUsername(partner.username)
        )),
      };
    }
    return { adjustments };
  }

  if (method === "POST" && apiPath === "/api/partner-cash-adjustments") {
    if (!state.isAdmin) throw new Error("\u10db\u10ee\u10dd\u10da\u10dd\u10d3 \u10d0\u10d3\u10db\u10d8\u10dc\u10e1 \u10e8\u10d4\u10e3\u10eb\u10da\u10d8\u10d0 \u10de\u10d0\u10e0\u10e2\u10dc\u10d8\u10dd\u10e0\u10d8\u10e1 \u10e5\u10d4\u10e8\u10d8\u10e1 \u10d9\u10dd\u10e0\u10d4\u10e5\u10e2\u10d8\u10e0\u10d4\u10d1\u10d0.");
    const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
    const adjustments = normalizeFinanceAdjustmentList(financeData.partnerCashAdjustments || [], "partnerCash");
    const adjustment = normalizeFinanceAdjustment(body, "partnerCash", adjustments.length);
    store.financeData = {
      ...financeData,
      partnerCashAdjustments: [...adjustments, adjustment],
    };
    saveData(CONFIG.partnerCashAdjustmentsStorageKey, store.financeData.partnerCashAdjustments);
    saveStaticBootstrap();
    return { adjustment };
  }

  if (method === "GET" && apiPath === "/api/daily-balance-ledger") {
    const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
    return { entries: Array.isArray(financeData.dailyBalanceLedger) ? financeData.dailyBalanceLedger : [] };
  }

  if (method === "POST" && apiPath === "/api/daily-balance-ledger") {
    if (!state.isAdmin) throw new Error("მხოლოდ ადმინს შეუძლია დღიური ბალანსის შენახვა.");
    const now = new Date().toISOString();
    const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
    const entries = Array.isArray(financeData.dailyBalanceLedger) ? financeData.dailyBalanceLedger : [];
    const entry = {
      ...body,
      id: body.id || `daily-balance-${Date.now()}`,
      createdAt: body.createdAt || now,
      updatedAt: now,
    };
    store.financeData = {
      ...financeData,
      dailyBalanceLedger: [...entries.filter((item) => item.id !== entry.id), entry],
    };
    saveData(CONFIG.dailyBalanceLedgerStorageKey, store.financeData.dailyBalanceLedger);
    saveStaticBootstrap();
    return { entry };
  }

  const dailyBalanceMatch = apiPath.match(/^\/api\/daily-balance-ledger\/([^/]+)$/);
  if (dailyBalanceMatch && method === "DELETE") {
    if (!state.isAdmin) throw new Error("მხოლოდ ადმინს შეუძლია დღიური ბალანსის შეცვლა.");
    const id = decodeURIComponent(dailyBalanceMatch[1]);
    const financeData = store.financeData && typeof store.financeData === "object" ? store.financeData : {};
    const entries = Array.isArray(financeData.dailyBalanceLedger) ? financeData.dailyBalanceLedger : [];
    store.financeData = {
      ...financeData,
      dailyBalanceLedger: entries.filter((entry) => entry.id !== id),
    };
    saveData(CONFIG.dailyBalanceLedgerStorageKey, store.financeData.dailyBalanceLedger);
    saveStaticBootstrap();
    return { ok: true };
  }

  if (method === "GET" && apiPath === "/api/couriers") {
    return { couriers: store.users.filter((user) => user.role === "courier" && user.status === "active").map(publicStaticUser) };
  }

  if (method === "GET" && apiPath === "/api/pending") return { pending: store.pending.map(publicStaticUser) };

  if (method === "GET" && apiPath === "/api/zones") return { zones: store.zones };

  if (method === "GET" && apiPath === "/api/tariffs") {
    if (!state.isAdmin && !state.isPartner) throw new Error("წვდომა აკრძალულია.");
    return { tariffs: getStaticTariffSettings(store) };
  }

  if (method === "PUT" && apiPath === "/api/tariffs") {
    if (!state.isAdmin) throw new Error("მხოლოდ ადმინს შეუძლია ტარიფების შეცვლა.");
    store.settings = store.settings && typeof store.settings === "object" ? store.settings : {};
    store.settings.tariffs = normalizeStaticTariffSettings(body.tariffs || body);
    store.settings.tariffsUpdatedAt = new Date().toISOString();
    store.settings.tariffsUpdatedBy = state.currentUser || "";
    saveStaticBootstrap();
    return { tariffs: store.settings.tariffs };
  }

  if (method === "GET" && apiPath === "/api/workday") {
    const workday = ensureStaticWorkdayState(store);
    saveStaticBootstrap();
    return { workday };
  }

  if (method === "GET" && apiPath === "/api/parcels") {
    const courier = url.searchParams.get("courier") || "";
    const partnerId = url.searchParams.get("partnerId") || "";
    const parcels = store.parcels
      .filter((parcel) => {
        if (parcel.archivedAt || isStaticDeletedParcel(parcel)) return false;
        if (state.isPartner) return staticParcelBelongsToPartner(parcel, state.currentUserProfile || {});
        if (!staticParcelMatchesPartnerFilter(parcel, partnerId)) return false;
        return !courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier);
      })
      .map((parcel) => publicStaticParcel(store, parcel));
    return staticPaginatedPayload("parcels", parcels, getStaticPaginationOptions(url));
  }

  if (method === "GET" && apiPath === "/api/history") {
    const courier = url.searchParams.get("courier") || "";
    const history = mergeStaticRecordsByKey([], [...store.history, ...store.parcels.filter((parcel) => parcel.archivedAt)], getStaticParcelKey, resolveStaticParcelRecord)
      .filter((parcel) => !isStaticDeletedParcel(parcel))
      .filter((parcel) => !state.isPartner || staticParcelBelongsToPartner(parcel, state.currentUserProfile || {}))
      .filter((parcel) => !courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier))
      .map((parcel) => publicStaticParcel(store, parcel));
    return staticPaginatedPayload("history", history, getStaticPaginationOptions(url));
  }

  if (method === "GET" && apiPath === "/api/parcels/search") {
    const query = String(url.searchParams.get("q") || "").toLowerCase();
    const filters = getStaticParcelSearchFilters(url);
    const records = [...store.parcels, ...store.history];
    const parcels = records
      .filter((parcel) => !isStaticDeletedParcel(parcel))
      .filter((parcel) => !query || [parcel.fullName, parcel.phone, parcel.address, parcel.courierUsername, parcel.status].some((value) => String(value || "").toLowerCase().includes(query)))
      .filter((parcel) => staticParcelMatchesSearchFilters(parcel, filters))
      .map((parcel) => publicStaticParcel(store, parcel));
    return staticPaginatedPayload("parcels", parcels, getStaticPaginationOptions(url));
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
      zoneIds: Array.isArray(body.zoneIds) ? body.zoneIds : (body.zoneId ? [body.zoneId] : []),
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
    const pickupCoords = getStaticPartnerPickupCoords(body);
    const hasPickupCoords = Boolean(pickupCoords);
    const pickupZoneId = body.pickupZoneId || (hasPickupCoords ? getStaticPartnerPickupZoneId(pickupCoords) : "");
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
      pickupAddress: body.pickupAddress || "",
      pickupLat: hasPickupCoords ? pickupCoords.lat : "",
      pickupLng: hasPickupCoords ? pickupCoords.lng : "",
      pickupLatitude: hasPickupCoords ? pickupCoords.lat : "",
      pickupLongitude: hasPickupCoords ? pickupCoords.lng : "",
      pickupZoneId,
      pickupZoneName: body.pickupZoneName || getStaticZoneNames([pickupZoneId]) || "",
      pickupLocationSource: hasPickupCoords ? body.pickupLocationSource || "admin_manual_pickup" : "",
      pickupLocationUpdatedAt: hasPickupCoords ? body.pickupLocationUpdatedAt || now : "",
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
  const partnerPickupAckMatch = apiPath.match(/^\/api\/partners\/([^/]+)\/pickup-ack$/);
  if (partnerPickupAckMatch && method === "POST") {
    const username = decodeURIComponent(partnerPickupAckMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username) && item.role === "partner");
    if (!user) return { partner: null, acknowledgedCount: 0 };
    const currentProfile = refreshStaticCurrentUserProfile(store) || state.currentUserProfile || {};
    if (!["admin", "courier"].includes(currentProfile.role || "")) throw new Error("წვდომა აკრძალულია.");
    const zoneId = getStaticPartnerPickupZoneId(user);
    const currentZoneIds = new Set(getStaticUserZoneIds(currentProfile));
    if (currentProfile.role === "courier" && (!zoneId || !currentZoneIds.has(zoneId))) throw new Error("ეს პარტნიორი თქვენს ზონაში არ არის.");
    const activeParcels = getStaticActivePartnerPickupParcels(store, user);
    const now = new Date().toISOString();
    activeParcels.forEach((parcel) => {
      parcel.pickedUpAt = now;
      parcel.pickedUpBy = state.currentUser || "";
      parcel.pickedUpByRole = currentProfile.role || "";
      parcel.partnerPickupAcknowledgedAt = now;
      parcel.partnerPickupAcknowledgedBy = state.currentUser || "";
      parcel.updatedAt = now;
    });
    Object.assign(user, {
      lastPickupAcknowledgedAt: now,
      lastPickupAcknowledgedBy: state.currentUser || "",
      lastPickupAcknowledgedByRole: currentProfile.role || "",
      updatedAt: now,
    });
    saveStaticBootstrap();
    return {
      partner: publicStaticUser(user),
      acknowledgedAt: now,
      acknowledgedCount: activeParcels.length,
      pickup: publicStaticPartnerPickup(store, user, getStaticActivePartnerPickupParcels(store, user)),
    };
  }
  if (partnerMatch && method === "PUT") {
    const username = decodeURIComponent(partnerMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username) && item.role === "partner");
    if (user) {
      const pickupCoords = getStaticPartnerPickupCoords(body);
      const hasPickupCoords = Boolean(pickupCoords);
      const pickupZoneId = body.pickupZoneId || (hasPickupCoords ? getStaticPartnerPickupZoneId(pickupCoords) : "");
      Object.assign(user, {
        companyName: body.companyName || user.companyName || "",
        contactPerson: body.contactPerson || user.contactPerson || "",
        firstName: body.contactPerson || user.contactPerson || "",
        phone: body.phone || user.phone || "",
        status: body.status === "inactive" ? "inactive" : "active",
        pickupAddress: body.pickupAddress || "",
        pickupLat: hasPickupCoords ? pickupCoords.lat : "",
        pickupLng: hasPickupCoords ? pickupCoords.lng : "",
        pickupLatitude: hasPickupCoords ? pickupCoords.lat : "",
        pickupLongitude: hasPickupCoords ? pickupCoords.lng : "",
        pickupZoneId,
        pickupZoneName: body.pickupZoneName || getStaticZoneNames([pickupZoneId]) || "",
        pickupLocationSource: hasPickupCoords ? body.pickupLocationSource || "admin_manual_pickup" : "",
        pickupLocationUpdatedAt: hasPickupCoords ? body.pickupLocationUpdatedAt || new Date().toISOString() : "",
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
    const zoneIds = Array.isArray(body.zoneIds) ? body.zoneIds.filter(Boolean) : (body.zoneId ? [body.zoneId] : []);
    if (user) Object.assign(user, {
      zoneIds,
      zoneId: zoneIds[0] || "",
      zoneName: body.zoneName || getStaticZoneNames(zoneIds) || "",
    });
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
    const workdayKey = getStaticCurrentWorkdayKey(store, new Date(now));
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
    const assignment = hasCoords && typeof applyAutoAssignByZone === "function"
      ? await applyAutoAssignByZone({ lat: latValue, lng: lngValue, courierUsername: body.courierUsername || "" })
      : {};
    const assignedCourierUsername = body.courierUsername || assignment.courierUsername || "";
    const explicitTariffId = cleanStaticParcelTariffId(body.tariffId || body.tariffType || body.deliveryTariffId);
    assertStaticParcelTariffAllowed(explicitTariffId);
    const tariffId = explicitTariffId || (body.zoneId || assignment.zoneId ? "city" : "suburbs");
    const tariff = getStaticTariffSettings(store)[tariffId] || getStaticTariffSettings(store).city;
    const parcel = {
      id: `parcel-${Date.now()}`,
      courierUsername: assignedCourierUsername,
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
      zoneId: body.zoneId || assignment.zoneId || "",
      zoneName: body.zoneName || assignment.zoneName || "",
      tariffId,
      tariffLabel: tariff.label,
      volumeTariffId: typeof isVolumeTariffId === "function" && isVolumeTariffId(tariffId) ? tariffId : "",
      expressDelivery: tariffId === "express",
      deliveryServiceType: tariffId === "express" ? "express" : typeof isVolumeTariffId === "function" && isVolumeTariffId(tariffId) ? "volume" : "standard",
      autoAssigned: Boolean(assignment.autoAssigned || body.autoAssigned),
      status: "pending",
      workdayKey,
      createdAt: now,
      updatedAt: now,
      assignedAt: assignedCourierUsername ? now : "",
    };
    store.parcels.push(parcel);
    if (state.isPartner) queueStaticPushNotification(store, buildStaticParcelCreatedNotification(parcel));
    saveStaticBootstrap();
    return { parcel: publicStaticParcel(store, parcel) };
  }

  if (method === "PATCH" && apiPath === "/api/parcels/assign") {
    const parcelIds = Array.isArray(body.parcelIds) ? body.parcelIds : [];
    const expectedUpdatedAtById = body.expectedUpdatedAtById && typeof body.expectedUpdatedAtById === "object" ? body.expectedUpdatedAtById : {};
    const missingLocation = store.parcels.find((parcel) => parcelIds.includes(parcel.id) && (!Number.isFinite(Number(parcel.lat)) || !Number.isFinite(Number(parcel.lng))));
    if (missingLocation) throw new Error("კურიერის მიბმამდე მიუთითეთ შეკვეთის პინის ლოკაცია.");
    store.parcels.forEach((parcel) => {
      if (parcelIds.includes(parcel.id) && !isStaticDeletedParcel(parcel)) {
        assertStaticParcelVersion(parcel, expectedUpdatedAtById[parcel.id]);
        parcel.courierUsername = body.courierUsername || "";
        parcel.assignedAt = new Date().toISOString();
        parcel.updatedAt = parcel.assignedAt;
        parcel.autoAssigned = false;
        if (parcel.courierUsername) queueStaticPushNotification(store, buildStaticParcelAssignedNotification(parcel, parcel.courierUsername));
      }
    });
    saveStaticBootstrap();
    return { assigned: parcelIds.length };
  }

  const statusMatch = apiPath.match(/^\/api\/parcels\/([^/]+)\/status$/);
  if (statusMatch && method === "PATCH") {
    const parcel = store.parcels.find((item) => item.id === decodeURIComponent(statusMatch[1]));
    if (!parcel || isStaticDeletedParcel(parcel)) return { ok: false };
    assertStaticParcelVersion(parcel, body.expectedUpdatedAt);
    if (body.status === "failed" && !String(body.failureReason || "").trim()) throw new Error("ვერ ჩაბარების მიზეზი აუცილებელია.");
    const now = new Date().toISOString();
    const workdayKey = getStaticCurrentWorkdayKey(store, new Date(now));
    parcel.status = body.status || parcel.status;
    parcel.updatedAt = now;
    if (parcel.status === "delivered") {
      parcel.completedAt = body.completedAt || now;
      parcel.deliveredAt = body.deliveredAt || parcel.completedAt;
      parcel.failedAt = "";
      parcel.failureReason = "";
      parcel.completedWorkdayKey = workdayKey;
      parcel.financeDateKey = workdayKey;
      Object.assign(parcel, normalizeStaticParcelFinance(parcel, store));
    }
    if (parcel.status === "failed") {
      parcel.completedAt = body.completedAt || now;
      parcel.failedAt = body.failedAt || parcel.completedAt;
      parcel.deliveredAt = "";
      parcel.failureReason = body.failureReason || "";
      parcel.completedWorkdayKey = workdayKey;
    }
    if (parcel.status === "pending") {
      parcel.completedAt = "";
      parcel.deliveredAt = "";
      parcel.failedAt = "";
      parcel.failureReason = "";
      parcel.completedWorkdayKey = "";
      parcel.financeDateKey = "";
    }
    if (["delivered", "failed"].includes(parcel.status)) {
      queueStaticPushNotification(store, buildStaticParcelStatusNotification(parcel, parcel.status, body));
    }
    saveStaticBootstrap();
    return { parcel: publicStaticParcel(store, parcel) };
  }

  const deleteMatch = apiPath.match(/^\/api\/parcels\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const parcel = store.parcels.find((item) => item.id === decodeURIComponent(deleteMatch[1]));
    if (!parcel || !canDeleteStaticParcel(parcel)) throw new Error("ამ შეკვეთის წაშლა შეუძლებელია.");
    assertStaticParcelVersion(parcel, body.expectedUpdatedAt);
    const now = new Date().toISOString();
    parcel.deletedAt = now;
    parcel.deletedBy = state.currentUser || "";
    parcel.deletedByRole = state.isAdmin ? "admin" : state.isPartner ? "partner" : "";
    parcel.deleteReason = String(body.reason || "").trim();
    parcel.updatedAt = now;
    saveStaticBootstrap();
    return { deleted: 1, parcel: publicStaticParcel(store, parcel) };
  }

  if (method === "POST" && apiPath === "/api/parcels/archive") {
    const parcelIds = Array.isArray(body.parcelIds) ? new Set(body.parcelIds) : null;
    const courier = body.courierUsername || "";
    const now = new Date().toISOString();
    const closeWorkday = Boolean(body.closeWorkday);
    const workdayState = ensureStaticWorkdayState(store, new Date(now));
    const closeWorkdayKey = isStaticDateKey(body.workdayKey) ? body.workdayKey : workdayState.currentWorkdayKey;
    let archived = 0;
    store.parcels.forEach((parcel) => {
      const matchesCloseWorkday = !closeWorkday || getStaticParcelWorkdayDateKey(parcel) === closeWorkdayKey;
      if (
        !parcel.archivedAt
        && !isStaticDeletedParcel(parcel)
        && parcel.status === "delivered"
        && matchesCloseWorkday
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
        Object.assign(parcel, normalizeStaticParcelFinance(parcel, store));
        archived += 1;
      }
    });
    const nextWorkday = closeWorkday ? closeStaticCurrentWorkday(store, closeWorkdayKey, new Date(now)) : ensureStaticWorkdayState(store, new Date(now));
    if (body.autoClosedDate) {
      store.settings.lastAutoCloseDate = body.autoClosedDate;
      store.settings.lastAutoCloseAt = now;
    }
    archiveStaticCompletedParcels(store);
    pruneStaticPushEvents(store);
    saveStaticBootstrap();
    return { archived, workday: nextWorkday, closedWorkdayKey: closeWorkday ? closeWorkdayKey : "" };
  }

  const locationMatch = apiPath.match(/^\/api\/parcels\/([^/]+)\/location$/);
  if (locationMatch && method === "PATCH") {
    const parcel = store.parcels.find((item) => item.id === decodeURIComponent(locationMatch[1]));
    if (!parcel || isStaticDeletedParcel(parcel)) return { ok: false };
    assertStaticParcelVersion(parcel, body.expectedUpdatedAt);
    const lat = Number(body.lat ?? body.latitude);
    const lng = Number(body.lng ?? body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("სწორი გრძედი და განედი აუცილებელია.");
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
    const partnerOrderCutoffDate = normalizeDateKey(body.partnerOrderCutoffDate) || cutoffDate;
    if (!cutoffDate) throw new Error("გასუფთავების თარიღი არასწორია.");
    const result = runStaticRetentionCleanup(store, cutoffDate, partnerOrderCutoffDate);
    const now = new Date().toISOString();
    store.settings.lastRetentionCleanupDate = toDateKey(new Date());
    store.settings.lastRetentionCleanupAt = now;
    store.settings.retentionCutoffDate = cutoffDate;
    store.settings.retentionMonths = Number(body.retentionMonths || CONFIG.dataRetentionMonths || 8);
    store.settings.partnerOrderRetentionCutoffDate = partnerOrderCutoffDate;
    store.settings.partnerOrderRetentionMonths = Number(body.partnerOrderRetentionMonths || CONFIG.partnerOrderRetentionMonths || 1);
    saveStaticBootstrap();
    return {
      ...result,
      cutoffDate,
      retentionMonths: store.settings.retentionMonths,
      partnerOrderCutoffDate,
      partnerOrderRetentionMonths: store.settings.partnerOrderRetentionMonths,
    };
  }

  console.warn("Static API fallback returned empty response for", method, apiPath);
  return {};
}

async function api(path, options = {}) {
  if (isStaticDeploy() && path.startsWith("/api/")) {
    try {
      return await staticApi(path, options);
    } catch (error) {
      if (typeof recordClientIssue === "function") recordClientIssue("static-api-error", error, { path, method: options.method || "GET" });
      throw error;
    }
  }

  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const startedAt = performance.now();

  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    const durationMs = Math.round(performance.now() - startedAt);
    if (durationMs > Number(CONFIG.slowRequestWarningMs || 2500)) {
      if (typeof recordClientIssue === "function") recordClientIssue("slow-api", `${options.method || "GET"} ${path}`, { durationMs, status: response.status });
    }
    if (!response.ok) {
      const error = new Error(payload.error || STRINGS.serverFailed);
      error.status = response.status;
      error.payload = payload;
      if (typeof recordClientIssue === "function") recordClientIssue("api-error", error, { path, status: response.status });
      throw error;
    }
    return payload;
  } catch (error) {
    if (!error.status && typeof recordClientIssue === "function") recordClientIssue("network-error", error, { path, method: options.method || "GET" });
    throw error;
  }
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

async function getPartnerPickupPins() {
  const payload = await api("/api/partner-pickups");
  return Array.isArray(payload.pickups) ? payload.pickups : [];
}

async function getPending() {
  return (await api("/api/pending")).pending;
}

async function getWorkdayState() {
  const workday = (await api("/api/workday")).workday;
  if (workday?.currentWorkdayKey) state.currentWorkdayKey = workday.currentWorkdayKey;
  return workday;
}

async function getPins(username, options = {}) {
  const params = new URLSearchParams();
  if (username) params.set("courier", username);
  ["partnerId", "limit", "offset"].forEach((key) => {
    if (options[key] !== undefined && options[key] !== null && options[key] !== "") params.set(key, options[key]);
  });
  const query = params.toString() ? `?${params.toString()}` : "";
  return (await api(`/api/parcels${query}`)).parcels;
}

async function getHistory(username, options = {}) {
  const params = new URLSearchParams();
  if (username) params.set("courier", username);
  ["limit", "offset"].forEach((key) => {
    if (options[key] !== undefined && options[key] !== null && options[key] !== "") params.set(key, options[key]);
  });
  const query = params.toString() ? `?${params.toString()}` : "";
  return (await api(`/api/history${query}`)).history;
}

async function searchParcels(query, filters = {}) {
  const params = new URLSearchParams();
  params.set("q", query || "");
  ["status", "dateFrom", "dateTo", "courier", "limit", "offset"].forEach((key) => {
    if (filters[key]) params.set(key, filters[key]);
  });
  return (await api(`/api/parcels/search?${params.toString()}`)).parcels;
}

async function deleteParcel(parcelId, reason = "", expectedUpdatedAt = "") {
  return api(`/api/parcels/${encodeURIComponent(parcelId)}`, {
    method: "DELETE",
    body: { reason, expectedUpdatedAt },
  });
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
