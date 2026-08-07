"use strict";

const ADDRESS_DIRECTORY = [
  {
    city: "თბილისი",
    districts: [
      {
        name: "საბურთალო",
        streets: [
          "პეკინის გამზირი",
          "ვაჟა-ფშაველას გამზირი",
          "ალექსანდრე ყაზბეგის გამზირი",
          "პეტრე ქავთარაძის ქუჩა",
          "შარტავას ქუჩა",
          "ანა პოლიტკოვსკაიას ქუჩა",
          "მიცკევიჩის ქუჩა",
          "ბახტრიონის ქუჩა",
          "კოსტავას ქუჩა",
          "უნივერსიტეტის ქუჩა",
        ],
      },
      {
        name: "ვაკე",
        streets: [
          "ირაკლი აბაშიძის ქუჩა",
          "ილია ჭავჭავაძის გამზირი",
          "მრგვალი ბაღის ქუჩა",
          "ფალიაშვილის ქუჩა",
          "ატენის ქუჩა",
          "ნაფარეულის ქუჩა",
          "წყნეთის გზატკეცილი",
          "ბაგების ქუჩა",
        ],
      },
      {
        name: "გლდანი",
        streets: [
          "ხიზანიშვილის ქუჩა",
          "ვეკუას ქუჩა",
          "ქერჩის ქუჩა",
          "ომარ ხიზანიშვილის ქუჩა",
          "თეთრიწყაროს ქუჩა",
          "გობრონიძის ქუჩა",
        ],
      },
      {
        name: "დიდი დიღომი",
        streets: [
          "პეტრე იბერის ქუჩა",
          "მირიან მეფის ქუჩა",
          "ფარნავაზ მეფის გამზირი",
          "დავით აღმაშენებლის ხეივანი",
          "იოსებ გრიშაშვილის ქუჩა",
        ],
      },
      {
        name: "ისანი",
        streets: [
          "ქეთევან დედოფლის გამზირი",
          "ნავთლუღის ქუჩა",
          "ბერი გაბრიელ სალოსის გამზირი",
          "დოდაშვილის ქუჩა",
          "მოსკოვის გამზირი",
        ],
      },
      {
        name: "სამგორი",
        streets: [
          "კახეთის გზატკეცილი",
          "ვარკეთილის მასივი",
          "ჯავახეთის ქუჩა",
          "აბაშვილის ქუჩა",
          "აეროპორტის დასახლება",
        ],
      },
      {
        name: "ნაძალადევი",
        streets: [
          "ცოტნე დადიანის ქუჩა",
          "გურამიშვილის გამზირი",
          "თორნიკე ერისთავის ქუჩა",
          "ჩარგლის ქუჩა",
          "სარაჯიშვილის გამზირი",
        ],
      },
      {
        name: "დიდუბე",
        streets: [
          "წერეთლის გამზირი",
          "მირცხულავას ქუჩა",
          "დიღმის მასივი",
          "სამტრედიის ქუჩა",
          "ბელიაშვილის ქუჩა",
        ],
      },
      {
        name: "ჩუღურეთი",
        streets: [
          "დავით აღმაშენებლის გამზირი",
          "მარჯანიშვილის ქუჩა",
          "წინამძღვრიშვილის ქუჩა",
          "უზნაძის ქუჩა",
          "კიევის ქუჩა",
        ],
      },
      {
        name: "მთაწმინდა",
        streets: [
          "რუსთაველის გამზირი",
          "ბესიკის ქუჩა",
          "ინგოროყვას ქუჩა",
          "ტაბიძის ქუჩა",
          "ლერმონტოვის ქუჩა",
        ],
      },
      {
        name: "კრწანისი",
        streets: [
          "კრწანისის ქუჩა",
          "ორთაჭალის ქუჩა",
          "გორგასლის ქუჩა",
          "გულიას ქუჩა",
          "ბალანჩივაძის ქუჩა",
        ],
      },
    ],
  },
  {
    city: "რუსთავი",
    districts: [
      {
        name: "ძველი რუსთავი",
        streets: [
          "კოსტავას გამზირი",
          "მესხიშვილის ქუჩა",
          "რუსთაველის ქუჩა",
          "ფიროსმანის ქუჩა",
          "მეგობრობის გამზირი",
        ],
      },
      {
        name: "ახალი რუსთავი",
        streets: [
          "შარტავას გამზირი",
          "ლეონიძის ქუჩა",
          "ბარათაშვილის ქუჩა",
          "კლდიაშვილის ქუჩა",
          "თბილისის ქუჩა",
        ],
      },
      {
        name: "მიკრორაიონები",
        streets: [
          "მე-12 მიკრორაიონი",
          "მე-17 მიკრორაიონი",
          "მე-19 მიკრორაიონი",
          "XXI მიკრორაიონი",
          "ჭყონდიდელის დასახლება",
        ],
      },
    ],
  },
];

const addressDirectorySelections = {};

function getAddressDirectoryCities() {
  return ADDRESS_DIRECTORY.map((item) => item.city);
}

function getAddressDirectoryCity(city) {
  const normalizedCity = normalizeAddressDirectoryText(city);
  return ADDRESS_DIRECTORY.find((item) => normalizeAddressDirectoryText(item.city) === normalizedCity) || ADDRESS_DIRECTORY[0];
}

function getAddressDirectoryDistricts(city) {
  return getAddressDirectoryCity(city)?.districts || [];
}

function normalizeAddressDirectoryText(value) {
  return String(value || "")
    .toLocaleLowerCase("ka-GE")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressDirectoryStreetKey(value) {
  const ignored = new Set(["ქუჩა", "ქ", "გამზირი", "გამზ", "ჩიხი", "შესახვევი", "გასასვლელი", "გზატკეცილი", "ხეივანი"]);
  return normalizeAddressDirectoryText(value)
    .split(" ")
    .filter((token) => token && !ignored.has(token))
    .join(" ");
}

function addressDirectoryMatches(value, query) {
  const normalizedQuery = normalizeAddressDirectoryText(query);
  if (!normalizedQuery) return true;
  return normalizeAddressDirectoryText(value).includes(normalizedQuery)
    || normalizeAddressDirectoryStreetKey(value).includes(normalizeAddressDirectoryStreetKey(query));
}

function getAddressDirectoryStreetMatches({ city, district, query, limit = 12 } = {}) {
  const cityRecord = getAddressDirectoryCity(city);
  const normalizedDistrict = normalizeAddressDirectoryText(district);
  const rows = [];
  (cityRecord?.districts || []).forEach((districtRecord) => {
    if (normalizedDistrict && normalizeAddressDirectoryText(districtRecord.name) !== normalizedDistrict) return;
    districtRecord.streets.forEach((street) => {
      if (!addressDirectoryMatches(street, query)) return;
      rows.push({ city: cityRecord.city, district: districtRecord.name, street });
    });
  });
  return rows.slice(0, limit);
}

function getAddressDirectoryAllStreets(city) {
  const cityRecord = getAddressDirectoryCity(city);
  return (cityRecord?.districts || []).flatMap((districtRecord) => (
    districtRecord.streets.map((street) => ({
      city: cityRecord.city,
      district: districtRecord.name,
      street,
    }))
  ));
}

function findAddressDirectoryStreetInText(address, city) {
  const normalizedAddress = normalizeAddressDirectoryText(address);
  const normalizedStreetAddress = normalizeAddressDirectoryStreetKey(address);
  if (!normalizedAddress) return null;
  const matches = getAddressDirectoryAllStreets(city)
    .filter((item) => {
      const streetText = normalizeAddressDirectoryText(item.street);
      const streetKey = normalizeAddressDirectoryStreetKey(item.street);
      return normalizedAddress.includes(streetText) || (streetKey.length >= 4 && normalizedStreetAddress.includes(streetKey));
    })
    .sort((a, b) => normalizeAddressDirectoryStreetKey(b.street).length - normalizeAddressDirectoryStreetKey(a.street).length);
  return matches[0] || null;
}

function normalizeAddressDirectoryAddress(address, options = {}) {
  const rawAddress = cleanAddressInput(address);
  if (!rawAddress) return { address: "", corrected: false, match: null };
  const city = options.city || getAddressDirectoryCities().find((item) => normalizeAddressDirectoryText(rawAddress).includes(normalizeAddressDirectoryText(item))) || "თბილისი";
  const match = findAddressDirectoryStreetInText(rawAddress, city);
  if (!match) return { address: rawAddress, corrected: false, match: null };

  const normalizedParts = rawAddress.split(",").map((part) => cleanAddressInput(part)).filter(Boolean);
  const hasCity = normalizedParts.some((part) => normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(match.city));
  const cityPart = hasCity ? normalizedParts.find((part) => normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(match.city)) : match.city;
  const streetIndex = normalizedParts.findIndex((part) => (
    normalizeAddressDirectoryText(part).includes(normalizeAddressDirectoryText(match.street))
    || normalizeAddressDirectoryStreetKey(part).includes(normalizeAddressDirectoryStreetKey(match.street))
  ));
  const streetPart = streetIndex >= 0 ? normalizedParts[streetIndex] : match.street;
  const nextAddress = [cityPart, match.district, streetPart].filter(Boolean).join(", ");
  return {
    address: nextAddress,
    corrected: normalizeAddressDirectoryText(nextAddress) !== normalizeAddressDirectoryText(rawAddress),
    match,
  };
}

function renderAddressDirectoryFields(prefix, options = {}) {
  const cityOptions = getAddressDirectoryCities().map((city) => `
    <option value="${escapeAttr(city)}" ${city === (options.city || "თბილისი") ? "selected" : ""}>${escapeHtml(city)}</option>
  `).join("");
  return `
    <div class="address-directory-panel" data-address-directory="${escapeAttr(prefix)}">
      <label for="${escapeAttr(prefix)}City">ქალაქი</label>
      <select id="${escapeAttr(prefix)}City" data-address-city>
        ${cityOptions}
      </select>
      <label for="${escapeAttr(prefix)}District">რაიონი</label>
      <select id="${escapeAttr(prefix)}District" data-address-district></select>
      <label for="${escapeAttr(prefix)}Street">ქუჩა</label>
      <div class="address-autocomplete-shell">
        <input id="${escapeAttr(prefix)}Street" type="search" autocomplete="street-address" aria-autocomplete="list" aria-controls="${escapeAttr(prefix)}StreetSuggestions" data-address-street placeholder="დაიწყეთ ქუჩის წერა">
        <div id="${escapeAttr(prefix)}StreetSuggestions" class="address-autocomplete-dropdown address-directory-dropdown" role="listbox" hidden></div>
      </div>
      <label for="${escapeAttr(prefix)}Building">ნომერი</label>
      <input id="${escapeAttr(prefix)}Building" type="text" autocomplete="address-line2" data-address-building placeholder="მაგ: 35">
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
  const dropdown = document.getElementById(`${prefix}StreetSuggestions`);
  const targetInput = options.targetInputId ? document.getElementById(options.targetInputId) : null;
  const districtRequired = Boolean(options.requireDistrict);

  const fillDistricts = () => {
    const districts = getAddressDirectoryDistricts(citySelect.value);
    const selected = districtSelect.value;
    districtSelect.innerHTML = [
      districtRequired ? "" : "<option value=\"\">ყველა რაიონი</option>",
      ...districts.map((district) => `<option value="${escapeAttr(district.name)}">${escapeHtml(district.name)}</option>`),
    ].join("");
    if (districts.some((district) => district.name === selected)) districtSelect.value = selected;
  };

  const closeDropdown = () => {
    if (!dropdown) return;
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    dropdown.style.display = "none";
  };

  const updateTarget = () => {
    const value = getAddressDirectoryValue(prefix);
    if (targetInput) targetInput.value = value.fullAddress;
    if (typeof options.onChange === "function") options.onChange(value);
  };

  const selectStreet = (match) => {
    addressDirectorySelections[prefix] = match;
    streetInput.value = match.street;
    districtSelect.value = match.district;
    closeDropdown();
    updateTarget();
  };

  const renderStreetDropdown = () => {
    const query = streetInput.value;
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
            <span>${escapeHtml(`${match.city} · ${match.district}`)}</span>
          </button>
        `).join("")}
      </div>
    `;
    dropdown.querySelectorAll("[data-address-directory-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => selectStreet(matches[Number(button.dataset.addressDirectoryIndex)]));
    });
  };

  fillDistricts();
  updateTarget();

  citySelect.addEventListener("change", () => {
    addressDirectorySelections[prefix] = null;
    fillDistricts();
    streetInput.value = "";
    updateTarget();
    closeDropdown();
  });
  districtSelect.addEventListener("change", () => {
    addressDirectorySelections[prefix] = null;
    renderStreetDropdown();
    updateTarget();
  });
  streetInput.addEventListener("input", () => {
    addressDirectorySelections[prefix] = null;
    renderStreetDropdown();
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
      else if (exact && exact.district !== districtSelect.value) selectStreet(exact);
      else closeDropdown();
    }, 140);
  });
  buildingInput.addEventListener("input", updateTarget);
}

function getAddressDirectoryValue(prefix) {
  const root = document.querySelector(`[data-address-directory="${prefix}"]`);
  const city = root?.querySelector("[data-address-city]")?.value.trim() || "";
  const exact = getAddressDirectoryStreetMatches({
    city,
    district: "",
    query: root?.querySelector("[data-address-street]")?.value.trim() || "",
    limit: 50,
  }).find((match) => normalizeAddressDirectoryStreetKey(match.street) === normalizeAddressDirectoryStreetKey(root?.querySelector("[data-address-street]")?.value.trim() || ""));
  const district = exact?.district || root?.querySelector("[data-address-district]")?.value.trim() || addressDirectorySelections[prefix]?.district || "";
  const street = root?.querySelector("[data-address-street]")?.value.trim() || "";
  const building = root?.querySelector("[data-address-building]")?.value.trim() || "";
  const streetAddress = [street, building].filter(Boolean).join(" ").trim();
  const fullAddress = [city, district, streetAddress].filter(Boolean).join(", ");
  return {
    city,
    district,
    street,
    building,
    streetAddress,
    fullAddress,
    selectedStreet: exact || addressDirectorySelections[prefix] || null,
  };
}
