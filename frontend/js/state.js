"use strict";

const APP_TIME_ZONE = "Asia/Tbilisi";
const APP_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const state = {
  map: null,
  markers: null,
  mapPinRenderSignature: "",
  mapViewportResetPending: false,
  mapViewportResetToken: 0,
  currentUser: null,
  currentUserProfile: null,
  authToken: null,
  isAdmin: false,
  isPartner: false,
  activePins: [],
  partnerPickupPins: [],
  partnerPickupEditUsername: "",
  partnerPickupDraft: null,
  adminMapCouriers: [],
  adminMapFilters: {
    includeAllCouriers: true,
    selectedCouriers: [],
    showUnassigned: true,
    status: "all",
  },
  adminMapView: "couriers",
  adminMapCourierSearch: "",
  adminLastMapRefreshAt: "",
  adminMapAutoRefreshTimer: null,
  adminMapAutoRefreshInFlight: false,
  currentPosition: { lat: CONFIG.center[0], lng: CONFIG.center[1] },
  hasCurrentPosition: false,
  watchId: null,
  locationMarker: null,
  courierLocationOverlays: [],
  courierLocations: {},
  courierLocationUnsubscribe: null,
  courierLocationRefreshTimer: null,
  courierLocationStatusTimer: null,
  courierPresenceStatus: "online",
  lastCourierLocationWriteAt: 0,
  lastLocationWatchErrorToastAt: 0,
  firebaseSyncStatus: "unknown",
  lastFirebaseSyncToastAt: 0,
  clientErrors: [],
  adminPushStatus: "unknown",
  adminPushToken: "",
  adminPushLastError: "",
  pushGateInProgress: false,
  authenticatedAppStarted: false,
  selectedCourierLocationUsername: "",
  routeLayer: null,
  routePinId: null,
  selectedPinId: null,
  selectedParcelCardCollapsed: false,
  expandedPinLabels: [],
  parcelAddressCache: {},
  historySearchResults: [],
  historyPreviewMarker: null,
  courierStats: {
    username: "",
    user: null,
    parcels: [],
    history: [],
    records: [],
    selectedDate: toDateKey(new Date()),
    rangeStart: toDateKey(new Date()),
    rangeEnd: toDateKey(new Date()),
    filter: "all",
  },
  financeDate: toDateKey(new Date()),
  financeRangeStart: toDateKey(new Date()),
  financeRangeEnd: toDateKey(new Date()),
  financeAdminView: "summary",
  financeAdminSearch: "",
  statisticsRangeStart: toDateKey(new Date()),
  statisticsRangeEnd: toDateKey(new Date()),
  statisticsView: "overview",
  statisticsSearch: "",
  statisticsReport: null,
  selectedCourier: null,
  partnerCashAdjustments: [],
  partnerCashAdjustmentsLoaded: false,
  pendingCoords: null,
  pendingMarker: null,
  pendingAddress: "",
  pendingAddressLocked: false,
  pendingAddressWarning: "",
  pendingZone: null,
  pendingAutoAssignment: null,
  photoParcelDraft: null,
  locationEditParcelId: "",
  calendarDate: new Date(),
  activeDialogTitle: "",
  midnightTimer: null,
  autoCloseInProgress: false,
  retentionCleanupInProgress: false,
  adminDashboardHidden: false,
  mode: "idle",
};

const els = {};
let HtmlMapLabel = null;

function toDateKey(value = new Date()) {
  if (typeof value === "string") {
    const plainDateMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (plainDateMatch) return `${plainDateMatch[1]}-${plainDateMatch[2]}-${plainDateMatch[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = APP_DATE_FORMATTER.formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  return `${year}-${month}-${day}`;
}


function getTodayKey() {
  return toDateKey(new Date());
}


function startDayChangeWatcher() {
  if (state.dayChangeTimer) window.clearInterval(state.dayChangeTimer);
  state.dayChangeTimer = window.setInterval(checkDayChange, 60000);
}


function checkDayChange() {
  const todayKey = getTodayKey();

  if (!state.currentDayKey) {
    state.currentDayKey = todayKey;
    return;
  }

  if (state.currentDayKey !== todayKey) {
    handleDayChange(state.currentDayKey, todayKey);
    state.currentDayKey = todayKey;
  }
}


function handleDayChange(oldDay, newDay) {
  console.log("Day changed:", oldDay, "", newDay);
  showToast("ახალი დღე დაიწყო");

  state.selectedCourier = null;
  state.calendarDate = new Date();

  runAutoRetentionCleanup().catch((error) => {
    console.warn("Retention cleanup failed", error);
  });
  refreshPins().catch((error) => {
    showToast(error.message || STRINGS.serverFailed);
  });
}


function scheduleMidnightRefresh() {
  if (state.midnightTimer) window.clearTimeout(state.midnightTimer);
  if (!state.currentUser) {
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
  if (!state.currentUser) return;

  await runAutoRetentionCleanup().catch(() => {});
  await refreshPins();
  if (state.activeDialogTitle === "ჩემი დღე") await openTodayStats();
  scheduleMidnightRefresh();
}
