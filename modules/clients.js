import { db } from "../firebase.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function renderClients(el) {
  el.innerHTML = `
    <h3>კლიენტების ბაზა</h3>
    <input id="clientName" placeholder="კლიენტის სახელი" />
    <input id="clientPhone" placeholder="ტელეფონი" />
    <input id="clientAddress" placeholder="მისამართი" />
    <input id="clientLat" placeholder="Latitude მაგ: 41.7151" />
    <input id="clientLng" placeholder="Longitude მაგ: 44.8271" />
    <button id="addClientBtn" class="small-btn">კლიენტის დამატება</button>
    <p>დამატებული კლიენტი გამოჩნდება რუკაზე 📍 პინით.</p>
  `;
  document.getElementById("addClientBtn").addEventListener("click", async () => {
    const lat = Number(document.getElementById("clientLat").value);
    const lng = Number(document.getElementById("clientLng").value);
    await addDoc(collection(db, "clients"), {
      name: document.getElementById("clientName").value.trim(),
      phone: document.getElementById("clientPhone").value.trim(),
      address: document.getElementById("clientAddress").value.trim(),
      lat,
      lng,
      createdAt: serverTimestamp()
    });
  });
}
