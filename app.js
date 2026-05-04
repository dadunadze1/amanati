// app.js — CLEAN FIXED VERSION
// აღარ ვაიმპორტებთ initAuth-ს, იმიტომ რომ auth.js მუშაობს window.login/window.register-ით

// MENU
window.toggleMenu = function () {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.toggle("open");
};

// PANEL
window.closePanel = function () {
  const panel = document.getElementById("panel");
  if (panel) panel.classList.add("hidden");
};

function openPanel(title, content) {
  const panel = document.getElementById("panel");
  const panelContent = document.getElementById("panelContent");

  if (!panel || !panelContent) return;

  panelContent.innerHTML = `
    <h2>${title}</h2>
    <div>${content}</div>
  `;

  panel.classList.remove("hidden");
}

// ADMIN PANEL
window.showAdminPanel = function () {
  openPanel(
    "ადმინის პანელი",
    `
    <p>ადმინის ფუნქციები აქტიურია.</p>
    <ul>
      <li>კურიერების მართვა</li>
      <li>კლიენტების ბაზა</li>
      <li>შეკვეთების მართვა</li>
      <li>GPS კონტროლი</li>
      <li>ანალიტიკა</li>
    </ul>
    `
  );
};

// COURIER PANEL
window.showCourierPanel = function () {
  openPanel(
    "კურიერის პანელი",
    `
    <p>კურიერის ფუნქციები აქტიურია.</p>
    <ul>
      <li>ჩემი შეკვეთები</li>
      <li>ჩემი მარშრუტი</li>
      <li>GPS ლოკაცია</li>
      <li>შესრულებული შეკვეთები</li>
    </ul>
    `
  );
};

// CLIENTS
window.openClients = function () {
  openPanel(
    "კლიენტების ბაზა",
    `
    <p>აქ იქნება კლიენტების სია, მისამართები და ისტორია.</p>
    `
  );
};

// ANALYTICS
window.openAnalytics = function () {
  openPanel(
    "ანალიტიკა",
    `
    <p>აქ იქნება ეფექტიანობის ანალიზი და სტატისტიკა.</p>
    `
  );
};

// REPORTS
window.openReports = function () {
  openPanel(
    "ანგარიშები",
    `
    <p>აქ იქნება ანგარიშები და დოკუმენტები.</p>
    `
  );
};

console.log("app.js loaded successfully ✅");
