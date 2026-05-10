"use strict";

const STATIC_DEPLOY_STORAGE_KEY = "deliveryStaticBootstrap:v1";
const STATIC_SESSION_STORAGE_KEY = "deliveryStaticSession:v1";
let staticRealtimeRefreshTimer = null;

function isStaticDeploy() {
  return window.IS_STATIC_DEPLOY === true || window.location.hostname.includes("github.io");
}

async function loadStaticBootstrap() {
  if (loadStaticBootstrap.cache) return loadStaticBootstrap.cache;

  let fallback = {
    users: [],
    pending: [],
    parcels: [],
    history: [],
    zones: [],
    financeData: {},
    settings: {},
  };

  try {
    const response = await fetch("./data/bootstrap.json", { cache: "no-store" });
    if (response.ok) fallback = { ...fallback, ...(await response.json()) };
  } catch (error) {
    console.warn("Static bootstrap data unavailable", error);
  }

  try {
    const stored = loadData(STATIC_DEPLOY_STORAGE_KEY);
    if (stored && typeof stored === "object") fallback = { ...fallback, ...stored };
  } catch {
    clearData(STATIC_DEPLOY_STORAGE_KEY);
  }

  try {
    if (typeof loadFirebaseStaticStore === "function") {
      const firebaseStore = await loadFirebaseStaticStore();
      if (firebaseStore && typeof firebaseStore === "object") fallback = { ...fallback, ...firebaseStore };
    }
  } catch (error) {
    console.warn("Firebase static store unavailable", error);
  }

  loadStaticBootstrap.cache = normalizeStaticStore(fallback);
  hydrateStaticFinanceStorage(loadStaticBootstrap.cache.financeData);
  saveStaticBootstrap();
  startStaticRealtimeSync();
  return loadStaticBootstrap.cache;
}

function normalizeStaticStore(store) {
  const users = Array.isArray(store.users) ? store.users : [];
  const extraCouriers = (Array.isArray(store.couriers) ? store.couriers : [])
    .filter((courier) => !users.some((user) => normalizeUsername(user.username) === normalizeUsername(courier.username)))
    .map((courier) => ({ ...courier, role: "courier", status: courier.status || "active" }));
  const mergedUsers = [...users, ...extraCouriers];
  return {
    users: mergedUsers,
    couriers: mergedUsers.filter((user) => user.role === "courier"),
    pending: Array.isArray(store.pending) ? store.pending : [],
    parcels: Array.isArray(store.parcels) ? store.parcels : [],
    history: Array.isArray(store.history) ? store.history : [],
    zones: Array.isArray(store.zones) ? store.zones : [],
    financeData: store.financeData && typeof store.financeData === "object" ? store.financeData : {},
    settings: store.settings && typeof store.settings === "object" ? store.settings : {},
  };
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

function applyFirebaseStaticStoreUpdate(store) {
  if (!store || typeof store !== "object") return;
  const normalizedStore = normalizeStaticStore(store);
  loadStaticBootstrap.cache = normalizedStore;
  saveData(STATIC_DEPLOY_STORAGE_KEY, normalizedStore);
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

function publicStaticUser(user) {
  return {
    id: user.id || user.username,
    username: user.username,
    role: user.role || "courier",
    status: user.status || "active",
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
  return {
    ...parcel,
    paymentAmount: Number(parcel.paymentAmount || parcel.cashAmount || 0),
    cashAmount: Number(parcel.cashAmount || parcel.paymentAmount || 0),
    status: parcel.status || "pending",
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
    if (!user) throw new Error(STRINGS.invalidLogin);
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
    const user = {
      id: `user-${Date.now()}`,
      username: body.username,
      password: body.password || "",
      firstName: body.firstName || "",
      lastName: body.lastName || "",
      phone: body.phone || "",
      role: "courier",
      status: "active",
      createdAt: new Date().toISOString(),
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

  if (method === "GET" && apiPath === "/api/couriers") {
    return { couriers: store.users.filter((user) => user.role === "courier" && user.status === "active").map(publicStaticUser) };
  }

  if (method === "GET" && apiPath === "/api/pending") return { pending: store.pending.map(publicStaticUser) };

  if (method === "GET" && apiPath === "/api/zones") return { zones: store.zones };

  if (method === "GET" && apiPath === "/api/parcels") {
    const courier = url.searchParams.get("courier") || "";
    return {
      parcels: store.parcels
        .filter((parcel) => !parcel.archivedAt && (!courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier)))
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
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    saveStaticBootstrap();
    return { user: publicStaticUser(user) };
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
  if (userMatch && method === "PUT") {
    const username = decodeURIComponent(userMatch[1]);
    const user = store.users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (user) Object.assign(user, body);
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

  if (apiPath.match(/^\/api\/couriers\/([^/]+)\/password$/) && method === "PUT") return { ok: true };

  if (method === "POST" && apiPath === "/api/parcels") {
    const now = new Date().toISOString();
    const parcel = {
      id: `parcel-${Date.now()}`,
      courierUsername: body.courierUsername || "",
      lat: Number(body.lat),
      lng: Number(body.lng),
      address: body.address || "",
      fullName: body.fullName || "",
      phone: body.phone || "",
      paymentAmount: Number(body.paymentAmount || body.payment || 0),
      cashAmount: Number(body.paymentAmount || body.payment || 0),
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
    const now = new Date().toISOString();
    parcel.status = body.status || parcel.status;
    parcel.updatedAt = now;
    if (parcel.status === "delivered") {
      parcel.completedAt = body.completedAt || now;
      parcel.deliveredAt = body.deliveredAt || parcel.completedAt;
      parcel.failedAt = "";
      parcel.deliveryTotalPrice = CONFIG.deliveryTotalPrice;
      parcel.courierPay = CONFIG.courierDeliveryPay;
      parcel.adminProfit = CONFIG.adminDeliveryProfit;
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
        parcel.completedAt = parcel.completedAt || parcel.deliveredAt || now;
        parcel.deliveredAt = parcel.deliveredAt || parcel.completedAt;
        parcel.deliveryTotalPrice = Number(parcel.deliveryTotalPrice || CONFIG.deliveryTotalPrice);
        parcel.courierPay = Number(parcel.courierPay || CONFIG.courierDeliveryPay);
        parcel.adminProfit = Number(parcel.adminProfit || CONFIG.adminDeliveryProfit);
        parcel.cashAmount = Number(parcel.cashAmount || parcel.paymentAmount || 0);
        archived += 1;
      }
    });
    saveStaticBootstrap();
    return { archived };
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
