import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let mode = "login";

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const roleInput = document.getElementById("roleInput");
const nameInput = document.getElementById("nameInput");
const phoneInput = document.getElementById("phoneInput");
const authActionBtn = document.getElementById("authActionBtn");
const authMessage = document.getElementById("authMessage");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const logoutBtn = document.getElementById("logoutBtn");

function setMode(nextMode) {
  mode = nextMode;
  const isRegister = mode === "register";
  loginTab.classList.toggle("active", !isRegister);
  registerTab.classList.toggle("active", isRegister);
  roleInput.classList.toggle("hidden", !isRegister);
  nameInput.classList.toggle("hidden", !isRegister);
  phoneInput.classList.toggle("hidden", !isRegister);
  authActionBtn.textContent = isRegister ? "რეგისტრაცია" : "შესვლა";
  authMessage.textContent = "";
}

export function initAuth(onUserReady, onLogout) {
  loginTab.addEventListener("click", () => setMode("login"));
  registerTab.addEventListener("click", () => setMode("register"));

  authActionBtn.addEventListener("click", async () => {
    authMessage.textContent = "";
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    try {
      if (!email || !password) throw new Error("შეავსე email და password.");

      if (mode === "register") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          email,
          name: nameInput.value.trim() || email,
          phone: phoneInput.value.trim(),
          role: roleInput.value,
          createdAt: serverTimestamp()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      authMessage.textContent = err.message;
    }
  });

  logoutBtn.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async user => {
    if (!user) {
      onLogout();
      return;
    }
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    let profile;
    if (snap.exists()) {
      profile = snap.data();
    } else {
      profile = { uid: user.uid, email: user.email, name: user.email, role: "courier" };
      await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
    }
    onUserReady(user, profile);
  });
}
