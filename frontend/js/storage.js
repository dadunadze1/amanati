"use strict";

const FIREBASE_STATIC_STORE_COLLECTION = "deliveryApp";
const FIREBASE_STATIC_STORE_DOC = "staticStore";
const FIREBASE_STATIC_STORE_SPLIT_KEYS = ["users", "pending", "parcels", "history", "zones", "financeData", "adminNotifications", "settings"];
const FIREBASE_SYNC_TOAST_THROTTLE_MS = 60 * 1000;
const FIREBASE_STATIC_STORE_SAVE_TIMEOUT_MS = 12000;
const FIREBASE_SYNC_REQUIRED_MESSAGE = "საერთო სინქი ვერ შესრულდა. ცვლილება არ გავრცელდა სხვა მოწყობილობებზე, ინტერნეტი შეამოწმეთ და თავიდან სცადეთ.";

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

function withFirebaseTimeout(promise, ms, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label || "firebase"} timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function encodeFirestoreRestValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreRestValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: Number.isFinite(value) ? value : 0 };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreRestValue(item)])),
      },
    };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreRestFields(data) {
  return Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [key, encodeFirestoreRestValue(value)]));
}

function decodeFirestoreRestValue(value) {
  if (!value || typeof value !== "object") return value;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, "arrayValue")) {
    return (value.arrayValue.values || []).map(decodeFirestoreRestValue);
  }
  if (Object.prototype.hasOwnProperty.call(value, "mapValue")) {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestoreRestValue(item)]));
  }
  return value;
}

function decodeFirestoreRestDocument(documentData = {}) {
  return Object.fromEntries(Object.entries(documentData.fields || {}).map(([key, value]) => [key, decodeFirestoreRestValue(value)]));
}

async function getFirebaseRestIdToken() {
  try {
    const app = window.firebase?.apps?.length ? window.firebase.app() : null;
    const currentUser = app && window.firebase?.auth ? window.firebase.auth(app).currentUser : null;
    if (currentUser?.getIdToken) return currentUser.getIdToken();
  } catch (error) {
    console.warn("[firebase] sdk token unavailable for rest fallback", error);
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.idToken) throw new Error(payload.error?.message || "firebase rest auth failed");
  return payload.idToken;
}

async function saveFirebaseStaticStoreViaRest(store) {
  if (!hasFirebaseConfig() || !store || typeof store !== "object") return null;
  const token = await getFirebaseRestIdToken();
  const documentName = `projects/${firebaseConfig.projectId}/databases/(default)/documents/${FIREBASE_STATIC_STORE_COLLECTION}/${FIREBASE_STATIC_STORE_DOC}`;
  const documentUrl = `https://firestore.googleapis.com/v1/${documentName}`;
  let remoteStore = {};

  const currentResponse = await fetch(documentUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (currentResponse.ok) {
    const currentDocument = await currentResponse.json().catch(() => ({}));
    remoteStore = extractFirebaseStaticStore(decodeFirestoreRestDocument(currentDocument));
  } else if (currentResponse.status !== 404) {
    const payload = await currentResponse.json().catch(() => ({}));
    throw new Error(payload.error?.message || "firebase rest read failed");
  }

  const mergedStore = typeof mergeStaticStores === "function" && typeof normalizeStaticStore === "function"
    ? normalizeStaticStore(mergeStaticStores(remoteStore, store))
    : store;
  const payload = buildFirebaseStaticStorePayload(mergedStore);
  const fieldPaths = Object.keys(payload);
  const commitResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: documentName,
            fields: encodeFirestoreRestFields(payload),
          },
          updateMask: { fieldPaths },
          updateTransforms: [
            { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
          ],
        },
      ],
    }),
  });
  const commitPayload = await commitResponse.json().catch(() => ({}));
  if (!commitResponse.ok) throw new Error(commitPayload.error?.message || "firebase rest write failed");
  console.log("[firebase] static store saved with rest fallback");
  return mergedStore;
}

async function initializeFirebaseStorage() {
  if (firebaseAuthUnavailable) firebaseAuthUnavailable = false;
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
          await auth.signInAnonymously();
        } catch (error) {
          firebaseInitPromise = null;
          if (!firebaseAuthWarningShown) {
            firebaseAuthWarningShown = true;
            console.warn("[firebase] anonymous auth failed", error);
          }
          markFirebaseSyncIssue("Firebase ავტორიზაცია ვერ ჩაირთო. საერთო სინქი არ მუშაობს.");
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
    firebaseInitPromise = null;
    console.warn("[firebase] init failed", error);
    markFirebaseSyncIssue("Firebase ვერ ჩაირთო. ინტერნეტი ან Firebase პარამეტრები შეამოწმე.");
    return null;
  });

  return firebaseInitPromise;
}

async function loadFirebaseStaticStore() {
  const db = await initializeFirebaseStorage();
  if (!db) return null;

  try {
    const snapshot = await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).get();
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
    markFirebaseSyncIssue("Firebase მონაცემების ჩატვირთვა ვერ მოხერხდა.");
    return null;
  }
}

async function saveFirebaseStaticStore(store, options = {}) {
  const db = await withFirebaseTimeout(initializeFirebaseStorage(), FIREBASE_STATIC_STORE_SAVE_TIMEOUT_MS, "firebase init").catch((error) => {
    console.warn("[firebase] init timed out before save", error);
    return null;
  });
  if (!db || !store || typeof store !== "object") {
    const restSavedStore = await saveFirebaseStaticStoreViaRest(store).catch((error) => {
      console.warn("[firebase] rest fallback save failed", error);
      return null;
    });
    if (restSavedStore) {
      lastFirebaseStoreJson = JSON.stringify(restSavedStore);
      if (typeof loadStaticBootstrap === "function" && loadStaticBootstrap.cache) {
        loadStaticBootstrap.cache = restSavedStore;
        saveData(STATIC_DEPLOY_STORAGE_KEY, restSavedStore);
      }
      markFirebaseSyncOk();
      return true;
    }
    if (options.requireFirebase) throw new Error(FIREBASE_SYNC_REQUIRED_MESSAGE);
    return false;
  }

  try {
    const storeJson = JSON.stringify(store);
    if (storeJson && storeJson === lastFirebaseStoreJson) return true;
    const docRef = db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC);
    const savedStore = await withFirebaseTimeout(saveFirebaseStaticStoreTransaction(db, docRef, store), FIREBASE_STATIC_STORE_SAVE_TIMEOUT_MS, "firebase save")
      .catch(async (error) => {
        console.warn("[firebase] sdk save timed out or failed; trying rest fallback", error);
        return saveFirebaseStaticStoreViaRest(store);
      });
    lastFirebaseStoreJson = JSON.stringify(savedStore || store);
    if (savedStore && typeof loadStaticBootstrap === "function" && loadStaticBootstrap.cache) {
      loadStaticBootstrap.cache = savedStore;
      saveData(STATIC_DEPLOY_STORAGE_KEY, savedStore);
    }
    console.log("[firebase] static store saved");
    markFirebaseSyncOk();
    return true;
  } catch (error) {
    console.warn("[firebase] static store save failed", error);
    markFirebaseSyncIssue("Firebase-ში შენახვა ვერ მოხერხდა. ცვლილება ამ მოწყობილობაზე დარჩა.");
    if (options.requireFirebase) throw new Error(FIREBASE_SYNC_REQUIRED_MESSAGE);
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
