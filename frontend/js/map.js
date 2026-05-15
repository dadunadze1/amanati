"use strict";



const COURIER_LOCATION_REFRESH_MS = 60000;
const COURIER_LOCATION_VISIBLE_MS = 120000;


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
  state.map.on("zoomend", () => {
    if (!state.currentUser) return;
    rerenderCurrentMapPins();
  });
  bindMapResizeInvalidation();
  scheduleMapInvalidateSize();
}


function scheduleMapInvalidateSize(delay = 300) {
  setTimeout(() => {
    state.map?.invalidateSize();
  }, delay);
}


function bindMapResizeInvalidation() {
  const scheduleResize = () => scheduleMapInvalidateSize();
  window.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("orientationchange", scheduleResize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleResize();
  });
  window.visualViewport?.addEventListener("resize", scheduleResize, { passive: true });
}


function renderParcelMarkers(pins) {
  getClusteredPinGroups(pins).forEach((group) => {
    if (group.length > 1) {
      renderPinCluster(group);
      return;
    }
    renderSinglePinMarker(group[0]);
  });
}


function renderSinglePinMarker(pin) {
  if (!pin) return;
  const isSelected = pin.id && pin.id === state.selectedPinId;
  const marker = createPremiumParcelPinMarker(pin, {
    selected: isSelected,
    pulse: isSelected,
    interactive: true,
    zIndexOffset: isSelected ? 220 : 120,
  });

  addParcelOverlay(marker);
  marker.on("click", (event) => {
    handlePinMarkerClick(pin, event);
  });
  if (isSelected) marker.bringToFront?.();
  renderPinLabel(pin);
}


function handlePinMarkerClick(pin, event) {
  stopMapClick(event);
  if (!pin?.id) return;
  openParcelTab(pin.id, { closeOpenDialog: state.isAdmin, focus: true });
}


function getClusteredPinGroups(pins) {
  const sourcePins = (Array.isArray(pins) ? pins : []).filter((pin) => Number.isFinite(Number(pin.lat)) && Number.isFinite(Number(pin.lng)));
  if (!state.isAdmin || !state.map || getMapZoom() >= 17 || sourcePins.length < 2) return sourcePins.map((pin) => [pin]);

  const clusterRadius = getMapZoom() <= 13 ? 58 : 44;
  const clusters = [];
  sourcePins.forEach((pin) => {
    if (pin.id && pin.id === state.selectedPinId) {
      clusters.push({ pins: [pin], point: state.map.latLngToLayerPoint(toLeafletLatLng(pin)), locked: true });
      return;
    }

    const point = state.map.latLngToLayerPoint(toLeafletLatLng(pin));
    const target = clusters.find((cluster) => !cluster.locked && point.distanceTo(cluster.point) <= clusterRadius);
    if (!target) {
      clusters.push({ pins: [pin], point });
      return;
    }

    target.pins.push(pin);
    target.point = L.point(
      ((target.point.x * (target.pins.length - 1)) + point.x) / target.pins.length,
      ((target.point.y * (target.pins.length - 1)) + point.y) / target.pins.length,
    );
  });

  return clusters.map((cluster) => cluster.pins);
}


function renderPinCluster(pins) {
  const center = getClusterCenter(pins);
  const delivered = pins.filter((pin) => pin.status === "delivered").length;
  const failed = pins.filter((pin) => pin.status === "failed").length;
  const pending = pins.length - delivered - failed;
  const dominantStatus = failed ? "failed" : delivered >= pending ? "delivered" : "pending";
  const marker = L.marker(toLeafletLatLng(center), {
    interactive: true,
    icon: L.divIcon({
      className: `dispatch-cluster-icon dispatch-cluster-icon--${dominantStatus}`,
      html: `<span>${pins.length}</span><small>${pending}/${delivered}/${failed}</small>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    }),
  }).addTo(state.map);

  addParcelOverlay(marker);
  marker.on("click", (event) => {
    event.originalEvent?.stopPropagation?.();
    stopMapClick(event);
    if (getMapZoom() < 17) {
      const bounds = L.latLngBounds(pins.map((pin) => toLeafletLatLng(pin)));
      state.map.fitBounds(bounds, { padding: [44, 44], maxZoom: 17 });
    }
  });
}


function getClusterCenter(pins) {
  const totals = pins.reduce((acc, pin) => ({
    lat: acc.lat + Number(pin.lat),
    lng: acc.lng + Number(pin.lng),
  }), { lat: 0, lng: 0 });
  return {
    lat: totals.lat / pins.length,
    lng: totals.lng / pins.length,
  };
}


function renderPinLabel(pin) {
  if (!shouldShowPinLabel(pin)) return;

  const payment = getPaymentAmount(pin);
  const address = getParcelAddress(pin);
  const courier = parcelCourierDisplayName(pin);
  const statusLabel = getStatusLabel(pin.status);
  addParcelOverlay(new HtmlMapLabel(pin, `
        <div class="pin-label-card pin-label-status-${escapeAttr(pin.status)} ${pin.id === state.selectedPinId ? "is-selected" : ""}">
          <strong class="pin-label-address">${escapeHtml(address)}</strong>
          <span class="pin-label-name">${escapeHtml(pin.fullName || "უსახელო")}</span>
          ${state.isAdmin ? `<span class="pin-label-courier">${escapeHtml(courier)}</span>` : ""}
          <span class="pin-label-meta">
            <b>${escapeHtml(statusLabel)}</b>
            ${payment > 0 ? `<em>${escapeHtml(formatPinMoney(payment))}</em>` : ""}
          </span>
        </div>
      `));
}


function shouldShowPinLabel(pin) {
  if (state.isAdmin) return pin?.id === state.selectedPinId;
  return pin?.id === state.selectedPinId || getMapZoom() >= 16;
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
  renderCourierLocationMarkers();
}


async function renderCourierStatsCard(pins = state.activePins) {
  if (!state.isAdmin && window.matchMedia?.("(max-width: 1180px)")?.matches) {
    els.courierStatsCard.hidden = true;
    els.courierStatsCard.textContent = "";
    if (typeof collapseCourierStatsSheet === "function") collapseCourierStatsSheet();
    return;
  }

  if (state.isAdmin || !state.currentUser) {
    els.courierStatsCard.hidden = true;
    els.courierStatsCard.textContent = "";
    if (typeof collapseCourierStatsSheet === "function") collapseCourierStatsSheet();
    return;
  }

  const username = state.currentUser;
  const pending = pins.filter((pin) => pin.status === "pending").length;
  const deliveredPins = pins.filter((pin) => pin.status === "delivered");
  const failed = pins.filter((pin) => pin.status === "failed").length;
  if (username !== state.currentUser) return;
  els.courierStatsCard.hidden = false;
  if (!els.courierStatsCard.classList.contains("expanded")) {
    els.courierStatsCard.classList.add("collapsed");
  }
  els.courierStatsCard.setAttribute("aria-expanded", els.courierStatsCard.classList.contains("expanded") ? "true" : "false");
  els.courierStatsCard.innerHTML = `
    <div class="bottom-sheet-handle" role="button" tabindex="0" aria-label="სტატისტიკის პანელის გაშლა"></div>
    <div class="courier-map-stats-row"><span>დარჩენილი</span><strong>${pending}</strong></div>
    <div class="courier-map-stats-row"><span>ჩაბარდა</span><strong>${deliveredPins.length}</strong></div>
    <div class="courier-map-stats-row"><span>არ ჩაბარდა</span><strong>${failed}</strong></div>
  `;
}


function createCircleMarker(coords, options) {
  return L.circleMarker(toLeafletLatLng(coords), {
    interactive: true,
    bubblingMouseEvents: false,
    radius: options.radius || 10,
    fillColor: options.fillColor,
    fillOpacity: options.fillOpacity ?? 1,
    color: options.color || "#fff",
    opacity: options.opacity ?? 1,
    weight: options.weight || 2,
    className: options.className || "",
  }).addTo(state.map);
}


function createPremiumParcelPinMarker(pin, options = {}) {
  const kind = getPremiumPinKind(pin?.status);
  const badge = getPremiumPinBadge(pin);
  const icon = buildPremiumMapPinIcon(kind, {
    badge,
    selected: Boolean(options.selected),
    pulse: Boolean(options.pulse),
    live: false,
  });

  return L.marker(toLeafletLatLng(pin), {
    interactive: options.interactive !== false,
    bubblingMouseEvents: false,
    keyboard: false,
    zIndexOffset: options.zIndexOffset || 0,
    icon,
  }).addTo(state.map);
}


function createPremiumLiveLocationMarker(coords, options = {}) {
  return L.marker(toLeafletLatLng(coords), {
    interactive: options.interactive !== false,
    bubblingMouseEvents: false,
    keyboard: false,
    zIndexOffset: options.zIndexOffset || 0,
    icon: buildPremiumMapPinIcon("live", {
      badge: options.badge || "",
      selected: Boolean(options.selected),
      pulse: Boolean(options.pulse ?? true),
      live: true,
    }),
  }).addTo(state.map);
}


function getPremiumPinKind(status) {
  if (status === "delivered") return "delivered";
  if (status === "failed") return "failed";
  return "pending";
}


function getPremiumPinBadge(pin) {
  const index = Array.isArray(state.activePins) ? state.activePins.findIndex((item) => item?.id === pin?.id) : -1;
  if (index < 0) return "";
  const value = index + 1;
  return value <= 99 ? String(value) : "";
}


function buildPremiumMapPinIcon(kind, options = {}) {
  const classes = [
    "premium-map-pin",
    `premium-map-pin--${kind}`,
    options.selected ? "is-selected" : "",
    options.pulse ? "is-pulse" : "",
    options.live ? "is-live" : "",
  ].filter(Boolean).join(" ");

  const badge = options.badge ? `<span class="premium-map-pin__badge">${escapeHtml(options.badge)}</span>` : "";
  const pulse = options.pulse ? "<span class=\"premium-map-pin__pulse\" aria-hidden=\"true\"></span>" : "";
  const glyph = getPremiumMapPinGlyph(kind);

  return L.divIcon({
    className: classes,
    html: `
      <span class="premium-map-pin__shell">
        ${pulse}
        <svg class="premium-map-pin__svg" viewBox="0 0 64 84" aria-hidden="true" focusable="false">
          <path class="premium-map-pin__shadow" d="M32 3C20 3 10 13 10 25.5c0 18.4 22 41.5 22 41.5s22-23.1 22-41.5C54 13 44 3 32 3Z"></path>
          <path class="premium-map-pin__body" d="M32 3C20 3 10 13 10 25.5c0 18.4 22 41.5 22 41.5s22-23.1 22-41.5C54 13 44 3 32 3Z"></path>
          <circle class="premium-map-pin__core" cx="32" cy="25.5" r="14.8"></circle>
          <g class="premium-map-pin__glyph">${glyph}</g>
        </svg>
        ${badge}
      </span>
    `,
    iconSize: options.live ? [62, 82] : [56, 76],
    iconAnchor: options.live ? [31, 72] : [28, 66],
  });
}


function getPremiumMapPinGlyph(kind) {
  if (kind === "delivered") {
    return `
      <path d="m22.8 25.6 4.8 4.8 12.2-12.6" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"></path>
    `;
  }
  if (kind === "failed") {
    return `
      <rect x="21.4" y="19.6" width="21.2" height="13.1" rx="3.2" fill="none" stroke="currentColor" stroke-width="3"></rect>
      <path d="M22.4 22.6h19.1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
      <path d="M26.1 19.6v-2.5h11.6v2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
    `;
  }
  if (kind === "live") {
    return `
      <path d="M20.9 24.8a3.4 3.4 0 0 1 3.4-3.4h3.1l2.1-3.8h4.4l1.5 3.4h4.8a3.1 3.1 0 0 1 2.9 2.2l1.2 4.5H47a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1-2.7-2.7H25.2a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4h1.5l1.1-6.6H20.9Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>
      <circle cx="36.9" cy="18.1" r="2.1" fill="currentColor"></circle>
      <path d="M31.2 18.6h5.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></path>
    `;
  }
  return `
    <path d="M32 14.2a11.5 11.5 0 1 0 11.5 11.5A11.5 11.5 0 0 0 32 14.2Z" fill="none" stroke="currentColor" stroke-width="2.6"></path>
    <path d="M32 18.8v7.2l4.7 3.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
  `;
}


function buildPremiumRouteLayer(latLngs) {
  const shadowLine = L.polyline(latLngs, {
    color: "#1d4ed8",
    weight: 16,
    opacity: 0.12,
    lineCap: "round",
    lineJoin: "round",
    className: "premium-route-line premium-route-line--shadow",
  });
  const glowLine = L.polyline(latLngs, {
    color: "#2563eb",
    weight: 10,
    opacity: 0.26,
    lineCap: "round",
    lineJoin: "round",
    className: "premium-route-line premium-route-line--glow",
  });
  const mainLine = L.polyline(latLngs, {
    color: "#2563eb",
    weight: 6,
    opacity: 0.98,
    lineCap: "round",
    lineJoin: "round",
    className: "premium-route-line premium-route-line--main",
  });
  return L.layerGroup([shadowLine, glowLine, mainLine]);
}


function createPremiumLocationPulseMarker(coords) {
  return L.marker(toLeafletLatLng(coords), {
    interactive: false,
    bubblingMouseEvents: false,
    keyboard: false,
    icon: L.divIcon({
      className: "courier-location-pulse-icon",
      html: '<span class="courier-location-pulse"></span>',
      iconSize: [72, 72],
      iconAnchor: [36, 36],
    }),
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
        if (coords?.id) openParcelTab(coords.id, { closeOpenDialog: state.isAdmin, focus: true });
      });
      const element = this.marker.getElement?.();
      element?.querySelector?.(".pin-label-card")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (window.L?.DomEvent) L.DomEvent.stopPropagation(event);
        if (coords?.id) openParcelTab(coords.id, { closeOpenDialog: state.isAdmin, focus: true });
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


function addCourierLocationOverlay(overlay) {
  state.courierLocationOverlays.push(overlay);
  return overlay;
}


function clearCourierLocationOverlays() {
  (state.courierLocationOverlays || []).forEach(clearMapObject);
  state.courierLocationOverlays = [];
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


function buildNominatimReverseUrl(coords) {
  return buildUrl("https://nominatim.openstreetmap.org/reverse", {
    format: "jsonv2",
    lat: coords.lat,
    lon: coords.lng,
    "accept-language": "ka",
    zoom: 18,
    addressdetails: 1,
  });
}


function buildNominatimSearchUrl(params) {
  return buildUrl("https://nominatim.openstreetmap.org/search", params);
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
  const requestUrl = path === "/search"
    ? buildNominatimSearchUrl(params)
    : path === "/reverse"
      ? buildUrl("https://nominatim.openstreetmap.org/reverse", params)
      : null;
  if (!requestUrl) return null;
  console.log("[geocode] osm url", requestUrl.toString());
  const response = await fetch(requestUrl, {
    headers: { Accept: "application/json" },
  }).catch(() => null);
  console.log("[geocode] osm response status", response?.status || 0);
  if (!response || !response.ok) return null;
  const data = await response.json();
  console.log("[geocode raw]", data);
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
  const locality = address.suburb
    || address.city
    || address.town
    || address.village
    || address.municipality
    || "";
  if (streetName && houseNumber) return cleanAddressInput([`${streetName} ${houseNumber}`, locality].filter(Boolean).join(", "));
  if (streetName) {
    if (result && typeof result === "object") result._addressWarning = "შენობის ნომერი ვერ მოიძებნა, ნაჩვენებია ქუჩა.";
    return cleanAddressInput([streetName, locality].filter(Boolean).join(", "));
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
  if (status === "delivered") return "#16a34a";
  if (status === "failed") return "#dc2626";
  return "#2563eb";
}


async function reverseGeocodeCoords(coords) {
  if (!CONFIG.useReverseGeocoding) return "";
  if (!coords) return "";
  const fallbackAddress = formatCoordsAddress(coords);

  try {
    const requestUrl = buildNominatimReverseUrl(coords);
    console.log("[geocode] reverse url", requestUrl.toString());
    const response = await fetch(requestUrl, {
      headers: { Accept: "application/json" },
    });
    console.log("[geocode] reverse response status", response.status);
    if (!response.ok) throw new Error(`Reverse geocode failed: ${response.status}`);
    const result = await response.json();
    console.log("[geocode] reverse display_name", result?.display_name || "");
    const address = formatOsmAddress(result, "");
    const finalAddress = address || fallbackAddress;
    console.log("[geocode] final formatted address", finalAddress);
    const isPendingCoords = state.pendingCoords
      && Number(state.pendingCoords.lat) === Number(coords.lat)
      && Number(state.pendingCoords.lng) === Number(coords.lng);
    if (isPendingCoords) {
      state.pendingAddressWarning = result?._addressWarning || (address ? "" : "მისამართი ვერ მოიძებნა, ნაჩვენებია კოორდინატები.");
    }
    return finalAddress;
  } catch (error) {
    console.log("[geocode] reverse failed", error?.message || error);
    const isPendingCoords = state.pendingCoords
      && Number(state.pendingCoords.lat) === Number(coords.lat)
      && Number(state.pendingCoords.lng) === Number(coords.lng);
    if (isPendingCoords) state.pendingAddressWarning = "მისამართი ვერ მოიძებნა, ნაჩვენებია კოორდინატები.";
    console.log("[geocode] final formatted address", fallbackAddress);
    return fallbackAddress;
  }
}


async function geocodeAddress(query) {
  return (await searchAddress(query))[0] || null;
}


const geocodeSearchCache = new Map();
const geocodeSearchPending = new Map();


async function searchAddress(query) {
  const queryParts = parseAddressQuery(query);
  console.log("[geocode] search query", queryParts.searchQuery);
  if (!CONFIG.useExternalAddressSearch) return searchLocalAddressFallback(queryParts);
  const cacheKey = queryParts.cacheKey;
  if (geocodeSearchCache.has(cacheKey)) return geocodeSearchCache.get(cacheKey);
  if (geocodeSearchPending.has(cacheKey)) return geocodeSearchPending.get(cacheKey);

  const request = (async () => {
    const results = [];
    const searchParamsList = buildAddressSearchParams(queryParts);
    for (const params of searchParamsList) {
      const batch = await fetchOsmJson("/search", {
        format: "jsonv2",
        ...params,
        addressdetails: 1,
        limit: 10,
        countrycodes: "ge",
        viewbox: getTbilisiViewbox(),
        bounded: 1,
        "accept-language": "ka",
      });
      const normalizedBatch = normalizeOsmSearchResults(batch || [], queryParts);
      results.push(...normalizedBatch);
      if (normalizedBatch.length) {
        if (queryParts.houseNumber) {
          if (normalizedBatch.some((result) => isExactHouseNumberResult(result, queryParts.houseNumber))) break;
        } else {
          break;
        }
      }
    }
    const acceptedResults = results.filter((result) => result.acceptedForSearch);
    const ranked = rankAddressResults(dedupeAddressResults(acceptedResults), queryParts);
    const finalResults = ranked.length ? ranked : searchLocalAddressFallback(queryParts);
    console.log("[geocode] search response count", results.length);
    console.log("[geocode] search accepted count", finalResults.length);
    geocodeSearchCache.set(cacheKey, finalResults);
    geocodeSearchPending.delete(cacheKey);
    return finalResults;
  })().catch((error) => {
    geocodeSearchPending.delete(cacheKey);
    throw error;
  });

  geocodeSearchPending.set(cacheKey, request);
  return request;
}


function parseAddressQuery(query) {
  const original = normalizeGeocodeQuery(query);
  const searchQuery = buildGeocodeSearchQuery(original);
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
    searchQuery,
    cacheKey: normalizeGeocodeQueryKey(searchQuery),
    street,
    houseNumber: normalizeHouseNumber(houseNumber),
  };
}


function normalizeAddressQueryStreet(value) {
  return normalizeGeocodeQuery(value)
    .replace(/[,]+/g, " ")
    .replace(/\b(tbilisi|georgia|თბილისი|საქართველო)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function buildAddressSearchParams(queryParts) {
  const query = queryParts.searchQuery;
  const street = queryParts.street;
  const houseNumber = queryParts.houseNumber;
  const variants = [
    query,
    houseNumber && street ? normalizeGeocodeQuery(`${street} ${houseNumber}`) : "",
    houseNumber && street ? normalizeGeocodeQuery(`${houseNumber} ${street}`) : "",
    houseNumber && street ? normalizeGeocodeQuery(street) : "",
    houseNumber && street ? normalizeGeocodeQuery(`${street}, თბილისი`) : "",
    queryParts.original && queryParts.original !== query ? queryParts.original : "",
    queryParts.original ? `თბილისი ${queryParts.original}` : "",
    queryParts.original ? `${queryParts.original} საქართველო` : "",
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
      const acceptedForSearch = isWithinTbilisiBounds(coords)
        || isTbilisiReferencedResult(result)
        || isAllowedOsmSearchResultType(result);
      return {
        ...result,
        lat: coords.lat,
        lng: coords.lng,
        address,
        displayName,
        acceptedForSearch,
      };
    })
    .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng) && result.address && result.acceptedForSearch);
}


function rankAddressResults(results, queryParts) {
  const ranked = results
    .map((result) => {
      const score = scoreAddressResult(result, queryParts);
      const isApproximateAddress = Boolean(queryParts.houseNumber && !resultHasRequestedHouseNumber(result, queryParts.houseNumber));
      return {
        ...result,
        score,
        isApproximateAddress,
        warning: result._addressWarning || (isApproximateAddress ? "ზუსტი ნომერი ვერ მოიძებნა, პინი დაისვა ახლო შედეგზე. საჭიროების შემთხვევაში გადაწიე პინი." : ""),
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
  if (isStreetOnlyOsmResult(result)) score -= 40;
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
    || /house|apartments|residential|yes|building|commercial|retail|neighbourhood|suburb/.test(osmType);
}


function isStreetOnlyOsmResult(result) {
  const osmClass = String(result?.class || "").toLocaleLowerCase();
  const osmType = String(result?.type || "").toLocaleLowerCase();
  return osmClass === "highway" || /street|road|primary|secondary|tertiary|service/.test(osmType);
}


function isAllowedOsmSearchResultType(result) {
  const osmType = String(result?.type || "").toLocaleLowerCase();
  const osmClass = String(result?.class || "").toLocaleLowerCase();
  return ["road", "residential", "house", "building", "amenity", "neighbourhood", "suburb"].includes(osmType)
    || ["highway", "building", "amenity", "place"].includes(osmClass);
}


function isTbilisiReferencedResult(result) {
  const address = result?.address || {};
  const locationParts = [
    address.city,
    address.town,
    address.village,
    address.suburb,
    address.neighbourhood,
    address.municipality,
    address.county,
    address.state,
    result?.display_name,
  ].filter(Boolean);
  return locationParts.some((value) => /tbilisi|თბილისი|georgia|საქართველო/i.test(String(value)));
}


function normalizeGeocodeQuery(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u00A0\s]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}


function normalizeGeocodeQueryKey(value) {
  return normalizeGeocodeQuery(value).replace(/\s+/g, " ");
}


function hasLocationQualifier(value) {
  return /(?:\btbilisi\b|\bgeorgia\b|თბილისი|საქართველო)/i.test(String(value || ""));
}


function isGeorgianQuery(value) {
  return /[\u10A0-\u10FF]/.test(String(value || ""));
}


function isShortGeorgianQuery(value) {
  const normalized = normalizeGeocodeQuery(value);
  if (!normalized || !isGeorgianQuery(normalized) || hasLocationQualifier(normalized)) return false;
  return normalized.length <= 48 && normalized.split(" ").filter(Boolean).length <= 4;
}


function buildGeocodeSearchQuery(query) {
  const normalized = normalizeGeocodeQuery(query);
  if (!normalized) return "";
  if (isShortGeorgianQuery(normalized)) return `${normalized}, tbilisi, georgia`;
  return normalized;
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


function startLocationWatch() {
  if (!navigator.geolocation) {
    if (!state.isAdmin) notifyLocationWatchError({ code: 0 });
    return;
  }
  if (state.watchId || !state.map) return;

  state.watchId = navigator.geolocation.watchPosition((position) => {
    state.currentPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    state.hasCurrentPosition = true;

    if (!state.locationMarker) {
      state.locationMarker = createPremiumLiveLocationMarker(state.currentPosition, {
        selected: true,
        pulse: true,
        zIndexOffset: 520,
      });
    } else {
      setMarkerPosition(state.locationMarker, state.currentPosition);
    }

    maybePublishCourierLocation();
  }, notifyLocationWatchError, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
}


function notifyLocationWatchError(error = {}) {
  if (state.isAdmin || !state.currentUser) return;

  const now = Date.now();
  if (now - state.lastLocationWatchErrorToastAt < 45000) return;
  state.lastLocationWatchErrorToastAt = now;

  const message = error.code === 1
    ? "ლოკაციის უფლება გამორთულია. კურიერის პინი რუკაზე ვერ განახლდება."
    : error.code === 3
      ? "ლოკაციის მიღება დაგვიანდა. GPS ან ინტერნეტი შეამოწმე."
      : "ლოკაცია ვერ განისაზღვრა. GPS ჩართე და აპლიკაცია გახსნილი დატოვე.";
  showToast(message);
}


function startCourierLocationServices() {
  stopCourierLocationServices();
  if (!state.currentUser) return;
  if (state.isAdmin) {
    startAdminCourierLocationListener();
    return;
  }
  state.courierPresenceStatus = state.courierPresenceStatus === "offline" ? "offline" : "online";
  startCourierLocationPublishing();
}


async function stopCourierLocationServices(options = {}) {
  window.clearInterval(state.courierLocationRefreshTimer);
  window.clearInterval(state.courierLocationStatusTimer);
  state.courierLocationRefreshTimer = null;
  state.courierLocationStatusTimer = null;
  state.lastCourierLocationWriteAt = 0;

  if (typeof stopFirebaseCourierLocationsListener === "function") stopFirebaseCourierLocationsListener();
  state.courierLocationUnsubscribe = null;
  clearCourierLocationOverlays();

  if (options.markOffline && !state.isAdmin && state.currentUser) {
    await publishCourierLocation({ status: "offline", force: true }).catch(() => {});
  }
}


function startCourierLocationPublishing() {
  window.clearInterval(state.courierLocationRefreshTimer);
  state.courierLocationRefreshTimer = window.setInterval(() => {
    maybePublishCourierLocation({ force: true });
  }, COURIER_LOCATION_REFRESH_MS);
  maybePublishCourierLocation({ force: true });
}


function handleCourierPresenceChange() {
  if (state.isAdmin || !state.currentUser) return;
  renderCourierMobileDashboard().catch(() => {});
  if (state.courierPresenceStatus === "offline") {
    publishCourierLocation({ status: "offline", force: true }).catch(() => {});
    return;
  }
  maybePublishCourierLocation({ force: true });
}


function maybePublishCourierLocation(options = {}) {
  if (state.isAdmin || !state.currentUser || state.courierPresenceStatus === "offline") return;
  if (!state.hasCurrentPosition || document.hidden) return;
  const now = Date.now();
  if (!options.force && now - state.lastCourierLocationWriteAt < COURIER_LOCATION_REFRESH_MS) return;
  publishCourierLocation({ status: "online" }).catch(() => {});
}


async function publishCourierLocation(options = {}) {
  if (state.isAdmin || !state.currentUser || typeof saveFirebaseCourierLocation !== "function") return false;
  if (!state.hasCurrentPosition) return false;
  if (document.hidden && options.status !== "offline") return false;

  const profile = state.currentUserProfile || { username: state.currentUser };
  const location = {
    username: state.currentUser,
    displayName: userFullName(profile) || state.currentUser,
    phone: profile.phone || "",
    lat: state.currentPosition.lat,
    lng: state.currentPosition.lng,
    status: options.status || "online",
    updatedAt: new Date().toISOString(),
  };
  state.lastCourierLocationWriteAt = Date.now();
  return saveFirebaseCourierLocation(location);
}


function startAdminCourierLocationListener() {
  if (typeof startFirebaseCourierLocationsListener !== "function") return;
  startFirebaseCourierLocationsListener((locations) => {
    state.courierLocations = locations || {};
    renderCourierLocationMarkers();
    renderAdminDashboard().catch(() => {});
  }).then((unsubscribe) => {
    state.courierLocationUnsubscribe = unsubscribe;
  }).catch((error) => {
    console.warn("Courier location listener unavailable", error);
  });

  window.clearInterval(state.courierLocationStatusTimer);
  state.courierLocationStatusTimer = window.setInterval(() => {
    renderCourierLocationMarkers();
    renderAdminDashboard().catch(() => {});
  }, 15000);
}


function renderCourierLocationMarkers() {
  clearCourierLocationOverlays();
  if (!state.isAdmin || !state.map) return;

  Object.values(state.courierLocations || {}).forEach((location) => {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const updatedAt = Date.parse(location.updatedAt || "");
    const age = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Infinity;
    const isOnline = location.status !== "offline" && age <= COURIER_LOCATION_VISIBLE_MS;
    if (!isOnline) {
      const username = normalizeUsername(location.username);
      if (username && state.selectedCourierLocationUsername === username) state.selectedCourierLocationUsername = "";
      return;
    }
    const coords = { lat, lng };
    const fillColor = "#0f766e";
    const labelStatus = "Online";
    const phone = location.phone || "ტელეფონი არ არის";
    const displayName = location.displayName || location.username || "კურიერი";

    const username = normalizeUsername(location.username);
    const isSelected = username && state.selectedCourierLocationUsername === username;
    const marker = createPremiumLiveLocationMarker(coords, {
      selected: isSelected,
      pulse: true,
      zIndexOffset: isSelected ? 520 : 320,
    });
    marker.on("click", (event) => {
      stopMapClick(event);
      state.selectedCourierLocationUsername = isSelected ? "" : username;
      renderCourierLocationMarkers();
    });
    addCourierLocationOverlay(marker);

    if (!isSelected) return;

    addCourierLocationOverlay(L.marker(toLeafletLatLng(coords), {
      interactive: false,
      icon: L.divIcon({
        className: "courier-location-label-icon",
        html: `
          <div class="courier-location-label courier-location-label--online">
            <strong>${escapeHtml(displayName)}</strong>
            <span>${escapeHtml(phone)}</span>
            <small>${escapeHtml(labelStatus)}</small>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [-12, 28],
      }),
    }).addTo(state.map));
  });
}


document.addEventListener("visibilitychange", () => {
  if (!document.hidden) maybePublishCourierLocation({ force: true });
});
