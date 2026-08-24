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


function getCourierZoneIds(courier, zones = []) {
  const directZoneIds = Array.isArray(courier?.zoneIds) ? courier.zoneIds.map(normalizeZoneId).filter(Boolean) : [];
  const legacyZoneId = normalizeZoneId(courier?.zoneId || courier?.zoneCode || courier?.zone);
  const zoneName = normalizeZoneText(courier?.zoneName || "");
  const zoneByName = (zones || []).find((item) => normalizeZoneText(getZoneName(item)) === zoneName);
  return [...new Set([
    ...directZoneIds,
    legacyZoneId,
    zoneByName ? getZoneId(zoneByName) : "",
  ].filter(Boolean))];
}


function getCourierZoneId(courier, zones = []) {
  return getCourierZoneIds(courier, zones)[0] || "";
}


function getCourierZoneLabel(courier, zones = []) {
  const zoneIds = getCourierZoneIds(courier, zones);
  const names = zoneIds
    .map((zoneId) => getZoneName(getZoneById(zoneId, zones)) || getZoneName(getZoneById(zoneId, DEFAULT_ZONES)))
    .filter(Boolean);
  return names.join(", ") || courier?.zoneName || "მიუბმელი";
}


function normalizeZoneText(value) {
  return String(value || "").trim().toLowerCase();
}


function readLocalZoneAssignments() {
  if (typeof isStaticDeploy === "function" && isStaticDeploy()) return {};
  try {
    const parsed = typeof loadData === "function"
      ? loadData(CONFIG.zoneAssignmentsStorageKey) || {}
      : JSON.parse(localStorage.getItem(CONFIG.zoneAssignmentsStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}


function writeLocalZoneAssignments(assignments) {
  if (typeof isStaticDeploy === "function" && isStaticDeploy()) return;
  if (typeof saveData === "function") saveData(CONFIG.zoneAssignmentsStorageKey, assignments || {});
  else localStorage.setItem(CONFIG.zoneAssignmentsStorageKey, JSON.stringify(assignments || {}));
}


function applyLocalZoneAssignments(users = []) {
  const assignments = readLocalZoneAssignments();
  return (Array.isArray(users) ? users : []).map((user) => {
    const assignment = assignments[normalizeUsername(user.username)];
    if (!assignment || user.role !== "courier") return user;
    return {
      ...user,
      zoneIds: Array.isArray(assignment.zoneIds) ? assignment.zoneIds : (assignment.zoneId ? [assignment.zoneId] : []),
      zoneId: assignment.zoneId || (Array.isArray(assignment.zoneIds) ? assignment.zoneIds[0] : "") || "",
      zoneName: assignment.zoneName || "",
    };
  });
}


function saveLocalCourierZone(username, zoneBody) {
  const assignments = readLocalZoneAssignments();
  const key = normalizeUsername(username);
  const zoneIds = Array.isArray(zoneBody.zoneIds) ? zoneBody.zoneIds.filter(Boolean) : (zoneBody.zoneId ? [zoneBody.zoneId] : []);
  if (zoneIds.length) {
    assignments[key] = {
      username,
      zoneIds,
      zoneId: zoneIds[0],
      zoneName: zoneBody.zoneName || zoneIds.map((zoneId) => getZoneName(getZoneById(zoneId, DEFAULT_ZONES))).filter(Boolean).join(", "),
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
  const [couriers, zones] = await Promise.all([
    getCouriers().catch(() => []),
    getZones().catch(() => DEFAULT_ZONES),
  ]);
  const normalizedZoneId = normalizeZoneId(zoneId);
  const normalizedZoneName = normalizeZoneText(zoneName);
  const zoneCouriers = couriers.filter((courier) => {
    const courierZoneIds = getCourierZoneIds(courier, zones);
    const courierZoneName = normalizeZoneText(courier.zoneName || "");
    return (normalizedZoneId && courierZoneIds.includes(normalizedZoneId)) || (normalizedZoneName && courierZoneName === normalizedZoneName);
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
  const rows = zones.map((zone) => {
    const areas = getZoneAreas(zone);
    return `
      <tr>
        <td>${renderAppTableText(getZoneName(zone), getZoneId(zone))}</td>
        <td>${escapeHtml(areas.join(", ") || "უბნები არ არის მითითებული")}</td>
      </tr>
    `;
  });

  return renderAppListPanel({
    title: "ზონების სია",
    badges: [`ზონა: ${zones.length}`],
    headers: ["ზონა", "უბნები"],
    emptyMessage: "ზონა ჯერ არ არის დამატებული",
    rows,
  });
}


function renderZoneCourierRows(couriers, zones) {
  const rows = couriers.map((courier) => {
    const selectedZoneIds = new Set(getCourierZoneIds(courier, zones));
    const zoneOptions = zones.map((zone) => {
      const zoneId = getZoneId(zone);
      return `
        <label class="zone-checkbox-option">
          <input type="checkbox" value="${escapeAttr(zoneId)}" data-zone-courier="${escapeAttr(courier.username)}" ${selectedZoneIds.has(zoneId) ? "checked" : ""}>
          <span>${escapeHtml(getZoneName(zone))}</span>
        </label>
      `;
    }).join("");
    return `
      <tr>
        <td>${renderAppTableText([courier.firstName, courier.lastName].filter(Boolean).join(" ") || courier.username, courier.username)}</td>
        <td>${escapeHtml(courier.phone || "არ არის")}</td>
        <td>${escapeHtml(getCourierZoneLabel(courier, zones))}</td>
        <td><div class="zone-checkbox-grid" aria-label="${escapeAttr(userDisplayName(courier))} ზონები">${zoneOptions}</div></td>
        <td>
          <div class="row-actions">
            <button class="mini-button" type="button" data-action="saveCourierZone" data-value="${escapeAttr(courier.username)}">შენახვა</button>
            <button class="mini-button danger" type="button" data-action="removeCourierZone" data-value="${escapeAttr(courier.username)}">ზონების მოხსნა</button>
          </div>
        </td>
      </tr>
    `;
  });

  return `
    ${renderAppListPanel({
      title: "კურიერების ზონები",
      badges: [`კურიერი: ${couriers.length}`],
      headers: ["კურიერი", "ტელეფონი", "ამჟამინდელი ზონები", "ზონის არჩევა", ""],
      emptyMessage: "კურიერი ჯერ არ არის დამატებული",
      rows,
    })}
  `;
}


async function saveCourierZone(username) {
  const message = document.getElementById("zoneManagementMessage");
  const zones = await getZones();
  const selectedZones = [...document.querySelectorAll('input[type="checkbox"][data-zone-courier]:checked')]
    .filter((input) => input.dataset.zoneCourier === username)
    .map((input) => getZoneById(input.value, zones))
    .filter(Boolean);
  const zoneIds = selectedZones.map(getZoneId);
  const zoneName = selectedZones.map(getZoneName).join(", ");
  await updateCourierZone(username, { zoneIds, zoneId: zoneIds[0] || "", zoneName }, message);
}


async function removeCourierZone(username) {
  const message = document.getElementById("zoneManagementMessage");
  await updateCourierZone(username, { zoneIds: [], zoneId: "", zoneName: "" }, message);
}


async function updateCourierZone(username, zoneBody, message) {
  try {
    await saveCourierZoneRequest(username, zoneBody);
    const zoneCount = Array.isArray(zoneBody.zoneIds) ? zoneBody.zoneIds.length : (zoneBody.zoneId ? 1 : 0);
    showToast(zoneCount ? "კურიერს ზონები მიენიჭა." : "კურიერს ზონები მოეხსნა.");
    await refreshPins();
    await openZoneManagement();
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}


async function saveCourierZoneRequest(username, zoneBody) {
  if (!CONFIG.useUserZoneApi) {
    if (typeof isStaticDeploy === "function" && isStaticDeploy()) {
      return saveCourierZoneWithUserUpdate(username, zoneBody);
    }
    return saveLocalCourierZone(username, zoneBody);
  }

  try {
    const result = await api(`/api/users/${encodeURIComponent(username)}/zone`, { method: "PUT", body: zoneBody });
    if (!(typeof isStaticDeploy === "function" && isStaticDeploy())) saveLocalCourierZone(username, zoneBody);
    return result;
  } catch (error) {
    if (error.status !== 404) throw error;
    if (typeof isStaticDeploy === "function" && isStaticDeploy()) throw error;
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
