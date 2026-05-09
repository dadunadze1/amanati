"use strict";



function getDefaultTbilisiZones() {
  return [
    {
      id: "dighomi",
      code: "dighomi",
      name: "დიღმის ზონა",
      areas: ["დიდი დიღომი", "დიღმის მასივი", "სოფელი დიღომი", "დიღომი"],
      polygon: [
        [41.732, 44.690],
        [41.817, 44.700],
        [41.822, 44.786],
        [41.774, 44.804],
        [41.730, 44.780],
      ],
    },
    {
      id: "north",
      code: "north",
      name: "ჩრდილოეთის ზონა",
      areas: ["გლდანი", "მუხიანი", "თემქა", "ავჭალა", "ზღვისუბანი"],
      polygon: [
        [41.760, 44.790],
        [41.865, 44.765],
        [41.870, 44.930],
        [41.770, 44.930],
        [41.742, 44.850],
      ],
    },
    {
      id: "east",
      code: "east",
      name: "აღმოსავლეთის ზონა",
      areas: ["ისანი", "სამგორი", "ვარკეთილი", "ვაზისუბანი", "ლილო", "ორხევი", "აეროპორტის დასახლება", "ფონიჭალა"],
      polygon: [
        [41.612, 44.812],
        [41.725, 44.835],
        [41.773, 45.070],
        [41.640, 45.095],
        [41.575, 44.930],
      ],
    },
    {
      id: "center",
      code: "center",
      name: "ცენტრალური ზონა",
      areas: ["ვაკე", "საბურთალო", "ვერა", "მთაწმინდა", "სოლოლაკი", "ავლაბარი", "ორთაჭალა", "კრწანისი", "ბაგები", "წყნეთი", "კოჯორი"],
      polygon: [
        [41.612, 44.635],
        [41.732, 44.650],
        [41.742, 44.835],
        [41.680, 44.875],
        [41.585, 44.785],
      ],
    },
    {
      id: "west_south",
      code: "west_south",
      name: "დასავლეთ-სამხრეთის ზონა",
      areas: ["დიდუბე", "ნაძალადევი", "კუკია", "ჩუღურეთი"],
      polygon: [
        [41.700, 44.760],
        [41.770, 44.760],
        [41.772, 44.840],
        [41.710, 44.858],
        [41.682, 44.805],
      ],
    },
  ];
}


function normalizeZoneId(value) {
  return String(value || "").trim().toLowerCase();
}


function normalizeZones(zones = []) {
  const merged = new Map();
  DEFAULT_ZONES.forEach((zone) => merged.set(getZoneId(zone), normalizeZone(zone)));
  (Array.isArray(zones) ? zones : []).forEach((zone) => {
    const normalized = normalizeZone(zone);
    const existing = merged.get(normalized.id) || {};
    if (normalized.id) {
      merged.set(normalized.id, {
        ...existing,
        ...normalized,
        areas: normalized.areas.length ? normalized.areas : (existing.areas || []),
        keywords: Array.isArray(normalized.keywords) && normalized.keywords.length ? normalized.keywords : (existing.keywords || []),
      });
    }
  });
  return [...merged.values()];
}


function normalizeZone(zone = {}) {
  const id = normalizeZoneId(zone.id || zone.code || zone.zoneId || zone.slug || zone.name);
  return {
    ...zone,
    id,
    code: zone.code || id,
    name: zone.name || zone.label || zone.zoneName || id,
    areas: getZoneAreas(zone),
  };
}


function getZoneId(zone) {
  return normalizeZoneId(zone?.id || zone?.code || zone?.zoneId || zone?.slug || zone?.name);
}


function getZoneName(zone) {
  return zone?.name || zone?.label || zone?.zoneName || zone?.id || "";
}


function getZoneAreas(zone) {
  const areas = zone?.areas || zone?.districts || zone?.neighborhoods || zone?.includes || [];
  return Array.isArray(areas) ? areas.filter(Boolean) : [];
}


function getZoneById(zoneId, zones) {
  const normalizedZoneId = normalizeZoneId(zoneId);
  return (zones || []).find((zone) => getZoneId(zone) === normalizedZoneId) || null;
}


function getCourierZoneId(courier, zones = []) {
  const directZoneId = normalizeZoneId(courier?.zoneId || courier?.zoneCode || courier?.zone);
  if (directZoneId) return directZoneId;
  const zoneName = normalizeZoneText(courier?.zoneName || "");
  const zone = (zones || []).find((item) => normalizeZoneText(getZoneName(item)) === zoneName);
  return zone ? getZoneId(zone) : "";
}


function normalizeZoneText(value) {
  return String(value || "").trim().toLowerCase();
}


function readLocalZoneAssignments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG.zoneAssignmentsStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}


function writeLocalZoneAssignments(assignments) {
  localStorage.setItem(CONFIG.zoneAssignmentsStorageKey, JSON.stringify(assignments || {}));
}


function applyLocalZoneAssignments(users = []) {
  const assignments = readLocalZoneAssignments();
  return (Array.isArray(users) ? users : []).map((user) => {
    const assignment = assignments[normalizeUsername(user.username)];
    if (!assignment || user.role !== "courier") return user;
    return {
      ...user,
      zoneId: assignment.zoneId || "",
      zoneName: assignment.zoneName || "",
    };
  });
}


function saveLocalCourierZone(username, zoneBody) {
  const assignments = readLocalZoneAssignments();
  const key = normalizeUsername(username);
  if (zoneBody.zoneId) {
    assignments[key] = {
      username,
      zoneId: zoneBody.zoneId,
      zoneName: zoneBody.zoneName || getZoneName(getZoneById(zoneBody.zoneId, DEFAULT_ZONES)),
    };
  } else {
    delete assignments[key];
  }
  writeLocalZoneAssignments(assignments);
  return { user: { username, role: "courier", ...zoneBody } };
}


function coordsMatchZone(coords, zone) {
  if (!zone) return false;
  if (coordsWithinZoneBounds(coords, zone.bounds || zone.bbox || zone.boundingBox)) return true;
  if (Array.isArray(zone.polygon) && pointInPolygon(coords, zone.polygon)) return true;
  if (Array.isArray(zone.coordinates) && pointInPolygon(coords, zone.coordinates)) return true;
  return false;
}


async function detectZoneByCoords(coords) {
  const zones = await getZones();
  return zones.find((zone) => coordsMatchZone(coords, zone)) || null;
}


async function getCourierForZone(zoneId, zoneName) {
  const couriers = await getCouriers().catch(() => []);
  const normalizedZoneId = normalizeZoneId(zoneId);
  const normalizedZoneName = normalizeZoneText(zoneName);
  const zoneCouriers = couriers.filter((courier) => {
    const courierZoneId = normalizeZoneId(courier.zoneId || courier.zoneCode || courier.zone);
    const courierZoneName = normalizeZoneText(courier.zoneName || "");
    return (normalizedZoneId && courierZoneId === normalizedZoneId) || (normalizedZoneName && courierZoneName === normalizedZoneName);
  });
  if (!zoneCouriers.length) return null;
  return [...zoneCouriers].sort((a, b) => countActiveCourierPins(a.username) - countActiveCourierPins(b.username))[0];
}


function coordsWithinZoneBounds(coords, bounds) {
  if (!bounds) return false;
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  if (Array.isArray(bounds) && bounds.length >= 4) {
    const [south, west, north, east] = bounds.map(Number);
    return lat >= south && lat <= north && lng >= west && lng <= east;
  }

  const south = Number(bounds.south ?? bounds.minLat ?? bounds[0]);
  const west = Number(bounds.west ?? bounds.minLng ?? bounds.minLon ?? bounds[1]);
  const north = Number(bounds.north ?? bounds.maxLat ?? bounds[2]);
  const east = Number(bounds.east ?? bounds.maxLng ?? bounds.maxLon ?? bounds[3]);
  return [south, west, north, east].every(Number.isFinite) && lat >= south && lat <= north && lng >= west && lng <= east;
}


function pointInPolygon(point, polygon) {
  const normalizedPoint = normalizePolygonPoint(point);
  const lat = Number(normalizedPoint?.lat);
  const lng = Number(normalizedPoint?.lng);
  const points = polygon.map(normalizePolygonPoint).filter(Boolean);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || points.length < 3) return false;

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].lng;
    const yi = points[i].lat;
    const xj = points[j].lng;
    const yj = points[j].lat;
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}


function normalizePolygonPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const first = Number(point[0]);
    const second = Number(point[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    return Math.abs(first) > 43 && Math.abs(second) < 43
      ? { lat: second, lng: first }
      : { lat: first, lng: second };
  }
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.lon ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}


async function updatePendingZoneAssignment(coords) {
  state.pendingZone = null;
  state.pendingAutoAssignment = null;
  if (!coords || !state.isAdmin) return null;
  const assignment = await applyAutoAssignByZone({ lat: coords.lat, lng: coords.lng });
  state.pendingZone = { id: assignment.zoneId || "", name: assignment.zoneName || "ზონა არ მოიძებნა" };
  state.pendingAutoAssignment = {
    courierUsername: assignment.courierUsername || "",
    courierName: assignment.courierName || "",
    autoAssigned: assignment.autoAssigned,
  };
  return state.pendingZone;
}


async function applyAutoAssignByZone(parcelData) {
  const zone = await detectZoneByCoords(parcelData);
  const zoneId = zone ? getZoneId(zone) : "";
  const zoneName = zone ? getZoneName(zone) : "ზონა არ მოიძებნა";
  const courier = zone && !parcelData.courierUsername ? await getCourierForZone(zoneId, zoneName) : null;
  return {
    ...parcelData,
    zoneId,
    zoneName,
    courierUsername: parcelData.courierUsername || courier?.username || "",
    courierName: courier ? userDisplayName(courier) : "",
    autoAssigned: Boolean(courier && !parcelData.courierUsername),
  };
}


async function openZoneManagement() {
  const [zones, users] = await Promise.all([getZones(), getUsers()]);
  const couriers = users.filter((user) => user.role === "courier");
  const body = `
    <div class="zone-management-panel">
      <section class="zone-list-panel" aria-label="ზონების სია">
        ${renderZoneCards(zones)}
      </section>
      <section class="zone-courier-panel" aria-label="კურიერზე ზონის მინიჭება">
        <div class="zone-section-title">
          <strong>კურიერზე ზონის მინიჭება</strong>
          <span>პინის ავტომატური მიბმა ამ ზონით ხდება.</span>
        </div>
        ${renderZoneCourierRows(couriers, zones)}
      </section>
      <p class="form-message" id="zoneManagementMessage" role="alert"></p>
    </div>
  `;
  showDialog("ზონები", body, [
    { label: "დახურვა", variant: "secondary", action: closeDialog },
  ]);
  els.dialogModal.classList.add("zone-management-dialog");
}


function renderZoneCards(zones) {
  return zones.map((zone) => {
    const areas = getZoneAreas(zone);
    return `
      <article class="zone-card">
        <div>
          <strong>${escapeHtml(getZoneName(zone))}</strong>
          <small>${escapeHtml(getZoneId(zone))}</small>
        </div>
        <p>${areas.map(escapeHtml).join(", ") || "უბნები არ არის მითითებული"}</p>
      </article>
    `;
  }).join("");
}


function renderZoneCourierRows(couriers, zones) {
  if (!couriers.length) return `<div class="history-empty history-empty-card">კურიერი ჯერ არ არის დამატებული</div>`;
  return `
    <div class="zone-courier-list">
      ${couriers.map((courier) => {
        const selectedZoneId = getCourierZoneId(courier, zones);
        const zoneOptions = zones.map((zone) => {
          const zoneId = getZoneId(zone);
          return `<option value="${escapeAttr(zoneId)}" ${zoneId === selectedZoneId ? "selected" : ""}>${escapeHtml(getZoneName(zone))}</option>`;
        }).join("");
        return `
          <article class="zone-courier-row">
            <span class="zone-courier-main">
              <strong>${escapeHtml([courier.firstName, courier.lastName].filter(Boolean).join(" ") || courier.username)}</strong>
              <small>username: ${escapeHtml(courier.username)}</small>
              <small>ტელეფონი: ${escapeHtml(courier.phone || "არ არის")}</small>
              <small>ამჟამინდელი ზონა: ${escapeHtml(getZoneName(getZoneById(selectedZoneId, zones)) || courier.zoneName || "მიუბმელი")}</small>
            </span>
            <div class="zone-courier-controls">
              <select id="zoneSelect-${escapeAttr(courier.username)}" data-zone-courier="${escapeAttr(courier.username)}" aria-label="${escapeAttr(userDisplayName(courier))} ზონა">
                <option value="">მიუბმელი</option>
                ${zoneOptions}
              </select>
              <button class="button primary" type="button" data-action="saveCourierZone" data-value="${escapeAttr(courier.username)}">შენახვა</button>
              <button class="button danger" type="button" data-action="removeCourierZone" data-value="${escapeAttr(courier.username)}">ზონის მოხსნა</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}


async function saveCourierZone(username) {
  const message = document.getElementById("zoneManagementMessage");
  const zones = await getZones();
  const select = [...document.querySelectorAll("[data-zone-courier]")].find((item) => item.dataset.zoneCourier === username);
  const zone = getZoneById(select?.value || "", zones);
  if (!zone) {
    if (message) message.textContent = "აირჩიეთ ზონა.";
    return;
  }
  await updateCourierZone(username, { zoneId: getZoneId(zone), zoneName: getZoneName(zone) }, message);
}


async function removeCourierZone(username) {
  const message = document.getElementById("zoneManagementMessage");
  await updateCourierZone(username, { zoneId: "", zoneName: "" }, message);
}


async function updateCourierZone(username, zoneBody, message) {
  try {
    await saveCourierZoneRequest(username, zoneBody);
    showToast(zoneBody.zoneId ? "კურიერს ზონა მიენიჭა." : "კურიერს ზონა მოეხსნა.");
    await refreshPins();
    await openZoneManagement();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}


async function saveCourierZoneRequest(username, zoneBody) {
  if (!CONFIG.useUserZoneApi) {
    return saveLocalCourierZone(username, zoneBody);
  }

  try {
    const result = await api(`/api/users/${encodeURIComponent(username)}/zone`, { method: "PUT", body: zoneBody });
    saveLocalCourierZone(username, zoneBody);
    return result;
  } catch (error) {
    if (error.status !== 404) throw error;
    return saveLocalCourierZone(username, zoneBody);
  }
}


async function saveCourierZoneWithUserUpdate(username, zoneBody) {
  const user = (await getUsers()).find((item) => normalizeUsername(item.username) === normalizeUsername(username));
  return api(`/api/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    body: {
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      phone: user?.phone || "",
      bankDetails: user?.bankDetails || "",
      ...zoneBody,
    },
  });
}
