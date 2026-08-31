"use strict";



const CLIENT_ERROR_STORAGE_KEY = "deliveryClientErrors:v1";
const CLIENT_ERROR_LIMIT = 25;
const APP_SERVICE_WORKER_URL = "./firebase-messaging-sw.js?v=30";
const ADMIN_AUTO_REFRESH_MS = 30000;

function cacheElements() {
  els.appShell = document.querySelector(".app-shell");
  [
    "map", "partnerMapControls", "adminDashboard", "courierDashboard", "partnerDashboard", "menuButton", "actionPanel", "bottomNav", "courierOrdersSheet", "modeToast", "courierStatsCard", "nearestParcelCard",
    "adminDrawerOverlay", "adminMobileDrawer", "adminMobileDrawerBody", "adminDrawerClose",
    "setupModal", "setupForm", "setupUsername", "setupPassword",
    "setupError", "authModal", "loginForm", "loginUsername", "loginPassword",
    "loginError", "showRegisterButton", "registerModal", "registerForm", "regUsername",
    "regFirstName", "regLastName", "regPhone", "regPassword", "regError", "backToLoginButton", "pushGateModal",
    "pushGateMessage", "pushGateEnableButton", "pushGateLogoutButton", "dialogModal", "dialogTitle",
    "dialogBody", "dialogActions",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}


function recordClientIssue(type, error, meta = {}) {
  if (typeof state !== "object") return;
  const issue = {
    type,
    message: error?.message || String(error || ""),
    stack: error?.stack || "",
    meta,
    url: window.location.href,
    user: state.currentUser || "",
    createdAt: new Date().toISOString(),
  };
  state.clientErrors = [issue, ...(state.clientErrors || [])].slice(0, CLIENT_ERROR_LIMIT);
  try {
    saveData(CLIENT_ERROR_STORAGE_KEY, state.clientErrors);
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
  console.warn("[monitor]", type, issue);
}

function initializeErrorMonitoring() {
  try {
    state.clientErrors = loadData(CLIENT_ERROR_STORAGE_KEY) || [];
  } catch {
    state.clientErrors = [];
  }
  window.addEventListener("error", (event) => {
    recordClientIssue("runtime-error", event.error || event.message, {
      filename: event.filename || "",
      lineno: event.lineno || 0,
      colno: event.colno || 0,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordClientIssue("unhandled-rejection", event.reason || "Unhandled promise rejection");
  });
}

function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(APP_SERVICE_WORKER_URL, { scope: "./" }).catch((error) => {
    recordClientIssue("service-worker-register-error", error);
  });
}


function bindEvents() {
  els.setupForm.addEventListener("submit", handleAdminSetup);
  els.loginForm.addEventListener("submit", handleLogin);
  els.registerForm.addEventListener("submit", handleRegistration);
  els.showRegisterButton?.addEventListener("click", () => switchModal("register"));
  els.backToLoginButton.addEventListener("click", () => switchModal("login"));
  els.pushGateEnableButton?.addEventListener("click", handleRequiredPushEnable);
  els.pushGateLogoutButton?.addEventListener("click", logout);
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-password-toggle]");
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.passwordToggle);
    if (!input) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    toggle.classList.toggle("is-visible", reveal);
    toggle.setAttribute("aria-label", reveal ? "პაროლის დამალვა" : "პაროლის ჩვენება");
  });
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
  bindAdminDashboardSwipeEvents();
  bindAdminDashboardEdgeSwipeEvents();
  bindCourierSwipeCloseEvents();
  bindPartnerMapSwipeCloseEvents();
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
      const labels = { online: "ონლაინ", offline: "ოფლაინ" };
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


function bindPartnerMapSwipeCloseEvents() {
  let tracking = false;
  let startX = 0;
  let startY = 0;

  document.addEventListener("touchstart", (event) => {
    if (!state.isPartner || !state.partnerMapActive || event.touches.length !== 2) return;
    if (event.target.closest("#partnerMapControls, #bottomNav, .leaflet-control, .leaflet-popup")) return;
    startX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    startY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    tracking = true;
  }, { passive: true });

  document.addEventListener("touchend", (event) => {
    if (!tracking || !state.isPartner || !state.partnerMapActive) return;
    tracking = false;
    if (event.changedTouches.length < 2) return;
    const endX = (event.changedTouches[0].clientX + event.changedTouches[1].clientX) / 2;
    const endY = (event.changedTouches[0].clientY + event.changedTouches[1].clientY) / 2;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    if (deltaY > 110 && deltaY > Math.abs(deltaX) * 1.35) closePartnerMap();
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    tracking = false;
  }, { passive: true });
}


function handleDialogBackdropClick(event) {
  if (event.target !== els.dialogModal) return;
  closeActions();
  closeDialog();
}


function renderActions() {
  const adminActionGroups = [
    {
      label: "მთავარი",
      actions: [
        ["adminMap", "რუკა", "⌖", "რუკა და ფილტრები"],
        ["adminParcels", "ამანათები", "+", "დამატება და ისტორია"],
        ["adminCouriers", "კურიერები", "◎", "სია, რეგისტრაცია, ზონები და სტატისტიკა"],
        ["adminFinance", "ფინანსები", "₾", "ფინანსური პანელი"],
        ["adminStatistics", "სტატისტიკა", "▦", "ბიზნეს ანალიტიკა"],
        ["adminPartnersHub", "პარტნიორები", "◫", "პარტნიორები და შეკვეთები"],
      ],
    },
    {
      label: "პარამეტრები",
      actions: [
        state.adminDashboardHidden
          ? ["showAdminDashboard", "შეჯამება", "▥", "შეჯამების ბარის გახსნა"]
          : ["hideAdminDashboard", "შეჯამება", "▤", "შეჯამების ბარის დახურვა"],
        ["pushInbox", "ფუშები", "✉", "გაგზავნილი შეტყობინებები"],
        ...(CONFIG.enableCourierLiveTracking === false ? [] : [["liveCouriers", "Live სია", "●", "კურიერების live სტატუსი"]]),
        ["changePassword", "პაროლი", "⚙", "პაროლის შეცვლა"],
        ["logout", "გასვლა", "←", "სისტემიდან გასვლა"],
      ],
    },
  ];
  const partnerActions = [
    ["partnerNewOrder", "ახალი", "+"],
    ["partnerMap", "რუკა", "⌖"],
    ["logout", "გასვლა", "←"],
  ];
  const actions = state.isAdmin
    ? [
        ["refreshAdminMap", "რეფრეში", "↻", getAdminRefreshHint()],
        ["addParcel", "ამანათები", "+", "ახალი ამანათის დამატება"],
        ["adminFinance", "ფინანსები", "₾", "ფინანსური პანელი"],
        ["adminStatistics", "სტატისტიკა", "▦", "ბიზნეს ანალიტიკა"],
        ["adminPartnersHub", "პარტნიორები", "◫", "პარტნიორები და შეკვეთები"],
      ]
    : state.isPartner
      ? partnerActions
      : [
        ["courierParcels", "ჩემი ამანათები", "□"],
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
          <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
            <path d="M37.4 4 9 36.8h18.4L24.7 60l30.1-35.1H36.5L37.4 4z"></path>
            <path d="M19 27.8h16.2c1.4 0 2.3 1.5 1.7 2.7l-2.4 4.8c-.3.7-1.1 1.1-1.8 1.1H16.7c-1.5 0-2.4-1.6-1.7-2.9l2.3-4.1c.4-.9 1.3-1.6 1.9-1.6z"></path>
          </svg>
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
      : actions.map((item, index) => renderActionButton(
        item,
        "bottom-nav-item",
        state.isPartner ? item[0] === "partnerMap" && state.partnerMapActive : index === 0,
      )).join("");
  }
}


function getAdminRefreshHint() {
  return state.adminLastMapRefreshAt
    ? `ბოლო განახლება: ${formatDateTime(state.adminLastMapRefreshAt)}`
    : "რუკისა და ფინანსების განახლება";
}


function renderAdminHubAction(action, label, icon, description) {
  return `
    <button class="finance-card finance-flow-card finance-static-card" type="button" data-action="${escapeAttr(action)}">
      <span class="finance-summary-icon" aria-hidden="true">${escapeHtml(icon || "")}</span>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(description || "")}</small>
    </button>
  `;
}


function openAdminParcelsHub() {
  const body = renderFinanceModalLayout({
    content: `
      <section class="finance-section finance-flow-grid">
        ${renderAdminHubAction("addParcel", "დამატება", "+", "ახალი ამანათის დამატება")}
        ${renderAdminHubAction("parcelHistory", "ისტორია", "◷", "ამანათების ისტორია და ძებნა")}
      </section>
    `,
  });
  showDialog("ამანათები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


function openAdminCouriersHub() {
  const body = renderFinanceModalLayout({
    content: `
      <section class="finance-section finance-flow-grid">
        ${renderAdminHubAction("adminUsers", "სია", "◎", "კურიერების მართვა")}
        ${renderAdminHubAction("adminRegister", "რეგისტრაცია", "+", "კურიერის ან ადმინის დამატება")}
        ${renderAdminHubAction("zoneManagement", "ზონები", "▧", "კურიერის ზონების მართვა")}
        ${renderAdminHubAction("tariffSettings", "ტარიფები", "₾", "პარტნიორის ფასი და კურიერის ანაზღაურება")}
        ${renderAdminHubAction("adminStats", "სტატისტიკა", "▦", "კურიერების სტატისტიკა")}
      </section>
    `,
  });
  showDialog("კურიერები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


function openAdminPartnersHub() {
  const body = renderFinanceModalLayout({
    content: `
      <section class="finance-section finance-flow-grid">
        ${renderAdminHubAction("adminPartners", "პარტნიორები", "◫", "პარტნიორი ანგარიშები და ქეში")}
        ${renderAdminHubAction("adminPartnerOrders", "შეკვეთები", "▣", "პარტნიორის შეკვეთების სია")}
      </section>
    `,
  });
  showDialog("პარტნიორები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
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


function bindAdminDashboardSwipeEvents() {
  let startY = 0;
  let dragging = false;

  document.addEventListener("pointerdown", (event) => {
    if (!state.isAdmin || !isMobileViewport() || !els.adminDashboard || els.adminDashboard.hidden) return;
    if (!event.target.closest("#adminDashboard")) return;
    startY = event.clientY;
    dragging = true;
  }, { passive: true });

  document.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    const delta = event.clientY - startY;
    if (Math.abs(delta) < 24) return;
    if (delta < 0) showAdminDashboard();
    if (delta > 0) hideAdminDashboard();
  }, { passive: true });

  document.addEventListener("pointercancel", () => {
    dragging = false;
  }, { passive: true });
}


function bindAdminDashboardEdgeSwipeEvents() {
  let startX = 0;
  let startY = 0;
  let startedFromLeftEdge = false;
  let startedInDashboard = false;

  document.addEventListener("touchstart", (event) => {
    if (!state.isAdmin || !isMobileViewport() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startedFromLeftEdge = startX <= 28;
    startedInDashboard = Boolean(event.target.closest("#adminDashboard"));
  }, { passive: true });

  document.addEventListener("touchend", (event) => {
    if (!state.isAdmin || !isMobileViewport() || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const isHorizontalSwipe = Math.abs(deltaX) > 56 && Math.abs(deltaY) < 80;

    if (isHorizontalSwipe && startedFromLeftEdge && deltaX > 0 && state.adminDashboardHidden) {
      showAdminDashboard();
    } else if (isHorizontalSwipe && startedInDashboard && deltaX < 0 && !state.adminDashboardHidden) {
      hideAdminDashboard();
    }

    startedFromLeftEdge = false;
    startedInDashboard = false;
  }, { passive: true });
}


function canSwipeCloseCourierSurface(event) {
  if (!state.currentUser || state.isPartner) return false;
  const isCourierMobile = els.appShell?.classList.contains("is-courier-mobile");
  const isAdminMobile = state.isAdmin && isMobileViewport();
  if (!isCourierMobile && !isAdminMobile) return false;
  return Boolean(event.target.closest("#dialogModal.active .modal-card, #nearestParcelCard:not([hidden])"));
}


function getSwipeCloseScrollable(target) {
  return target.closest(".dialog-body, .nearest-card-body");
}


function closeCourierSwipeSurface(target) {
  if (target.closest("#dialogModal.active")) {
    closeDialog();
    return;
  }
  if (target.closest("#nearestParcelCard")) hideSelectedParcelCard();
}


function bindCourierSwipeCloseEvents() {
  let startY = 0;
  let startX = 0;
  let tracking = false;
  let startedAtScrollableTop = true;
  let startTarget = null;

  document.addEventListener("pointerdown", (event) => {
    if (!canSwipeCloseCourierSurface(event)) return;
    startY = event.clientY;
    startX = event.clientX;
    startTarget = event.target;
    const scrollable = getSwipeCloseScrollable(event.target);
    startedAtScrollableTop = !scrollable || scrollable.scrollTop <= 1;
    tracking = true;
  }, { passive: true });

  document.addEventListener("pointerup", (event) => {
    if (!tracking) return;
    tracking = false;
    const deltaY = event.clientY - startY;
    const deltaX = Math.abs(event.clientX - startX);
    const scrollable = getSwipeCloseScrollable(startTarget);
    const canCloseFromScroll = startedAtScrollableTop || !scrollable || scrollable.scrollTop <= 1;
    const pulledDown = deltaY > 72 && deltaY > deltaX * 1.35;
    if (pulledDown && canCloseFromScroll) closeCourierSwipeSurface(startTarget);
    startTarget = null;
  }, { passive: true });

  document.addEventListener("pointercancel", () => {
    tracking = false;
    startTarget = null;
  }, { passive: true });
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
  els.appShell?.classList.toggle("admin-dashboard-hidden", Boolean(state.adminDashboardHidden));
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
  const livePins = typeof getCourierLivePins === "function"
    ? getCourierLivePins(pins)
    : pins.filter((pin) => pin?.status !== "delivered" && !pin?.archivedAt && !pin?.deletedAt);
  const unassignedCount = livePins.filter((pin) => !pin.courierUsername).length;
  const cards = [
    { label: "სულ პინები", value: livePins.length, tone: "primary", action: "showAllAdminPins", active: filters.status === "all" },
    { label: "პროცესში", value: livePins.filter((pin) => pin.status === "pending").length, tone: "neutral", action: "adminMapSetStatus", dataValue: "pending", active: filters.status === "pending" },
    { label: "ჩაბარებული", value: livePins.filter((pin) => pin.status === "delivered").length, tone: "success", action: "adminMapSetStatus", dataValue: "delivered", active: filters.status === "delivered" },
    { label: "ვერ ჩაბარებული", value: livePins.filter((pin) => pin.status === "failed").length, tone: "danger", action: "adminMapSetStatus", dataValue: "failed", active: filters.status === "failed" },
    { label: "მიუბმელი", value: unassignedCount, tone: "warning", action: "showUnassignedAdminPins", active: filters.showUnassigned && filters.status === "all" && !filters.selectedCouriers.length },
    ...(CONFIG.enableCourierLiveTracking === false ? [] : [{ label: "ონლაინ", value: onlineCourierCount, tone: "success", action: "liveCouriers" }]),
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
  els.appShell?.classList.remove("admin-dashboard-hidden");
  renderActions();
  renderAdminDashboard().catch(() => {});
  scheduleMapInvalidateSize(120);
}


function hideAdminDashboard() {
  state.adminDashboardHidden = true;
  if (els.adminDashboard) {
    els.adminDashboard.hidden = true;
  }
  els.appShell?.classList.add("admin-dashboard-hidden");
  renderActions();
  renderAdminDashboard().catch(() => {});
  scheduleMapInvalidateSize(120);
}


async function refreshAdminMapAndFinance({ silent = false } = {}) {
  if (!state.isAdmin || !state.currentUser) return;
  await refreshPins();
  if (state.activeDialogTitle === "ფინანსები" && typeof openFinanceDashboard === "function") {
    await openFinanceDashboard({ preserveSearch: true });
  }
  state.adminLastMapRefreshAt = new Date().toISOString();
  renderActions();
  if (!silent) showToast(`განახლდა: ${formatDateTime(state.adminLastMapRefreshAt)}`);
}


function startAdminAutoRefresh() {
  stopAdminAutoRefresh();
  if (!state.isAdmin || !state.currentUser) return;
  state.adminMapAutoRefreshTimer = window.setInterval(async () => {
    if (!state.isAdmin || !state.currentUser || document.hidden || state.adminMapAutoRefreshInFlight) return;
    state.adminMapAutoRefreshInFlight = true;
    try {
      await refreshAdminMapAndFinance({ silent: true });
    } catch (error) {
      console.warn("Admin auto refresh failed", error);
    } finally {
      state.adminMapAutoRefreshInFlight = false;
    }
  }, ADMIN_AUTO_REFRESH_MS);
}


function stopAdminAutoRefresh() {
  if (state.adminMapAutoRefreshTimer) window.clearInterval(state.adminMapAutoRefreshTimer);
  state.adminMapAutoRefreshTimer = null;
  state.adminMapAutoRefreshInFlight = false;
}


document.addEventListener("visibilitychange", () => {
  if (document.hidden || !state.isAdmin || !state.currentUser) return;
  refreshAdminMapAndFinance({ silent: true }).catch((error) => {
    console.warn("Admin visibility refresh failed", error);
  });
});


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
  "editParcelLocation",
  "saveParcelLocation",
  "cancelParcelLocation",
  "confirmParcelLocation",
  "confirmParcelDelete",
  "refreshAdminMap",
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


function getInitialPushRouteIntent() {
  const parts = [];
  try {
    parts.push(...decodeURIComponent(window.location.pathname || "").split("/"));
  } catch {
    parts.push(...String(window.location.pathname || "").split("/"));
  }
  parts.push(String(window.location.hash || "").replace(/^#\/?/, ""));
  const queryView = new URLSearchParams(window.location.search || "").get("view") || "";
  if (queryView) parts.push(queryView);

  const route = parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((part) => !["amanati", "frontend", "index.html"].includes(part))
    .pop() || "";
  return ["push", "pushes", "notifications", "notification", "ფუში", "ფუშები"].includes(route);
}


async function openInitialPushRouteIfNeeded() {
  if (!state.isAdmin || !state.currentUser || !getInitialPushRouteIntent()) return;
  await openPushInboxDialog();
  const parcelId = new URLSearchParams(window.location.search).get("parcel");
  if (parcelId && typeof focusPushInboxParcel === "function") {
    await focusPushInboxParcel(parcelId).catch((error) => {
      console.warn("Initial push parcel focus failed", error);
    });
  }
}


async function enablePushNotificationsForCurrentDevice() {
  if (typeof requestAdminPushNotifications !== "function") {
    showToast("ფუშების ჩართვა ამ ვერსიაში ხელმისაწვდომი არ არის.");
    return false;
  }
  return requestAdminPushNotifications();
}


async function handleAction(action, value, sourceElement) {
  closeActions();
  closeAdminPinContextForAction(action);

  const handlers = {
    pending: openPendingRequests,
    enablePush: enablePushNotificationsForCurrentDevice,
    adminRegister: openAdminRegisterDialog,
    adminStats: openAdminStatsUsers,
    pushInbox: openPushInboxDialog,
    liveCouriers: openLiveCouriersDialog,
    adminMap: openAdminMap,
    refreshAdminMap: refreshAdminMapAndFinance,
    adminParcels: openAdminParcelsHub,
    adminCouriers: openAdminCouriersHub,
    adminPartnersHub: openAdminPartnersHub,
    adminUsers: openUserManagement,
    zoneManagement: openZoneManagement,
    tariffSettings: openTariffSettingsDialog,
    adminFinance: openFinanceDashboard,
    adminStatistics: openStatisticsDashboard,
    adminDailyBalance: openAdminDailyBalance,
    adminPartners: openPartnerManagement,
    adminPartnerOrders: openAdminPartnerOrders,
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
    partnerDashboard: renderPartnerDashboard,
    partnerNewOrder: openPartnerNewOrderDialog,
    partnerMap: openPartnerMap,
    partnerMapFilter: togglePartnerMapFilter,
    partnerOrders: openPartnerOrdersDialog,
    createPartner: openPartnerCreateDialog,
    editPartner: () => openPartnerEditDialog(value),
    startPartnerPickupLocationEdit: () => startPartnerPickupLocationEdit(value),
    togglePartnerStatus: () => togglePartnerStatus(value),
    adjustPartnerCash: () => openPartnerCashAdjustmentDialog(value),
    savePartnerCashAdjustment: () => savePartnerCashAdjustment(value),
    resetPartnerCashAdjustment: () => resetPartnerCashAdjustment(value),
    savePartner: () => savePartner(value),
    assignPartnerOrder: () => openPartnerOrderAssignDialog(value),
    savePartnerOrderAssign: () => savePartnerOrderAssign(value),
    ackPartnerPickup: () => acknowledgePartnerPickup(value),
    adminPartnerOrdersFilter: () => openAdminPartnerOrders(document.getElementById("adminPartnerOrdersFilter")?.value || ""),
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
    openFinanceCourierPay: openFinanceCourierPay,
    openFinancePartnerCash: openFinancePartnerCash,
    openFinanceDayClose: openFinanceDayClose,
    openFinanceAdmin: openFinanceAdmin,
    statisticsView: () => setStatisticsView(value),
    statisticsPartner: () => openStatisticsPartner(value),
    statisticsCourier: () => openStatisticsCourier(value),
    statisticsDay: () => openStatisticsDay(value),
    statisticsOrders: () => openStatisticsOrders(value),
    adjustCourierPay: () => openPayAdjustmentDialog(value),
    savePayAdjustment: () => savePayAdjustment(value),
    resetPayAdjustment: () => resetPayAdjustment(value),
    assignSelectedPins: assignSelectedPins,
    adminMapSetStatus: () => adminMapSetStatus(value),
    adminMapSetView: () => adminMapSetView(value),
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
    focusPushInboxParcel: () => focusPushInboxParcel(value),
    focusAdminPin: () => focusPinById(value),
    focusSelectedParcel,
    routeSelectedParcel,
    clearSelectedRoute: clearActiveRoute,
    toggleSelectedParcelCard,
    editParcelLocation: () => startParcelLocationEdit(value),
    saveParcelLocation: saveParcelLocationEdit,
    cancelParcelLocation: cancelParcelLocationEdit,
    confirmParcelLocation: () => confirmParcelLocation(value),
    confirmParcelDelete: () => confirmParcelDelete(value),
    setStatus: () => updatePinStatus(value, sourceElement.dataset.status),
    logout,
  };

  const actionButton = sourceElement?.closest?.("button");
  setActionButtonBusy(actionButton, true);
  try {
    await handlers[action]?.();
  } catch (error) {
    showToast(error.message || STRINGS.serverFailed);
  } finally {
    setActionButtonBusy(actionButton, false);
  }
}


function setActionButtonBusy(button, busy) {
  if (!button || button.dataset.busyLocked === "true") return;
  button.disabled = Boolean(busy);
  button.setAttribute("aria-busy", busy ? "true" : "false");
  button.classList.toggle("is-busy", Boolean(busy));
}


function showDialog(title, body, actions = []) {
  closeAdminPinContext();
  state.activeDialogTitle = title;
  els.dialogModal.classList.remove("history-dialog");
  els.dialogModal.classList.remove("admin-map-dialog");
  els.dialogModal.classList.remove("courier-stats-dialog");
  els.dialogModal.classList.remove("zone-management-dialog");
  syncDialogRoleClasses();
  els.dialogTitle.textContent = title;
  els.dialogBody.innerHTML = body;
  els.dialogActions.innerHTML = "";

  actions.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${item.variant || "secondary"}`;
    button.textContent = item.label;
    button.addEventListener("click", async () => {
      setActionButtonBusy(button, true);
      try {
        await item.action?.();
      } finally {
        setActionButtonBusy(button, false);
      }
    });
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
  els.dialogModal.classList.remove("admin-dashboard-dialog", "courier-mobile-dialog", "partner-dashboard-dialog");
  hideModal(els.dialogModal);
  els.dialogTitle.textContent = "";
  els.dialogBody.textContent = "";
  els.dialogActions.textContent = "";
}


function syncDialogRoleClasses() {
  if (!els.dialogModal) return;
  els.dialogModal.classList.toggle("admin-dashboard-dialog", Boolean(state.isAdmin));
  els.dialogModal.classList.toggle("partner-dashboard-dialog", Boolean(state.isPartner));
  els.dialogModal.classList.toggle("courier-mobile-dialog", Boolean(state.currentUser && !state.isAdmin && !state.isPartner));
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
  if (state.currentUser && typeof deactivatePushForCurrentDevice === "function") {
    await deactivatePushForCurrentDevice().catch((error) => {
      console.warn("Push deactivation failed", error);
    });
  }
  await api("/api/logout", { method: "POST" }).catch(() => {});
  closeAdminDrawer();
  collapseCourierStatsSheet();
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.midnightTimer) window.clearTimeout(state.midnightTimer);
  resetMapSelectionUi();
  state.watchId = null;
  state.midnightTimer = null;
  state.currentUser = null;
  state.currentUserProfile = null;
  state.partnerMapActive = false;
  if (els.partnerMapControls) {
    els.partnerMapControls.hidden = true;
    els.partnerMapControls.textContent = "";
  }
  state.authToken = null;
  state.isAdmin = false;
  state.isPartner = false;
  state.adminPushStatus = "unknown";
  state.adminPushToken = "";
  state.adminPushLastError = "";
  state.pushGateInProgress = false;
  state.authenticatedAppStarted = false;
  state.hasCurrentPosition = false;
  state.activePins = [];
  state.adminDashboardHidden = false;
  els.appShell?.classList.remove("is-admin-dashboard", "is-courier-mobile", "is-partner-dashboard", "is-partner-map", "has-selected-pin", "courier-detail-open", "admin-dashboard-hidden");
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
  if (els.pushGateModal) hideModal(els.pushGateModal);
  if (els.courierDashboard) {
    els.courierDashboard.hidden = true;
    els.courierDashboard.textContent = "";
  }
  if (els.courierOrdersSheet) {
    els.courierOrdersSheet.hidden = true;
    els.courierOrdersSheet.textContent = "";
    els.courierOrdersSheet.classList.remove("is-expanded");
  }
  if (els.partnerDashboard) {
    els.partnerDashboard.hidden = true;
    els.partnerDashboard.textContent = "";
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
  initializeErrorMonitoring();
  registerAppServiceWorker();
  cacheElements();
  bindAppViewportVars();
  bindEvents();
  await initializeMap();
  checkDayChange();
  startDayChangeWatcher();
  initializeAuth();
});
