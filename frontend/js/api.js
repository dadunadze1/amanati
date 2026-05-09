"use strict";



async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || STRINGS.serverFailed);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}


async function getCouriers() {
  return applyLocalZoneAssignments((await api("/api/couriers")).couriers);
}


async function getUsers() {
  return applyLocalZoneAssignments((await api("/api/users")).users);
}


async function getPending() {
  return (await api("/api/pending")).pending;
}


async function getPins(username) {
  const query = username ? `?courier=${encodeURIComponent(username)}` : "";
  return (await api(`/api/parcels${query}`)).parcels;
}


async function getHistory(username) {
  const query = username ? `?courier=${encodeURIComponent(username)}` : "";
  return (await api(`/api/history${query}`)).history;
}


async function searchParcels(query) {
  return (await api(`/api/parcels/search?q=${encodeURIComponent(query || "")}`)).parcels;
}


async function getZones() {
  if (!CONFIG.useZonesApi) return normalizeZones([]);

  try {
    const zones = (await api("/api/zones")).zones;
    return normalizeZones(zones);
  } catch {
    return normalizeZones([]);
  }
}
