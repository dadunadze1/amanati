"use strict";

const FIREBASE_STATIC_STORE_COLLECTION = "deliveryApp";
const FIREBASE_STATIC_STORE_DOC = "staticStore";
const FIREBASE_STATIC_STORE_SPLIT_KEYS = ["users", "pending", "parcels", "history", "zones", "financeData", "adminNotifications", "settings"];
const FIREBASE_SYNC_TOAST_THROTTLE_MS = 60 * 1000;
const FIREBASE_SYNC_TIMEOUT_MS = 12000;
const FIREBASE_SYNC_REQUIRED_MESSAGE = "საერთო Firebase სინქი ვერ შესრულდა. ცვლილება არ შეინახა. შეამოწმეთ ინტერნეტი და თავიდან სცადეთ.";

let firebaseInitPromise = null;
let firebaseStoreUnsubscribe = null;
let firebaseCourierLocationsUnsubscribe = null;
let lastFirebaseStoreJson = "";
let firebaseAuthUnavailable = false;
let firebaseAuthWarningShown = false;

function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadData(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearData(key) {
  localStorage.removeItem(key);
}

function hasFirebaseConfig() {
  return typeof firebaseConfig === "object" && firebaseConfig && firebaseConfig.apiKey;
}

function hasFirebaseSdk() {
  return Boolean(window.firebase?.initializeApp && window.firebase?.firestore);
}

function markFirebaseSyncIssue(message) {
  if (typeof state !== "object") return;
  state.firebaseSyncStatus = "error";
  if (!state.currentUser || typeof showToast !== "function") return;

  const now = Date.now();
  if (now - state.lastFirebaseSyncToastAt < FIREBASE_SYNC_TOAST_THROTTLE_MS) return;
  state.lastFirebaseSyncToastAt = now;
  showToast(message || "Firebase სინქი დროებით ვერ მუშაობს. ცვლილება ლოკალურად შეინახა.");
}

function markFirebaseSyncOk() {
  if (typeof state !== "object") return;
  const wasError = state.firebaseSyncStatus === "error";
  state.firebaseSyncStatus = "ok";
  if (wasError && state.currentUser && typeof showToast === "function") {
    showToast("Firebase სინქი აღდგა.");
  }
}

function withFirebaseTimeout(promise, label = "Firebase") {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timeout`)), FIREBASE_SYNC_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

function throwRequiredFirebaseSync(error) {
  const syncError = new Error(FIREBASE_SYNC_REQUIRED_MESSAGE);
  syncError.code = "firebase_sync_required";
  syncError.status = 503;
  syncError.cause = error;
  throw syncError;
}

function extractFirebaseStaticStore(data = {}) {
  const legacyStore = data.store && typeof data.store === "object" ? data.store : {};
  const splitStore = {};
  let hasSplitStore = false;
  FIREBASE_STATIC_STORE_SPLIT_KEYS.forEach((key) => {
    if (data[key] !== undefined) {
      splitStore[key] = data[key];
      hasSplitStore = true;
    }
  });
  if (hasSplitStore) return { ...legacyStore, ...splitStore };
  if (data.store && typeof data.store === "object") return data.store;
  const fallback = {};
  FIREBASE_STATIC_STORE_SPLIT_KEYS.forEach((key) => {
    if (data[key] !== undefined) fallback[key] = data[key];
  });
  return Object.keys(fallback).length ? fallback : data;
}

function buildFirebaseStaticStorePayload(store) {
  const payload = {
    store,
    storeSchemaVersion: 2,
    storeUpdatedAt: new Date().toISOString(),
  };
  FIREBASE_STATIC_STORE_SPLIT_KEYS.forEach((key) => {
    if (store[key] !== undefined) payload[key] = store[key];
  });
  return payload;
}

async function initializeFirebaseStorage() {
  if (firebaseAuthUnavailable) return null;
  if (!hasFirebaseConfig() || !hasFirebaseSdk()) return null;
  if (firebaseInitPromise) return firebaseInitPromise;

  firebaseInitPromise = Promise.resolve().then(async () => {
    const app = window.firebase.apps?.length
      ? window.firebase.app()
      : window.firebase.initializeApp(firebaseConfig);
    if (window.firebase.auth) {
      const auth = window.firebase.auth(app);
      if (!auth.currentUser) {
        try {
          await withFirebaseTimeout(auth.signInAnonymously(), "Firebase auth");
        } catch (error) {
          firebaseAuthUnavailable = true;
          if (!firebaseAuthWarningShown) {
            firebaseAuthWarningShown = true;
            console.warn("[firebase] anonymous auth failed", error);
          }
          markFirebaseSyncIssue("Firebase ავტორიზაცია ვერ ჩაირთო. საერთო სინქი დროებით გამორთულია.");
          return null;
        }
      }
    }
    const db = window.firebase.firestore(app);
    window.firebaseApp = app;
    window.firebaseDb = db;
    console.log("[firebase] initialized", firebaseConfig.projectId);
    return db;
  }).catch((error) => {
    console.warn("[firebase] init failed", error);
    markFirebaseSyncIssue("Firebase ვერ ჩაირთო. ინტერნეტი ან Firebase პარამეტრები შეამოწმე.");
    return null;
  });

  return firebaseInitPromise;
}

async function loadFirebaseStaticStore(options = {}) {
  const requireFirebase = options.requireFirebase === true;
  const db = await initializeFirebaseStorage();
  if (!db) {
    if (requireFirebase) throwRequiredFirebaseSync();
    return null;
  }

  try {
    const snapshot = await withFirebaseTimeout(db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).get(), "Firebase load");
    if (!snapshot.exists) {
      console.log("[firebase] static store empty");
      return null;
    }
    const data = snapshot.data() || {};
    const store = extractFirebaseStaticStore(data);
    lastFirebaseStoreJson = JSON.stringify(store);
    console.log("[firebase] static store loaded");
    markFirebaseSyncOk();
    return store;
  } catch (error) {
    console.warn("[firebase] static store load failed", error);
    if (requireFirebase) {
      markFirebaseSyncIssue(FIREBASE_SYNC_REQUIRED_MESSAGE);
      throwRequiredFirebaseSync(error);
    }
    markFirebaseSyncIssue("Firebase მონაცემების ჩატვირთვა ვერ მოხერხდა.");
    return null;
  }
}

async function saveFirebaseStaticStore(store, options = {}) {
  const requireFirebase = options.requireFirebase === true;
  const db = await initializeFirebaseStorage();
  if (!db || !store || typeof store !== "object") {
    if (requireFirebase) throwRequiredFirebaseSync();
    return false;
  }

  try {
    const storeJson = JSON.stringify(store);
    if (storeJson && storeJson === lastFirebaseStoreJson) return true;
    const docRef = db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC);
    const savedStore = await withFirebaseTimeout(saveFirebaseStaticStoreTransaction(db, docRef, store), "Firebase save");
    lastFirebaseStoreJson = JSON.stringify(savedStore || store);
    if (savedStore && typeof loadStaticBootstrap === "function" && loadStaticBootstrap.cache) {
      loadStaticBootstrap.cache = savedStore;
    }
    console.log("[firebase] static store saved");
    markFirebaseSyncOk();
    return true;
  } catch (error) {
    console.warn("[firebase] static store save failed", error);
    if (requireFirebase) {
      markFirebaseSyncIssue(FIREBASE_SYNC_REQUIRED_MESSAGE);
      throwRequiredFirebaseSync(error);
    }
    markFirebaseSyncIssue("Firebase-ში შენახვა ვერ მოხერხდა. ცვლილება არ გავრცელდა.");
    return false;
  }
}

async function saveFirebaseStaticStoreTransaction(db, docRef, store) {
  if (typeof mergeStaticStores !== "function" || typeof normalizeStaticStore !== "function") {
    await docRef.set({
      ...buildFirebaseStaticStorePayload(store),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return store;
  }

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const remoteStore = snapshot.exists ? extractFirebaseStaticStore(snapshot.data() || {}) : {};
    const mergedStore = normalizeStaticStore(mergeStaticStores(remoteStore, store));
    transaction.set(docRef, {
      ...buildFirebaseStaticStorePayload(mergedStore),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return mergedStore;
  });
}

async function startFirebaseStaticStoreListener(onStoreChange) {
  if (firebaseStoreUnsubscribe) return firebaseStoreUnsubscribe;
  const db = await initializeFirebaseStorage();
  if (!db) return null;

  firebaseStoreUnsubscribe = db
    .collection(FIREBASE_STATIC_STORE_COLLECTION)
    .doc(FIREBASE_STATIC_STORE_DOC)
    .onSnapshot((snapshot) => {
      if (snapshot.metadata?.hasPendingWrites) return;
      if (!snapshot.exists) return;
      const data = snapshot.data() || {};
      const store = extractFirebaseStaticStore(data);
      const storeJson = JSON.stringify(store);
      if (!storeJson || storeJson === lastFirebaseStoreJson) return;
      lastFirebaseStoreJson = storeJson;
      console.log("[firebase] realtime static store update");
      markFirebaseSyncOk();
      onStoreChange?.(store);
    }, (error) => {
      console.warn("[firebase] realtime listener failed", error);
      markFirebaseSyncIssue("Firebase live სინქი გაითიშა. ინტერნეტი შეამოწმე.");
    });

  console.log("[firebase] realtime listener started");
  markFirebaseSyncOk();
  return firebaseStoreUnsubscribe;
}

function stopFirebaseStaticStoreListener() {
  if (!firebaseStoreUnsubscribe) return;
  firebaseStoreUnsubscribe();
  firebaseStoreUnsubscribe = null;
}

function getCourierLocationKey(username) {
  return encodeURIComponent(normalizeUsername(username))
    .replace(/%/g, "_")
    .replace(/[^a-z0-9_~-]/gi, "_");
}

async function saveFirebaseCourierLocation(location) {
  if (CONFIG.enableCourierLiveTracking === false) return false;
  const db = await initializeFirebaseStorage();
  if (!db || !location?.username) return false;

  try {
    const key = getCourierLocationKey(location.username);
    await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
      courierLocations: {
        [key]: {
          username: location.username,
          displayName: location.displayName || location.username,
          phone: location.phone || "",
          lat: Number(location.lat),
          lng: Number(location.lng),
          status: location.status || "online",
          updatedAt: location.updatedAt || new Date().toISOString(),
        },
      },
      courierLocationsUpdatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    markFirebaseSyncOk();
    return true;
  } catch (error) {
    console.warn("[firebase] courier location save failed", error);
    markFirebaseSyncIssue("კურიერის live ლოკაცია Firebase-ში ვერ განახლდა.");
    return false;
  }
}

async function startFirebaseCourierLocationsListener(onLocationsChange) {
  if (CONFIG.enableCourierLiveTracking === false) {
    onLocationsChange?.({});
    return null;
  }
  if (firebaseCourierLocationsUnsubscribe) return firebaseCourierLocationsUnsubscribe;
  const db = await initializeFirebaseStorage();
  if (!db) return null;

  firebaseCourierLocationsUnsubscribe = db
    .collection(FIREBASE_STATIC_STORE_COLLECTION)
    .doc(FIREBASE_STATIC_STORE_DOC)
    .onSnapshot((snapshot) => {
      const data = snapshot.data() || {};
      markFirebaseSyncOk();
      onLocationsChange?.(data.courierLocations && typeof data.courierLocations === "object" ? data.courierLocations : {});
    }, (error) => {
      console.warn("[firebase] courier locations listener failed", error);
      markFirebaseSyncIssue("კურიერების live ლოკაციების სინქი გაითიშა.");
    });

  return firebaseCourierLocationsUnsubscribe;
}

function stopFirebaseCourierLocationsListener() {
  if (!firebaseCourierLocationsUnsubscribe) return;
  firebaseCourierLocationsUnsubscribe();
  firebaseCourierLocationsUnsubscribe = null;
}
