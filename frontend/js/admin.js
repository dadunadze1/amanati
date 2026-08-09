"use strict";



const PUSH_INBOX_LIMIT = 60;


async function openPendingRequests() {
  const pending = await getPending();
  const body = renderAppListPanel({
    title: "რეგისტრაციის მოთხოვნები",
    badges: [`სულ: ${pending.length}`],
    headers: ["მომხმარებელი", "მოთხოვნის დრო", "სტატუსი", ""],
    emptyMessage: STRINGS.noPending,
    rows: pending.map((request) => `
      <tr>
        <td>${renderAppTableText(request.username)}</td>
        <td>${escapeHtml(formatDateTime(request.requestedAt))}</td>
        <td>${renderAppStatusBadge("pending", "დასადასტურებელი")}</td>
        <td>
          <div class="row-actions">
            <button class="mini-button" type="button" data-action="approve" data-value="${escapeAttr(request.username)}">დადასტურება</button>
            <button class="mini-button danger" type="button" data-action="reject" data-value="${escapeAttr(request.username)}">უარყოფა</button>
          </div>
        </td>
      </tr>
    `),
  });

  showDialog("რეგისტრაციის მოთხოვნები", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function approveCourier(username) {
  await api(`/api/pending/${encodeURIComponent(username)}`, { method: "POST" });
  await openPendingRequests();
}


async function rejectCourier(username) {
  await api(`/api/pending/${encodeURIComponent(username)}`, { method: "DELETE" });
  await openPendingRequests();
}


async function openPushInboxDialog(filter = state.pushInboxFilter || "all") {
  state.pushInboxFilter = filter;
  showDialog("ფუშები", `<p class="history-empty">ფუშები იტვირთება...</p>`, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);

  const notifications = await loadPushInboxNotifications();
  const body = renderPushInboxTable(notifications, state.pushInboxFilter);

  showDialog("ფუშები", body, [
    { label: "განახლება", variant: "primary", action: openPushInboxDialog },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  document.getElementById("pushInboxFilter")?.addEventListener("change", async (event) => {
    await openPushInboxDialog(event.target.value || "all");
  });
}


async function loadPushInboxNotifications() {
  const [firestoreItems, staticItems] = await Promise.all([
    loadFirestorePushInboxNotifications(),
    loadStaticPushInboxNotifications(),
  ]);
  const merged = new Map();

  [...firestoreItems, ...staticItems].forEach((item) => {
    if (!item?.id) return;
    const current = merged.get(item.id);
    if (!current || getPushInboxTime(item) >= getPushInboxTime(current)) merged.set(item.id, item);
  });

  return [...merged.values()]
    .sort((a, b) => getPushInboxTime(b) - getPushInboxTime(a))
    .slice(0, PUSH_INBOX_LIMIT);
}


async function loadFirestorePushInboxNotifications() {
  if (typeof initializeFirebaseStorage !== "function") return [];
  const db = await initializeFirebaseStorage();
  if (!db) return [];

  try {
    const snapshot = await db
      .collection("adminNotifications")
      .orderBy("createdAt", "desc")
      .limit(PUSH_INBOX_LIMIT)
      .get();
    const items = [];
    snapshot.forEach((doc) => {
      items.push(normalizePushInboxNotification({ id: doc.id, ...doc.data(), source: "firestore" }));
    });
    return items.filter(Boolean);
  } catch (error) {
    console.warn("[push] inbox collection read failed", error);
    return [];
  }
}


async function loadStaticPushInboxNotifications() {
  const stores = [];
  if (typeof loadStaticBootstrap === "function" && loadStaticBootstrap.cache) stores.push(loadStaticBootstrap.cache);
  if (typeof loadStaticBootstrap === "function") {
    const loaded = await loadStaticBootstrap().catch((error) => {
      console.warn("[push] inbox static store read failed", error);
      return null;
    });
    if (loaded) stores.push(loaded);
  }

  const items = [];
  stores.forEach((store) => {
    const notifications = store?.adminNotifications && typeof store.adminNotifications === "object" ? store.adminNotifications : {};
    Object.entries(notifications).forEach(([id, item]) => {
      items.push(normalizePushInboxNotification({ id, ...item, source: "static" }));
    });
  });
  return items.filter(Boolean);
}


function normalizePushInboxNotification(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || item.eventKey || item.parcelId || "").trim();
  if (!id) return null;
  return {
    ...item,
    id,
    title: String(item.title || "Swift Delivery").trim(),
    body: String(item.body || "").trim(),
    type: String(item.type || "").trim(),
    status: String(item.status || "").trim(),
    deliveryStatus: String(item.deliveryStatus || "").trim(),
    parcelId: String(item.parcelId || "").trim(),
    address: String(item.address || "").trim(),
    fullName: String(item.fullName || "").trim(),
    partnerName: String(item.partnerName || item.partnerUsername || item.partnerId || "").trim(),
    courierUsername: String(item.courierUsername || "").trim(),
    createdAt: normalizePushInboxDate(item.createdAt),
    updatedAt: normalizePushInboxDate(item.updatedAt),
    sentAt: normalizePushInboxDate(item.sentAt),
    failedAt: normalizePushInboxDate(item.failedAt),
    lastAttemptAt: normalizePushInboxDate(item.lastAttemptAt),
    lastError: String(item.lastError || "").trim(),
  };
}


function renderPushInboxTable(notifications, filter = "all") {
  if (!notifications.length) return `<div class="history-empty history-empty-card">ფუშები ჯერ არ არის შენახული.</div>`;
  const filteredNotifications = notifications.filter((item) => pushInboxMatchesFilter(item, filter));
  const sent = notifications.filter((item) => item.deliveryStatus === "sent").length;
  const failed = notifications.filter((item) => item.deliveryStatus === "failed").length;
  const pending = notifications.filter((item) => !["sent", "failed"].includes(item.deliveryStatus)).length;
  return `
    <div class="partner-panel-head">
      <h2>ბოლო ფუშები</h2>
      <div class="partner-filter-row">
        <select id="pushInboxFilter" aria-label="ფუშების ფილტრი">
          <option value="all" ${filter === "all" ? "selected" : ""}>ყველა</option>
          <option value="created" ${filter === "created" ? "selected" : ""}>ახალი ამანათები</option>
          <option value="delivered" ${filter === "delivered" ? "selected" : ""}>ჩაბარებულები</option>
          <option value="failed" ${filter === "failed" ? "selected" : ""}>ვერ ჩაბარებულები</option>
        </select>
        <span class="partner-tag">სულ: ${escapeHtml(notifications.length)}</span>
        <span class="partner-tag">ნაჩვენები: ${escapeHtml(filteredNotifications.length)}</span>
        <span class="partner-tag">გაგზავნილი: ${escapeHtml(sent)}</span>
        <span class="partner-tag">რიგში/შენახული: ${escapeHtml(pending)}</span>
        ${failed ? `<span class="partner-tag">შეცდომა: ${escapeHtml(failed)}</span>` : ""}
      </div>
    </div>
    <div class="partner-table-wrap">
      <table class="partner-order-table">
        <thead>
          <tr>
            <th>დრო</th>
            <th>შეტყობინება</th>
            <th>ადრესატი</th>
            <th>ამანათი</th>
            <th>კურიერი</th>
            <th>სტატუსი</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredNotifications.length ? filteredNotifications.map(renderPushInboxRow).join("") : `<tr><td colspan="7">ამ ფილტრში ფუში არ არის</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}


function pushInboxMatchesFilter(notification, filter) {
  if (filter === "created") return notification.type === "parcel_created" || notification.status === "created";
  if (filter === "delivered") return notification.type === "parcel_delivered" || notification.status === "delivered";
  if (filter === "failed") return notification.type === "parcel_failed" || notification.status === "failed";
  return true;
}


function renderPushInboxRow(notification) {
  const deliveryStatus = notification.deliveryStatus || "stored";
  const deliveryClass = deliveryStatus === "sent" ? "delivered" : deliveryStatus === "failed" ? "failed" : "pending";
  const message = [notification.address, notification.fullName].filter(Boolean).join(", ");
  return `
    <tr>
      <td>${escapeHtml(formatPushInboxDate(notification.sentAt || notification.createdAt || notification.updatedAt))}</td>
      <td>
        <strong>${escapeHtml(notification.title)}</strong>
        <small>${escapeHtml(notification.body || message || "შინაარსი არ არის")}</small>
        ${notification.lastError ? `<small>${escapeHtml(notification.lastError)}</small>` : ""}
      </td>
      <td>${escapeHtml(getPushInboxRecipientLabel(notification))}</td>
      <td>
        <span class="partner-tag">${escapeHtml(notification.parcelId ? notification.parcelId.slice(0, 8) : "არ არის")}</span>
        ${notification.partnerName ? `<small>${escapeHtml(notification.partnerName)}</small>` : ""}
      </td>
      <td>${escapeHtml(notification.courierUsername || "არ არის")}</td>
      <td>
        <span class="history-status status-${escapeAttr(deliveryClass)}">${escapeHtml(getPushDeliveryStatusLabel(deliveryStatus))}</span>
        <small>${escapeHtml(getPushInboxTypeLabel(notification.type, notification.status))}</small>
      </td>
      <td>
        ${notification.parcelId ? `<button class="mini-button" type="button" data-action="focusPushInboxParcel" data-value="${escapeAttr(notification.parcelId)}">ნახვა</button>` : ""}
      </td>
    </tr>
  `;
}


function getPushInboxTypeLabel(type, status) {
  if (type === "parcel_created") return "ახალი ამანათი";
  if (type === "parcel_assigned") return "კურიერზე მიბმა";
  if (type === "parcel_delivered" || status === "delivered") return "ჩაბარება";
  if (type === "parcel_failed" || status === "failed") return "ვერ ჩაბარდა";
  return type || status || "ფუში";
}


function getPushInboxRecipientLabel(notification) {
  const roles = Array.isArray(notification.recipientRoles)
    ? notification.recipientRoles
    : String(notification.recipientRoles || "").split(",");
  const labels = roles.map((role) => {
    const cleanRole = String(role || "").trim();
    return cleanRole ? roleLabel(cleanRole) : "";
  }).filter(Boolean);
  return labels.length ? [...new Set(labels)].join(", ") : "არ არის";
}


function getPushDeliveryStatusLabel(status) {
  if (status === "sent") return "გაგზავნილია";
  if (status === "failed") return "ვერ გაიგზავნა";
  if (status === "processing") return "იგზავნება";
  if (status === "pending") return "რიგშია";
  return "შენახულია";
}


function normalizePushInboxDate(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}


function getPushInboxTime(notification) {
  const value = notification?.sentAt || notification?.updatedAt || notification?.createdAt || notification?.lastAttemptAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}


function formatPushInboxDate(value) {
  return value ? formatDateTime(value) : "არ არის";
}


async function focusPushInboxParcel(parcelId) {
  const activePin = state.activePins.find((item) => item.id === parcelId);
  if (activePin) {
    focusPinById(parcelId);
    return;
  }

  const parcels = await searchParcels(parcelId).catch(() => []);
  const parcel = parcels.find((item) => item.id === parcelId);
  if (!parcel) {
    showToast("ამანათი ვერ მოიძებნა.");
    return;
  }
  state.historySearchResults = parcels;
  focusHistoryParcelOnMap(parcel.id);
}


async function openCourierPicker() {
  const users = await getCouriers();
  const body = renderAppListPanel({
    title: "კურიერის არჩევა",
    badges: [`კურიერი: ${users.length}`],
    headers: ["კურიერი", "ტელეფონი", "ზონა", ""],
    emptyMessage: STRINGS.noCouriers,
    rows: users.map((user) => `
      <tr>
        <td>${renderAppTableText(userDisplayName(user), user.username)}</td>
        <td>${escapeHtml(user.phone || "არ არის")}</td>
        <td>${escapeHtml(user.zoneName || "მიუბმელი")}</td>
        <td><button class="mini-button" type="button" data-action="chooseCourier" data-value="${escapeAttr(user.username)}">არჩევა</button></td>
      </tr>
    `),
  });

  showDialog("კურიერის არჩევა", body, [{ label: "გაუქმება", variant: "secondary", action: closeDialog }]);
}


async function openAnalyticsPicker() {
  const users = await getCouriers();
  const body = renderAppListPanel({
    title: "კურიერის ანალიტიკა",
    badges: [`კურიერი: ${users.length}`],
    headers: ["კურიერი", "ტელეფონი", "ზონა", ""],
    emptyMessage: STRINGS.noCouriers,
    rows: users.map((user) => `
      <tr>
        <td>${renderAppTableText(userDisplayName(user), user.username)}</td>
        <td>${escapeHtml(user.phone || "არ არის")}</td>
        <td>${escapeHtml(user.zoneName || "მიუბმელი")}</td>
        <td><button class="mini-button" type="button" data-action="openCourierAnalytics" data-value="${escapeAttr(user.username)}">ნახვა</button></td>
      </tr>
    `),
  });

  showDialog("კურიერის ანალიტიკა", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openPasswordDialog() {
  const users = await getCouriers();
  const options = users.map((user) => `<option value="${escapeAttr(user.username)}">${escapeHtml(user.username)}</option>`).join("");
  const body = users.length
    ? `<label for="passwordUser">კურიერი</label>
       <select id="passwordUser">${options}</select>
       <label for="newPassword">ახალი პაროლი</label>
       <input id="newPassword" type="password" autocomplete="new-password">`
    : `<p>${STRINGS.noCouriers}</p>`;

  const actions = users.length
    ? [
        { label: "შენახვა", variant: "primary", action: savePasswordChange },
        { label: "გაუქმება", variant: "secondary", action: closeDialog },
      ]
    : [{ label: "დახურვა", variant: "secondary", action: closeDialog }];

  showDialog("პაროლის შეცვლა", body, actions);
}


async function savePasswordChange() {
  const username = document.getElementById("passwordUser")?.value;
  const password = document.getElementById("newPassword")?.value.trim();
  if (!username || !password) return;

  await api(`/api/couriers/${encodeURIComponent(username)}/password`, { method: "PUT", body: { password } });
  closeDialog();
}


function openAdminRegisterDialog() {
  const body = `
    <label for="adminRegUsername">ლოგინი</label>
    <input id="adminRegUsername" type="text" autocomplete="username">
    <label for="adminRegPassword">პაროლი</label>
    <input id="adminRegPassword" type="password" autocomplete="new-password">
    ${userProfileFields()}
    <label for="adminRegRole">ფუნქცია</label>
    <select id="adminRegRole">
      <option value="courier">კურიერი</option>
      <option value="admin">ადმინი</option>
    </select>
    <p class="form-message" id="adminRegMessage" role="alert"></p>
  `;
  showDialog("რეგისტრაცია", body, [
    { label: "შენახვა", variant: "primary", action: saveAdminRegistration },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function saveAdminRegistration() {
  const username = document.getElementById("adminRegUsername")?.value.trim();
  const password = document.getElementById("adminRegPassword")?.value.trim();
  const role = document.getElementById("adminRegRole")?.value;
  const message = document.getElementById("adminRegMessage");
  if (!username || !password || !role) {
    if (message) message.textContent = STRINGS.emptyFields;
    return;
  }

  try {
    await api("/api/users", { method: "POST", body: { username, password, role, ...readUserProfileFields() } });
    closeDialog();
    showToast("ანგარიში შენახულია.");
    await refreshPins();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}


async function openAdminStatsUsers() {
  try {
    const users = (await getUsers()).filter((user) => user.role === "courier");
    const rows = await Promise.all(users.map(renderCourierStatsUserCard));
    const body = renderAppListPanel({
      title: "კურიერის სტატისტიკა",
      badges: [`კურიერი: ${users.length}`],
      headers: ["კურიერი", "დღეს ჩაბარდა", "დღევანდელი გამომუშავება", "აქტიური", ""],
      emptyMessage: "კურიერი ჯერ არ არის დამატებული",
      rows,
    });
    showDialog("კურიერის სტატისტიკა", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
    els.dialogModal.classList.add("courier-stats-dialog");
  } catch {
    showDialog("კურიერის სტატისტიკა", `<div class="history-empty history-empty-card">კურიერის სტატისტიკის ჩატვირთვა ვერ მოხერხდა</div>`, [
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
  }
}


function openAdminStatsChoice(username) {
  return openCourierStatsProfile(username);
}


async function openLiveCouriersDialog() {
  if (CONFIG.enableCourierLiveTracking === false) {
    showDialog("Live კურიერები", `<div class="history-empty history-empty-card">Live tracking დროებით დაპაუზებულია Firebase-ის დატვირთვის შესამცირებლად.</div>`, [
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
    return;
  }
  try {
    const couriers = await getCouriers();
    const onlineCount = couriers.filter((courier) => getLiveCourierStatus(courier.username).isOnline).length;
    const body = renderAppListPanel({
      title: "Live კურიერები",
      badges: [`ონლაინ: ${onlineCount}/${couriers.length}`],
      headers: ["კურიერი", "ტელეფონი", "სტატუსი", "ბოლო განახლება", "აქტიური"],
      emptyMessage: "კურიერი ჯერ არ არის",
      rows: couriers.map(renderLiveCourierRow),
    });
    showDialog("Live კურიერები", body, [
      { label: "განახლება", variant: "primary", action: openLiveCouriersDialog },
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
  } catch {
    showDialog("Live კურიერები", `<div class="history-empty history-empty-card">კურიერების live სიის ჩატვირთვა ვერ მოხერხდა</div>`, [
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
  }
}


function renderLiveCourierRow(courier) {
  const live = getLiveCourierStatus(courier.username);
  const activeCount = state.activePins.filter((pin) => normalizeUsername(pin.courierUsername) === normalizeUsername(courier.username) && pin.status === "pending").length;
  return `
    <tr>
      <td>${renderAppTableText(userFullName(courier) || courier.username, courier.username)}</td>
      <td>${escapeHtml(courier.phone || "ტელეფონი არ არის")}</td>
      <td>${renderAppStatusBadge(live.isOnline ? "delivered" : "failed", live.isOnline ? "ონლაინ" : "ოფლაინ")}</td>
      <td>${escapeHtml(live.label)}</td>
      <td>${escapeHtml(String(activeCount))}</td>
    </tr>
  `;
}


function getLiveCourierStatus(username) {
  if (CONFIG.enableCourierLiveTracking === false) return { isOnline: false, label: "დაპაუზებულია" };
  const location = Object.values(state.courierLocations || {})
    .find((item) => normalizeUsername(item?.username) === normalizeUsername(username));
  if (!location) return { isOnline: false, label: "ლოკაცია არ არის" };

  const updatedAt = Date.parse(location.updatedAt || "");
  if (!Number.isFinite(updatedAt)) return { isOnline: false, label: "დრო უცნობია" };

  const ageMs = Date.now() - updatedAt;
  const visibleMs = typeof COURIER_LOCATION_VISIBLE_MS === "number" ? COURIER_LOCATION_VISIBLE_MS : 120000;
  const isOnline = location.status !== "offline" && ageMs <= visibleMs;
  return {
    isOnline,
    label: `${formatLiveCourierAge(ageMs)} წინ`,
  };
}


function getOnlineCourierCount(couriers = []) {
  if (CONFIG.enableCourierLiveTracking === false) return 0;
  return couriers.filter((courier) => getLiveCourierStatus(courier.username).isOnline).length;
}


function formatLiveCourierAge(ageMs) {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds} წმ`;
  return `${Math.round(seconds / 60)} წთ`;
}


async function openAdminUserDay(username) {
  return openCourierStatsProfile(username);
}


async function renderCourierStatsUserCard(user) {
  const [parcels, history] = await Promise.all([getPins(user.username), getHistory(user.username)]);
  const todayKey = toDateKey(new Date());
  const todayOrders = [...parcels, ...history].filter((parcel) => parcelMatchesStatsDate(parcel, todayKey));
  const activeCount = parcels.length;
  const deliveredToday = todayOrders.filter((parcel) => parcel.status === "delivered").length;
  const earnedToday = calculateCourierPay(todayOrders, user.username, todayKey, todayKey);
  return `
    <tr>
      <td>${renderAppTableText(userDisplayName(user), user.username)}</td>
      <td>${renderAppStatusBadge("delivered", String(deliveredToday))}</td>
      <td>${escapeHtml(formatMoney(earnedToday))}</td>
      <td>${escapeHtml(String(activeCount))}</td>
      <td><button class="mini-button" type="button" data-action="adminStatsUser" data-value="${escapeAttr(user.username)}">დეტალურად</button></td>
    </tr>
  `;
}


async function openCourierStatsProfile(username) {
  try {
    const previousUsername = state.courierStats.username;
    if (normalizeUsername(previousUsername) !== normalizeUsername(username)) {
      const todayKey = toDateKey(new Date());
      state.courierStats.selectedDate = todayKey;
      state.courierStats.rangeStart = todayKey;
      state.courierStats.rangeEnd = todayKey;
      state.courierStats.filter = "all";
    }
    const [users, parcels, history] = await Promise.all([getUsers(), getPins(username), getHistory(username)]);
    const user = users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
    if (!user) return;
    const range = getCourierStatsRange();
    state.courierStats = {
      username,
      user,
      parcels,
      history,
      records: [...parcels, ...history],
      selectedDate: range.start,
      rangeStart: range.start,
      rangeEnd: range.end,
      filter: state.courierStats.filter || "all",
    };
    await renderCourierStatsProfileDialog();
  } catch {
    showDialog("კურიერის სტატისტიკა", `<div class="history-empty history-empty-card">კურიერის სტატისტიკის ჩატვირთვა ვერ მოხერხდა</div>`, [
      { label: "უკან", variant: "secondary", action: openAdminStatsUsers },
      { label: "დახურვა", variant: "secondary", action: closeDialog },
    ]);
  }
}


async function renderCourierStatsProfileDialog() {
  const { user, parcels, history, records, filter } = state.courierStats;
  const range = getCourierStatsRange();
  const rangeOrders = records.filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
  const filteredOrders = filterCourierStatsOrders(rangeOrders, filter);
  const body = `
    <div class="courier-stats-profile-panel">
      ${renderCourierProfile(user)}
      ${renderDateRangeToolbar({
        startId: "courierStatsStartDate",
        endId: "courierStatsEndDate",
        start: range.start,
        end: range.end,
        applySelector: "data-courier-stats-range-apply",
        className: "finance-range-toolbar",
      })}
      ${renderCourierStatsSummary(parcels, history, range.start, range.end)}
      <div class="courier-stats-order-toolbar">
        <strong>${escapeHtml(formatDateRangeLabel(range.start, range.end))}</strong>
        <select id="courierStatsOrderFilter" aria-label="შეკვეთების ფილტრი">
          <option value="all" ${filter === "all" ? "selected" : ""}>ყველა შეკვეთა</option>
          <option value="delivered" ${filter === "delivered" ? "selected" : ""}>ჩაბარებული</option>
          <option value="failed" ${filter === "failed" ? "selected" : ""}>არ ჩაბარებული</option>
          <option value="pending" ${filter === "pending" ? "selected" : ""}>პროცესში</option>
          <option value="paid" ${filter === "paid" ? "selected" : ""}>მხოლოდ თანხიანი</option>
        </select>
      </div>
      <div id="courierStatsOrders">${await renderCourierDayOrders(filteredOrders)}</div>
    </div>
  `;
  showDialog(`${userDisplayName(user)} სტატისტიკა`, body, [
    { label: "უკან", variant: "secondary", action: openAdminStatsUsers },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  els.dialogModal.classList.add("courier-stats-dialog");
  bindCourierStatsProfileEvents();
}


function bindCourierStatsProfileEvents() {
  document.getElementById("courierStatsOrderFilter")?.addEventListener("change", async (event) => {
    state.courierStats.filter = event.target.value || "all";
    const range = getCourierStatsRange();
    const rangeOrders = state.courierStats.records.filter((parcel) => parcelMatchesStatsDateRange(parcel, range.start, range.end));
    const filteredOrders = filterCourierStatsOrders(rangeOrders, state.courierStats.filter);
    const target = document.getElementById("courierStatsOrders");
    if (target) target.innerHTML = await renderCourierDayOrders(filteredOrders);
  });
  bindDateRangeToolbar({
    startId: "courierStatsStartDate",
    endId: "courierStatsEndDate",
    applySelector: "[data-courier-stats-range-apply]",
    onApply: async (range) => {
      setCourierStatsRange(range.start, range.end);
      await renderCourierStatsProfileDialog();
    },
  });
  document.querySelectorAll("[data-courier-stats-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      setCourierStatsRange(button.dataset.courierStatsDate, button.dataset.courierStatsDate);
      await renderCourierStatsProfileDialog();
    });
  });
}


function renderCourierProfile(user) {
  const activeCount = state.courierStats.parcels.length;
  return `
    <section class="courier-profile-card">
      <div class="courier-profile-title">
        <strong>${escapeHtml(userDisplayName(user))}</strong>
        <span>${escapeHtml(roleLabel(user.role))}</span>
      </div>
      <div class="courier-profile-grid">
        ${statsDetail("სახელი", user.firstName || "არ არის")}
        ${statsDetail("გვარი", user.lastName || "არ არის")}
        ${statsDetail("ლოგინი", user.username)}
        ${statsDetail("ტელეფონი", user.phone || "არ არის")}
        ${statsDetail("როლი", roleLabel(user.role))}
        ${statsDetail("ზონა", user.zoneName || "მიუბმელი")}
        ${statsDetail("აქტიური ამანათები", String(activeCount))}
        ${user.bankDetails ? statsDetail("საბანკო რეკვიზიტები", user.bankDetails) : ""}
      </div>
    </section>
  `;
}


function renderCourierStatsSummary(parcels, history, rangeStart, rangeEnd) {
  const records = [...parcels, ...history];
  const todayKey = toDateKey(new Date());
  const courierUsername = state.courierStats.user?.username || state.courierStats.username || "";
  const summary = calculateFinanceSummary({ records }, { username: courierUsername, startDate: rangeStart, endDate: rangeEnd });
  const todaySummary = calculateFinanceSummary({ records }, { username: courierUsername, startDate: todayKey, endDate: todayKey });
  const selectedOrders = summary.records;
  const delivered = summary.delivered;
  const failed = summary.failed;
  const pending = summary.pending;
  const outstandingCash = summary.cashReceived;
  const todayCourierPay = todaySummary.finalPay;
  const basePay = summary.basePay;
  const courierPay = summary.finalPay;
  const payAdjustment = summary.adjustmentTotal;
  return `
    <section class="courier-stats-summary">
      <div class="courier-stats-summary-item"><span>დღევანდელი გამომუშავება</span><strong>${escapeHtml(formatMoney(todayCourierPay))}</strong></div>
      <div class="courier-stats-summary-item"><span>სულ ისტორია</span><strong>${history.length} ჩანაწერი</strong></div>
      <div class="courier-stats-summary-item"><span>არჩეული პერიოდის ჯამი</span><strong>${selectedOrders.length}</strong></div>
      <div class="courier-stats-summary-item"><span>ჩაბარებული</span><strong>${delivered}</strong></div>
      <div class="courier-stats-summary-item"><span>არ ჩაბარებული</span><strong>${failed}</strong></div>
      <div class="courier-stats-summary-item"><span>პროცესში</span><strong>${pending}</strong></div>
      <div class="courier-stats-summary-item"><span>ჩასაბარებელი ქეში</span><strong>${escapeHtml(formatMoney(outstandingCash))}</strong></div>
      <div class="courier-stats-summary-item"><span>საბაზისო გამომუშავება</span><strong>${escapeHtml(formatMoney(basePay))}</strong></div>
      <div class="courier-stats-summary-item"><span>${escapeHtml(getAdjustmentDirectionLabel(payAdjustment))}</span><strong>${escapeHtml(formatAdjustmentDisplay(payAdjustment))}</strong></div>
      <div class="courier-stats-summary-item"><span>საბოლოო გამომუშავება</span><strong>${escapeHtml(formatMoney(courierPay))}</strong></div>
    </section>
  `;
}


function renderCourierCalendar(history, selectedDate) {
  const selected = new Date(`${selectedDate}T00:00:00`);
  const year = selected.getFullYear();
  const month = selected.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const activeDays = new Set(history.flatMap(getParcelStatsDateKeys).filter((dateKey) => dateKey?.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)));
  const weekdays = ["ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ", "კვი"];
  let grid = weekdays.map((day) => `<div class="calendar-cell weekday">${day}</div>`).join("");
  for (let i = 0; i < offset; i += 1) grid += `<div class="calendar-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    grid += `
      <button class="calendar-cell courier-calendar-day ${dateKey === selectedDate ? "selected" : ""}" type="button" data-courier-stats-date="${dateKey}">
        <span>${day}</span>
        ${activeDays.has(dateKey) ? "<i aria-hidden=\"true\"></i>" : ""}
      </button>
    `;
  }
  return `
    <section class="courier-calendar-panel">
      <div class="calendar-header">
        <button class="calendar-nav-button" type="button" data-courier-stats-date="${toDateKey(new Date(year, month - 1, 1))}" aria-label="წინა თვე">&lt;</button>
        <strong>${escapeHtml(formatMonthYear(selected))}</strong>
        <button class="calendar-nav-button" type="button" data-courier-stats-date="${toDateKey(new Date(year, month + 1, 1))}" aria-label="შემდეგი თვე">&gt;</button>
      </div>
      <div class="calendar-grid">${grid}</div>
    </section>
  `;
}


async function renderCourierDayOrders(orders) {
  const rows = await Promise.all(orders.map(renderCourierOrderCard));
  return renderAppListPanel({
    title: "შეკვეთები",
    badges: [`სულ: ${orders.length}`],
    headers: ["მიმღები", "მისამართი", "სტატუსი", "ქეში", "კურიერი", "თარიღი", ""],
    emptyMessage: "არჩეულ პერიოდში კურიერს შეკვეთები არ ჰქონდა",
    rows,
  });
}


async function renderCourierOrderCard(parcel) {
  const address = await resolveParcelAddress(parcel);
  const payment = getPaymentAmount(parcel);
  const courierPay = getCourierPay(parcel);
  const failedAt = parcel.failedAt || (parcel.status === "failed" ? parcel.completedAt : "");
  const deliveredAt = parcel.deliveredAt || (parcel.status === "delivered" ? parcel.completedAt : "");
  const failureReason = parcelFailureReason(parcel);
  const canFocusMap = Number.isFinite(Number(parcel.lat)) && Number.isFinite(Number(parcel.lng));
  return `
    <tr>
      <td>${renderAppTableText(parcel.fullName || "უსახელო მიმღები", parcel.phone || "ტელეფონი არ არის")}</td>
      <td>
        ${renderAppTableText(address || STRINGS.addressMissing, parcel.status === "failed" && failureReason ? `მიზეზი: ${failureReason}` : "")}
      </td>
      <td>${renderAppStatusBadge(parcel.status, getStatusLabel(parcel.status))}</td>
      <td>${renderAppTableText(payment > 0 ? formatMoney(payment) : "არ აქვს", `კურიერი: ${formatMoney(courierPay)}`)}</td>
      <td>${renderAppTableText(parcel.zoneName || parcel.zoneId || "არ არის", parcel.autoAssigned ? "ავტომატურად" : "ხელით")}</td>
      <td>${escapeHtml(formatOptionalDateTime(deliveredAt || failedAt || parcel.updatedAt || parcel.createdAt))}</td>
      <td>${canFocusMap ? `<button class="mini-button" type="button" data-action="focusStatsParcel" data-value="${escapeAttr(parcel.id)}">რუკა</button>` : ""}</td>
    </tr>
  `;
}


function filterCourierStatsOrders(orders, filter) {
  if (filter === "delivered") return orders.filter((parcel) => parcel.status === "delivered");
  if (filter === "failed") return orders.filter((parcel) => parcel.status === "failed");
  if (filter === "pending") return orders.filter((parcel) => parcel.status === "pending");
  if (filter === "paid") return orders.filter((parcel) => getPaymentAmount(parcel) > 0);
  return orders;
}


function statsDetail(label, value) {
  return `
    <div class="courier-stats-detail">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "არ არის")}</strong>
    </div>
  `;
}


function parcelMatchesStatsDate(parcel, dateKey) {
  return getParcelStatsDateKey(parcel) === normalizeDateKey(dateKey);
}


function parcelMatchesStatsMonth(parcel, monthKey) {
  return getParcelStatsDateKeys(parcel).some((dateKey) => dateKey.startsWith(monthKey));
}


function getParcelStatsDateKeys(parcel) {
  const dateKey = getParcelStatsDateKey(parcel);
  return dateKey ? [dateKey] : [];
}


function focusStatsParcelOnMap(parcel) {
  const target = typeof parcel === "string"
    ? state.courierStats.records.find((item) => item.id === parcel)
    : parcel;
  if (!target) return;
  closeDialog();
  const activePin = state.activePins.find((item) => item.id === target.id);
  if (activePin && (!state.isAdmin || filterPinsForAdminMap(state.activePins).some((item) => item.id === activePin.id))) {
    openParcelTab(activePin.id, { focus: true });
    return;
  }
  clearHistoryPreviewMarker();
  setMapView(target, 17);
  if (!state.map || !window.L) return;
  const marker = L.layerGroup().addTo(state.map);
  L.circleMarker(toLeafletLatLng(target), {
    radius: 11,
    fillColor: getStatusColor(target.status),
    fillOpacity: 0.95,
    color: "#fff",
    weight: 2,
  }).addTo(marker);
  L.marker(toLeafletLatLng(target), {
    icon: L.divIcon({
      className: "pin-label-icon",
      html: `<div class="pin-label-card"><strong>${escapeHtml(target.fullName || "")}</strong><span>${escapeHtml(parcelZoneLabel(target))}</span><span>${escapeHtml(getStatusLabel(target.status))}</span></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
  }).addTo(marker);
  state.historyPreviewMarker = marker;
}


async function openAdminMap() {
  await refreshPins();
  state.adminMapCouriers = await getCouriers();
  renderAdminMapPanel();
  applyAdminMapFilters();
}


function renderAdminMapPanel() {
  const pins = state.activePins;
  const couriers = state.adminMapCouriers;
  const visiblePins = filterPinsForAdminMap(pins);
  const scopePins = filterPinsForAdminMap(pins, { ignoreStatus: true });
  const filters = getAdminMapFilters();
  const view = state.adminMapView === "pins" ? "pins" : "couriers";
  const selectedCount = filters.includeAllCouriers
    ? couriers.length
    : new Set(filters.selectedCouriers.map(normalizeUsername)).size;
  const statusItems = [
    { value: "all", label: "ყველა", count: scopePins.length },
    { value: "pending", label: "პროცესში", count: scopePins.filter((pin) => pin.status === "pending").length },
    { value: "delivered", label: "ჩაბარებული", count: scopePins.filter((pin) => pin.status === "delivered").length },
    { value: "failed", label: "ვერ", count: scopePins.filter((pin) => pin.status === "failed").length },
  ];
  const body = `
    <div class="admin-map-panel-modern admin-map-dashboard admin-map-console">
      <section class="admin-map-console-top" aria-label="რუკის კონტროლი">
        <div class="admin-map-metric-strip" aria-label="რუკის შეჯამება">
          ${renderAdminMapMetric("სულ", pins.length)}
          ${renderAdminMapMetric("ნაჩვენები", visiblePins.length)}
          ${renderAdminMapMetric("კურიერი", `${selectedCount}/${couriers.length}`)}
          ${renderAdminMapMetric("პროცესში", visiblePins.filter((pin) => pin.status === "pending").length)}
          ${renderAdminMapMetric("ჩაბარებული", visiblePins.filter((pin) => pin.status === "delivered").length)}
          ${renderAdminMapMetric("მიუბმელი", visiblePins.filter((pin) => !pin.courierUsername).length)}
        </div>
        <div class="admin-map-filter-row" aria-label="სტატუსის ფილტრი">
          ${statusItems.map((item) => `
            <button class="admin-map-segment ${filters.status === item.value ? "is-active" : ""}" type="button" data-action="adminMapSetStatus" data-value="${escapeAttr(item.value)}">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(String(item.count))}</strong>
            </button>
          `).join("")}
          <button class="admin-map-segment ${filters.showUnassigned && !filters.includeAllCouriers && !filters.selectedCouriers.length ? "is-active" : ""}" type="button" data-action="showUnassignedAdminPins">
            <span>მიუბმელი</span>
            <strong>${escapeHtml(String(pins.filter((pin) => !pin.courierUsername).length))}</strong>
          </button>
        </div>
      </section>
      <section class="admin-map-list-shell">
        <div class="admin-map-list-toolbar">
          <div class="admin-map-tabs" role="tablist" aria-label="რუკის სია">
            <button class="admin-map-tab ${view === "couriers" ? "is-active" : ""}" type="button" data-action="adminMapSetView" data-value="couriers">კურიერები</button>
            <button class="admin-map-tab ${view === "pins" ? "is-active" : ""}" type="button" data-action="adminMapSetView" data-value="pins">ამანათები</button>
          </div>
          <div class="admin-map-quick-row">
            <button class="mini-button" type="button" data-action="showAllAdminPins">ყველა</button>
            <button class="mini-button" type="button" data-action="hideAllAdminPins">არცერთი</button>
            <button class="mini-button" type="button" data-action="adminMapToggleAllCouriers">ყველა კურიერი</button>
          </div>
          <label class="admin-map-courier-search admin-map-search" for="adminMapCourierSearch">
            <span>ძებნა</span>
            <input id="adminMapCourierSearch" type="search" autocomplete="off" placeholder="${view === "pins" ? "მიმღები, მისამართი, კურიერი" : "სახელი, ლოგინი ან ნომერი"}" value="${escapeAttr(state.adminMapCourierSearch || "")}">
          </label>
        </div>
        ${view === "pins" ? renderAdminMapParcelList(visiblePins) : renderAdminMapCourierList(couriers, pins)}
      </section>
    </div>
  `;
  if (state.activeDialogTitle === "ადმინის რუკა" && els.dialogModal?.classList.contains("active")) {
    els.dialogTitle.textContent = "ადმინის რუკა";
    els.dialogBody.innerHTML = body;
    els.dialogActions.innerHTML = "";
    els.dialogModal.classList.add("admin-map-dialog");
    bindAdminMapPanelEvents();
    return;
  }

  showDialog("ადმინის რუკა", body, []);
  els.dialogModal.classList.add("admin-map-dialog");
  bindAdminMapPanelEvents();
}


function bindAdminMapPanelEvents() {
  const searchInput = document.getElementById("adminMapCourierSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.adminMapCourierSearch = searchInput.value;
      applyAdminMapCourierSearch();
    });
    applyAdminMapCourierSearch();
  }
  document.getElementById("adminMapAllCouriersToggle")?.addEventListener("change", adminMapToggleAllCouriers);
  document.getElementById("adminMapUnassignedToggle")?.addEventListener("change", adminMapToggleUnassigned);
  document.querySelectorAll("input[name='adminMapCourierFilter']").forEach((input) => {
    input.addEventListener("change", () => adminMapToggleCourier(input.value));
  });
  document.querySelectorAll(".admin-map-courier-card, .admin-map-courier-toggle").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("input, button, a, select, textarea")) return;
      const input = card.querySelector("input");
      if (input) input.click();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const input = card.querySelector("input");
      if (!input) return;
      event.preventDefault();
      input.click();
    });
  });
}


function applyAdminMapFilters() {
  clearAdminMapPins();
  const visiblePins = filterPinsForAdminMap(state.activePins);
  renderParcelMarkers(visiblePins);
  if (state.selectedPinId && !visiblePins.some((pin) => pin.id === state.selectedPinId)) hideSelectedParcelCard();
}


function filterPinsForAdminMap(pins = state.activePins, options = {}) {
  if (!state.isAdmin) return pins;

  const filters = getAdminMapFilters();
  const selected = new Set((filters.selectedCouriers || []).map(normalizeUsername));

  return (pins || []).filter((pin) => {
    const pinStatus = pin.status || "pending";
    const hasCourier = Boolean(pin.courierUsername);

    if (!options.ignoreStatus && filters.status !== "all" && pinStatus !== filters.status) return false;
    if (!hasCourier) return Boolean(filters.showUnassigned);
    if (filters.includeAllCouriers) return true;
    if (!selected.size) return false;
    return selected.has(normalizeUsername(pin.courierUsername));
  });
}


function renderAdminMapCourierList(couriers, pins) {
  const filters = getAdminMapFilters();
  const selected = new Set((filters.selectedCouriers || []).map(normalizeUsername));
  const allCourierUsernames = couriers.map((courier) => courier.username);

  const courierRows = couriers.map((courier) => {
    const stats = getAdminMapCourierStats(courier, pins);
    const normalized = normalizeUsername(courier.username);
    const isActive = filters.includeAllCouriers || selected.has(normalized);
    return `
      <tr class="admin-map-courier-card admin-map-searchable-row ${isActive ? "is-active" : ""}" data-admin-map-search="${escapeAttr(getAdminMapCourierSearchText(courier))}" tabindex="0">
        <td><input type="checkbox" name="adminMapCourierFilter" value="${escapeAttr(courier.username)}" ${isActive ? "checked" : ""}></td>
        <td>${renderAppTableText(userDisplayName(courier), `${courier.username}${courier.phone ? ` / ${courier.phone}` : ""}`)}</td>
        <td>${escapeHtml(String(stats.total))}</td>
        <td>${renderAppStatusBadge("pending", String(stats.pending))}</td>
        <td>${renderAppStatusBadge("delivered", String(stats.delivered))}</td>
        <td>${renderAppStatusBadge("failed", String(stats.failed))}</td>
      </tr>
    `;
  });

  return `
    <div class="admin-map-list admin-map-courier-list">
      <div class="partner-table-wrap admin-map-table-wrap">
        <table class="partner-order-table admin-map-table">
          <thead>
            <tr>
              <th></th>
              <th>კურიერი</th>
              <th>აქტიური</th>
              <th>პროცესში</th>
              <th>ჩაბარებული</th>
              <th>ვერ</th>
            </tr>
          </thead>
          <tbody>
            <tr class="admin-map-courier-toggle admin-map-courier-toggle-all ${filters.includeAllCouriers ? "is-active" : ""}" tabindex="0">
              <td><input id="adminMapAllCouriersToggle" type="checkbox" ${filters.includeAllCouriers ? "checked" : ""}></td>
              <td>${renderAppTableText("ყველა კურიერი", allCourierUsernames.length ? "ყველა კურიერის პინი გამოჩნდება" : "კურიერი არ არის")}</td>
              <td colspan="4">${renderAppStatusBadge(filters.includeAllCouriers ? "delivered" : "pending", filters.includeAllCouriers ? "ჩართულია" : "გამორთულია")}</td>
            </tr>
            <tr class="admin-map-courier-toggle admin-map-courier-toggle-unassigned ${filters.showUnassigned ? "is-active" : ""}" tabindex="0">
              <td><input id="adminMapUnassignedToggle" type="checkbox" ${filters.showUnassigned ? "checked" : ""}></td>
              <td>${renderAppTableText("მიუბმელი", "მხოლოდ მიუბმელი პინები")}</td>
              <td colspan="4">${renderAppStatusBadge(filters.showUnassigned ? "delivered" : "pending", filters.showUnassigned ? "ჩართულია" : "გამორთულია")}</td>
            </tr>
            ${courierRows.join("") || `<tr><td colspan="6">კურიერი ჯერ არ არის.</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="history-empty admin-map-courier-empty" hidden>კურიერი ვერ მოიძებნა.</p>
    </div>
  `;
}


function renderAdminMapParcelList(pins) {
  const sortedPins = [...pins].sort((a, b) => {
    const statusDiff = getStatusSortValue(a.status) - getStatusSortValue(b.status);
    if (statusDiff) return statusDiff;
    return String(a.fullName || "").localeCompare(String(b.fullName || ""), "ka");
  });
  const rows = sortedPins.map((pin) => {
    const address = typeof getParcelAddress === "function" ? getParcelAddress(pin) : (pin.address || pin.fullAddress || STRINGS.addressMissing);
    return `
      <tr class="admin-map-pin-row admin-map-searchable-row" data-admin-map-search="${escapeAttr(getAdminMapPinSearchText(pin, address))}">
        <td>${renderAppTableText(pin.fullName || "უსახელო", pin.phone || "ტელეფონი არ არის")}</td>
        <td>${escapeHtml(address || STRINGS.addressMissing)}</td>
        <td>${renderAppTableText(parcelCourierDisplayName(pin), pin.courierUsername || "მიუბმელი")}</td>
        <td>${renderAppStatusBadge(pin.status, getStatusLabel(pin.status))}</td>
        <td>${escapeHtml(formatMoney(getPaymentAmount(pin)))}</td>
        <td><button class="mini-button" type="button" data-action="focusAdminPin" data-value="${escapeAttr(pin.id)}">რუკა</button></td>
      </tr>
    `;
  });

  return `
    <div class="admin-map-list admin-map-pin-list">
      <div class="partner-table-wrap admin-map-table-wrap">
        <table class="partner-order-table admin-map-table">
          <thead>
            <tr>
              <th>მიმღები</th>
              <th>მისამართი</th>
              <th>კურიერი</th>
              <th>სტატუსი</th>
              <th>ქეში</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows.join("") || `<tr><td colspan="6">ამ ფილტრში ამანათი არ არის.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="history-empty admin-map-courier-empty" hidden>ჩანაწერი ვერ მოიძებნა.</p>
    </div>
  `;
}


function getAdminMapCourierSearchText(courier) {
  return normalizeAdminMapCourierSearch([
    courier.username,
    courier.firstName,
    courier.lastName,
    courier.phone,
    userDisplayName(courier),
  ].filter(Boolean).join(" "));
}


function getAdminMapPinSearchText(pin, address = "") {
  return normalizeAdminMapCourierSearch([
    pin.id,
    pin.fullName,
    pin.phone,
    address,
    pin.address,
    pin.fullAddress,
    pin.courierUsername,
    parcelCourierDisplayName(pin),
    pin.partnerName,
    getStatusLabel(pin.status),
  ].filter(Boolean).join(" "));
}


function normalizeAdminMapCourierSearch(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}


function applyAdminMapCourierSearch() {
  const query = normalizeAdminMapCourierSearch(state.adminMapCourierSearch);
  const rows = [...document.querySelectorAll(".admin-map-searchable-row[data-admin-map-search]")];
  let visibleCount = 0;

  rows.forEach((row) => {
    const isVisible = !query || (row.dataset.adminMapSearch || "").includes(query);
    row.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  const empty = document.querySelector(".admin-map-courier-empty");
  if (empty) empty.hidden = !query || visibleCount > 0;
}


function renderAdminMapCardMetrics(stats) {
  return `
    <span class="admin-map-card-metrics">
      <span><b>${stats.total}</b><small>აქტიური</small></span>
      <span><b>${stats.pending}</b><small>პროცესში</small></span>
      <span><b>${stats.delivered}</b><small>ჩაბარებული</small></span>
      <span><b>${stats.failed}</b><small>ვერ ჩაბარებული</small></span>
    </span>
  `;
}


function renderAdminMapMetric(label, value) {
  return `
    <span class="admin-map-metric">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `;
}


function renderAdminMapSummaryCard(label, value) {
  return `
    <div class="admin-map-summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}


function getAdminMapCourierStats(courier, pins) {
  const courierPins = (pins || []).filter((pin) => normalizeUsername(pin.courierUsername) === normalizeUsername(courier.username));
  return {
    total: courierPins.length,
    delivered: courierPins.filter((pin) => pin.status === "delivered").length,
    failed: courierPins.filter((pin) => pin.status === "failed").length,
    pending: courierPins.filter((pin) => pin.status === "pending").length,
  };
}


function getAdminMapFilters() {
  const filters = state.adminMapFilters || {};
  return {
    includeAllCouriers: filters.includeAllCouriers !== false,
    selectedCouriers: Array.isArray(filters.selectedCouriers) ? filters.selectedCouriers : [],
    showUnassigned: filters.showUnassigned !== false,
    status: ["all", "pending", "delivered", "failed"].includes(filters.status) ? filters.status : "all",
  };
}


function setAdminMapFilters(nextFilters = {}) {
  const current = getAdminMapFilters();
  state.adminMapFilters = {
    ...current,
    ...nextFilters,
    selectedCouriers: Array.isArray(nextFilters.selectedCouriers)
      ? [...new Set(nextFilters.selectedCouriers.map(String))]
      : current.selectedCouriers,
  };
}


function adminMapToggleAllCouriers() {
  const filters = getAdminMapFilters();
  const allUsernames = state.adminMapCouriers.map((courier) => courier.username);
  if (filters.includeAllCouriers) {
    setAdminMapFilters({
      includeAllCouriers: false,
      selectedCouriers: [],
    });
  } else {
    setAdminMapFilters({
      includeAllCouriers: true,
      selectedCouriers: allUsernames,
    });
  }
  refreshAdminMapPanel();
}


function adminMapToggleCourier(username) {
  if (!username) return;

  const filters = getAdminMapFilters();
  const allUsernames = state.adminMapCouriers.map((courier) => courier.username);
  const normalized = normalizeUsername(username);
  const selected = new Set(filters.selectedCouriers.map(normalizeUsername));

  if (filters.includeAllCouriers) {
    selected.clear();
    allUsernames
      .filter((courierUsername) => normalizeUsername(courierUsername) !== normalized)
      .forEach((courierUsername) => selected.add(courierUsername));
    setAdminMapFilters({
      includeAllCouriers: false,
      selectedCouriers: [...selected],
    });
  } else if (selected.has(normalized)) {
    selected.delete(normalized);
    setAdminMapFilters({
      includeAllCouriers: selected.size === allUsernames.length && allUsernames.length > 0,
      selectedCouriers: [...selected],
    });
  } else {
    selected.add(normalized);
    setAdminMapFilters({
      includeAllCouriers: selected.size === allUsernames.length && allUsernames.length > 0,
      selectedCouriers: [...selected],
    });
  }
  refreshAdminMapPanel();
}


function adminMapSetStatus(status) {
  if (!["all", "pending", "delivered", "failed"].includes(status)) return;
  setAdminMapFilters({ status });
  refreshAdminMapPanel();
}


function adminMapSetView(view) {
  state.adminMapView = view === "pins" ? "pins" : "couriers";
  refreshAdminMapPanel();
}


function adminMapToggleUnassigned() {
  const filters = getAdminMapFilters();
  setAdminMapFilters({ showUnassigned: !filters.showUnassigned });
  refreshAdminMapPanel();
}


function adminMapShowAllPins() {
  showAllAdminPins();
}


function showAllAdminPins() {
  setAdminMapFilters({
    includeAllCouriers: true,
    selectedCouriers: state.adminMapCouriers.map((courier) => courier.username),
    showUnassigned: true,
    status: "all",
  });
  refreshAdminMapPanel();
}


function hideAllAdminPins() {
  setAdminMapFilters({
    includeAllCouriers: false,
    selectedCouriers: [],
    showUnassigned: false,
    status: "all",
  });
  refreshAdminMapPanel();
}


function showUnassignedAdminPins() {
  setAdminMapFilters({
    includeAllCouriers: false,
    selectedCouriers: [],
    showUnassigned: true,
    status: "all",
  });
  refreshAdminMapPanel();
}


function refreshAdminMapPanel() {
  if (state.activeDialogTitle === "ადმინის რუკა") {
    renderAdminMapPanel();
  }
  applyAdminMapFilters();
  refreshAdminDashboardFilterState();
}


function focusPinById(pinId) {
  const pin = state.activePins.find((item) => item.id === pinId);
  if (!pin) return;
  openParcelTab(pin.id, { closeOpenDialog: true, focus: true });
}


async function assignSelectedPins() {
  const parcelIds = [...document.querySelectorAll("input[name='assignPin']:checked")].map((input) => input.value);
  const courierUsername = document.getElementById("assignCourier")?.value;
  const message = document.getElementById("assignPinsMessage");
  if (!parcelIds.length || !courierUsername) {
    if (message) message.textContent = "აირჩიეთ პინები და კურიერი.";
    return;
  }
  const missingLocation = state.activePins.find((pin) => parcelIds.includes(pin.id) && (!Number.isFinite(Number(pin.lat)) || !Number.isFinite(Number(pin.lng))));
  if (missingLocation) {
    if (message) message.textContent = "ჯერ მიუთითეთ პინის მდებარეობა.";
    showSelectedParcelCard(missingLocation.id, { focus: true });
    startParcelLocationEdit(missingLocation.id);
    return;
  }
  try {
    const selectedPins = state.activePins.filter((pin) => parcelIds.includes(pin.id));
    const expectedUpdatedAtById = Object.fromEntries(selectedPins.map((pin) => [pin.id, pin.updatedAt || ""]));
    await api("/api/parcels/assign", { method: "PATCH", body: { parcelIds, courierUsername, expectedUpdatedAtById } });
    if (typeof publishParcelAssignedNotification === "function") {
      await Promise.all(selectedPins.map((pin) => (
        publishParcelAssignedNotification({ ...pin, courierUsername }, courierUsername).catch((error) => {
          console.warn("Courier assignment push notification failed", error);
        })
      )));
    }
    showToast("პინები მიება კურიერს.");
    await openAdminMap();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}


async function openUserManagement() {
  const users = await getUsers();
  const body = renderAppListPanel({
    title: "კურიერი",
    badges: [`სულ: ${users.length}`],
    headers: ["მომხმარებელი", "ტელეფონი", "როლი", "ზონა", "სტატუსი", ""],
    emptyMessage: "კურიერი არ არის.",
    rows: users.map((user) => `
      <tr>
        <td>${renderAppTableText(userDisplayName(user), user.username)}</td>
        <td>${escapeHtml(user.phone || "არ არის")}</td>
        <td>${escapeHtml(roleLabel(user.role))}</td>
        <td>${escapeHtml(user.zoneName || "მიუბმელი")}</td>
        <td>${renderAppStatusBadge(user.status === "active" ? "delivered" : "pending", user.status === "active" ? "აქტიური" : getStatusLabel(user.status))}</td>
        <td>
          <div class="row-actions admin-user-actions">
            <button class="mini-button" type="button" data-action="editUser" data-value="${escapeAttr(user.username)}">რედაქტირება</button>
            ${user.username === "admin" || user.role === "admin" ? "" : `<button class="mini-button danger" type="button" data-action="deleteUser" data-value="${escapeAttr(user.username)}">წაშლა</button>`}
          </div>
        </td>
      </tr>
    `),
  });
  showDialog("კურიერი", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openUserEditDialog(username) {
  const user = (await getUsers()).find((item) => item.username === username);
  if (!user) return;
  const body = `
    <div class="stats-card">
      <strong>${escapeHtml(user.username)}</strong>
      <span>${escapeHtml(roleLabel(user.role))}</span>
    </div>
    ${userProfileFields(user)}
    <label for="editUserPassword">ახალი პაროლი</label>
    <input id="editUserPassword" type="password" autocomplete="new-password" placeholder="ცარიელი დატოვე თუ არ იცვლება">
    <p class="form-message" id="editUserMessage" role="alert"></p>
  `;
  showDialog("კურიერის რედაქტირება", body, [
    { label: "შენახვა", variant: "primary", action: () => saveUserEdit(username) },
    { label: "უკან", variant: "secondary", action: openUserManagement },
  ]);
}


async function saveUserEdit(username) {
  const password = document.getElementById("editUserPassword")?.value.trim();
  const message = document.getElementById("editUserMessage");
  const body = readUserProfileFields();
  if (password) body.password = password;
  try {
    await api(`/api/users/${encodeURIComponent(username)}`, { method: "PUT", body });
    await openUserManagement();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}


function confirmUserDelete(username) {
  showDialog("დეაქტივაცია", `<p>დეაქტივაციის შემდეგ ${escapeHtml(username)}-ის ინფორმაცია და პინები წაიშლება.</p>`, [
    { label: "დეაქტივაცია", variant: "danger", action: () => deleteUser(username) },
    { label: "გაუქმება", variant: "secondary", action: openUserManagement },
  ]);
}


async function deleteUser(username) {
  await api(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  await refreshPins();
  await openUserManagement();
}


function buildCloseDayCourierStats(couriers, pins) {
  const stats = new Map();
  couriers.forEach((courier) => {
    stats.set(normalizeUsername(courier.username), {
      username: courier.username,
      label: userDisplayName(courier),
      parcels: [],
    });
  });

  pins.forEach((pin) => {
    const key = normalizeUsername(pin.courierUsername || "");
    if (!stats.has(key)) {
      stats.set(key, {
        username: pin.courierUsername || "",
        label: parcelCourierDisplayName(pin),
        parcels: [],
      });
    }
    stats.get(key).parcels.push(pin);
  });

  return [...stats.values()].sort((a, b) => b.parcels.length - a.parcels.length || a.label.localeCompare(b.label, "ka"));
}


function renderCloseDayCourierStats(stats) {
  const rows = stats.map((item) => {
    const deliveredPins = item.parcels.filter((pin) => pin.status === "delivered");
    const delivered = deliveredPins.length;
    const failed = item.parcels.filter((pin) => pin.status === "failed").length;
    const dateKeys = deliveredPins.flatMap(getParcelStatsDateKeys).filter(Boolean).sort();
    const rangeStart = dateKeys[0] || toDateKey(new Date());
    const rangeEnd = dateKeys[dateKeys.length - 1] || rangeStart;
    const summary = calculateFinanceSummary({ records: deliveredPins }, { username: item.username, startDate: rangeStart, endDate: rangeEnd });
    const basePay = summary.basePay;
    const courierPay = summary.finalPay;
    const payAdjustment = summary.adjustmentTotal;
    return `
      <tr>
        <td>${renderAppTableText(item.label, item.username)}</td>
        <td>${renderAppStatusBadge("delivered", `${delivered} დატოვა`)}</td>
        <td>${renderAppStatusBadge("failed", String(failed))}</td>
        <td>${escapeHtml(formatMoney(summary.cashReceived))}</td>
        <td>${renderAppTableText(formatMoney(basePay), `${getAdjustmentDirectionLabel(payAdjustment)}: ${formatAdjustmentDisplay(payAdjustment)}`)}</td>
        <td>${escapeHtml(formatMoney(courierPay))}</td>
      </tr>
    `;
  });

  return renderAppListPanel({
    title: "კურიერების შეჯამება",
    badges: [`კურიერი: ${stats.length}`],
    headers: ["კურიერი", "ჩაბარებული", "ვერ ჩაბარდა", "ქეში", "საბაზისო", "საბოლოო"],
    emptyMessage: "კურიერი ჯერ არ არის.",
    rows,
  });
}


async function openAdminCloseDay() {
  const pins = await getPins("");
  const couriers = await getCouriers();
  const closablePins = pins.filter(isCompletedParcelStatus);
  const delivered = closablePins.filter((pin) => pin.status === "delivered").length;
  const failed = pins.filter((pin) => pin.status === "failed").length;
  const pending = pins.filter((pin) => pin.status === "pending").length;
  const closable = delivered;
  const courierStats = buildCloseDayCourierStats(couriers, pins.filter((pin) => pin.status === "delivered" || pin.status === "failed"));
  const body = `
    <div class="history-summary">
      <strong>დასახური პინები: ${closable}</strong>
      <div class="history-metrics">
        <span><b>${delivered}</b> ჩაბარდა</span>
        <span><b>${failed}</b> არ ჩაბარდა</span>
        <span><b>${pending}</b> პროცესშია</span>
        <span><b>${closable}</b> დაიხურება</span>
      </div>
    </div>
    ${renderCloseDayCourierStats(courierStats)}
    <p>დღის დახურვა ისტორიაში გადაიტანს მხოლოდ ჩაბარებულ პინებს. არ ჩაბარებული და პროცესში დარჩენილი პინები აქტიურად რჩება.</p>
  `;
  showDialog("დღის დახურვა", body, [
    { label: "დღის დახურვა", variant: "primary", action: closeAdminDay },
    { label: "გაუქმება", variant: "secondary", action: closeDialog },
  ]);
}


async function closeAdminDay() {
  const pins = await getPins("");
  const deliveredPins = pins.filter(isCompletedParcelStatus);
  if (!deliveredPins.length) {
    closeDialog();
    showToast("ჩაბარებული პინი არ არის.");
    return;
  }
  const payload = await api("/api/parcels/archive", {
    method: "POST",
    body: {
      status: "delivered",
      parcelIds: deliveredPins.map((pin) => pin.id),
    },
  });
  const archivedIds = new Set(deliveredPins.map((pin) => pin.id));
  state.activePins = state.activePins.filter((pin) => !archivedIds.has(pin.id));
  if (archivedIds.has(state.selectedPinId)) hideSelectedParcelCard();
  closeDialog();
  await refreshPins();
  showToast(`${payload.archived} პინი გადავიდა ისტორიაში.`);
}
