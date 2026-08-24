"use strict";

const APP_CACHE_NAME = "swift-delivery-app-shell-v38";
const DEFAULT_PUSH_VIBRATE = [220, 90, 220, 90, 320];
const APP_CACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json?v=2",
  "./style.min.css?v=28",
  "./style-overrides.css?v=4",
  "./icons/favicon-v2.png",
  "./icons/icon-192-v2.png",
  "./icons/icon-512-v2.png",
  "./js/config.js?v=5",
  "./js/state.js?v=15",
  "./js/utils.js?v=8",
  "./js/storage.js?v=9",
  "./js/notifications.js?v=29",
  "./js/api.js?v=31",
  "./js/address-directory.js?v=13",
  "./js/map.js?v=15",
  "./js/auth.js?v=12",
  "./js/zones.js?v=3",
  "./js/photo-import.js?v=1",
  "./js/parcels.js?v=27",
  "./js/admin.js?v=15",
  "./js/courier.js?v=6",
  "./js/partner.js?v=35",
  "./js/finance.js?v=21",
  "./js/history.js?v=8",
  "./js/tariffs.js?v=2",
  "./js/app.js?v=42",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE_NAME)
      .then((cache) => cache.addAll(APP_CACHE_ASSETS))
      .catch((error) => console.warn("[sw-cache] app shell cache failed", error))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("swift-delivery-app-shell-") && key !== APP_CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function fetchFromCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(APP_CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  const cacheablePath = /\.(?:css|js|json|png|ico|svg|webp|jpg|jpeg)$/i.test(url.pathname);
  if (cacheablePath) event.respondWith(fetchFromCacheFirst(request));
});

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  firebase.initializeApp({
    apiKey: "AIzaSyBF421H4mkNB9Ve_uJ8Ph6z4LrbxzKlrC4",
    authDomain: "amanatebi123-43963.firebaseapp.com",
    projectId: "amanatebi123-43963",
    storageBucket: "amanatebi123-43963.firebasestorage.app",
    messagingSenderId: "882036563594",
    appId: "1:882036563594:web:c800b0f2bb6977a441d773",
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || "Swift Delivery";
    const options = buildPushNotificationOptions({
      body: payload.notification?.body || payload.data?.body || "",
      tag: payload.data?.parcelId || payload.messageId || "swift-delivery-admin-push",
      parcelId: payload.data?.parcelId || "",
      url: payload.fcmOptions?.link || payload.data?.url || "./",
      requireInteraction: payload.data?.requireInteraction,
      renotify: payload.data?.renotify,
      vibrate: payload.data?.vibrate,
    });

    self.registration.showNotification(title, options);
  });
} catch (error) {
  console.warn("[push-sw] Firebase Messaging unavailable; standard Web Push remains active", error);
}

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || "Swift Delivery";
  const options = buildPushNotificationOptions({
    body: payload.body || "",
    tag: payload.parcelId || payload.tag || "swift-delivery-admin-push",
    parcelId: payload.parcelId || "",
    url: payload.url || "./",
    icon: payload.icon,
    badge: payload.badge,
    requireInteraction: payload.requireInteraction,
    renotify: payload.renotify,
    vibrate: payload.vibrate,
  });

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./";
  event.waitUntil(openPushNotificationClient(url));
});

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { title: "Swift Delivery", body: event.data.text() };
  }
}

function buildPushNotificationOptions(payload = {}) {
  const tag = String(payload.tag || payload.parcelId || "swift-delivery-admin-push");
  return {
    body: payload.body || "",
    icon: payload.icon || "./icons/icon-192-v2.png",
    badge: payload.badge || "./icons/favicon-v2.png",
    tag,
    renotify: payload.renotify !== false && payload.renotify !== "false",
    requireInteraction: payload.requireInteraction !== false && payload.requireInteraction !== "false",
    vibrate: parsePushVibrate(payload.vibrate) || DEFAULT_PUSH_VIBRATE,
    data: {
      url: payload.url || "./?view=push",
      parcelId: payload.parcelId || "",
    },
  };
}

function parsePushVibrate(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value === "string" && value.trim()) {
    const parsed = value.split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
    return parsed.length ? parsed : null;
  }
  return null;
}

async function openPushNotificationClient(url) {
  const target = new URL(url || "./?view=push", self.location.href).href;
  const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const sameOriginClient = clientList.find((client) => new URL(client.url).origin === self.location.origin);
  if (sameOriginClient) {
    await sameOriginClient.focus();
    if ("navigate" in sameOriginClient) return sameOriginClient.navigate(target);
    return sameOriginClient;
  }
  return clients.openWindow(target);
}
