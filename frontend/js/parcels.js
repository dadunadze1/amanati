"use strict";



async function refreshPins() {
  const selectedPinId = state.selectedPinId;
  clearAdminMapPins();
  state.activePins = [];

  if (!state.currentUser || !state.map) {
    hideSelectedParcelCard();
    await renderCourierStatsCard([]);
    await renderAdminDashboard([]);
    await renderCourierMobileDashboard([]);
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
  await renderAdminDashboard(pins);
  await renderCourierMobileDashboard(pins);
  if (state.routePinId && !pins.some((pin) => pin.id === state.routePinId)) clearActiveRoute();
  clearHistoryPreviewMarker();

  if (selectedPinId && visiblePins.some((pin) => pin.id === selectedPinId)) {
    renderSelectedParcelCard();
  } else {
    hideSelectedParcelCard();
  }
}


function openAdminAddParcel() {
  openAddressSearchDialog("");
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
  if (!address || (isCoordinateLabel(address) && !(typeof isStaticDeploy === "function" && isStaticDeploy()))) return showToast(STRINGS.addressRequired);
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
      confirmed: pin?.confirmed ?? pin?.isConfirmed ?? pin?.status !== "pending",
      currentLat: state.currentPosition?.lat,
      currentLng: state.currentPosition?.lng,
    },
  });
  if (state.routePinId === pinId) clearActiveRoute();
  await refreshPins();
}


function openParcelTab(pinId, options = {}) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;

  closeActions();
  if (options.closeOpenDialog && els.dialogModal?.classList.contains("active")) closeDialog();
  showSelectedParcelCard(pin.id, { focus: Boolean(options.focus) });
}


function showSelectedParcelCard(pinId, options = {}) {
  const previousPinId = state.selectedPinId;
  state.selectedPinId = pinId;
  state.selectedParcelCardCollapsed = false;
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) {
    hideSelectedParcelCard();
    return;
  }
  if (previousPinId && previousPinId !== pinId) collapsePinLabel(previousPinId);
  if (pin?.address) state.parcelAddressCache[pinId] = pin.address;
  rerenderCurrentMapPins();
  renderSelectedParcelCard();
  if (options.focus || state.isAdmin) setMapView(pin, Math.max(getMapZoom(), 17));
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
  const statusControls = state.isAdmin || pin.status !== "delivered"
    ? `<div class="nearest-status-actions">
        <button class="nearest-status-button delivered" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="delivered">ჩაბარდა</button>
        <button class="nearest-status-button failed" type="button" data-action="setStatus" data-value="${escapeAttr(pin.id)}" data-status="failed">ვერ ჩაბარდა</button>
      </div>`
    : "";

  els.nearestParcelCard.hidden = false;
  els.appShell?.classList.toggle("has-selected-pin", state.isAdmin);
  els.appShell?.classList.toggle("courier-detail-open", !state.isAdmin);
  window.setTimeout(() => state.map?.invalidateSize?.(), 0);
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
      <section class="nearest-detail-section">
        <h3>კლიენტი</h3>
        <div class="nearest-detail">
          <span>მიმღები</span>
          <strong>${escapeHtml(pin.fullName)}</strong>
        </div>
        <div class="nearest-detail">
          <span>${state.isAdmin ? "მობილური" : "ზარი"}</span>
          ${state.isAdmin
            ? `<strong>${escapeHtml(pin.phone || "")}</strong>`
            : `<a class="call-link" href="${escapeAttr(phoneHref)}" aria-label="მიმღებთან დარეკვა">დარეკვა</a>`}
        </div>
      </section>
      <section class="nearest-detail-section">
        <h3>შეკვეთა</h3>
        <div class="nearest-detail">
          <span>მისამართი</span>
          <strong>${escapeHtml(address)}</strong>
        </div>
        ${state.isAdmin ? `
          <div class="nearest-detail">
            <span>ზონა</span>
            <strong>${escapeHtml(parcelZoneLabel(pin))}</strong>
          </div>
          <div class="nearest-detail">
            <span>მიბმის ტიპი</span>
            <strong>${escapeHtml(parcelAutoAssignLabel(pin))}</strong>
          </div>
        ` : ""}
      </section>
      <section class="nearest-detail-section">
        <h3>სტატუსი</h3>
        <div class="nearest-detail">
          <span>სტატუსი</span>
          <strong class="status-${pin.status}">${statusText}</strong>
        </div>
        ${statusControls}
      </section>
      <section class="nearest-detail-section">
        <h3>თანხა</h3>
        <div class="nearest-detail">
          <span>ქეში</span>
          <strong>${payment > 0 ? escapeHtml(formatMoney(payment)) : "ქეში არ არის"}</strong>
        </div>
      </section>
      ${pin.status === "failed" && failureReason ? `
        <section class="nearest-detail-section">
          <h3>შენიშვნა</h3>
          <div class="nearest-detail">
            <span>მიზეზი</span>
            <strong>${escapeHtml(failureReason)}</strong>
          </div>
        </section>
      ` : ""}
      ${state.isAdmin ? `
        <section class="nearest-detail-section">
          <h3>კურიერი</h3>
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
        </section>
      ` : ""}
    </div>
  `;
}


function hideSelectedParcelCard() {
  const shouldRefreshAdminPins = state.isAdmin && Boolean(state.selectedPinId);
  state.selectedPinId = null;
  state.selectedParcelCardCollapsed = false;
  els.appShell?.classList.remove("has-selected-pin", "courier-detail-open");
  window.setTimeout(() => state.map?.invalidateSize?.(), 0);
  els.nearestParcelCard.hidden = true;
  els.nearestParcelCard.classList.remove("is-collapsed");
  els.nearestParcelCard.textContent = "";
  if (shouldRefreshAdminPins) rerenderCurrentMapPins();
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
