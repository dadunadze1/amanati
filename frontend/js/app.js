"use strict";



function cacheElements() {
  els.appShell = document.querySelector(".app-shell");
  [
    "map", "adminDashboard", "courierDashboard", "menuButton", "actionPanel", "bottomNav", "courierOrdersSheet", "modeToast", "courierStatsCard", "nearestParcelCard",
    "adminDrawerOverlay", "adminMobileDrawer", "adminMobileDrawerBody", "adminDrawerClose",
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
    if (state.isAdmin && isMobileViewport()) {
      openAdminDrawer();
      return;
    }
    toggleActions();
  });
  els.dialogModal?.addEventListener("click", handleDialogBackdropClick);
  bindCourierSheetEvents();
  bindCourierStatsSheetEvents();
  bindAdminDrawerEvents();
  document.addEventListener("click", (event) => {
    const drawerToggle = event.target.closest("[data-admin-drawer-toggle]");
    if (drawerToggle) {
      collapseCourierStatsSheet();
      openAdminDrawer();
      return;
    }

    const presenceToggle = event.target.closest("[data-courier-presence-toggle]");
    if (presenceToggle) {
      const modes = ["online", "offline"];
      const labels = { online: "Online", offline: "Offline" };
      const current = modes.includes(presenceToggle.dataset.mode) ? presenceToggle.dataset.mode : "online";
      const next = modes[(modes.indexOf(current) + 1) % modes.length];
      state.courierPresenceStatus = next;
      presenceToggle.dataset.mode = next;
      presenceToggle.classList.remove("courier-status-online", "courier-status-busy", "courier-status-delivering", "courier-status-break", "courier-status-offline");
      presenceToggle.classList.add(`courier-status-${next}`);
      presenceToggle.querySelector("strong").textContent = labels[next];
      handleCourierPresenceChange();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.closest("#bottomNav")) collapseCourierStatsSheet();
    if (button.closest("#adminMobileDrawer")) closeAdminDrawer();
    handleAction(button.dataset.action, button.dataset.value, button);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDialog();
      cancelMapSelection();
      closeAdminDrawer();
      collapseCourierStatsSheet();
    }
  });
}


function handleDialogBackdropClick(event) {
  if (event.target !== els.dialogModal) return;
  closeActions();
  closeDialog();
}


function renderActions() {
  const adminActionGroups = [
    {
      label: "რუკა",
      actions: [
        ["showAllAdminPins", "რუკა", "⌖", "ყველა პინის ჩვენება"],
        ["liveCouriers", "Live სია", "●", "კურიერების live სტატუსი"],
        ["adminMap", "ფილტრები", "◉", "რუკის ფილტრები"],
      ],
    },
    {
      label: "შეჯამება",
      actions: [
        state.adminDashboardHidden
          ? ["showAdminDashboard", "გახსნა", "▥", "შეჯამების ბარის გახსნა"]
          : ["hideAdminDashboard", "დახურვა", "▤", "შეჯამების ბარის დახურვა"],
      ],
    },
    {
      label: "ამანათები",
      actions: [
        ["addParcel", "დამატება", "+", "ახალი ამანათის დამატება"],
        ["parcelHistory", "ისტორია", "◷", "ამანათების ისტორია"],
        ["adminCloseDay", "დღის დახურვა", "✓", "დღის დახურვა"],
      ],
    },
    {
      label: "კურიერები",
      actions: [
        ["adminUsers", "სია", "◎", "კურიერების მართვა"],
        ["adminRegister", "რეგისტრაცია", "+", "კურიერის ან ადმინის დამატება"],
        ["zoneManagement", "ზონები", "▧", "ზონების მართვა"],
        ["adminStats", "სტატისტიკა", "▦", "კურიერების სტატისტიკა"],
      ],
    },
    {
      label: "ფინანსები",
      actions: [
        ["adminFinance", "ფინანსები", "₾", "ფინანსური პანელი"],
      ],
    },
    {
      label: "პარამეტრები",
      actions: [
        ["changePassword", "პაროლი", "⚙", "პაროლის შეცვლა"],
        ["logout", "გასვლა", "←", "სისტემიდან გასვლა"],
      ],
    },
  ];
  const actions = state.isAdmin
    ? [
        ["showAllAdminPins", "რუკა", "⌖", "ყველა პინის ჩვენება"],
        ["addParcel", "ამანათები", "+", "ახალი ამანათის დამატება"],
        state.adminDashboardHidden
          ? ["showAdminDashboard", "გახსნა", "▥", "შეჯამების ბარის გახსნა"]
          : ["hideAdminDashboard", "დახურვა", "▤", "შეჯამების ბარის დახურვა"],
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
        <span class="swift-brand-mark" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </span>
        <div>
          <strong>Swift Delivery</strong>
          <small>Admin dashboard</small>
        </div>
      </div>
      <div class="app-sidebar-section">
        ${renderAdminActionGroups(adminActionGroups, renderActionButton)}
      </div>
    `
    : "";

  renderAdminMobileDrawer(adminActionGroups, renderActionButton);

  if (els.bottomNav) {
    els.bottomNav.hidden = !state.currentUser;
    els.bottomNav.innerHTML = state.isAdmin
      ? `${actions.slice(0, 4).map((item) => renderActionButton(item, "bottom-nav-item")).join("")}
        <button class="bottom-nav-item bottom-nav-item--menu" type="button" data-admin-drawer-toggle aria-label="სრული მენიუს გახსნა">
          <b aria-hidden="true">☰</b>
          <span>მენიუ</span>
        </button>`
      : actions.map((item, index) => renderActionButton(item, "bottom-nav-item", index === 0)).join("");
  }
}


function renderAdminActionGroups(groups, renderActionButton, itemClassName = "action-item") {
  return groups.map((group) => `
    <div class="admin-action-group">
      <span class="app-sidebar-label">${escapeHtml(group.label)}</span>
      ${group.actions.map((item) => renderActionButton(item, itemClassName)).join("")}
    </div>
  `).join("");
}


function renderAdminMobileDrawer(adminActionGroups, renderActionButton) {
  if (!els.adminMobileDrawerBody) return;
  if (!state.isAdmin) {
    els.adminMobileDrawerBody.textContent = "";
    closeAdminDrawer();
    return;
  }

  els.adminMobileDrawerBody.innerHTML = `
    <div class="admin-mobile-drawer-section">
      ${renderAdminActionGroups(adminActionGroups, renderActionButton, "action-item mobile-admin-drawer-item")}
    </div>
  `;
}


function bindCourierSheetEvents() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-courier-sheet-toggle]");
    if (toggle && event.target.closest(".app-shell.is-courier-mobile")) return;
    if (!toggle || !els.courierOrdersSheet) return;
    els.courierOrdersSheet.classList.toggle("is-expanded");
  });

  let startY = 0;
  let dragging = false;
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".app-shell.is-courier-mobile")) return;
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


function bindCourierStatsSheetEvents() {
  let startY = 0;
  let dragging = false;
  let pointerId = null;

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".app-shell.is-courier-mobile")) return;
    if (!els.courierStatsCard || els.courierStatsCard.hidden || !event.target.closest("#courierStatsCard")) return;
    startY = event.clientY;
    dragging = true;
    pointerId = event.pointerId;
    els.courierStatsCard.classList.add("is-dragging");
    els.courierStatsCard.setPointerCapture?.(pointerId);
  });

  document.addEventListener("pointerup", (event) => {
    if (!dragging || !els.courierStatsCard) return;
    dragging = false;
    pointerId = null;
    els.courierStatsCard.classList.remove("is-dragging");
    const delta = event.clientY - startY;
    if (Math.abs(delta) < 18) {
      if (event.target.closest(".bottom-sheet-handle")) toggleCourierStatsSheet();
      return;
    }
    if (delta < 0) expandCourierStatsSheet();
    if (delta > 0) collapseCourierStatsSheet();
  });

  document.addEventListener("pointercancel", () => {
    if (!dragging || !els.courierStatsCard) return;
    dragging = false;
    pointerId = null;
    els.courierStatsCard.classList.remove("is-dragging");
  });
}


function expandCourierStatsSheet() {
  if (!els.courierStatsCard || els.courierStatsCard.hidden) return;
  els.courierStatsCard.classList.remove("collapsed");
  els.courierStatsCard.classList.add("expanded");
  els.courierStatsCard.setAttribute("aria-expanded", "true");
}


function collapseCourierStatsSheet() {
  if (!els.courierStatsCard) return;
  els.courierStatsCard.classList.remove("expanded");
  els.courierStatsCard.classList.add("collapsed");
  els.courierStatsCard.setAttribute("aria-expanded", "false");
}


function toggleCourierStatsSheet() {
  if (!els.courierStatsCard || els.courierStatsCard.hidden) return;
  if (els.courierStatsCard.classList.contains("expanded")) {
    collapseCourierStatsSheet();
  } else {
    expandCourierStatsSheet();
  }
}


function bindAdminDrawerEvents() {
  els.adminDrawerOverlay?.addEventListener("click", closeAdminDrawer);
  els.adminDrawerClose?.addEventListener("click", closeAdminDrawer);

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let startedFromRightEdge = false;
  let startedInDrawer = false;

  document.addEventListener("touchstart", (event) => {
    if (!state.isAdmin || !isMobileViewport() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = startX;
    currentY = startY;
    startedFromRightEdge = startX >= window.innerWidth - 28;
    startedInDrawer = Boolean(event.target.closest("#adminMobileDrawer"));
  }, { passive: true });

  document.addEventListener("touchmove", (event) => {
    if (!state.isAdmin || !isMobileViewport() || event.touches.length !== 1) return;
    currentX = event.touches[0].clientX;
    currentY = event.touches[0].clientY;
  }, { passive: true });

  document.addEventListener("touchend", (event) => {
    if (!state.isAdmin || !isMobileViewport() || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    currentX = touch.clientX || currentX;
    currentY = touch.clientY || currentY;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const isHorizontalSwipe = Math.abs(deltaX) > 56 && Math.abs(deltaY) < 80;

    if (startedFromRightEdge && isHorizontalSwipe && deltaX < 0) {
      openAdminDrawer();
    } else if (startedInDrawer && isHorizontalSwipe && deltaX > 0) {
      closeAdminDrawer();
    }

    startedFromRightEdge = false;
    startedInDrawer = false;
  }, { passive: true });
}


function openAdminDrawer() {
  if (!state.isAdmin || !els.adminMobileDrawer) return;
  closeActions();
  els.adminMobileDrawer.classList.add("is-open");
  els.adminMobileDrawer.setAttribute("aria-hidden", "false");
  if (els.adminDrawerOverlay) {
    els.adminDrawerOverlay.hidden = false;
    requestAnimationFrame(() => els.adminDrawerOverlay.classList.add("is-open"));
  }
  els.menuButton?.setAttribute("aria-expanded", "true");
}


function closeAdminDrawer() {
  if (!els.adminMobileDrawer) return;
  els.adminMobileDrawer.classList.remove("is-open");
  els.adminMobileDrawer.setAttribute("aria-hidden", "true");
  if (els.adminDrawerOverlay) {
    els.adminDrawerOverlay.classList.remove("is-open");
    window.setTimeout(() => {
      if (!els.adminDrawerOverlay?.classList.contains("is-open")) els.adminDrawerOverlay.hidden = true;
    }, 250);
  }
  els.menuButton?.setAttribute("aria-expanded", "false");
}


function isMobileViewport() {
  return window.matchMedia("(max-width: 960px)").matches;
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
  els.adminDashboard.hidden = Boolean(state.adminDashboardHidden);

  let courierCount = state.adminMapCouriers?.length || 0;
  let onlineCourierCount = 0;
  try {
    const couriers = await getCouriers();
    courierCount = couriers.length;
    onlineCourierCount = typeof getOnlineCourierCount === "function" ? getOnlineCourierCount(couriers) : 0;
  } catch {
    courierCount = state.adminMapCouriers?.length || 0;
  }

  const todayKey = toDateKey(new Date());
  const dailyCash = calculateFinanceSummary({ records: pins }, { startDate: todayKey, endDate: todayKey }).cashReceived;
  const filters = getAdminMapFilters();
  const unassignedCount = pins.filter((pin) => !pin.courierUsername).length;
  const cards = [
    { label: "სულ პინები", value: pins.length, tone: "primary", action: "showAllAdminPins", active: filters.status === "all" },
    { label: "პროცესში", value: pins.filter((pin) => pin.status === "pending").length, tone: "neutral", action: "adminMapSetStatus", dataValue: "pending", active: filters.status === "pending" },
    { label: "ჩაბარებული", value: pins.filter((pin) => pin.status === "delivered").length, tone: "success", action: "adminMapSetStatus", dataValue: "delivered", active: filters.status === "delivered" },
    { label: "ვერ ჩაბარებული", value: pins.filter((pin) => pin.status === "failed").length, tone: "danger", action: "adminMapSetStatus", dataValue: "failed", active: filters.status === "failed" },
    { label: "მიუბმელი", value: unassignedCount, tone: "warning", action: "showUnassignedAdminPins", active: filters.showUnassigned && filters.status === "all" && !filters.selectedCouriers.length },
    { label: "Online", value: onlineCourierCount, tone: "success", action: "liveCouriers" },
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
  scheduleMapInvalidateSize();
}


function showAdminDashboard() {
  state.adminDashboardHidden = false;
  if (els.adminDashboard) {
    els.adminDashboard.hidden = false;
  }
  renderActions();
  renderAdminDashboard().catch(() => {});
  scheduleMapInvalidateSize(120);
}


function hideAdminDashboard() {
  state.adminDashboardHidden = true;
  if (els.adminDashboard) {
    els.adminDashboard.hidden = true;
  }
  renderActions();
  renderAdminDashboard().catch(() => {});
  scheduleMapInvalidateSize(120);
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
    liveCouriers: openLiveCouriersDialog,
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
    showAdminDashboard,
    hideAdminDashboard,
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
  closeAdminDrawer();
  collapseCourierStatsSheet();
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
  state.adminDashboardHidden = false;
  els.appShell?.classList.remove("is-admin-dashboard", "is-courier-mobile", "has-selected-pin", "courier-detail-open");
  if (els.adminDashboard) {
    els.adminDashboard.hidden = true;
    els.adminDashboard.textContent = "";
  }
  if (els.bottomNav) {
    els.bottomNav.hidden = true;
    els.bottomNav.textContent = "";
  }
  if (els.menuButton) {
    els.menuButton.hidden = true;
    els.menuButton.setAttribute("aria-expanded", "false");
  }
  if (els.actionPanel) {
    els.actionPanel.hidden = true;
    els.actionPanel.textContent = "";
    els.actionPanel.classList.remove("show");
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
  startDayChangeWatcher();
  initializeAuth();
});
