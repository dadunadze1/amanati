"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const webpush = require("web-push");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();
const WEB_PUSH_PRIVATE_KEY = defineSecret("WEB_PUSH_PRIVATE_KEY");
const STATIC_STORE_REF = "deliveryApp/staticStore";
const ADMIN_TOKEN_COLLECTION = "adminPushTokens";
const ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION = "adminWebPushSubscriptions";
const ADMIN_NOTIFICATION_COLLECTION = "adminNotifications";
const APP_LINK = "https://dadunadze1.github.io/amanati/frontend/";
const WEB_PUSH_PUBLIC_KEY = "BAEuO5gXFaWrtcaxhWxvzgNc1hlvCYZoNtYdxJno43RqzgANahvbOvrQzaMV7rMTUsDXyGaqa_OW5FrxbYCK4MY";
const PUSH_MAX_ATTEMPTS = 5;
const PUSH_RETRY_DELAY_MS = 5 * 60 * 1000;
const PUSH_LOCK_STALE_MS = 2 * 60 * 1000;

exports.sendAdminNotification = onDocumentCreated({
  document: `${ADMIN_NOTIFICATION_COLLECTION}/{notificationId}`,
  region: "europe-west8",
  secrets: [WEB_PUSH_PRIVATE_KEY],
}, async (event) => {
  const notification = normalizeNotification(event.data?.data(), event.params.notificationId);
  if (!notification) return;
  if (!(await claimAdminNotificationSend(notification))) return;
  await sendToAdminDevices(notification);
  await markAdminNotificationSent(notification);
});

exports.sendStaticStoreAdminNotifications = onDocumentWritten({
  document: STATIC_STORE_REF,
  region: "europe-west8",
  secrets: [WEB_PUSH_PRIVATE_KEY],
}, async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  await processStaticStoreNotifications(after, before);
});

exports.retryStaticStorePushNotifications = onSchedule({
  schedule: "every 5 minutes",
  region: "europe-west8",
  secrets: [WEB_PUSH_PRIVATE_KEY],
}, async () => {
  const snapshot = await db.doc(STATIC_STORE_REF).get();
  if (!snapshot.exists) return;
  await processStaticStoreNotifications(snapshot.data() || {}, {});
});

async function processStaticStoreNotifications(after, before = {}) {
  const notifications = after.adminNotifications || {};
  const sent = after.sentAdminNotificationIds || {};
  const beforeSent = before.sentAdminNotificationIds || {};
  const pending = Object.entries(notifications)
    .filter(([id, value]) => shouldProcessStaticNotification(id, value, sent, beforeSent))
    .map(([id, value]) => normalizeNotification(value, id))
    .filter(Boolean);

  if (!pending.length) return;

  const sentUpdates = {};
  for (const notification of pending) {
    if (!(await claimAdminNotificationSend(notification))) continue;
    const attempt = Number(notification.attempts || 0) + 1;
    sentUpdates[`adminNotifications.${notification.id}.deliveryStatus`] = "processing";
    sentUpdates[`adminNotifications.${notification.id}.attempts`] = attempt;
    sentUpdates[`adminNotifications.${notification.id}.lastAttemptAt`] = new Date().toISOString();
    sentUpdates[`adminNotifications.${notification.id}.updatedAt`] = new Date().toISOString();
    try {
      const result = await sendToAdminDevices(notification);
      await markAdminNotificationSent(notification, result);
      sentUpdates[`sentAdminNotificationIds.${notification.id}`] = FieldValue.serverTimestamp();
      sentUpdates[`adminNotifications.${notification.id}.deliveryStatus`] = "sent";
      sentUpdates[`adminNotifications.${notification.id}.sentAt`] = new Date().toISOString();
      sentUpdates[`adminNotifications.${notification.id}.lastError`] = FieldValue.delete();
      sentUpdates[`adminNotifications.${notification.id}.nextAttemptAt`] = FieldValue.delete();
      sentUpdates[`adminNotifications.${notification.id}.updatedAt`] = new Date().toISOString();
    } catch (error) {
      await markAdminNotificationFailed(notification, error);
      const finalFailure = attempt >= PUSH_MAX_ATTEMPTS;
      sentUpdates[`adminNotifications.${notification.id}.deliveryStatus`] = finalFailure ? "failed" : "pending";
      sentUpdates[`adminNotifications.${notification.id}.lastError`] = getErrorMessage(error);
      sentUpdates[`adminNotifications.${notification.id}.nextAttemptAt`] = finalFailure ? FieldValue.delete() : new Date(Date.now() + PUSH_RETRY_DELAY_MS).toISOString();
      sentUpdates[`adminNotifications.${notification.id}.updatedAt`] = new Date().toISOString();
    }
  }

  if (Object.keys(sentUpdates).length) await db.doc(STATIC_STORE_REF).set(sentUpdates, { merge: true });
}

async function sendToAdminDevices(notification) {
  const tokens = await loadAdminPushTokens(notification);
  const subscriptions = await loadAdminWebPushSubscriptions(notification);
  if (!tokens.length && !subscriptions.length) {
    logger.warn("No push devices registered", { notificationId: notification.id, partnerId: notification.partnerId });
    return { fcmSuccessCount: 0, fcmFailureCount: 0, webPushSuccessCount: 0, webPushFailureCount: 0, noDevices: true };
  }

  let fcmResult = { successCount: 0, failureCount: 0 };
  if (tokens.length) {
    const message = {
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: buildPushData(notification),
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
    fcmResult = {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
    await deactivateInvalidTokens(tokens, response.responses);
  }

  const webPushResult = await sendStandardWebPush(subscriptions, notification);
  logger.info("Push sent", {
    notificationId: notification.id,
    partnerId: notification.partnerId,
    fcmSuccessCount: fcmResult.successCount,
    fcmFailureCount: fcmResult.failureCount,
    webPushSuccessCount: webPushResult.successCount,
    webPushFailureCount: webPushResult.failureCount,
  });
  return {
    fcmSuccessCount: fcmResult.successCount,
    fcmFailureCount: fcmResult.failureCount,
    webPushSuccessCount: webPushResult.successCount,
    webPushFailureCount: webPushResult.failureCount,
  };
}

async function claimAdminNotificationSend(notification) {
  const ref = db.collection("adminNotificationSendLocks").doc(notification.id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() || {};
    if (snapshot.exists && data.sentAt) return false;
    const processingAtMs = getTimestampMs(data.processingAt);
    if (processingAtMs && Date.now() - processingAtMs < PUSH_LOCK_STALE_MS) return false;
    transaction.set(ref, {
      notificationId: notification.id,
      parcelId: notification.parcelId,
      status: notification.status,
      attempts: Number(notification.attempts || 0) + 1,
      processingAt: FieldValue.serverTimestamp(),
      failedAt: FieldValue.delete(),
      lastError: FieldValue.delete(),
    }, { merge: true });
    return true;
  });
}

async function markAdminNotificationSent(notification, result = {}) {
  await db.collection("adminNotificationSendLocks").doc(notification.id).set({
    sentAt: FieldValue.serverTimestamp(),
    processingAt: FieldValue.delete(),
    result,
  }, { merge: true });
}

async function markAdminNotificationFailed(notification, error) {
  await db.collection("adminNotificationSendLocks").doc(notification.id).set({
    failedAt: FieldValue.serverTimestamp(),
    processingAt: FieldValue.delete(),
    lastError: getErrorMessage(error),
  }, { merge: true });
}

async function loadAdminPushTokens(notification) {
  const tokens = new Set();

  const collectionSnapshot = await db.collection(ADMIN_TOKEN_COLLECTION).where("active", "==", true).get().catch((error) => {
    logger.warn("Admin token collection read failed", error);
    return null;
  });
  collectionSnapshot?.forEach((doc) => {
    const data = doc.data() || {};
    if (!shouldSendDeviceNotification(data, notification)) return;
    const token = String(data.token || "").trim();
    if (token) tokens.add(token);
  });

  const staticStore = await db.doc(STATIC_STORE_REF).get().catch((error) => {
    logger.warn("Static store token fallback read failed", error);
    return null;
  });
  const fallbackTokens = staticStore?.data()?.adminPushTokens || {};
  Object.values(fallbackTokens).forEach((item) => {
    if (!shouldSendDeviceNotification(item || {}, notification)) return;
    const token = String(item?.token || "").trim();
    if (token && item?.active !== false) tokens.add(token);
  });

  return Array.from(tokens);
}

async function loadAdminWebPushSubscriptions(notification) {
  const subscriptions = new Map();

  const collectionSnapshot = await db.collection(ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION).where("active", "==", true).get().catch((error) => {
    logger.warn("Admin web push subscription collection read failed", error);
    return null;
  });
  collectionSnapshot?.forEach((doc) => {
    const data = doc.data() || {};
    if (!shouldSendDeviceNotification(data, notification)) return;
    const subscription = data.subscription;
    const endpoint = String(subscription?.endpoint || "").trim();
    if (endpoint) subscriptions.set(endpoint, subscription);
  });

  const staticStore = await db.doc(STATIC_STORE_REF).get().catch((error) => {
    logger.warn("Static store web push fallback read failed", error);
    return null;
  });
  const fallbackSubscriptions = staticStore?.data()?.adminWebPushSubscriptions || {};
  Object.values(fallbackSubscriptions).forEach((item) => {
    if (!shouldSendDeviceNotification(item || {}, notification)) return;
    const subscription = item?.subscription;
    const endpoint = String(subscription?.endpoint || "").trim();
    if (endpoint && item?.active !== false) subscriptions.set(endpoint, subscription);
  });

  return Array.from(subscriptions.values());
}

function shouldSendDeviceNotification(device, notification) {
  if (!device || device.active === false) return false;

  const role = normalizeRecipientKey(device.role);
  const recipientRoles = Array.isArray(notification.recipientRoles)
    ? notification.recipientRoles.map(normalizeRecipientKey).filter(Boolean)
    : [];
  const devicePartnerId = normalizeRecipientKey(device.partnerId);
  const devicePartnerUsername = normalizeRecipientKey(device.partnerUsername || device.username);
  const notificationPartnerId = normalizeRecipientKey(notification.partnerId);
  const notificationPartnerUsername = normalizeRecipientKey(notification.partnerUsername);
  const deviceCourierUsername = normalizeRecipientKey(device.username);
  const notificationCourierUsername = normalizeRecipientKey(notification.courierUsername);
  const isPartnerDevice = role === "partner" || Boolean(devicePartnerId);
  const isCourierDevice = role === "courier";

  if (isCourierDevice) {
    if (recipientRoles.length && !recipientRoles.includes("courier")) return false;
    return Boolean(notificationCourierUsername && deviceCourierUsername === notificationCourierUsername);
  }

  if (isPartnerDevice) {
    if (recipientRoles.length && !recipientRoles.includes("partner")) return false;
    return Boolean(
      notificationPartnerId
      && (
        devicePartnerId === notificationPartnerId
        || devicePartnerUsername === notificationPartnerId
        || (notificationPartnerUsername && devicePartnerUsername === notificationPartnerUsername)
      )
    );
  }

  if (role === "admin" || !role) {
    return !recipientRoles.length || recipientRoles.includes("admin");
  }

  return false;
}

async function sendStandardWebPush(subscriptions, notification) {
  if (!subscriptions.length) return { successCount: 0, failureCount: 0 };

  webpush.setVapidDetails(
    "mailto:dadunadze@gmail.com",
    WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY.value().trim(),
  );

  const payload = JSON.stringify({
    ...buildPushData(notification),
    icon: `${APP_LINK}icons/icon-192-v2.png`,
    badge: `${APP_LINK}icons/favicon-v2.png`,
    tag: notification.parcelId || notification.id,
  });

  const results = await Promise.allSettled(subscriptions.map((subscription) => (
    webpush.sendNotification(subscription, payload)
  )));
  const invalidEndpoints = [];
  results.forEach((result, index) => {
    const statusCode = result.reason?.statusCode;
    if (result.status === "rejected" && (statusCode === 404 || statusCode === 410)) {
      invalidEndpoints.push(subscriptions[index]?.endpoint);
    } else if (result.status === "rejected") {
      logger.warn("Standard web push send failed", {
        statusCode,
        message: result.reason?.message || String(result.reason || ""),
      });
    }
  });
  await deactivateInvalidWebPushSubscriptions(invalidEndpoints.filter(Boolean));

  return {
    successCount: results.filter((result) => result.status === "fulfilled").length,
    failureCount: results.filter((result) => result.status === "rejected").length,
  };
}

function buildPushData(notification) {
  return {
    title: notification.title,
    body: notification.body,
    type: notification.type,
    status: notification.status,
    parcelId: notification.parcelId,
    address: notification.address,
    fullName: notification.fullName,
    failureReason: notification.failureReason,
    partnerId: notification.partnerId,
    partnerUsername: notification.partnerUsername,
    partnerName: notification.partnerName,
    courierUsername: notification.courierUsername,
    recipientRoles: Array.isArray(notification.recipientRoles) ? notification.recipientRoles.join(",") : "",
    url: APP_LINK,
  };
}

function shouldProcessStaticNotification(id, value, sent = {}, beforeSent = {}) {
  if (!id || sent[id] || beforeSent[id]) return false;
  if (!value || typeof value !== "object") return false;
  const deliveryStatus = String(value.deliveryStatus || "pending");
  if (deliveryStatus === "sent" || deliveryStatus === "failed") return false;
  if (deliveryStatus === "processing") {
    const processingMs = Date.parse(value.updatedAt || value.lastAttemptAt || "");
    if (!Number.isFinite(processingMs) || Date.now() - processingMs < PUSH_LOCK_STALE_MS) return false;
  }
  const attempts = Number(value.attempts || 0);
  if (Number.isFinite(attempts) && attempts >= PUSH_MAX_ATTEMPTS) return false;
  const nextAttemptMs = Date.parse(value.nextAttemptAt || "");
  return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= Date.now();
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getErrorMessage(error) {
  return String(error?.message || error?.code || error || "unknown-error").slice(0, 500);
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
      invalidatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

async function deactivateInvalidWebPushSubscriptions(endpoints) {
  if (!endpoints.length) return;
  const batch = db.batch();
  for (const endpoint of endpoints) {
    batch.set(db.collection(ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION).doc(getTokenKey(endpoint)), {
      active: false,
      invalidatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

function normalizeNotification(raw, id) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || "");
  if (!["delivered", "failed", "created", "assigned"].includes(status)) return null;

  const address = String(raw.address || "").trim();
  const fullName = String(raw.fullName || "").trim();
  const failureReason = String(raw.failureReason || "").trim();
  const partnerId = String(raw.partnerId || "").trim();
  const partnerUsername = String(raw.partnerUsername || "").trim();
  const partnerName = String(raw.partnerName || "").trim();
  const courierUsername = String(raw.courierUsername || "").trim();
  const recipientRoles = Array.isArray(raw.recipientRoles)
    ? raw.recipientRoles.map((role) => String(role || "").trim()).filter(Boolean)
    : [];
  const title = String(raw.title || getDefaultNotificationTitle(status)).trim();
  const details = String(raw.body || [address, fullName].filter(Boolean).join(", ") || "შეკვეთის სტატუსი შეიცვალა").trim();
  const body = status === "failed" && failureReason && !details.includes(failureReason)
    ? `${details}\nმიზეზი: ${failureReason}`
    : details;

  return {
    id: getSafeFieldKey(raw.eventKey || id || raw.parcelId || Date.now()),
    type: String(raw.type || (status === "failed" ? "parcel_failed" : "parcel_delivered")),
    status,
    attempts: Number(raw.attempts || 0),
    title,
    body,
    parcelId: String(raw.parcelId || ""),
    address,
    fullName,
    failureReason,
    partnerId,
    partnerUsername,
    partnerName,
    courierUsername,
    recipientRoles,
  };
}

function getDefaultNotificationTitle(status) {
  if (status === "failed") return "შეკვეთა ვერ ჩაბარდა";
  if (status === "created") return "ახალი ამანათი";
  if (status === "assigned") return "ახალი ამანათი გაქვთ";
  return "შეკვეთა ჩაბარდა";
}

function normalizeRecipientKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function getTokenKey(token) {
  return Buffer.from(String(token || "")).toString("base64").replace(/[+/=]/g, "_").slice(0, 180) || `token_${Date.now()}`;
}

function getSafeFieldKey(value) {
  return String(value || "")
    .replace(/[.[\]*`/]/g, "_")
    .slice(0, 180) || `notification_${Date.now()}`;
}
