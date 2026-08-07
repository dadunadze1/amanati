"use strict";

const ADMIN_PUSH_VAPID_KEY = "BA4FhG342cMhWZCPegnOw1NoZIb_4HhgL8DRAVsVrRqNxeMbXxg0On0G3eqpAslWwyerpOOWBQWk8trQeVenp7g";
const ADMIN_WEB_PUSH_PUBLIC_KEY = "BAEuO5gXFaWrtcaxhWxvzgNc1hlvCYZoNtYdxJno43RqzgANahvbOvrQzaMV7rMTUsDXyGaqa_OW5FrxbYCK4MY";
const ADMIN_PUSH_TOKENS_COLLECTION = "adminPushTokens";
const ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION = "adminWebPushSubscriptions";
const ADMIN_NOTIFICATIONS_COLLECTION = "adminNotifications";

function canUseAdminPush() {
  return Boolean(
    state.isAdmin
    && "Notification" in window
    && "serviceWorker" in navigator
    && "PushManager" in window
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
  showToast(registered ? "ფუშ შეტყობინებები ჩაირთო." : "ფუშ შეტყობინება ვერ ჩაირთო. ნახეთ ბრაუზერის მხარდაჭერა და Firebase კავშირი.");
  return registered;
}

async function registerAdminPushToken() {
  try {
    const { app, db } = await initializeAdminPushFirebaseContext();
    if (!db) return false;

    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    await registration.update().catch(() => {});
    const webPushRegistered = await registerAdminStandardWebPush(db, registration);
    const fcmRegistered = webPushRegistered ? false : await registerAdminFirebaseMessaging(db, app, registration);

    if (!webPushRegistered && !fcmRegistered) return false;
    state.adminPushStatus = "enabled";
    return true;
  } catch (error) {
    console.warn("[push] admin token registration failed", error);
    state.adminPushStatus = "error";
    showToast(getAdminPushErrorMessage(error));
    return false;
  }
}

async function initializeAdminPushFirebaseContext() {
  if (!hasFirebaseConfig() || !window.firebase?.initializeApp || !window.firebase?.firestore) return {};

  const app = window.firebase.apps?.length
    ? window.firebase.app()
    : window.firebase.initializeApp(firebaseConfig);
  window.firebaseApp = app;

  if (window.firebase.auth) {
    const auth = window.firebase.auth(app);
    if (!auth.currentUser) {
      await auth.signInAnonymously().catch((error) => {
        console.warn("[push] anonymous auth failed; trying Firestore write without auth", error);
      });
    }
  }

  const db = window.firebase.firestore(app);
  window.firebaseDb = db;
  return { app, db };
}

async function registerAdminStandardWebPush(db, registration) {
  if (!registration?.pushManager) return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(ADMIN_WEB_PUSH_PUBLIC_KEY),
    });
  }

  await saveAdminWebPushSubscription(db, subscription.toJSON());
  return true;
}

async function registerAdminFirebaseMessaging(db, app, registration) {
  if (!window.firebase?.messaging) return false;
  if (typeof window.firebase.messaging.isSupported === "function") {
    const supported = await window.firebase.messaging.isSupported().catch(() => false);
    if (!supported) return false;
  }

  const messaging = window.firebase.messaging(app);
  const token = await messaging.getToken({
    vapidKey: ADMIN_PUSH_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return false;

  state.adminPushToken = token;
  await saveAdminPushToken(db, token);
  return true;
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

async function saveAdminWebPushSubscription(db, subscription) {
  const endpoint = String(subscription?.endpoint || "");
  if (!endpoint) throw new Error("push-subscription-missing-endpoint");

  const key = getAdminPushKey(endpoint);
  const payload = {
    subscription,
    endpoint,
    username: state.currentUser || "",
    role: state.currentUserProfile?.role || "",
    active: true,
    userAgent: navigator.userAgent || "",
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection(ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION).doc(key).set({
      ...payload,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (error) {
    console.warn("[push] web push subscription collection write failed; using static store fallback", error);
    await saveAdminWebPushSubscriptionFallback(db, key, subscription);
    return true;
  }
}

async function saveAdminWebPushSubscriptionFallback(db, key, subscription) {
  await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
    adminWebPushSubscriptions: {
      [key]: {
        subscription,
        endpoint: subscription.endpoint || "",
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

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function getAdminPushErrorMessage(error) {
  const code = String(error?.code || error?.name || error?.message || "");
  if (/unsupported|not supported/i.test(code)) return "ამ ბრაუზერს ეს ფუშ ტექნოლოგია არ უჭერს მხარს.";
  if (/firestore|permission|Missing or insufficient permissions/i.test(code)) return "Firebase-ში ფუშ token-ის შენახვა დაიბლოკა.";
  if (/denied|permission/i.test(code)) return "ბრაუზერში notification permission დაბლოკილია.";
  if (/network|fetch|internet/i.test(code)) return "ფუშის ჩართვა ვერ მოხერხდა ინტერნეტის/Firebase კავშირის გამო.";
  return "ფუშ შეტყობინება ვერ ჩაირთო.";
}
