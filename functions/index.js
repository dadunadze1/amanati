"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const webpush = require("web-push");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { GoogleAuth } = require("google-auth-library");

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
const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";
const MAX_STICKER_IMAGE_BASE64_LENGTH = 7 * 1024 * 1024;
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const ALLOWED_ORIGINS = new Set([
  "https://dadunadze1.github.io",
  "https://dadunadze1.github.io/amanati",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

exports.extractParcelFromSticker = onRequest({
  region: "europe-west8",
  cors: false,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  try {
    const image = cleanBase64Image(req.body?.image || req.body?.imageBase64 || "");
    const mimeType = String(req.body?.mimeType || "").trim();
    if (!image) throw httpError(400, "სურათი ვერ მოიძებნა.");
    if (image.length > MAX_STICKER_IMAGE_BASE64_LENGTH) throw httpError(413, "სურათი ძალიან დიდია.");
    if (mimeType && !/^image\/(png|jpe?g|webp)$/i.test(mimeType)) throw httpError(400, "სურათის ფორმატი მხარდაჭერილი არ არის.");

    const ocr = await detectStickerText(image);
    const parsed = parseStickerText(ocr.text);
    res.json({
      ...parsed,
      rawText: ocr.text,
      confidence: ocr.confidence,
      source: "google-vision",
    });
  } catch (error) {
    logger.warn("Sticker OCR failed", {
      status: error.status || 500,
      code: error.code || "",
      message: getErrorMessage(error),
      publicMessage: error.publicMessage || "",
    });
    res.status(error.status || 500).json({
      error: error.publicMessage || "ფოტოს წაკითხვა ვერ მოხერხდა.",
      code: error.code || "sticker-ocr-failed",
    });
  }
});

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

async function detectStickerText(imageBase64) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(VISION_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [{
        image: { content: imageBase64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: { languageHints: ["ka", "en"] },
      }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = payload?.error?.message || `Google Vision error ${response.status}`;
    if (response.status === 403) {
      throw httpError(503, "Google Vision API ჯერ არ არის ჩართული Firebase/Google Cloud პროექტში.", "vision-api-disabled", apiMessage);
    }
    throw httpError(response.status, "ფოტოს წაკითხვა ვერ მოხერხდა.", "vision-api-failed", apiMessage);
  }

  const result = payload?.responses?.[0] || {};
  if (result.error) {
    throw httpError(502, "Google Vision-მა სურათი ვერ წაიკითხა.", "vision-response-error", result.error.message || result.error.code);
  }
  const annotation = result.fullTextAnnotation || {};
  const text = String(annotation.text || result.textAnnotations?.[0]?.description || "").trim();
  if (!text) throw httpError(422, "სტიკერზე ტექსტი ვერ ამოვიკითხე.", "no-text-found");
  return { text, confidence: calculateVisionConfidence(annotation) };
}

async function getGoogleAccessToken() {
  const client = await googleAuth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = String(tokenResponse?.token || tokenResponse || "").trim();
  if (!token) throw httpError(503, "Google Cloud ავტორიზაციის token ცარიელია.", "google-auth-token-empty");
  return token;
}

function parseStickerText(text) {
  const lines = normalizeStickerLines(text);
  const phone = extractStickerPhone(lines.join("\n"));
  const paymentAmount = extractStickerAmount(lines);
  const fullName = extractStickerName(lines, phone, paymentAmount);
  const address = extractStickerAddress(lines, phone, paymentAmount, fullName);
  const warnings = [];
  if (!address) warnings.push("მისამართი ვერ ამოვიცანი.");
  if (!phone) warnings.push("ტელეფონის ნომერი ვერ ამოვიცანი.");
  if (!fullName) warnings.push("მიმღების სახელი ვერ ამოვიცანი.");
  if (!Number.isFinite(paymentAmount)) warnings.push("ქეშის თანხა ვერ ამოვიცანი.");

  return {
    address,
    fullName,
    phone,
    paymentAmount: Number.isFinite(paymentAmount) ? paymentAmount : 0,
    lines,
    warnings,
  };
}

function normalizeStickerLines(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[|•·]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function extractStickerPhone(text) {
  const normalized = String(text || "").replace(/[–—−]/g, "-");
  const match = normalized.match(/(?:\+?\s*995\s*)?(5\d{2})\D{0,4}(\d{2})\D{0,4}(\d{2})\D{0,4}(\d{2})/);
  if (!match) return "";
  return `+995${match[1]}${match[2]}${match[3]}${match[4]}`;
}

function extractStickerAmount(lines) {
  const currencyPattern = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:ლარი|ლ\b|gel\b|₾)/i;
  for (const line of lines) {
    if (looksLikePhoneLine(line)) continue;
    const match = line.match(currencyPattern);
    if (match) return normalizeStickerMoney(match[1]);
  }

  const keywordLines = lines.filter((line) => !looksLikePhoneLine(line) && /თანხ|ქეშ|გადასახდ|ფასი/i.test(line));
  const bottomLines = lines
    .filter((line) => !looksLikePhoneLine(line) && !looksLikeBareBuildingLine(line))
    .slice(-3)
    .reverse();
  const likelyLines = keywordLines.length ? keywordLines : bottomLines;
  for (const line of likelyLines) {
    const numbers = [...line.matchAll(/\b(\d{1,3}(?:[.,]\d{1,2})?)\b/g)]
      .map((match) => normalizeStickerMoney(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 1000);
    if (numbers.length) return numbers[numbers.length - 1];
  }
  return NaN;
}

function normalizeStickerMoney(value) {
  const amount = Number(String(value || "").replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
}

function extractStickerName(lines, phone, paymentAmount) {
  const candidates = lines
    .map((line) => stripStickerLineNoise(line, phone, paymentAmount))
    .filter((line) => line && !looksLikeAddressLine(line) && !looksLikePhoneLine(line) && !looksLikeAmountLine(line))
    .map((line) => line.replace(/[0-9#+№.,:;()/-]/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => countGeorgianLetters(line) >= 4 && line.length <= 48);
  return candidates.sort((a, b) => scoreNameLine(b) - scoreNameLine(a))[0] || "";
}

function extractStickerAddress(lines, phone, paymentAmount, fullName) {
  const candidates = lines
    .map((line) => stripStickerLineNoise(line, phone, paymentAmount))
    .filter((line) => line && line !== fullName && !looksLikePhoneLine(line) && !looksLikeAmountLine(line))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !looksLikeBareBuildingLine(line))
    .filter((line) => scoreAddressLine(line) >= 5);
  const addressLine = candidates.sort((a, b) => scoreAddressLine(b) - scoreAddressLine(a))[0] || "";
  return normalizeStickerAddress(addressLine);
}

function stripStickerLineNoise(line, phone, paymentAmount) {
  let value = String(line || "").trim();
  if (phone) {
    const local = phone.replace("+995", "");
    value = value.replace(new RegExp(local.split("").join("\\D*"), "g"), " ");
  }
  if (Number.isFinite(paymentAmount)) {
    value = value.replace(new RegExp(`\\b${String(paymentAmount).replace(".", "[.,]")}\\b\\s*(?:ლარი|ლ|gel|₾)?`, "gi"), " ");
  }
  return value.replace(/\s+/g, " ").trim();
}

function looksLikePhoneLine(line) {
  return /(?:\+?\s*995\s*)?5\d{2}\D{0,4}\d{2}\D{0,4}\d{2}\D{0,4}\d{2}/.test(String(line || ""));
}

function looksLikeAmountLine(line) {
  return /(?:ლარი|ლ\b|gel\b|₾|თანხ|ქეშ|ფასი|გადასახდ)/i.test(String(line || ""));
}

function looksLikeBareBuildingLine(line) {
  return /^(?:n|no\.?|№|#)?\s*\d{1,4}[a-zა-ჰ]?\s*$/i.test(String(line || "").trim());
}

function looksLikeAddressLine(line) {
  return scoreAddressLine(line) >= 4;
}

function scoreAddressLine(line) {
  const value = String(line || "");
  let score = 0;
  if (/\d/.test(value)) score += 3;
  if (/(ქუჩა|ქ\.?|გამზირი|გამზ\.?|ჩიხი|შესახვევი|გზატკეცილი|პროსპექტი|№|#|n\s?\d)/i.test(value)) score += 5;
  if (/(თბილისი|რუსთავი|ვაკე|საბურთალო|ისანი|სამგორი|გლდანი|დიღომი|ვარკეთილი|ვერა|მთაწმინდა)/i.test(value)) score += 2;
  if (countGeorgianLetters(value) >= 4) score += 1;
  if (value.length > 80) score -= 2;
  return score;
}

function scoreNameLine(line) {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  let score = countGeorgianLetters(line);
  if (words.length >= 2 && words.length <= 4) score += 8;
  if (words.length === 1) score += 2;
  return score;
}

function normalizeStickerAddress(value) {
  const address = String(value || "")
    .replace(/^[,.\-:; ]+|[,.\-:; ]+$/g, "")
    .replace(/\s+(№|#)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!address) return "";
  return /თბილისი|რუსთავი/i.test(address) ? address : `თბილისი, ${address}`;
}

function countGeorgianLetters(value) {
  return (String(value || "").match(/[ა-ჰ]/g) || []).length;
}

function calculateVisionConfidence(annotation) {
  const confidences = [];
  const pages = Array.isArray(annotation?.pages) ? annotation.pages : [];
  pages.forEach((page) => {
    (page.blocks || []).forEach((block) => {
      if (Number.isFinite(block.confidence)) confidences.push(block.confidence);
      (block.paragraphs || []).forEach((paragraph) => {
        if (Number.isFinite(paragraph.confidence)) confidences.push(paragraph.confidence);
        (paragraph.words || []).forEach((word) => {
          if (Number.isFinite(word.confidence)) confidences.push(word.confidence);
        });
      });
    });
  });
  if (!confidences.length) return 0;
  return Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100;
}

function cleanBase64Image(value) {
  return String(value || "")
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s+/g, "");
}

function setCorsHeaders(req, res) {
  const origin = String(req.headers.origin || "");
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) || origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com")
    ? origin
    : "https://dadunadze1.github.io";
  res.set("Access-Control-Allow-Origin", allowedOrigin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Delivery-Role");
  res.set("Access-Control-Max-Age", "3600");
}

function httpError(status, publicMessage, code = "request-failed", internalMessage = "") {
  const error = new Error(internalMessage || publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  error.code = code;
  return error;
}
