import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const initialPort = Number(process.env.PORT || 5173);
let currentPort = initialPort;
const host = "127.0.0.1";
const backendRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(backendRoot, "..");
const frontendRoot = resolve(projectRoot, "frontend");
const dbFile = process.env.DB_FILE ? resolve(process.env.DB_FILE) : resolve(backendRoot, "data", "delivery-db.json");
const sessions = new Map();

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const emptyDb = () => ({
  users: [],
  parcels: [],
});

const FINANCE = {
  deliveryTotalPrice: 6,
  courierDeliveryPay: 3.5,
  adminDeliveryProfit: 2.5,
};

// Zone configuration lives here so future boundary changes are one small edit.
// Polygon points are [lat, lng] and are checked with a standard point-in-polygon test.
const TBILISI_ZONES = {
  dighomi: {
    name: "დიღმის ზონა",
    districts: ["დიდი დიღომი", "დიღმის მასივი", "სოფელი დიღომი", "დიღომი"],
    polygon: [
      [41.732, 44.690],
      [41.817, 44.700],
      [41.822, 44.786],
      [41.774, 44.804],
      [41.730, 44.780],
    ],
  },
  north: {
    name: "ჩრდილოეთის ზონა",
    districts: ["გლდანი", "მუხიანი", "თემქა", "ავჭალა", "ზღვისუბანი"],
    polygon: [
      [41.760, 44.790],
      [41.865, 44.765],
      [41.870, 44.930],
      [41.770, 44.930],
      [41.742, 44.850],
    ],
  },
  east: {
    name: "აღმოსავლეთის ზონა",
    districts: ["ისანი", "სამგორი", "ვარკეთილი", "ვაზისუბანი", "ლილო", "ორხევი", "აეროპორტის დასახლება", "ფონიჭალა"],
    polygon: [
      [41.612, 44.812],
      [41.725, 44.835],
      [41.773, 45.070],
      [41.640, 45.095],
      [41.575, 44.930],
    ],
  },
  center: {
    name: "ცენტრალური ზონა",
    districts: ["ვაკე", "საბურთალო", "ვერა", "მთაწმინდა", "სოლოლაკი", "ავლაბარი", "ორთაჭალა", "კრწანისი", "ბაგები", "წყნეთი", "კოჯორი"],
    polygon: [
      [41.612, 44.635],
      [41.732, 44.650],
      [41.742, 44.835],
      [41.680, 44.875],
      [41.585, 44.785],
    ],
  },
  west_south: {
    name: "დასავლეთ-სამხრეთის ზონა",
    districts: ["დიდუბე", "ნაძალადევი", "კუკია", "ჩუღურეთი"],
    polygon: [
      [41.700, 44.760],
      [41.770, 44.760],
      [41.772, 44.840],
      [41.710, 44.858],
      [41.682, 44.805],
    ],
  },
};

async function readDb() {
  try {
    return { ...emptyDb(), ...JSON.parse(await readFile(dbFile, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeDb(emptyDb());
    return emptyDb();
  }
}

async function writeDb(db) {
  await mkdir(dirname(dbFile), { recursive: true });
  await writeFile(dbFile, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash).split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const hashedInput = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const stored = Buffer.from(hash, "hex");
  return hashedInput.length === stored.length && timingSafeEqual(hashedInput, stored);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function cleanUsername(username) {
  return String(username || "").trim();
}

function publicUser(user) {
  const zoneId = String(user.zoneId || "");
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    phone: user.phone || "",
    bankDetails: user.bankDetails || "",
    zoneId,
    zoneName: getZoneName(zoneId),
    createdAt: user.createdAt,
    requestedAt: user.requestedAt,
    approvedAt: user.approvedAt,
  };
}

function publicParcel(db, parcel) {
  const courier = parcel.courierUsername ? findUser(db, parcel.courierUsername) : null;
  const paymentAmount = getParcelPaymentAmount(parcel);
  const isDelivered = parcel.status === "delivered";
  return {
    ...parcel,
    paymentAmount,
    cashAmount: paymentAmount,
    deliveryTotalPrice: isDelivered ? storedMoney(parcel.deliveryTotalPrice) || FINANCE.deliveryTotalPrice : storedMoney(parcel.deliveryTotalPrice),
    courierPay: isDelivered ? storedMoney(parcel.courierPay) || FINANCE.courierDeliveryPay : storedMoney(parcel.courierPay),
    adminProfit: isDelivered ? storedMoney(parcel.adminProfit) || FINANCE.adminDeliveryProfit : storedMoney(parcel.adminProfit),
    zoneName: parcel.zoneName || getZoneName(parcel.zoneId),
    autoAssigned: Boolean(parcel.autoAssigned),
    deliveredAt: parcel.deliveredAt || (parcel.status === "delivered" ? parcel.completedAt || "" : ""),
    failedAt: parcel.failedAt || (parcel.status === "failed" ? parcel.completedAt || "" : ""),
    updatedAt: parcel.updatedAt || parcel.completedAt || parcel.assignedAt || parcel.createdAt || "",
    courier: courier ? publicUser(courier) : null,
  };
}

function findUser(db, username) {
  const normalized = normalizeUsername(username);
  return db.users.find((user) => normalizeUsername(user.username) === normalized);
}

function hasAdmin(db) {
  return db.users.some((user) => user.role === "admin" && user.status === "active");
}

function cleanRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "courier"].includes(value)) return value;
  throw httpError(400, "როლი უნდა იყოს ადმინი ან კურიერი.");
}

function cleanUserProfile(body) {
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    phone: String(body.phone || "").trim(),
    bankDetails: String(body.bankDetails || "").trim(),
  };
}

function isCompletedParcel(parcel) {
  return parcel.status === "delivered";
}

function getZoneName(zoneId) {
  return TBILISI_ZONES[zoneId]?.name || "";
}

function publicZone(db, zoneId, zone) {
  return {
    id: zoneId,
    name: zone.name,
    districts: zone.districts,
    polygon: zone.polygon,
    couriers: db.users
      .filter((user) => user.role === "courier" && user.status === "active" && user.zoneId === zoneId)
      .map(publicUser),
  };
}

function detectTbilisiZone(coords) {
  const point = { lat: Number(coords?.lat), lng: Number(coords?.lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const match = Object.entries(TBILISI_ZONES).find(([, zone]) => isPointInPolygon(point, zone.polygon));
  if (!match) return null;
  const [id, zone] = match;
  return { id, name: zone.name };
}

function isPointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const crossesLat = (latI > point.lat) !== (latJ > point.lat);
    const intersectLng = ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI || Number.EPSILON) + lngI;
    if (crossesLat && point.lng < intersectLng) inside = !inside;
  }
  return inside;
}

function getActiveParcelCount(db, username) {
  const normalized = normalizeUsername(username);
  return db.parcels.filter((parcel) => (
    !parcel.archivedAt
    && !isCompletedParcel(parcel)
    && normalizeUsername(parcel.courierUsername) === normalized
  )).length;
}

function findLeastBusyCourierForZone(db, zoneId) {
  const couriers = db.users.filter((user) => (
    user.role === "courier"
    && user.status === "active"
    && user.zoneId === zoneId
  ));
  return couriers
    .map((courier) => ({ courier, activeCount: getActiveParcelCount(db, courier.username) }))
    .sort((a, b) => a.activeCount - b.activeCount || a.courier.username.localeCompare(b.courier.username, "ka"))[0]?.courier || null;
}

function cleanZoneId(zoneId) {
  const value = String(zoneId || "").trim();
  if (!value) return "";
  if (!TBILISI_ZONES[value]) throw httpError(400, "ზონა ვერ მოიძებნა.");
  return value;
}

function buildNominatimUrl(endpoint, params) {
  const url = new URL(endpoint, "https://nominatim.openstreetmap.org");
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

async function fetchNominatimJson(endpoint, params, fallback) {
  try {
    const upstream = await fetch(buildNominatimUrl(endpoint, params), {
      headers: {
        Accept: "application/json",
        "User-Agent": "DeliveryCompanyDispatcher/1.0 (local development)",
      },
    });
    if (!upstream.ok) return fallback;
    return upstream.json();
  } catch {
    return fallback;
  }
}

function parcelSearchHaystack(db, parcel) {
  const courier = parcel.courierUsername ? findUser(db, parcel.courierUsername) : null;
  const values = [
    parcel.id,
    parcel.fullName,
    parcel.phone,
    parcel.address,
    parcel.status,
    parcel.status === "delivered" ? "ჩაბარდა" : "",
    parcel.status === "failed" ? "არ ჩაბარდა" : "",
    parcel.status === "pending" ? "პროცესშია" : "",
    parcel.courierUsername,
    courier?.firstName,
    courier?.lastName,
    courier?.phone,
    parcel.zoneId,
    parcel.zoneName || getZoneName(parcel.zoneId),
    parcel.autoAssigned ? "ავტომატურად" : "ხელით",
    parcel.createdAt,
    parcel.assignedAt,
    parcel.completedAt,
    parcel.deliveredAt,
    parcel.failedAt,
    parcel.updatedAt,
    parcel.archivedAt,
    toDateKey(parcel.createdAt),
    toDateKey(parcel.assignedAt),
    toDateKey(parcel.completedAt),
    toDateKey(parcel.deliveredAt),
    toDateKey(parcel.failedAt),
    toDateKey(parcel.archivedAt),
  ];
  return values.filter(Boolean).join(" ").toLowerCase();
}

function toDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function distanceInMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = degreesToRadians(Number(b.lat) - Number(a.lat));
  const dLng = degreesToRadians(Number(b.lng) - Number(a.lng));
  const lat1 = degreesToRadians(Number(a.lat));
  const lat2 = degreesToRadians(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function createToken(user) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username: user.username, role: user.role, createdAt: Date.now() });
  return token;
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw httpError(413, "მოთხოვნის მოცულობა ძალიან დიდია.");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "მოთხოვნის ფორმატი არასწორია.");
  }
}

function getSession(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? sessions.get(token) : null;
  return session ? { ...session, token } : null;
}

function requireSession(request) {
  const session = getSession(request);
  if (!session) throw httpError(401, "სისტემაში შესვლა აუცილებელია.");
  return session;
}

function requireAdmin(request) {
  const session = requireSession(request);
  if (session.role !== "admin") throw httpError(403, "საჭიროა ადმინის უფლება.");
  return session;
}

function canAccessCourier(session, username) {
  return session.role === "admin" || normalizeUsername(session.username) === normalizeUsername(username);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function cleanPaymentAmount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const normalized = String(value).trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "თანხა უნდა იყოს ნული ან მეტი.");
  return Math.round(amount * 100) / 100;
}

function storedMoney(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function getParcelPaymentAmount(parcel) {
  return storedMoney(parcel?.paymentAmount ?? parcel?.cashAmount ?? parcel?.payment ?? parcel?.amount ?? parcel?.price ?? parcel?.codAmount);
}

function applyDeliveredFinance(parcel) {
  if (!parcel || parcel.status !== "delivered") return;
  const paymentAmount = getParcelPaymentAmount(parcel);
  parcel.paymentAmount = paymentAmount;
  parcel.cashAmount = paymentAmount;
  parcel.deliveryTotalPrice = storedMoney(parcel.deliveryTotalPrice) || FINANCE.deliveryTotalPrice;
  parcel.courierPay = storedMoney(parcel.courierPay) || FINANCE.courierDeliveryPay;
  parcel.adminProfit = storedMoney(parcel.adminProfit) || FINANCE.adminDeliveryProfit;
}

function isCoordinateLabel(value) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(String(value || "").trim());
}

function hasHouseNumber(value) {
  return /\d/.test(String(value || ""));
}

async function handleApi(request, response, url) {
  const db = await readDb();
  const method = request.method || "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/bootstrap") {
    sendJson(response, 200, { hasAdmin: hasAdmin(db) });
    return;
  }

  if (method === "POST" && path === "/api/setup-admin") {
    if (hasAdmin(db)) throw httpError(409, "ადმინის ანგარიში უკვე არსებობს.");
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    if (!username || !password) throw httpError(400, "ლოგინი და პაროლი აუცილებელია.");

    const now = new Date().toISOString();
    const profile = cleanUserProfile(body);
    const user = {
      id: randomBytes(12).toString("hex"),
      username,
      role: "admin",
      status: "active",
      passwordHash: hashPassword(password),
      ...profile,
      createdAt: now,
    };
    db.users.push(user);
    await writeDb(db);
    const token = createToken(user);
    sendJson(response, 201, { token, user: publicUser(user) });
    return;
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJsonBody(request);
    const user = findUser(db, body.username);
    if (!user || user.status !== "active" || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      throw httpError(401, "ლოგინი ან პაროლი არასწორია.");
    }
    const token = createToken(user);
    sendJson(response, 200, { token, user: publicUser(user) });
    return;
  }

  if (method === "POST" && path === "/api/logout") {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/register") {
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username);
    const password = String(body.password || "").trim();
    const profile = cleanUserProfile(body);
    if (!username || !password || !profile.firstName || !profile.lastName || !profile.phone) throw httpError(400, "შეავსეთ ყველა ველი.");
    if (findUser(db, username)) throw httpError(409, "ეს ლოგინი უკვე არსებობს.");

    const now = new Date().toISOString();
    db.users.push({
      id: randomBytes(12).toString("hex"),
      username,
      role: "courier",
      status: "pending",
      passwordHash: hashPassword(password),
      ...profile,
      requestedAt: now,
      createdAt: now,
    });
    await writeDb(db);
    sendJson(response, 201, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/pending") {
    requireAdmin(request);
    sendJson(response, 200, {
      pending: db.users.filter((user) => user.role === "courier" && user.status === "pending").map(publicUser),
    });
    return;
  }

  const pendingMatch = path.match(/^\/api\/pending\/([^/]+)$/);
  if (pendingMatch && method === "POST") {
    requireAdmin(request);
    const username = decodeURIComponent(pendingMatch[1]);
    const user = findUser(db, username);
    if (!user || user.role !== "courier" || user.status !== "pending") throw httpError(404, "მოთხოვნა ვერ მოიძებნა.");
    user.status = "active";
    user.approvedAt = new Date().toISOString();
    await writeDb(db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (pendingMatch && method === "DELETE") {
    requireAdmin(request);
    const username = decodeURIComponent(pendingMatch[1]);
    const before = db.users.length;
    db.users = db.users.filter((user) => !(normalizeUsername(user.username) === normalizeUsername(username) && user.role === "courier" && user.status === "pending"));
    if (db.users.length === before) throw httpError(404, "მოთხოვნა ვერ მოიძებნა.");
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/couriers") {
    requireSession(request);
    sendJson(response, 200, {
      couriers: db.users.filter((user) => user.role === "courier" && user.status === "active").map(publicUser),
    });
    return;
  }

  if (method === "GET" && path === "/api/zones") {
    requireAdmin(request);
    const zones = Object.entries(TBILISI_ZONES).map(([zoneId, zone]) => publicZone(db, zoneId, zone));
    sendJson(response, 200, {
      zones,
      unassignedCouriers: db.users
        .filter((user) => user.role === "courier" && user.status === "active" && !user.zoneId)
        .map(publicUser),
    });
    return;
  }

  if (method === "GET" && path === "/api/users") {
    requireAdmin(request);
    sendJson(response, 200, {
      users: db.users.filter((user) => user.status === "active").map(publicUser),
    });
    return;
  }

  if (method === "POST" && path === "/api/users") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const username = cleanUsername(body.username);
    const password = String(body.password || "").trim();
    const role = cleanRole(body.role);
    if (!username || !password) throw httpError(400, "ლოგინი და პაროლი აუცილებელია.");
    if (findUser(db, username)) throw httpError(409, "ეს ლოგინი უკვე არსებობს.");

    const now = new Date().toISOString();
    const user = {
      id: randomBytes(12).toString("hex"),
      username,
      role,
      status: "active",
      passwordHash: hashPassword(password),
      ...cleanUserProfile(body),
      createdAt: now,
      approvedAt: now,
    };
    db.users.push(user);
    await writeDb(db);
    sendJson(response, 201, { user: publicUser(user) });
    return;
  }

  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  const userZoneMatch = path.match(/^\/api\/users\/([^/]+)\/zone$/);
  if (userZoneMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(userZoneMatch[1]);
    const user = findUser(db, username);
    if (!user || user.role !== "courier" || user.status !== "active") throw httpError(404, "კურიერი ვერ მოიძებნა.");
    const body = await readJsonBody(request);
    user.zoneId = cleanZoneId(body.zoneId);
    await writeDb(db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (userMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(userMatch[1]);
    const user = findUser(db, username);
    if (!user || user.status !== "active") throw httpError(404, "ანგარიში ვერ მოიძებნა.");
    const body = await readJsonBody(request);
    Object.assign(user, cleanUserProfile(body));
    if (body.password !== undefined) {
      const password = String(body.password || "").trim();
      if (password) user.passwordHash = hashPassword(password);
    }
    await writeDb(db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (userMatch && method === "DELETE") {
    requireAdmin(request);
    const username = decodeURIComponent(userMatch[1]);
    const user = findUser(db, username);
    if (!user || user.status !== "active") throw httpError(404, "ანგარიში ვერ მოიძებნა.");
    if (user.role === "admin") throw httpError(403, "ადმინის დეაქტივაცია შეუძლებელია.");
    db.users = db.users.filter((item) => normalizeUsername(item.username) !== normalizeUsername(username));
    db.parcels = db.parcels.filter((parcel) => normalizeUsername(parcel.courierUsername) !== normalizeUsername(username));
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  const courierPasswordMatch = path.match(/^\/api\/couriers\/([^/]+)\/password$/);
  if (courierPasswordMatch && method === "PUT") {
    requireAdmin(request);
    const username = decodeURIComponent(courierPasswordMatch[1]);
    const body = await readJsonBody(request);
    const password = String(body.password || "").trim();
    if (!password) throw httpError(400, "პაროლი აუცილებელია.");
    const user = findUser(db, username);
    if (!user || user.role !== "courier" || user.status !== "active") throw httpError(404, "კურიერი ვერ მოიძებნა.");
    user.passwordHash = hashPassword(password);
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/geocode/search") {
    requireAdmin(request);
    const q = String(url.searchParams.get("q") || "").trim();
    const street = String(url.searchParams.get("street") || "").trim();
    if (!q && !street) {
      sendJson(response, 200, []);
      return;
    }
    const results = await fetchNominatimJson("/search", {
      format: "jsonv2",
      q,
      street,
      city: url.searchParams.get("city") || "",
      country: url.searchParams.get("country") || "",
      addressdetails: url.searchParams.get("addressdetails") || 1,
      limit: Math.min(Number(url.searchParams.get("limit") || 10), 10),
      countrycodes: "ge",
      viewbox: url.searchParams.get("viewbox") || "44.60,41.88,45.05,41.55",
      bounded: url.searchParams.get("bounded") || 1,
      "accept-language": url.searchParams.get("accept-language") || "ka,en",
    }, []);
    sendJson(response, 200, Array.isArray(results) ? results : []);
    return;
  }

  if (method === "GET" && path === "/api/geocode/reverse") {
    requireAdmin(request);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      sendJson(response, 200, {});
      return;
    }
    const result = await fetchNominatimJson("/reverse", {
      format: "jsonv2",
      lat,
      lon,
      zoom: url.searchParams.get("zoom") || 18,
      addressdetails: url.searchParams.get("addressdetails") || 1,
      "accept-language": url.searchParams.get("accept-language") || "ka,en",
    }, {});
    sendJson(response, 200, result && typeof result === "object" ? result : {});
    return;
  }

  if (method === "GET" && path === "/api/parcels") {
    const session = requireSession(request);
    const courier = url.searchParams.get("courier") || (session.role === "admin" ? "" : session.username);
    if (courier && !canAccessCourier(session, courier)) throw httpError(403, "წვდომა აკრძალულია.");
    sendJson(response, 200, {
      parcels: db.parcels
        .filter((parcel) => !parcel.archivedAt && (!courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier)))
        .map((parcel) => publicParcel(db, parcel)),
    });
    return;
  }

  if (method === "POST" && path === "/api/parcels") {
    const session = requireAdmin(request);
    const body = await readJsonBody(request);
    const courierUsername = cleanUsername(body.courierUsername);
    if (!canAccessCourier(session, courierUsername || session.username)) throw httpError(403, "წვდომა აკრძალულია.");
    let courier = courierUsername ? findUser(db, courierUsername) : null;
    if (courierUsername && (!courier || courier.role !== "courier" || courier.status !== "active")) throw httpError(404, "კურიერი ვერ მოიძებნა.");

    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const address = String(body.address || "").trim();
    const paymentAmount = cleanPaymentAmount(body.paymentAmount ?? body.payment ?? body.cashAmount);
    if (!fullName || !phone || !Number.isFinite(lat) || !Number.isFinite(lng)) throw httpError(400, "ამანათის დეტალები აუცილებელია.");
    if (!address || isCoordinateLabel(address) || !hasHouseNumber(address)) throw httpError(400, "ქუჩა და შენობის ნომერი აუცილებელია.");

    const detectedZone = detectTbilisiZone({ lat, lng });
    let autoAssigned = false;
    let assignmentMessage = "";
    if (!courierUsername) {
      if (!detectedZone) {
        assignmentMessage = "ამ მისამართისთვის ზონა ვერ მოიძებნა";
      } else {
        courier = findLeastBusyCourierForZone(db, detectedZone.id);
        if (courier) {
          autoAssigned = true;
        } else {
          assignmentMessage = "ამ ზონაში კურიერი არ არის მიბმული";
        }
      }
    }

    const now = new Date().toISOString();
    const parcel = {
      id: randomBytes(12).toString("hex"),
      courierUsername: courier?.username || "",
      lat,
      lng,
      address,
      fullName,
      phone,
      paymentAmount,
      cashAmount: paymentAmount,
      deliveryTotalPrice: 0,
      courierPay: 0,
      adminProfit: 0,
      zoneId: detectedZone?.id || "",
      zoneName: detectedZone?.name || "",
      autoAssigned,
      status: "pending",
      assignedAt: courier ? now : "",
      createdAt: now,
    };
    db.parcels.push(parcel);
    await writeDb(db);
    sendJson(response, 201, { parcel: publicParcel(db, parcel), assignmentMessage });
    return;
  }

  if (method === "PATCH" && path === "/api/parcels/assign") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    const courierUsername = cleanUsername(body.courierUsername);
    const parcelIds = Array.isArray(body.parcelIds) ? body.parcelIds.map((id) => String(id)) : [];
    const courier = findUser(db, courierUsername);
    if (!courier || courier.role !== "courier" || courier.status !== "active") throw httpError(404, "კურიერი ვერ მოიძებნა.");
    if (!parcelIds.length) throw httpError(400, "აირჩიეთ მინიმუმ ერთი ამანათი.");

    let assigned = 0;
    db.parcels.forEach((parcel) => {
      if (parcelIds.includes(parcel.id) && !parcel.archivedAt) {
        parcel.courierUsername = courier.username;
        parcel.assignedAt = new Date().toISOString();
        parcel.autoAssigned = false;
        assigned += 1;
      }
    });
    if (!assigned) throw httpError(404, "ამანათები ვერ მოიძებნა.");
    await writeDb(db);
    sendJson(response, 200, { assigned });
    return;
  }

  const parcelStatusMatch = path.match(/^\/api\/parcels\/([^/]+)\/status$/);
  if (parcelStatusMatch && method === "PATCH") {
    const session = requireSession(request);
    const body = await readJsonBody(request);
    const status = String(body.status || "");
    if (!["delivered", "failed", "pending"].includes(status)) throw httpError(400, "სტატუსი არასწორია.");
    const parcel = db.parcels.find((item) => item.id === decodeURIComponent(parcelStatusMatch[1]));
    if (!parcel || parcel.archivedAt) throw httpError(404, "ამანათი ვერ მოიძებნა.");
    if (!canAccessCourier(session, parcel.courierUsername)) throw httpError(403, "წვდომა აკრძალულია.");
    if (session.role !== "admin" && status === "pending") throw httpError(403, "Only admin can return a parcel to pending.");
    if (session.role !== "admin" && parcel.status === "delivered" && status === "failed") throw httpError(403, "ჩაბარებული შეკვეთის შეცვლა მხოლოდ ადმინს შეუძლია.");
    if (session.role !== "admin" && status === "delivered") {
      const courierCoords = { lat: Number(body.currentLat), lng: Number(body.currentLng) };
      if (!Number.isFinite(courierCoords.lat) || !Number.isFinite(courierCoords.lng)) throw httpError(400, "მდებარეობა ვერ განისაზღვრა.");
      if (distanceInMeters(courierCoords, parcel) > 30000) throw httpError(403, "შეკვეთის ჩაბარება შესაძლებელია მხოლოდ 30 კმ რადიუსში.");
    }
    const now = new Date().toISOString();
    parcel.status = status;
    parcel.updatedAt = now;
    if (status === "pending") {
      parcel.completedAt = "";
      parcel.deliveredAt = "";
      parcel.failedAt = "";
      parcel.failureReason = "";
    } else {
      parcel.completedAt = now;
    }
    if (status === "delivered") {
      parcel.deliveredAt = now;
      parcel.failedAt = "";
      applyDeliveredFinance(parcel);
    }
    if (status === "failed") {
      parcel.failedAt = now;
      parcel.deliveredAt = "";
    }
    await writeDb(db);
    sendJson(response, 200, { parcel: publicParcel(db, parcel) });
    return;
  }

  if (method === "POST" && path === "/api/parcels/archive") {
    const session = requireSession(request);
    const body = await readJsonBody(request);
    const courier = session.role === "admin" ? cleanUsername(body.courierUsername || "") : session.username;
    const parcelIds = Array.isArray(body.parcelIds) ? new Set(body.parcelIds.map((id) => String(id))) : null;
    if (courier && !canAccessCourier(session, courier)) throw httpError(403, "წვდომა აკრძალულია.");
    const now = new Date().toISOString();
    let archived = 0;
    db.parcels.forEach((parcel) => {
      if (!parcel.archivedAt && isCompletedParcel(parcel) && (!parcelIds || parcelIds.has(parcel.id)) && (!courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier))) {
        applyDeliveredFinance(parcel);
        parcel.archivedAt = now;
        parcel.updatedAt = now;
        archived += 1;
      }
    });
    await writeDb(db);
    sendJson(response, 200, { archived });
    return;
  }

  if (method === "GET" && path === "/api/history") {
    const session = requireSession(request);
    const courier = url.searchParams.get("courier") || (session.role === "admin" ? "" : session.username);
    if (courier && !canAccessCourier(session, courier)) throw httpError(403, "წვდომა აკრძალულია.");
    sendJson(response, 200, {
      history: db.parcels
        .filter((parcel) => parcel.archivedAt && (!courier || normalizeUsername(parcel.courierUsername) === normalizeUsername(courier)))
        .map((parcel) => publicParcel(db, parcel)),
    });
    return;
  }

  if (method === "GET" && path === "/api/parcels/search") {
    requireAdmin(request);
    const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const parcels = db.parcels.filter((parcel) => {
      if (!query) return true;
      return parcelSearchHaystack(db, parcel).includes(query);
    });
    sendJson(response, 200, { parcels: parcels.map((parcel) => publicParcel(db, parcel)) });
    return;
  }

  throw httpError(404, "ვერ მოიძებნა.");
}

async function handleStatic(request, response, url) {
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(frontendRoot, normalizedPath));

  if (!filePath.startsWith(frontendRoot)) {
    response.writeHead(403);
    response.end("წვდომა აკრძალულია");
    return;
  }

  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(content);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${currentPort}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await handleStatic(request, response, url);
  } catch (error) {
    const status = error.status || (error.code === "ENOENT" ? 404 : 500);
    const message = error.status ? error.message : status === 404 ? "ვერ მოიძებნა" : "სერვერის შეცდომა.";
    if ((request.url || "").startsWith("/api/")) {
      sendJson(response, status, { error: message });
      return;
    }
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(message);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && currentPort < initialPort + 20) {
    currentPort += 1;
    server.listen(currentPort, host);
    return;
  }
  throw error;
});

server.listen(currentPort, host, () => {
  console.log(`საკურიერო სისტემა გაშვებულია მისამართზე http://localhost:${currentPort}`);
});
