import { db } from "./firebase.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { startLocalTracking, stopLocalTracking } from "./map.js";

const moduleView = document.getElementById("moduleView");

export function initCourierPanel(user, profile) {
  document.querySelectorAll("#courierPanel [data-courier-action]").forEach(btn => {
    btn.addEventListener("click", () => handleCourierAction(btn.dataset.courierAction, user, profile));
  });
}

function handleCourierAction(action, user, profile) {
  if (action === "startGps") {
    startLocalTracking(async pos => {
      await setDoc(doc(db, "gpsLocations", user.uid), {
        uid: user.uid,
        name: profile.name || profile.email,
        phone: profile.phone || "",
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });
    moduleView.innerHTML = `<h3>GPS ჩართულია</h3><p>შენი ლოკაცია იგზავნება Firestore-ში: <b>gpsLocations/${user.uid}</b></p>`;
    return;
  }

  if (action === "stopGps") {
    stopLocalTracking();
    moduleView.innerHTML = `<h3>GPS გამორთულია</h3><p>ლოკაციის გაგზავნა შეწყდა.</p>`;
    return;
  }

  const titles = {
    myOrders: "ჩემი შეკვეთები",
    history: "შესრულებული შეკვეთები",
    salary: "ჩემი ანაზღაურება"
  };
  moduleView.innerHTML = `
    <h3>${titles[action] || action}</h3>
    <p>ეს კურიერის მოდული მზად არის Firestore collection-ებთან მისაბმელად.</p>
    <ul>
      <li>კურიერი ხედავს მხოლოდ საკუთარ მონაცემებს</li>
      <li>შეკვეთის სტატუსის შეცვლა</li>
      <li>ისტორიის ნახვა</li>
    </ul>
  `;
}
