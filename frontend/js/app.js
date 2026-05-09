"use strict";



function cacheElements() {
  els.appShell = document.querySelector(".app-shell");
  [
    "map", "adminDashboard", "courierDashboard", "menuButton", "actionPanel", "bottomNav", "courierOrdersSheet", "modeToast", "courierStatsCard", "nearestParcelCard",
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
  bindCourierSheetEvents();
  document.addEventListener("click", (event) => {
    const presenceToggle = event.target.closest("[data-courier-presence-toggle]");
    if (presenceToggle) {
      const modes = ["online", "break", "offline"];
      const labels = { online: "Online", break: "Break", offline: "Offline" };
      const current = modes.includes(presenceToggle.dataset.mode) ? presenceToggle.dataset.mode : "online";
      const next = modes[(modes.indexOf(current) + 1) % modes.length];
      presenceToggle.dataset.mode = next;
      presenceToggle.classList.remove("courier-status-online", "courier-status-busy", "courier-status-delivering", "courier-status-break", "courier-status-offline");
      presenceToggle.classList.add(`courier-status-${next}`);
      presenceToggle.querySelector("strong").textContent = labels[next];
      return;
    }
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


function renderActions() {
  const actions = state.isAdmin
    ? [
        ["showAllAdminPins", "რუკა", "⌖", "ყველა პინის ჩვენება"],
        ["addParcel", "ამანათები", "+", "ახალი ამანათის დამატება"],
        ["adminUsers", "კურიერები", "◎", "კურიერების მართვა"],
        ["adminFinance", "ფინანსები", "₾", "ფინანსური პანელი"],
        ["parcelHistory", "ისტორია", "◷", "ამანათების ისტორია"],
        ["zoneManagement", "ზონები", "▧", "ზონების მართვა"],
        ["changePassword", "პარამეტრები", "⚙", "პაროლის შეცვლა"],
      ]
    : [
        ["courierParcels", "ჩემი ამანათები", "□"],
        ["today", "ჩემი დღე", "◷"],
        ["courierFinance", "ქეში", "₾"],
        ["history", "ისტორია", "↺"],
        ["logout", "გასვლა", "←"],
      ];

  const secondaryActions = state.isAdmin
    ? [
        ["adminRegister", "რეგისტრაცია", "+"],
        ["adminStats", "სტატისტიკა", "▦"],
        ["adminMap", "ფილტრები", "◉"],
        ["adminCloseDay", "დღის დახურვა", "✓"],
        ["logout", "გასვლა", "←"],
      ]
    : [];

  const renderActionButton = ([action, label, icon, hint], className = "action-item", isActive = false) => `
    <button class="${className}${isActive ? " is-active" : ""}" type="button" data-action="${action}" title="${escapeAttr(hint || label)}">
      <b aria-hidden="true">${escapeHtml(icon || "")}</b>
      <span>${escapeHtml(label)}</span>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </button>
  `;

  if (els.menuButton) {
    els.menuButton.hidden = !state.isAdmin;
    if (!state.isAdmin) els.menuButton.setAttribute("aria-expanded", "false");
  }

  els.actionPanel.hidden = !state.isAdmin;
  if (!state.isAdmin) els.actionPanel.classList.remove("show");
  els.actionPanel.innerHTML = state.isAdmin
    ? `
      <div class="app-sidebar-brand">
        <span aria-hidden="true">DC</span>
        <div>
          <strong>Dispatch</strong>
          <small>Admin dashboard</small>
        </div>
      </div>
      <div class="app-sidebar-section">
        ${actions.map((item) => renderActionButton(item)).join("")}
      </div>
      <div class="app-sidebar-section app-sidebar-section--secondary">
        <span class="app-sidebar-label">სწრაფი მოქმედებები</span>
        ${secondaryActions.map((item) => renderActionButton(item, "action-item action-item--secondary")).join("")}
      </div>
    `
    : "";

  if (els.bottomNav) {
    els.bottomNav.hidden = !state.currentUser;
    els.bottomNav.innerHTML = state.isAdmin
      ? actions.slice(0, 5).map((item) => renderActionButton(item, "bottom-nav-item")).join("")
      : actions.map((item, index) => renderActionButton(item, "bottom-nav-item", index === 0)).join("");
  }
}


function bindCourierSheetEvents() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-courier-sheet-toggle]");
    if (!toggle || !els.courierOrdersSheet) return;
    els.courierOrdersSheet.classList.toggle("is-expanded");
  });

  let startY = 0;
  let dragging = false;
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".courier-sheet-handle")) return;
    startY = event.clientY;
    dragging = true;
  });
  document.addEventListener("pointerup", (event) => {
    if (!dragging || !els.courierOrdersSheet) return;
    dragging = false;
    const delta = event.clientY - startY;
    if (Math.abs(delta) < 20) return;
    els.courierOrdersSheet.classList.toggle("is-expanded", delta < 0);
  });
}


async function renderAdminDashboard(pins = state.activePins) {
  if (!els.adminDashboard) return;
  if (!state.isAdmin || !state.currentUser) {
    els.adminDashboard.hidden = true;
    els.adminDashboard.textContent = "";
    els.appShell?.classList.remove("is-admin-dashboard");
    return;
  }

  els.appShell?.classList.add("is-admin-dashboard");
  els.adminDashboard.hidden = false;

  let courierCount = state.adminMapCouriers?.length || 0;
  try {
    const couriers = await getCouriers();
    courierCount = couriers.length;
  } catch {
    courierCount = state.adminMapCouriers?.length || 0;
  }

  const todayKey = toDateKey(new Date());
  const dailyCash = calculateFinanceSummary({ records: pins }, { startDate: todayKey, endDate: todayKey }).cashReceived;
  const filters = getAdminMapFilters();
  const cards = [
    { label: "სულ პინები", value: pins.length, tone: "primary", action: "showAllAdminPins", active: filters.status === "all" },
    { label: "პროცესში", value: pins.filter((pin) => pin.status === "pending").length, tone: "neutral", action: "adminMapSetStatus", dataValue: "pending", active: filters.status === "pending" },
    { label: "ჩაბარებული", value: pins.filter((pin) => pin.status === "delivered").length, tone: "success", action: "adminMapSetStatus", dataValue: "delivered", active: filters.status === "delivered" },
    { label: "ვერ ჩაბარებული", value: pins.filter((pin) => pin.status === "failed").length, tone: "danger", action: "adminMapSetStatus", dataValue: "failed", active: filters.status === "failed" },
    { label: "კურიერები", value: courierCount, tone: "primary", action: "adminUsers" },
    { label: "დღიური თანხა", value: formatMoney(dailyCash), tone: "warning", action: "adminFinance" },
  ];

  els.adminDashboard.innerHTML = cards.map((card) => `
    <button class="dashboard-card dashboard-card--${escapeAttr(card.tone)} ${card.active ? "is-active" : ""}" type="button" data-action="${escapeAttr(card.action)}"${card.dataValue ? ` data-value="${escapeAttr(card.dataValue)}"` : ""}>
      <i aria-hidden="true"></i>
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
    </button>
  `).join("");
}


function refreshAdminDashboardFilterState() {
  if (!els.adminDashboard || !state.isAdmin) return;
  const filters = getAdminMapFilters();
  els.adminDashboard.querySelectorAll(".dashboard-card").forEach((card) => {
    const status = card.dataset.value || "all";
    const isStatusCard = card.dataset.action === "adminMapSetStatus" || card.dataset.action === "showAllAdminPins";
    card.classList.toggle("is-active", isStatusCard && filters.status === status);
  });
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


const ADMIN_PIN_CONTEXT_KEEP_ACTIONS = new Set([
  "focusSelectedParcel",
  "toggleSelectedParcelCard",
  "setStatus",
]);


function closeAdminPinContextForAction(action) {
  if (!state.isAdmin || ADMIN_PIN_CONTEXT_KEEP_ACTIONS.has(action)) return;
  closeAdminPinContext();
}


function closeAdminPinContext() {
  if (!state.isAdmin) return;
  collapseDeliveredPinLabels();
  if (state.selectedPinId) hideSelectedParcelCard();
}


async function handleAction(action, value, sourceElement) {
  closeActions();
  closeAdminPinContextForAction(action);

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
    myParcels: openCourierParcels,
    nearestParcel: openNearestParcel,
    courierRoute: openCourierRoute,
    courierStatusPanel: openCourierStatusPanel,
    routeCourierPin: async () => {
      openParcelTab(value, { focus: true });
      await routeSelectedParcel();
      await renderCourierMobileDashboard().catch(() => {});
    },
    today: openTodayStats,
    courierDay: openTodayStats,
    history: () => openCalendar(state.currentUser, "ჩემი ისტორია"),
    courierHistory: () => openCalendar(state.currentUser, "ჩემი ისტორია"),
    courierFinance: () => openFinanceCourier(state.currentUser),
    courierCash: () => openFinanceCourier(state.currentUser),
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
    adminMapSetStatus: () => adminMapSetStatus(value),
    adminMapToggleAllCouriers,
    adminMapToggleUnassigned,
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


function showDialog(title, body, actions = []) {
  closeAdminPinContext();
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
  els.appShell?.classList.remove("is-admin-dashboard", "is-courier-mobile", "has-selected-pin", "courier-detail-open");
  if (els.adminDashboard) {
    els.adminDashboard.hidden = true;
    els.adminDashboard.textContent = "";
  }
  if (els.bottomNav) {
    els.bottomNav.hidden = true;
    els.bottomNav.textContent = "";
  }
  if (els.courierDashboard) {
    els.courierDashboard.hidden = true;
    els.courierDashboard.textContent = "";
  }
  if (els.courierOrdersSheet) {
    els.courierOrdersSheet.hidden = true;
    els.courierOrdersSheet.textContent = "";
    els.courierOrdersSheet.classList.remove("is-expanded");
  }
  clearActiveRoute();
  clearParcelOverlays();
  clearHistoryPreviewMarker();
  hideSelectedParcelCard();
  renderCourierStatsCard([]);
  els.loginForm.reset();
  showModal(els.authModal);
}

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  await initializeMap();
  checkDayChange();
  initializeAuth();
});
