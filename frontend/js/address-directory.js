"use strict";

const ADDRESS_DIRECTORY_DATA_URL = "data/address-directory.json?v=2";
const ADDRESS_DIRECTORY_FALLBACK = [
  {
    "city": "თბილისი",
    "districts": []
  },
  {
    "city": "რუსთავი",
    "districts": []
  },
  {
    "city": "თბილისის შემოგარენი",
    "geocodeCity": "თბილისი",
    "tariffId": "suburbs",
    "districts": []
  }
];
let ADDRESS_DIRECTORY = ADDRESS_DIRECTORY_FALLBACK.map((item) => ({ ...item, districts: [] }));
let addressDirectoryLoadPromise = null;
let addressDirectoryLoaded = false;

function resetAddressDirectoryCaches() {
  addressDirectorySuburbNeighborhoodKeys = null;
  addressDirectoryStreetIndexCache.clear();
  addressDirectoryNeighborhoodCache.clear();
}

function setAddressDirectoryData(data) {
  if (!Array.isArray(data) || !data.length) return ADDRESS_DIRECTORY;
  ADDRESS_DIRECTORY = data;
  addressDirectoryLoaded = true;
  resetAddressDirectoryCaches();
  return ADDRESS_DIRECTORY;
}

function ensureAddressDirectoryLoaded() {
  if (addressDirectoryLoaded) return Promise.resolve(ADDRESS_DIRECTORY);
  if (addressDirectoryLoadPromise) return addressDirectoryLoadPromise;
  if (typeof fetch !== "function") return Promise.resolve(ADDRESS_DIRECTORY);

  addressDirectoryLoadPromise = fetch(ADDRESS_DIRECTORY_DATA_URL, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`address-directory-fetch-${response.status}`);
      return response.json();
    })
    .then(setAddressDirectoryData)
    .catch((error) => {
      console.warn("[address-directory] load failed", error);
      addressDirectoryLoadPromise = null;
      return ADDRESS_DIRECTORY;
    });
  return addressDirectoryLoadPromise;
}

function warmAddressDirectoryIndexes() {
  const run = () => {
    ensureAddressDirectoryLoaded().then(() => {
      getAddressDirectoryCities().forEach((city) => {
        getAddressDirectoryNeighborhoods(city);
        getAddressDirectoryStreetRows(city);
      });
    });
  };
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 1800 });
  else window.setTimeout(run, 250);
}

warmAddressDirectoryIndexes();

const addressDirectorySelections = {};
let addressDirectorySuburbNeighborhoodKeys = null;
let addressDirectoryNeighborhoodKeywordPatterns = null;
const addressDirectoryStreetIndexCache = new Map();
const addressDirectoryNeighborhoodCache = new Map();
const ADDRESS_DIRECTORY_STREET_KEY_IGNORED = new Set(["ქუჩა", "ქ", "გამზირი", "გამზ", "ჩიხი", "შესახვევი", "გასასვლელი", "გზატკეცილი", "ხეივანი", "მიკრორაიონი", "კორპუსი"]);
const ADDRESS_DIRECTORY_ROMAN_NUMERALS = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
};
const ADDRESS_DIRECTORY_ORDINAL_WORDS = {
  პირველი: "1",
  პირველ: "1",
  მეორე: "2",
  მესამი: "3",
  მესამე: "3",
  მეოთხე: "4",
  მეხუთე: "5",
  მეექვსე: "6",
  მეშვიდე: "7",
  მერვე: "8",
  მეცხრე: "9",
  მეათე: "10",
  მეთერთმეტე: "11",
  მეთორმეტე: "12",
};

const ADDRESS_NEIGHBORHOOD_KEYWORDS = [
  { name: "დიდი დიღომი", patterns: ["დიდი დიღომი"] },
  { name: "სოფელი დიღომი", patterns: ["სოფელი დიღომი", "სოფ. დიღომი"] },
  { name: "დიღმის მასივი", patterns: ["დიღმის მასივი"] },
  { name: "ვაშლიჯვარი", patterns: ["ვაშლიჯვარი"] },
  { name: "ნუცუბიძე", patterns: ["ნუცუბიძე", "ნუცუბიძის"] },
  { name: "ვაჟა-ფშაველა", patterns: ["ვაჟა ფშაველა", "ვაჟა-ფშაველა", "ვაჟაფშაველა"] },
  { name: "გლდანი", patterns: ["გლდანი", "გლდანის"] },
  { name: "ვარკეთილი", patterns: ["ვარკეთილი"] },
  { name: "მუხიანი", patterns: ["მუხიანი"] },
  { name: "ავჭალა", patterns: ["ავჭალა"] },
  { name: "ზღვისუბანი", patterns: ["ზღვისუბანი", "ზღვისუბნის", "ზღვის უბანი"] },
  { name: "თემქა", patterns: ["თემქა"] },
  { name: "სანზონა", patterns: ["სანზონა"] },
  { name: "ლოტკინი", patterns: ["ლოტკინი"] },
  { name: "ვერა", patterns: ["ვერა"] },
  { name: "სოლოლაკი", patterns: ["სოლოლაკი"] },
  { name: "ორთაჭალა", patterns: ["ორთაჭალა"] },
  { name: "ფონიჭალა", patterns: ["ფონიჭალა"] },
  { name: "ხარფუხი", patterns: ["ხარფუხი"] },
  { name: "ავლაბარი", patterns: ["ავლაბარი"] },
  { name: "ნავთლუღი", patterns: ["ნავთლუღი"] },
  { name: "ვაზისუბანი", patterns: ["ვაზისუბანი"] },
  { name: "ლილო", patterns: ["ლილო"] },
  { name: "ორხევი", patterns: ["ორხევი"] },
  { name: "აეროპორტი", patterns: ["აეროპორტი"] },
  { name: "კუკია", patterns: ["კუკია"] },
  { name: "მარჯანიშვილი", patterns: ["მარჯანიშვილი", "მარჯანიშვილის"] },
  { name: "წყნეთი", patterns: ["წყნეთი", "წყნეთის"] },
  { name: "ბაგები", patterns: ["ბაგები", "ბაგების"] },
  { name: "ახალდაბა", patterns: ["ახალდაბა"] },
  { name: "ბეთანია", patterns: ["ბეთანია"] },
  { name: "თხინვალა", patterns: ["თხინვალა"] },
  { name: "ლისი", patterns: ["ლისი", "ლისის"] },
];

function getAddressDirectoryCities() {
  return ADDRESS_DIRECTORY.map((item) => item.city);
}

function getAddressDirectoryCity(city) {
  const normalizedCity = normalizeAddressDirectoryText(city);
  return ADDRESS_DIRECTORY.find((item) => normalizeAddressDirectoryText(item.city) === normalizedCity) || ADDRESS_DIRECTORY[0];
}

function getAddressDirectoryGeocodeCity(city) {
  return getAddressDirectoryCity(city)?.geocodeCity || city || "";
}

function getAddressDirectoryTariffId(city) {
  return getAddressDirectoryCity(city)?.tariffId || "city";
}

function getAddressDirectoryDistricts(city) {
  return getAddressDirectoryCity(city)?.districts || [];
}

function getAddressDirectoryCityKey(city) {
  return normalizeAddressDirectoryText(getAddressDirectoryCity(city)?.city || city || "");
}

function getAddressDirectoryNeighborhood(districtName, street = "") {
  const normalizedStreet = normalizeAddressDirectoryText(street);
  const match = getAddressDirectoryNeighborhoodKeywordPatterns().find((item) => (
    item.patterns.some((pattern) => normalizedStreet.includes(pattern))
  ));
  return match?.name || districtName || "";
}

function getAddressDirectoryNeighborhoodKeywordPatterns() {
  if (addressDirectoryNeighborhoodKeywordPatterns) return addressDirectoryNeighborhoodKeywordPatterns;
  addressDirectoryNeighborhoodKeywordPatterns = ADDRESS_NEIGHBORHOOD_KEYWORDS.map((item) => ({
    name: item.name,
    patterns: item.patterns.map(normalizeAddressDirectoryText).filter(Boolean),
  }));
  return addressDirectoryNeighborhoodKeywordPatterns;
}

function getAddressDirectorySuburbNeighborhoodKeys() {
  if (addressDirectorySuburbNeighborhoodKeys) return addressDirectorySuburbNeighborhoodKeys;
  const suburbCity = ADDRESS_DIRECTORY.find((item) => item.tariffId === "suburbs");
  const keys = new Set();
  (suburbCity?.districts || []).forEach((districtRecord) => {
    const districtKey = normalizeAddressDirectoryText(districtRecord.name);
    if (districtKey) keys.add(districtKey);
    districtRecord.streets.forEach((street) => {
      const neighborhoodKey = normalizeAddressDirectoryText(getAddressDirectoryNeighborhood(districtRecord.name, street));
      if (neighborhoodKey) keys.add(neighborhoodKey);
    });
  });
  addressDirectorySuburbNeighborhoodKeys = keys;
  return keys;
}

function isAddressDirectoryHiddenForCity(cityRecord, neighborhood) {
  if (!cityRecord || cityRecord.tariffId === "suburbs") return false;
  return getAddressDirectorySuburbNeighborhoodKeys().has(normalizeAddressDirectoryText(neighborhood));
}

function getAddressDirectoryStreetRows(city) {
  const cityRecord = getAddressDirectoryCity(city);
  const cityKey = getAddressDirectoryCityKey(cityRecord.city);
  if (addressDirectoryStreetIndexCache.has(cityKey)) return addressDirectoryStreetIndexCache.get(cityKey);

  const rows = [];
  (cityRecord?.districts || []).forEach((districtRecord) => {
    const districtKey = normalizeAddressDirectoryText(districtRecord.name);
    districtRecord.streets.forEach((street) => {
      const neighborhood = getAddressDirectoryNeighborhood(districtRecord.name, street);
      if (isAddressDirectoryHiddenForCity(cityRecord, neighborhood)) return;
      rows.push({
        city: cityRecord.city,
        district: districtRecord.name,
        districtKey,
        neighborhood,
        neighborhoodKey: normalizeAddressDirectoryText(neighborhood),
        street,
        streetText: normalizeAddressDirectoryText(street),
        streetKey: normalizeAddressDirectoryStreetKey(street),
      });
    });
  });

  addressDirectoryStreetIndexCache.set(cityKey, rows);
  return rows;
}

function getAddressDirectoryNeighborhoods(city) {
  const cityKey = getAddressDirectoryCityKey(city);
  if (addressDirectoryNeighborhoodCache.has(cityKey)) return addressDirectoryNeighborhoodCache.get(cityKey);
  const seen = new Set();
  const neighborhoods = [];
  getAddressDirectoryStreetRows(city).forEach((row) => {
    if (!row.neighborhoodKey || seen.has(row.neighborhoodKey)) return;
    seen.add(row.neighborhoodKey);
    neighborhoods.push({ name: row.neighborhood, district: row.district });
  });
  neighborhoods.sort((a, b) => a.name.localeCompare(b.name, "ka-GE"));
  addressDirectoryNeighborhoodCache.set(cityKey, neighborhoods);
  return neighborhoods;
}

function getAddressDirectoryDistrictForNeighborhood(city, neighborhood) {
  const normalizedNeighborhood = normalizeAddressDirectoryText(neighborhood);
  if (!normalizedNeighborhood) return "";
  return getAddressDirectoryNeighborhoods(city)
    .find((item) => normalizeAddressDirectoryText(item.name) === normalizedNeighborhood)?.district || "";
}

function normalizeAddressDirectoryText(value) {
  const tokens = String(value || "")
    .toLocaleLowerCase("ka-GE")
    .replace(/მ\s*\/\s*რ/giu, " მიკრორაიონი ")
    .replace(/მკრ\.?/giu, " მიკრორაიონი ")
    .replace(/მიკრო(?:რაიონი)?/giu, " მიკრორაიონი ")
    .replace(/კვარტ\.?/giu, " კვარტალი ")
    .replace(/კორპ\.?/giu, " კორპუსი ")
    .replace(/ზღვის\s+უბანი/giu, "ზღვისუბანი")
    .replace(/თემქის/giu, "თემქა")
    .replace(/დიღმის\s+მასივის/giu, "დიღმის მასივი")
    .replace(/ორთაჭალაში/giu, "ორთაჭალა")
    .replace(/ვარკეთილში/giu, "ვარკეთილი")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return tokens
    .filter((token, index) => !(token === "მე" && /^\d+$/.test(tokens[index + 1] || "")))
    .map(normalizeAddressDirectoryOrdinalToken)
    .join(" ");
}

function normalizeAddressDirectoryOrdinalToken(token) {
  if (ADDRESS_DIRECTORY_ORDINAL_WORDS[token]) return ADDRESS_DIRECTORY_ORDINAL_WORDS[token];
  const romanMatch = token.match(/^([ivx]+)([ა-ჰ])?$/iu);
  if (romanMatch && ADDRESS_DIRECTORY_ROMAN_NUMERALS[romanMatch[1]]) {
    return `${ADDRESS_DIRECTORY_ROMAN_NUMERALS[romanMatch[1]]}${romanMatch[2] || ""}`;
  }
  return token;
}

function normalizeAddressDirectoryStreetKey(value) {
  return normalizeAddressDirectoryText(value)
    .split(" ")
    .filter((token) => token && !ADDRESS_DIRECTORY_STREET_KEY_IGNORED.has(token))
    .join(" ");
}

function addressDirectoryMatches(value, query) {
  const normalizedQuery = normalizeAddressDirectoryText(query);
  if (!normalizedQuery) return true;
  return normalizeAddressDirectoryText(value).includes(normalizedQuery)
    || normalizeAddressDirectoryStreetKey(value).includes(normalizeAddressDirectoryStreetKey(query));
}

function getAddressDirectoryStreetMatches({ city, district, query, limit = 12 } = {}) {
  const normalizedFilter = normalizeAddressDirectoryText(district);
  const normalizedQuery = normalizeAddressDirectoryText(query);
  const normalizedQueryKey = normalizeAddressDirectoryStreetKey(query);
  const rows = [];
  for (const row of getAddressDirectoryStreetRows(city)) {
    if (normalizedFilter && row.districtKey !== normalizedFilter && row.neighborhoodKey !== normalizedFilter) continue;
    if (
      normalizedQuery
      && !row.streetText.includes(normalizedQuery)
      && !(normalizedQueryKey && row.streetKey.includes(normalizedQueryKey))
    ) continue;
    rows.push({ city: row.city, district: row.district, neighborhood: row.neighborhood, street: row.street });
  }
  return rows
    .sort((a, b) => (
      scoreAddressDirectoryMatch(a.street, normalizedQuery, normalizedQueryKey)
      - scoreAddressDirectoryMatch(b.street, normalizedQuery, normalizedQueryKey)
      || a.street.length - b.street.length
      || a.street.localeCompare(b.street, "ka-GE")
    ))
    .slice(0, limit);
}

function scoreAddressDirectoryMatch(street, normalizedQuery, normalizedQueryKey) {
  if (!normalizedQuery) return 0;
  const streetText = normalizeAddressDirectoryText(street);
  const streetKey = normalizeAddressDirectoryStreetKey(street);
  if (streetText === normalizedQuery || streetKey === normalizedQueryKey) return 0;
  if (streetText.startsWith(normalizedQuery) || (normalizedQueryKey && streetKey.startsWith(normalizedQueryKey))) return 1;
  if (streetText.includes(normalizedQuery)) return 2;
  if (normalizedQueryKey && streetKey.includes(normalizedQueryKey)) return 3;
  return 4;
}

function getAddressDirectoryAllStreets(city) {
  return getAddressDirectoryStreetRows(city).map((row) => ({
    city: row.city,
    district: row.district,
    neighborhood: row.neighborhood,
    street: row.street,
    streetText: row.streetText,
    streetKey: row.streetKey,
  }));
}

function findAddressDirectoryStreetInText(address, city) {
  const normalizedAddress = normalizeAddressDirectoryText(address);
  const normalizedStreetAddress = normalizeAddressDirectoryStreetKey(address);
  if (!normalizedAddress) return null;
  const matches = getAddressDirectoryAllStreets(city)
    .filter((item) => {
      return normalizedAddress.includes(item.streetText) || (item.streetKey.length >= 4 && normalizedStreetAddress.includes(item.streetKey));
    })
    .sort((a, b) => b.streetKey.length - a.streetKey.length);
  return matches[0] || null;
}

function normalizeAddressDirectoryAddress(address, options = {}) {
  const rawAddress = cleanAddressInput(address);
  if (!rawAddress) return { address: "", corrected: false, match: null };
  const city = options.city || getAddressDirectoryCities().find((item) => normalizeAddressDirectoryText(rawAddress).includes(normalizeAddressDirectoryText(item))) || "თბილისი";
  const match = findAddressDirectoryStreetInText(rawAddress, city);
  if (!match) return { address: rawAddress, corrected: false, match: null };

  const normalizedParts = rawAddress.split(",").map((part) => cleanAddressInput(part)).filter(Boolean);
  const geocodeCity = getAddressDirectoryGeocodeCity(match.city) || match.city;
  const hasCity = normalizedParts.some((part) => (
    normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(match.city)
    || normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(geocodeCity)
  ));
  const cityPart = hasCity
    ? normalizedParts.find((part) => (
      normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(match.city)
      || normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(geocodeCity)
    ))
    : geocodeCity;
  const streetIndex = normalizedParts.findIndex((part) => (
    normalizeAddressDirectoryText(part).includes(normalizeAddressDirectoryText(match.street))
    || normalizeAddressDirectoryStreetKey(part).includes(normalizeAddressDirectoryStreetKey(match.street))
  ));
  const streetPart = streetIndex >= 0 ? normalizedParts[streetIndex] : match.street;
  const nextAddress = [cityPart, match.neighborhood || match.district, streetPart].filter(Boolean).join(", ");
  return {
    address: nextAddress,
    corrected: normalizeAddressDirectoryText(nextAddress) !== normalizeAddressDirectoryText(rawAddress),
    match,
  };
}

function renderAddressDirectoryFields(prefix, options = {}) {
  const hideCity = options.hideCity === true;
  const hideDistrict = options.hideDistrict !== false;
  const cityOptions = getAddressDirectoryCities().map((city) => `
    <option value="${escapeAttr(city)}" ${city === (options.city || "თბილისი") ? "selected" : ""}>${escapeHtml(city)}</option>
  `).join("");
  return `
    <div class="address-directory-panel" data-address-directory="${escapeAttr(prefix)}" data-address-directory-city-hidden="${hideCity ? "true" : "false"}" data-address-directory-district-hidden="${hideDistrict ? "true" : "false"}">
      <div class="address-directory-field ${hideCity ? "address-directory-field--hidden" : ""}">
        <label for="${escapeAttr(prefix)}City">ქალაქი</label>
        <select id="${escapeAttr(prefix)}City" data-address-city>
          ${cityOptions}
        </select>
      </div>
      <div class="address-directory-field ${hideDistrict ? "address-directory-field--hidden" : ""}">
        <label for="${escapeAttr(prefix)}District">უბანი</label>
        <select id="${escapeAttr(prefix)}District" data-address-district></select>
      </div>
      <div class="address-directory-field">
        <label for="${escapeAttr(prefix)}Street">ქუჩა</label>
        <div class="address-autocomplete-shell">
          <input id="${escapeAttr(prefix)}Street" type="search" autocomplete="street-address" aria-autocomplete="list" aria-controls="${escapeAttr(prefix)}StreetSuggestions" data-address-street placeholder="დაიწყეთ ქუჩის წერა">
          <div id="${escapeAttr(prefix)}StreetSuggestions" class="address-autocomplete-dropdown address-directory-dropdown" role="listbox" hidden></div>
        </div>
      </div>
      <div class="address-directory-field">
        <label for="${escapeAttr(prefix)}Building">ნომერი</label>
        <input id="${escapeAttr(prefix)}Building" type="text" autocomplete="address-line2" data-address-building placeholder="მაგ: 35">
      </div>
      <p id="${escapeAttr(prefix)}AddressDirectoryStatus" class="address-directory-status" data-address-directory-status></p>
    </div>
  `;
}

function bindAddressDirectoryControls(prefix, options = {}) {
  const root = document.querySelector(`[data-address-directory="${prefix}"]`);
  if (!root || root.dataset.addressDirectoryBound === "true") return;
  root.dataset.addressDirectoryBound = "true";

  const citySelect = root.querySelector("[data-address-city]");
  const districtSelect = root.querySelector("[data-address-district]");
  const streetInput = root.querySelector("[data-address-street]");
  const buildingInput = root.querySelector("[data-address-building]");
  const statusElement = root.querySelector("[data-address-directory-status]");
  const dropdown = document.getElementById(`${prefix}StreetSuggestions`);
  const targetInput = options.targetInputId ? document.getElementById(options.targetInputId) : null;
  const districtRequired = Boolean(options.requireDistrict);
  let dropdownRenderTimer = 0;

  const fillDistricts = () => {
    const neighborhoods = getAddressDirectoryNeighborhoods(citySelect.value);
    const selected = districtSelect.value;
    districtSelect.innerHTML = [
      districtRequired ? "" : "<option value=\"\">ყველა უბანი</option>",
      ...neighborhoods.map((neighborhood) => `<option value="${escapeAttr(neighborhood.name)}">${escapeHtml(neighborhood.name)}</option>`),
    ].join("");
    if (neighborhoods.some((neighborhood) => neighborhood.name === selected)) districtSelect.value = selected;
  };

  const closeDropdown = () => {
    if (!dropdown) return;
    window.clearTimeout(dropdownRenderTimer);
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    dropdown.style.display = "none";
  };

  const updateTarget = () => {
    const value = getAddressDirectoryValue(prefix);
    if (targetInput) targetInput.value = value.fullAddress;
    updateAddressDirectoryStatus(statusElement, value);
    if (typeof options.onChange === "function") options.onChange(value);
  };

  const selectStreet = (match) => {
    addressDirectorySelections[prefix] = match;
    streetInput.value = match.street;
    districtSelect.value = match.neighborhood || match.district;
    closeDropdown();
    updateTarget();
  };

  const renderStreetDropdown = () => {
    const query = streetInput.value;
    if (!districtSelect.value && normalizeAddressDirectoryText(query).length < 2) {
      closeDropdown();
      return;
    }
    const matches = getAddressDirectoryStreetMatches({
      city: citySelect.value,
      district: districtSelect.value,
      query,
    });
    if (!dropdown || !query || !matches.length) {
      closeDropdown();
      return;
    }
    dropdown.hidden = false;
    dropdown.style.display = "block";
    dropdown.style.opacity = "1";
    dropdown.style.pointerEvents = "auto";
    dropdown.style.position = "absolute";
    dropdown.style.transform = "translateY(0)";
    dropdown.style.zIndex = "2500";
    dropdown.innerHTML = `
      <div class="address-autocomplete-section">
        <div class="address-autocomplete-label">ქუჩები</div>
        ${matches.map((match, index) => `
          <button class="address-autocomplete-item" type="button" data-address-directory-index="${index}">
            <strong>${escapeHtml(match.street)}</strong>
            <span>${escapeHtml(`${match.city} · ${match.neighborhood || match.district}`)}</span>
          </button>
        `).join("")}
      </div>
    `;
    dropdown.querySelectorAll("[data-address-directory-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => selectStreet(matches[Number(button.dataset.addressDirectoryIndex)]));
    });
  };

  const scheduleStreetDropdownRender = () => {
    window.clearTimeout(dropdownRenderTimer);
    dropdownRenderTimer = window.setTimeout(renderStreetDropdown, 70);
  };

  fillDistricts();
  updateTarget();
  if (!addressDirectoryLoaded) {
    ensureAddressDirectoryLoaded().then(() => {
      if (!document.body.contains(root)) return;
      fillDistricts();
      updateTarget();
      scheduleStreetDropdownRender();
    });
  }

  citySelect.addEventListener("change", () => {
    addressDirectorySelections[prefix] = null;
    fillDistricts();
    streetInput.value = "";
    updateTarget();
    closeDropdown();
  });
  districtSelect.addEventListener("change", () => {
    addressDirectorySelections[prefix] = null;
    scheduleStreetDropdownRender();
    updateTarget();
  });
  streetInput.addEventListener("input", () => {
    addressDirectorySelections[prefix] = null;
    scheduleStreetDropdownRender();
    updateTarget();
  });
  streetInput.addEventListener("focus", renderStreetDropdown);
  streetInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      const exact = getAddressDirectoryStreetMatches({
        city: citySelect.value,
        district: "",
        query: streetInput.value,
        limit: 30,
      }).find((match) => normalizeAddressDirectoryStreetKey(match.street) === normalizeAddressDirectoryStreetKey(streetInput.value));
      if (exact && !districtSelect.value) selectStreet(exact);
      else if (exact && (exact.neighborhood || exact.district) !== districtSelect.value) selectStreet(exact);
      else closeDropdown();
    }, 140);
  });
  buildingInput.addEventListener("input", updateTarget);
}

function updateAddressDirectoryStatus(element, value) {
  if (!element) return;
  const location = value.neighborhood || value.district || "";
  const street = value.street || "";
  if (!street) {
    element.textContent = "";
    element.hidden = true;
    return;
  }
  element.hidden = false;
  element.textContent = location
    ? `ავტომატურად მოინიშნა: ${location}`
    : "უბანი ავტომატურად მოინიშნება ქუჩის არჩევის შემდეგ";
}

function getAddressDirectoryValue(prefix) {
  const root = document.querySelector(`[data-address-directory="${prefix}"]`);
  const city = root?.querySelector("[data-address-city]")?.value.trim() || "";
  const selectedNeighborhood = root?.querySelector("[data-address-district]")?.value.trim() || "";
  const exact = getAddressDirectoryStreetMatches({
    city,
    district: "",
    query: root?.querySelector("[data-address-street]")?.value.trim() || "",
    limit: 50,
  }).find((match) => normalizeAddressDirectoryStreetKey(match.street) === normalizeAddressDirectoryStreetKey(root?.querySelector("[data-address-street]")?.value.trim() || ""));
  const neighborhood = exact?.neighborhood || selectedNeighborhood || addressDirectorySelections[prefix]?.neighborhood || "";
  const district = exact?.district
    || addressDirectorySelections[prefix]?.district
    || getAddressDirectoryDistrictForNeighborhood(city, neighborhood)
    || selectedNeighborhood;
  const street = root?.querySelector("[data-address-street]")?.value.trim() || "";
  const building = root?.querySelector("[data-address-building]")?.value.trim() || "";
  const streetAddress = [street, building].filter(Boolean).join(" ").trim();
  const geocodeCity = getAddressDirectoryGeocodeCity(city);
  const tariffId = getAddressDirectoryTariffId(city);
  const fullAddress = [geocodeCity || city, neighborhood || district, streetAddress].filter(Boolean).join(", ");
  return {
    city,
    geocodeCity,
    tariffId,
    district,
    neighborhood,
    street,
    building,
    streetAddress,
    fullAddress,
    selectedStreet: exact || addressDirectorySelections[prefix] || null,
  };
}

function getAddressDirectoryTariffIdFromAddress(address) {
  const normalizedAddress = normalizeAddressDirectoryText(address);
  if (!normalizedAddress) return "";
  const suburbCity = ADDRESS_DIRECTORY.find((item) => item.tariffId === "suburbs");
  if (!suburbCity) return "";
  const hasSuburbCity = normalizedAddress.includes(normalizeAddressDirectoryText(suburbCity.city));
  const hasSuburbArea = (suburbCity.districts || []).some((districtRecord) => {
    const districtKey = normalizeAddressDirectoryText(districtRecord.name);
    return normalizedAddress.includes(districtKey)
      || districtRecord.streets.some((street) => normalizedAddress.includes(normalizeAddressDirectoryText(street)));
  });
  return hasSuburbCity || hasSuburbArea ? "suburbs" : "";
}
