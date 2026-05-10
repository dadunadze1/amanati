"use strict";

const FIREBASE_STATIC_STORE_COLLECTION = "deliveryApp";
const FIREBASE_STATIC_STORE_DOC = "staticStore";

let firebaseInitPromise = null;

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

async function initializeFirebaseStorage() {
  if (!hasFirebaseConfig() || !hasFirebaseSdk()) return null;
  if (firebaseInitPromise) return firebaseInitPromise;

  firebaseInitPromise = Promise.resolve().then(async () => {
    const app = window.firebase.apps?.length
      ? window.firebase.app()
      : window.firebase.initializeApp(firebaseConfig);
    if (window.firebase.auth) {
      const auth = window.firebase.auth(app);
      if (!auth.currentUser) {
        await auth.signInAnonymously().catch((error) => {
          console.warn("[firebase] anonymous auth failed", error);
        });
      }
    }
    const db = window.firebase.firestore(app);
    window.firebaseApp = app;
    window.firebaseDb = db;
    console.log("[firebase] initialized", firebaseConfig.projectId);
    return db;
  }).catch((error) => {
    console.warn("[firebase] init failed", error);
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
    console.log("[firebase] static store loaded");
    return data.store && typeof data.store === "object" ? data.store : data;
  } catch (error) {
    console.warn("[firebase] static store load failed", error);
    return null;
  }
}

async function saveFirebaseStaticStore(store) {
  const db = await initializeFirebaseStorage();
  if (!db || !store || typeof store !== "object") return false;

  try {
    await db.collection(FIREBASE_STATIC_STORE_COLLECTION).doc(FIREBASE_STATIC_STORE_DOC).set({
      store,
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log("[firebase] static store saved");
    return true;
  } catch (error) {
    console.warn("[firebase] static store save failed", error);
    return false;
  }
}
