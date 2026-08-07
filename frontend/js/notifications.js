"use strict";

const ADMIN_PUSH_VAPID_KEY = "BA4FhG342cMhWZCPegnOw1NoZIb_4HhgL8DRAVsVrRqNxeMbXxg0On0G3eqpAslWwyerpOOWBQWk8trQeVenp7g";
const ADMIN_PUSH_TOKENS_COLLECTION = "adminPushTokens";
const ADMIN_NOTIFICATIONS_COLLECTION = "adminNotifications";

function canUseAdminPush() {
  return Boolean(
    state.isAdmin
    && "Notification" in window
    && "serviceWorker" in navigator
    && window.firebase?.messaging
  );
}

async function initializeAdminPushNotifications() {
  if (!state.isAdmin) return false;
  if (!canUseAdminPush()) {
    state.adminPushStatus = "unsupported";
    return false;
  }
  if (Notification.permission !== "granted") {
    state.adminPushStatus = Notification.permission === "denied" ? "denied" : "permission-needed";
    return false;
  }
  return registerAdminPushToken();
}

async function requestAdminPushNotifications() {
  if (!state.isAdmin) return false;
  if (!canUseAdminPush()) {
    showToast("ამ ბრაუზერს ფუშ შეტყობინებები არ აქვს ჩართული.");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    state.adminPushStatus = permission === "denied" ? "denied" : "permission-needed";
    showToast("ფუშ შეტყობინება არ ჩაირთო.");
    return false;
  }

  const registered = await registerAdminPushToken();
  showToast(registered ? "ფუშ შეტყობინებები ჩაირთო." : "ფუშ შეტყობინება ვერ ჩაირთო.");
  return registered;
}

async function registerAdminPushToken() {
  try {
    const db = await initializeFirebaseStorage();
    if (!db) return false;

    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    const messaging = window.firebase.messaging(window.firebaseApp);
    const token = await messaging.getToken({
      vapidKey: ADMIN_PUSH_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return false;

    state.adminPushToken = token;
    state.adminPushStatus = "enabled";
    await saveAdminPushToken(db, token);
    return true;
  } catch (error) {
    console.warn("[push] admin token registration failed", error);
    state.adminPushStatus = "error";
    return false;
  }
}

async function saveAdminPushToken(db, token) {
  const key = getAdminPushKey(token);
  const payload = {
    token,
    username: state.currentUser || "",
    role: state.currentUserProfile?.role || "",
    active: true,
    userAgent: navigator.userAgent || "",
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection(ADMIN_PUSH_TOKENS_COLLECTION).doc(key).set({
      ...payload,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (error) {
    console.warn("[push] token collection write failed; using static store fallback", error);
    await saveAdminPushTokenFallback(db, key, token);
    return true;
  }
}

async function saveAdminPushTokenFallback(db, key, token) {
  await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
    adminPushTokens: {
      [key]: {
        token,
        username: state.currentUser || "",
        role: state.currentUserProfile?.role || "",
        active: true,
        userAgent: navigator.userAgent || "",
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
}

async function publishAdminParcelStatusNotification(parcel, status, options = {}) {
  if (state.isAdmin || !["delivered", "failed"].includes(status) || !parcel) return false;

  const db = await initializeFirebaseStorage();
  if (!db) return false;

  const notification = buildAdminParcelStatusNotification(parcel, status, options);
  if (!notification) return false;

  try {
    await db.collection(ADMIN_NOTIFICATIONS_COLLECTION).add({
      ...notification,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.warn("[push] notification collection write failed; using static store fallback", error);
    await publishAdminParcelStatusNotificationFallback(db, notification);
    return true;
  }
}

function buildAdminParcelStatusNotification(parcel, status, options = {}) {
  const address = getParcelPushAddress(parcel);
  const fullName = String(parcel.fullName || parcel.customerName || parcel.name || "").trim();
  const failureReason = String(options.failureReason || parcelFailureReason(parcel) || "").trim();
  const isFailed = status === "failed";
  const title = isFailed ? "შეკვეთა ვერ ჩაბარდა" : "შეკვეთა ჩაბარდა";
  const details = [address, fullName].filter(Boolean).join(", ") || "შეკვეთის სტატუსი შეიცვალა";
  const body = isFailed && failureReason ? `${details}\nმიზეზი: ${failureReason}` : details;

  return {
    type: isFailed ? "parcel_failed" : "parcel_delivered",
    status,
    title,
    body,
    parcelId: String(parcel.id || ""),
    address,
    fullName,
    failureReason,
    courierUsername: String(parcel.courierUsername || state.currentUser || ""),
    createdBy: state.currentUser || "",
    createdByRole: state.currentUserProfile?.role || "",
    pageUrl: "./",
    eventKey: `${parcel.id || "parcel"}-${status}-${Date.now()}`,
  };
}

async function publishAdminParcelStatusNotificationFallback(db, notification) {
  const key = getAdminPushKey(notification.eventKey || `${notification.parcelId}-${Date.now()}`);
  await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
    adminNotifications: {
      [key]: {
        ...notification,
        id: key,
        createdAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
}

function getParcelPushAddress(parcel) {
  return String(
    parcel?.address
    || parcel?.fullAddress
    || [parcel?.city, parcel?.district, parcel?.streetAddress, parcel?.building].filter(Boolean).join(", ")
    || ""
  ).trim();
}

function getAdminPushKey(value) {
  return btoa(unescape(encodeURIComponent(String(value || ""))))
    .replace(/[+/=]/g, "_")
    .slice(0, 180) || `push_${Date.now()}`;
}
