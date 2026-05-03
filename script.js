"use strict";

const CONFIG = {
  center: [41.7151, 44.8271],
  courierDeliveryPay: 3.5,
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
};

const state = {
  map: null,
  markers: null,
  currentUser: null,
  authToken: null,
  isAdmin: false,
  activePins: [],
  currentPosition: { lat: CONFIG.center[0], lng: CONFIG.center[1] },
  hasCurrentPosition: false,
  watchId: null,
  locationMarker: null,
  routeLayer: null,
  routePinId: null,
  selectedPinId: null,
  selectedParcelCardCollapsed: false,
  parcelAddressCache: {},
  selectedCourier: null,
  pendingCoords: null,
  pendingMarker: null,
  pendingAddress: "",
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
    toggleActions();
  });
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
  if (!response.ok) throw new Error(payload.error || STRINGS.serverFailed);
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
        ["addParcel", "პინის დამატება"],
        ["adminCloseDay", "დღის დახურვა"],
        ["parcelHistory", "ამანათის ისტორია"],
        ["logout", "გასვლა"],
      ]
    : [
        ["today", "ჩემი დღე"],
        ["history", "ჩემი ისტორია"],
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
    addParcel: openAdminAddParcel,
    adminCloseDay: openAdminCloseDay,
    parcelHistory: openParcelHistorySearch,
    analytics: openAnalyticsPicker,
    changePassword: openPasswordDialog,
    route: openCourierRoute,
    today: openTodayStats,
    history: () => openCalendar(state.currentUser, "ჩემი ისტორია"),
    endDay: confirmEndDay,
    approve: () => approveCourier(value),
    reject: () => rejectCourier(value),
    chooseCourier: () => openAddressSearchDialog(value),
    openCourierAnalytics: () => openCalendar(value, `${value} ანალიტიკა`),
    adminStatsUser: () => openAdminStatsChoice(value),
    adminStatsDay: () => openAdminUserDay(value),
    adminStatsHistory: () => openCalendar(value, `${value} ისტორია`),
    editUser: () => openUserEditDialog(value),
    deleteUser: () => confirmUserDelete(value),
    assignSelectedPins: assignSelectedPins,
    parcelHistorySearch: searchParcelHistory,
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
  return (await api("/api/couriers")).couriers;
}

async function getUsers() {
  return (await api("/api/users")).users;
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
  clearParcelOverlays();
  state.activePins = [];

  if (!state.currentUser || !state.map) {
    hideSelectedParcelCard();
    renderCourierStatsCard([]);
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
  renderParcelMarkers(pins);
  hydratePinAddresses(pins);
  renderCourierStatsCard(pins);
  if (state.routePinId && !pins.some((pin) => pin.id === state.routePinId)) clearActiveRoute();

  if (selectedPinId && pins.some((pin) => pin.id === selectedPinId)) {
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
      stopMapClick(event);
      openParcelTab(pin.id);
    });
    renderPinLabel(pin);
  });
}

function renderPinLabel(pin) {
  const payment = getPaymentAmount(pin);
  const address = getParcelAddress(pin);
  const courier = parcelCourierDisplayName(pin);
  const courierPhone = parcelCourierPhone(pin);
  addParcelOverlay(new HtmlMapLabel(pin, `
        <div class="pin-label-card">
          <strong class="pin-label-address">${escapeHtml(address)}</strong>
          <span class="pin-label-name">${escapeHtml(pin.fullName)}</span>
          ${state.isAdmin ? `<span class="pin-label-name">${escapeHtml(courier)} / ${escapeHtml(getStatusLabel(pin.status))}</span>` : ""}
          ${state.isAdmin && courierPhone ? `<span class="pin-label-name">${escapeHtml(courierPhone)}</span>` : ""}
          ${payment > 0 ? `<span class="pin-label-payment">${escapeHtml(formatPinMoney(payment))}</span>` : ""}
        </div>
      `));
}

function renderCourierStatsCard(pins = state.activePins) {
  if (state.isAdmin || !state.currentUser) {
    els.courierStatsCard.hidden = true;
    els.courierStatsCard.textContent = "";
    return;
  }

  const pending = pins.filter((pin) => pin.status === "pending").length;
  const deliveredPins = pins.filter((pin) => pin.status === "delivered");
  const failed = pins.filter((pin) => pin.status === "failed").length;
  els.courierStatsCard.hidden = false;
  els.courierStatsCard.innerHTML = `
    <div><span>დარჩენილი</span><strong>${pending}</strong></div>
    <div><span>ჩაბარდა</span><strong>${deliveredPins.length}</strong></div>
    <div><span>არ ჩაბარდა</span><strong>${failed}</strong></div>
    <div><span>ჩემი თანხა</span><strong>${escapeHtml(formatMoney(sumCourierPay(deliveredPins)))}</strong></div>
  `;
}

function createCircleMarker(coords, options) {
  return L.circleMarker(toLeafletLatLng(coords), {
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

function getTbilisiViewbox() {
  return "44.60,41.88,45.05,41.55";
}

function buildOsmUrl(path, params) {
  const url = new URL(path, "https://nominatim.openstreetmap.org");
  Object.entries(params).forEach(([key, value]) => {
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
  const response = await fetch(buildOsmUrl(path, params), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("მისამართის ძებნის სერვერმა შეცდომა დააბრუნა.");
  return response.json();
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
  const streetName = address.road || address.pedestrian || address.footway || address.residential || address.neighbourhood || "";
  const houseNumber = address.house_number || "";
  if (streetName && houseNumber) return cleanAddressInput(`${streetName} ${houseNumber}`);
  if (streetName) return cleanAddressInput(houseNumber ? `${streetName} ${houseNumber}` : streetName);

  const displayAddress = cleanStoredAddress(result?.display_name || "");
  if (displayAddress) return displayAddress;

  const fallbackAddress = cleanAddressInput(fallback);
  if (fallbackAddress) return fallbackAddress;
  return "";
}

function isTbilisiOsmResult(result) {
  if (!isWithinTbilisiBounds(getResultCoords(result))) return false;
  const address = result?.address || {};
  return [address.city, address.town, address.municipality, address.county, result?.display_name]
    .filter(Boolean)
    .some((value) => /tbilisi|თბილისი/i.test(String(value)));
}

function getResultCoords(result) {
  return { lat: Number(result?.lat), lng: Number(result?.lon) };
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
  return parcel?.status === "delivered" || parcel?.status === "failed";
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
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
  const users = (await getUsers()).filter((user) => user.role === "courier");
  const body = users.length
    ? users.map((user) => `<button class="list-button" type="button" data-action="adminStatsUser" data-value="${escapeAttr(user.username)}">${escapeHtml(userDisplayName(user))}</button>`).join("")
    : `<p>${STRINGS.noCouriers}</p>`;
  showDialog("კურიერის სტატისტიკა", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}

function openAdminStatsChoice(username) {
  const safeUsername = escapeAttr(username);
  showDialog("კურიერის სტატისტიკა", `
    <div class="stats-card">
      <strong>${escapeHtml(username)}</strong>
      <span>აირჩიეთ სასურველი სტატისტიკა</span>
    </div>
    <div class="row-actions">
      <button class="button" type="button" data-action="adminStatsDay" data-value="${safeUsername}">დღე</button>
      <button class="button secondary" type="button" data-action="adminStatsHistory" data-value="${safeUsername}">ისტორია</button>
    </div>
  `, [{ label: "უკან", variant: "secondary", action: openAdminStatsUsers }]);
}

async function openAdminUserDay(username) {
  const stats = await calculateStats(username, getStartOfToday());
  showDialog(`${username} დღე`, await renderStats(stats), [
    { label: "უკან", variant: "secondary", action: () => openAdminStatsChoice(username) },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}

async function openAdminMap() {
  await refreshPins();
  const pins = state.activePins;
  const couriers = await getCouriers();
  const courierOptions = couriers.map((user) => `<option value="${escapeAttr(user.username)}">${escapeHtml(userDisplayName(user))}</option>`).join("");
  const rows = pins.map((pin) => `
    <label class="pin-select-row">
      <input type="checkbox" name="assignPin" value="${escapeAttr(pin.id)}">
      <span>
        <strong>${escapeHtml(pin.fullName)}</strong>
        <small>${escapeHtml(parcelCourierDisplayName(pin))}${parcelCourierPhone(pin) ? ` / ${escapeHtml(parcelCourierPhone(pin))}` : ""} / ${escapeHtml(getStatusLabel(pin.status))}</small>
      </span>
      <button class="mini-button" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">რუკა</button>
    </label>
  `).join("");
  const body = `
    <div class="history-summary">
      <strong>აქტიური პინები: ${pins.length}</strong>
      <div class="history-metrics">
        <span><b>${pins.filter((pin) => pin.status === "delivered").length}</b> ჩაბარდა</span>
        <span><b>${pins.filter((pin) => pin.status === "failed").length}</b> არ ჩაბარდა</span>
        <span><b>${pins.filter((pin) => pin.status === "pending").length}</b> პროცესშია</span>
        <span><b>${pins.filter((pin) => !pin.courierUsername).length}</b> მიუბმელი</span>
      </div>
    </div>
    <label for="assignCourier">მიბმა კურიერზე</label>
    <select id="assignCourier">${courierOptions}</select>
    <div class="pin-select-list">${rows || "<p class=\"history-empty\">აქტიური ამანათი არ არის.</p>"}</div>
    <p class="form-message" id="assignPinsMessage" role="alert"></p>
  `;
  const actions = pins.length && couriers.length
    ? [
        { label: "მონიშნულის მიბმა", variant: "primary", action: assignSelectedPins },
        { label: "დახურვა", variant: "secondary", action: closeDialog },
      ]
    : [{ label: "დახურვა", variant: "secondary", action: closeDialog }];
  showDialog("ადმინ მაპ", body, actions);
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

async function openUserManagement() {
  const users = await getUsers();
  const body = users.map((user) => `
    <div class="parcel-row">
      <strong>${escapeHtml(userDisplayName(user))}</strong>
      <span>${escapeHtml(roleLabel(user.role))}${user.phone ? ` / ${escapeHtml(user.phone)}` : ""}</span>
      <div class="row-actions">
        <button class="button secondary" type="button" data-action="editUser" data-value="${escapeAttr(user.username)}">რედაქტირება</button>
        <button class="button danger" type="button" data-action="deleteUser" data-value="${escapeAttr(user.username)}" ${user.role === "admin" ? "disabled" : ""}>დეაქტივაცია</button>
      </div>
    </div>
  `).join("");
  showDialog("კურიერი", body || "<p>კურიერი არ არის.</p>", [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
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
  const failed = closablePins.filter((pin) => pin.status === "failed").length;
  const pending = pins.filter((pin) => pin.status === "pending").length;
  const closable = delivered + failed;
  const courierStats = buildCloseDayCourierStats(couriers, closablePins);
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
    <p>დღის დახურვა რუკიდან წაშლის მხოლოდ ჩაბარებულ და არ ჩაბარებულ პინებს. პროცესში დარჩენილი პინები რჩება.</p>
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
          <span>კომპანია: ${escapeHtml(formatMoney(sumPayments(deliveredPins)))}</span>
          <span>კურიერი: ${escapeHtml(formatMoney(sumCourierPay(deliveredPins)))}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function closeAdminDay() {
  const payload = await api("/api/parcels/archive", { method: "POST", body: {} });
  closeDialog();
  await refreshPins();
  showToast(`${payload.archived} პინი გადავიდა ისტორიაში.`);
}

function openParcelHistorySearch() {
  const body = `
    <form id="parcelHistoryForm" class="address-search-form">
      <label for="parcelHistoryQuery">ძებნა სახელით ან მობილურით</label>
      <div class="address-search-row">
        <input id="parcelHistoryQuery" type="search" autocomplete="off">
        <button class="button primary" type="submit">ძებნა</button>
      </div>
    </form>
    <div id="parcelHistoryResults" class="history-results"></div>
  `;
  showDialog("ამანათის ისტორია", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
  document.getElementById("parcelHistoryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    searchParcelHistory();
  });
}

async function searchParcelHistory() {
  const query = document.getElementById("parcelHistoryQuery")?.value.trim() || "";
  const results = document.getElementById("parcelHistoryResults");
  const parcels = await searchParcels(query);
  const rows = (await Promise.all(parcels.map(renderParcelHistoryRow))).join("");
  if (results) results.innerHTML = rows || "<p class=\"history-empty\">ამანათი ვერ მოიძებნა.</p>";
}

function openAddressSearchDialog(username) {
  const body = `
    <form id="addressSearchForm" class="address-search-form">
      <label for="addressSearchInput">მისამართის ძებნა თბილისში</label>
      <div class="address-search-row">
        <input id="addressSearchInput" type="search" autocomplete="street-address" required>
        <button class="button primary" type="submit">ძებნა</button>
      </div>
      <p id="addressSearchMessage" class="form-message" role="alert"></p>
    </form>
  `;

  showDialog(state.isAdmin ? "რუკაზე პინის დამატება" : "მისამართის დამატება", body, [
    { label: "რუკაზე არჩევა", variant: "secondary", action: () => startMapSelection(username) },
    { label: "გაუქმება", variant: "secondary", action: closeDialog },
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
    return;
  }
  if (!event.latlng) return;
  state.pendingCoords = toCoords(event.latlng);
  state.pendingAddress = "";
  setMapView(state.pendingCoords, Math.max(getMapZoom(), 17));
  showPendingMarker(state.pendingCoords);
  els.modeToast.hidden = false;
  els.modeToast.textContent = STRINGS.addressLoading;
  state.pendingAddress = await reverseGeocodeCoords(state.pendingCoords);
  els.modeToast.hidden = true;
  await openParcelDetailsDialog();
}

async function openParcelDetailsDialog() {
  const address = getPendingAddressLabel();
  const couriers = state.isAdmin ? await getCouriers() : [];
  const courierOptions = couriers.map((user) => `<option value="${escapeAttr(user.username)}" ${state.selectedCourier === user.username ? "selected" : ""}>${escapeHtml(userDisplayName(user))}</option>`).join("");
  const body = `
    <label for="parcelAddress">მისამართი</label>
    <input id="parcelAddress" type="text" autocomplete="street-address" value="${escapeAttr(address)}" placeholder="ქუჩა და შენობის ნომერი">
    <label for="parcelName">მიმღების სახელი</label>
    <input id="parcelName" type="text" autocomplete="name">
    <label for="parcelPhone">მობილური</label>
    <input id="parcelPhone" type="tel" autocomplete="tel">
    <label for="parcelPaymentAmount">გადასახდელი თანხა</label>
    <input id="parcelPaymentAmount" type="text" inputmode="decimal" autocomplete="off" value="0">
    ${state.isAdmin ? `
      <label for="parcelCourier">კურიერზე მიბმა</label>
      <select id="parcelCourier">
        <option value="">მიუბმელი პინი</option>
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
  const address = cleanAddressInput(document.getElementById("parcelAddress")?.value.trim() || getPendingAddressLabel());
  const amountInput = document.getElementById("parcelPaymentAmount");
  const paymentAmount = parsePaymentAmount(amountInput?.value);
  const courierUsername = state.isAdmin ? (document.getElementById("parcelCourier")?.value || "") : state.selectedCourier;
  if (!fullName || !phone || !state.pendingCoords || (!state.isAdmin && !courierUsername)) return;
  if (!address || !hasHouseNumber(address)) return showToast(STRINGS.addressRequired);
  if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return showToast("შეიყვანეთ სწორი თანხა.");

  await api("/api/parcels", {
    method: "POST",
    body: {
      courierUsername,
      lat: state.pendingCoords.lat,
      lng: state.pendingCoords.lng,
      address,
      fullName,
      phone,
      paymentAmount,
    },
  });

  const shouldRefresh = state.isAdmin || courierUsername === state.currentUser;
  cancelMapSelection();
  closeDialog();
  if (shouldRefresh) await refreshPins();
  showToast(STRINGS.parcelAdded);
}

async function handleAddressSearch(event, username) {
  event.preventDefault();
  const query = document.getElementById("addressSearchInput")?.value.trim();
  const message = document.getElementById("addressSearchMessage");
  if (!query) return;

  try {
    if (message) message.textContent = STRINGS.addressLoading;
    const result = await geocodeAddress(query);
    if (!result) {
      if (message) message.textContent = "მისამართი თბილისში ვერ მოიძებნა.";
      return;
    }
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Invalid coordinates.");
    closeDialog();
    state.selectedCourier = username;
    state.pendingCoords = { lat, lng };
    state.pendingAddress = result.address;
    showPendingMarker(state.pendingCoords);
    state.mode = "selectingParcel";
    els.menuButton.hidden = true;
    els.modeToast.hidden = true;
    setMapView({ lat, lng }, 17);
    await openParcelDetailsDialog();
  } catch {
    if (message) message.textContent = "მისამართის ძებნა ვერ მოხერხდა.";
  }
}

async function updatePinStatus(pinId, status) {
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

  await api(`/api/parcels/${encodeURIComponent(pinId)}/status`, {
    method: "PATCH",
    body: {
      status,
      currentLat: state.currentPosition?.lat,
      currentLng: state.currentPosition?.lng,
    },
  });
  if (state.routePinId === pinId) clearActiveRoute();
  await refreshPins();
}

async function openTodayStats() {
  const stats = await calculateStats(state.currentUser, getStartOfToday());
  showDialog("ჩემი დღე", await renderStats(stats), [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
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
          <span>თანხა: ${escapeHtml(formatMoney(getPaymentAmount(pin)))}</span>
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
  const history = (await getHistory(username)).filter((item) => toDateKey(new Date(item.archivedAt || item.createdAt)) === dateKey);
  const delivered = history.filter((item) => item.status === "delivered").length;
  const failed = history.filter((item) => item.status === "failed").length;
  const companyTotal = sumPayments(history);
  const courierPay = sumCourierPay(history);
  const rows = (await Promise.all(history.map(async (item) => {
    const payment = getPaymentAmount(item);
    const status = getStatusLabel(item.status);
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    return `
    <div class="history-row">
      <div class="history-row-main">
        <strong>${escapeHtml(item.fullName)}</strong>
        <span class="history-status status-${item.status}">${status}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      <div class="history-row-meta">
        <span>კომპანია: ${escapeHtml(formatMoney(payment))}</span>
        ${itemCourierPay > 0 ? `<span class="history-pay">კურიერი: ${escapeHtml(formatMoney(itemCourierPay))}</span>` : ""}
        <span>${formatDateTime(item.archivedAt || item.createdAt)}</span>
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
        <span><b>${escapeHtml(formatMoney(companyTotal))}</b> კომპანიის თანხა</span>
        <span><b>${escapeHtml(formatMoney(courierPay))}</b> კურიერის თანხა</span>
      </div>
    </div>
    <div class="history-list">${rows || "<p class=\"history-empty\">ამ თარიღზე დახურული ამანათი არ არის.</p>"}</div>
  `;
}

async function confirmEndDay() {
  const pins = await getPins(state.currentUser);
  const total = sumPayments(pins);
  showDialog("დღის დახურვა", `<p>დასრულებული ამანათები გადავიდეს ისტორიაში?</p><div class="stats-card">დღის თანხა: <strong>${formatMoney(total)}</strong></div>`, [
    { label: "დახურვა", variant: "primary", action: archiveDay },
    { label: "გაუქმება", variant: "secondary", action: closeDialog },
  ]);
}

async function archiveDay() {
  const pins = await getPins(state.currentUser);
  if (!pins.length) {
    closeDialog();
    showToast(STRINGS.noParcels);
    return;
  }
  const total = sumPayments(pins);

  await api("/api/parcels/archive", { method: "POST", body: { courierUsername: state.currentUser } });
  closeDialog();
  await refreshPins();
  showToast(`${STRINGS.dayArchived} ჯამი: ${formatMoney(total)}`);
}

async function calculateStats(username, sinceDate) {
  const active = await getPins(username);
  const history = await getHistory(username);
  const records = [...active, ...history]
    .filter((pin) => new Date(pin.completedAt || pin.archivedAt || pin.createdAt) >= sinceDate);
  const delivered = records.filter((pin) => pin.status === "delivered").length;
  const failed = records.filter((pin) => pin.status === "failed").length;
  return { delivered, failed, companyTotal: sumPayments(records), courierPay: sumCourierPay(records), records };
}

async function renderStats(stats) {
  const rows = (await Promise.all(stats.records.map(async (item) => {
    const payment = getPaymentAmount(item);
    const address = await resolveParcelAddress(item);
    const itemCourierPay = getCourierPay(item);
    return `
    <div class="history-row">
      <div class="history-row-main">
        <strong>${escapeHtml(item.fullName)}</strong>
        <span class="history-status status-${item.status}">${capitalize(item.status)}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      <div class="history-row-meta">
        <span>კომპანია: ${escapeHtml(formatMoney(payment))}</span>
        ${itemCourierPay > 0 ? `<span class="history-pay">კურიერი: ${escapeHtml(formatMoney(itemCourierPay))}</span>` : ""}
        <span>${formatDateTime(item.completedAt || item.archivedAt || item.createdAt)}</span>
      </div>
    </div>
  `;
  }))).join("");

  return `
    <div class="history-summary">
      <strong>დღეს</strong>
      <div class="history-metrics">
        <span><b>${stats.delivered}</b> ჩაბარდა</span>
        <span><b>${stats.failed}</b> არ ჩაბარდა</span>
        <span><b>${escapeHtml(formatMoney(stats.companyTotal))}</b> კომპანიის თანხა</span>
        <span><b>${escapeHtml(formatMoney(stats.courierPay))}</b> კურიერის თანხა</span>
      </div>
    </div>
    <div class="history-list">${rows || "<p class=\"history-empty\">დღეს ამანათი არ არის.</p>"}</div>
  `;
}

async function renderParcelHistoryRow(item) {
  const payment = getPaymentAmount(item);
  const address = await resolveParcelAddress(item);
  const archivedText = item.archivedAt ? `დახურვის დრო: ${formatDateTime(item.archivedAt)}` : "აქტიური";
  return `
    <div class="history-row">
      <div class="history-row-main">
        <strong>${escapeHtml(item.fullName || "")}</strong>
        <span class="history-status status-${item.status}">${escapeHtml(getStatusLabel(item.status))}</span>
      </div>
      <div class="history-address">${escapeHtml(address)}</div>
      <div class="history-row-meta">
        <span>კურიერი: ${escapeHtml(parcelCourierDisplayName(item))}${parcelCourierPhone(item) ? ` / ${escapeHtml(parcelCourierPhone(item))}` : ""}</span>
        <span>მობილური: ${escapeHtml(item.phone || "")}</span>
        <span>თანხა: ${escapeHtml(formatMoney(payment))}</span>
        <span>შექმნის დრო: ${formatDateTime(item.createdAt)}</span>
        <span>${archivedText}</span>
      </div>
    </div>
  `;
}

function openParcelTab(pinId, options = {}) {
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
        <span>თანხა</span>
        <strong>${payment > 0 ? escapeHtml(formatMoney(payment)) : "თანხა არ არის"}</strong>
      </div>
      <div class="nearest-detail">
        <span>სტატუსი</span>
        <strong class="status-${pin.status}">${statusText}</strong>
      </div>
      ${state.isAdmin ? `
        <div class="nearest-detail">
          <span>კურიერი</span>
          <div class="nearest-detail-stack">
            <strong>${escapeHtml(courierName)}</strong>
            ${courierPhone ? `<a class="phone-link" href="${escapeAttr(courierPhoneHref)}">${escapeHtml(courierPhone)}</a>` : ""}
          </div>
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

async function reverseGeocodeCoords(coords) {
  if (!coords) return "";

  try {
    const result = await fetchOsmJson("/reverse", {
      format: "jsonv2",
      lat: coords.lat,
      lon: coords.lng,
      zoom: 18,
      addressdetails: 1,
      "accept-language": "ka,en",
    });
    return formatOsmAddress(result, "");
  } catch {
    return "";
  }
}

async function geocodeAddress(query) {
  const searchParamsList = [
    { q: `${query}, თბილისი, საქართველო` },
    { q: `${query}, Tbilisi, Georgia` },
    { street: query, city: "Tbilisi", country: "Georgia" },
    { q: query },
  ];
  const results = [];
  for (const params of searchParamsList) {
    const batch = await fetchOsmJson("/search", {
      format: "jsonv2",
      ...params,
      addressdetails: 1,
      limit: 5,
      countrycodes: "ge",
      viewbox: getTbilisiViewbox(),
      bounded: 1,
      "accept-language": "ka,en",
    }).catch(() => []);
    results.push(...batch);
    if (batch.some(isTbilisiOsmResult)) break;
  }
  const result = results.find(isTbilisiOsmResult) || results.find((item) => isWithinTbilisiBounds(getResultCoords(item)));
  const coords = getResultCoords(result);
  const address = formatOsmAddress(result, query);
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || !address) return geocodeStreetFromOsm(query);
  return { ...coords, address };
}

async function geocodeStreetFromOsm(query) {
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
  if (!text || isCoordinateLabel(text)) return "";
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
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (!hasHouseNumber(text)) return "";
  if (parts.length > 2) return hasHouseNumber(parts[0]) ? parts[0] : "";
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
  clearParcelOverlays();
  renderParcelMarkers(pins);
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

  await refreshPins();
  if (state.activeDialogTitle === "ჩემი დღე") await openTodayStats();
  scheduleMidnightRefresh();
}

function showDialog(title, body, actions = []) {
  state.activeDialogTitle = title;
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
  return `${value.toFixed(2)} ლარი`;
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
  const amount = Number(parcel?.paymentAmount || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function getCourierPay(parcel) {
  return parcel?.status === "delivered" ? CONFIG.courierDeliveryPay : 0;
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
  return parcels.reduce((total, parcel) => total + getPaymentAmount(parcel), 0);
}

function sumCourierPay(parcels) {
  return parcels.reduce((total, parcel) => total + getCourierPay(parcel), 0);
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
