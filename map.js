import { db } from "./firebase.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let map;
let courierMarkers = new Map();
let orderMarkers = new Map();
let clientMarkers = new Map();
let myLocationMarker = null;
let gpsWatchId = null;

export function initMap() {
  map = L.map("map", { zoomControl: false }).setView([41.7151, 44.8271], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  L.control.zoom({ position: "bottomleft" }).addTo(map);
  setTimeout(() => map.invalidateSize(), 250);
  return map;
}

export function getMap() {
  return map;
}

function makeIcon(emoji, className = "") {
  return L.divIcon({
    html: `<div class="${className}" style="font-size:28px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.45))">${emoji}</div>`,
    className: "custom-emoji-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 30]
  });
}

export function listenCouriersOnMap() {
  return onSnapshot(collection(db, "gpsLocations"), snap => {
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.lat || !data.lng) return;
      const id = docSnap.id;
      const text = `<b>კურიერი</b><br>${data.name || id}<br>${data.phone || ""}`;
      if (courierMarkers.has(id)) {
        courierMarkers.get(id).setLatLng([data.lat, data.lng]).setPopupContent(text);
      } else {
        const marker = L.marker([data.lat, data.lng], { icon: makeIcon("🚗") }).addTo(map).bindPopup(text);
        courierMarkers.set(id, marker);
      }
    });
  });
}

export function listenOrdersOnMap() {
  return onSnapshot(collection(db, "orders"), snap => {
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.lat || !data.lng) return;
      const id = docSnap.id;
      const text = `<b>შეკვეთა</b><br>${data.address || "მისამართი"}<br>Status: ${data.status || "new"}`;
      if (orderMarkers.has(id)) {
        orderMarkers.get(id).setLatLng([data.lat, data.lng]).setPopupContent(text);
      } else {
        const marker = L.marker([data.lat, data.lng], { icon: makeIcon("📦") }).addTo(map).bindPopup(text);
        orderMarkers.set(id, marker);
      }
    });
  });
}

export function listenClientsOnMap() {
  return onSnapshot(collection(db, "clients"), snap => {
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.lat || !data.lng) return;
      const id = docSnap.id;
      const text = `<b>კლიენტი</b><br>${data.name || "კლიენტი"}<br>${data.address || ""}`;
      if (clientMarkers.has(id)) {
        clientMarkers.get(id).setLatLng([data.lat, data.lng]).setPopupContent(text);
      } else {
        const marker = L.marker([data.lat, data.lng], { icon: makeIcon("📍") }).addTo(map).bindPopup(text);
        clientMarkers.set(id, marker);
      }
    });
  });
}

export function startLocalTracking(onPosition) {
  if (!navigator.geolocation) {
    alert("GPS არ არის მხარდაჭერილი ამ ბრაუზერში");
    return null;
  }
  gpsWatchId = navigator.geolocation.watchPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (!myLocationMarker) {
      myLocationMarker = L.marker([lat, lng], { icon: makeIcon("🚗") }).addTo(map).bindPopup("ჩემი ლოკაცია");
    } else {
      myLocationMarker.setLatLng([lat, lng]);
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
    if (onPosition) onPosition({ lat, lng, accuracy: pos.coords.accuracy });
  }, err => alert("GPS შეცდომა: " + err.message), {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
  return gpsWatchId;
}

export function stopLocalTracking() {
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
}
