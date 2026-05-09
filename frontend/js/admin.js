"use strict";



async function openPendingRequests() {
  const pending = await getPending();
  const body = pending.length
    ? pending.map((request) => `
        <div class="parcel-row">
          <strong>${escapeHtml(request.username)}</strong>
          <span>მოთხოვნის დრო: ${formatDateTime(request.requestedAt)}</span>
          <div class="row-actions">
            <button class="button" type="button" data-action="approve" data-value="${escapeAttr(request.username)}">დადასტურება</button>
            <button class="button danger" type="button" data-action="reject" data-value="${escapeAttr(request.username)}">უარყოფა</button>
          </div>
        </div>
      `).join("")
    : `<p>${STRINGS.noPending}</p>`;

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


async function openCourierPicker() {
  const users = await getCouriers();
  const body = users.length
    ? users.map((user) => `<button class="list-button" type="button" data-action="chooseCourier" data-value="${escapeAttr(user.username)}">${escapeHtml(user.username)}</button>`).join("")
    : `<p>${STRINGS.noCouriers}</p>`;

  showDialog("კურიერის არჩევა", body, [{ label: "გაუქმება", variant: "secondary", action: closeDialog }]);
}


async function openAnalyticsPicker() {
  const users = await getCouriers();
  const body = users.length
    ? users.map((user) => `<button class="list-button" type="button" data-action="openCourierAnalytics" data-value="${escapeAttr(user.username)}">${escapeHtml(user.username)}</button>`).join("")
    : `<p>${STRINGS.noCouriers}</p>`;

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
    const cards = await Promise.all(users.map(renderCourierStatsUserCard));
    const body = users.length
      ? `<div class="finance-card-list courier-stats-user-list">${cards.join("")}</div>`
      : `<div class="history-empty history-empty-card">კურიერი ჯერ არ არის დამატებული</div>`;
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
    <button class="finance-card finance-static-card courier-stats-user-card" type="button" data-action="adminStatsUser" data-value="${escapeAttr(user.username)}">
      <span class="courier-stats-user-name">${escapeHtml(userDisplayName(user))}</span>
      <small>username: ${escapeHtml(user.username)}</small>
      <div class="courier-stats-user-metrics">
        <span><b>${deliveredToday}</b> დღეს ჩაბარდა</span>
        <span><b>${escapeHtml(formatMoney(earnedToday))}</b> დღევანდელი გამომუშავება</span>
        <span><b>${activeCount}</b> აქტიური</span>
      </div>
    </button>
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
      <div class="courier-stats-summary-item"><span>კორექტირება</span><strong>${escapeHtml(formatMoney(payAdjustment))}</strong></div>
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
  if (!orders.length) return `<div class="history-empty history-empty-card">არჩეულ პერიოდში კურიერს შეკვეთები არ ჰქონდა</div>`;
  return `<div class="courier-order-list">${(await Promise.all(orders.map(renderCourierOrderCard))).join("")}</div>`;
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
    <article class="courier-order-card">
      <div class="courier-order-head">
        <div>
          <strong>${escapeHtml(parcel.fullName || "უსახელო მიმღები")}</strong>
          <span>${escapeHtml(parcel.phone || "ტელეფონი არ არის")}</span>
        </div>
        <span class="history-status status-${escapeAttr(parcel.status)}">${escapeHtml(getStatusLabel(parcel.status))}</span>
      </div>
      <div class="courier-order-address">${escapeHtml(address || STRINGS.addressMissing)}</div>
      <div class="courier-order-grid">
        ${statsDetail("მიტანის დრო", formatOptionalDateTime(deliveredAt))}
        ${statsDetail("ვერ ჩაბარდა", formatOptionalDateTime(failedAt))}
        ${statsDetail("ქეში", payment > 0 ? formatMoney(payment) : "არ აქვს")}
        ${statsDetail("კურიერის ანაზღაურება", formatMoney(courierPay))}
        ${statsDetail("ზონა", parcel.zoneName || parcel.zoneId || "არ არის")}
        ${statsDetail("მიბმა", parcel.autoAssigned ? "ავტომატურად" : "ხელით")}
      </div>
      ${parcel.status === "failed" && failureReason ? `<div class="parcel-history-note"><span>მიზეზი</span><strong>${escapeHtml(failureReason)}</strong></div>` : ""}
      ${canFocusMap ? `<button class="mini-button" type="button" data-action="focusStatsParcel" data-value="${escapeAttr(parcel.id)}">რუკაზე ნახვა</button>` : ""}
    </article>
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
  const filters = getAdminMapFilters();
  const visibleCount = visiblePins.length;
  const selectedCount = filters.includeAllCouriers
    ? couriers.length
    : new Set(filters.selectedCouriers.map(normalizeUsername)).size;
  const body = `
    <div class="admin-map-panel-modern admin-map-dashboard">
      <section class="admin-map-summary-grid admin-map-fixed-section" aria-label="რუკის შეჯამება">
        ${renderAdminMapSummaryCard("სულ პინები", pins.length)}
        ${renderAdminMapSummaryCard("ნაჩვენები", visibleCount)}
        ${renderAdminMapSummaryCard("კურიერები", couriers.length)}
        ${renderAdminMapSummaryCard("შერჩეული", selectedCount)}
        ${renderAdminMapSummaryCard("ჩაბარებული", visiblePins.filter((pin) => pin.status === "delivered").length)}
        ${renderAdminMapSummaryCard("პროცესში", visiblePins.filter((pin) => pin.status === "pending").length)}
        ${renderAdminMapSummaryCard("ვერ ჩაბარებული", visiblePins.filter((pin) => pin.status === "failed").length)}
        ${renderAdminMapSummaryCard("მიუბმელი", visiblePins.filter((pin) => !pin.courierUsername).length)}
      </section>
      <section class="admin-map-toolbar admin-map-fixed-section" aria-label="ფილტრები და სწრაფი მოქმედებები">
        <div class="admin-map-chip-row" aria-label="სწრაფი მოქმედებები">
          <button class="admin-map-chip ${filters.includeAllCouriers && filters.showUnassigned && filters.status === "all" ? "is-active" : ""}" type="button" data-action="showAllAdminPins">ყველა</button>
          <button class="admin-map-chip ${!filters.includeAllCouriers && !filters.showUnassigned && !filters.selectedCouriers.length && filters.status === "all" ? "is-active" : ""}" type="button" data-action="hideAllAdminPins">არცერთი</button>
          <button class="admin-map-chip ${!filters.includeAllCouriers && filters.showUnassigned && !filters.selectedCouriers.length && filters.status === "all" ? "is-active" : ""}" type="button" data-action="showUnassignedAdminPins">მიუბმელი</button>
          <button class="admin-map-chip ${filters.includeAllCouriers ? "is-active" : ""}" type="button" data-action="adminMapToggleAllCouriers">ყველა კურიერი</button>
        </div>
        <div class="admin-map-filter-grid" aria-label="სტატუსის ფილტრი">
          ${["all", "pending", "delivered", "failed"].map((status) => `
            <button class="admin-map-filter-card ${filters.status === status ? "is-active" : ""}" type="button" data-action="adminMapSetStatus" data-value="${escapeAttr(status)}">
              <strong>${escapeHtml(status === "all" ? "ყველა სტატუსი" : status === "pending" ? "პროცესში" : status === "delivered" ? "ჩაბარებული" : "ვერ ჩაბარებული")}</strong>
            </button>
          `).join("")}
        </div>
      </section>
      <section class="admin-map-courier-grid admin-map-scroll-section">
        <div class="admin-map-courier-grid-head">
          <strong>კურიერები</strong>
          <small>მონიშნე კურიერები, რომ რუკაზე მხოლოდ მათი პინები გამოჩნდეს</small>
        </div>
        ${renderAdminMapCourierList(couriers, pins)}
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
  document.getElementById("adminMapAllCouriersToggle")?.addEventListener("change", adminMapToggleAllCouriers);
  document.getElementById("adminMapUnassignedToggle")?.addEventListener("change", adminMapToggleUnassigned);
  document.querySelectorAll("input[name='adminMapCourierFilter']").forEach((input) => {
    input.addEventListener("change", () => adminMapToggleCourier(input.value));
  });
  document.querySelectorAll(".admin-map-courier-card, .admin-map-courier-toggle").forEach((card) => {
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


function filterPinsForAdminMap(pins = state.activePins) {
  if (!state.isAdmin) return pins;

  const filters = getAdminMapFilters();
  const selected = new Set((filters.selectedCouriers || []).map(normalizeUsername));

  return (pins || []).filter((pin) => {
    const pinStatus = pin.status || "pending";
    const hasCourier = Boolean(pin.courierUsername);

    if (filters.status !== "all" && pinStatus !== filters.status) return false;
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

  const courierCards = couriers.map((courier) => {
    const stats = getAdminMapCourierStats(courier, pins);
    const normalized = normalizeUsername(courier.username);
    const isActive = filters.includeAllCouriers || selected.has(normalized);
    return `
      <label class="admin-map-courier-card ${isActive ? "is-active" : ""}">
        <input type="checkbox" name="adminMapCourierFilter" value="${escapeAttr(courier.username)}" ${isActive ? "checked" : ""}>
        <span class="admin-map-courier-main">
          <strong>${escapeHtml(userDisplayName(courier))}</strong>
          <small>${escapeHtml(courier.username)}${courier.phone ? ` / ${escapeHtml(courier.phone)}` : ""}</small>
        </span>
        ${renderAdminMapCardMetrics(stats)}
      </label>
    `;
  }).join("");

  return `
    <div class="admin-map-courier-list">
      <label class="admin-map-courier-toggle admin-map-courier-toggle-all ${filters.includeAllCouriers ? "is-active" : ""}">
        <input id="adminMapAllCouriersToggle" type="checkbox" ${filters.includeAllCouriers ? "checked" : ""}>
        <span class="admin-map-courier-main">
          <strong>ყველა კურიერი</strong>
          <small>${allCourierUsernames.length ? "ყველა კურიერის პინი გამოჩნდება" : "კურიერი არ არის"}</small>
        </span>
      </label>
      <label class="admin-map-courier-toggle admin-map-courier-toggle-unassigned ${filters.showUnassigned ? "is-active" : ""}">
        <input id="adminMapUnassignedToggle" type="checkbox" ${filters.showUnassigned ? "checked" : ""}>
        <span class="admin-map-courier-main">
          <strong>მიუბმელი</strong>
          <small>მხოლოდ მიუბმელი პინები</small>
        </span>
      </label>
      ${courierCards || "<p class=\"history-empty\">კურიერი ჯერ არ არის.</p>"}
    </div>
  `;
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
  try {
    await api("/api/parcels/assign", { method: "PATCH", body: { parcelIds, courierUsername } });
    showToast("პინები მიება კურიერს.");
    await openAdminMap();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}


async function openUserManagement() {
  const users = await getUsers();
  const body = users.length
    ? `<div class="finance-card-list admin-user-list">${users.map((user) => `
        <article class="finance-card finance-static-card admin-user-card">
          <span class="admin-user-name">${escapeHtml(userDisplayName(user))}</span>
          <small>username: ${escapeHtml(user.username)}</small>
          <small>ტელეფონი: ${escapeHtml(user.phone || "არ არის")}</small>
          <small>როლი: ${escapeHtml(roleLabel(user.role))}</small>
          <small>ზონა: ${escapeHtml(user.zoneName || "მიუბმელი")}</small>
          <div class="row-actions admin-user-actions">
            <button class="mini-button" type="button" data-action="editUser" data-value="${escapeAttr(user.username)}">რედაქტირება</button>
            ${user.username === "admin" || user.role === "admin" ? "" : `<button class="mini-button danger" type="button" data-action="deleteUser" data-value="${escapeAttr(user.username)}">წაშლა</button>`}
          </div>
        </article>
      `).join("")}</div>`
    : "<p>კურიერი არ არის.</p>";
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
  if (!stats.length) return `<p class="history-empty">კურიერი ჯერ არ არის.</p>`;

  return stats.map((item) => {
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
      <div class="history-row">
        <div class="history-row-main">
          <strong>${escapeHtml(item.label)}</strong>
          <span class="history-status">${delivered} დატოვა</span>
        </div>
        <div class="history-row-meta">
          <span>დატოვა: ${delivered}</span>
          <span>არ ჩაბარდა: ${failed}</span>
          <span>ქეში: ${escapeHtml(formatMoney(summary.cashReceived))}</span>
          <span>საბაზისო გამომუშავება: ${escapeHtml(formatMoney(basePay))}</span>
          <span>კორექტირება: ${escapeHtml(formatMoney(payAdjustment))}</span>
          <span>საბოლოო გამომუშავება: ${escapeHtml(formatMoney(courierPay))}</span>
        </div>
      </div>
    `;
  }).join("");
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
    <div class="history-list">
      ${renderCloseDayCourierStats(courierStats)}
    </div>
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
  closeDialog();
  await refreshPins();
  showToast(`${payload.archived} პინი გადავიდა ისტორიაში.`);
}
