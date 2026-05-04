import { db } from "./firebase.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { renderAnalytics } from "./modules/analytics.js";
import { renderClients } from "./modules/clients.js";
import { renderDocuments } from "./modules/documents.js";
import { renderEquipment } from "./modules/equipment.js";
import { renderPayroll } from "./modules/payroll.js";
import { renderSchedules } from "./modules/schedules.js";
import { renderKnowledgeBase } from "./modules/knowledgeBase.js";
import { renderAccounting } from "./modules/accounting.js";

const moduleView = document.getElementById("moduleView");

export function initAdminPanel(profile) {
  document.querySelectorAll("#adminPanel [data-module]").forEach(btn => {
    btn.addEventListener("click", () => openAdminModule(btn.dataset.module, profile));
  });
}

export async function seedDemoOrder() {
  await addDoc(collection(db, "orders"), {
    address: "თბილისი, რუსთაველის გამზირი",
    lat: 41.7009,
    lng: 44.7968,
    status: "new",
    reward: 5,
    createdAt: serverTimestamp()
  });
}

function openAdminModule(moduleName, profile) {
  const renderers = {
    analytics: renderAnalytics,
    clients: renderClients,
    documents: renderDocuments,
    equipment: renderEquipment,
    payroll: renderPayroll,
    schedules: renderSchedules,
    knowledgeBase: renderKnowledgeBase,
    accounting: renderAccounting,
    reports: renderAnalytics,
    interactions: renderSimple,
    staffPerformance: renderSimple,
    gps: renderGps,
    autoReplies: renderSimple
  };
  const renderer = renderers[moduleName] || renderSimple;
  renderer(moduleView, moduleName, profile);
}

function renderSimple(el, moduleName) {
  const titles = {
    interactions: "კლიენტთან ურთიერთობის ისტორია",
    staffPerformance: "პერსონალის ეფექტიანობის მონიტორინგი",
    autoReplies: "პასუხების ავტომატიზაცია"
  };
  el.innerHTML = `
    <h3>${titles[moduleName] || moduleName}</h3>
    <p>ეს მოდული მზად არის Firestore collection-თან მისაბმელად.</p>
    <ul>
      <li>მონაცემების დამატება</li>
      <li>რედაქტირება</li>
      <li>ძიება/ფილტრი</li>
      <li>ანგარიშის გამოტანა</li>
    </ul>
  `;
}

function renderGps(el) {
  el.innerHTML = `
    <h3>GPS კონტროლი</h3>
    <p>რუკაზე live ჩანს <b>gpsLocations</b> collection-ში არსებული კურიერები.</p>
    <button id="addDemoOrderBtn" class="small-btn">სატესტო შეკვეთის პინის დამატება</button>
  `;
  document.getElementById("addDemoOrderBtn").addEventListener("click", seedDemoOrder);
}
