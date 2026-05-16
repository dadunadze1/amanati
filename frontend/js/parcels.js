"use strict";



const RECENT_ADDRESSES_STORAGE_KEY = "deliveryRecentAddresses:v1";
const FAVORITE_ADDRESSES_STORAGE_KEY = "deliveryFavoriteAddresses:v1";
const ADDRESS_AUTOCOMPLETE_DEBOUNCE_MS = 900;
let refreshPinsPromise = null;
let refreshPinsQueued = false;


async function refreshPins() {
  if (refreshPinsPromise) {
    refreshPinsQueued = true;
    return refreshPinsPromise;
  }

  refreshPinsPromise = refreshPinsOnce();
  try {
    await refreshPinsPromise;
  } finally {
    refreshPinsPromise = null;
    if (refreshPinsQueued) {
      refreshPinsQueued = false;
      await refreshPins();
    }
  }
}


async function refreshPinsOnce() {
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
  scheduleMapInvalidateSize();
}


function openAdminAddParcel() {
  openAddressSearchDialog("");
}


function openAddressSearchDialog(username) {
  resetMapSelectionUi();
  const body = `
    <form id="addressSearchForm" class="address-search-form">
      <label for="addressSearchInput">მისამართის ძებნა თბილისში</label>
      <div class="address-autocomplete-shell">
        <div class="address-search-row">
          <input id="addressSearchInput" type="search" autocomplete="street-address" aria-autocomplete="list" aria-controls="addressSearchSuggestions" required>
          <button class="button primary" type="submit">ძებნა</button>
        </div>
        <div id="addressSearchSuggestions" class="address-autocomplete-dropdown" role="listbox" hidden></div>
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
    { label: "პინის გასწორება", variant: "secondary", action: () => startPendingMarkerAdjustment(username) },
    { label: "რუკაზე არჩევა", variant: "secondary", action: () => startMapSelection(username) },
    { label: "გაუქმება", variant: "secondary", action: () => { closeDialog(); cancelMapSelection(); } },
  ]);

  document.getElementById("addressSearchForm")?.addEventListener("submit", (event) => {
    handleAddressSearch(event, username);
  });
  bindAddressAutocomplete({
    inputId: "addressSearchInput",
    dropdownId: "addressSearchSuggestions",
    username,
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
  state.pendingAddressLocked = false;
  state.pendingAddressWarning = "";
  state.pendingZone = null;
  state.pendingAutoAssignment = null;
  state.mode = "selectingParcel";
  els.menuButton.hidden = true;
  els.modeToast.hidden = false;
  els.modeToast.textContent = STRINGS.chooseMapPoint;
}


function startPendingMarkerAdjustment(username) {
  const message = document.getElementById("addressSearchMessage");
  if (!state.pendingCoords) {
    if (message) message.textContent = "ჯერ მოძებნეთ მისამართი, რომ პინი დაისვას.";
    return;
  }
  closeDialog();
  state.selectedCourier = username;
  state.pendingAddressLocked = true;
  state.mode = "selectingParcel";
  els.menuButton.hidden = true;
  els.modeToast.hidden = false;
  els.modeToast.textContent = "გადაადგილე პინი ზუსტ ადგილზე, შემდეგ დააჭირე პინს ან რუკას.";
}


function cancelMapSelection() {
  if (state.mode !== "selectingParcel") return;
  resetMapSelectionUi();
}


function showPendingMarker(coords) {
  clearMapObject(state.pendingMarker);
  if (!state.map || !window.L) return;
  state.pendingMarker = L.marker(toLeafletLatLng(coords), {
    draggable: true,
    autoPan: true,
    icon: L.divIcon({
      className: "pending-parcel-marker",
      html: "<span></span>",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    }),
  });
  state.pendingMarker.addTo(state.map);
  state.pendingMarker.on("dragend", handlePendingMarkerDragEnd);
  state.pendingMarker.on("click", async (event) => {
    stopMapClick(event);
    if (state.mode !== "selectingParcel" || !state.pendingCoords) return;
    await updatePendingZoneAssignment(state.pendingCoords);
    await openParcelDetailsDialog();
    updatePendingAddressPreview();
    els.modeToast.hidden = true;
  });
}


async function handlePendingMarkerDragEnd(event) {
  const coords = toCoords(event.target.getLatLng());
  state.pendingCoords = coords;
  state.pendingAddressWarning = "პინი ხელით გადაადგილდა. მისამართის ტექსტი დარჩება როგორც ჩაწერილია.";
  await updatePendingZoneAssignment(coords);
  updateAddressSearchPreview(getPendingAddressLabel(), state.pendingAddressWarning);
  updatePendingAddressPreview();
}


async function handleMapClick(event) {
  if (state.mode !== "selectingParcel") {
    closeActions();
    closeAdminDrawer();
    collapseCourierStatsSheet();
    collapseSelectedParcelCard();
    collapseDeliveredPinLabels();
    return;
  }
  if (!event.latlng) return;
  const coords = toCoords(event.latlng);
  const lockedAddress = state.pendingAddressLocked ? getPendingAddressLabel() : "";
  state.pendingCoords = coords;
  state.pendingAddress = lockedAddress || STRINGS.addressLoading;
  state.pendingAddressWarning = "";
  setMapView(coords, Math.max(getMapZoom(), 17));
  showPendingMarker(coords);
  els.modeToast.hidden = false;
  els.modeToast.textContent = lockedAddress ? "პინი განახლდა. მისამართის ტექსტი უცვლელია." : STRINGS.addressLoading;
  const address = await reverseGeocodeCoords(coords);
  if (state.pendingCoords !== coords) return;
  state.pendingAddress = lockedAddress || address || formatCoordsAddress(coords);
  if (lockedAddress) state.pendingAddressWarning = "პინი ხელით გადაადგილდა. მისამართის ტექსტი დარჩება როგორც ჩაწერილია.";
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
    <div class="address-autocomplete-shell">
      <input id="parcelAddress" type="text" autocomplete="street-address" aria-autocomplete="list" aria-controls="parcelAddressSuggestions" value="${escapeAttr(address)}" placeholder="ქუჩა და შენობის ნომერი">
      <div id="parcelAddressSuggestions" class="address-autocomplete-dropdown" role="listbox" hidden></div>
    </div>
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
  bindAddressAutocomplete({
    inputId: "parcelAddress",
    dropdownId: "parcelAddressSuggestions",
    username: state.selectedCourier,
  });
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


function bindAddressAutocomplete({ inputId, dropdownId, username }) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;
  if (input.dataset.addressAutocompleteBound === "true") return;
  input.dataset.addressAutocompleteBound = "true";

  let debounceTimer = null;
  let documentClickHandler = null;
  let activeSearchController = null;
  let requestId = 0;
  let suggestions = [];
  let activeIndex = -1;

  const closeDropdown = () => {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    dropdown.style.display = "none";
    dropdown.style.opacity = "";
    dropdown.style.pointerEvents = "";
    dropdown.style.position = "";
    dropdown.style.transform = "";
    dropdown.style.zIndex = "";
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    if (documentClickHandler) {
      document.removeEventListener("click", documentClickHandler);
      documentClickHandler = null;
    }
  };

  const ensureDocumentClickHandler = () => {
    if (documentClickHandler) return;
    documentClickHandler = (event) => {
      if (!event.target.closest(`#${inputId}`) && !event.target.closest(`#${dropdownId}`)) closeDropdown();
    };
    document.addEventListener("click", documentClickHandler);
  };

  const forceDropdownVisible = () => {
    dropdown.hidden = false;
    dropdown.style.display = "block";
    dropdown.style.opacity = "1";
    dropdown.style.pointerEvents = "auto";
    dropdown.style.position = "absolute";
    dropdown.style.transform = "translateY(0)";
    dropdown.style.zIndex = "2500";
  };

  const render = (groups, stateClass = "") => {
    dropdown.innerHTML = "";
    suggestions = groups.flatMap((group) => group.items);
    console.log("[dropdown visible]", suggestions.length);
    activeIndex = suggestions.length ? Math.max(0, Math.min(activeIndex, suggestions.length - 1)) : -1;
    forceDropdownVisible();
    ensureDocumentClickHandler();
    dropdown.classList.toggle("is-loading", stateClass === "loading");

    if (stateClass === "loading" || stateClass === "busy") {
      dropdown.innerHTML = `<div class="address-autocomplete-state">${stateClass === "busy" ? escapeHtml(GEOCODE_BUSY_MESSAGE) : "იძებნება"}</div>`;
      return;
    }

    if (!suggestions.length) {
      dropdown.innerHTML = `<div class="address-autocomplete-state">მისამართი ვერ მოიძებნა</div>`;
      return;
    }

    let itemIndex = 0;
    dropdown.innerHTML = groups.filter((group) => group.items.length).map((group) => `
      <div class="address-autocomplete-section">
        <div class="address-autocomplete-label">${escapeHtml(group.label)}</div>
        ${group.items.map((item) => {
          const index = itemIndex++;
          const title = formatAutocompleteAddressTitle(item);
          const meta = formatAutocompleteAddressMeta(item);
          return `
            <button id="${escapeAttr(dropdownId)}-item-${index}" class="address-autocomplete-item ${index === activeIndex ? "is-active" : ""}" type="button" role="option" data-autocomplete-index="${index}" aria-selected="${index === activeIndex ? "true" : "false"}">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(meta)}</span>
            </button>
          `;
        }).join("")}
      </div>
    `).join("");
    input.setAttribute("aria-activedescendant", `${dropdownId}-item-${activeIndex}`);
  };

  const updateSuggestions = async () => {
    const query = cleanAddressInput(input.value);
    const currentRequestId = ++requestId;
    const minLength = typeof GEOCODE_MIN_QUERY_LENGTH === "number" ? GEOCODE_MIN_QUERY_LENGTH : 3;
    if (!query) {
      const groups = buildStoredAddressSuggestionGroups("");
      if (groups.some((group) => group.items.length)) render(groups);
      else closeDropdown();
      return;
    }
    if (query.length < minLength) {
      const groups = buildStoredAddressSuggestionGroups(query);
      if (groups.some((group) => group.items.length)) render(groups);
      else closeDropdown();
      return;
    }

    render([{ label: "", items: [] }], "loading");
    activeSearchController?.abort();
    activeSearchController = new AbortController();
    try {
      const [storedGroups, remoteResults] = await Promise.all([
        Promise.resolve(buildStoredAddressSuggestionGroups(query)),
        searchAddress(query, { signal: activeSearchController.signal }),
      ]);
      if (currentRequestId !== requestId) return;
      const remoteItems = remoteResults.map((item) => ({ ...item, source: "search" }));
      const groups = mergeAutocompleteGroups(storedGroups, [{ label: "ძიების შედეგები", items: remoteItems }]);
      activeIndex = groups.some((group) => group.items.length) ? 0 : -1;
      render(groups);
    } catch (error) {
      if (currentRequestId !== requestId) return;
      if (error?.name === "AbortError") return;
      const localFallback = searchLocalAddressFallback(parseAddressQuery(query)).map((item) => ({
        ...item,
        warning: error?.code === "GEOCODE_BUSY" ? GEOCODE_BUSY_MESSAGE : item.warning,
      }));
      const storedGroups = mergeAutocompleteGroups(
        buildStoredAddressSuggestionGroups(query),
        [{ label: "ლოკალური შედეგები", items: localFallback }],
      );
      setAddressAutocompleteMessage(input, error?.code === "GEOCODE_BUSY" ? GEOCODE_BUSY_MESSAGE : "");
      if (storedGroups.some((group) => group.items.length)) {
        render(storedGroups);
      } else {
        render([{ label: "", items: [] }], error?.code === "GEOCODE_BUSY" ? "busy" : "");
      }
    }
  };

  input.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    requestId += 1;
    activeSearchController?.abort();
    activeSearchController = null;
    const query = cleanAddressInput(input.value);
    const minLength = typeof GEOCODE_MIN_QUERY_LENGTH === "number" ? GEOCODE_MIN_QUERY_LENGTH : 3;
    if (query.length < minLength) {
      const groups = buildStoredAddressSuggestionGroups(query);
      if (groups.some((group) => group.items.length)) render(groups);
      else closeDropdown();
      return;
    }
    render([{ label: "", items: [] }], "loading");
    debounceTimer = window.setTimeout(updateSuggestions, ADDRESS_AUTOCOMPLETE_DEBOUNCE_MS);
  });

  input.addEventListener("focus", () => {
    const groups = buildStoredAddressSuggestionGroups(cleanAddressInput(input.value));
    if (groups.some((group) => group.items.length)) render(groups);
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!dropdown.matches(":hover")) closeDropdown();
    }, 120);
  });

  input.addEventListener("keydown", async (event) => {
    if (dropdown.hidden || (!suggestions.length && event.key !== "Enter")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, suggestions.length - 1);
      render(getRenderedAutocompleteGroups(dropdown, suggestions));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      render(getRenderedAutocompleteGroups(dropdown, suggestions));
    } else if (event.key === "Enter" && suggestions[activeIndex]) {
      event.preventDefault();
      await selectAutocompleteSuggestion(suggestions[activeIndex], input, closeDropdown, username);
    } else if (event.key === "Escape") {
      closeDropdown();
    }
  });

  dropdown.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  dropdown.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-autocomplete-index]");
    if (!button) return;
    const suggestion = suggestions[Number(button.dataset.autocompleteIndex)];
    await selectAutocompleteSuggestion(suggestion, input, closeDropdown, username);
  });

  ensureDocumentClickHandler();
}


function getRenderedAutocompleteGroups(dropdown, suggestions) {
  const labels = [...dropdown.querySelectorAll(".address-autocomplete-label")].map((item) => item.textContent);
  if (!labels.length) return [{ label: "შედეგები", items: suggestions }];
  return [{ label: "შედეგები", items: suggestions }];
}


function setAddressAutocompleteMessage(input, message) {
  const form = input?.closest("form");
  const messageElement = form?.querySelector(".form-message");
  if (messageElement) messageElement.textContent = message || "";
}


function buildStoredAddressSuggestionGroups(query) {
  const filterStored = (items) => items.filter((item) => addressSuggestionMatches(item, query));
  return [
    { label: "ბოლო მისამართები", items: filterStored(readStoredAddressList(RECENT_ADDRESSES_STORAGE_KEY)).slice(0, 10) },
    { label: "ფავორიტები", items: filterStored(readStoredAddressList(FAVORITE_ADDRESSES_STORAGE_KEY)).slice(0, 10) },
  ];
}


function mergeAutocompleteGroups(...groupSets) {
  const groups = groupSets.flat();
  const seen = new Set();
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const coords = getResultCoords(item);
      const key = `${cleanAddressInput(item.address || item.displayName || item.display_name).toLocaleLowerCase()}:${Number(coords.lat).toFixed(6)}:${Number(coords.lng).toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  }));
}


function addressSuggestionMatches(item, query) {
  const normalizedQuery = normalizeAddressToken(query);
  if (!normalizedQuery) return true;
  return normalizeAddressToken([
    item.address,
    item.displayName,
    item.display_name,
    item.suburb,
    item.city,
  ].filter(Boolean).join(" ")).includes(normalizedQuery);
}


function readStoredAddressList(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeStoredAddressSuggestion).filter(Boolean) : [];
  } catch {
    return [];
  }
}


function normalizeStoredAddressSuggestion(item) {
  const coords = getResultCoords(item);
  const address = cleanAddressInput(item?.address || item?.displayName || item?.display_name || "");
  if (!address || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
  return {
    ...item,
    lat: coords.lat,
    lng: coords.lng,
    address,
    displayName: cleanAddressInput(item.displayName || item.display_name || address),
    source: item.source || "stored",
  };
}


function saveRecentAddressSuggestion(result) {
  const normalized = normalizeStoredAddressSuggestion({
    ...result,
    address: cleanAddressInput(result.address || formatOsmAddress(result) || result.displayName || result.display_name),
    displayName: cleanAddressInput(result.displayName || result.display_name || ""),
    source: "recent",
  });
  if (!normalized) return;
  const current = readStoredAddressList(RECENT_ADDRESSES_STORAGE_KEY);
  const next = [normalized, ...current.filter((item) => !isSameAddressSuggestion(item, normalized))].slice(0, 10);
  localStorage.setItem(RECENT_ADDRESSES_STORAGE_KEY, JSON.stringify(next));
}


function isSameAddressSuggestion(a, b) {
  const coordsA = getResultCoords(a);
  const coordsB = getResultCoords(b);
  return cleanAddressInput(a.address).toLocaleLowerCase() === cleanAddressInput(b.address).toLocaleLowerCase()
    || (Math.abs(coordsA.lat - coordsB.lat) < 0.000001 && Math.abs(coordsA.lng - coordsB.lng) < 0.000001);
}


function formatAutocompleteAddressTitle(result) {
  const address = result?.address || {};
  if (address.road || address.house_number) return cleanAddressInput([address.road, address.house_number].filter(Boolean).join(" "));
  return cleanAddressInput(result.address || formatOsmAddress(result) || result.displayName || result.display_name) || STRINGS.addressMissing;
}


function formatAutocompleteAddressMeta(result) {
  const address = result?.address || {};
  const locality = address.suburb || address.city || address.town || address.village || address.municipality || result.suburb || result.city || "";
  const displayName = cleanAddressInput(result.displayName || result.display_name || "");
  return cleanAddressInput(locality || displayName || "თბილისი");
}


async function selectAutocompleteSuggestion(suggestion, input, closeDropdown, username) {
  if (!suggestion) return;
  const selectedUsername = username ?? state.selectedCourier ?? "";
  const typedAddress = cleanAddressInput(input?.value || "");
  await selectAddressSearchResult(suggestion, selectedUsername, -1, typedAddress);
  const address = getAddressLabelForSearchSelection(suggestion, typedAddress);
  if (input) input.value = address;
  saveRecentAddressSuggestion({ ...suggestion, address });
  closeDropdown();
}


async function handleAddressSearch(event, username) {
  event.preventDefault();
  const query = document.getElementById("addressSearchInput")?.value.trim();
  const message = document.getElementById("addressSearchMessage");
  const resultsElement = document.getElementById("addressSearchResults");
  if (!query) return;
  const minLength = typeof GEOCODE_MIN_QUERY_LENGTH === "number" ? GEOCODE_MIN_QUERY_LENGTH : 3;
  if (cleanAddressInput(query).length < minLength) {
    if (message) message.textContent = "შეიყვანეთ მინიმუმ 3 სიმბოლო.";
    return;
  }

  try {
    if (message) message.textContent = STRINGS.addressLoading;
    if (resultsElement) resultsElement.innerHTML = "";
    const results = await searchAddress(query);
    if (!results.length) {
      if (message) message.textContent = "მისამართი ვერ მოიძებნა";
      state.pendingZone = null;
      state.pendingAutoAssignment = null;
      updateAddressSearchPreview("");
      return;
    }
    if (message) message.textContent = results[0].warning || "";
    renderAddressSearchResults(results, username, query);
    await selectAddressSearchResult(results[0], username, 0, query);
  } catch (error) {
    const localFallback = searchLocalAddressFallback(parseAddressQuery(query));
    if (localFallback.length) {
      if (message) message.textContent = error?.code === "GEOCODE_BUSY" ? GEOCODE_BUSY_MESSAGE : "";
      renderAddressSearchResults(localFallback, username, query);
      await selectAddressSearchResult(localFallback[0], username, 0, query);
      return;
    }
    if (message) message.textContent = error?.code === "GEOCODE_BUSY" ? GEOCODE_BUSY_MESSAGE : "მისამართის ძებნა ვერ მოხერხდა.";
  }
}


function renderAddressSearchResults(results, username, requestedAddress = "") {
  const resultsElement = document.getElementById("addressSearchResults");
  if (!resultsElement) return;
  resultsElement.innerHTML = results.map((result, index) => `
    <button class="address-result-button" type="button" data-address-result-index="${index}">
      <strong>${escapeHtml(getAddressLabelForSearchSelection(result, requestedAddress) || STRINGS.addressMissing)}</strong>
      <span>${escapeHtml(result.displayName || result.display_name || formatCoordsAddress(getResultCoords(result)))}</span>
      ${result.warning ? `<small>${escapeHtml(result.warning)}</small>` : ""}
    </button>
  `).join("");
  resultsElement.querySelectorAll("[data-address-result-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectAddressSearchResult(results[Number(button.dataset.addressResultIndex)], username, Number(button.dataset.addressResultIndex), requestedAddress);
    });
  });
}


function getAddressLabelForSearchSelection(result, requestedAddress = "") {
  const requested = cleanAddressInput(requestedAddress);
  if (requested && result?.isApproximateAddress) return requested;
  return cleanAddressInput(result?.address || formatOsmAddress(result) || result?.displayName || result?.display_name);
}


async function selectAddressSearchResult(result, username, selectedIndex = -1, requestedAddress = "") {
  if (!result) return;
  const coords = getResultCoords(result);
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
  const address = getAddressLabelForSearchSelection(result, requestedAddress) || formatCoordsAddress(coords);
  console.log("[geocode] selected formatted address", address);
  state.selectedCourier = username;
  state.pendingCoords = coords;
  state.pendingAddress = address;
  state.pendingAddressLocked = Boolean(cleanAddressInput(requestedAddress));
  state.pendingAddressWarning = result.warning || "";
  showPendingMarker(coords);
  if (state.map?.flyTo) {
    state.map.flyTo(toLeafletLatLng(coords), 17, { duration: 0.45 });
  } else {
    setMapView(coords, 17);
  }
  await updatePendingZoneAssignment(coords);
  updateAddressSearchPreview(address, state.pendingAddressWarning);
  updatePendingAddressPreview();
  saveRecentAddressSuggestion({ ...result, address });
  const addressSearchInput = document.getElementById("addressSearchInput");
  const parcelAddressInput = document.getElementById("parcelAddress");
  if (addressSearchInput) addressSearchInput.value = address;
  if (parcelAddressInput) parcelAddressInput.value = address;
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
  state.pendingAddressLocked = Boolean(getPendingAddressLabel());
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
  if (status === "failed" && !String(options.failureReason || "").trim()) {
    openFailureReasonDialog(pinId);
    return;
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


function openFailureReasonDialog(pinId) {
  const body = `
    <form id="failureReasonForm">
      <label for="failureReasonInput">რატომ ვერ ჩაბარდა?</label>
      <textarea id="failureReasonInput" rows="4" maxlength="240" required placeholder="მაგ: არ პასუხობს, მისამართზე არ იყო, ნომერი არასწორია"></textarea>
      <p id="failureReasonMessage" class="form-message" role="alert"></p>
    </form>
  `;

  showDialog("ვერ ჩაბარდა", body, [
    { label: "შენახვა", variant: "primary", action: () => submitFailureReason(pinId) },
    { label: "გაუქმება", variant: "secondary", action: closeDialog },
  ]);

  document.getElementById("failureReasonForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitFailureReason(pinId);
  });
  document.getElementById("failureReasonInput")?.focus();
}


async function submitFailureReason(pinId) {
  const input = document.getElementById("failureReasonInput");
  const message = document.getElementById("failureReasonMessage");
  const failureReason = String(input?.value || "").trim();
  if (!failureReason) {
    if (message) message.textContent = "მიუთითეთ მიზეზი.";
    input?.focus();
    return;
  }

  try {
    await updatePinStatus(pinId, "failed", { failureReason });
    closeDialog();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
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


function focusCourierPin(pinId = state.selectedPinId) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;
  setMapView(pin, Math.max(getMapZoom(), 17));
}


async function routeSelectedParcel(pinId = state.selectedPinId) {
  if (state.isAdmin) return;
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;
  if (!state.hasCurrentPosition) {
    showToast("მდებარეობა ჯერ არ არის განსაზღვრული.");
    return;
  }

  state.selectedPinId = pin.id;
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
    { label: "კი", variant: "primary", action: () => { openGoogleMapsRouteExternally(origin, pin); closeDialog(); } },
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

  state.routeLayer = typeof buildPremiumRouteLayer === "function"
    ? buildPremiumRouteLayer(latLngs).addTo(state.map)
    : L.polyline(latLngs, {
      color: "#2563eb",
      weight: 6,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(state.map);
  state.routePinId = pin.id;
  fitRouteLayerBounds(state.routeLayer);
  renderSelectedParcelCard();
}


function fitRouteLayerBounds(routeLayer) {
  if (!state.map || !routeLayer) return;

  let bounds = null;
  if (typeof routeLayer.getBounds === "function") {
    bounds = routeLayer.getBounds();
  } else if (typeof routeLayer.eachLayer === "function" && window.L?.featureGroup) {
    bounds = L.featureGroup(routeLayer.getLayers?.() || []).getBounds();
  } else if (routeLayer._layers && window.L?.featureGroup) {
    bounds = L.featureGroup(Object.values(routeLayer._layers)).getBounds();
  }

  if (!bounds || (typeof bounds.isValid === "function" && !bounds.isValid())) return;
  state.map.fitBounds(bounds, { padding: [38, 38], maxZoom: 17 });
}


function openGoogleMapsRouteExternally(origin, pin) {
  const url = buildGoogleMapsRouteUrl(origin, pin);
  if (!url) return;

  const appLauncher = window.Capacitor?.Plugins?.AppLauncher;
  if (appLauncher?.openUrl) {
    appLauncher.openUrl({ url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
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


function getPreviousDateKey(dateKey = getTodayKey()) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
}


function parcelCompletedDateKey(parcel) {
  return toDateKey(new Date(parcel.deliveredAt || parcel.completedAt || parcel.updatedAt || parcel.createdAt));
}


async function runAutoDayClose(closeDate = getPreviousDateKey()) {
  if (!state.currentUser || state.autoCloseInProgress) return { archived: 0 };

  if (!closeDate) return { archived: 0 };
  if (loadData(`deliveryAutoCloseDone:${closeDate}`)) return { archived: 0 };

  state.autoCloseInProgress = true;
  try {
    if (isStaticDeploy() && typeof loadStaticBootstrap === "function") {
      const store = await loadStaticBootstrap();
      if (store?.settings?.lastAutoCloseDate === closeDate) {
        saveData(`deliveryAutoCloseDone:${closeDate}`, true);
        return { archived: 0 };
      }
    }

    const pins = await getPins(isStaticDeploy() || state.isAdmin ? "" : state.currentUser);
    const deliveredPins = pins.filter((pin) => (
      isCompletedParcelStatus(pin)
      && !pin.archivedAt
      && parcelCompletedDateKey(pin) <= closeDate
    ));
    if (!deliveredPins.length) {
      saveData(`deliveryAutoCloseDone:${closeDate}`, true);
      return { archived: 0 };
    }

    const payload = await api("/api/parcels/archive", {
      method: "POST",
      body: {
        status: "delivered",
        autoClosedDate: closeDate,
        parcelIds: deliveredPins.map((pin) => pin.id),
      },
    });
    saveData(`deliveryAutoCloseDone:${closeDate}`, true);
    if (payload.archived) showToast(`დღე ავტომატურად დაიხურა: ${payload.archived} ამანათი`);
    return payload;
  } catch (error) {
    console.warn("Auto day close failed", error);
    return { archived: 0 };
  } finally {
    state.autoCloseInProgress = false;
  }
}


function getRetentionCutoffDateKey(referenceDate = new Date()) {
  const cutoff = new Date(referenceDate);
  cutoff.setHours(12, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - Number(CONFIG.dataRetentionMonths || 8));
  return toDateKey(cutoff);
}


async function runAutoRetentionCleanup() {
  if (!state.currentUser || !state.isAdmin || state.retentionCleanupInProgress) return { deletedParcels: 0 };

  const todayKey = getTodayKey();
  const localDoneKey = `deliveryRetentionCleanupDone:${todayKey}`;
  if (loadData(localDoneKey)) return { deletedParcels: 0 };

  state.retentionCleanupInProgress = true;
  try {
    if (isStaticDeploy() && typeof loadStaticBootstrap === "function") {
      const store = await loadStaticBootstrap();
      if (store?.settings?.lastRetentionCleanupDate === todayKey) {
        saveData(localDoneKey, true);
        return { deletedParcels: 0 };
      }
    }

    const cutoffDate = getRetentionCutoffDateKey();
    const payload = await api("/api/maintenance/retention", {
      method: "POST",
      body: {
        cutoffDate,
        retentionMonths: Number(CONFIG.dataRetentionMonths || 8),
      },
    });
    saveData(localDoneKey, true);
    const deletedTotal = Number(payload.deletedParcels || 0) + Number(payload.deletedCashAdjustments || 0) + Number(payload.deletedPayAdjustments || 0);
    if (deletedTotal > 0) {
      showToast(`ძველი მონაცემები გასუფთავდა: ${deletedTotal} ჩანაწერი`);
    }
    return payload;
  } catch (error) {
    console.warn("Retention cleanup failed", error);
    return { deletedParcels: 0 };
  } finally {
    state.retentionCleanupInProgress = false;
  }
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
  state.pendingAddressLocked = false;
  state.pendingAddressWarning = "";
  state.pendingZone = null;
  state.pendingAutoAssignment = null;
  els.menuButton.hidden = false;
  els.modeToast.hidden = true;
}
