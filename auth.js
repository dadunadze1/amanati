import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function showApp() {
  const authBox = document.getElementById("authBox");
  const menuBtn = document.getElementById("menuBtn");

  if (authBox) authBox.style.display = "none";
  if (menuBtn) menuBtn.style.display = "block";
}

function showLogin() {
  const authBox = document.getElementById("authBox");
  const menuBtn = document.getElementById("menuBtn");

  if (authBox) authBox.style.display = "flex";
  if (menuBtn) menuBtn.style.display = "none";
}

window.login = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);

    if (!docSnap.exists()) {
      alert("User Firestore-ში არ მოიძებნა");
      return;
    }

    const data = docSnap.data();

    showApp();

    if (data.role === "admin") {
      alert("Admin login წარმატებულია 🔥");
    } else {
      alert("User login წარმატებულია");
    }

  } catch (error) {
    alert("Login error: " + error.message);
  }
};

window.logout = async function () {
  await signOut(auth);
  location.reload();
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    showApp();
  } else {
    showLogin();
  }
});
