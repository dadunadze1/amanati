"use strict";



function partnerName(partner) {
  return partner?.companyName || partner?.contactPerson || partner?.username || "";
}


function orderPartnerName(parcel) {
  return parcel?.partnerName || "Private";
}


function partnerCodPending(orders) {
  return orders
    .filter((order) => order.status !== "delivered" && getPaymentAmount(order) > 0)
    .reduce((sum, order) => sum + getPaymentAmount(order), 0);
}


function partnerCodCollected(orders) {
  return orders
    .filter((order) => order.status === "delivered")
    .reduce((sum, order) => sum + getPaymentAmount(order), 0);
}


async function renderPartnerDashboard(pins = state.activePins) {
  if (!els.partnerDashboard) return;
  if (!state.isPartner || !state.currentUser) {
    els.partnerDashboard.hidden = true;
    els.partnerDashboard.textContent = "";
    els.appShell?.classList.remove("is-partner-dashboard");
    return;
  }

  const orders = Array.isArray(pins) ? pins : await getPins("");
  els.appShell?.classList.add("is-partner-dashboard");
  els.partnerDashboard.hidden = false;

  const activeOrders = orders.filter((order) => order.status !== "delivered" && order.status !== "failed");
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const failedOrders = orders.filter((order) => order.status === "failed");
  const recentOrders = [...orders]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 8);

  els.partnerDashboard.innerHTML = `
    <div class="partner-dashboard-head">
      <div>
        <span>Partner</span>
        <strong>${escapeHtml(state.currentUserProfile?.companyName || state.currentUserProfile?.contactPerson || state.currentUser)}</strong>
      </div>
      <button class="button primary" type="button" data-action="partnerNewOrder">ახალი შეკვეთა</button>
    </div>
    <div class="partner-stat-grid">
      ${renderPartnerStat("Total Orders", orders.length)}
      ${renderPartnerStat("Active Orders", activeOrders.length)}
      ${renderPartnerStat("Delivered Orders", deliveredOrders.length)}
      ${renderPartnerStat("Failed Orders", failedOrders.length)}
      ${renderPartnerStat("COD/Cash Pending", formatMoney(partnerCodPending(orders)))}
      ${renderPartnerStat("Total COD Collected", formatMoney(partnerCodCollected(orders)))}
    </div>
    <section class="partner-panel">
      <div class="partner-panel-head">
        <h2>Recent orders</h2>
        <button class="button secondary" type="button" data-action="partnerOrders">ყველა</button>
      </div>
      ${renderPartnerOrderTable(recentOrders)}
    </section>
  `;
}


function renderPartnerStat(label, value) {
  return `
    <article class="partner-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}


function renderPartnerOrderTable(orders, options = {}) {
  if (!orders.length) return `<div class="history-empty history-empty-card">შეკვეთა ჯერ არ არის</div>`;
  const includePartner = Boolean(options.includePartner);
  const includeActions = Boolean(options.includeActions);
  return `
    <div class="partner-table-wrap">
      <table class="partner-order-table">
        <thead>
          <tr>
            <th>Order ID</th>
            ${includePartner ? "<th>Partner</th>" : ""}
            <th>Customer Name</th>
            <th>Address</th>
            <th>Courier</th>
            <th>Status</th>
            ${includePartner ? "<th>Location</th>" : ""}
            <th>COD Amount</th>
            <th>Date</th>
            ${includeActions ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${orders.map((order) => `
            <tr>
              <td>${escapeHtml(String(order.id || "").slice(0, 8))}</td>
              ${includePartner ? `<td><span class="partner-tag">${escapeHtml(orderPartnerName(order))}</span></td>` : ""}
              <td>${escapeHtml(order.fullName || "")}</td>
              <td>${escapeHtml(order.address || "")}</td>
              <td>${escapeHtml(parcelCourierDisplayName(order))}</td>
              <td><span class="history-status status-${escapeAttr(order.status || "pending")}">${escapeHtml(getPartnerOrderStatusLabel(order))}</span></td>
              ${includePartner ? `<td><span class="partner-tag location-${escapeAttr(order.locationAccuracy || "missing")}">${escapeHtml(getOrderLocationLabel(order))}</span></td>` : ""}
              <td>${escapeHtml(formatMoney(getPaymentAmount(order)))}</td>
              <td>${escapeHtml(formatOptionalDateTime(order.createdAt))}</td>
              ${includeActions ? `<td><button class="mini-button" type="button" data-action="assignPartnerOrder" data-value="${escapeAttr(order.id)}">${hasOrderLocation(order) ? "კურიერი" : "Set Pin"}</button></td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}


function hasOrderLocation(order) {
  return Number.isFinite(Number(order?.lat)) && Number.isFinite(Number(order?.lng));
}


function getOrderLocationLabel(order) {
  if (!hasOrderLocation(order) || order.locationAccuracy === "missing") return "Location needs admin correction";
  if (order.locationAccuracy === "confirmed") return "Confirmed";
  return "Approximate";
}


async function openPartnerOrdersDialog() {
  const orders = await getPins("");
  showDialog("ჩემი შეკვეთები", renderPartnerOrderTable(orders), [
    { label: "ახალი", variant: "primary", action: openPartnerNewOrderDialog },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


function openPartnerNewOrderDialog() {
  const body = `
    <form id="partnerOrderForm" class="partner-form">
      <label for="partnerOrderCity">City</label>
      <input id="partnerOrderCity" type="text" autocomplete="address-level2" required>
      <label for="partnerOrderDistrict">District/Area</label>
      <input id="partnerOrderDistrict" type="text" autocomplete="address-level3" required>
      <label for="partnerOrderAddress">Street Address</label>
      <input id="partnerOrderAddress" type="text" autocomplete="street-address" required>
      <div class="partner-form-grid">
        <label>Building <input id="partnerOrderBuilding" type="text"></label>
        <label>Floor <input id="partnerOrderFloor" type="text"></label>
        <label>Apartment <input id="partnerOrderApartment" type="text"></label>
      </div>
      <label for="partnerOrderName">Customer Full Name</label>
      <input id="partnerOrderName" type="text" autocomplete="name" required>
      <label for="partnerOrderPhone">Mobile Number</label>
      <input id="partnerOrderPhone" type="tel" autocomplete="tel" required>
      <label for="partnerOrderCod">COD Amount</label>
      <input id="partnerOrderCod" type="text" inputmode="decimal" autocomplete="off" value="0">
      <label for="partnerOrderComment">Comment/Notes</label>
      <textarea id="partnerOrderComment" rows="3"></textarea>
      <p class="form-message" id="partnerOrderMessage" role="alert"></p>
    </form>
  `;
  showDialog("ახალი შეკვეთა", body, [
    { label: "გაგზავნა", variant: "primary", action: savePartnerOrder },
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
}


async function savePartnerOrder() {
  const message = document.getElementById("partnerOrderMessage");
  const city = document.getElementById("partnerOrderCity")?.value.trim();
  const district = document.getElementById("partnerOrderDistrict")?.value.trim();
  const street = document.getElementById("partnerOrderAddress")?.value.trim();
  const fullName = document.getElementById("partnerOrderName")?.value.trim();
  const phone = document.getElementById("partnerOrderPhone")?.value.trim();
  const paymentAmount = parsePaymentAmount(document.getElementById("partnerOrderCod")?.value);
  if (!city || !district || !street || !fullName || !phone) {
    if (message) message.textContent = STRINGS.emptyFields;
    return;
  }
  if (!Number.isFinite(paymentAmount) || paymentAmount < 0) {
    if (message) message.textContent = "შეიყვანეთ სწორი თანხა.";
    return;
  }

  const building = document.getElementById("partnerOrderBuilding")?.value.trim();
  const floor = document.getElementById("partnerOrderFloor")?.value.trim();
  const apartment = document.getElementById("partnerOrderApartment")?.value.trim();
  const comment = document.getElementById("partnerOrderComment")?.value.trim();
  const address = [city, district, street, building ? `Building ${building}` : "", floor ? `Floor ${floor}` : "", apartment ? `Apt ${apartment}` : ""]
    .filter(Boolean)
    .join(", ");

  try {
    await api("/api/parcels", {
      method: "POST",
      body: { city, district, streetAddress: street, address, fullAddress: address, building, floor, apartment, fullName, phone, comment, paymentAmount },
    });
    closeDialog();
    await refreshPins();
    showToast("შეკვეთა გაიგზავნა ადმინთან.");
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}


async function openPartnerManagement() {
  const partners = await getPartners();
  const body = `
    <div class="partner-panel-head">
      <h2>Partners</h2>
      <button class="button primary" type="button" data-action="createPartner">დამატება</button>
    </div>
    <div class="finance-card-list admin-user-list">
      ${partners.map(renderPartnerCard).join("") || "<div class=\"history-empty history-empty-card\">პარტნიორი ჯერ არ არის</div>"}
    </div>
  `;
  showDialog("Partners", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


function renderPartnerCard(partner) {
  const active = partner.status === "active";
  return `
    <article class="finance-card finance-static-card admin-user-card">
      <span class="admin-user-name">${escapeHtml(partnerName(partner))}</span>
      <small>login: ${escapeHtml(partner.username)}</small>
      <small>კონტაქტი: ${escapeHtml(partner.contactPerson || "არ არის")}</small>
      <small>ტელეფონი: ${escapeHtml(partner.phone || "არ არის")}</small>
      <small>შექმნა: ${escapeHtml(formatOptionalDateTime(partner.createdAt))}</small>
      <small>სტატუსი: ${active ? "active" : "inactive"}</small>
      <div class="row-actions admin-user-actions">
        <button class="mini-button" type="button" data-action="editPartner" data-value="${escapeAttr(partner.username)}">რედაქტირება</button>
        <button class="mini-button ${active ? "danger" : ""}" type="button" data-action="togglePartnerStatus" data-value="${escapeAttr(partner.username)}">${active ? "დეაქტივაცია" : "აქტივაცია"}</button>
      </div>
    </article>
  `;
}


function openPartnerCreateDialog() {
  openPartnerEditDialog("");
}


async function openPartnerEditDialog(username) {
  const partner = username ? (await getPartners()).find((item) => item.username === username) : {};
  if (username && !partner) return;
  const body = renderPartnerForm(partner);
  showDialog(username ? "Partner edit" : "New partner", body, [
    { label: "შენახვა", variant: "primary", action: () => savePartner(username) },
    { label: "უკან", variant: "secondary", action: openPartnerManagement },
  ]);
}


function renderPartnerForm(partner = {}) {
  return `
    <label for="partnerCompanyName">Company/business name</label>
    <input id="partnerCompanyName" type="text" value="${escapeAttr(partner.companyName || "")}">
    <label for="partnerContactPerson">Contact person</label>
    <input id="partnerContactPerson" type="text" value="${escapeAttr(partner.contactPerson || "")}">
    <label for="partnerPhone">Phone number</label>
    <input id="partnerPhone" type="tel" value="${escapeAttr(partner.phone || "")}">
    <label for="partnerUsername">Email/login</label>
    <input id="partnerUsername" type="email" autocomplete="username" value="${escapeAttr(partner.username || "")}" ${partner.username ? "disabled" : ""}>
    <label for="partnerPassword">Password</label>
    <input id="partnerPassword" type="password" autocomplete="new-password" placeholder="${partner.username ? "ცარიელი დატოვე თუ არ იცვლება" : ""}">
    <label for="partnerStatus">Status</label>
    <select id="partnerStatus">
      <option value="active" ${partner.status !== "inactive" ? "selected" : ""}>Active</option>
      <option value="inactive" ${partner.status === "inactive" ? "selected" : ""}>Inactive</option>
    </select>
    <p class="form-message" id="partnerFormMessage" role="alert"></p>
  `;
}


async function savePartner(username) {
  const message = document.getElementById("partnerFormMessage");
  const body = {
    companyName: document.getElementById("partnerCompanyName")?.value.trim(),
    contactPerson: document.getElementById("partnerContactPerson")?.value.trim(),
    phone: document.getElementById("partnerPhone")?.value.trim(),
    username: document.getElementById("partnerUsername")?.value.trim(),
    password: document.getElementById("partnerPassword")?.value.trim(),
    status: document.getElementById("partnerStatus")?.value || "active",
  };
  if (!body.companyName || !body.contactPerson || !body.phone || (!username && (!body.username || !body.password))) {
    if (message) message.textContent = STRINGS.emptyFields;
    return;
  }
  try {
    if (username) {
      await api(`/api/partners/${encodeURIComponent(username)}`, { method: "PUT", body });
    } else {
      await api("/api/partners", { method: "POST", body });
    }
    await openPartnerManagement();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}


async function togglePartnerStatus(username) {
  const partner = (await getPartners()).find((item) => item.username === username);
  if (!partner) return;
  await api(`/api/partners/${encodeURIComponent(username)}`, {
    method: "PUT",
    body: { ...partner, status: partner.status === "active" ? "inactive" : "active" },
  });
  await openPartnerManagement();
}


async function openAdminPartnerOrders(partnerId = "") {
  const partners = await getPartners();
  const query = partnerId ? `?partnerId=${encodeURIComponent(partnerId)}` : "";
  const orders = (await api(`/api/parcels${query}`)).parcels.filter((order) => order.partnerId);
  const partnerOptions = partners.map((partner) => `<option value="${escapeAttr(partner.id)}" ${partner.id === partnerId ? "selected" : ""}>${escapeHtml(partnerName(partner))}</option>`).join("");
  const body = `
    <div class="partner-panel-head">
      <h2>Partner orders</h2>
      <div class="partner-filter-row">
        <select id="adminPartnerOrdersFilter">
          <option value="">ყველა პარტნიორი</option>
          ${partnerOptions}
        </select>
        <button class="button secondary" type="button" data-action="adminPartnerOrdersFilter">ფილტრი</button>
      </div>
    </div>
    ${renderPartnerOrderTable(orders, { includePartner: true, includeActions: true })}
  `;
  showDialog("Partner orders", body, [{ label: "დახურვა", variant: "secondary", action: closeDialog }]);
}


async function openPartnerOrderAssignDialog(parcelId) {
  const orders = state.activePins.length ? state.activePins : (await api("/api/parcels")).parcels;
  const order = orders.find((item) => item.id === parcelId);
  if (order && !hasOrderLocation(order)) {
    showDialog("Location required", `<p>Location not found. Please set pin manually before assigning courier.</p><p>${escapeHtml(order.fullAddress || order.address || "")}</p>`, [
      { label: "Set Pin", variant: "primary", action: () => { closeDialog(); showSelectedParcelCard(parcelId, { focus: true }); startParcelLocationEdit(parcelId); } },
      { label: "Back", variant: "secondary", action: openAdminPartnerOrders },
    ]);
    return;
  }
  const couriers = await getCouriers();
  const courierOptions = couriers.map((courier) => `<option value="${escapeAttr(courier.username)}">${escapeHtml(userDisplayName(courier))}</option>`).join("");
  const body = `
    <label for="partnerOrderCourier">კურიერი</label>
    <select id="partnerOrderCourier">${courierOptions}</select>
    <p id="partnerOrderAssignMessage" class="form-message" role="alert"></p>
  `;
  showDialog("კურიერის მიბმა", body, [
    { label: "მიბმა", variant: "primary", action: () => savePartnerOrderAssign(parcelId) },
    { label: "უკან", variant: "secondary", action: openAdminPartnerOrders },
  ]);
}


async function savePartnerOrderAssign(parcelId) {
  const courierUsername = document.getElementById("partnerOrderCourier")?.value;
  const message = document.getElementById("partnerOrderAssignMessage");
  if (!courierUsername) {
    if (message) message.textContent = "აირჩიეთ კურიერი.";
    return;
  }
  try {
    await api("/api/parcels/assign", { method: "PATCH", body: { parcelIds: [parcelId], courierUsername } });
    showToast("კურიერი მიება შეკვეთას.");
    await openAdminPartnerOrders();
    await refreshPins();
  } catch (error) {
    if (message) message.textContent = error.message || STRINGS.serverFailed;
  }
}
