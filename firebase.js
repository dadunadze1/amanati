// Firebase v10 ES Modules

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBF421H4mkNB9Ve_uJ8Ph6z4LrbxzKlrC4",
  authDomain: "amanatebi123-43963.firebaseapp.com",
  projectId: "amanatebi123-43963",
  storageBucket: "amanatebi123-43963.firebasestorage.app",
  messagingSenderId: "882036563594",
  appId: "1:882036563594:web:c800b0f2bb6977a441d773"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
