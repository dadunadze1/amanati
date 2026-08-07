"use strict";

const admin = require("firebase-admin");
const webpush = require("web-push");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const WEB_PUSH_PRIVATE_KEY = defineSecret("WEB_PUSH_PRIVATE_KEY");
const STATIC_STORE_REF = "deliveryApp/staticStore";
const ADMIN_TOKEN_COLLECTION = "adminPushTokens";
const ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION = "adminWebPushSubscriptions";
const ADMIN_NOTIFICATION_COLLECTION = "adminNotifications";
const APP_LINK = "https://dadunadze1.github.io/amanati/frontend/";
const WEB_PUSH_PUBLIC_KEY = "BAEuO5gXFaWrtcaxhWxvzgNc1hlvCYZoNtYdxJno43RqzgANahvbOvrQzaMV7rMTUsDXyGaqa_OW5FrxbYCK4MY";

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
    if (!(await claimAdminNotificationSend(notification))) continue;
    await sendToAdminDevices(notification);
    await markAdminNotificationSent(notification);
    sentUpdates[`sentAdminNotificationIds.${notification.id}`] = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.doc(STATIC_STORE_REF).set(sentUpdates, { merge: true });
});

async function sendToAdminDevices(notification) {
  const tokens = await loadAdminPushTokens(notification);
  const subscriptions = await loadAdminWebPushSubscriptions(notification);
  if (!tokens.length && !subscriptions.length) {
    logger.warn("No push devices registered", { notificationId: notification.id, partnerId: notification.partnerId });
    return;
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
}

async function claimAdminNotificationSend(notification) {
  const ref = db.collection("adminNotificationSendLocks").doc(notification.id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && snapshot.data()?.sentAt) return false;
    if (snapshot.exists && snapshot.data()?.processingAt) return false;
    transaction.set(ref, {
      notificationId: notification.id,
      parcelId: notification.parcelId,
      status: notification.status,
      processingAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function markAdminNotificationSent(notification) {
  await db.collection("adminNotificationSendLocks").doc(notification.id).set({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
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

async function deactivateInvalidWebPushSubscriptions(endpoints) {
  if (!endpoints.length) return;
  const batch = db.batch();
  for (const endpoint of endpoints) {
    batch.set(db.collection(ADMIN_WEB_PUSH_SUBSCRIPTIONS_COLLECTION).doc(getTokenKey(endpoint)), {
      active: false,
      invalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    id: getSafeFieldKey(id || raw.eventKey || raw.parcelId || Date.now()),
    type: String(raw.type || (status === "failed" ? "parcel_failed" : "parcel_delivered")),
    status,
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
