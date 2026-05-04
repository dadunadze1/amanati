import { initMap, listenCouriersOnMap, listenOrdersOnMap, listenClientsOnMap } from "./map.js";
import { initAuth } from "./auth.js";
import { initAdminPanel } from "./admin.js";
import { initCourierPanel } from "./courier.js";

const authScreen = document.getElementById("authScreen");
const menuBtn = document.getElementById("menuBtn");
const sidebar = document.getElementById("sidebar");
const closeMenuBtn = document.getElementById("closeMenuBtn");
const adminPanel = document.getElementById("adminPanel");
const courierPanel = document.getElementById("courierPanel");
const panelTitle = document.getElementById("panelTitle");
const userInfo = document.getElementById("userInfo");
const moduleView = document.getElementById("moduleView");

initMap();
listenCouriersOnMap();
listenOrdersOnMap();
listenClientsOnMap();

menuBtn.addEventListener("click", () => sidebar.classList.add("open"));
closeMenuBtn.addEventListener("click", () => sidebar.classList.remove("open"));
document.getElementById("map").addEventListener("click", () => sidebar.classList.remove("open"));

initAuth((user, profile) => {
  authScreen.classList.add("hidden");
  menuBtn.classList.remove("hidden");
  sidebar.classList.add("open");

  const role = profile.role || "courier";
  panelTitle.textContent = role === "admin" ? "ადმინის პანელი" : role === "staff" ? "პერსონალის პანელი" : "კურიერის პანელი";
  userInfo.textContent = `${profile.name || profile.email} • ${role}`;

  adminPanel.classList.toggle("hidden", role !== "admin" && role !== "staff");
  courierPanel.classList.toggle("hidden", role === "admin" || role === "staff");

  moduleView.innerHTML = `
    <h3>მოგესალმები, ${profile.name || profile.email}</h3>
    <p>აირჩიე მოდული მენიუდან. რუკა მუშაობს Leaflet + OpenStreetMap-ზე და იკავებს ეკრანის 100%-ს.</p>
  `;

  initAdminPanel(profile);
  initCourierPanel(user, profile);
}, () => {
  authScreen.classList.remove("hidden");
  menuBtn.classList.add("hidden");
  sidebar.classList.remove("open");
  adminPanel.classList.add("hidden");
  courierPanel.classList.add("hidden");
});
