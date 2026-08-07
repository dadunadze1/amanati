"use strict";

const PARCEL_PHOTO_MAX_EDGE = 1600;
const PARCEL_PHOTO_JPEG_QUALITY = 0.84;

function renderParcelPhotoImportPanel(context = "address") {
  if (!state.isAdmin) return "";
  const id = `parcelPhotoImport${context}`;
  return `
    <div class="parcel-photo-import" data-parcel-photo-import="${escapeAttr(context)}">
      <input id="${escapeAttr(id)}Input" type="file" accept="image/*" capture="environment" hidden>
      <div class="parcel-photo-import-copy">
        <strong>ფოტოთი შევსება</strong>
        <span>გადაიღე სტიკერი და სისტემა ეცდება მისამართის, ნომრის და ქეშის ამოკითხვას.</span>
      </div>
      <button id="${escapeAttr(id)}Button" class="button secondary" type="button">კამერის გახსნა</button>
      <img id="${escapeAttr(id)}Preview" class="parcel-photo-preview" alt="" hidden>
      <p id="${escapeAttr(id)}Status" class="parcel-photo-status" role="status"></p>
    </div>
  `;
}

function bindParcelPhotoImportControls(context, onResult) {
  const root = document.querySelector(`[data-parcel-photo-import="${context}"]`);
  if (!root || root.dataset.bound === "true") return;
  root.dataset.bound = "true";
  const input = root.querySelector("input[type='file']");
  const button = root.querySelector("button");
  const preview = root.querySelector("img");
  const status = root.querySelector(".parcel-photo-status");
  if (!input || !button) return;

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      setParcelPhotoImportStatus(status, "ფოტო მუშავდება...");
      button.disabled = true;
      const payload = await prepareParcelPhotoPayload(file);
      if (preview) {
        preview.src = payload.dataUrl;
        preview.hidden = false;
      }
      setParcelPhotoImportStatus(status, "სტიკერი იკითხება...");
      const result = await extractParcelFromStickerPhoto(payload);
      await onResult?.(result, { status, preview });
      const warnings = Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [];
      setParcelPhotoImportStatus(status, warnings.length ? warnings.join(" ") : "ფოტოდან მონაცემები შეივსო.");
    } catch (error) {
      setParcelPhotoImportStatus(status, error.message || "ფოტოს წაკითხვა ვერ მოხერხდა.");
    } finally {
      button.disabled = false;
    }
  });
}

async function prepareParcelPhotoPayload(file) {
  if (!file.type.startsWith("image/")) throw new Error("აირჩიე სურათის ფაილი.");
  const image = await loadImageElement(file);
  const scale = Math.min(1, PARCEL_PHOTO_MAX_EDGE / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("ფოტოს დამუშავება ვერ მოხერხდა.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", PARCEL_PHOTO_JPEG_QUALITY);
  return {
    dataUrl,
    image: dataUrl.replace(/^data:image\/jpeg;base64,/i, ""),
    mimeType: "image/jpeg",
  };
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("ფოტოს გახსნა ვერ მოხერხდა."));
    };
    image.src = url;
  });
}

async function extractParcelFromStickerPhoto(payload) {
  const url = getParcelStickerOcrUrl();
  if (!url) throw new Error("OCR ფუნქციის მისამართი არ არის გამართული.");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Delivery-Role": state.isAdmin ? "admin" : "",
    },
    body: JSON.stringify({
      image: payload.image,
      mimeType: payload.mimeType,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || STRINGS.serverFailed);
  return normalizeParcelPhotoImportResult(body);
}

function getParcelStickerOcrUrl() {
  if (CONFIG.parcelStickerOcrUrl) return CONFIG.parcelStickerOcrUrl;
  const projectId = firebaseConfig?.projectId || "";
  return projectId ? `https://europe-west8-${projectId}.cloudfunctions.net/extractParcelFromSticker` : "";
}

function normalizeParcelPhotoImportResult(result = {}) {
  return {
    address: cleanAddressInput(result.address || ""),
    fullName: String(result.fullName || "").trim(),
    phone: String(result.phone || "").trim(),
    paymentAmount: Number.isFinite(Number(result.paymentAmount)) ? safeMoney(result.paymentAmount) : 0,
    rawText: String(result.rawText || "").trim(),
    confidence: Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : 0,
    warnings: Array.isArray(result.warnings) ? result.warnings.map((item) => String(item || "").trim()).filter(Boolean) : [],
    lines: Array.isArray(result.lines) ? result.lines.map((item) => String(item || "").trim()).filter(Boolean) : [],
  };
}

function setParcelPhotoImportStatus(element, message) {
  if (element) element.textContent = message || "";
}
