"use strict";



const COURIER_LOCATION_REFRESH_MS = 60000;
const COURIER_LOCATION_VISIBLE_MS = 120000;
const DEFAULT_MAP_CENTER = [41.7151, 44.8271];
const DEFAULT_MAP_ZOOM = 15;
const MIN_VALID_MAP_ZOOM = 7;
const MAX_VALID_MAP_ZOOM = 19;
const LOGIN_VIEWPORT_ENFORCE_DELAYS = [0, 80, 220, 520, 1000, 1600];
const ADMIN_FINANCE_TAP_WINDOW_MS = 850;
const ADMIN_FINANCE_TAP_REQUIRED = 3;
// Temporarily disabled until the courier map rotation interaction is finalized.
const COURIER_MAP_ROTATION_ENABLED = false;
const GEORGIAN_NEIGHBORHOOD_CASE_NORMALIZATIONS = [
  [/დიდ\s+დიღომში|დიდი\s+დიღმის/gi, "დიდი დიღომი"],
  [/დაბალ\s+დიღომში|დაბალი\s+დიღმის/gi, "დაბალი დიღომი"],
  [/სოფ(?:ელ|\.)?\s+დიღომში|სოფ(?:ელი|\.)?\s+დიღმის/gi, "სოფელი დიღომი"],
  [/დიღმის\s+მასივში|დიღმის\s+მასივის/gi, "დიღმის მასივი"],
  [/ვაჟა[-\s]?ფშაველაზე|ვაჟა[-\s]?ფშაველას|ვაჟაზე/gi, "ვაჟა-ფშაველა"],
  [/ზღვის\s+უბანში|ზღვისუბანში|ზღვისუბნის/gi, "ზღვისუბანი"],
  [/ორთაჭალაში|ორთაჭალის/gi, "ორთაჭალა"],
  [/ვარკეთილში|ვარკეთილის/gi, "ვარკეთილი"],
  [/გლდანში|გლდანის/gi, "გლდანი"],
  [/ნუცუბიძეზე|ნუცუბიძის/gi, "ნუცუბიძე"],
  [/ვაკეში|ვაკის/gi, "ვაკე"],
  [/საბურთალოზე|საბურთალოს/gi, "საბურთალო"],
  [/ისანში|ისნის/gi, "ისანი"],
  [/სამგორში|სამგორის/gi, "სამგორი"],
  [/მუხიანში|მუხიანის/gi, "მუხიანი"],
  [/ავჭალაში|ავჭალის/gi, "ავჭალა"],
  [/თემქაზე|თემქაში|თემქის/gi, "თემქა"],
  [/სანზონაში|სანზონის/gi, "სანზონა"],
  [/ლოტკინზე|ლოტკინში|ლოტკინის/gi, "ლოტკინი"],
  [/ვერაზე|ვერის/gi, "ვერა"],
  [/სოლოლაკში|სოლოლაკის/gi, "სოლოლაკი"],
  [/ფონიჭალაში|ფონიჭალის/gi, "ფონიჭალა"],
  [/ხარფუხში|ხარფუხის/gi, "ხარფუხი"],
  [/ავლაბარში|ავლაბრის/gi, "ავლაბარი"],
  [/ნავთლუღში|ნავთლუღის/gi, "ნავთლუღი"],
  [/ვაზისუბანში|ვაზისუბნის|ვაზისუბანის/gi, "ვაზისუბანი"],
  [/ლილოში|ლილოს/gi, "ლილო"],
  [/ორხევში|ორხევის/gi, "ორხევი"],
  [/აეროპორტში|აეროპორტის/gi, "აეროპორტი"],
  [/კუკიაზე|კუკიის/gi, "კუკია"],
  [/მარჯანიშვილზე|მარჯანიშვილის/gi, "მარჯანიშვილი"],
  [/წყნეთში|წყნეთის/gi, "წყნეთი"],
  [/ბაგებში|ბაგების/gi, "ბაგები"],
  [/ახალდაბაში|ახალდაბის/gi, "ახალდაბა"],
  [/ბეთანიაში|ბეთანიის/gi, "ბეთანია"],
  [/თხინვალაში|თხინვალის/gi, "თხინვალა"],
  [/ლისზე|ლისში|ლისის/gi, "ლისი"],
  [/მთაწმინდაზე|მთაწმინდის/gi, "მთაწმინდა"],
  [/კრწანისში|კრწანისის/gi, "კრწანისი"],
  [/დიდუბეში|დიდუბის/gi, "დიდუბე"],
  [/ჩუღურეთში|ჩუღურეთის/gi, "ჩუღურეთი"],
  [/ნაძალადევში|ნაძალადევის/gi, "ნაძალადევი"],
];


async function initializeMap() {
  state.markers = [];
  state.mapPinRenderSignature = "";

  if (!window.L) {
    showDialog("რუკა ვერ ჩაიტვირთა", `<p>რუკის ბიბლიოთეკა ვერ ჩაიტვირთა.</p>`, [
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
    return;
  }

  state.map = L.map(els.map, {
    zoomControl: false,
    minZoom: MIN_VALID_MAP_ZOOM,
    maxZoom: MAX_VALID_MAP_ZOOM,
  }).setView(getDefaultMapCenter(), DEFAULT_MAP_ZOOM);
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
  bindCourierMapRotation();
  bindMapResizeInvalidation();
  resetMapToDefaultViewport();
  scheduleMapInvalidateSize();
}


function bindCourierMapRotation() {
  if (!els.map || state.courierMapRotationBound) return;
  state.courierMapRotationBound = true;
  els.map.addEventListener("touchstart", handleCourierMapRotateStart, { passive: true });
  els.map.addEventListener("touchmove", handleCourierMapRotateMove, { passive: false });
  els.map.addEventListener("touchend", handleCourierMapRotateEnd, { passive: true });
  els.map.addEventListener("touchcancel", handleCourierMapRotateEnd, { passive: true });
  state.map?.on?.("move zoom moveend zoomend", applyCourierMapRotation);
}


function isCourierMapRotationEnabled() {
  return Boolean(COURIER_MAP_ROTATION_ENABLED && state.currentUser && !state.isAdmin && !state.isPartner && state.map);
}


function getTouchRotationAngle(touches) {
  if (!touches || touches.length < 2) return 0;
  const first = touches[0];
  const second = touches[1];
  return Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX) * 180 / Math.PI;
}


function normalizeMapBearing(value) {
  const bearing = Number(value);
  if (!Number.isFinite(bearing)) return 0;
  return ((bearing % 360) + 360) % 360;
}


function getShortestAngleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}


function handleCourierMapRotateStart(event) {
  if (!isCourierMapRotationEnabled() || event.touches?.length !== 2) return;
  state.courierMapRotationActive = true;
  state.courierMapRotationStartAngle = getTouchRotationAngle(event.touches);
  state.courierMapRotationBaseBearing = state.courierMapBearing || 0;
}


function handleCourierMapRotateMove(event) {
  if (!state.courierMapRotationActive || !isCourierMapRotationEnabled() || event.touches?.length !== 2) return;
  const angle = getTouchRotationAngle(event.touches);
  const delta = getShortestAngleDelta(state.courierMapRotationStartAngle, angle);
  if (Math.abs(delta) < 2) return;
  state.courierMapBearing = normalizeMapBearing((state.courierMapRotationBaseBearing || 0) + delta);
  applyCourierMapRotation();
  event.preventDefault();
}


function handleCourierMapRotateEnd(event) {
  if ((event.touches?.length || 0) < 2) {
    state.courierMapRotationActive = false;
  }
}


function syncCourierMapRotationMode() {
  if (isCourierMapRotationEnabled()) {
    applyCourierMapRotation();
    return;
  }
  state.courierMapRotationActive = false;
  state.courierMapBearing = 0;
  applyCourierMapRotation();
}


function applyCourierMapRotation() {
  const pane = state.map?.getPane?.("mapPane");
  if (!pane) return;
  const baseTransform = String(pane.style.transform || "").replace(/\srotate\([^)]*\)/g, "").trim();
  const bearing = isCourierMapRotationEnabled() ? normalizeMapBearing(state.courierMapBearing || 0) : 0;
  pane.style.transformOrigin = "50% 50%";
  pane.style.transform = bearing ? `${baseTransform} rotate(${bearing}deg)`.trim() : baseTransform;
}


function isEmptyAdminMapTap(event) {
  if (!state.isAdmin || !state.currentUser || !event?.latlng) return false;
  if (state.mode && state.mode !== "idle") return false;
  const target = event.originalEvent?.target;
  if (!target?.closest) return true;
  return !target.closest([
    ".leaflet-marker-icon",
    ".leaflet-interactive",
    ".leaflet-control",
    ".leaflet-popup",
    ".pin-label-card",
    ".partner-pickup-pin-icon",
    ".dispatch-cluster-icon",
  ].join(","));
}


function handleAdminMapFinanceTap(event) {
  if (!isEmptyAdminMapTap(event)) {
    state.adminMapFinanceTapTimes = [];
    return false;
  }

  const now = performance.now();
  const recent = (state.adminMapFinanceTapTimes || []).filter((time) => now - time <= ADMIN_FINANCE_TAP_WINDOW_MS);
  recent.push(now);
  state.adminMapFinanceTapTimes = recent;
  if (recent.length < ADMIN_FINANCE_TAP_REQUIRED) return false;

  state.adminMapFinanceTapTimes = [];
  if (typeof openFinanceDashboard === "function") openFinanceDashboard({ preserveSearch: true }).catch((error) => {
    showToast(error.message || STRINGS.serverFailed);
  });
  return true;
}


function scheduleMapInvalidateSize(delay = 300) {
  setTimeout(() => {
    state.map?.invalidateSize();
  }, delay);
}


function scheduleMapLayoutReady(callback) {
  const run = () => {
    state.map?.invalidateSize();
    callback?.();
  };
  window.requestAnimationFrame?.(() => window.requestAnimationFrame?.(run) || setTimeout(run, 0));
  setTimeout(run, 80);
  setTimeout(run, 260);
}


function scheduleRepeatedMapViewport(callback, token = state.mapViewportResetToken) {
  LOGIN_VIEWPORT_ENFORCE_DELAYS.forEach((delay) => {
    setTimeout(() => {
      if (token !== state.mapViewportResetToken) return;
      state.map?.invalidateSize({ pan: false });
      callback?.();
    }, delay);
  });
}


function getDefaultMapCenter() {
  const configured = Array.isArray(CONFIG.center) ? CONFIG.center : DEFAULT_MAP_CENTER;
  const lat = Number(configured[0]);
  const lng = Number(configured[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_MAP_CENTER;
  return [lat, lng];
}


function isValidMapZoom(zoom) {
  const value = Number(zoom);
  return Number.isFinite(value) && value >= MIN_VALID_MAP_ZOOM && value <= MAX_VALID_MAP_ZOOM;
}


function getSafeMapZoom(zoom, fallback = DEFAULT_MAP_ZOOM) {
  const value = Number(zoom);
  return isValidMapZoom(value) ? value : fallback;
}


function resetMapToDefaultViewport() {
  if (!state.map) return;
  state.map.setView(getDefaultMapCenter(), DEFAULT_MAP_ZOOM, { animate: false });
}


function resetMapViewportForLogin() {
  if (!state.map) return;
  state.mapViewportResetPending = true;
  state.mapViewportResetToken += 1;
  clearMapObject(state.routeLayer);
  state.routeLayer = null;
  state.routePinId = null;
  resetMapToDefaultViewport();
  const token = state.mapViewportResetToken;
  scheduleRepeatedMapViewport(() => {
    if (state.mapViewportResetPending) resetMapToDefaultViewport();
  }, token);
}


function getPinsWithMapCoords(pins) {
  return (Array.isArray(pins) ? pins : []).filter((pin) => (
    Number.isFinite(Number(pin?.lat ?? pin?.latitude))
    && Number.isFinite(Number(pin?.lng ?? pin?.longitude))
  ));
}


function fitMapToPinsOrDefault(pins, options = {}) {
  if (!state.map || !window.L) return;
  const visiblePins = getPinsWithMapCoords(pins);
  const token = state.mapViewportResetToken;
  const applyViewport = () => {
    state.map.invalidateSize({ pan: false });
    if (visiblePins.length) {
      const bounds = L.latLngBounds(visiblePins.map((pin) => toLeafletLatLng(pin)));
      if (bounds.isValid()) {
        state.map.fitBounds(bounds, {
          animate: false,
          padding: options.padding || [48, 48],
          maxZoom: options.maxZoom || 17,
        });
      } else {
        resetMapToDefaultViewport();
      }
    } else {
      resetMapToDefaultViewport();
    }
    state.mapViewportResetPending = false;
  };

  applyViewport();
  scheduleMapLayoutReady(applyViewport);
  scheduleRepeatedMapViewport(applyViewport, token);
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
  const visiblePins = Array.isArray(pins) ? pins : [];
  const signature = getMapPinRenderSignature(visiblePins);
  if (signature && signature === state.mapPinRenderSignature) return;
  state.mapPinRenderSignature = signature;
  if (!state.map || !window.L) {
    clearParcelOverlays();
    return;
  }

  syncParcelOverlayDescriptors(getParcelOverlayDescriptors(visiblePins));
}


function getParcelOverlayDescriptors(visiblePins) {
  const descriptors = [];
  getClusteredPinGroups(visiblePins).forEach((group) => {
    if (group.length > 1) {
      descriptors.push(getPinClusterOverlayDescriptor(group));
      return;
    }
    descriptors.push(...getSinglePinOverlayDescriptors(group[0]));
  });
  descriptors.push(...getPartnerPickupOverlayDescriptors(state.partnerPickupPins));
  return descriptors.filter(Boolean);
}


function syncParcelOverlayDescriptors(descriptors) {
  const registry = getParcelOverlayRegistry();
  const nextKeys = new Set();

  descriptors.forEach((descriptor) => {
    nextKeys.add(descriptor.key);
    const current = registry.get(descriptor.key);
    if (current && current.signature === descriptor.signature) return;
    if (current) clearMapObject(current.overlay);
    const overlay = descriptor.create();
    if (!overlay) {
      registry.delete(descriptor.key);
      return;
    }
    registry.set(descriptor.key, { overlay, signature: descriptor.signature });
  });

  registry.forEach((entry, key) => {
    if (nextKeys.has(key)) return;
    clearMapObject(entry.overlay);
    registry.delete(key);
  });

  state.markers = [...registry.values()].map((entry) => entry.overlay);
}


function getParcelOverlayRegistry() {
  if (!(state.parcelOverlayRegistry instanceof Map)) {
    state.parcelOverlayRegistry = new Map();
  }
  return state.parcelOverlayRegistry;
}


function getSinglePinOverlayDescriptors(pin) {
  if (!pin) return [];
  const descriptors = [];
  if (pin.id && pin.id === state.selectedPinId) descriptors.push(getSelectedPinPulseOverlayDescriptor(pin));
  descriptors.push(getSinglePinMarkerOverlayDescriptor(pin));
  if (shouldShowPinLabel(pin)) descriptors.push(getPinLabelOverlayDescriptor(pin));
  return descriptors;
}


function getSinglePinMarkerOverlayDescriptor(pin) {
  const isSelected = pin.id && pin.id === state.selectedPinId;
  return {
    key: `pin:${pin.id || `${pin.lat}:${pin.lng}`}`,
    signature: getSinglePinMarkerSignature(pin, isSelected),
    create: () => createSinglePinMarker(pin, isSelected),
  };
}


function getSelectedPinPulseOverlayDescriptor(pin) {
  return {
    key: `pin-pulse:${pin.id}`,
    signature: getSelectedPinPulseSignature(pin),
    create: () => createSelectedPinPulse(pin),
  };
}


function getPinLabelOverlayDescriptor(pin) {
  return {
    key: `pin-label:${pin.id || `${pin.lat}:${pin.lng}`}`,
    signature: getPinLabelSignature(pin),
    create: () => createPinLabelOverlay(pin),
  };
}


function getPinClusterOverlayDescriptor(pins) {
  const ids = pins.map((pin) => pin.id || `${pin.lat}:${pin.lng}`).sort().join(",");
  return {
    key: `cluster:${ids}`,
    signature: getPinClusterSignature(pins),
    create: () => createPinClusterMarker(pins),
  };
}


function getPartnerPickupOverlayDescriptors(pickups = []) {
  return (Array.isArray(pickups) ? pickups : [])
    .filter((pickup) => Number.isFinite(Number(pickup?.lat ?? pickup?.latitude)) && Number.isFinite(Number(pickup?.lng ?? pickup?.longitude)))
    .map((pickup) => ({
      key: `partner-pickup:${pickup.id || pickup.partnerUsername || `${pickup.lat}:${pickup.lng}`}`,
      signature: getPartnerPickupOverlaySignature(pickup),
      create: () => createPartnerPickupMarker(pickup),
    }));
}


function getSinglePinMarkerSignature(pin, isSelected) {
  return [
    Number(pin?.lat ?? pin?.latitude ?? 0).toFixed(6),
    Number(pin?.lng ?? pin?.longitude ?? 0).toFixed(6),
    pin?.status || "",
    pin?.locationAccuracy || "",
    isSelected ? "selected" : "",
    isPartnerUnconfirmedPin(pin) ? "partner-unconfirmed" : "",
  ].join("|");
}


function getSelectedPinPulseSignature(pin) {
  return [
    Number(pin?.lat ?? pin?.latitude ?? 0).toFixed(6),
    Number(pin?.lng ?? pin?.longitude ?? 0).toFixed(6),
    pin?.status || "",
    isPartnerUnconfirmedPin(pin) ? "partner-unconfirmed" : "",
  ].join("|");
}


function getPinLabelSignature(pin) {
  return [
    Number(pin?.lat ?? pin?.latitude ?? 0).toFixed(6),
    Number(pin?.lng ?? pin?.longitude ?? 0).toFixed(6),
    pin?.id === state.selectedPinId ? "selected" : "",
    pin?.status || "",
    pin?.fullName || "",
    pin?.address || pin?.fullAddress || "",
    pin?.courierUsername || "",
    getPaymentAmount(pin),
    getMapRenderZoomBucket(),
  ].join("|");
}


function getPinClusterSignature(pins) {
  const center = getClusterCenter(pins);
  const delivered = pins.filter((pin) => pin.status === "delivered").length;
  const failed = pins.filter((pin) => pin.status === "failed").length;
  return [
    Number(center.lat).toFixed(6),
    Number(center.lng).toFixed(6),
    pins.length,
    delivered,
    failed,
    getMapRenderZoomBucket(),
  ].join("|");
}


function getPartnerPickupOverlaySignature(pickup) {
  return [
    Number(pickup?.lat ?? pickup?.latitude ?? 0).toFixed(6),
    Number(pickup?.lng ?? pickup?.longitude ?? 0).toFixed(6),
    pickup?.partnerName || "",
    pickup?.partnerUsername || "",
    pickup?.zoneId || "",
    pickup?.count || "",
    pickup?.lastOrderAt || "",
    pickup?.lastPickupAcknowledgedAt || "",
  ].join("|");
}


function createSinglePinMarker(pin, isSelected) {
  const locationClass = `dispatch-pin-location-${pin.locationAccuracy || "confirmed"}`;
  const partnerUnconfirmedClass = isPartnerUnconfirmedPin(pin) ? "dispatch-pin-partner-unconfirmed" : "";
  const fillColor = getPinMarkerColor(pin);
  const strokeColor = getPinMarkerStrokeColor(pin, isSelected);
  const marker = createCircleMarker(pin, {
    radius: isSelected ? 12 : 9,
    fillColor,
    color: strokeColor,
    weight: isSelected ? 4 : 2,
    fillOpacity: 0.92,
    className: `${isSelected ? "selected-pin-marker" : "dispatch-pin-marker"} dispatch-pin-status-${pin.status || "pending"} ${locationClass} ${partnerUnconfirmedClass}`,
  });

  marker.on("click", (event) => {
    handlePinMarkerClick(pin, event);
  });
  marker.on("mouseover", () => {
    if (pin.id === state.selectedPinId) return;
    marker.setRadius?.(11);
    marker.setStyle?.({
      weight: 3,
      fillOpacity: 1,
    });
    marker.bringToFront?.();
  });
  marker.on("mouseout", () => {
    if (pin.id === state.selectedPinId) return;
    marker.setRadius?.(9);
    marker.setStyle?.({
      weight: 2,
      fillOpacity: 0.92,
    });
  });
  if (isSelected) marker.bringToFront?.();
  return marker;
}


function createSelectedPinPulse(pin) {
  const fillColor = getPinMarkerColor(pin);
  const strokeColor = getPinMarkerStrokeColor(pin, true);
  const partnerUnconfirmedClass = isPartnerUnconfirmedPin(pin) ? "dispatch-pin-partner-unconfirmed" : "";
  return createCircleMarker(pin, {
    radius: 18,
    fillColor,
    color: strokeColor,
    weight: 2,
    fillOpacity: 0.12,
    opacity: 0.62,
    className: `selected-pin-pulse ${partnerUnconfirmedClass}`,
  });
}


function createPinLabelOverlay(pin) {
  const payment = getPaymentAmount(pin);
  const address = getParcelAddress(pin);
  const courier = parcelCourierDisplayName(pin);
  const statusLabel = getStatusLabel(pin.status);
  return new HtmlMapLabel(pin, `
        <div class="pin-label-card pin-label-status-${escapeAttr(pin.status)} ${pin.id === state.selectedPinId ? "is-selected" : ""}">
          <strong class="pin-label-address">${escapeHtml(address)}</strong>
          <span class="pin-label-name">${escapeHtml(pin.fullName || "უსახელო")}</span>
          ${state.isAdmin ? `<span class="pin-label-courier">${escapeHtml(courier)}</span>` : ""}
          <span class="pin-label-meta">
            <b>${escapeHtml(statusLabel)}</b>
            ${payment > 0 ? `<em>${escapeHtml(formatPinMoney(payment))}</em>` : ""}
          </span>
        </div>
      `);
}


function createPinClusterMarker(pins) {
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

  marker.on("click", (event) => {
    event.originalEvent?.stopPropagation?.();
    stopMapClick(event);
    if (getMapZoom() < 17) {
      const bounds = L.latLngBounds(pins.map((pin) => toLeafletLatLng(pin)));
      state.map.fitBounds(bounds, { padding: [44, 44], maxZoom: 17 });
    }
  });
  return marker;
}


function createPartnerPickupMarker(pickup) {
  const count = Math.max(1, Number(pickup.count || 0));
  const marker = L.marker(toLeafletLatLng(pickup), {
    interactive: true,
    keyboard: true,
    icon: L.divIcon({
      className: "partner-pickup-pin-icon",
      html: `<span title="${escapeAttr(pickup.partnerName || "პარტნიორი")}">${escapeHtml(String(count))}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    }),
  }).addTo(state.map);

  marker.on("click", (event) => {
    stopMapClick(event);
    if (typeof openPartnerPickupDialog === "function") openPartnerPickupDialog(pickup);
  });
  return marker;
}


function getMapPinRenderSignature(pins) {
  const expandedLabels = Array.isArray(state.expandedPinLabels)
    ? state.expandedPinLabels.join(",")
    : "";
  const zoomBucket = state.map ? getMapRenderZoomBucket() : "";
  const role = state.isAdmin ? "admin" : state.isPartner ? "partner" : "courier";
  return [
    role,
    zoomBucket,
    state.selectedPinId || "",
    expandedLabels,
    pins.map((pin) => [
      pin?.id || "",
      Number(pin?.lat ?? pin?.latitude ?? 0).toFixed(6),
      Number(pin?.lng ?? pin?.longitude ?? 0).toFixed(6),
      pin?.status || "",
      pin?.locationAccuracy || "",
      pin?.courierUsername || "",
      pin?.partnerId || "",
      pin?.fullName || "",
      pin?.phone || "",
      pin?.address || pin?.fullAddress || "",
      getPaymentAmount(pin),
      pin?.updatedAt || "",
      pin?.archivedAt || "",
      pin?.deletedAt || "",
    ].join("~")).join("|"),
    (state.partnerPickupPins || []).map((pickup) => [
      pickup?.id || "",
      pickup?.partnerUsername || "",
      Number(pickup?.lat ?? pickup?.latitude ?? 0).toFixed(6),
      Number(pickup?.lng ?? pickup?.longitude ?? 0).toFixed(6),
      pickup?.zoneId || "",
      pickup?.count || "",
      pickup?.lastOrderAt || "",
      pickup?.lastPickupAcknowledgedAt || "",
    ].join("~")).join("|"),
  ].join("||");
}


function getMapRenderZoomBucket() {
  const zoom = getMapZoom();
  if (state.isAdmin) {
    if (zoom < 14) return "admin-cluster-wide";
    if (zoom < 17) return "admin-cluster-near";
    return "admin-detail";
  }
  return zoom >= 16 ? "courier-labels" : "courier-pins";
}


function renderPartnerPickupMarkers(pickups = []) {
  if (!state.map || !window.L) return;
  (Array.isArray(pickups) ? pickups : [])
    .filter((pickup) => Number.isFinite(Number(pickup?.lat ?? pickup?.latitude)) && Number.isFinite(Number(pickup?.lng ?? pickup?.longitude)))
    .forEach((pickup) => {
      const count = Math.max(1, Number(pickup.count || 0));
      const marker = L.marker(toLeafletLatLng(pickup), {
        interactive: true,
        keyboard: true,
        icon: L.divIcon({
          className: "partner-pickup-pin-icon",
          html: `<span title="${escapeAttr(pickup.partnerName || "პარტნიორი")}">${escapeHtml(String(count))}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      }).addTo(state.map);
      addParcelOverlay(marker);
      marker.on("click", (event) => {
        stopMapClick(event);
        if (typeof openPartnerPickupDialog === "function") openPartnerPickupDialog(pickup);
      });
    });
}


function renderSinglePinMarker(pin) {
  if (!pin) return;
  const isSelected = pin.id && pin.id === state.selectedPinId;
  const locationClass = `dispatch-pin-location-${pin.locationAccuracy || "confirmed"}`;
  const partnerUnconfirmedClass = isPartnerUnconfirmedPin(pin) ? "dispatch-pin-partner-unconfirmed" : "";
  const fillColor = getPinMarkerColor(pin);
  const strokeColor = getPinMarkerStrokeColor(pin, isSelected);
  if (isSelected) {
    addParcelOverlay(createCircleMarker(pin, {
      radius: 18,
      fillColor,
      color: strokeColor,
      weight: 2,
      fillOpacity: 0.12,
      opacity: 0.62,
      className: `selected-pin-pulse ${partnerUnconfirmedClass}`,
    }));
  }
  const marker = createCircleMarker(pin, {
    radius: isSelected ? 12 : 9,
    fillColor,
    color: strokeColor,
    weight: isSelected ? 4 : 2,
    fillOpacity: 0.92,
    className: `${isSelected ? "selected-pin-marker" : "dispatch-pin-marker"} dispatch-pin-status-${pin.status || "pending"} ${locationClass} ${partnerUnconfirmedClass}`,
  });

  addParcelOverlay(marker);
  marker.on("click", (event) => {
    handlePinMarkerClick(pin, event);
  });
  marker.on("mouseover", () => {
    if (pin.id === state.selectedPinId) return;
    marker.setRadius?.(11);
    marker.setStyle?.({
      weight: 3,
      fillOpacity: 1,
    });
    marker.bringToFront?.();
  });
  marker.on("mouseout", () => {
    if (pin.id === state.selectedPinId) return;
    marker.setRadius?.(9);
    marker.setStyle?.({
      weight: 2,
      fillOpacity: 0.92,
    });
  });
  if (isSelected) marker.bringToFront?.();
  renderPinLabel(pin);
}


function handlePinMarkerClick(pin, event) {
  stopMapClick(event);
  if (!pin?.id) return;
  state.map?.closePopup?.();
  if (state.isPartner) {
    showPartnerMapParcelPopup(pin);
    return;
  }
  openParcelTab(pin.id, { closeOpenDialog: state.isAdmin, focus: true });
}


function showPartnerMapParcelPopup(pin) {
  if (!state.map || !window.L) return;
  const status = getPartnerOrderStatusLabel(pin);
  const failureReason = pin.status === "failed" ? parcelFailureReason(pin) : "";
  const rows = [
    ["მომხმარებელი", pin.fullName || "სახელი არ არის"],
    ["COD", formatPinMoney(getPaymentAmount(pin))],
    ["სტატუსი", status],
    ...(failureReason ? [["მიზეზი", failureReason]] : []),
  ];
  const html = `
    <div class="partner-map-popup">
      ${rows.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
  state.map.openPopup(html, toLeafletLatLng(pin), {
    autoPan: true,
    closeButton: true,
    className: "partner-map-leaflet-popup",
  });
}


function getClusteredPinGroups(pins) {
  const sourcePins = (Array.isArray(pins) ? pins : []).filter((pin) => Number.isFinite(Number(pin.lat)) && Number.isFinite(Number(pin.lng)));
  if (!state.isAdmin || !state.map || getMapZoom() >= 17 || sourcePins.length < 2) return sourcePins.map((pin) => [pin]);

  const clusterRadius = getMapZoom() <= 13 ? 58 : 44;
  const clusters = [];
  sourcePins.forEach((pin) => {
    if ((pin.id && pin.id === state.selectedPinId) || shouldKeepPinOutOfClusters(pin)) {
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


function shouldKeepPinOutOfClusters(pin) {
  const color = getPinMarkerColor(pin);
  return color === "#2563eb" || color === "#16a34a";
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
  if (state.isPartner) return false;
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
  syncCourierMapRotationMode();
  const visiblePins = typeof getVisiblePinsForCurrentRole === "function"
    ? getVisiblePinsForCurrentRole(state.activePins)
    : state.activePins;
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
    <button class="courier-map-stats-row courier-map-stats-row--action" type="button" data-action="courierParcels"><span>დარჩენილი</span><strong>${pending}</strong></button>
    <div class="courier-map-stats-row"><span>ჩაბარდა</span><strong>${deliveredPins.length}</strong></div>
    <div class="courier-map-stats-row"><span>არ ჩაბარდა</span><strong>${failed}</strong></div>
  `;
}


function createCircleMarker(coords, options) {
  return L.circleMarker(toLeafletLatLng(coords), {
    interactive: true,
    bubblingMouseEvents: options.bubblingMouseEvents ?? false,
    radius: options.radius || 10,
    fillColor: options.fillColor,
    fillOpacity: options.fillOpacity ?? 1,
    color: options.color || "#fff",
    opacity: options.opacity ?? 1,
    weight: options.weight || 2,
    className: options.className || "",
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
  if (state.parcelOverlayRegistry instanceof Map) state.parcelOverlayRegistry.clear();
  state.mapPinRenderSignature = "";
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
  state.map.setView(toLeafletLatLng(coords), getSafeMapZoom(zoom, getMapZoom()));
}


function getMapZoom() {
  return getSafeMapZoom(state.map?.getZoom(), DEFAULT_MAP_ZOOM);
}


function toLeafletLatLng(coords) {
  if (Array.isArray(coords)) return [Number(coords[0]), Number(coords[1])];
  return [Number(coords?.lat ?? coords?.latitude), Number(coords?.lng ?? coords?.longitude)];
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
  return normalizeGeorgianNeighborhoodCases(value)
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


function isPartnerUnconfirmedPin(pin) {
  if (!pin || pin.locationConfirmedByAdmin) return false;
  const isPartnerLocation = pin.createdByRole === "partner" || pin.locationSource === "partner_address_geocoded";
  return isPartnerLocation && pin.locationAccuracy === "approximate";
}


function getPinMarkerColor(pin) {
  if (state.isAdmin && isPartnerUnconfirmedPin(pin)) return "#f59e0b";
  return getStatusColor(pin?.status);
}


function getPinMarkerStrokeColor(pin, isSelected = false) {
  if (state.isAdmin && isPartnerUnconfirmedPin(pin)) return isSelected ? "#b45309" : "#fff";
  return isSelected ? "#2563eb" : "#fff";
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
    const streetMatchedResults = shouldRequireStreetMatchForSearch(queryParts)
      ? acceptedResults.filter((result) => streetMatchesResult(result, queryParts.street))
      : acceptedResults;
    const ranked = rankAddressResults(dedupeAddressResults(streetMatchedResults), queryParts);
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
  let street = houseNumber ? extractGeocodeStreetCandidate(original.slice(0, match.index).trim()) : extractGeocodeStreetCandidate(original);

  if (!houseNumber) {
    match = original.match(/^(?:#|№|N|No\.?)?\s*(\d+[A-Za-zა-ჰ]?(?:[-/]\d+[A-Za-zა-ჰ]?)?)\s+(.+)$/i);
    houseNumber = match?.[1] || "";
    street = match?.[2]?.trim() ? extractGeocodeStreetCandidate(match[2].trim()) : street;
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


function extractGeocodeStreetCandidate(value) {
  const parts = String(value || "")
    .split(",")
    .map((part) => cleanAddressInput(part))
    .filter(Boolean);
  if (parts.length <= 1) return value;

  const addressParts = parts.filter((part) => {
    const token = normalizeAddressToken(part);
    return token && !/^(tbilisi|rustavi|georgia|თბილისი|რუსთავი|საქართველო)$/.test(token);
  });
  return addressParts[addressParts.length - 1] || value;
}


function normalizeAddressQueryStreet(value) {
  return normalizeGeocodeQuery(value)
    .replace(/[,]+/g, " ")
    .replace(/\b(tbilisi|rustavi|georgia|თბილისი|რუსთავი|საქართველო)\b/gi, " ")
    .replace(/(^|[\s,])(თბილისი|რუსთავი|საქართველო)(?=$|[\s,])/gi, " ")
    .replace(/(^|[\s,])(ქუჩა|ქ|გამზირი|გამზ|ჩიხი|შესახვევი|გზატკეცილი)(?=$|[\s,])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function buildAddressSearchParams(queryParts) {
  const query = queryParts.searchQuery;
  const street = queryParts.street;
  const houseNumber = queryParts.houseNumber;
  const defaultCity = /rustavi|რუსთავი/i.test(queryParts.original || query) ? "რუსთავი" : "თბილისი";
  const variants = [
    houseNumber && street ? normalizeGeocodeQuery(`${street} ${houseNumber}, ${defaultCity}`) : "",
    houseNumber && street ? normalizeGeocodeQuery(`${street} ${houseNumber}`) : "",
    houseNumber && street ? normalizeGeocodeQuery(`${houseNumber} ${street}`) : "",
    houseNumber && street ? normalizeGeocodeQuery(street) : "",
    houseNumber && street ? normalizeGeocodeQuery(`${street}, ${defaultCity}`) : "",
    query,
    queryParts.original && queryParts.original !== query ? queryParts.original : "",
    queryParts.original ? `${defaultCity} ${queryParts.original}` : "",
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
    {
      tokens: ["ვაჟა ფშაველა", "ვაჟა-ფშაველა", "ვაჟაფშაველა", "vazha pshavela"],
      base: { lat: 41.7240, lng: 44.7330 },
      step: { lat: 0, lng: 0 },
      address: "ვაჟა-ფშაველას კვარტლები",
    },
    {
      tokens: ["ვარკეთილი", "ვარკეთილის", "varketili"],
      base: { lat: 41.6940, lng: 44.8840 },
      step: { lat: 0, lng: 0 },
      address: "ვარკეთილი",
    },
    {
      tokens: ["ორთაჭალა", "ორთაჭალაში", "ortachala"],
      base: { lat: 41.6868, lng: 44.8338 },
      step: { lat: 0.000010, lng: 0.000010 },
      address: "ორთაჭალა",
    },
    {
      tokens: ["გულუა", "გულუას", "gulua"],
      base: { lat: 41.6868, lng: 44.8338 },
      step: { lat: 0.000010, lng: 0.000010 },
      address: "გულუას ქუჩა",
    },
    {
      tokens: ["გლდანი", "გლდანის", "gldani"],
      base: { lat: 41.7930, lng: 44.8170 },
      step: { lat: 0, lng: 0 },
      address: "გლდანი",
    },
    {
      tokens: ["მუხიანი", "მუხიანის", "mukhiani"],
      base: { lat: 41.8050, lng: 44.8390 },
      step: { lat: 0, lng: 0 },
      address: "მუხიანი",
    },
    {
      tokens: ["ნუცუბიძე", "ნუცუბიძის", "nutsubidze"],
      base: { lat: 41.7225, lng: 44.7290 },
      step: { lat: 0, lng: 0 },
      address: "ნუცუბიძის პლატო",
    },
    {
      tokens: ["თემქა", "თემქის", "temka"],
      base: { lat: 41.7770, lng: 44.8110 },
      step: { lat: 0, lng: 0 },
      address: "თემქა",
    },
    {
      tokens: ["ზღვისუბანი", "ზღვისუბნის", "ზღვის უბანი", "zgvisubani"],
      base: { lat: 41.7860, lng: 44.8320 },
      step: { lat: 0, lng: 0 },
      address: "ზღვისუბანი",
    },
    {
      tokens: ["დიღმის მასივი", "დიღმის მასივის", "dighmis masivi"],
      base: { lat: 41.7590, lng: 44.7790 },
      step: { lat: 0, lng: 0 },
      address: "დიღმის მასივი",
    },
  ];

  const street = knownStreets
    .map((item) => {
      const score = item.tokens.reduce((best, token) => {
        const normalizedToken = normalizeAddressToken(token);
        if (!normalizedToken || !streetToken.includes(normalizedToken)) return best;
        const streetTypeBonus = /ქუჩა|გამზირი|ჩიხი|შესახვევი|გზატკეცილი/.test(item.address) ? 20 : 0;
        return Math.max(best, normalizedToken.length + streetTypeBonus);
      }, 0);
      return { item, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
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


function shouldRequireStreetMatchForSearch(queryParts) {
  const street = normalizeAddressToken(queryParts?.street || "");
  if (!street) return false;
  const tokens = street.split(" ").filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.some((token) => token.length >= 4);
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
  return normalizeGeorgianNeighborhoodCases(value)
    .normalize("NFC")
    .replace(/(^|[^\p{L}\p{N}])მე\s*[-.]?\s*(\d{1,2})(?=\s*(?:კვარტალი|კვ\.?|მიკრო|მიკრორაიონი|მკრ|მ\s*\/\s*რ|პლატო)(?:$|[^\p{L}\p{N}]))/giu, "$1$2")
    .replace(/პლატოს/giu, "პლატო")
    .replace(/კვარტლის/giu, "კვარტალი")
    .replace(/მიკროს|მიკრორაიონის/giu, "მიკრორაიონი")
    .replace(/[\u00A0\s]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}


function normalizeGeorgianNeighborhoodCases(value) {
  return GEORGIAN_NEIGHBORHOOD_CASE_NORMALIZATIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    String(value ?? ""),
  );
}


function normalizeGeocodeQueryKey(value) {
  return normalizeGeocodeQuery(value).replace(/\s+/g, " ");
}


function hasLocationQualifier(value) {
  return /(?:\btbilisi\b|\brustavi\b|\bgeorgia\b|თბილისი|რუსთავი|საქართველო)/i.test(String(value || ""));
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
  if (CONFIG.enableCourierLiveTracking === false) {
    state.courierLocations = {};
    clearCourierLocationOverlays();
    return;
  }
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

  if (CONFIG.enableCourierLiveTracking !== false && options.markOffline && !state.isAdmin && state.currentUser) {
    await publishCourierLocation({ status: "offline", force: true }).catch(() => {});
  }
}


function startCourierLocationPublishing() {
  if (CONFIG.enableCourierLiveTracking === false) return;
  window.clearInterval(state.courierLocationRefreshTimer);
  state.courierLocationRefreshTimer = window.setInterval(() => {
    maybePublishCourierLocation({ force: true });
  }, COURIER_LOCATION_REFRESH_MS);
  maybePublishCourierLocation({ force: true });
}


function handleCourierPresenceChange() {
  if (state.isAdmin || !state.currentUser) return;
  renderCourierMobileDashboard().catch(() => {});
  if (CONFIG.enableCourierLiveTracking === false) return;
  if (state.courierPresenceStatus === "offline") {
    publishCourierLocation({ status: "offline", force: true }).catch(() => {});
    return;
  }
  maybePublishCourierLocation({ force: true });
}


function maybePublishCourierLocation(options = {}) {
  if (CONFIG.enableCourierLiveTracking === false) return;
  if (state.isAdmin || !state.currentUser || state.courierPresenceStatus === "offline") return;
  if (!state.hasCurrentPosition || document.hidden) return;
  const now = Date.now();
  if (!options.force && now - state.lastCourierLocationWriteAt < COURIER_LOCATION_REFRESH_MS) return;
  publishCourierLocation({ status: "online" }).catch(() => {});
}


async function publishCourierLocation(options = {}) {
  if (CONFIG.enableCourierLiveTracking === false) return false;
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
  if (CONFIG.enableCourierLiveTracking === false) {
    state.courierLocations = {};
    clearCourierLocationOverlays();
    return;
  }
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
  if (CONFIG.enableCourierLiveTracking === false) return;
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
    const labelStatus = "ონლაინ";
    const phone = location.phone || "ტელეფონი არ არის";
    const displayName = location.displayName || location.username || "კურიერი";

    const username = normalizeUsername(location.username);
    const isSelected = username && state.selectedCourierLocationUsername === username;
    const marker = createCircleMarker(coords, {
      radius: 8,
      fillColor,
      color: "#ffffff",
      weight: 3,
      fillOpacity: 0.95,
      className: "courier-location-marker courier-location-marker--online",
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
  if (CONFIG.enableCourierLiveTracking === false) return;
  if (!document.hidden) maybePublishCourierLocation({ force: true });
});
