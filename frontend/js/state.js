"use strict";

const state = {
  map: null,
  markers: null,
  currentUser: null,
  currentUserProfile: null,
  authToken: null,
  isAdmin: false,
  activePins: [],
  adminMapCouriers: [],
  adminMapFilters: {
    includeAllCouriers: true,
    selectedCouriers: [],
    showUnassigned: true,
    status: "all",
  },
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
  selectedCourier: null,
  pendingCoords: null,
  pendingMarker: null,
  pendingAddress: "",
  pendingAddressWarning: "",
  pendingZone: null,
  pendingAutoAssignment: null,
  calendarDate: new Date(),
  activeDialogTitle: "",
  midnightTimer: null,
  mode: "idle",
};

const els = {};
let HtmlMapLabel = null;

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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

  state.courierStats.selectedDate = newDay;
  state.courierStats.rangeStart = newDay;
  state.courierStats.rangeEnd = newDay;
  state.financeDate = newDay;
  state.financeRangeStart = newDay;
  state.financeRangeEnd = newDay;
  state.selectedCourier = null;
  state.calendarDate = new Date();

  refreshPins().catch((error) => {
    showToast(error.message || STRINGS.serverFailed);
  });
}


function scheduleMidnightRefresh() {
  if (state.midnightTimer) window.clearTimeout(state.midnightTimer);
  if (!state.currentUser || state.isAdmin) {
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
  if (!state.currentUser || state.isAdmin) return;

  await archiveDeliveredParcelsForDay(state.currentUser).catch(() => {});
  await refreshPins();
  if (state.activeDialogTitle === "ჩემი დღე") await openTodayStats();
  scheduleMidnightRefresh();
}
