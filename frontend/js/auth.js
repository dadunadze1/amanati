"use strict";



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
  renderAdminDashboard();
  renderCourierMobileDashboard().catch(() => {});
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
