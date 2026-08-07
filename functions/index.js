"use strict";

const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const STATIC_STORE_REF = "deliveryApp/staticStore";
const ADMIN_TOKEN_COLLECTION = "adminPushTokens";
const ADMIN_NOTIFICATION_COLLECTION = "adminNotifications";
const APP_LINK = "https://dadunadze1.github.io/amanati/frontend/";

exports.sendAdminNotification = onDocumentCreated(`${ADMIN_NOTIFICATION_COLLECTION}/{notificationId}`, async (event) => {
  const notification = normalizeNotification(event.data?.data(), event.params.notificationId);
  if (!notification) return;
  await sendToAdminDevices(notification);
});

exports.sendStaticStoreAdminNotifications = onDocumentWritten(STATIC_STORE_REF, async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  const notifications = after.adminNotifications || {};
  const sent = after.sentAdminNotificationIds || {};
  const beforeSent = before.sentAdminNotificationIds || {};
  const pending = Object.entries(notifications)
    .filter(([id]) => !sent[id] && !beforeSent[id])
    .map(([id, value]) => normalizeNotification(value, id))
    .filter(Boolean);

  if (!pending.length) return;

  const sentUpdates = {};
  for (const notification of pending) {
    await sendToAdminDevices(notification);
    sentUpdates[`sentAdminNotificationIds.${notification.id}`] = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.doc(STATIC_STORE_REF).set(sentUpdates, { merge: true });
});

async function sendToAdminDevices(notification) {
  const tokens = await loadAdminPushTokens();
  if (!tokens.length) {
    logger.warn("No admin push tokens registered", { notificationId: notification.id });
    return;
  }

  const message = {
    tokens,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: {
      title: notification.title,
      body: notification.body,
      type: notification.type,
      status: notification.status,
      parcelId: notification.parcelId,
      address: notification.address,
      fullName: notification.fullName,
      failureReason: notification.failureReason,
      url: APP_LINK,
    },
    webpush: {
      fcmOptions: {
        link: APP_LINK,
      },
      notification: {
        icon: `${APP_LINK}icons/icon-192-v2.png`,
        badge: `${APP_LINK}icons/favicon-v2.png`,
        tag: notification.parcelId || notification.id,
        requireInteraction: false,
      },
    },
  };

  const response = await messaging.sendEachForMulticast(message);
  logger.info("Admin push sent", {
    notificationId: notification.id,
    successCount: response.successCount,
    failureCount: response.failureCount,
  });

  await deactivateInvalidTokens(tokens, response.responses);
}

async function loadAdminPushTokens() {
  const tokens = new Set();

  const collectionSnapshot = await db.collection(ADMIN_TOKEN_COLLECTION).where("active", "==", true).get().catch((error) => {
    logger.warn("Admin token collection read failed", error);
    return null;
  });
  collectionSnapshot?.forEach((doc) => {
    const token = String(doc.data()?.token || "").trim();
    if (token) tokens.add(token);
  });

  const staticStore = await db.doc(STATIC_STORE_REF).get().catch((error) => {
    logger.warn("Static store token fallback read failed", error);
    return null;
  });
  const fallbackTokens = staticStore?.data()?.adminPushTokens || {};
  Object.values(fallbackTokens).forEach((item) => {
    const token = String(item?.token || "").trim();
    if (token && item?.active !== false) tokens.add(token);
  });

  return Array.from(tokens);
}

async function deactivateInvalidTokens(tokens, responses) {
  const invalidTokens = tokens.filter((token, index) => {
    const code = responses[index]?.error?.code || "";
    return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token";
  });
  if (!invalidTokens.length) return;

  const batch = db.batch();
  for (const token of invalidTokens) {
    batch.set(db.collection(ADMIN_TOKEN_COLLECTION).doc(getTokenKey(token)), {
      active: false,
      invalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

function normalizeNotification(raw, id) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || "");
  if (!["delivered", "failed"].includes(status)) return null;

  const address = String(raw.address || "").trim();
  const fullName = String(raw.fullName || "").trim();
  const failureReason = String(raw.failureReason || "").trim();
  const title = String(raw.title || (status === "failed" ? "შეკვეთა ვერ ჩაბარდა" : "შეკვეთა ჩაბარდა")).trim();
  const details = String(raw.body || [address, fullName].filter(Boolean).join(", ") || "შეკვეთის სტატუსი შეიცვალა").trim();
  const body = status === "failed" && failureReason && !details.includes(failureReason)
    ? `${details}\nმიზეზი: ${failureReason}`
    : details;

  return {
    id: getSafeFieldKey(id || raw.eventKey || raw.parcelId || Date.now()),
    type: String(raw.type || (status === "failed" ? "parcel_failed" : "parcel_delivered")),
    status,
    title,
    body,
    parcelId: String(raw.parcelId || ""),
    address,
    fullName,
    failureReason,
  };
}

function getTokenKey(token) {
  return Buffer.from(String(token || "")).toString("base64").replace(/[+/=]/g, "_").slice(0, 180) || `token_${Date.now()}`;
}

function getSafeFieldKey(value) {
  return String(value || "")
    .replace(/[.[\]*`/]/g, "_")
    .slice(0, 180) || `notification_${Date.now()}`;
}
