"use strict";

const ADMIN_PUSH_VAPID_KEY = "BA4FhG342cMhWZCPegnOw1NoZIb_4HhgL8DRAVsVrRqNxeMbXxg0On0G3eqpAslWwyerpOOWBQWk8trQeVenp7g";
const ADMIN_WEB_PUSH_PUBLIC_KEY = "BOt7WZ1hnouutGnEJzmiiGHLt3NUVsHjp-EvOeIMktmPhYVzQNju3ssYBX51d7cmqddeQCh4p1n_nOL6HFNP57Q";
const ADMIN_PUSH_TOKENS_COLLECTION = "adminPushTokens";
const ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION = "adminWebPushSubscriptions";
const ADMIN_NOTIFICATIONS_COLLECTION = "adminNotifications";
const PUSH_NOTIFICATION_TITLE_PREFIXES = {
  delivered: "📦",
  created: "🛵",
  assigned: "🛵",
  picked_up: "📦",
  failed: "🚨",
};

function canUseAdminPush() {
  return Boolean(
    canUseAuthorizedPushSession()
    && "Notification" in window
    && "serviceWorker" in navigator
    && "PushManager" in window
  );
}

function canUseAuthorizedPushSession() {
  return Boolean(state.currentUser && ["admin", "partner", "courier"].includes(state.currentUserProfile?.role || ""));
}

function setAdminPushError(message) {
  state.adminPushStatus = "error";
  state.adminPushLastError = message;
  showToast(message);
  return false;
}

async function initializeAdminPushNotifications() {
  if (!canUseAuthorizedPushSession()) return false;
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

async function activatePushForAuthorizedUser() {
  if (!canUseAuthorizedPushSession()) return false;
  if (!canUseAdminPush()) {
    state.adminPushStatus = "unsupported";
    return false;
  }
  if (Notification.permission === "granted") return registerAdminPushToken();
  if (Notification.permission === "denied") {
    state.adminPushStatus = "denied";
    return false;
  }
  state.adminPushStatus = "permission-needed";
  return false;
}

async function requestAdminPushNotifications(options = {}) {
  if (!canUseAuthorizedPushSession()) return false;
  if (!canUseAdminPush()) {
    return options.silent ? false : setAdminPushError(getAdminPushCapabilityMessage());
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    state.adminPushStatus = permission === "denied" ? "denied" : "permission-needed";
    const message = permission === "denied"
      ? "ბრაუზერში notification permission დაბლოკილია."
      : "notification permission არ დადასტურდა.";
    if (options.silent) {
      state.adminPushLastError = message;
      return false;
    }
    return setAdminPushError(message);
  }

  const registered = await registerAdminPushToken();
  if (registered && !options.silent) showToast("ფუშ შეტყობინებები ჩაირთო.");
  else if (!registered && !state.adminPushLastError && !options.silent) setAdminPushError("ფუშის რეგისტრაცია შეწყდა უცნობ ეტაპზე.");
  return registered;
}

async function registerAdminPushToken() {
  try {
    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js?v=29", { scope: "./" });
    await registration.update().catch(() => {});

    let subscription = null;
    let standardPushError = null;
    try {
      subscription = await createAdminStandardWebPushSubscription(registration);
    } catch (error) {
      standardPushError = error;
      console.warn("[push] standard web push subscription failed; trying Firebase Messaging", error);
    }

    const { app, db } = await initializeAdminPushFirebaseContext();
    if (!db) throw new Error("firebase-context-unavailable");

    const webPushRegistered = subscription ? await saveAdminWebPushSubscription(db, subscription.toJSON()) : false;
    let fcmRegistered = false;
    let fcmError = null;
    if (!webPushRegistered) {
      try {
        fcmRegistered = await registerAdminFirebaseMessaging(db, app, registration);
      } catch (error) {
        fcmError = error;
        console.warn("[push] Firebase Messaging token registration failed", error);
      }
    }

    if (!webPushRegistered && !fcmRegistered) throw buildPushRegistrationError(standardPushError, fcmError);
    state.adminPushStatus = "enabled";
    state.adminPushLastError = "";
    return true;
  } catch (error) {
    console.warn("[push] admin token registration failed", error);
    state.adminPushStatus = "error";
    state.adminPushLastError = getAdminPushErrorMessage(error);
    showToast(state.adminPushLastError);
    return false;
  }
}

function buildPushRegistrationError(standardPushError, fcmError) {
  const details = [standardPushError, fcmError]
    .map((error) => String(error?.code || error?.name || error?.message || error || "").trim())
    .filter(Boolean);
  return new Error(details.length ? `push-registration-details: ${details.join(" | ")}` : "push-registration-no-token-or-subscription");
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

async function createAdminStandardWebPushSubscription(registration) {
  if (!registration?.pushManager) throw new Error("push-manager-unavailable");

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !subscriptionMatchesWebPushKey(subscription)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }
  if (!subscription) {
    subscription = await subscribeAdminStandardWebPush(registration);
  }

  return subscription;
}

async function subscribeAdminStandardWebPush(registration) {
  const keyBytes = urlBase64ToUint8Array(ADMIN_WEB_PUSH_PUBLIC_KEY);
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength);
  const keyVariants = [keyBuffer, keyBytes];
  let lastError = null;

  for (const applicationServerKey of keyVariants) {
    try {
      return await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (error) {
      lastError = error;
      if (!isPushKeyArgumentError(error)) throw error;
    }
  }

  throw lastError || new Error("push-subscribe-invalid-argument");
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
    partnerId: getCurrentPushPartnerId(),
    partnerUsername: getCurrentPushPartnerUsername(),
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
        partnerId: getCurrentPushPartnerId(),
        partnerUsername: getCurrentPushPartnerUsername(),
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
    partnerId: getCurrentPushPartnerId(),
    partnerUsername: getCurrentPushPartnerUsername(),
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
        partnerId: getCurrentPushPartnerId(),
        partnerUsername: getCurrentPushPartnerUsername(),
        active: true,
        userAgent: navigator.userAgent || "",
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
}

async function deactivatePushForCurrentDevice() {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const { db } = await initializeAdminPushFirebaseContext();
    if (!db) return false;

    let deactivated = false;
    const registration = await navigator.serviceWorker.getRegistration("./");
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription?.endpoint) {
      await deactivateAdminWebPushSubscription(db, subscription.endpoint);
      await subscription.unsubscribe().catch(() => {});
      deactivated = true;
    }

    if (state.adminPushToken) {
      await deactivateAdminPushToken(db, state.adminPushToken);
      state.adminPushToken = "";
      deactivated = true;
    }

    state.adminPushStatus = "unknown";
    state.adminPushLastError = "";
    return deactivated;
  } catch (error) {
    console.warn("[push] device deactivation failed", error);
    return false;
  }
}

async function deactivateAdminPushToken(db, token) {
  const key = getAdminPushKey(token);
  const payload = {
    active: false,
    deactivatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await db.collection(ADMIN_PUSH_TOKENS_COLLECTION).doc(key).set(payload, { merge: true });
  } catch {
    await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
      adminPushTokens: {
        [key]: {
          token,
          active: false,
          deactivatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }, { merge: true });
  }
}

async function deactivateAdminWebPushSubscription(db, endpoint) {
  const key = getAdminPushKey(endpoint);
  const payload = {
    active: false,
    deactivatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await db.collection(ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION).doc(key).set(payload, { merge: true });
  } catch {
    await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
      adminWebPushSubscriptions: {
        [key]: {
          endpoint,
          active: false,
          deactivatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }, { merge: true });
  }
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

async function publishParcelCreatedNotification(parcel) {
  if (!state.isPartner || !parcel) return false;
  const notification = buildParcelCreatedNotification(parcel);
  return publishPushNotification(notification);
}

async function publishParcelAssignedNotification(parcel, courierUsername) {
  if (!state.isAdmin || !parcel || !courierUsername) return false;
  const notification = buildParcelAssignedNotification(parcel, courierUsername);
  return publishPushNotification(notification);
}

async function publishPartnerPickupAcknowledgedNotification(pickup) {
  if (state.currentUserProfile?.role !== "courier" || !pickup) return false;
  const partnerName = String(pickup.partnerName || pickup.partnerUsername || "").trim();
  const courierName = String(userDisplayName(state.currentUserProfile || {}) || state.currentUser || "").trim();
  const count = Number(pickup.count || 0);
  const countLabel = count > 0 ? `${count} შეკვეთა` : "შეკვეთები";
  return publishPushNotification({
    type: "partner_pickup_acknowledged",
    status: "picked_up",
    recipientRoles: ["admin", "partner"],
    title: formatPushNotificationTitle("picked_up", "პარტნიორის ამანათი აღებულია"),
    body: [courierName, partnerName, countLabel].filter(Boolean).join(" - "),
    parcelId: "",
    address: String(pickup.pickupAddress || ""),
    fullName: partnerName,
    failureReason: "",
    partnerId: String(pickup.partnerId || pickup.partnerUsername || ""),
    partnerUsername: String(pickup.partnerUsername || ""),
    partnerName,
    courierUsername: state.currentUser || "",
    createdBy: state.currentUser || "",
    createdByRole: state.currentUserProfile?.role || "",
    pageUrl: "./?view=push",
    eventKey: `partner-pickup-${pickup.partnerUsername || pickup.partnerId || "partner"}-${Date.now()}`,
  });
}


async function publishPushNotification(notification) {
  if (!notification) return false;
  const db = await initializeFirebaseStorage();
  if (!db) return false;

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
  const title = formatPushNotificationTitle(status, isFailed ? "შეკვეთა ვერ ჩაბარდა" : "შეკვეთა ჩაბარდა");
  const details = [address, fullName].filter(Boolean).join(", ") || "შეკვეთის სტატუსი შეიცვალა";
  const body = isFailed && failureReason ? `${details}\nმიზეზი: ${failureReason}` : details;
  const statusTime = options.completedAt || options.deliveredAt || options.failedAt || parcel.completedAt || parcel.deliveredAt || parcel.failedAt || "";

  const parcelId = String(parcel.id || "");
  return {
    type: isFailed ? "parcel_failed" : "parcel_delivered",
    status,
    recipientRoles: getParcelPushPartnerId(parcel) ? ["admin", "partner"] : ["admin"],
    title,
    body,
    parcelId,
    address,
    fullName,
    failureReason,
    partnerId: getParcelPushPartnerId(parcel),
    partnerUsername: String(parcel.partnerUsername || ""),
    partnerName: String(parcel.partnerName || ""),
    courierUsername: String(parcel.courierUsername || state.currentUser || ""),
    createdBy: state.currentUser || "",
    createdByRole: state.currentUserProfile?.role || "",
    pageUrl: buildPushPageUrl(parcelId),
    eventKey: `${parcel.id || "parcel"}-${status}-${statusTime || "now"}`,
  };
}

function buildParcelCreatedNotification(parcel) {
  const address = getParcelPushAddress(parcel);
  const fullName = String(parcel.fullName || parcel.customerName || parcel.name || "").trim();
  const partnerName = String(parcel.partnerName || state.currentUserProfile?.companyName || state.currentUserProfile?.contactPerson || state.currentUser || "").trim();
  const details = [address, fullName].filter(Boolean).join(", ") || "ახალი ამანათი დაემატა";
  const courierUsername = String(parcel.courierUsername || "").trim();
  const recipientRoles = courierUsername ? ["admin", "courier"] : ["admin"];

  const parcelId = String(parcel.id || "");
  return {
    type: "parcel_created",
    status: "created",
    recipientRoles,
    title: formatPushNotificationTitle("created", "პარტნიორმა ახალი ამანათი დაამატა"),
    body: `${partnerName || "პარტნიორი"} - ${details}`,
    parcelId,
    address,
    fullName,
    failureReason: "",
    partnerId: getParcelPushPartnerId(parcel) || getCurrentPushPartnerId(),
    partnerUsername: String(parcel.partnerUsername || state.currentUserProfile?.username || state.currentUser || ""),
    partnerName,
    courierUsername,
    createdBy: state.currentUser || "",
    createdByRole: state.currentUserProfile?.role || "",
    pageUrl: buildPushPageUrl(parcelId),
    eventKey: `${parcel.id || "parcel"}-created-${courierUsername || "admin"}-${parcel.createdAt || "now"}`,
  };
}

function buildParcelAssignedNotification(parcel, courierUsername) {
  const address = getParcelPushAddress(parcel);
  const fullName = String(parcel.fullName || parcel.customerName || parcel.name || "").trim();
  const details = [address, fullName].filter(Boolean).join(", ") || "ახალი ამანათი გაქვთ";

  const parcelId = String(parcel.id || "");
  return {
    type: "parcel_assigned",
    status: "assigned",
    recipientRoles: ["courier"],
    title: formatPushNotificationTitle("assigned", "ახალი ამანათი გაქვთ"),
    body: details,
    parcelId,
    address,
    fullName,
    failureReason: "",
    partnerId: getParcelPushPartnerId(parcel),
    partnerUsername: String(parcel.partnerUsername || ""),
    partnerName: String(parcel.partnerName || ""),
    courierUsername: String(courierUsername || parcel.courierUsername || ""),
    createdBy: state.currentUser || "",
    createdByRole: state.currentUserProfile?.role || "",
    pageUrl: buildPushPageUrl(parcelId),
    eventKey: `${parcel.id || "parcel"}-assigned-${courierUsername || parcel.courierUsername || "courier"}`,
  };
}

function buildPushPageUrl(parcelId = "") {
  const id = String(parcelId || "").trim();
  return `./?view=push${id ? `&parcel=${encodeURIComponent(id)}` : ""}`;
}

function formatPushNotificationTitle(status, title) {
  const cleanTitle = String(title || "").trim();
  const prefix = PUSH_NOTIFICATION_TITLE_PREFIXES[status] || "";
  if (!prefix || !cleanTitle) return cleanTitle;
  if (Object.values(PUSH_NOTIFICATION_TITLE_PREFIXES).some((item) => cleanTitle.startsWith(item))) return cleanTitle;
  return `${prefix} ${cleanTitle}`;
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

function getParcelPushPartnerId(parcel) {
  return String(parcel?.partnerId || parcel?.partnerUsername || "").trim();
}

function getCurrentPushPartnerId() {
  if (!state.isPartner) return "";
  return String(state.currentUserProfile?.id || state.currentUserProfile?.username || state.currentUser || "").trim();
}

function getCurrentPushPartnerUsername() {
  if (!state.isPartner) return "";
  return String(state.currentUserProfile?.username || state.currentUser || "").trim();
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

function isPushKeyArgumentError(error) {
  return /InvalidAccessError|InvalidCharacterError|invalid-argument|invalid argument/i.test(String(error?.code || error?.name || error?.message || error || ""));
}

function subscriptionMatchesWebPushKey(subscription) {
  const key = subscription?.options?.applicationServerKey;
  if (!key) return true;
  const expected = urlBase64ToUint8Array(ADMIN_WEB_PUSH_PUBLIC_KEY);
  const current = new Uint8Array(key);
  return current.length === expected.length && current.every((value, index) => value === expected[index]);
}

function getAdminPushErrorMessage(error) {
  const code = String(error?.code || error?.name || error?.message || "");
  if (/firebase-context-unavailable/i.test(code)) return "Firebase SDK ვერ ჩაიტვირთა ან Firestore არ არის ხელმისაწვდომი.";
  if (/push-manager-unavailable/i.test(code)) return "ამ ბრაუზერში PushManager არ არის ხელმისაწვდომი.";
  if (/push-registration-no-token-or-subscription/i.test(code)) return "ბრაუზერმა push subscription/token არ დააბრუნა.";
  if (/AbortError/i.test(code)) return "ბრაუზერმა push subscription შეწყვიტა. სცადეთ refresh და ხელახლა ფუშების ჩართვა.";
  if (/InvalidStateError/i.test(code)) return "ძველი push subscription დაზიანებულია. სცადეთ საიტის permissions/cache გასუფთავება და თავიდან ჩართვა.";
  if (/InvalidAccessError|InvalidCharacterError|invalid-argument|invalid argument/i.test(code)) return "ბრაუზერმა push key არ მიიღო. გვერდი განაახლეთ და ფუში თავიდან ჩართეთ; თუ ისევ განმეორდა, ამ ბრაუზერზე Firebase Messaging fallback ჩაირთვება მხოლოდ მხარდაჭერის შემთხვევაში.";
  if (/ServiceWorker|service worker/i.test(code)) return "service worker ვერ დარეგისტრირდა. გვერდი სრულად დაარეფრეშეთ და სცადეთ თავიდან.";
  if (/unsupported|not supported/i.test(code)) return "ამ ბრაუზერს ეს ფუშ ტექნოლოგია არ უჭერს მხარს.";
  if (/firestore|permission|Missing or insufficient permissions/i.test(code)) return "Firebase-ში ფუშ token-ის შენახვა დაიბლოკა.";
  if (/denied|permission/i.test(code)) return "ბრაუზერში notification permission დაბლოკილია.";
  if (/network|fetch|internet/i.test(code)) return "ფუშის ჩართვა ვერ მოხერხდა ინტერნეტის/Firebase კავშირის გამო.";
  return `ფუშ შეტყობინება ვერ ჩაირთო. დეტალი: ${code.slice(0, 120) || "unknown"}`;
}

function getAdminPushCapabilityMessage() {
  const missing = [];
  if (!("Notification" in window)) missing.push("Notification API");
  if (!("serviceWorker" in navigator)) missing.push("Service Worker");
  if (!("PushManager" in window)) missing.push("PushManager");
  if (!canUseAuthorizedPushSession()) missing.push("authorized session");
  return missing.length
    ? `ამ ბრაუზერში ფუში ვერ ჩაირთო. აკლია: ${missing.join(", ")}.`
    : "ამ ბრაუზერში ფუშ შეტყობინებები არ არის ხელმისაწვდომი.";
}
