import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const authBox = document.getElementById("authBox");
const menuBtn = document.getElementById("menuBtn");

window.login = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const authMessage = document.getElementById("authMessage");

  if (!email || !password) {
    authMessage.textContent = "შეიყვანე email და პაროლი";
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    authMessage.textContent = "";
  } catch (err) {
    authMessage.textContent = "შესვლა ვერ მოხერხდა: " + err.message;
  }
};

window.register = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const authMessage = document.getElementById("authMessage");

  if (!email || !password) {
    authMessage.textContent = "რეგისტრაციისთვის შეიყვანე email და პაროლი";
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    authMessage.textContent = "რეგისტრაცია წარმატებულია ✅";
  } catch (err) {
    authMessage.textContent = "რეგისტრაცია ვერ მოხერხდა: " + err.message;
  }
};

window.logout = async function () {
  await signOut(auth);
  location.reload();
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    authBox.style.display = "none";
    menuBtn.classList.remove("hidden");
  } else {
    authBox.style.display = "flex";
    menuBtn.classList.add("hidden");
  }
});
