"use strict";

const CONFIG = {
  center: [41.7151, 44.8271],
  deliveryTotalPrice: 6,
  courierDeliveryPay: 3.5,
  adminDeliveryProfit: 2.5,
  useZonesApi: false,
  useUserZoneApi: true,
  useReverseGeocoding: true,
  useExternalAddressSearch: true,
  useOverpassSearch: false,
  zoneAssignmentsStorageKey: "deliveryZoneAssignments:v1",
  cashAdjustmentsStorageKey: "deliveryCashAdjustments:v1",
  payAdjustmentsStorageKey: "deliveryPayAdjustments:v1",
};

const STRINGS = {
  emptyFields: "შეავსეთ ყველა ველი.",
  pendingSent: "რეგისტრაციის მოთხოვნა გაიგზავნა ადმინთან.",
  invalidLogin: "ლოგინი ან პაროლი არასწორია.",
  noCouriers: "კურიერი ჯერ არ არის.",
  noPending: "დასადასტურებელი მოთხოვნა არ არის.",
  noParcels: "აქტიური ამანათი არ არის.",
  chooseMapPoint: "დააჭირეთ რუკაზე მიტანის ადგილს.",
  parcelAdded: "ამანათი დაემატა.",
  dayArchived: "დასრულებული ამანათები გადავიდა ისტორიაში.",
  setupFailed: "ადმინის შექმნა ვერ მოხერხდა.",
  serverFailed: "სერვერთან კავშირი ვერ მოხერხდა.",
  addressRequired: "შეიყვანეთ ქუჩა და შენობის ნომერი.",
  addressLoading: "მისამართი იძებნება...",
  addressMissing: "მისამართი არ არის მითითებული",
  addressStreetFallback: "ზუსტი შენობის ნომერი ვერ მოიძებნა, ნაჩვენებია ქუჩა.",
};

const DEFAULT_ZONES = getDefaultTbilisiZones();

const state = {
  map: null,
  markers: null,
  currentUser: null,
  authToken: null,
  isAdmin: false,
  activePins: [],
  adminMapCouriers: [],
  adminMapFilters: {
    selectedCouriers: [],
    showUnassigned: true,
    mode: "all",
  },
  currentPosition: { lat: CONFIG.center[0], lng: CONFIG.center[1] },
  hasCurrentPosition: false,
  watchId: null,
  locationMarker: null,
  routeLayer: null,
  routePinId: null,
  selectedPinId: null,
  selectedParcelCardCollapsed: false,
  expandedPinLabels: [],
  parcelAddressCache: {},
  historySearchResults: [],
  historyPreviewMarker: null,
  courierStats: {
    username: "",
    user: null,
    parcels: [],
    history: [],
    records: [],
    selectedDate: toDateKey(new Date()),
    rangeStart: toDateKey(new Date()),
    rangeEnd: toDateKey(new Date()),
    filter: "all",
  },
  financeDate: toDateKey(new Date()),
  financeRangeStart: toDateKey(new Date()),
  financeRangeEnd: toDateKey(new Date()),
  selectedCourier: null,
  pendingCoords: null,
  pendingMarker: null,
  pendingAddress: "",
  pendingAddressWarning: "",
  pendingZone: null,
  pendingAutoAssignment: null,
  calendarDate: new Date(),
  activeDialogTitle: "",
  midnightTimer: null,
  mode: "idle",
};

const els = {};
let HtmlMapLabel = null;

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  await initializeMap();
  initializeAuth();
});

function cacheElements() {
  els.appShell = document.querySelector(".app-shell");
  [
    "map", "menuButton", "actionPanel", "modeToast", "courierStatsCard", "nearestParcelCard",
    "setupModal", "setupForm", "setupUsername", "setupPassword",
    "setupError", "authModal", "loginForm", "loginUsername", "loginPassword",
    "loginError", "showRegisterButton", "registerModal", "registerForm", "regUsername",
    "regFirstName", "regLastName", "regPhone", "regPassword", "regError", "backToLoginButton", "dialogModal", "dialogTitle",
    "dialogBody", "dialogActions",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.setupForm.addEventListener("submit", handleAdminSetup);
  els.loginForm.addEventListener("submit", handleLogin);
  els.registerForm.addEventListener("submit", handleRegistration);
  els.showRegisterButton?.addEventListener("click", () => switchModal("register"));
  els.backToLoginButton.addEventListener("click", () => switchModal("login"));
  els.menuButton.addEventListener("click", () => {
    collapseSelectedParcelCard();
    collapseDeliveredPinLabels();
    toggleActions();
  });
  els.dialogModal?.addEventListener("click", handleDialogBackdropClick);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    handleAction(button.dataset.action, button.dataset.value, button);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDialog();
      cancelMapSelection();
    }
  });
}

function handleDialogBackdropClick(event) {
  if (event.target !== els.dialogModal) return;
  closeActions();
  closeDialog();
}

async function initializeMap() {
  state.markers = [];

  if (!window.L) {
    showDialog("რუკა ვერ ჩაიტვირთა", `<p>რუკის ბიბლიოთეკა ვერ ჩაიტვირთა.</p>`, [
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
    return;
  }

  state.map = L.map(els.map, { zoomControl: false }).setView(CONFIG.center, 14);
  L.control.zoom({ position: "bottomleft" }).addTo(state.map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: 'მონაცემები: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-ის მონაწილეები',
  }).addTo(state.map);

  HtmlMapLabel = createHtmlMapLabelClass();
  state.map.on("click", handleMapClick);
}

async function initializeAuth() {
  try {
    const bootstrap = await api("/api/bootstrap");
    hideModal(els.setupModal);
    hideModal(els.authModal);
    showModal(bootstrap.hasAdmin ? els.authModal : els.setupModal);
  } catch (error) {
    setMessage(els.loginError, error.message || STRINGS.serverFailed, true);
  }
}

async function api(path, options = {}) {
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

async function handleAdminSetup(event) {
  event.preventDefault();
  const username = els.setupUsername.value.trim();
  const password = els.setupPassword.value;
  if (!username || !password) return setMessage(els.setupError, STRINGS.emptyFields, true);

  try {
    const payload = await api("/api/setup-admin", { method: "POST", body: { username, password } });
    els.setupError.textContent = "";
    completeLogin(payload);
  } catch (error) {
    setMessage(els.setupError, error.message || STRINGS.setupFailed, true);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;

  try {
    const payload = await api("/api/login", { method: "POST", body: { username, password } });
    els.loginError.textContent = "";
    completeLogin(payload);
  } catch {
    els.loginError.textContent = STRINGS.invalidLogin;
  }
}

function completeLogin(payload) {
  state.authToken = payload.token;
  state.currentUser = payload.user.username;
  state.isAdmin = payload.user.role === "admin";
  hideModal(els.setupModal);
  hideModal(els.authModal);
  hideModal(els.registerModal);
  resetMapSelectionUi();
  renderActions();
  startLocationWatch();
  refreshPins();
  scheduleMidnightRefresh();
}

async function handleRegistration(event) {
  event.preventDefault();
  const username = els.regUsername.value.trim();
  const firstName = els.regFirstName.value.trim();
  const lastName = els.regLastName.value.trim();
  const phone = els.regPhone.value.trim();
  const password = els.regPassword.value.trim();

  if (!username || !firstName || !lastName || !phone || !password) return setMessage(els.regError, STRINGS.emptyFields, true);

  try {
    await api("/api/register", { method: "POST", body: { username, firstName, lastName, phone, password } });
    els.registerForm.reset();
    setMessage(els.regError, STRINGS.pendingSent, false);
  } catch (error) {
    setMessage(els.regError, error.message, true);
  }
}

function switchModal(target) {
  hideModal(target === "login" ? els.registerModal : els.authModal);
  showModal(target === "login" ? els.authModal : els.registerModal);
}

function renderActions() {
  const actions = state.isAdmin
    ? [
        ["adminRegister", "რეგისტრაცია"],
        ["adminStats", "კურიერის სტატისტიკა"],
        ["adminMap", "ადმინის რუკა"],
        ["adminUsers", "კურიერი"],
        ["zoneManagement", "ზონები"],
        ["adminFinance", "ფინანსები"],
        ["addParcel", "პინის დამატება"],
        ["adminCloseDay", "დღის დახურვა"],
        ["parcelHistory", "ამანათის ისტორია"],
        ["logout", "გასვლა"],
      ]
    : [
        ["courierParcels", "ჩემი ამანათები"],
        ["today", "ჩემი დღე"],
        ["courierFinance", "ქეში"],
        ["history", "ისტორია"],
        ["logout", "გასვლა"],
      ];

  els.actionPanel.innerHTML = actions.map(([action, label]) => `
    <button class="action-item" type="button" data-action="${action}">
      <span>${escapeHtml(label)}</span>
    </button>
  `).join("");
}

function toggleActions() {
  const isOpen = els.actionPanel.classList.toggle("show");
  if (isOpen) collapseDeliveredPinLabels();
  els.menuButton.setAttribute("aria-expanded", String(isOpen));
}

function closeActions() {
  els.actionPanel.classList.remove("show");
  els.menuButton.setAttribute("aria-expanded", "false");
}

async function handleAction(action, value, sourceElement) {
  closeActions();

  const handlers = {
    pending: openPendingRequests,
    adminRegister: openAdminRegisterDialog,
    adminStats: openAdminStatsUsers,
    adminMap: openAdminMap,
    adminUsers: openUserManagement,
    zoneManagement: openZoneManagement,
    adminFinance: openFinanceDashboard,
    addParcel: openAdminAddParcel,
    adminCloseDay: openAdminCloseDay,
    parcelHistory: openParcelHistorySearch,
    analytics: openAnalyticsPicker,
    changePassword: openPasswordDialog,
    route: openCourierRoute,
    courierParcels: openCourierParcels,
    nearestParcel: openNearestParcel,
    courierRoute: openCourierRoute,
    courierStatusPanel: openCourierStatusPanel,
    today: openTodayStats,
    history: () => openCalendar(state.currentUser, "ჩემი ისტორია"),
    courierFinance: () => openFinanceCourier(state.currentUser),
    endDay: confirmEndDay,
    approve: () => approveCourier(value),
    reject: () => rejectCourier(value),
    chooseCourier: () => openAddressSearchDialog(value),
    openCourierAnalytics: () => openCalendar(value, `${value} ანალიტიკა`),
    adminStatsUser: () => openCourierStatsProfile(value),
    adminStatsDay: () => openAdminUserDay(value),
    adminStatsHistory: () => openCalendar(value, `${value} ისტორია`),
    editUser: () => openUserEditDialog(value),
    deleteUser: () => confirmUserDelete(value),
    saveCourierZone: () => saveCourierZone(value),
    removeCourierZone: () => removeCourierZone(value),
    adjustCourierCash: () => openCashAdjustmentDialog(value),
    saveCashAdjustment: () => saveCashAdjustment(value),
    resetCashAdjustment: () => resetCashAdjustment(value),
    openFinanceCourier: () => openFinanceCourier(value),
    openFinanceCash: openFinanceCash,
    openFinanceAdmin: openFinanceAdmin,
    adjustCourierPay: () => openPayAdjustmentDialog(value),
    savePayAdjustment: () => savePayAdjustment(value),
    resetPayAdjustment: () => resetPayAdjustment(value),
    assignSelectedPins: assignSelectedPins,
    showAllAdminPins,
    hideAllAdminPins,
    showUnassignedAdminPins,
    parcelHistorySearch: searchParcelHistory,
    focusHistoryParcel: () => focusHistoryParcelOnMap(value),
    focusStatsParcel: () => focusStatsParcelOnMap(value),
    focusAdminPin: () => focusPinById(value),
    focusSelectedParcel,
    routeSelectedParcel,
    clearSelectedRoute: clearActiveRoute,
    toggleSelectedParcelCard,
    setStatus: () => updatePinStatus(value, sourceElement.dataset.status),
    logout,
  };

  try {
    await handlers[action]?.();
  } catch (error) {
    showToast(error.message || STRINGS.serverFailed);
  }
}

async function getCouriers() {
  return applyLocalZoneAssignments((await api("/api/couriers")).couriers);
}

async function getUsers() {
  return applyLocalZoneAssignments((await api("/api/users")).users);
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

async function refreshPins() {
  const selectedPinId = state.selectedPinId;
  clearAdminMapPins();
  state.activePins = [];

  if (!state.currentUser || !state.map) {
    hideSelectedParcelCard();
    await renderCourierStatsCard([]);
    return;
  }

  const pins = await getPins(state.isAdmin ? "" : state.currentUser);
  pins.forEach((pin) => {
    const cachedAddress = getCachedParcelAddress(pin.id);
    const storedAddress = getStoredParcelAddress(pin);
    if (!storedAddress && cachedAddress) pin.address = cachedAddress;
    if (storedAddress) state.parcelAddressCache[pin.id] = storedAddress;
  });
  state.activePins = pins;
  const visiblePins = state.isAdmin ? filterPinsForAdminMap(pins) : pins;
  renderParcelMarkers(visiblePins);
  hydratePinAddresses(pins);
  await renderCourierStatsCard(pins);
  if (state.routePinId && !pins.some((pin) => pin.id === state.routePinId)) clearActiveRoute();
  clearHistoryPreviewMarker();

  if (selectedPinId && visiblePins.some((pin) => pin.id === selectedPinId)) {
    renderSelectedParcelCard();
  } else {
    hideSelectedParcelCard();
  }
}

function renderParcelMarkers(pins) {
  pins.forEach((pin) => {
    const marker = createCircleMarker(pin, {
      radius: 10,
      fillColor: getStatusColor(pin.status),
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9,
    });

    addParcelOverlay(marker);
    marker.on("click", (event) => {
      event.originalEvent?.stopPropagation?.();
      stopMapClick(event);
      console.log("PIN CLICK:", pin.id, pin.status);
      openParcelTab(pin.id, { focus: true });
    });
    renderPinLabel(pin);
  });
}

function renderPinLabel(pin) {
  if (!shouldShowPinLabel(pin)) return;

  const payment = getPaymentAmount(pin);
  const address = getParcelAddress(pin);
  const courier = parcelCourierDisplayName(pin);
  const courierPhone = parcelCourierPhone(pin);
  const zone = parcelZoneLabel(pin);
  addParcelOverlay(new HtmlMapLabel(pin, `
        <div class="pin-label-card pin-label-status-${escapeAttr(pin.status)}">
          <strong class="pin-label-address">${escapeHtml(address)}</strong>
          <span class="pin-label-name">${escapeHtml(pin.fullName)}</span>
          ${state.isAdmin ? `<span class="pin-label-name">${escapeHtml(courier)} / ${escapeHtml(getStatusLabel(pin.status))}</span>` : ""}
          ${state.isAdmin ? `<span class="pin-label-name">${escapeHtml(zone)}${pin.autoAssigned ? " / autoAssigned" : ""}</span>` : ""}
          ${state.isAdmin && courierPhone ? `<span class="pin-label-name">${escapeHtml(courierPhone)}</span>` : ""}
          ${payment > 0 ? `<span class="pin-label-payment">${escapeHtml(formatPinMoney(payment))}</span>` : ""}
        </div>
      `));
}

function shouldShowPinLabel(pin) {
  return pin.status !== "delivered";
}

function isPinLabelExpanded(pinId) {
  if (!pinId) return false;
  if (Array.isArray(state.expandedPinLabels)) {
    return state.expandedPinLabels.includes(pinId);
  }
  if (state.expandedPinLabels?.has) {
    return state.expandedPinLabels.has(pinId);
  }
  return false;
}

function expandPinLabel(pinId) {
  if (!pinId) return;
  if (!Array.isArray(state.expandedPinLabels)) state.expandedPinLabels = [];

  if (!state.expandedPinLabels.includes(pinId)) {
    state.expandedPinLabels.push(pinId);
  }

  rerenderCurrentMapPins();
}

function collapsePinLabel(pinId) {
  if (!pinId) {
    state.expandedPinLabels = [];
    return;
  }
  state.expandedPinLabels = (state.expandedPinLabels || []).filter((id) => id !== pinId);
}

function collapseDeliveredPinLabels() {
  const hasOpen = Array.isArray(state.expandedPinLabels)
    ? state.expandedPinLabels.length > 0
    : state.expandedPinLabels?.size > 0;

  if (!hasOpen) return;

  if (Array.isArray(state.expandedPinLabels)) {
    state.expandedPinLabels = [];
  } else if (state.expandedPinLabels?.clear) {
    state.expandedPinLabels.clear();
  }

  rerenderCurrentMapPins();
}

function rerenderCurrentMapPins() {
  if (!state.map) return;
  clearAdminMapPins();
  const visiblePins = state.isAdmin ? filterPinsForAdminMap(state.activePins) : state.activePins;
  renderParcelMarkers(visiblePins);
}

async function renderCourierStatsCard(pins = state.activePins) {
  if (state.isAdmin || !state.currentUser) {
    els.courierStatsCard.hidden = true;
    els.courierStatsCard.textContent = "";
    return;
  }

  const username = state.currentUser;
  const pending = pins.filter((pin) => pin.status === "pending").length;
  const deliveredPins = pins.filter((pin) => pin.status === "delivered");
  const failed = pins.filter((pin) => pin.status === "failed").length;
  if (username !== state.currentUser) return;
  els.courierStatsCard.hidden = false;
  els.courierStatsCard.innerHTML = `
    <div><span>დარჩენილი</span><strong>${pending}</strong></div>
    <div><span>ჩაბარდა</span><strong>${deliveredPins.length}</strong></div>
    <div><span>არ ჩაბარდა</span><strong>${failed}</strong></div>
  `;
}

function createCircleMarker(coords, options) {
  return L.circleMarker(toLeafletLatLng(coords), {
    interactive: true,
    radius: options.radius || 10,
    fillColor: options.fillColor,
    fillOpacity: options.fillOpacity ?? 1,
    color: options.color || "#fff",
    weight: options.weight || 2,
  }).addTo(state.map);
}

function createHtmlMapLabelClass() {
  return class {
    constructor(coords, html) {
      this.marker = L.marker(toLeafletLatLng(coords), {
        interactive: true,
        icon: L.divIcon({
          className: "pin-label-icon",
          html,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      }).addTo(state.map);

      this.marker.on("click", (event) => {
        stopMapClick(event);
        if (coords?.id) openParcelTab(coords.id);
      });
    }

    remove() {
      this.marker.remove();
    }
  };
}

function addParcelOverlay(overlay) {
  state.markers.push(overlay);
  return overlay;
}

function clearParcelOverlays() {
  (state.markers || []).forEach(clearMapObject);
  state.markers = [];
}

function clearAdminMapPins() {
  clearParcelOverlays();
}

function clearMapObject(mapObject) {
  if (mapObject?.remove) mapObject.remove();
}

function clearActiveRoute() {
  clearMapObject(state.routeLayer);
  state.routeLayer = null;
  state.routePinId = null;
  if (state.selectedPinId) renderSelectedParcelCard();
}

function stopMapClick(event) {
  if (event?.originalEvent && window.L?.DomEvent) {
    L.DomEvent.stopPropagation(event.originalEvent);
  }
}

function setMapView(coords, zoom) {
  if (!state.map) return;
  state.map.setView(toLeafletLatLng(coords), Number.isFinite(Number(zoom)) ? Number(zoom) : getMapZoom());
}

function getMapZoom() {
  return Number(state.map?.getZoom()) || 14;
}

function toLeafletLatLng(coords) {
  return [Number(coords.lat), Number(coords.lng)];
}

function toCoords(latLng) {
  return { lat: Number(latLng.lat), lng: Number(latLng.lng) };
}

function isWithinTbilisiBounds(coords) {
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  return lat >= 41.55 && lat <= 41.88 && lng >= 44.60 && lng <= 45.05;
}

function formatCoordsAddress(coords) {
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function normalizeAddressToken(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[.,;:"'()]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|lane|ln|drive|dr)\b/gi, " ")
    .replace(/\b(ქუჩა|ქ|გამზირი|გამზ|ჩიხი|შესახვევი|გზატკეცილი)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHouseNumber(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/^(#|№|n|no\.?)\s*/i, "")
    .replace(/\s+/g, "")
    .trim();
}

function getTbilisiViewbox() {
  return "44.60,41.88,45.05,41.55";
}

function buildOsmUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

function buildApiUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

function buildGoogleMapsRouteUrl(origin, destination) {
  return buildUrl("https://www.google.com/maps/dir/", {
    api: 1,
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: "driving",
  }).toString();
}

async function fetchOsmJson(path, params) {
  const proxyPath = path === "/search" || path === "/reverse" ? `/api/geocode${path}` : "";
  const headers = {
    Accept: "application/json",
    ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
  };
  if (!proxyPath) return null;
  const requestUrl = buildApiUrl(proxyPath, params);
  const response = await fetch(requestUrl, {
    headers,
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const data = await response.json();
  return data;
}

async function fetchOverpassJson(query) {
  const response = await fetch(buildUrl("https://overpass-api.de/api/interpreter", { data: query }), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("OpenStreetMap-ის ძებნის სერვერმა შეცდომა დააბრუნა.");
  return response.json();
}

async function fetchRouteLatLngs(origin, destination) {
  const path = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const data = await fetch(buildUrl(`https://router.project-osrm.org/route/v1/driving/${path}`, {
    overview: "full",
    geometries: "geojson",
  }), { headers: { Accept: "application/json" } }).then((response) => {
    if (!response.ok) throw new Error("Route request failed.");
    return response.json();
  });
  const coordinates = data?.routes?.[0]?.geometry?.coordinates || [];
  return coordinates.map(([lng, lat]) => [lat, lng]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatOsmAddress(result, fallback = "") {
  const address = result?.address || {};
  if (result && typeof result === "object") result._addressWarning = "";
  const streetName = address.road
    || address.pedestrian
    || address.footway
    || address.residential
    || address.cycleway
    || address.path
    || address.service
    || address.neighbourhood
    || address.suburb
    || address.quarter
    || "";
  const houseNumber = address.house_number || "";
  if (streetName && houseNumber) return cleanAddressInput(`${streetName} ${houseNumber}`);
  if (streetName) {
    if (result && typeof result === "object") result._addressWarning = "შენობის ნომერი ვერ მოიძებნა, ნაჩვენებია ქუჩა.";
    return cleanAddressInput(streetName);
  }

  const displayAddress = cleanAddressInput(result?.display_name || "");
  if (displayAddress) return displayAddress;

  const fallbackAddress = cleanAddressInput(fallback);
  if (fallbackAddress) return fallbackAddress;
  return "";
}

function isTbilisiOsmResult(result) {
  if (!isWithinTbilisiBounds(getResultCoords(result))) return false;
  const address = result?.address || {};
  const locationParts = [address.city, address.town, address.municipality, address.county, address.state, result?.display_name].filter(Boolean);
  if (!locationParts.length) return true;
  return locationParts.some((value) => /tbilisi|თბილისი/i.test(String(value)));
}

function getResultCoords(result) {
  return {
    lat: Number(result?.lat ?? result?.latitude),
    lng: Number(result?.lng ?? result?.lon ?? result?.longitude),
  };
}

function setMarkerPosition(marker, coords) {
  marker?.setLatLng?.(toLeafletLatLng(coords));
}

function getStatusColor(status) {
  if (status === "delivered") return "#217346";
  if (status === "failed") return "#a83d32";
  return "#6b7c8d";
}

async function openPendingRequests() {
  const pending = await getPending();
  const body = pending.length
    ? pending.map((request) => `
        <div class="parcel-row">
          <strong>${escapeHtml(request.username)}</strong>
          <span>მოთხოვნის დრო: ${formatDateTime(request.requestedAt)}</span>
          <div class="row-actions">
            <button class="button" type="button" data-action="approve" data-value="${escapeAttr(request.username)}">დადასტურება</button>
            <button class="button danger" type="button" data-action="reject" data-value="${escapeAttr(request.username)}">უარყოფა</button>
          </div>
        </div>
      `).join("")
    : `<p>${STRINGS.noPending}</p>`;

  showDialog("რეგისტრაციის მოთხოვნები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}

async function approveCourier(username) {
  await api(`/api/pending/${encodeURIComponent(username)}`, { method: "POST" });
  await openPendingRequests();
}

async function rejectCourier(username) {
  await api(`/api/pending/${encodeURIComponent(username)}`, { method: "DELETE" });
  await openPendingRequests();
}

async function openCourierPicker() {
  const users = await getCouriers();
  const body = users.length
    ? users.map((user) => `<button class="list-button" type="button" data-action="chooseCourier" data-value="${escapeAttr(user.username)}">${escapeHtml(user.username)}</button>`).join("")
    : `<p>${STRINGS.noCouriers}</p>`;

  showDialog("კურიერის არჩევა", body, [{ label: "გაუქმება", variant: "secondary", action: closeDialog }]);
}

async function openAnalyticsPicker() {
  const users = await getCouriers();
  const body = users.length
    ? users.map((user) => `<button class="list-button" type="button" data-action="openCourierAnalytics" data-value="${escapeAttr(user.username)}">${escapeHtml(user.username)}</button>`).join("")
    : `<p>${STRINGS.noCouriers}</p>`;

  showDialog("კურიერის ანალიტიკა", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}

async function openPasswordDialog() {
  const users = await getCouriers();
  const options = users.map((user) => `<option value="${escapeAttr(user.username)}">${escapeHtml(user.username)}</option>`).join("");
  const body = users.length
    ? `<label for="passwordUser">კურიერი</label>
       <select id="passwordUser">${options}</select>
       <label for="newPassword">ახალი პაროლი</label>
       <input id="newPassword" type="password" autocomplete="new-password">`
    : `<p>${STRINGS.noCouriers}</p>`;

  const actions = users.length
    ? [
        { label: "შენახვა", variant: "primary", action: savePasswordChange },
        { label: "გაუქმება", variant: "secondary", action: closeDialog },
      ]
    : [{ label: "დახურვა", variant: "secondary", action: closeDialog }];

  showDialog("პაროლის შეცვლა", body, actions);
}

async function savePasswordChange() {
  const username = document.getElementById("passwordUser")?.value;
  const password = document.getElementById("newPassword")?.value.trim();
  if (!username || !password) return;

  await api(`/api/couriers/${encodeURIComponent(username)}/password`, { method: "PUT", body: { password } });
  closeDialog();
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

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function getDefaultTbilisiZones() {
  return [
    {
      id: "dighomi",
      code: "dighomi",
      name: "დიღმის ზონა",
      areas: ["დიდი დიღომი", "დიღმის მასივი", "სოფელი დიღომი", "დიღომი"],
      polygon: [
        [41.732, 44.690],
        [41.817, 44.700],
        [41.822, 44.786],
        [41.774, 44.804],
        [41.730, 44.780],
      ],
    },
    {
      id: "north",
      code: "north",
      name: "ჩრდილოეთის ზონა",
      areas: ["გლდანი", "მუხიანი", "თემქა", "ავჭალა", "ზღვისუბანი"],
      polygon: [
        [41.760, 44.790],
        [41.865, 44.765],
        [41.870, 44.930],
        [41.770, 44.930],
        [41.742, 44.850],
      ],
    },
    {
      id: "east",
      code: "east",
      name: "აღმოსავლეთის ზონა",
      areas: ["ისანი", "სამგორი", "ვარკეთილი", "ვაზისუბანი", "ლილო", "ორხევი", "აეროპორტის დასახლება", "ფონიჭალა"],
      polygon: [
        [41.612, 44.812],
        [41.725, 44.835],
        [41.773, 45.070],
        [41.640, 45.095],
        [41.575, 44.930],
      ],
    },
    {
      id: "center",
      code: "center",
      name: "ცენტრალური ზონა",
      areas: ["ვაკე", "საბურთალო", "ვერა", "მთაწმინდა", "სოლოლაკი", "ავლაბარი", "ორთაჭალა", "კრწანისი", "ბაგები", "წყნეთი", "კოჯორი"],
      polygon: [
        [41.612, 44.635],
        [41.732, 44.650],
        [41.742, 44.835],
        [41.680, 44.875],
        [41.585, 44.785],
      ],
    },
    {
      id: "west_south",
      code: "west_south",
      name: "დასავლეთ-სამხრეთის ზონა",
      areas: ["დიდუბე", "ნაძალადევი", "კუკია", "ჩუღურეთი"],
      polygon: [
        [41.700, 44.760],
        [41.770, 44.760],
        [41.772, 44.840],
        [41.710, 44.858],
        [41.682, 44.805],
      ],
    },
  ];
}

function normalizeZoneId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeZones(zones = []) {
  const merged = new Map();
  DEFAULT_ZONES.forEach((zone) => merged.set(getZoneId(zone), normalizeZone(zone)));
  (Array.isArray(zones) ? zones : []).forEach((zone) => {
    const normalized = normalizeZone(zone);
    const existing = merged.get(normalized.id) || {};
    if (normalized.id) {
      merged.set(normalized.id, {
        ...existing,
        ...normalized,
        areas: normalized.areas.length ? normalized.areas : (existing.areas || []),
        keywords: Array.isArray(normalized.keywords) && normalized.keywords.length ? normalized.keywords : (existing.keywords || []),
      });
    }
  });
  return [...merged.values()];
}

function normalizeZone(zone = {}) {
  const id = normalizeZoneId(zone.id || zone.code || zone.zoneId || zone.slug || zone.name);
  return {
    ...zone,
    id,
    code: zone.code || id,
    name: zone.name || zone.label || zone.zoneName || id,
    areas: getZoneAreas(zone),
  };
}

function getZoneId(zone) {
  return normalizeZoneId(zone?.id || zone?.code || zone?.zoneId || zone?.slug || zone?.name);
}

function getZoneName(zone) {
  return zone?.name || zone?.label || zone?.zoneName || zone?.id || "";
}

function getZoneAreas(zone) {
  const areas = zone?.areas || zone?.districts || zone?.neighborhoods || zone?.includes || [];
  return Array.isArray(areas) ? areas.filter(Boolean) : [];
}

function getZoneById(zoneId, zones) {
  const normalizedZoneId = normalizeZoneId(zoneId);
  return (zones || []).find((zone) => getZoneId(zone) === normalizedZoneId) || null;
}

function getCourierZoneId(courier, zones = []) {
  const directZoneId = normalizeZoneId(courier?.zoneId || courier?.zoneCode || courier?.zone);
  if (directZoneId) return directZoneId;
  const zoneName = normalizeZoneText(courier?.zoneName || "");
  const zone = (zones || []).find((item) => normalizeZoneText(getZoneName(item)) === zoneName);
  return zone ? getZoneId(zone) : "";
}

function normalizeZoneText(value) {
  return String(value || "").trim().toLowerCase();
}

function readLocalZoneAssignments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG.zoneAssignmentsStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalZoneAssignments(assignments) {
  localStorage.setItem(CONFIG.zoneAssignmentsStorageKey, JSON.stringify(assignments || {}));
}

function applyLocalZoneAssignments(users = []) {
  const assignments = readLocalZoneAssignments();
  return (Array.isArray(users) ? users : []).map((user) => {
    const assignment = assignments[normalizeUsername(user.username)];
    if (!assignment || user.role !== "courier") return user;
    return {
      ...user,
      zoneId: assignment.zoneId || "",
      zoneName: assignment.zoneName || "",
    };
  });
}

function saveLocalCourierZone(username, zoneBody) {
  const assignments = readLocalZoneAssignments();
  const key = normalizeUsername(username);
  if (zoneBody.zoneId) {
    assignments[key] = {
      username,
      zoneId: zoneBody.zoneId,
      zoneName: zoneBody.zoneName || getZoneName(getZoneById(zoneBody.zoneId, DEFAULT_ZONES)),
    };
  } else {
    delete assignments[key];
  }
  writeLocalZoneAssignments(assignments);
  return { user: { username, role: "courier", ...zoneBody } };
}

function readCashAdjustments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG.cashAdjustmentsStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCashAdjustments(adjustments) {
  localStorage.setItem(CONFIG.cashAdjustmentsStorageKey, JSON.stringify(Array.isArray(adjustments) ? adjustments : []));
}

function getCashAdjustmentsForCourier(username) {
  const normalizedUsername = normalizeUsername(username);
  return readCashAdjustments().filter((item) => normalizeUsername(item.username) === normalizedUsername);
}

function getCashAdjustmentsForDate(dateKey) {
  return readCashAdjustments().filter((item) => (item.dateKey || toDateKey(new Date(item.createdAt))) === dateKey);
}

function getCashAdjustmentsForMonth(monthKey) {
  return readCashAdjustments().filter((item) => (item.dateKey || toDateKey(new Date(item.createdAt))).startsWith(monthKey));
}

function sumCashAdjustments(adjustments) {
  return (Array.isArray(adjustments) ? adjustments : []).reduce((total, item) => total + Number(item.delta || 0), 0);
}

function getCourierOutstandingCash(username, allRecords) {
  const normalizedUsername = normalizeUsername(username);
  const courierDeliveredRecords = (Array.isArray(allRecords) ? allRecords : []).filter((parcel) => (
    normalizeUsername(parcel.courierUsername) === normalizedUsername
    && parcel.status === "delivered"
  ));
  const collectedCash = sumPayments(courierDeliveredRecords);
  const adjustments = readCashAdjustments().filter((item) => normalizeUsername(item.username) === normalizedUsername);
  const adjustedCash = sumCashAdjustments(adjustments);
  return collectedCash + adjustedCash;
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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePayAdjustments(adjustments) {
  localStorage.setItem(CONFIG.payAdjustmentsStorageKey, JSON.stringify(Array.isArray(adjustments) ? adjustments : []));
}

function getPayAdjustmentsForCourier(username) {
  const normalizedUsername = normalizeUsername(username);
  return readPayAdjustments().filter((item) => normalizeUsername(item.username) === normalizedUsername);
}

function getPayAdjustmentsForDate(dateKey) {
  return readPayAdjustments().filter((item) => (item.dateKey || toDateKey(new Date(item.createdAt))) === dateKey);
}

function sumPayAdjustments(adjustments) {
  return (Array.isArray(adjustments) ? adjustments : []).reduce((total, item) => total + Number(item.delta || 0), 0);
}

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
  const startKey = isDateKey(start) ? start : today;
  const endKey = isDateKey(end) ? end : startKey;
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
        <input id="${escapeAttr(startId)}" type="date" value="${escapeAttr(start)}" aria-label="საწყისი თარიღი">
      </label>
      <label>
        <span>დასრულების თარიღი</span>
        <input id="${escapeAttr(endId)}" type="date" value="${escapeAttr(end)}" aria-label="დასრულების თარიღი">
      </label>
      <button class="mini-button" type="button" ${applySelector}>ნახვა</button>
    </div>
  `;
}

function bindDateRangeToolbar({ startId, endId, applySelector, onApply }) {
  document.querySelector(applySelector)?.addEventListener("click", async () => {
    const range = normalizeDateRange(
      document.getElementById(startId)?.value,
      document.getElementById(endId)?.value,
    );
    await onApply(range);
  });
}

function parcelMatchesStatsDateRange(parcel, start, end) {
  return getParcelStatsDateKeys(parcel).some((dateKey) => dateKey && dateKey >= start && dateKey <= end);
}

function adjustmentMatchesDateRange(adjustment, start, end) {
  const adjustmentStart = adjustment.startDate || adjustment.dateKey || toDateKey(new Date(adjustment.createdAt));
  const adjustmentEnd = adjustment.endDate || adjustmentStart;
  return adjustmentStart <= end && adjustmentEnd >= start;
}

function getCashAdjustmentsForRange(start, end) {
  return readCashAdjustments().filter((item) => adjustmentMatchesDateRange(item, start, end));
}

function getPayAdjustmentsForRange(start, end) {
  return readPayAdjustments().filter((item) => adjustmentMatchesDateRange(item, start, end));
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

function parcelFailureReason(parcel) {
  return parcel?.failureReason || parcel?.failedReason || parcel?.failReason || parcel?.reason || "";
}

function parcelAssignedDate(parcel) {
  if (!parcel?.courierUsername) return "";
  return parcel.assignedAt || parcel.createdAt || "";
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

function openAdminRegisterDialog() {
  const body = `
    <label for="adminRegUsername">ლოგინი</label>
    <input id="adminRegUsername" type="text" autocomplete="username">
    <label for="adminRegPassword">პაროლი</label>
    <input id="adminRegPassword" type="password" autocomplete="new-password">
    ${userProfileFields()}
    <label for="adminRegRole">ფუნქცია</label>
    <select id="adminRegRole">
      <option value="courier">კურიერი</option>
      <option value="admin">ადმინი</option>
    </select>
    <p class="form-message" id="adminRegMessage" role="alert"></p>
  `;
  showDialog("რეგისტრაცია", body, [
    { label: "შენახვა", variant: "primary", action: saveAdminRegistration },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}

async function saveAdminRegistration() {
  const username = document.getElementById("adminRegUsername")?.value.trim();
  const password = document.getElementById("adminRegPassword")?.value.trim();
  const role = document.getElementById("adminRegRole")?.value;
  const message = document.getElementById("adminRegMessage");
  if (!username || !password || !role) {
    if (message) message.textContent = STRINGS.emptyFields;
    return;
  }

  try {
    await api("/api/users", { method: "POST", body: { username, password, role, ...readUserProfileFields() } });
    closeDialog();
    showToast("ანგარიში შენახულია.");
    await refreshPins();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

async function openAdminStatsUsers() {
  try {
    const users = (await getUsers()).filter((user) => user.role === "courier");
    const cards = await Promise.all(users.map(renderCourierStatsUserCard));
    const body = users.length
      ? `<div class="finance-card-list courier-stats-user-list">${cards.join("")}</div>`
      : `<div class="history-empty history-empty-card">კურიერი ჯერ არ არის დამატებული</div>`;
    showDialog("კურიერის სტატისტიკა", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
    els.dialogModal.classList.add("courier-stats-dialog");
  } catch {
    showDialog("კურიერის სტატისტიკა", `<div class="history-empty history-empty-card">კურიერის სტატისტიკის ჩატვირთვა ვერ მოხერხდა</div>`, [
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
  }
}

function openAdminStatsChoice(username) {
  return openCourierStatsProfile(username);
}

async function openAdminUserDay(username) {
  return openCourierStatsProfile(username);
}

async function renderCourierStatsUserCard(user) {
  const [parcels, history] = await Promise.all([getPins(user.username), getHistory(user.username)]);
  const todayKey = toDateKey(new Date());
  const todayOrders = [...parcels, ...history].filter((parcel) => parcelMatchesStatsDate(parcel, todayKey));
  const activeCount = parcels.length;
  const deliveredToday = todayOrders.filter((parcel) => parcel.status === "delivered").length;
  const earnedToday = sumCourierPay(todayOrders);
  return `
    <button class="finance-card finance-static-card courier-stats-user-card" type="button" data-action="adminStatsUser" data-value="${escapeAttr(user.username)}">
      <span class="courier-stats-user-name">${escapeHtml(userDisplayName(user))}</span>
      <small>username: ${escapeHtml(user.username)}</small>
      <div class="courier-stats-user-metrics">
        <span><b>${deliveredToday}</b> დღეს ჩაბარდა</span>
        <span><b>${escapeHtml(formatMoney(earnedToday))}</b> დღევანდელი გამომუშავება</span>
        <span><b>${activeCount}</b> აქტიური</span>
      </div>
    </button>
  `;
}

async function openCourierStatsProfile(username) {
  try {
    const [users, parcels, history] = await Promise.all([getUsers(), getPins(username), getHistory(username)]);
    const user = users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (!user) return;
    const range = getCourierStatsRange();
    state.courierStats = {
      username,
      user,
      parcels,
      history,
      records: [...parcels, ...history],
      selectedDate: range.start,
      rangeStart: range.start,
      rangeEnd: range.end,
      filter: state.courierStats.filter || "all",
    };
    await renderCourierStatsProfileDialog();
  } catch {
    showDialog("კურიერის სტატისტიკა", `<div class="history-empty history-empty-card">კურიერის სტატისტიკის ჩატვირთვა ვერ მოხერხდა</div>`, [
      { label: "უკან", variant: "secondary", action: openAdminStatsUsers },
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
  }
}

async function renderCourierStatsProfileDialog() {
  const { user, parcels, history, records, filter } = state.courierStats;
  const range = getCourierStatsRange();
  const rangeOrders = records.filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const filteredOrders = filterCourierStatsOrders(rangeOrders, filter);
  const body = `
    <div class="courier-stats-profile-panel">
      ${renderCourierProfile(user)}
      ${renderDateRangeToolbar({
        startId: "courierStatsStartDate",
        endId: "courierStatsEndDate",
        start: range.start,
        end: range.end,
        applySelector: "data-courier-stats-range-apply",
        className: "finance-range-toolbar",
      })}
      ${renderCourierStatsSummary(parcels, history, range.start, range.end)}
      <div class="courier-stats-order-toolbar">
        <strong>${escapeHtml(formatDateRangeLabel(range.start, range.end))}</strong>
        <select id="courierStatsOrderFilter" aria-label="შეკვეთების ფილტრი">
          <option value="all" ${filter === "all" ? "selected" : ""}>ყველა შეკვეთა</option>
          <option value="delivered" ${filter === "delivered" ? "selected" : ""}>ჩაბარებული</option>
          <option value="failed" ${filter === "failed" ? "selected" : ""}>არ ჩაბარებული</option>
          <option value="pending" ${filter === "pending" ? "selected" : ""}>პროცესში</option>
          <option value="paid" ${filter === "paid" ? "selected" : ""}>მხოლოდ თანხიანი</option>
        </select>
      </div>
      <div id="courierStatsOrders">${await renderCourierDayOrders(filteredOrders)}</div>
    </div>
  `;
  showDialog(`${userDisplayName(user)} სტატისტიკა`, body, [
    { label: "უკან", variant: "secondary", action: openAdminStatsUsers },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  els.dialogModal.classList.add("courier-stats-dialog");
  bindCourierStatsProfileEvents();
}

function bindCourierStatsProfileEvents() {
  document.getElementById("courierStatsOrderFilter")?.addEventListener("change", async (event) => {
    state.courierStats.filter = event.target.value || "all";
    const range = getCourierStatsRange();
    const rangeOrders = state.courierStats.records.filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
    const filteredOrders = filterCourierStatsOrders(rangeOrders, state.courierStats.filter);
    const target = document.getElementById("courierStatsOrders");
    if (target) target.innerHTML = await renderCourierDayOrders(filteredOrders);
  });
  bindDateRangeToolbar({
    startId: "courierStatsStartDate",
    endId: "courierStatsEndDate",
    applySelector: "[data-courier-stats-range-apply]",
    onApply: async (range) => {
      setCourierStatsRange(range.start, range.end);
      await renderCourierStatsProfileDialog();
    },
  });
  document.querySelectorAll("[data-courier-stats-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      setCourierStatsRange(button.dataset.courierStatsDate, button.dataset.courierStatsDate);
      await renderCourierStatsProfileDialog();
    });
  });
}

function renderCourierProfile(user) {
  const activeCount = state.courierStats.parcels.length;
  return `
    <section class="courier-profile-card">
      <div class="courier-profile-title">
        <strong>${escapeHtml(userDisplayName(user))}</strong>
        <span>${escapeHtml(roleLabel(user.role))}</span>
      </div>
      <div class="courier-profile-grid">
        ${statsDetail("სახელი", user.firstName || "არ არის")}
        ${statsDetail("გვარი", user.lastName || "არ არის")}
        ${statsDetail("ლოგინი", user.username)}
        ${statsDetail("ტელეფონი", user.phone || "არ არის")}
        ${statsDetail("როლი", roleLabel(user.role))}
        ${statsDetail("ზონა", user.zoneName || "მიუბმელი")}
        ${statsDetail("აქტიური ამანათები", String(activeCount))}
        ${user.bankDetails ? statsDetail("საბანკო რეკვიზიტები", user.bankDetails) : ""}
      </div>
    </section>
  `;
}

function renderCourierStatsSummary(parcels, history, rangeStart, rangeEnd) {
  const records = [...parcels, ...history];
  const selectedOrders = records.filter((parcel) => parcelMatchesStatsDateRange(parcel, rangeStart, rangeEnd));
  const todayOrders = records.filter((parcel) => parcelMatchesStatsDate(parcel, toDateKey(new Date())));
  const delivered = selectedOrders.filter((parcel) => parcel.status === "delivered").length;
  const failed = selectedOrders.filter((parcel) => parcel.status === "failed").length;
  const pending = selectedOrders.filter((parcel) => parcel.status === "pending").length;
  const outstandingCash = getCourierOutstandingCash(state.courierStats.user?.username || state.courierStats.username, records);
  const courierPay = sumCourierPay(selectedOrders);
  return `
    <section class="courier-stats-summary">
      <div class="courier-stats-summary-item"><span>დღევანდელი გამომუშავება</span><strong>${escapeHtml(formatMoney(sumCourierPay(todayOrders)))}</strong></div>
      <div class="courier-stats-summary-item"><span>სულ ისტორია</span><strong>${history.length} ჩანაწერი</strong></div>
      <div class="courier-stats-summary-item"><span>არჩეული პერიოდის ჯამი</span><strong>${selectedOrders.length}</strong></div>
      <div class="courier-stats-summary-item"><span>ჩაბარებული</span><strong>${delivered}</strong></div>
      <div class="courier-stats-summary-item"><span>არ ჩაბარებული</span><strong>${failed}</strong></div>
      <div class="courier-stats-summary-item"><span>პროცესში</span><strong>${pending}</strong></div>
      <div class="courier-stats-summary-item"><span>ჩასაბარებელი ქეში</span><strong>${escapeHtml(formatMoney(outstandingCash))}</strong></div>
      <div class="courier-stats-summary-item"><span>კურიერის გამომუშავება</span><strong>${escapeHtml(formatMoney(courierPay))}</strong></div>
    </section>
  `;
}

function renderCourierCalendar(history, selectedDate) {
  const selected = new Date(`${selectedDate}T00:00:00`);
  const year = selected.getFullYear();
  const month = selected.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const activeDays = new Set(history.flatMap(getParcelStatsDateKeys).filter((dateKey) => dateKey?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)));
  const weekdays = ["ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ", "კვი"];
  let grid = weekdays.map((day) => `<div class="calendar-cell weekday">${day}</div>`).join("");
  for (let i = 0; i < offset; i += 1) grid += `<div class="calendar-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    grid += `
      <button class="calendar-cell courier-calendar-day ${dateKey === selectedDate ? "selected" : ""}" type="button" data-courier-stats-date="${dateKey}">
        <span>${day}</span>
        ${activeDays.has(dateKey) ? "<i aria-hidden=\"true\"></i>" : ""}
      </button>
    `;
  }
  return `
    <section class="courier-calendar-panel">
      <div class="calendar-header">
        <button class="calendar-nav-button" type="button" data-courier-stats-date="${toDateKey(new Date(year, month - 1, 1))}" aria-label="წინა თვე">&lt;</button>
        <strong>${escapeHtml(formatMonthYear(selected))}</strong>
        <button class="calendar-nav-button" type="button" data-courier-stats-date="${toDateKey(new Date(year, month + 1, 1))}" aria-label="შემდეგი თვე">&gt;</button>
      </div>
      <div class="calendar-grid">${grid}</div>
    </section>
  `;
}

async function renderCourierDayOrders(orders) {
  if (!orders.length) return `<div class="history-empty history-empty-card">არჩეულ პერიოდში კურიერს შეკვეთები არ ჰქონდა</div>`;
  return `<div class="courier-order-list">${(await Promise.all(orders.map(renderCourierOrderCard))).join("")}</div>`;
}

async function renderCourierOrderCard(parcel) {
  const address = await resolveParcelAddress(parcel);
  const payment = getPaymentAmount(parcel);
  const courierPay = getCourierPay(parcel);
  const failedAt = parcel.failedAt || (parcel.status === "failed" ? parcel.completedAt : "");
  const deliveredAt = parcel.deliveredAt || (parcel.status === "delivered" ? parcel.completedAt : "");
  const failureReason = parcelFailureReason(parcel);
  const canFocusMap = Number.isFinite(Number(parcel.lat)) && Number.isFinite(Number(parcel.lng));
  return `
    <article class="courier-order-card">
      <div class="courier-order-head">
        <div>
          <strong>${escapeHtml(parcel.fullName || "უსახელო მიმღები")}</strong>
          <span>${escapeHtml(parcel.phone || "ტელეფონი არ არის")}</span>
        </div>
        <span class="history-status status-${escapeAttr(parcel.status)}">${escapeHtml(getStatusLabel(parcel.status))}</span>
      </div>
      <div class="courier-order-address">${escapeHtml(address || STRINGS.addressMissing)}</div>
      <div class="courier-order-grid">
        ${statsDetail("მიტანის დრო", formatOptionalDateTime(deliveredAt))}
        ${statsDetail("ვერ ჩაბარდა", formatOptionalDateTime(failedAt))}
        ${statsDetail("ქეში", payment > 0 ? formatMoney(payment) : "არ აქვს")}
        ${statsDetail("კურიერის ანაზღაურება", formatMoney(courierPay))}
        ${statsDetail("ზონა", parcel.zoneName || parcel.zoneId || "არ არის")}
        ${statsDetail("მიბმა", parcel.autoAssigned ? "ავტომატურად" : "ხელით")}
      </div>
      ${parcel.status === "failed" && failureReason ? `<div class="parcel-history-note"><span>მიზეზი</span><strong>${escapeHtml(failureReason)}</strong></div>` : ""}
      ${canFocusMap ? `<button class="mini-button" type="button" data-action="focusStatsParcel" data-value="${escapeAttr(parcel.id)}">რუკაზე ნახვა</button>` : ""}
    </article>
  `;
}

function filterCourierStatsOrders(orders, filter) {
  if (filter === "delivered") return orders.filter((parcel) => parcel.status === "delivered");
  if (filter === "failed") return orders.filter((parcel) => parcel.status === "failed");
  if (filter === "pending") return orders.filter((parcel) => parcel.status === "pending");
  if (filter === "paid") return orders.filter((parcel) => getPaymentAmount(parcel) > 0);
  return orders;
}

function statsDetail(label, value) {
  return `
    <div class="courier-stats-detail">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "არ არის")}</strong>
    </div>
  `;
}

function parcelMatchesStatsDate(parcel, dateKey) {
  return getParcelStatsDateKeys(parcel).includes(dateKey);
}

function parcelMatchesStatsMonth(parcel, monthKey) {
  return getParcelStatsDateKeys(parcel).some((dateKey) => dateKey.startsWith(monthKey));
}

function getParcelStatsDateKeys(parcel) {
  return [parcel.createdAt, parcel.assignedAt, parcel.completedAt, parcel.deliveredAt, parcel.failedAt, parcel.updatedAt, parcel.archivedAt]
    .map((value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "" : toDateKey(date);
    })
    .filter(Boolean);
}

function focusStatsParcelOnMap(parcel) {
  const target = typeof parcel === "string"
    ? state.courierStats.records.find((item) => item.id === parcel)
    : parcel;
  if (!target) return;
  closeDialog();
  const activePin = state.activePins.find((item) => item.id === target.id);
  if (activePin && (!state.isAdmin || filterPinsForAdminMap(state.activePins).some((item) => item.id === activePin.id))) {
    openParcelTab(activePin.id, { focus: true });
    return;
  }
  clearHistoryPreviewMarker();
  setMapView(target, 17);
  if (!state.map || !window.L) return;
  const marker = L.layerGroup().addTo(state.map);
  L.circleMarker(toLeafletLatLng(target), {
    radius: 11,
    fillColor: getStatusColor(target.status),
    fillOpacity: 0.95,
    color: "#fff",
    weight: 2,
  }).addTo(marker);
  L.marker(toLeafletLatLng(target), {
    icon: L.divIcon({
      className: "pin-label-icon",
      html: `<div class="pin-label-card"><strong>${escapeHtml(target.fullName || "")}</strong><span>${escapeHtml(parcelZoneLabel(target))}</span><span>${escapeHtml(getStatusLabel(target.status))}</span></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
  }).addTo(marker);
  state.historyPreviewMarker = marker;
}

async function openAdminMap() {
  await refreshPins();
  state.adminMapCouriers = await getCouriers();
  renderAdminMapPanel();
}

function renderAdminMapPanel() {
  const pins = state.activePins;
  const couriers = state.adminMapCouriers;
  const visiblePins = filterPinsForAdminMap(pins);
  const body = `
    <div class="admin-map-panel">
      ${renderAdminMapSummary(pins, visiblePins)}
      <div class="admin-map-filter-actions">
        <button class="mini-button" type="button" data-action="showAllAdminPins">ყველა</button>
        <button class="mini-button" type="button" data-action="hideAllAdminPins">არცერთი</button>
        <button class="mini-button" type="button" data-action="showUnassignedAdminPins">მიუბმელი</button>
      </div>
      ${renderAdminMapCourierList(couriers, pins)}
    </div>
  `;
  const actions = [{ label: "დახურვა", variant: "secondary", action: closeDialog }];
  showDialog("ადმინის რუკა", body, actions);
  els.dialogModal.classList.add("admin-map-dialog");
  bindAdminMapPanelEvents();
}

function bindAdminMapPanelEvents() {
  document.querySelectorAll("input[name='adminMapCourierFilter']").forEach((input) => {
    input.addEventListener("change", () => {
      const selectedCouriers = [...document.querySelectorAll("input[name='adminMapCourierFilter']:checked")].map((item) => item.value);
      state.adminMapFilters = {
        selectedCouriers,
        showUnassigned: Boolean(document.getElementById("adminMapUnassignedFilter")?.checked),
        mode: selectedCouriers.length || document.getElementById("adminMapUnassignedFilter")?.checked ? "selected" : "none",
      };
      applyAdminMapFilters();
    });
  });
  document.getElementById("adminMapUnassignedFilter")?.addEventListener("change", () => {
    const selectedCouriers = [...document.querySelectorAll("input[name='adminMapCourierFilter']:checked")].map((item) => item.value);
    const showUnassigned = Boolean(document.getElementById("adminMapUnassignedFilter")?.checked);
    state.adminMapFilters = {
      selectedCouriers,
      showUnassigned,
      mode: selectedCouriers.length || showUnassigned ? "selected" : "none",
    };
    applyAdminMapFilters();
  });
}

function applyAdminMapFilters() {
  clearAdminMapPins();
  const visiblePins = filterPinsForAdminMap(state.activePins);
  renderParcelMarkers(visiblePins);
  const summary = document.getElementById("adminMapSummary");
  if (summary) summary.innerHTML = renderAdminMapSummary(state.activePins, visiblePins, true);
  if (state.selectedPinId && !visiblePins.some((pin) => pin.id === state.selectedPinId)) hideSelectedParcelCard();
}

function filterPinsForAdminMap(pins = state.activePins) {
  const { mode, selectedCouriers, showUnassigned } = state.adminMapFilters;
  if (!state.isAdmin) return pins;
  if (mode === "none") return [];
  if (mode === "all") return pins;
  if (mode === "unassigned") return pins.filter((pin) => !pin.courierUsername);
  const selected = new Set((selectedCouriers || []).map(normalizeUsername));
  return pins.filter((pin) => {
    if (!pin.courierUsername) return Boolean(showUnassigned);
    return selected.has(normalizeUsername(pin.courierUsername));
  });
}

function renderAdminMapCourierList(couriers, pins) {
  const filters = state.adminMapFilters;
  const rows = couriers.map((courier) => {
    const stats = getAdminMapCourierStats(courier, pins);
    const checked = filters.mode === "all" || filters.selectedCouriers.some((username) => normalizeUsername(username) === normalizeUsername(courier.username));
    return `
      <label class="admin-map-courier-row">
        <input type="checkbox" name="adminMapCourierFilter" value="${escapeAttr(courier.username)}" ${checked ? "checked" : ""}>
        <span class="admin-map-courier-main">
          <strong>${escapeHtml(userDisplayName(courier))}</strong>
          <small>${escapeHtml(courier.username)}${courier.phone ? ` / ${escapeHtml(courier.phone)}` : ""}</small>
        </span>
        <span class="admin-map-courier-stats">
          <b>${stats.total}</b><small>აქტიური</small>
          <b>${stats.delivered}</b><small>ჩაბარდა</small>
          <b>${stats.failed}</b><small>არ ჩაბარდა</small>
          <b>${stats.pending}</b><small>პროცესში</small>
        </span>
      </label>
    `;
  }).join("");
  const unassignedChecked = filters.mode === "all" || filters.mode === "unassigned" || filters.showUnassigned;
  const unassignedCount = pins.filter((pin) => !pin.courierUsername).length;
  return `
    <div class="admin-map-courier-list">
      <label class="admin-map-courier-row unassigned">
        <input id="adminMapUnassignedFilter" type="checkbox" ${unassignedChecked ? "checked" : ""}>
        <span class="admin-map-courier-main">
          <strong>მიუბმელი პინები</strong>
          <small>courierUsername არ აქვს</small>
        </span>
        <span class="admin-map-courier-stats">
          <b>${unassignedCount}</b><small>სულ</small>
        </span>
      </label>
      ${rows || "<p class=\"history-empty\">კურიერი ჯერ არ არის.</p>"}
    </div>
  `;
}

function renderAdminMapSummary(pins, visiblePins, innerOnly = false) {
  const html = `
    <div class="admin-map-summary-item"><span>სულ პინები</span><strong>${pins.length}</strong></div>
    <div class="admin-map-summary-item"><span>ნაჩვენები</span><strong>${visiblePins.length}</strong></div>
    <div class="admin-map-summary-item"><span>ჩაბარებული</span><strong>${visiblePins.filter((pin) => pin.status === "delivered").length}</strong></div>
    <div class="admin-map-summary-item"><span>არ ჩაბარებული</span><strong>${visiblePins.filter((pin) => pin.status === "failed").length}</strong></div>
    <div class="admin-map-summary-item"><span>პროცესში</span><strong>${visiblePins.filter((pin) => pin.status === "pending").length}</strong></div>
    <div class="admin-map-summary-item"><span>მიუბმელი</span><strong>${visiblePins.filter((pin) => !pin.courierUsername).length}</strong></div>
  `;
  return innerOnly ? html : `<div id="adminMapSummary" class="admin-map-summary">${html}</div>`;
}

function getAdminMapCourierStats(courier, pins) {
  const courierPins = pins.filter((pin) => normalizeUsername(pin.courierUsername) === normalizeUsername(courier.username));
  return {
    total: courierPins.length,
    delivered: courierPins.filter((pin) => pin.status === "delivered").length,
    failed: courierPins.filter((pin) => pin.status === "failed").length,
    pending: courierPins.filter((pin) => pin.status === "pending").length,
  };
}

function showAllAdminPins() {
  state.adminMapFilters = {
    selectedCouriers: state.adminMapCouriers.map((courier) => courier.username),
    showUnassigned: true,
    mode: "all",
  };
  renderAdminMapPanel();
  applyAdminMapFilters();
}

function hideAllAdminPins() {
  state.adminMapFilters = {
    selectedCouriers: [],
    showUnassigned: false,
    mode: "none",
  };
  renderAdminMapPanel();
  applyAdminMapFilters();
}

function showUnassignedAdminPins() {
  state.adminMapFilters = {
    selectedCouriers: [],
    showUnassigned: true,
    mode: "unassigned",
  };
  renderAdminMapPanel();
  applyAdminMapFilters();
}

function focusPinById(pinId) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;
  openParcelTab(pin.id, { closeOpenDialog: true, focus: true });
}

async function assignSelectedPins() {
  const parcelIds = [...document.querySelectorAll("input[name='assignPin']:checked")].map((input) => input.value);
  const courierUsername = document.getElementById("assignCourier")?.value;
  const message = document.getElementById("assignPinsMessage");
  if (!parcelIds.length || !courierUsername) {
    if (message) message.textContent = "აირჩიეთ პინები და კურიერი.";
    return;
  }
  try {
    await api("/api/parcels/assign", { method: "PATCH", body: { parcelIds, courierUsername } });
    showToast("პინები მიება კურიერს.");
    await openAdminMap();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
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
  const todayRecords = records.filter((parcel) => parcelMatchesStatsDate(parcel, todayKey));
  const payAdjustments = getPayAdjustmentsForDate(todayKey);
  const totalOutstandingCash = couriers.reduce((sum, courier) => sum + getCourierOutstandingCash(courier.username, records), 0);
  const courierCards = couriers.map((courier) => {
    const username = courier.username;
    const courierRecords = todayRecords.filter((parcel) => normalizeUsername(parcel.courierUsername) === normalizeUsername(username));
    const cash = getCourierOutstandingCash(username, records);
    const pay = sumCourierPay(courierRecords) + sumPayAdjustments(payAdjustments.filter((item) => normalizeUsername(item.username) === normalizeUsername(username)));
    return `
      <button class="finance-card" type="button" data-action="openFinanceCourier" data-value="${escapeAttr(username)}">
        <span>${escapeHtml(userDisplayName(courier))}</span>
        <strong>${escapeHtml(formatMoney(pay))}</strong>
        <small>ჩასაბარებელი ქეში: ${escapeHtml(formatMoney(cash))}</small>
      </button>
    `;
  }).join("");
  const body = `
    <div class="finance-panel">
      <section class="finance-card-list">
        ${courierCards || "<div class=\"history-empty history-empty-card\">კურიერი ჯერ არ არის დამატებული</div>"}
        <button class="finance-card finance-card-accent" type="button" data-action="openFinanceCash">
          <span>ჩასაბარებელი ქეში</span>
          <strong>${escapeHtml(formatMoney(totalOutstandingCash))}</strong>
          <small>ქეშის მართვა</small>
        </button>
        <button class="finance-card finance-card-accent" type="button" data-action="openFinanceAdmin">
          <span>ადმინი</span>
          <strong>${escapeHtml(formatMoney(sumAdminProfit(todayRecords)))}</strong>
          <small>დღევანდელი მოგება</small>
        </button>
      </section>
    </div>
  `;
  showDialog("ფინანსები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}

async function openFinanceCourier(username) {
  if (!state.isAdmin && normalizeUsername(username) !== normalizeUsername(state.currentUser)) return;
  const range = getFinanceCourierRange();
  const [users, pins, history, allFinanceRecords] = await Promise.all([
    getUsers().catch(() => []),
    getPins(username),
    getHistory(username),
    state.isAdmin ? getAllFinanceRecords() : Promise.resolve(null),
  ]);
  const courier = users.find((user) => normalizeUsername(user.username) === normalizeUsername(username)) || { username };
  const allRecords = allFinanceRecords || [...pins, ...history];
  const records = [...pins, ...history].filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const payAdjustments = getPayAdjustmentsForRange(range.start, range.end).filter((item) => normalizeUsername(item.username) === normalizeUsername(username));
  const delivered = getDeliveredParcels(records).length;
  const courierPay = sumCourierPay(records) + sumPayAdjustments(payAdjustments);
  const cash = getCourierOutstandingCash(username, allRecords);
  const body = `
    <div class="finance-panel">
      ${renderDateRangeToolbar({
        startId: "financeCourierStartDate",
        endId: "financeCourierEndDate",
        start: range.start,
        end: range.end,
        applySelector: "data-finance-range-apply",
        className: "finance-range-toolbar",
      })}
      <section class="finance-summary-grid">
        <div class="finance-summary-item"><span>არჩეული პერიოდი</span><strong>${escapeHtml(formatDateRangeLabel(range.start, range.end))}</strong></div>
        <div class="finance-summary-item"><span>ჩაბარებული</span><strong>${delivered}</strong></div>
        <div class="finance-summary-item"><span>გამომუშავება</span><strong>${escapeHtml(formatMoney(courierPay))}</strong></div>
        <div class="finance-summary-item"><span>ჩასაბარებელი ქეში</span><strong>${escapeHtml(formatMoney(cash))}</strong></div>
      </section>
      ${state.isAdmin ? `
        <div class="finance-actions">
          <button class="mini-button" type="button" data-action="adjustCourierCash" data-value="${escapeAttr(username)}">ქეშის გასწორება</button>
          <button class="mini-button" type="button" data-action="adjustCourierPay" data-value="${escapeAttr(username)}">გამომუშავების გასწორება</button>
        </div>
      ` : ""}
    </div>
  `;
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
  const body = `
    <div class="finance-panel">
      <section class="finance-card-list">
        ${couriers.map((courier) => {
          const username = courier.username;
          const cash = getCourierOutstandingCash(username, records);
          return `
            <article class="finance-card finance-static-card">
              <span>${escapeHtml(userDisplayName(courier))}</span>
              <small>ჩასაბარებელი ქეში</small>
              <strong>${escapeHtml(formatMoney(cash))}</strong>
              <button class="mini-button" type="button" data-action="adjustCourierCash" data-value="${escapeAttr(username)}">რედაქტირება</button>
            </article>
          `;
        }).join("") || "<div class=\"history-empty history-empty-card\">კურიერი ჯერ არ არის დამატებული</div>"}
      </section>
    </div>
  `;
  showDialog("ქეში", body, [{ label: "უკან", variant: "secondary", action: openFinanceDashboard }]);
}

async function openFinanceAdmin() {
  if (!state.isAdmin) return;
  const range = getFinanceCourierRange();
  const [pins, history] = await Promise.all([getPins(""), getHistory("")]);
  const records = [...pins, ...history].filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const delivered = getDeliveredParcels(records).length;
  const body = `
    <div class="finance-panel">
      ${renderDateRangeToolbar({
        startId: "financeAdminStartDate",
        endId: "financeAdminEndDate",
        start: range.start,
        end: range.end,
        applySelector: "data-finance-admin-range-apply",
        className: "finance-range-toolbar",
      })}
      <section class="finance-summary-grid">
        <div class="finance-summary-item"><span>არჩეული პერიოდი</span><strong>${escapeHtml(formatDateRangeLabel(range.start, range.end))}</strong></div>
        <div class="finance-summary-item"><span>ადმინის მოგება</span><strong>${escapeHtml(formatMoney(sumAdminProfit(records)))}</strong></div>
        <div class="finance-summary-item"><span>ჩაბარებული</span><strong>${delivered}</strong></div>
      </section>
    </div>
  `;
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
  const currentCash = getCourierOutstandingCash(username, records);
  const body = `
    <div class="stats-card">
      <strong>${escapeHtml(username)}</strong>
      <span>ამჟამინდელი ჩასაბარებელი ქეში: ${escapeHtml(formatMoney(currentCash))}</span>
    </div>
    <label for="cashAdjustmentAmount">ახალი თანხა</label>
    <input id="cashAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(String(currentCash))}">
    <p class="form-message" id="cashAdjustmentMessage" role="alert"></p>
  `;
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
  const currentCash = getCourierOutstandingCash(username, await getAllFinanceRecords());
  const dateKey = toDateKey(new Date());
  const adjustment = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username,
    delta: Number(targetAmount) - currentCash,
    targetAmount: Number(targetAmount),
    dateKey,
    startDate: dateKey,
    endDate: dateKey,
    createdAt: new Date().toISOString(),
  };
  const adjustments = readCashAdjustments();
  adjustments.push(adjustment);
  writeCashAdjustments(adjustments);
}

async function openPayAdjustmentDialog(username) {
  if (!state.isAdmin) return;
  const range = getFinanceCourierRange();
  const records = [...await getPins(""), ...await getHistory("")]
    .filter((parcel) => normalizeUsername(parcel.courierUsername) === normalizeUsername(username))
    .filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const currentPay = sumCourierPay(records) + sumPayAdjustments(getPayAdjustmentsForRange(range.start, range.end).filter((item) => normalizeUsername(item.username) === normalizeUsername(username)));
  const body = `
    <div class="stats-card">
      <strong>${escapeHtml(username)}</strong>
      <span>${escapeHtml(formatDateRangeLabel(range.start, range.end))}</span>
      <span>ამჟამინდელი გამომუშავება: ${escapeHtml(formatMoney(currentPay))}</span>
    </div>
    <label for="payAdjustmentAmount">ახალი თანხა</label>
    <input id="payAdjustmentAmount" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(String(currentPay))}">
    <p class="form-message" id="payAdjustmentMessage" role="alert"></p>
  `;
  showDialog("გამომუშავების გასწორება", body, [
    { label: "შენახვა", variant: "primary", action: () => savePayAdjustment(username) },
    { label: "განულება", variant: "danger", action: () => resetPayAdjustment(username) },
    { label: "უკან", variant: "secondary", action: () => openFinanceCourier(username) },
  ]);
}

async function savePayAdjustment(username) {
  const message = document.getElementById("payAdjustmentMessage");
  const value = parsePaymentAmount(document.getElementById("payAdjustmentAmount")?.value);
  if (!Number.isFinite(value) || value < 0) {
    if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
    return;
  }
  await addPayAdjustment(username, value);
  await openFinanceCourier(username);
}

async function resetPayAdjustment(username) {
  await addPayAdjustment(username, 0);
  await openFinanceCourier(username);
}

async function addPayAdjustment(username, targetAmount) {
  const range = getFinanceCourierRange();
  const records = [...await getPins(""), ...await getHistory("")]
    .filter((parcel) => normalizeUsername(parcel.courierUsername) === normalizeUsername(username))
    .filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const currentPay = sumCourierPay(records) + sumPayAdjustments(getPayAdjustmentsForRange(range.start, range.end).filter((item) => normalizeUsername(item.username) === normalizeUsername(username)));
  const adjustment = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username,
    delta: Number(targetAmount) - currentPay,
    targetAmount: Number(targetAmount),
    dateKey: range.start,
    startDate: range.start,
    endDate: range.end,
    createdAt: new Date().toISOString(),
  };
  const adjustments = readPayAdjustments();
  adjustments.push(adjustment);
  writePayAdjustments(adjustments);
}

async function openZoneManagement() {
  const [zones, users] = await Promise.all([getZones(), getUsers()]);
  const couriers = users.filter((user) => user.role === "courier");
  const body = `
    <div class="zone-management-panel">
      <section class="zone-list-panel" aria-label="ზონების სია">
        ${renderZoneCards(zones)}
      </section>
      <section class="zone-courier-panel" aria-label="კურიერზე ზონის მინიჭება">
        <div class="zone-section-title">
          <strong>კურიერზე ზონის მინიჭება</strong>
          <span>პინის ავტომატური მიბმა ამ ზონით ხდება.</span>
        </div>
        ${renderZoneCourierRows(couriers, zones)}
      </section>
      <p class="form-message" id="zoneManagementMessage" role="alert"></p>
    </div>
  `;
  showDialog("ზონები", body, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  els.dialogModal.classList.add("zone-management-dialog");
}

function renderZoneCards(zones) {
  return zones.map((zone) => {
    const areas = getZoneAreas(zone);
    return `
      <article class="zone-card">
        <div>
          <strong>${escapeHtml(getZoneName(zone))}</strong>
          <small>${escapeHtml(getZoneId(zone))}</small>
        </div>
        <p>${areas.map(escapeHtml).join(", ") || "უბნები არ არის მითითებული"}</p>
      </article>
    `;
  }).join("");
}

function renderZoneCourierRows(couriers, zones) {
  if (!couriers.length) return `<div class="history-empty history-empty-card">კურიერი ჯერ არ არის დამატებული</div>`;
  return `
    <div class="zone-courier-list">
      ${couriers.map((courier) => {
        const selectedZoneId = getCourierZoneId(courier, zones);
        const zoneOptions = zones.map((zone) => {
          const zoneId = getZoneId(zone);
          return `<option value="${escapeAttr(zoneId)}" ${zoneId === selectedZoneId ? "selected" : ""}>${escapeHtml(getZoneName(zone))}</option>`;
        }).join("");
        return `
          <article class="zone-courier-row">
            <span class="zone-courier-main">
              <strong>${escapeHtml([courier.firstName, courier.lastName].filter(Boolean).join(" ") || courier.username)}</strong>
              <small>username: ${escapeHtml(courier.username)}</small>
              <small>ტელეფონი: ${escapeHtml(courier.phone || "არ არის")}</small>
              <small>ამჟამინდელი ზონა: ${escapeHtml(getZoneName(getZoneById(selectedZoneId, zones)) || courier.zoneName || "მიუბმელი")}</small>
            </span>
            <div class="zone-courier-controls">
              <select id="zoneSelect-${escapeAttr(courier.username)}" data-zone-courier="${escapeAttr(courier.username)}" aria-label="${escapeAttr(userDisplayName(courier))} ზონა">
                <option value="">მიუბმელი</option>
                ${zoneOptions}
              </select>
              <button class="button primary" type="button" data-action="saveCourierZone" data-value="${escapeAttr(courier.username)}">შენახვა</button>
              <button class="button danger" type="button" data-action="removeCourierZone" data-value="${escapeAttr(courier.username)}">ზონის მოხსნა</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

async function saveCourierZone(username) {
  const message = document.getElementById("zoneManagementMessage");
  const zones = await getZones();
  const select = [...document.querySelectorAll("[data-zone-courier]")].find((item) => item.dataset.zoneCourier === username);
  const zone = getZoneById(select?.value || "", zones);
  if (!zone) {
    if (message) message.textContent = "აირჩიეთ ზონა.";
    return;
  }
  await updateCourierZone(username, { zoneId: getZoneId(zone), zoneName: getZoneName(zone) }, message);
}

async function removeCourierZone(username) {
  const message = document.getElementById("zoneManagementMessage");
  await updateCourierZone(username, { zoneId: "", zoneName: "" }, message);
}

async function updateCourierZone(username, zoneBody, message) {
  try {
    await saveCourierZoneRequest(username, zoneBody);
    showToast(zoneBody.zoneId ? "კურიერს ზონა მიენიჭა." : "კურიერს ზონა მოეხსნა.");
    await refreshPins();
    await openZoneManagement();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

async function saveCourierZoneRequest(username, zoneBody) {
  if (!CONFIG.useUserZoneApi) {
    return saveLocalCourierZone(username, zoneBody);
  }

  try {
    const result = await api(`/api/users/${encodeURIComponent(username)}/zone`, { method: "PUT", body: zoneBody });
    saveLocalCourierZone(username, zoneBody);
    return result;
  } catch (error) {
    if (error.status !== 404) throw error;
    return saveLocalCourierZone(username, zoneBody);
  }
}

async function saveCourierZoneWithUserUpdate(username, zoneBody) {
  const user = (await getUsers()).find((item) => normalizeUsername(item.username) === normalizeUsername(username));
  return api(`/api/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    body: {
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      phone: user?.phone || "",
      bankDetails: user?.bankDetails || "",
      ...zoneBody,
    },
  });
}

async function openUserManagement() {
  const users = await getUsers();
  const body = users.length
    ? `<div class="finance-card-list admin-user-list">${users.map((user) => `
        <article class="finance-card finance-static-card admin-user-card">
          <span class="admin-user-name">${escapeHtml(userDisplayName(user))}</span>
          <small>username: ${escapeHtml(user.username)}</small>
          <small>ტელეფონი: ${escapeHtml(user.phone || "არ არის")}</small>
          <small>როლი: ${escapeHtml(roleLabel(user.role))}</small>
          <small>ზონა: ${escapeHtml(user.zoneName || "მიუბმელი")}</small>
          <div class="row-actions admin-user-actions">
            <button class="mini-button" type="button" data-action="editUser" data-value="${escapeAttr(user.username)}">რედაქტირება</button>
            ${user.username === "admin" || user.role === "admin" ? "" : `<button class="mini-button danger" type="button" data-action="deleteUser" data-value="${escapeAttr(user.username)}">წაშლა</button>`}
          </div>
        </article>
      `).join("")}</div>`
    : "<p>კურიერი არ არის.</p>";
  showDialog("კურიერი", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}

async function openUserEditDialog(username) {
  const user = (await getUsers()).find((item) => item.username === username);
  if (!user) return;
  const body = `
    <div class="stats-card">
      <strong>${escapeHtml(user.username)}</strong>
      <span>${escapeHtml(roleLabel(user.role))}</span>
    </div>
    ${userProfileFields(user)}
    <label for="editUserPassword">ახალი პაროლი</label>
    <input id="editUserPassword" type="password" autocomplete="new-password" placeholder="ცარიელი დატოვე თუ არ იცვლება">
    <p class="form-message" id="editUserMessage" role="alert"></p>
  `;
  showDialog("კურიერის რედაქტირება", body, [
    { label: "შენახვა", variant: "primary", action: () => saveUserEdit(username) },
    { label: "უკან", variant: "secondary", action: openUserManagement },
  ]);
}

async function saveUserEdit(username) {
  const password = document.getElementById("editUserPassword")?.value.trim();
  const message = document.getElementById("editUserMessage");
  const body = readUserProfileFields();
  if (password) body.password = password;
  try {
    await api(`/api/users/${encodeURIComponent(username)}`, { method: "PUT", body });
    await openUserManagement();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

function confirmUserDelete(username) {
  showDialog("დეაქტივაცია", `<p>დეაქტივაციის შემდეგ ${escapeHtml(username)}-ის ინფორმაცია და პინები წაიშლება.</p>`, [
    { label: "დეაქტივაცია", variant: "danger", action: () => deleteUser(username) },
    { label: "გაუქმება", variant: "secondary", action: openUserManagement },
  ]);
}

async function deleteUser(username) {
  await api(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  await refreshPins();
  await openUserManagement();
}

function openAdminAddParcel() {
  openAddressSearchDialog("");
}

async function openAdminCloseDay() {
  const pins = await getPins("");
  const couriers = await getCouriers();
  const closablePins = pins.filter(isCompletedParcelStatus);
  const delivered = closablePins.filter((pin) => pin.status === "delivered").length;
  const failed = pins.filter((pin) => pin.status === "failed").length;
  const pending = pins.filter((pin) => pin.status === "pending").length;
  const closable = delivered;
  const courierStats = buildCloseDayCourierStats(couriers, pins.filter((pin) => pin.status === "delivered" || pin.status === "failed"));
  const body = `
    <div class="history-summary">
      <strong>დასახური პინები: ${closable}</strong>
      <div class="history-metrics">
        <span><b>${delivered}</b> ჩაბარდა</span>
        <span><b>${failed}</b> არ ჩაბარდა</span>
        <span><b>${pending}</b> პროცესშია</span>
        <span><b>${closable}</b> დაიხურება</span>
      </div>
    </div>
    <div class="history-list">
      ${renderCloseDayCourierStats(courierStats)}
    </div>
    <p>დღის დახურვა ისტორიაში გადაიტანს მხოლოდ ჩაბარებულ პინებს. არ ჩაბარებული და პროცესში დარჩენილი პინები აქტიურად რჩება.</p>
  `;
  showDialog("დღის დახურვა", body, [
    { label: "დღის დახურვა", variant: "primary", action: closeAdminDay },
    { label: "გაუქმება", variant: "secondary", action: closeDialog },
  ]);
}

function buildCloseDayCourierStats(couriers, pins) {
  const stats = new Map();
  couriers.forEach((courier) => {
    stats.set(normalizeUsername(courier.username), {
      label: userDisplayName(courier),
      parcels: [],
    });
  });

  pins.forEach((pin) => {
    const key = normalizeUsername(pin.courierUsername || "");
    if (!stats.has(key)) {
      stats.set(key, {
        label: parcelCourierDisplayName(pin),
        parcels: [],
      });
    }
    stats.get(key).parcels.push(pin);
  });

  return [...stats.values()].sort((a, b) => b.parcels.length - a.parcels.length || a.label.localeCompare(b.label, "ka"));
}

function renderCloseDayCourierStats(stats) {
  if (!stats.length) return `<p class="history-empty">კურიერი ჯერ არ არის.</p>`;

  return stats.map((item) => {
    const deliveredPins = item.parcels.filter((pin) => pin.status === "delivered");
    const delivered = deliveredPins.length;
    const failed = item.parcels.filter((pin) => pin.status === "failed").length;
    return `
      <div class="history-row">
        <div class="history-row-main">
          <strong>${escapeHtml(item.label)}</strong>
          <span class="history-status">${delivered} დატოვა</span>
        </div>
        <div class="history-row-meta">
          <span>დატოვა: ${delivered}</span>
          <span>არ ჩაბარდა: ${failed}</span>
          <span>ქეში: ${escapeHtml(formatMoney(sumPayments(deliveredPins)))}</span>
          <span>კურიერის გამომუშავება: ${escapeHtml(formatMoney(sumCourierPay(deliveredPins)))}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function closeAdminDay() {
  const pins = await getPins("");
  const deliveredPins = pins.filter(isCompletedParcelStatus);
  if (!deliveredPins.length) {
    closeDialog();
    showToast("ჩაბარებული პინი არ არის.");
    return;
  }
  const payload = await api("/api/parcels/archive", {
    method: "POST",
    body: {
      status: "delivered",
      parcelIds: deliveredPins.map((pin) => pin.id),
    },
  });
  closeDialog();
  await refreshPins();
  showToast(`${payload.archived} პინი გადავიდა ისტორიაში.`);
}

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
        </div>
        <div class="parcel-history-filters" aria-label="ამანათის ისტორიის ფილტრები">
          <select id="parcelHistoryStatus">
            <option value="">ყველა</option>
            <option value="delivered">ჩაბარებული</option>
            <option value="failed">არ ჩაბარებული</option>
            <option value="pending">პროცესში</option>
          </select>
          <input id="parcelHistoryDate" type="date" aria-label="თარიღის მიხედვით">
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
  ["parcelHistoryStatus", "parcelHistoryDate", "parcelHistoryCourier"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", searchParcelHistory);
  });
  await searchParcelHistory();
}

async function searchParcelHistory() {
  const query = document.getElementById("parcelHistoryQuery")?.value.trim() || "";
  const status = document.getElementById("parcelHistoryStatus")?.value || "";
  const date = document.getElementById("parcelHistoryDate")?.value || "";
  const courier = document.getElementById("parcelHistoryCourier")?.value || "";
  const message = document.getElementById("parcelHistoryMessage");
  const results = document.getElementById("parcelHistoryResults");
  if (message) message.textContent = "";
  if (results) results.innerHTML = "<p class=\"history-empty\">ისტორია იტვირთება...</p>";
  try {
    const parcels = (await searchParcels(query)).filter((parcel) => parcelMatchesHistoryFilters(parcel, { status, date, courier }));
    state.historySearchResults = parcels;
    await renderParcelHistoryResults(parcels);
  } catch {
    state.historySearchResults = [];
    if (message) message.textContent = "ისტორიის ჩატვირთვა ვერ მოხერხდა";
    if (results) results.innerHTML = "<p class=\"history-empty\">ისტორიის ჩატვირთვა ვერ მოხერხდა</p>";
  }
}

function openAddressSearchDialog(username) {
  resetMapSelectionUi();
  const body = `
    <form id="addressSearchForm" class="address-search-form">
      <label for="addressSearchInput">მისამართის ძებნა თბილისში</label>
      <div class="address-search-row">
        <input id="addressSearchInput" type="search" autocomplete="street-address" required>
        <button class="button primary" type="submit">ძებნა</button>
      </div>
      <p id="addressSearchMessage" class="form-message" role="alert"></p>
    </form>
    <div id="addressSearchResults" class="address-search-results"></div>
    <div class="parcel-address-preview">
      <span>არჩეული მისამართი</span>
      <strong id="addressSearchPreviewValue">${escapeHtml(STRINGS.addressMissing)}</strong>
      <small id="addressSearchPreviewZone">ზონა: ზონა არ მოიძებნა</small>
      <small id="addressSearchPreviewCourier">კურიერი: ამ ზონაზე კურიერი არ არის მინიჭებული</small>
    </div>
  `;

  showDialog(state.isAdmin ? "რუკაზე პინის დამატება" : "მისამართის დამატება", body, [
    { label: "შემდეგი", variant: "primary", action: () => confirmAddressSearchSelection(username) },
    { label: "რუკაზე არჩევა", variant: "secondary", action: () => startMapSelection(username) },
    { label: "გაუქმება", variant: "secondary", action: () => { closeDialog(); cancelMapSelection(); } },
  ]);

  document.getElementById("addressSearchForm")?.addEventListener("submit", (event) => {
    handleAddressSearch(event, username);
  });
}

function startMapSelection(username) {
  if (!state.map) {
    showToast("რუკა არ არის გამართული.");
    return;
  }
  closeDialog();
  state.selectedCourier = username;
  state.pendingCoords = null;
  state.pendingAddress = "";
  state.pendingAddressWarning = "";
  state.pendingZone = null;
  state.pendingAutoAssignment = null;
  state.mode = "selectingParcel";
  els.menuButton.hidden = true;
  els.modeToast.hidden = false;
  els.modeToast.textContent = STRINGS.chooseMapPoint;
}

function cancelMapSelection() {
  if (state.mode !== "selectingParcel") return;
  resetMapSelectionUi();
}

function showPendingMarker(coords) {
  clearMapObject(state.pendingMarker);
  state.pendingMarker = createCircleMarker(coords, {
    radius: 10,
    fillColor: "#24566f",
    color: "#fff",
    weight: 2,
    fillOpacity: 0.95,
  });
}

async function handleMapClick(event) {
  if (state.mode !== "selectingParcel") {
    closeActions();
    collapseSelectedParcelCard();
    collapseDeliveredPinLabels();
    return;
  }
  if (!event.latlng) return;
  const coords = toCoords(event.latlng);
  state.pendingCoords = coords;
  state.pendingAddress = STRINGS.addressLoading;
  state.pendingAddressWarning = "";
  setMapView(coords, Math.max(getMapZoom(), 17));
  showPendingMarker(coords);
  els.modeToast.hidden = false;
  els.modeToast.textContent = STRINGS.addressLoading;
  const address = await reverseGeocodeCoords(coords);
  if (state.pendingCoords !== coords) return;
  state.pendingAddress = address || formatCoordsAddress(coords);
  await updatePendingZoneAssignment(coords);
  await openParcelDetailsDialog();
  updatePendingAddressPreview();
  els.modeToast.hidden = true;
}

async function openParcelDetailsDialog() {
  const address = getPendingAddressLabel();
  const previewAddress = getPendingAddressPreviewLabel();
  const couriers = state.isAdmin ? await getCouriers() : [];
  const courierOptions = couriers.map((user) => `<option value="${escapeAttr(user.username)}" ${state.selectedCourier === user.username ? "selected" : ""}>${escapeHtml(userDisplayName(user))}</option>`).join("");
  const body = `
    <div class="parcel-address-preview">
      <span>არჩეული მისამართი</span>
      <strong id="parcelAddressPreview">${escapeHtml(previewAddress)}</strong>
      <small id="parcelZonePreview">${escapeHtml(formatPendingZonePreview())}</small>
      <small id="parcelCourierPreview">${escapeHtml(formatPendingCourierPreview())}</small>
      <small id="parcelAddressWarning">${escapeHtml(state.pendingAddressWarning)}</small>
    </div>
    <label for="parcelAddress">მისამართი</label>
    <input id="parcelAddress" type="text" autocomplete="street-address" value="${escapeAttr(address)}" placeholder="ქუჩა და შენობის ნომერი">
    <label for="parcelName">მიმღების სახელი</label>
    <input id="parcelName" type="text" autocomplete="name">
    <label for="parcelPhone">მობილური</label>
    <input id="parcelPhone" type="tel" autocomplete="tel">
    <label for="parcelPaymentAmount">ქეში</label>
    <input id="parcelPaymentAmount" type="text" inputmode="decimal" autocomplete="off" value="0">
    ${state.isAdmin ? `
      <label for="parcelCourier">კურიერზე მიბმა</label>
      <select id="parcelCourier">
        <option value="">ავტომატურად ზონის მიხედვით</option>
        ${courierOptions}
      </select>
    ` : ""}
  `;

  showDialog("ამანათის დეტალები", body, [
    { label: "შენახვა", variant: "primary", action: saveParcel },
    { label: "გაუქმება", variant: "secondary", action: () => { closeDialog(); cancelMapSelection(); } },
  ]);
}

async function saveParcel() {
  const fullName = document.getElementById("parcelName")?.value.trim();
  const phone = document.getElementById("parcelPhone")?.value.trim();
  if (state.pendingAddress === STRINGS.addressLoading && state.pendingCoords) {
    state.pendingAddress = await reverseGeocodeCoords(state.pendingCoords);
    updatePendingAddressPreview();
  }
  let address = cleanAddressInput(document.getElementById("parcelAddress")?.value.trim())
    || getPendingAddressLabel();
  if ((!address || isCoordinateLabel(address)) && state.pendingCoords) {
    const resolvedAddress = await reverseGeocodeCoords(state.pendingCoords);
    if (resolvedAddress && !isCoordinateLabel(resolvedAddress)) {
      state.pendingAddress = resolvedAddress;
      address = resolvedAddress;
      updatePendingAddressPreview();
    }
  }
  const amountInput = document.getElementById("parcelPaymentAmount");
  const paymentAmount = parsePaymentAmount(amountInput?.value);
  const selectedCourierUsername = state.isAdmin ? (document.getElementById("parcelCourier")?.value || "") : state.selectedCourier;
  let courierUsername = selectedCourierUsername;
  if (!fullName || !phone || !state.pendingCoords || (!state.isAdmin && !courierUsername)) return;
  if (!address || isCoordinateLabel(address)) return showToast(STRINGS.addressRequired);
  if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return showToast("შეიყვანეთ სწორი თანხა.");
  state.pendingAddress = address;
  const autoAssignment = state.isAdmin && !courierUsername
    ? await applyAutoAssignByZone({ lat: state.pendingCoords.lat, lng: state.pendingCoords.lng })
    : await applyAutoAssignByZone({ lat: state.pendingCoords.lat, lng: state.pendingCoords.lng, courierUsername, autoAssigned: false });
  if (state.isAdmin && !courierUsername && autoAssignment.courierUsername) courierUsername = autoAssignment.courierUsername;
  state.pendingZone = { id: autoAssignment.zoneId || "", name: autoAssignment.zoneName || "ზონა არ მოიძებნა" };
  state.pendingAutoAssignment = {
    courierUsername: autoAssignment.courierUsername || "",
    courierName: autoAssignment.courierName || "",
    autoAssigned: Boolean(autoAssignment.autoAssigned && !selectedCourierUsername),
  };

  let payload;
  try {
    payload = await api("/api/parcels", {
      method: "POST",
      body: {
        courierUsername,
        lat: state.pendingCoords.lat,
        lng: state.pendingCoords.lng,
        address,
        fullName,
        phone,
        payment: paymentAmount,
        paymentAmount,
        zoneId: autoAssignment.zoneId || "",
        zoneName: autoAssignment.zoneName || "ზონა არ მოიძებნა",
        autoAssigned: Boolean(autoAssignment.autoAssigned && !selectedCourierUsername),
      },
    });
  } catch (error) {
    showToast(error.message || STRINGS.serverFailed);
    return;
  }
  if (payload.parcel?.id && address) state.parcelAddressCache[payload.parcel.id] = address;

  const shouldRefresh = state.isAdmin || courierUsername === state.currentUser;
  cancelMapSelection();
  closeDialog();
  if (shouldRefresh) await refreshPins();
  if (payload.assignmentMessage) {
    showToast(payload.assignmentMessage);
  } else if (payload.parcel?.autoAssigned) {
    showToast(`ამანათი ავტომატურად მიება: ${parcelCourierDisplayName(payload.parcel)}`);
  } else if (autoAssignment.autoAssigned && !selectedCourierUsername) {
    showToast(`ამანათი ავტომატურად მიება: ${autoAssignment.courierName}`);
  } else {
    showToast(STRINGS.parcelAdded);
  }
}

function countActiveCourierPins(username) {
  const normalizedUsername = normalizeUsername(username);
  return state.activePins.filter((pin) => normalizeUsername(pin.courierUsername) === normalizedUsername && pin.status !== "delivered").length;
}

async function handleAddressSearch(event, username) {
  event.preventDefault();
  const query = document.getElementById("addressSearchInput")?.value.trim();
  const message = document.getElementById("addressSearchMessage");
  const resultsElement = document.getElementById("addressSearchResults");
  if (!query) return;

  try {
    if (message) message.textContent = STRINGS.addressLoading;
    if (resultsElement) resultsElement.innerHTML = "";
    const results = await searchAddress(query);
    if (!results.length) {
      if (message) message.textContent = "ვერ მოიძებნა.";
      state.pendingZone = null;
      state.pendingAutoAssignment = null;
      updateAddressSearchPreview("");
      return;
    }
    if (message) message.textContent = results[0].warning || "";
    renderAddressSearchResults(results, username);
    await selectAddressSearchResult(results[0], username, 0);
  } catch {
    if (message) message.textContent = "მისამართის ძებნა ვერ მოხერხდა.";
  }
}

function renderAddressSearchResults(results, username) {
  const resultsElement = document.getElementById("addressSearchResults");
  if (!resultsElement) return;
  resultsElement.innerHTML = results.map((result, index) => `
    <button class="address-result-button" type="button" data-address-result-index="${index}">
      <strong>${escapeHtml(result.address || formatOsmAddress(result) || STRINGS.addressMissing)}</strong>
      <span>${escapeHtml(result.displayName || result.display_name || formatCoordsAddress(getResultCoords(result)))}</span>
      ${result.warning ? `<small>${escapeHtml(result.warning)}</small>` : ""}
    </button>
  `).join("");
  resultsElement.querySelectorAll("[data-address-result-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectAddressSearchResult(results[Number(button.dataset.addressResultIndex)], username, Number(button.dataset.addressResultIndex));
    });
  });
}

async function selectAddressSearchResult(result, username, selectedIndex = -1) {
  if (!result) return;
  const coords = getResultCoords(result);
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
  const address = cleanAddressInput(result.address || formatOsmAddress(result) || result.displayName || result.display_name) || formatCoordsAddress(coords);
  console.log("[geocode] selected formatted address", address);
  state.selectedCourier = username;
  state.pendingCoords = coords;
  state.pendingAddress = address;
  state.pendingAddressWarning = result.warning || "";
  showPendingMarker(coords);
  setMapView(coords, 17);
  await updatePendingZoneAssignment(coords);
  updateAddressSearchPreview(address, state.pendingAddressWarning);
  const message = document.getElementById("addressSearchMessage");
  if (message) message.textContent = state.pendingAddressWarning;
  document.querySelectorAll("[data-address-result-index]").forEach((button) => {
    button.classList.toggle("is-selected", Number(button.dataset.addressResultIndex) === selectedIndex);
  });
}

async function confirmAddressSearchSelection(username) {
  const message = document.getElementById("addressSearchMessage");
  if (!state.pendingCoords) {
    if (message) message.textContent = "ჯერ მოძებნეთ და აირჩიეთ მისამართი.";
    return;
  }
  state.selectedCourier = username;
  state.pendingAddress = getPendingAddressLabel() || formatCoordsAddress(state.pendingCoords);
  await updatePendingZoneAssignment(state.pendingCoords);
  state.mode = "selectingParcel";
  els.menuButton.hidden = true;
  els.modeToast.hidden = true;
  closeDialog();
  await openParcelDetailsDialog();
}

function updateAddressSearchPreview(address, warning = "") {
  const preview = document.getElementById("addressSearchPreviewValue");
  const zonePreview = document.getElementById("addressSearchPreviewZone");
  const courierPreview = document.getElementById("addressSearchPreviewCourier");
  if (preview) preview.textContent = cleanAddressInput(address) || STRINGS.addressMissing;
  if (zonePreview) zonePreview.textContent = formatPendingZonePreview();
  if (courierPreview) courierPreview.textContent = formatPendingCourierPreview();
  let warningElement = document.getElementById("addressSearchPreviewWarning");
  if (!warningElement && preview?.parentElement) {
    warningElement = document.createElement("small");
    warningElement.id = "addressSearchPreviewWarning";
    preview.parentElement.append(warningElement);
  }
  if (warningElement) warningElement.textContent = warning || "";
}

async function updatePinStatus(pinId, status, options = {}) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!state.isAdmin && pin?.status === "delivered" && status === "failed") {
    showToast("ჩაბარებული შეკვეთის შეცვლა მხოლოდ ადმინს შეუძლია.");
    return;
  }
  if (!state.isAdmin && status === "delivered") {
    if (!state.hasCurrentPosition) {
      showToast("მდებარეობა ჯერ არ არის განსაზღვრული.");
      return;
    }
    if (pin && distanceInMeters(state.currentPosition, pin) > 200) {
      showToast("ჩაბარება შესაძლებელია მხოლოდ 200 მეტრის რადიუსში.");
      return;
    }
  }

  const timestamp = new Date().toISOString();
  const completedAt = options.completedAt || (["delivered", "failed"].includes(status) ? timestamp : undefined);
  const deliveredAt = options.deliveredAt || (status === "delivered" ? completedAt : undefined);
  const failedAt = options.failedAt || (status === "failed" ? completedAt : undefined);

  await api(`/api/parcels/${encodeURIComponent(pinId)}/status`, {
    method: "PATCH",
    body: {
      status,
      failureReason: options.failureReason || "",
      deliveredAt,
      failedAt,
      completedAt,
      currentLat: state.currentPosition?.lat,
      currentLng: state.currentPosition?.lng,
    },
  });
  if (state.routePinId === pinId) clearActiveRoute();
  await refreshPins();
}

async function openTodayStats() {
  const stats = await calculateTodayStats(state.currentUser);
  showDialog("ჩემი დღე", await renderStats(stats), [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}

async function openCourierParcels() {
  const pins = await getPins(state.currentUser);
  const sortedPins = sortCourierPinsByStatusAndDistance(pins);
  const rows = (await Promise.all(sortedPins.map((pin) => renderCourierParcelCard(pin, { includeCash: true, includePhone: true })))).join("");

  showDialog("ჩემი ამანათები", `<div class="courier-menu-list">${rows || `<p class="history-empty">${escapeHtml("აქტიური ამანათი არ არის.")}</p>`}</div>`, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}

async function openNearestParcel() {
  if (!state.hasCurrentPosition) {
    showToast("მდებარეობა ჯერ არ არის განსაზღვრული.");
    return;
  }

  const pins = await getPins(state.currentUser);
  const nearest = pins
    .filter((pin) => pin.status === "pending")
    .sort((a, b) => distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b))[0];

  if (!nearest) {
    showToast("აქტიური ამანათი არ არის.");
    return;
  }

  openParcelTab(nearest.id, { focus: true });
}

async function openCourierStatusPanel() {
  const pins = await getPins(state.currentUser);
  const sortedPins = sortCourierPinsByStatusAndDistance(pins);
  const rows = (await Promise.all(sortedPins.map((pin) => renderCourierParcelCard(pin, { includeCash: false, includePhone: false })))).join("");

  showDialog("სტატუსის შეცვლა", `<div class="courier-menu-list">${rows || `<p class="history-empty">${escapeHtml("აქტიური ამანათი არ არის.")}</p>`}</div>`, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}

function sortCourierPinsByStatusAndDistance(pins) {
  return [...pins].sort((a, b) => {
    const statusDiff = getStatusSortValue(a.status) - getStatusSortValue(b.status);
    if (statusDiff) return statusDiff;
    if (state.hasCurrentPosition) return distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b);
    return String(a.fullName || "").localeCompare(String(b.fullName || ""), "ka");
  });
}

async function renderCourierParcelCard(pin, options = {}) {
  const address = await resolveParcelAddress(pin);
  const status = getStatusLabel(pin.status);
  const payment = getPaymentAmount(pin);

  return `
    <article class="courier-parcel-card">
      <div class="history-row-main">
        <strong>${escapeHtml(pin.fullName || "")}</strong>
        <span class="history-status status-${escapeAttr(pin.status)}">${escapeHtml(status)}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      <div class="history-row-meta">
        ${options.includePhone ? `<span>${escapeHtml("ტელეფონი")}: ${escapeHtml(pin.phone || "")}</span>` : ""}
        ${options.includeCash ? `<span>${escapeHtml("ქეში")}: ${escapeHtml(formatMoney(payment))}</span>` : ""}
      </div>
      <div class="courier-parcel-actions">
        <button class="button secondary" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">${escapeHtml("რუკა")}</button>
        <button class="button" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">${escapeHtml("ჩაბარდა")}</button>
        <button class="button danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">${escapeHtml("ვერ ჩაბარდა")}</button>
      </div>
    </article>
  `;
}

async function openCourierRoute() {
  const pins = await getPins(state.currentUser);
  const sortedPins = [...pins].sort((a, b) => {
    const statusDiff = getStatusSortValue(a.status) - getStatusSortValue(b.status);
    if (statusDiff) return statusDiff;
    return distanceInMeters(state.currentPosition, a) - distanceInMeters(state.currentPosition, b);
  });

  const rows = (await Promise.all(sortedPins.map(async (pin, index) => {
    const address = await resolveParcelAddress(pin);
    const distance = distanceInMeters(state.currentPosition, pin);
    return `
      <div class="history-row">
        <div class="history-row-main">
          <strong>${index + 1}. ${escapeHtml(pin.fullName)}</strong>
          <span class="history-status status-${pin.status}">${escapeHtml(getStatusLabel(pin.status))}</span>
        </div>
        <div class="history-address">${escapeHtml(address)}</div>
        <div class="history-row-meta">
          <span>მანძილი: ${escapeHtml(formatDistance(distance))}</span>
          <span>მობილური: ${escapeHtml(pin.phone || "")}</span>
          <span>ქეში: ${escapeHtml(formatMoney(getPaymentAmount(pin)))}</span>
        </div>
        <div class="route-actions">
          <button class="button secondary" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">რუკა</button>
          <button class="button" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
          <button class="button danger" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">არ ჩაბარდა</button>
        </div>
      </div>
    `;
  }))).join("");

  showDialog("მარშრუტი", rows || "<p class=\"history-empty\">აქტიური ამანათი არ არის.</p>", [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}

function openCalendar(username, title) {
  state.calendarDate = new Date();
  renderCalendarDialog(username, title);
}

function renderCalendarDialog(username, title) {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const weekdays = ["ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ", "კვი"];

  let grid = weekdays.map((day) => `<div class="calendar-cell weekday">${day}</div>`).join("");
  for (let i = 0; i < offset; i += 1) grid += `<div class="calendar-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toDateKey(new Date(year, month, day));
    grid += `<button class="calendar-cell" type="button" data-action="calendarDay" data-value="${date}">${day}</button>`;
  }

  const monthLabel = formatMonthYear(state.calendarDate);
  const body = `
    <div class="calendar-panel">
      <div class="calendar-header">
      <button class="calendar-nav-button" type="button" data-action="previousMonth" aria-label="წინა თვე">&lt;</button>
      <strong>${monthLabel}</strong>
      <button class="calendar-nav-button" type="button" data-action="nextMonth" aria-label="შემდეგი თვე">&gt;</button>
      </div>
      <div class="calendar-grid">${grid}</div>
    </div>
    <div id="calendarResults" class="history-results"></div>
  `;

  showDialog(title, body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  bindCalendarActions(username, title);
}

function bindCalendarActions(username, title) {
  els.dialogBody.querySelectorAll("[data-action='previousMonth'], [data-action='nextMonth'], [data-action='calendarDay']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.action === "previousMonth") {
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
        renderCalendarDialog(username, title);
        return;
      }
      if (button.dataset.action === "nextMonth") {
        state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
        renderCalendarDialog(username, title);
        return;
      }
      await renderHistoryForDate(username, button.dataset.value);
    });
  });
}

async function renderHistoryForDate(username, dateKey) {
  const [active, allHistory] = await Promise.all([getPins(username), getHistory(username)]);
  const records = [...active, ...allHistory].filter((item) => parcelMatchesStatsDate(item, dateKey));
  const delivered = records.filter((item) => item.status === "delivered").length;
  const failed = records.filter((item) => item.status === "failed").length;
  const outstandingCash = getCourierOutstandingCash(username, [...active, ...allHistory]);
  const courierPay = sumCourierPay(records);
  const rows = (await Promise.all(records.map(async (item) => {
    const payment = getPaymentAmount(item);
    const status = getStatusLabel(item.status);
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    const failureReason = parcelFailureReason(item);
    const dateLabel = item.archivedAt || item.completedAt || item.deliveredAt || item.failedAt || item.updatedAt || item.createdAt;
    return `
    <div class="history-row">
      <div class="history-row-main">
        <strong>${escapeHtml(item.fullName)}</strong>
        <span class="history-status status-${item.status}">${status}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      ${item.status === "failed" && failureReason ? `<div class="history-address">მიზეზი: ${escapeHtml(failureReason)}</div>` : ""}
      <div class="history-row-meta">
        <span>ქეში: ${escapeHtml(formatMoney(payment))}</span>
        <span class="history-pay">კურიერის ანაზღაურება: ${escapeHtml(formatMoney(itemCourierPay))}</span>
        <span>${formatDateTime(dateLabel)}</span>
      </div>
    </div>
  `;
  }))).join("");

  document.getElementById("calendarResults").innerHTML = `
    <div class="history-summary">
      <strong>${dateKey}</strong>
      <div class="history-metrics">
        <span><b>${delivered}</b> ჩაბარდა</span>
        <span><b>${failed}</b> არ ჩაბარდა</span>
        <span><b>${escapeHtml(formatMoney(outstandingCash))}</b> ჩასაბარებელი ქეში</span>
        <span><b>${escapeHtml(formatMoney(courierPay))}</b> კურიერის გამომუშავება</span>
      </div>
    </div>
    <div class="history-list">${rows || "<p class=\"history-empty\">ამ თარიღზე დახურული ამანათი არ არის.</p>"}</div>
  `;
}

async function confirmEndDay() {
  const pins = await getPins(state.currentUser);
  const deliveredPins = pins.filter(isCompletedParcelStatus);
  const companyTotal = sumPayments(deliveredPins);
  const courierPay = sumCourierPay(deliveredPins);
  showDialog("დღის დახურვა", `<p>ისტორიაში გადავიდეს მხოლოდ ჩაბარებული ამანათები?</p><div class="stats-card">ქეში: <strong>${formatMoney(companyTotal)}</strong></div><div class="stats-card">კურიერის გამომუშავება: <strong>${formatMoney(courierPay)}</strong></div>`, [
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
  const companyTotal = sumPayments(deliveredPins);
  const courierPay = sumCourierPay(deliveredPins);

  await api("/api/parcels/archive", {
    method: "POST",
    body: {
      courierUsername: state.currentUser,
      status: "delivered",
      parcelIds: deliveredPins.map((pin) => pin.id),
    },
  });
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
  return { delivered, failed, pending, companyTotal: sumPayments(records), outstandingCash: getCourierOutstandingCash(username, allRecords), courierPay: sumCourierPay(records), records };
}

async function calculateTodayStats(username) {
  const todayKey = toDateKey(new Date());
  const active = await getPins(username);
  const history = await getHistory(username);
  const allRecords = [...active, ...history];
  const records = allRecords.filter((pin) => parcelMatchesStatsDate(pin, todayKey));
  const delivered = records.filter((pin) => pin.status === "delivered").length;
  const failed = records.filter((pin) => pin.status === "failed").length;
  const pending = records.filter((pin) => pin.status === "pending").length;

  return {
    delivered,
    failed,
    pending,
    companyTotal: sumPayments(records),
    outstandingCash: getCourierOutstandingCash(username, allRecords),
    courierPay: sumCourierPay(records),
    records,
  };
}

async function renderStats(stats) {
  const rows = (await Promise.all(stats.records.map(async (item) => {
    const payment = getPaymentAmount(item);
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    const deliveredAt = item.deliveredAt || (item.status === "delivered" ? item.completedAt : "");
    const failedAt = item.failedAt || (item.status === "failed" ? item.completedAt : "");
    const statusChangedAt = item.updatedAt || item.completedAt || "";
    const failureReason = parcelFailureReason(item);
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
        ${historyDetail("ქეში", payment > 0 ? formatMoney(payment) : "არ აქვს")}
        ${historyDetail("ჩასაბარებელი ქეში", formatMoney(stats.outstandingCash ?? stats.companyTotal))}
        ${historyDetail("კურიერის ანაზღაურება", formatMoney(itemCourierPay))}
        ${historyDetail("სტატუსის ცვლილება", formatOptionalDateTime(statusChangedAt))}
        ${historyDetail("მიტანის დრო", formatOptionalDateTime(deliveredAt))}
        ${historyDetail("ვერ ჩაბარდა დრო", formatOptionalDateTime(failedAt))}
      </div>
      ${item.status === "failed" && failureReason ? `<div class="parcel-history-note"><span>მიზეზი</span><strong>${escapeHtml(failureReason)}</strong></div>` : ""}
      <div class="parcel-history-actions">
        <span>${escapeHtml(formatDateTime(item.completedAt || item.archivedAt || item.updatedAt || item.createdAt))}</span>
      </div>
    </article>
  `;
  }))).join("");

  return `
    <div class="history-summary">
      <strong>დღეს</strong>
      <div class="history-metrics">
        <span><b>${stats.delivered}</b> ჩაბარდა</span>
        <span><b>${stats.failed}</b> არ ჩაბარდა</span>
        <span><b>${stats.pending}</b> პროცესში</span>
        <span><b>${stats.records.length}</b> ამანათი</span>
        <span><b>${escapeHtml(formatMoney(stats.outstandingCash ?? stats.companyTotal))}</b> ჩასაბარებელი ქეში</span>
        <span><b>${escapeHtml(formatMoney(stats.courierPay))}</b> კურიერის გამომუშავება</span>
      </div>
    </div>
    <div class="history-list">${rows || "<p class=\"history-empty\">დღეს ამანათი არ არის.</p>"}</div>
  `;
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
  results.innerHTML = (await Promise.all(parcels.map(renderParcelHistoryCard))).join("");
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

function renderParcelHistorySummary(parcels) {
  const delivered = parcels.filter((item) => item.status === "delivered").length;
  const failed = parcels.filter((item) => item.status === "failed").length;
  const outstandingCash = [...new Set(parcels.map((item) => normalizeUsername(item.courierUsername)).filter(Boolean))]
    .reduce((sum, username) => sum + getCourierOutstandingCash(username, parcels), 0);
  return `
    <div class="parcel-history-summary-item"><span>სულ</span><strong>${parcels.length}</strong></div>
    <div class="parcel-history-summary-item"><span>ჩაბარებული</span><strong>${delivered}</strong></div>
    <div class="parcel-history-summary-item"><span>არ ჩაბარებული</span><strong>${failed}</strong></div>
    <div class="parcel-history-summary-item"><span>ჩასაბარებელი ქეში</span><strong>${escapeHtml(formatMoney(outstandingCash))}</strong></div>
    <div class="parcel-history-summary-item"><span>კურიერის გამომუშავება</span><strong>${escapeHtml(formatMoney(sumCourierPay(parcels)))}</strong></div>
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
  if (filters.date && !parcelMatchesDate(parcel, filters.date)) return false;
  return true;
}

function parcelMatchesDate(parcel, dateKey) {
  return [parcel.createdAt, parcel.assignedAt, parcel.completedAt, parcel.deliveredAt, parcel.failedAt, parcel.updatedAt, parcel.archivedAt]
    .some((value) => toDateKey(new Date(value)) === dateKey);
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

function openParcelTab(pinId, options = {}) {
  console.log("OPEN TAB:", pinId);
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;

  closeActions();
  if (options.closeOpenDialog && els.dialogModal?.classList.contains("active")) closeDialog();
  if (options.focus) setMapView(pin, 17);
  showSelectedParcelCard(pin.id);
}

function showSelectedParcelCard(pinId) {
  state.selectedPinId = pinId;
  state.selectedParcelCardCollapsed = false;
  const pin = state.activePins.find((item) => item.id === pinId);
  if (pin?.address) state.parcelAddressCache[pinId] = pin.address;
  renderSelectedParcelCard();
  ensureSelectedPinAddress(pinId);
}

function renderSelectedParcelCard() {
  const pin = state.activePins.find((item) => item.id === state.selectedPinId);
  if (!pin) {
    hideSelectedParcelCard();
    return;
  }

  const payment = getPaymentAmount(pin);
  const phoneHref = formatPhoneHref(pin.phone);
  const address = getParcelAddress(pin);
  const statusText = getStatusLabel(pin.status);
  const courierName = parcelCourierDisplayName(pin);
  const courierPhone = parcelCourierPhone(pin);
  const courierPhoneHref = formatPhoneHref(courierPhone);
  const assignedDate = parcelAssignedDate(pin);
  const failureReason = parcelFailureReason(pin);
  const routeActive = !state.isAdmin && state.routePinId === pin.id;
  const statusControls = pin.status !== "delivered"
    ? `<div class="nearest-status-actions">
        <button class="nearest-status-button delivered" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
        <button class="nearest-status-button failed" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">ვერ ჩაბარდა</button>
      </div>`
    : "";

  els.nearestParcelCard.hidden = false;
  els.nearestParcelCard.classList.remove("is-collapsed");
  els.nearestParcelCard.innerHTML = `
    <div class="nearest-card-header">
      <strong>${escapeHtml(pin.fullName)}</strong>
      <div class="nearest-card-actions">
        <button class="nearest-icon-button" type="button" data-action="focusSelectedParcel" aria-label="ამანათის რუკაზე ჩვენება">რუკა</button>
        ${!state.isAdmin ? `<button class="nearest-icon-button" type="button" data-action="routeSelectedParcel" aria-label="მარშრუტის დაგეგმვა">მარშრუტი</button>` : ""}
        ${routeActive ? `<button class="nearest-icon-button route-clear-button" type="button" data-action="clearSelectedRoute" aria-label="მარშრუტის გაუქმება">×</button>` : ""}
        <button class="nearest-icon-button" type="button" data-action="toggleSelectedParcelCard" aria-label="დეტალების დახურვა">-</button>
      </div>
    </div>
    <div class="nearest-card-body">
      <div class="nearest-detail">
        <span>მიმღები</span>
        <strong>${escapeHtml(pin.fullName)}</strong>
      </div>
      <div class="nearest-detail">
        <span>მისამართი</span>
        <strong>${escapeHtml(address)}</strong>
      </div>
      <div class="nearest-detail">
        <span>${state.isAdmin ? "მობილური" : "ზარი"}</span>
        ${state.isAdmin
          ? `<strong>${escapeHtml(pin.phone || "")}</strong>`
          : `<a class="call-link" href="${escapeAttr(phoneHref)}" aria-label="მიმღებთან დარეკვა">დარეკვა</a>`}
      </div>
      <div class="nearest-detail">
        <span>ქეში</span>
        <strong>${payment > 0 ? escapeHtml(formatMoney(payment)) : "ქეში არ არის"}</strong>
      </div>
      <div class="nearest-detail">
        <span>სტატუსი</span>
        <strong class="status-${pin.status}">${statusText}</strong>
      </div>
      ${pin.status === "failed" && failureReason ? `
        <div class="nearest-detail">
          <span>მიზეზი</span>
          <strong>${escapeHtml(failureReason)}</strong>
        </div>
      ` : ""}
      ${state.isAdmin ? `
        <div class="nearest-detail">
          <span>კურიერი</span>
          <div class="nearest-detail-stack">
            <strong>${escapeHtml(courierName)}</strong>
            ${courierPhone ? `<a class="phone-link" href="${escapeAttr(courierPhoneHref)}">${escapeHtml(courierPhone)}</a>` : ""}
          </div>
        </div>
        <div class="nearest-detail">
          <span>ზონა</span>
          <strong>${escapeHtml(parcelZoneLabel(pin))}</strong>
        </div>
        <div class="nearest-detail">
          <span>მიბმის ტიპი</span>
          <strong>${escapeHtml(parcelAutoAssignLabel(pin))}</strong>
        </div>
        <div class="nearest-detail">
          <span>მიბმის დრო</span>
          <strong>${assignedDate ? escapeHtml(formatDateTime(assignedDate)) : "მიუბმელი"}</strong>
        </div>
      ` : ""}
      ${statusControls}
    </div>
  `;
}

function hideSelectedParcelCard() {
  state.selectedPinId = null;
  state.selectedParcelCardCollapsed = false;
  els.nearestParcelCard.hidden = true;
  els.nearestParcelCard.classList.remove("is-collapsed");
  els.nearestParcelCard.textContent = "";
}

function toggleSelectedParcelCard() {
  if (!state.selectedPinId) return;
  hideSelectedParcelCard();
}

function collapseSelectedParcelCard() {
  if (!state.selectedPinId) return;
  hideSelectedParcelCard();
}

function focusSelectedParcel() {
  const pin = state.activePins.find((item) => item.id === state.selectedPinId);
  if (!pin) return;
  setMapView(pin, 17);
}

async function routeSelectedParcel() {
  if (state.isAdmin) return;
  const pin = state.activePins.find((item) => item.id === state.selectedPinId);
  if (!pin) return;
  if (!state.hasCurrentPosition) {
    showToast("მდებარეობა ჯერ არ არის განსაზღვრული.");
    return;
  }

  const origin = state.currentPosition || { lat: CONFIG.center[0], lng: CONFIG.center[1] };
  await drawRouteToPin(origin, pin);
  showGoogleMapsRoutePrompt(origin, pin);
}

function showGoogleMapsRoutePrompt(origin, pin) {
  showDialog("", `
    <div class="route-prompt">
      <strong>Google Maps</strong>
      <span>გსურთ GOOGLE MAP მარშრუტის დაგეგმვა?</span>
    </div>
  `, [
    { label: "კი", variant: "primary", action: () => { window.open(buildGoogleMapsRouteUrl(origin, pin), "_blank", "noopener"); closeDialog(); } },
    { label: "არა", variant: "secondary", action: closeDialog },
  ]);
}

async function drawRouteToPin(origin, pin) {
  clearMapObject(state.routeLayer);
  const fallbackLine = [toLeafletLatLng(origin), toLeafletLatLng(pin)];
  let latLngs = fallbackLine;

  try {
    const routeLatLngs = await fetchRouteLatLngs(origin, pin);
    if (routeLatLngs.length > 1) latLngs = routeLatLngs;
  } catch {
    showToast("მარშრუტი რუკაზე სწორი ხაზით გამოჩნდა.");
  }

  state.routeLayer = L.polyline(latLngs, {
    color: "#24566f",
    weight: 5,
    opacity: 0.85,
  }).addTo(state.map);
  state.routePinId = pin.id;
  state.map.fitBounds(state.routeLayer.getBounds(), { padding: [38, 38], maxZoom: 17 });
  renderSelectedParcelCard();
}

async function ensureSelectedPinAddress(pinId) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin || pin.isResolvingAddress) return;
  const storedAddress = getStoredParcelAddress(pin);
  if (storedAddress) {
    state.parcelAddressCache[pinId] = storedAddress;
    return;
  }
  const cachedAddress = getCachedParcelAddress(pinId);
  if (cachedAddress) {
    pin.address = cachedAddress;
    renderSelectedParcelCard();
    return;
  }

  pin.isResolvingAddress = true;
  renderSelectedParcelCard();
  const address = await reverseGeocodeCoords(pin);
  pin.isResolvingAddress = false;
  if (address) {
    pin.address = address;
    state.parcelAddressCache[pinId] = address;
  } else {
    pin.addressLookupFailed = true;
  }
  if (state.selectedPinId === pinId) renderSelectedParcelCard();
}

function getParcelAddress(pin) {
  const storedAddress = getStoredParcelAddress(pin);
  if (storedAddress) return storedAddress;
  const cachedAddress = getCachedParcelAddress(pin.id);
  if (cachedAddress) return cachedAddress;
  if (pin.isResolvingAddress) return STRINGS.addressLoading;
  return STRINGS.addressMissing;
}

async function resolveParcelAddress(parcel) {
  if (!parcel) return "";
  const storedAddress = getStoredParcelAddress(parcel);
  if (storedAddress) {
    state.parcelAddressCache[parcel.id] = storedAddress;
    return storedAddress;
  }
  const cachedAddress = getCachedParcelAddress(parcel.id);
  if (cachedAddress) return cachedAddress;
  const address = await reverseGeocodeCoords(parcel);
  if (address) {
    state.parcelAddressCache[parcel.id] = address;
    parcel.address = address;
    return address;
  }
  return STRINGS.addressMissing;
}

function getPendingAddressLabel() {
  return cleanAddressInput(state.pendingAddress);
}

function getPendingAddressPreviewLabel() {
  if (state.pendingAddress === STRINGS.addressLoading) return STRINGS.addressLoading;
  return getPendingAddressLabel() || formatCoordsAddress(state.pendingCoords) || STRINGS.addressMissing;
}

function updatePendingAddressPreview() {
  const preview = document.getElementById("parcelAddressPreview");
  const zonePreview = document.getElementById("parcelZonePreview");
  const courierPreview = document.getElementById("parcelCourierPreview");
  const warning = document.getElementById("parcelAddressWarning");
  const input = document.getElementById("parcelAddress");
  const address = getPendingAddressLabel();
  const previewAddress = address || formatCoordsAddress(state.pendingCoords);
  if (preview) preview.textContent = previewAddress || STRINGS.addressMissing;
  if (zonePreview) zonePreview.textContent = formatPendingZonePreview();
  if (courierPreview) courierPreview.textContent = formatPendingCourierPreview();
  if (warning) warning.textContent = state.pendingAddressWarning || "";
  if (input && address) {
    const currentValue = cleanAddressInput(input.value);
    if (!currentValue || currentValue === formatCoordsAddress(state.pendingCoords)) input.value = address;
  }
}

function formatPendingZonePreview() {
  return `ზონა: ${state.pendingZone?.name || "ზონა არ მოიძებნა"}`;
}

function formatPendingCourierPreview() {
  const assignment = state.pendingAutoAssignment;
  if (assignment?.courierName) return `კურიერი: ${assignment.courierName}`;
  return "კურიერი: ამ ზონაზე კურიერი არ არის მინიჭებული";
}

async function updatePendingZoneAssignment(coords) {
  state.pendingZone = null;
  state.pendingAutoAssignment = null;
  if (!coords || !state.isAdmin) return null;
  const assignment = await applyAutoAssignByZone({ lat: coords.lat, lng: coords.lng });
  state.pendingZone = { id: assignment.zoneId || "", name: assignment.zoneName || "ზონა არ მოიძებნა" };
  state.pendingAutoAssignment = {
    courierUsername: assignment.courierUsername || "",
    courierName: assignment.courierName || "",
    autoAssigned: assignment.autoAssigned,
  };
  return state.pendingZone;
}

function coordsMatchZone(coords, zone) {
  if (!zone) return false;
  if (coordsWithinZoneBounds(coords, zone.bounds || zone.bbox || zone.boundingBox)) return true;
  if (Array.isArray(zone.polygon) && pointInPolygon(coords, zone.polygon)) return true;
  if (Array.isArray(zone.coordinates) && pointInPolygon(coords, zone.coordinates)) return true;
  return false;
}

async function applyAutoAssignByZone(parcelData) {
  const zone = await detectZoneByCoords(parcelData);
  const zoneId = zone ? getZoneId(zone) : "";
  const zoneName = zone ? getZoneName(zone) : "ზონა არ მოიძებნა";
  const courier = zone && !parcelData.courierUsername ? await getCourierForZone(zoneId, zoneName) : null;
  return {
    ...parcelData,
    zoneId,
    zoneName,
    courierUsername: parcelData.courierUsername || courier?.username || "",
    courierName: courier ? userDisplayName(courier) : "",
    autoAssigned: Boolean(courier && !parcelData.courierUsername),
  };
}

async function detectZoneByCoords(coords) {
  const zones = await getZones();
  return zones.find((zone) => coordsMatchZone(coords, zone)) || null;
}

async function getCourierForZone(zoneId, zoneName) {
  const couriers = await getCouriers().catch(() => []);
  const normalizedZoneId = normalizeZoneId(zoneId);
  const normalizedZoneName = normalizeZoneText(zoneName);
  const zoneCouriers = couriers.filter((courier) => {
    const courierZoneId = normalizeZoneId(courier.zoneId || courier.zoneCode || courier.zone);
    const courierZoneName = normalizeZoneText(courier.zoneName || "");
    return (normalizedZoneId && courierZoneId === normalizedZoneId) || (normalizedZoneName && courierZoneName === normalizedZoneName);
  });
  if (!zoneCouriers.length) return null;
  return [...zoneCouriers].sort((a, b) => countActiveCourierPins(a.username) - countActiveCourierPins(b.username))[0];
}

function coordsWithinZoneBounds(coords, bounds) {
  if (!bounds) return false;
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  if (Array.isArray(bounds) && bounds.length >= 4) {
    const [south, west, north, east] = bounds.map(Number);
    return lat >= south && lat <= north && lng >= west && lng <= east;
  }

  const south = Number(bounds.south ?? bounds.minLat ?? bounds[0]);
  const west = Number(bounds.west ?? bounds.minLng ?? bounds.minLon ?? bounds[1]);
  const north = Number(bounds.north ?? bounds.maxLat ?? bounds[2]);
  const east = Number(bounds.east ?? bounds.maxLng ?? bounds.maxLon ?? bounds[3]);
  return [south, west, north, east].every(Number.isFinite) && lat >= south && lat <= north && lng >= west && lng <= east;
}

function pointInPolygon(point, polygon) {
  const normalizedPoint = normalizePolygonPoint(point);
  const lat = Number(normalizedPoint?.lat);
  const lng = Number(normalizedPoint?.lng);
  const points = polygon.map(normalizePolygonPoint).filter(Boolean);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || points.length < 3) return false;

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].lng;
    const yi = points[i].lat;
    const xj = points[j].lng;
    const yj = points[j].lat;
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizePolygonPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const first = Number(point[0]);
    const second = Number(point[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    return Math.abs(first) > 43 && Math.abs(second) < 43
      ? { lat: second, lng: first }
      : { lat: first, lng: second };
  }
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.lon ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function reverseGeocodeCoords(coords) {
  if (!CONFIG.useReverseGeocoding) return "";
  if (!coords) return "";
  const fallbackAddress = formatCoordsAddress(coords);

  try {
    const result = await fetchOsmJson("/reverse", {
      format: "jsonv2",
      lat: coords.lat,
      lon: coords.lng,
      zoom: 18,
      addressdetails: 1,
      "accept-language": "ka,en",
    });
    console.log("[geocode] reverse response", result);
    const address = formatOsmAddress(result, "");
    console.log("[geocode] selected formatted address", address || fallbackAddress);
    const isPendingCoords = state.pendingCoords
      && Number(state.pendingCoords.lat) === Number(coords.lat)
      && Number(state.pendingCoords.lng) === Number(coords.lng);
    if (isPendingCoords) {
      state.pendingAddressWarning = result?._addressWarning || (address ? "" : "მისამართი ვერ მოიძებნა, ნაჩვენებია კოორდინატები.");
    }
    return address || fallbackAddress;
  } catch {
    const isPendingCoords = state.pendingCoords
      && Number(state.pendingCoords.lat) === Number(coords.lat)
      && Number(state.pendingCoords.lng) === Number(coords.lng);
    if (isPendingCoords) state.pendingAddressWarning = "მისამართი ვერ მოიძებნა, ნაჩვენებია კოორდინატები.";
    return fallbackAddress;
  }
}

async function geocodeAddress(query) {
  return (await searchAddress(query))[0] || null;
}

async function searchAddress(query) {
  const queryParts = parseAddressQuery(query);
  console.log("[geocode] search query", queryParts.original);
  if (!CONFIG.useExternalAddressSearch) return [];

  const searchParamsList = [
    ...buildAddressSearchParams(queryParts),
    ...(queryParts.houseNumber && queryParts.street ? [
      { street: `${queryParts.street} ${queryParts.houseNumber}`, city: "Tbilisi", country: "Georgia" },
      { street: `${queryParts.houseNumber} ${queryParts.street}`, city: "Tbilisi", country: "Georgia" },
    ] : []),
    ...(queryParts.street ? [
      { q: queryParts.street },
      { q: `${queryParts.street}, Tbilisi` },
      { q: `${queryParts.street}, Tbilisi, Georgia` },
    ] : []),
  ];
  const results = [];
  for (const params of searchParamsList) {
    const batch = await fetchOsmJson("/search", {
      format: "jsonv2",
      ...params,
      addressdetails: 1,
      limit: 10,
      countrycodes: "ge",
      viewbox: getTbilisiViewbox(),
      bounded: 1,
      "accept-language": "ka,en",
    });
    const normalizedBatch = normalizeOsmSearchResults(batch || [], queryParts);
    results.push(...normalizedBatch);
    if (queryParts.houseNumber) {
      if (normalizedBatch.some((result) => isExactHouseNumberResult(result, queryParts.houseNumber))) break;
    } else if (normalizedBatch.some((result) => result.acceptedForTbilisi)) {
      break;
    }
  }
  const acceptedResults = results.filter((result) => result.acceptedForTbilisi);
  const ranked = rankAddressResults(dedupeAddressResults(acceptedResults), queryParts);
  console.log("[geocode] search response count", results.length);
  console.log("[geocode] search accepted count", ranked.length);
  return ranked;
}

function parseAddressQuery(query) {
  const original = cleanAddressInput(query);
  const numberPattern = /(?:^|[\s,])(?:#|№|N|No\.?)?\s*(\d+[A-Za-zა-ჰ]?(?:[-/]\d+[A-Za-zა-ჰ]?)?)\s*$/i;
  let match = original.match(numberPattern);
  let houseNumber = match?.[1] || "";
  let street = houseNumber ? original.slice(0, match.index).trim() : original;

  if (!houseNumber) {
    match = original.match(/^(?:#|№|N|No\.?)?\s*(\d+[A-Za-zა-ჰ]?(?:[-/]\d+[A-Za-zა-ჰ]?)?)\s+(.+)$/i);
    houseNumber = match?.[1] || "";
    street = match?.[2]?.trim() || street;
  }

  street = normalizeAddressQueryStreet(street || original);
  return {
    original,
    street,
    houseNumber: normalizeHouseNumber(houseNumber),
  };
}

function normalizeAddressQueryStreet(value) {
  return cleanAddressInput(value)
    .replace(/[,]+/g, " ")
    .replace(/\b(tbilisi|georgia|თბილისი|საქართველო)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAddressSearchParams(queryParts) {
  const query = queryParts.original;
  const street = queryParts.street;
  const houseNumber = queryParts.houseNumber;
  const variants = [
    query,
    `${query}, თბილისი`,
    `${query}, Tbilisi`,
    `${query}, Tbilisi, Georgia`,
    houseNumber && street ? `${street} ${houseNumber}, Tbilisi, Georgia` : "",
    houseNumber && street ? `${houseNumber} ${street}, Tbilisi, Georgia` : "",
    houseNumber && street ? `${street} street ${houseNumber}, Tbilisi, Georgia` : "",
    houseNumber && street ? `${street} ქუჩა ${houseNumber}, თბილისი` : "",
    `${query}, თბილისი`,
  ].filter(Boolean);

  return [...new Set(variants)].map((q) => ({ q }));
}

function searchLocalAddressFallback(queryParts) {
  const streetToken = normalizeAddressToken(queryParts.street || queryParts.original);
  if (!streetToken) return [];

  const knownStreets = [
    {
      tokens: ["ირაკლი აბაშიძის", "აბაშიძის", "irakli abashidze", "abashidze"],
      base: { lat: 41.70717, lng: 44.77018 },
      step: { lat: 0.000015, lng: -0.000035 },
      address: "ირაკლი აბაშიძის ქუჩა",
    },
    {
      tokens: ["საირმის", "საირმე", "sairme"],
      base: { lat: 41.7190, lng: 44.7500 },
      step: { lat: 0.000010, lng: 0.000020 },
      address: "საირმის ქუჩა",
    },
  ];

  const street = knownStreets.find((item) => item.tokens.some((token) => streetToken.includes(normalizeAddressToken(token))));
  if (!street) return [];

  const houseNumber = Number.parseInt(queryParts.houseNumber, 10);
  const offset = Number.isFinite(houseNumber) ? houseNumber - 12 : 0;
  const coords = {
    lat: street.base.lat + (offset * street.step.lat),
    lng: street.base.lng + (offset * street.step.lng),
  };
  const address = `${street.address}${queryParts.houseNumber ? ` ${queryParts.houseNumber}` : ""}`;
  return [{
    lat: coords.lat,
    lng: coords.lng,
    address,
    displayName: `${address}, თბილისი`,
    warning: "გამოყენებულია ლოკალური approximate ძებნა.",
  }];
}

function normalizeOsmSearchResults(results, queryParts) {
  return (Array.isArray(results) ? results : [])
    .map((result) => {
      const coords = getResultCoords(result);
      const address = formatOsmAddress(result, queryParts.street || queryParts.original) || formatCoordsAddress(coords);
      const displayName = cleanAddressInput(result?.display_name || "");
      const acceptedForTbilisi = isWithinTbilisiBounds(coords) || /tbilisi|თბილისი/i.test(displayName);
      return {
        ...result,
        lat: coords.lat,
        lng: coords.lng,
        address,
        displayName,
        acceptedForTbilisi,
      };
    })
    .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng) && result.address && result.acceptedForTbilisi);
}

function rankAddressResults(results, queryParts) {
  const ranked = results
    .map((result) => {
      const score = scoreAddressResult(result, queryParts);
      return {
        ...result,
        score,
        warning: result._addressWarning || (queryParts.houseNumber && !resultHasRequestedHouseNumber(result, queryParts.houseNumber) ? STRINGS.addressStreetFallback : ""),
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked;
}

function scoreAddressResult(result, queryParts) {
  const address = result?.address || {};
  const requestedHouseNumber = queryParts.houseNumber;
  let score = 0;

  if (isWithinTbilisiBounds(getResultCoords(result))) score += 1000;
  if (address.house_number) score += 220;
  if (requestedHouseNumber && isSameHouseNumber(address.house_number, requestedHouseNumber)) score += 650;
  if (requestedHouseNumber && displayNameContainsHouseNumber(result, requestedHouseNumber)) score += 260;
  if (streetMatchesResult(result, queryParts.street)) score += 150;
  if (isBuildingLikeOsmResult(result)) score += 90;
  if (isStreetOnlyOsmResult(result)) score -= 90;
  if (requestedHouseNumber && !resultHasRequestedHouseNumber(result, requestedHouseNumber)) score -= 240;

  return score;
}

function resultHasRequestedHouseNumber(result, houseNumber) {
  return isSameHouseNumber(result?.address?.house_number, houseNumber) || displayNameContainsHouseNumber(result, houseNumber);
}

function isExactHouseNumberResult(result, houseNumber) {
  return isWithinTbilisiBounds(getResultCoords(result)) && resultHasRequestedHouseNumber(result, houseNumber);
}

function isSameHouseNumber(actual, expected) {
  return Boolean(actual && expected && normalizeHouseNumber(actual) === normalizeHouseNumber(expected));
}

function displayNameContainsHouseNumber(result, houseNumber) {
  const normalizedNumber = normalizeHouseNumber(houseNumber);
  if (!normalizedNumber) return false;
  return String(result?.display_name || result?.displayName || "")
    .split(",")
    .some((part) => normalizeHouseNumber(part).includes(normalizedNumber));
}

function streetMatchesResult(result, street) {
  const expected = normalizeAddressToken(street);
  if (!expected) return false;
  const address = result?.address || {};
  const resultStreet = normalizeAddressToken([
    address.road,
    address.pedestrian,
    address.footway,
    address.residential,
    address.neighbourhood,
    result?.display_name,
  ].filter(Boolean).join(" "));
  if (!resultStreet) return false;
  const tokens = expected.split(" ").filter((token) => token.length > 2);
  if (!tokens.length) return resultStreet.includes(expected);
  return tokens.some((token) => resultStreet.includes(token));
}

function isBuildingLikeOsmResult(result) {
  const osmClass = String(result?.class || "").toLocaleLowerCase();
  const osmType = String(result?.type || "").toLocaleLowerCase();
  return ["building", "amenity", "shop", "office", "tourism", "leisure"].includes(osmClass)
    || /house|apartments|residential|yes|building|commercial|retail/.test(osmType);
}

function isStreetOnlyOsmResult(result) {
  const osmClass = String(result?.class || "").toLocaleLowerCase();
  const osmType = String(result?.type || "").toLocaleLowerCase();
  return osmClass === "highway" || /street|road|residential|primary|secondary|tertiary|service/.test(osmType);
}

function dedupeAddressResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    const coords = getResultCoords(result);
    const key = `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}:${cleanAddressInput(result.address).toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function geocodeStreetFromOsm(query) {
  if (!CONFIG.useExternalAddressSearch || !CONFIG.useOverpassSearch) return null;
  const terms = buildStreetSearchTerms(query);
  if (!terms.length) return null;

  for (const term of terms) {
    const data = await fetchOverpassJson(buildStreetOverpassQuery(term)).catch(() => null);
    const element = data?.elements?.find((item) => isWithinTbilisiBounds(getOverpassElementCoords(item)));
    if (!element) continue;

    const coords = getOverpassElementCoords(element);
    const address = cleanAddressInput(element.tags?.name || query);
    if (Number.isFinite(coords.lat) && Number.isFinite(coords.lng) && address) return { ...coords, address };
  }
  return null;
}

function buildStreetOverpassQuery(term) {
  const regex = escapeOverpassRegex(term);
  const [south, west, north, east] = [41.55, 44.60, 41.88, 45.05];
  return `
    [out:json][timeout:10];
    (
      way["highway"]["name"~"${regex}",i](${south},${west},${north},${east});
      relation["highway"]["name"~"${regex}",i](${south},${west},${north},${east});
    );
    out center 12;
  `;
}

function buildStreetSearchTerms(query) {
  const normalized = cleanAddressInput(query)
    .replace(/\d+[A-Za-zა-ჰ/-]*/g, " ")
    .replace(/[.,]/g, " ")
    .replace(/\b(street|st|avenue|ave|lane|ln)\b/gi, " ")
    .replace(/\b(tbilisi|georgia)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutGeorgianType = normalized
    .replace(/\b(ქუჩა|ქ|გამზირი|გამზ|ჩიხი|შესახვევი|გზატკეცილი)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([normalized, withoutGeorgianType].filter((term) => term.length >= 3))];
}

function escapeOverpassRegex(value) {
  return String(value).replace(/["\\^$.*+?()[\]{}|]/g, "\\$&");
}

function getOverpassElementCoords(element) {
  return {
    lat: Number(element?.center?.lat ?? element?.lat),
    lng: Number(element?.center?.lon ?? element?.lon),
  };
}

function cleanAddressInput(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if ([STRINGS.addressLoading, STRINGS.addressMissing].includes(text)) return "";
  if (/^(unknown|undefined|null)$/i.test(text)) return "";
  return text;
}

function getStoredParcelAddress(parcel) {
  return cleanStoredAddress(parcel?.address);
}

function getCachedParcelAddress(parcelId) {
  return cleanAddressInput(state.parcelAddressCache[parcelId]);
}

function cleanStoredAddress(value) {
  const text = cleanAddressInput(value);
  if (!text) return "";
  return text;
}

async function hydratePinAddresses(pins) {
  const unresolved = pins.filter((pin) => !getStoredParcelAddress(pin) && !getCachedParcelAddress(pin.id) && !pin.addressLookupFailed);
  if (!unresolved.length) return;

  for (const [index, pin] of unresolved.entries()) {
    if (state.activePins !== pins) return;
    pin.isResolvingAddress = true;
    const address = await reverseGeocodeCoords(pin);
    pin.isResolvingAddress = false;
    if (address) {
      pin.address = address;
      state.parcelAddressCache[pin.id] = address;
    } else {
      pin.addressLookupFailed = true;
    }
    if (index < unresolved.length - 1) await wait(1100);
  }

  if (state.activePins !== pins) return;
  clearAdminMapPins();
  renderParcelMarkers(state.isAdmin ? filterPinsForAdminMap(pins) : pins);
  if (state.selectedPinId) renderSelectedParcelCard();
}

function hasHouseNumber(value) {
  return /(^|[\s#№N])\d+[A-Za-zა-ჰ]?(?:[-/]\d+[A-Za-zა-ჰ]?)?(\b|$)/.test(String(value || ""));
}

function isCoordinateLabel(value) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(String(value || "").trim());
}

function resetMapSelectionUi() {
  state.mode = "idle";
  state.selectedCourier = null;
  state.pendingCoords = null;
  clearMapObject(state.pendingMarker);
  state.pendingMarker = null;
  state.pendingAddress = "";
  state.pendingAddressWarning = "";
  state.pendingZone = null;
  state.pendingAutoAssignment = null;
  els.menuButton.hidden = false;
  els.modeToast.hidden = true;
}

function startLocationWatch() {
  if (!navigator.geolocation || state.watchId || !state.map) return;

  state.watchId = navigator.geolocation.watchPosition((position) => {
    state.currentPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    state.hasCurrentPosition = true;

    if (!state.locationMarker) {
      state.locationMarker = createCircleMarker(state.currentPosition, {
        radius: 8,
        fillColor: "#24566f",
        color: "#fff",
        weight: 2,
        fillOpacity: 1,
      });
    } else {
      setMarkerPosition(state.locationMarker, state.currentPosition);
    }

  }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
}

function scheduleMidnightRefresh() {
  if (state.midnightTimer) window.clearTimeout(state.midnightTimer);
  if (!state.currentUser || state.isAdmin) {
    state.midnightTimer = null;
    return;
  }

  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 1, 0);
  state.midnightTimer = window.setTimeout(handleMidnightRefresh, Math.max(1000, midnight.getTime() - now.getTime()));
}

async function handleMidnightRefresh() {
  state.midnightTimer = null;
  if (!state.currentUser || state.isAdmin) return;

  await archiveDeliveredParcelsForDay(state.currentUser).catch(() => {});
  await refreshPins();
  if (state.activeDialogTitle === "ჩემი დღე") await openTodayStats();
  scheduleMidnightRefresh();
}

async function archiveDeliveredParcelsForDay(courierUsername) {
  const pins = await getPins(courierUsername);
  const deliveredPins = pins.filter(isCompletedParcelStatus);
  if (!deliveredPins.length) return { archived: 0 };
  return api("/api/parcels/archive", {
    method: "POST",
    body: {
      courierUsername,
      status: "delivered",
      parcelIds: deliveredPins.map((pin) => pin.id),
    },
  });
}

function showDialog(title, body, actions = []) {
  state.activeDialogTitle = title;
  els.dialogModal.classList.remove("history-dialog");
  els.dialogModal.classList.remove("admin-map-dialog");
  els.dialogModal.classList.remove("courier-stats-dialog");
  els.dialogModal.classList.remove("zone-management-dialog");
  els.dialogTitle.textContent = title;
  els.dialogBody.innerHTML = body;
  els.dialogActions.innerHTML = "";

  actions.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${item.variant || "secondary"}`;
    button.textContent = item.label;
    button.addEventListener("click", item.action);
    els.dialogActions.append(button);
  });

  showModal(els.dialogModal);
}

function closeDialog() {
  state.activeDialogTitle = "";
  els.dialogModal.classList.remove("history-dialog");
  els.dialogModal.classList.remove("admin-map-dialog");
  els.dialogModal.classList.remove("courier-stats-dialog");
  els.dialogModal.classList.remove("zone-management-dialog");
  hideModal(els.dialogModal);
  els.dialogTitle.textContent = "";
  els.dialogBody.textContent = "";
  els.dialogActions.textContent = "";
}

function showModal(element) {
  element.classList.add("active");
}

function hideModal(element) {
  element.classList.remove("active");
}

function setMessage(element, text, isError) {
  element.textContent = text;
  element.style.color = isError ? "var(--danger)" : "var(--success)";
}

function showToast(message) {
  els.modeToast.hidden = false;
  els.modeToast.textContent = message;
  window.setTimeout(() => {
    if (state.mode === "idle") els.modeToast.hidden = true;
  }, 2600);
}

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.midnightTimer) window.clearTimeout(state.midnightTimer);
  resetMapSelectionUi();
  state.watchId = null;
  state.midnightTimer = null;
  state.currentUser = null;
  state.authToken = null;
  state.isAdmin = false;
  state.hasCurrentPosition = false;
  state.activePins = [];
  clearActiveRoute();
  clearParcelOverlays();
  clearHistoryPreviewMarker();
  hideSelectedParcelCard();
  renderCourierStatsCard([]);
  els.loginForm.reset();
  showModal(els.authModal);
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
  const amount = Number(value || 0);
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
  const value = [parcel?.paymentAmount, parcel?.payment, parcel?.amount, parcel?.price, parcel?.codAmount]
    .find((item) => item !== undefined && item !== null && item !== "");
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function getCourierPay(parcel) {
  return parcel?.status === "delivered" ? CONFIG.courierDeliveryPay : 0;
}

function getAdminProfit(parcel) {
  return parcel?.status === "delivered" ? CONFIG.adminDeliveryProfit : 0;
}

function getDeliveryTotal(parcel) {
  return parcel?.status === "delivered" ? CONFIG.deliveryTotalPrice : 0;
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

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
