"use strict";

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
  const options = {
    body: payload.notification?.body || payload.data?.body || "",
    icon: "./icons/icon-192-v2.png",
    badge: "./icons/favicon-v2.png",
    tag: payload.data?.parcelId || payload.messageId || "swift-delivery-admin-push",
    data: {
      url: payload.fcmOptions?.link || payload.data?.url || "./",
    },
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./";
  event.waitUntil(clients.openWindow(url));
});
