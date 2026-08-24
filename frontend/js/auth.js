"use strict";



async function initializeAuth() {
  try {
    const bootstrap = await api("/api/bootstrap");
    if (bootstrap.staticMode) {
      console.warn("Static mode enabled");
      const session = loadStaticSessionPayload();
      hideModal(els.setupModal);
      if (session) {
        completeLogin(session);
        return;
      }
      showModal(bootstrap.hasAdmin ? els.authModal : els.setupModal);
      document.body.classList.remove("auth-loading");
      return;
    }
    hideModal(els.setupModal);
    hideModal(els.authModal);
    showModal(bootstrap.hasAdmin ? els.authModal : els.setupModal);
    document.body.classList.remove("auth-loading");
  } catch (error) {
    if (isStaticDeploy()) {
      console.warn("Static mode enabled", error);
      const session = loadStaticSessionPayload();
      hideModal(els.setupModal);
      if (session) {
        completeLogin(session);
        return;
      }
      showModal(els.authModal);
      document.body.classList.remove("auth-loading");
      return;
    }
    setMessage(els.loginError, error.message || STRINGS.serverFailed, true);
    showModal(els.authModal);
    document.body.classList.remove("auth-loading");
  }
}


async function handleAdminSetup(event) {
  event.preventDefault();
  if (!(await requestRequiredPushPermissionFromSubmit(els.setupError))) return;

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
  if (!(await requestRequiredPushPermissionFromSubmit(els.loginError))) return;

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


async function requestRequiredPushPermissionFromSubmit(messageElement) {
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    setMessage(messageElement, "ფუშ შეტყობინებები აუცილებელია, მაგრამ ამ ბრაუზერში ხელმისაწვდომი არ არის.", true);
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") {
    setMessage(messageElement, "ფუშ შეტყობინებები დაბლოკილია. ჩართეთ Notifications ამ აპისთვის Settings-იდან და თავიდან სცადეთ.", true);
    return false;
  }

  setMessage(messageElement, "ფუშ შეტყობინებების ჩართვა აუცილებელია.", false);
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    setMessage(messageElement, "", false);
    return true;
  }
  setMessage(messageElement, "ფუშ შეტყობინებებზე Allow აუცილებელია სისტემაში შესასვლელად.", true);
  return false;
}


function completeLogin(payload) {
  document.body.classList.remove("auth-loading");
  state.authToken = payload.token;
  state.currentUser = payload.user.username;
  state.currentUserProfile = payload.user;
  state.isAdmin = payload.user.role === "admin";
  state.isPartner = payload.user.role === "partner";
  state.courierPresenceStatus = state.isAdmin || state.isPartner ? "offline" : "online";
  state.authenticatedAppStarted = false;
  state.pushGateInProgress = false;
  hideModal(els.setupModal);
  hideModal(els.authModal);
  hideModal(els.registerModal);
  if (requiresPushGateForCurrentUser()) {
    enforceRequiredPushBeforeAppStart().catch((error) => {
      console.warn("Required push gate failed", error);
      state.adminPushStatus = "error";
      state.adminPushLastError = error.message || "ფუშების ჩართვა ვერ მოხერხდა.";
      showRequiredPushGate();
    });
    return;
  }
  startAuthenticatedApp();
}


function startAuthenticatedApp() {
  if (state.authenticatedAppStarted) return;
  state.authenticatedAppStarted = true;
  state.pushGateInProgress = false;
  hideModal(els.pushGateModal);
  state.adminDashboardHidden = false;
  els.appShell?.classList.remove("is-admin-dashboard", "is-courier-mobile", "is-partner-dashboard", "has-selected-pin", "courier-detail-open", "admin-dashboard-hidden");
  updateAppViewportVars();
  state.mapViewportResetToken += 1;
  state.mapViewportResetPending = false;
  resetMapSelectionUi();
  renderActions();
  Promise.allSettled([
    Promise.resolve(renderAdminDashboard()),
    renderPartnerDashboard(),
    renderCourierMobileDashboard(),
  ]).then(() => {
    stabilizeAppViewportAfterLogin();
    resetMapViewportForLogin();
    if (!state.isPartner) startLocationWatch();
    if (!state.isPartner) startCourierLocationServices();
    if (typeof startAdminAutoRefresh === "function") startAdminAutoRefresh();
    if (!state.isPartner) {
      runAutoRetentionCleanup().catch((error) => {
        console.warn("Retention cleanup failed", error);
      });
    }
    refreshPins().catch((error) => {
      console.warn("Pin refresh failed", error);
      fitMapToPinsOrDefault([]);
    });
    if (typeof openInitialPushRouteIfNeeded === "function") {
      openInitialPushRouteIfNeeded().catch((error) => {
        console.warn("Initial push route failed", error);
      });
    }
    scheduleMapInvalidateSize(0);
    scheduleMapInvalidateSize(120);
    scheduleMidnightRefresh();
  });
}


function requiresPushGateForCurrentUser() {
  return Boolean(state.currentUser && ["admin", "partner", "courier"].includes(state.currentUserProfile?.role || ""));
}


async function enforceRequiredPushBeforeAppStart() {
  state.pushGateInProgress = true;
  const ready = await registerRequiredPushForCurrentDevice({ requestPermission: false });
  if (ready) {
    startAuthenticatedApp();
    return;
  }
  state.pushGateInProgress = false;
  showRequiredPushGate();
}


async function handleRequiredPushEnable() {
  if (state.pushGateInProgress) return;
  state.pushGateInProgress = true;
  if (els.pushGateEnableButton) {
    els.pushGateEnableButton.disabled = true;
    els.pushGateEnableButton.setAttribute("aria-busy", "true");
  }
  if (els.pushGateMessage) {
    setMessage(els.pushGateMessage, "ფუშების ჩართვა მიმდინარეობს...", false);
  }

  try {
    const ready = await registerRequiredPushForCurrentDevice({ requestPermission: true });
    if (ready) {
      startAuthenticatedApp();
      return;
    }
    showRequiredPushGate();
  } catch (error) {
    console.warn("Required push registration failed", error);
    state.adminPushStatus = "error";
    state.adminPushLastError = error.message || "ფუშების ჩართვა ვერ მოხერხდა.";
    showRequiredPushGate();
  } finally {
    state.pushGateInProgress = false;
    if (els.pushGateEnableButton) {
      els.pushGateEnableButton.disabled = false;
      els.pushGateEnableButton.setAttribute("aria-busy", "false");
    }
  }
}


async function registerRequiredPushForCurrentDevice(options = {}) {
  if (!requiresPushGateForCurrentUser()) return true;
  if (typeof canUseAdminPush !== "function" || !canUseAdminPush()) {
    state.adminPushStatus = "unsupported";
    state.adminPushLastError = typeof getAdminPushCapabilityMessage === "function"
      ? getAdminPushCapabilityMessage()
      : "ამ მოწყობილობაზე ფუშები ხელმისაწვდომი არ არის.";
    return false;
  }

  if (Notification.permission === "granted") {
    return typeof registerAdminPushToken === "function" ? registerAdminPushToken() : false;
  }
  if (Notification.permission === "denied") {
    state.adminPushStatus = "denied";
    state.adminPushLastError = "ფუშ შეტყობინებები დაბლოკილია. ჩართეთ Notifications ამ აპისთვის Settings-იდან და თავიდან სცადეთ.";
    return false;
  }
  if (options.requestPermission && typeof requestAdminPushNotifications === "function") {
    return requestAdminPushNotifications({ silent: true });
  }

  state.adminPushStatus = "permission-needed";
  state.adminPushLastError = "გასაგრძელებლად დააჭირეთ ფუშების ჩართვას და ბრაუზერის ფანჯარაში აირჩიეთ Allow.";
  return false;
}


function showRequiredPushGate() {
  hideModal(els.setupModal);
  hideModal(els.authModal);
  hideModal(els.registerModal);
  const message = state.adminPushLastError || "ფუშ შეტყობინებები აუცილებელია სისტემაში მუშაობისთვის.";
  if (els.pushGateMessage) setMessage(els.pushGateMessage, message, state.adminPushStatus !== "permission-needed");
  if (els.pushGateEnableButton) {
    els.pushGateEnableButton.disabled = false;
    els.pushGateEnableButton.setAttribute("aria-busy", "false");
  }
  showModal(els.pushGateModal);
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
    setMessage(els.regError, "რეგისტრაცია მიღებულია. შესვლამდე ადმინმა უნდა დაგადასტუროთ.", false);
    window.setTimeout(() => switchModal("login"), 1400);
  } catch (error) {
    setMessage(els.regError, error.message, true);
  }
}


function switchModal(target) {
  hideModal(target === "login" ? els.registerModal : els.authModal);
  showModal(target === "login" ? els.authModal : els.registerModal);
}


async function logout() {
  if (state.currentUser && typeof deactivatePushForCurrentDevice === "function") {
    await deactivatePushForCurrentDevice().catch((error) => {
      console.warn("Push deactivation failed", error);
    });
  }
  if (typeof stopAdminAutoRefresh === "function") stopAdminAutoRefresh();
  await stopCourierLocationServices({ markOffline: true });
  await api("/api/logout", { method: "POST" }).catch(() => {});
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.midnightTimer) window.clearTimeout(state.midnightTimer);
  resetMapSelectionUi();
  state.watchId = null;
  state.midnightTimer = null;
  state.currentUser = null;
  state.currentUserProfile = null;
  state.authToken = null;
  state.isAdmin = false;
  state.isPartner = false;
  state.adminPushStatus = "unknown";
  state.adminPushToken = "";
  state.adminPushLastError = "";
  state.pushGateInProgress = false;
  state.authenticatedAppStarted = false;
  if (els.pushGateModal) hideModal(els.pushGateModal);
  state.courierPresenceStatus = "offline";
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
