import { auth } from "./firebase.js?v=20";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const authBox = document.getElementById("authBox");
const menuBtn = document.getElementById("menuBtn");
const authMessage = document.getElementById("authMessage");

window.login = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    await signInWithEmailAndPassword(auth, email, password);
    authMessage.textContent = "";
  } catch (error) {
    authMessage.textContent = error.message;
  }
};

window.register = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    authMessage.textContent = "რეგისტრაცია წარმატებულია ✅";
  } catch (error) {
    authMessage.textContent = error.message;
  }
};

window.logout = async function () {
  await signOut(auth);
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    authBox.style.display = "none";
    menuBtn.style.display = "block";
  } else {
    authBox.style.display = "flex";
    menuBtn.style.display = "none";
  }
});
