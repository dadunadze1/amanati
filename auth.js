import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 👉 ეს აგვარებს initAuth error-ს
export function initAuth() {
  console.log("Auth initialized");
}

// 👉 ეს აგვარებს login is not defined error-ს
window.login = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 🔍 ვამოწმებთ Firestore-ში არის თუ არა admin
    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);

    if (docSnap.exists()) {
      const data = docSnap.data();

      if (data.role === "admin") {
        alert("Admin login წარმატებულია 🔥");
      } else {
        alert("User login წარმატებულია");
      }
    } else {
      alert("User არ მოიძებნა Firestore-ში");
    }

  } catch (error) {
    alert("Login error: " + error.message);
  }
};

// 👉 ეს ავტომატურად ამოწმებს login-ს
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Logged in:", user.email);
  } else {
    console.log("Logged out");
  }
});
