// ====================== FIREBASE CONFIG ======================
const firebaseConfig = {
    apiKey: "AIzaSyA6gPm6B3ez7hkGgDrfHkkYNkOPBgXD08",
    authDomain: "fire-config-c2e7b.firebaseapp.com",
    projectId: "fire-config-c2e7b",
    storageBucket: "fire-config-c2e7b.firebasestorage.app",
    messagingSenderId: "438781657853",
    appId: "1:438781657853:web:9c626776c9f0952a3af494"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --------------------------------------------------------------
//  Helper: username -> email (for Firebase Auth)
// --------------------------------------------------------------
function usernameToEmail(username) {
    return username.toLowerCase().replace(/[^a-z0-9]/g, '') + "@courier.local";
}

// --------------------------------------------------------------
//  Create default admin (if not exists) with password 123456
// --------------------------------------------------------------
async function createDefaultAdmin() {
    const adminSnapshot = await db.collection("users").where("role", "==", "admin").get();
    if (adminSnapshot.empty) {
        try {
            const userCred = await auth.createUserWithEmailAndPassword("admin@courier.local", "123456");
            await db.collection("users").doc(userCred.user.uid).set({
                username: "admin",
                role: "admin",
                approved: true,
                createdAt: new Date().toISOString()
            });
            console.log("Default admin created: admin@courier.local / 123456");
        } catch(e) { console.warn(e); }
    }
}

// --------------------------------------------------------------
//  Registration request (store in pendingUsers collection)
// --------------------------------------------------------------
async function requestRegistration(username, password) {
    if (!username.trim() || !password.trim()) return { success: false, msg: "შეავსეთ ყველა ველი" };
    const existingUser = await db.collection("users").where("username", "==", username).get();
    if (!existingUser.empty) return { success: false, msg: "მომხმარებელი უკვე არსებობს" };
    const pendingRef = await db.collection("pendingUsers").where("username", "==", username).get();
    if (!pendingRef.empty) return { success: false, msg: "უკვე გაგზავნილია დასამტკიცებლად" };
    await db.collection("pendingUsers").add({
        username: username,
        password: password,
        requestedAt: new Date().toISOString()
    });
    return { success: true, msg: "მოთხოვნა გაგზავნილია ადმინისთვის" };
}

// --------------------------------------------------------------
//  Approve registration: create Firebase Auth user + Firestore user doc
// --------------------------------------------------------------
async function approveRegistration(pendingId, username, password) {
    try {
        const email = usernameToEmail(username);
        const userCred = await auth.createUserWithEmailAndPassword(email, password);
        await db.collection("users").doc(userCred.user.uid).set({
            username: username,
            role: "courier",
            approved: true,
            createdAt: new Date().toISOString()
        });
        await db.collection("pendingUsers").doc(pendingId).delete();
        return true;
    } catch(e) {
        console.error(e);
        return false;
    }
}

// --------------------------------------------------------------
//  Authenticate user (admin or courier)
// --------------------------------------------------------------
async function authenticateUser(login, password) {
    if (login === "admin" || login === "admin@courier.local") {
        try {
            await auth.signInWithEmailAndPassword("admin@courier.local", password);
            const userDoc = await db.collection("users").where("username", "==", "admin").get();
            if (!userDoc.empty && userDoc.docs[0].data().role === "admin") return "admin";
            else return null;
        } catch(e) { return null; }
    }
    const email = usernameToEmail(login);
    try {
        await auth.signInWithEmailAndPassword(email, password);
        const user = auth.currentUser;
        const userDoc = await db.collection("users").doc(user.uid).get();
        if (userDoc.exists && userDoc.data().approved === true && userDoc.data().role === "courier") {
            return "user";
        } else {
            await auth.signOut();
            return null;
        }
    } catch(e) {
        return null;
    }
}

// --------------------------------------------------------------
//  Change password (send reset email)
// --------------------------------------------------------------
async function changeUserPassword(username, newPassword) {
    const email = usernameToEmail(username);
    try {
        await auth.sendPasswordResetEmail(email);
        showToast(`პაროლის აღსადგენი ლინკი გაეგზავნა ${email}-ზე`);
        return true;
    } catch(e) {
        console.error(e);
        return false;
    }
}

// --------------------------------------------------------------
//  Pins (active parcels) – Firestore
// --------------------------------------------------------------
async function getPinsForUser(uid) {
    const snapshot = await db.collection("pins").where("userId", "==", uid).where("archived", "==", false).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function addNewPinForUser(uid, lat, lng, fullName, phone) {
    if (!fullName.trim() || !phone.trim()) return false;
    await db.collection("pins").add({
        userId: uid, lat, lng, fullName: fullName.trim(), phone: phone.trim(),
        status: 'pending', createdAt: new Date().toISOString(), archived: false
    });
    return true;
}

async function updatePinStatus(pinDocId, newStatus) {
    await db.collection("pins").doc(pinDocId).update({ status: newStatus });
}

async function archiveAllPinsToHistory(uid) {
    const activePins = await db.collection("pins").where("userId", "==", uid).where("archived", "==", false).get();
    if (activePins.empty) { showToast("არანაირი აქტიური შეკვეთა არ არის"); return; }
    const now = new Date().toISOString();
    for (let doc of activePins.docs) {
        const pin = doc.data();
        await db.collection("history").add({
            userId: uid,
            fullName: pin.fullName, phone: pin.phone, lat: pin.lat, lng: pin.lng,
            status: pin.status, createdAt: pin.createdAt, archivedAt: now,
            displayDate: new Date().toLocaleString('ka-GE')
        });
        await doc.ref.delete();
    }
    showToast("✅ დღე დასრულდა! ყველა შეკვეთა გადავიდა ისტორიაში");
}

async function getHistoryForUser(uid) {
    const snapshot = await db.collection("history").where("userId", "==", uid).get();
    return snapshot.docs.map(doc => doc.data());
}

async function getLast24hStatsForUser(uid) {
    const pinsSnapshot = await db.collection("pins").where("userId", "==", uid).where("archived", "==", false).get();
    const activePins = pinsSnapshot.docs.map(d => d.data());
    const completedActive = activePins.filter(p => p.status === 'delivered' || p.status === 'failed');
    const historySnapshot = await db.collection("history").where("userId", "==", uid).get();
    const allHistory = historySnapshot.docs.map(d => d.data());
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24*3600000);
    const recentHistory = allHistory.filter(item => new Date(item.archivedAt || item.createdAt) >= dayAgo);
    const delivered = completedActive.filter(p=>p.status==='delivered').length + recentHistory.filter(h=>h.status==='delivered').length;
    const failed = completedActive.filter(p=>p.status==='failed').length + recentHistory.filter(h=>h.status==='failed').length;
    const totalEarned = delivered * 3.50;
    return { delivered, failed, totalEarned };
}

// --------------------------------------------------------------
//  MAP and GLOBALS
// --------------------------------------------------------------
let map, currentUserId = null, currentUsername = null, isAdminMode = false;
let currentLocationMarker = null, watchId = null;
let isAddPinMode = false, pendingPinCoords = null;
let markersLayer = L.layerGroup();
let allCouriersPinsLayer = L.layerGroup();
let currentPosition = { lat: 41.7151, lng: 44.8271 };
let activeNearestPinId = null;
let adminSelectedCourierUid = null;
let adminPendingCoords = null;
let adminMapClickHandler = null;
let currentCalendarDate = new Date();

function initMap() {
    map = L.map('map').setView([41.7151, 44.8271], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OSM contributors'
    }).addTo(map);
    markersLayer.addTo(map);
    allCouriersPinsLayer.addTo(map);
}

function distance(lat1,lon1,lat2,lon2) {
    let R=6371e3; let φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180;
    let Δφ=(lat2-lat1)*Math.PI/180, Δλ=(lon2-lon1)*Math.PI/180;
    let a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function refreshAllPins() {
    if (!currentUserId || isAdminMode) return;
    markersLayer.clearLayers();
    const pins = await getPinsForUser(currentUserId);
    pins.forEach(pin => {
        let color = (pin.status === 'delivered' || pin.status === 'failed') ? '#e0694a' : '#7f8f9e';
        let marker = L.circleMarker([pin.lat, pin.lng], { radius: 11, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.85 });
        let namePhone = `<strong>${escapeHtml(pin.fullName)}</strong><br>📞 ${escapeHtml(pin.phone)}`;
        let content;
        if (pin.status === 'delivered') content = `${namePhone}<br><span style="color:#2c7a47;">✅ ჩაბარდა</span>`;
        else if (pin.status === 'failed') content = `${namePhone}<br><span style="color:#c25a41;">❌ ვერ ჩაბარდა</span>`;
        else content = `${namePhone}<hr><div style="display:flex; gap:10px; justify-content:center;">
            <button class="popup-btn" data-id="${pin.id}" data-status="delivered" style="background:#2c7a47; border:none; padding:5px 14px; border-radius:30px; color:white;">✅ ჩაბარდა</button>
            <button class="popup-btn" data-id="${pin.id}" data-status="failed" style="background:#b13e2e; border:none; padding:5px 14px; border-radius:30px; color:white;">❌ ვერ ჩაბარდა</button>
        </div>`;
        marker.bindPopup(content);
        marker.pinData = pin;
        marker.addTo(markersLayer);
    });
    updateNearestParcelCard();
}

async function updateNearestParcelCard() {
    if (!currentUserId || isAdminMode) { document.getElementById("nearestParcelCard").style.display = "none"; return; }
    const pins = await getPinsForUser(currentUserId);
    let pending = pins.filter(p => p.status === 'pending');
    if (pending.length === 0 || !currentPosition) { document.getElementById("nearestParcelCard").style.display = "none"; return; }
    let nearest = null, minDist = Infinity;
    for (let p of pending) {
        let d = distance(currentPosition.lat, currentPosition.lng, p.lat, p.lng);
        if (d < minDist) { minDist = d; nearest = p; }
    }
    if (nearest) {
        let distText = minDist < 1000 ? `${Math.round(minDist)} მ` : `${(minDist/1000).toFixed(1)} კმ`;
        document.getElementById("nearestParcelCard").innerHTML = `
            <i class="fas fa-location-arrow"></i> <span>📦 უახლოესი ამანათი</span><br>
            <strong>${escapeHtml(nearest.fullName)}</strong> 📞 ${escapeHtml(nearest.phone)}<br>
            <small>📍 ${distText}</small>
        `;
        document.getElementById("nearestParcelCard").style.display = "block";
        activeNearestPinId = nearest.id;
    } else document.getElementById("nearestParcelCard").style.display = "none";
}

function flyToNearestPin() {
    if (!currentUserId || isAdminMode) return;
    getPinsForUser(currentUserId).then(pins => {
        let nearest = pins.find(p => p.id === activeNearestPinId && p.status === 'pending');
        if (nearest) {
            map.flyTo([nearest.lat, nearest.lng], 17, { duration: 1 });
            setTimeout(() => {
                markersLayer.eachLayer(layer => { if (layer.pinData && layer.pinData.id === nearest.id) layer.openPopup(); });
            }, 400);
        }
    });
}

function startLiveTracking() {
    if (!navigator.geolocation) return;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            currentPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            if (!currentLocationMarker) {
                currentLocationMarker = L.circleMarker([currentPosition.lat, currentPosition.lng], { radius: 9, fillColor: '#1e88a4', color: '#fff', weight: 3 }).addTo(map);
                currentLocationMarker.bindTooltip('თქვენი მდებარეობა').openTooltip();
            } else currentLocationMarker.setLatLng([currentPosition.lat, currentPosition.lng]);
            if (!window._firstMoved) { map.setView([currentPosition.lat, currentPosition.lng], 15); window._firstMoved = true; }
            updateNearestParcelCard();
        }, err => console.warn(err), { enableHighAccuracy: true }
    );
}

function stopLiveTracking() { if(watchId) navigator.geolocation.clearWatch(watchId); watchId=null; if(currentLocationMarker) map.removeLayer(currentLocationMarker); currentLocationMarker=null; }

function showToast(msg) {
    let toast = document.createElement('div'); toast.className = 'info-toast'; toast.innerText = msg;
    document.body.appendChild(toast); setTimeout(() => toast.remove(), 2200);
}

function escapeHtml(str) { return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

function setMenuButtonVisibility(visible) { document.getElementById("menuButton").classList.toggle("hidden", !visible); }

function toggleActionPanel() {
    let panel = document.getElementById("actionPanel");
    if (panel.classList.contains("show")) {
        panel.classList.remove("show");
        setMenuButtonVisibility(true);
        if (!isAdminMode) updateNearestParcelCard();
    } else {
        panel.classList.add("show");
        setMenuButtonVisibility(false);
        document.getElementById("nearestParcelCard").style.display = "none";
    }
}

function setAddPinMode(active) {
    if (isAdminMode && active) return;
    isAddPinMode = active;
    document.getElementById("modeToast").style.display = active ? "flex" : "none";
    document.getElementById("searchBar").classList.toggle("hidden", !active);
    if (active) {
        if (!actionPanel.classList.contains("show")) setMenuButtonVisibility(false);
        document.getElementById("nearestParcelCard").style.display = "none";
    } else {
        if (!actionPanel.classList.contains("show")) setMenuButtonVisibility(true);
        if (!isAdminMode) updateNearestParcelCard();
    }
}

// --------------------------------------------------------------
//  ADMIN FUNCTIONS (Firestore-based)
// --------------------------------------------------------------
async function showAllCouriersPins() {
    if (!isAdminMode) return;
    allCouriersPinsLayer.clearLayers();
    const usersSnap = await db.collection("users").where("role", "==", "courier").get();
    let totalPins = 0;
    for (let userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const pins = await db.collection("pins").where("userId", "==", uid).where("archived", "==", false).get();
        pins.forEach(pinDoc => {
            const pin = pinDoc.data();
            if (pin.status === 'pending') {
                totalPins++;
                let marker = L.circleMarker([pin.lat, pin.lng], { radius: 10, fillColor: '#f39c12', color: '#fff', weight: 2, fillOpacity: 0.8 });
                marker.bindPopup(`<strong>${escapeHtml(pin.fullName)}</strong><br>📞 ${escapeHtml(pin.phone)}<br>👤 კურიერი: ${escapeHtml(userDoc.data().username)}<br>🏷️ ლოდინი`);
                marker.addTo(allCouriersPinsLayer);
            }
        });
    }
    showToast(`რუკაზე გამოჩნდა ${totalPins} აქტიური შეკვეთა (ყველა კურიერის).`);
}

async function showAdminPendingModal() {
    const pendingSnap = await db.collection("pendingUsers").get();
    const container = document.getElementById("pendingListContainer");
    if (pendingSnap.empty) container.innerHTML = "<div style='padding:20px;'>📭 არ არის მოითხოვილი რეგისტრაციები</div>";
    else {
        container.innerHTML = "";
        pendingSnap.forEach(doc => {
            const data = doc.data();
            const div = document.createElement("div");
            div.style.marginBottom = "10px";
            div.innerHTML = `
                <span><strong>${escapeHtml(data.username)}</strong><br><small>პაროლი: ${escapeHtml(data.password)}</small></span>
                <button class="approve-pending" data-id="${doc.id}" data-user="${escapeHtml(data.username)}" data-pass="${escapeHtml(data.password)}" style="background:#2c7a47; border:none; padding:6px 12px; border-radius:30px; color:white; margin-top:6px;">✅ დამტკიცება</button>
            `;
            container.appendChild(div);
        });
        document.querySelectorAll('.approve-pending').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.getAttribute('data-id');
                const user = btn.getAttribute('data-user');
                const pass = btn.getAttribute('data-pass');
                const ok = await approveRegistration(id, user, pass);
                if (ok) { showToast(`✅ ${user} დაემატა`); showAdminPendingModal(); }
                else showToast("შეცდომა");
            });
        });
    }
    document.getElementById("adminPendingModal").classList.add("active");
}

async function openAdminChangePwd() {
    const usersSnap = await db.collection("users").where("role", "==", "courier").get();
    const select = document.getElementById("pwdUserSelect");
    select.innerHTML = '<option value="">აირჩიე კურიერი</option>';
    usersSnap.forEach(doc => {
        const data = doc.data();
        const option = document.createElement("option");
        option.value = data.username;
        option.textContent = data.username;
        select.appendChild(option);
    });
    document.getElementById("adminChangePwdModal").classList.add("active");
}

async function openAdminAddParcelStep1() {
    const usersSnap = await db.collection("users").where("role", "==", "courier").get();
    const container = document.getElementById("courierListForParcel");
    if (usersSnap.empty) container.innerHTML = "<div>📭 კურიერები არ არიან</div>";
    else {
        container.innerHTML = "";
        usersSnap.forEach(doc => {
            const data = doc.data();
            const div = document.createElement("div");
            div.className = "courier-select-item";
            div.setAttribute("data-uid", doc.id);
            div.innerHTML = `👤 ${escapeHtml(data.username)}`;
            div.onclick = () => {
                adminSelectedCourierUid = doc.id;
                document.getElementById("adminAddParcelStep1Modal").classList.remove("active");
                document.getElementById("selectedCourierName").innerText = `კურიერი: ${data.username}`;
                document.getElementById("adminAddParcelStep2Modal").classList.add("active");
            };
            container.appendChild(div);
        });
    }
    document.getElementById("adminAddParcelStep1Modal").classList.add("active");
}

function openMapForAdminParcel() {
    document.getElementById("adminAddParcelStep2Modal").classList.remove("active");
    isAddPinMode = true;
    setMenuButtonVisibility(false);
    document.getElementById("modeToast").style.display = "flex";
    document.getElementById("modeToast").innerText = "📍 ადმინი: მონიშნე ადგილი რუკაზე";
    if (adminMapClickHandler) map.off('click', adminMapClickHandler);
    adminMapClickHandler = (e) => {
        if (!isAddPinMode || !adminSelectedCourierUid) return;
        adminPendingCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
        map.off('click', adminMapClickHandler);
        isAddPinMode = false;
        document.getElementById("modeToast").style.display = "none";
        document.getElementById("adminAddParcelStep3Modal").classList.add("active");
    };
    map.on('click', adminMapClickHandler);
}

async function finishAdminAddParcel() {
    let name = document.getElementById("adminPinFullName").value.trim();
    let phone = document.getElementById("adminPinPhone").value.trim();
    if (!name || !phone) { document.getElementById("adminPinError").innerText = "შეიყვანეთ მონაცემები"; return; }
    if (adminPendingCoords && adminSelectedCourierUid) {
        await addNewPinForUser(adminSelectedCourierUid, adminPendingCoords.lat, adminPendingCoords.lng, name, phone);
        showToast(`📦 ამანათი დაემატა კურიერს`);
    }
    document.getElementById("adminPinFullName").value = "";
    document.getElementById("adminPinPhone").value = "";
    document.getElementById("adminAddParcelStep3Modal").classList.remove("active");
    adminPendingCoords = null;
    adminSelectedCourierUid = null;
    if (!actionPanel.classList.contains("show")) setMenuButtonVisibility(true);
    isAddPinMode = false;
    document.getElementById("modeToast").style.display = "none";
    if (adminMapClickHandler) map.off('click', adminMapClickHandler);
}

async function openAdminAnalytics() {
    const usersSnap = await db.collection("users").where("role", "==", "courier").get();
    const container = document.getElementById("userListContainer");
    if (usersSnap.empty) container.innerHTML = "<div>📭 კურიერები არ არიან</div>";
    else {
        container.innerHTML = "";
        usersSnap.forEach(doc => {
            const data = doc.data();
            const div = document.createElement("div");
            div.className = "user-list-item";
            div.setAttribute("data-uid", doc.id);
            div.innerHTML = `👤 ${escapeHtml(data.username)}`;
            div.onclick = () => openAnalyticsForUser(doc.id, data.username);
            container.appendChild(div);
        });
    }
    document.getElementById("adminUserSelectModal").classList.add("active");
}

async function openAnalyticsForUser(uid, username) {
    document.getElementById("adminUserSelectModal").classList.remove("active");
    currentCalendarDate = new Date();
    document.getElementById("calendarModalTitle").innerHTML = `📊 ანალიტიკა: ${escapeHtml(username)} + შემოსავალი`;
    renderCalendar("calendarContainer", async (dateStr) => {
        const historySnap = await db.collection("history").where("userId", "==", uid).get();
        const targetDateStr = new Date(dateStr).toISOString().split('T')[0];
        const filtered = historySnap.docs.map(d => d.data()).filter(item => {
            const itemDate = new Date(item.archivedAt || item.createdAt);
            return itemDate.toISOString().split('T')[0] === targetDateStr;
        });
        const deliveredCount = filtered.filter(i => i.status === 'delivered').length;
        const failedCount = filtered.filter(i => i.status === 'failed').length;
        const totalEarned = deliveredCount * 3.50;
        let html = `<div style="margin: 10px 0;">📅 ${dateStr}<br>✅ ჩაბარდა: ${deliveredCount} | ❌ ვერ: ${failedCount} | 📦 სულ: ${filtered.length}<br>💰 გამომუშავებული: ${totalEarned.toFixed(2)} ლარი</div>`;
        if (filtered.length === 0) html += `<div>📭 ამ დღეს არანაირი შეკვეთა</div>`;
        else {
            html += `<div class="history-list">`;
            filtered.forEach(item => {
                html += `<div class="history-item">
                    <strong>${escapeHtml(item.fullName)}</strong><br>📞 ${escapeHtml(item.phone)}<br>
                    🏷️ ${item.status === 'delivered' ? 'ჩაბარდა' : 'ვერ ჩაბარდა'}<br>
                    ⏱️ ${new Date(item.archivedAt || item.createdAt).toLocaleString('ka-GE')}
                </div>`;
            });
            html += `</div>`;
        }
        document.getElementById("calendarHistoryList").innerHTML = html;
    });
    document.getElementById("calendarModal").classList.add("active");
}

// --------------------------------------------------------------
//  COURIER HISTORY & STATS
// --------------------------------------------------------------
async function openCourierHistory() {
    if (!currentUserId) return;
    currentCalendarDate = new Date();
    document.getElementById("calendarModalTitle").innerHTML = "📅 ჩემი ისტორია + შემოსავალი";
    renderCalendar("calendarContainer", async (dateStr) => {
        const historySnap = await db.collection("history").where("userId", "==", currentUserId).get();
        const targetDateStr = new Date(dateStr).toISOString().split('T')[0];
        const filtered = historySnap.docs.map(d => d.data()).filter(item => {
            const itemDate = new Date(item.archivedAt || item.createdAt);
            return itemDate.toISOString().split('T')[0] === targetDateStr;
        });
        const deliveredCount = filtered.filter(i => i.status === 'delivered').length;
        const failedCount = filtered.filter(i => i.status === 'failed').length;
        const totalEarned = deliveredCount * 3.50;
        let html = `<div style="margin: 10px 0;">📅 ${dateStr}<br>✅ ჩაბარდა: ${deliveredCount} | ❌ ვერ: ${failedCount} | 📦 სულ: ${filtered.length}<br>💰 გამომუშავებული: ${totalEarned.toFixed(2)} ლარი</div>`;
        if (filtered.length === 0) html += `<div>📭 ამ დღეს არანაირი შეკვეთა</div>`;
        else {
            html += `<div class="history-list">`;
            filtered.forEach(item => {
                html += `<div class="history-item">
                    <strong>${escapeHtml(item.fullName)}</strong><br>📞 ${escapeHtml(item.phone)}<br>
                    🏷️ ${item.status === 'delivered' ? 'ჩაბარდა' : 'ვერ ჩაბარდა'}<br>
                    ⏱️ ${new Date(item.archivedAt || item.createdAt).toLocaleString('ka-GE')}
                </div>`;
            });
            html += `</div>`;
        }
        document.getElementById("calendarHistoryList").innerHTML = html;
    });
    document.getElementById("calendarModal").classList.add("active");
}

async function showTodayStats() {
    if (!currentUserId || isAdminMode) return;
    const stats = await getLast24hStatsForUser(currentUserId);
    document.getElementById("todayStatsContent").innerHTML = `
        <div>✅ ჩაბარდა: <strong>${stats.delivered}</strong></div>
        <div>❌ ვერ ჩაბარდა: <strong>${stats.failed}</strong></div>
        <div>💰 გამომუშავებული: <strong>${stats.totalEarned.toFixed(2)} ლარი</strong> (3.50 ლარი/ამანათი)</div>
    `;
    document.getElementById("todayStatsModal").classList.add("active");
}

// --------------------------------------------------------------
//  CALENDAR RENDERING (shared)
// --------------------------------------------------------------
function renderCalendar(containerId, onDateSelect) {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let html = `<div class="calendar-nav">
        <button class="btn-secondary" id="prevMonthBtn">◀</button>
        <span>${year} წელი, ${month+1} თვე</span>
        <button class="btn-secondary" id="nextMonthBtn">▶</button>
    </div><div class="calendar-grid">`;
    const weekdays = ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვ'];
    let offset = (startDayOfWeek === 0 ? 6 : startDayOfWeek - 1);
    for (let i = 0; i < 7; i++) html += `<div style="font-weight:bold;">${weekdays[i]}</div>`;
    for (let i = 0; i < offset; i++) html += `<div class="calendar-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
        html += `<div class="calendar-day" data-date="${year}-${month+1}-${d}">${d}</div>`;
    }
    html += `</div>`;
    document.getElementById(containerId).innerHTML = html;

    document.getElementById("prevMonthBtn").onclick = () => {
        currentCalendarDate = new Date(year, month-1, 1);
        renderCalendar(containerId, onDateSelect);
    };
    document.getElementById("nextMonthBtn").onclick = () => {
        currentCalendarDate = new Date(year, month+1, 1);
        renderCalendar(containerId, onDateSelect);
    };
    document.querySelectorAll(`#${containerId} .calendar-day[data-date]`).forEach(el => {
        el.addEventListener("click", () => {
            const dateStr = el.getAttribute("data-date");
            onDateSelect(dateStr);
        });
    });
}

// --------------------------------------------------------------
//  LOGIN / LOGOUT / UI HELPERS
// --------------------------------------------------------------
function buildMenu() {
    let panel = document.getElementById("actionPanel");
    if (isAdminMode) {
        panel.innerHTML = `
            <div class="action-item" id="adminAllPinsAction"><i class="fas fa-globe"></i> ყველა კურიერის პინები</div>
            <div class="action-item" id="adminCompleteRegAction"><i class="fas fa-user-check"></i> რეგისტრაციის დასრულება</div>
            <div class="action-item" id="adminChangePwdAction"><i class="fas fa-key"></i> კურიერის პაროლის შეცვლა</div>
            <div class="action-item" id="adminAddParcelAction"><i class="fas fa-plus-circle"></i> ახალი ამანათის დამატება</div>
            <div class="action-item" id="adminAnalyticsAction"><i class="fas fa-chart-line"></i> ანალიტიკა</div>
            <div class="action-item" id="logoutAction"><i class="fas fa-sign-out-alt"></i> გამოსვლა</div>
        `;
        document.getElementById("adminAllPinsAction").onclick = () => { showAllCouriersPins(); toggleActionPanel(); };
        document.getElementById("adminCompleteRegAction").onclick = () => showAdminPendingModal();
        document.getElementById("adminChangePwdAction").onclick = () => openAdminChangePwd();
        document.getElementById("adminAddParcelAction").onclick = () => openAdminAddParcelStep1();
        document.getElementById("adminAnalyticsAction").onclick = () => openAdminAnalytics();
        document.getElementById("logoutAction").onclick = () => logout();
    } else {
        panel.innerHTML = `
            <div class="action-item" id="findAddressAction"><i class="fas fa-location-dot"></i> მისამართის პოვნა</div>
            <div class="action-item" id="todayStatsAction"><i class="fas fa-sun"></i> დღეს</div>
            <div class="action-item" id="historyAction"><i class="fas fa-archive"></i> ისტორია</div>
            <div class="action-item" id="endDayAction"><i class="fas fa-calendar-day"></i> დღის დასრულება</div>
            <div class="action-item" id="logoutAction"><i class="fas fa-sign-out-alt"></i> გამოსვლა</div>
        `;
        document.getElementById("findAddressAction").onclick = () => { setAddPinMode(true); toggleActionPanel(); };
        document.getElementById("todayStatsAction").onclick = () => { showTodayStats(); toggleActionPanel(); };
        document.getElementById("historyAction").onclick = () => { openCourierHistory(); toggleActionPanel(); };
        document.getElementById("endDayAction").onclick = () => { document.getElementById("endDayConfirmModal").classList.add("active"); toggleActionPanel(); };
        document.getElementById("logoutAction").onclick = () => logout();
    }
}

function logout() {
    stopLiveTracking();
    auth.signOut();
    currentUserId = null; currentUsername = null; isAdminMode = false;
    markersLayer.clearLayers();
    allCouriersPinsLayer.clearLayers();
    setAddPinMode(false);
    setMenuButtonVisibility(false);
    actionPanel.classList.remove("show");
    document.getElementById("nearestParcelCard").style.display = "none";
    map.setView([41.7151, 44.8271], 13);
    setTimeout(() => showLoginModal(), 100);
}

function hideAllModals() {
    let ids = ["loginModal","regModal","adminPendingModal","adminChangePwdModal","adminAddParcelStep1Modal","adminAddParcelStep2Modal","adminAddParcelStep3Modal","calendarModal","todayStatsModal","adminUserSelectModal","pinInfoModal","endDayConfirmModal"];
    ids.forEach(id => document.getElementById(id)?.classList.remove("active"));
}

function showLoginModal() { document.getElementById("loginModal").classList.add("active"); document.getElementById("regModal").classList.remove("active"); document.getElementById("loginError").innerText = ""; }

async function afterLoginSuccess(uid, username, isAdmin) {
    currentUserId = uid; currentUsername = username; isAdminMode = isAdmin;
    hideAllModals();
    setMenuButtonVisibility(true);
    buildMenu();
    if (!isAdminMode) {
        await refreshAllPins();
        startLiveTracking();
    } else {
        markersLayer.clearLayers();
        allCouriersPinsLayer.clearLayers();
        if (watchId) navigator.geolocation.clearWatch(watchId);
    }
    setAddPinMode(false);
    window._firstMoved = false;
    if (!isAdminMode) updateNearestParcelCard(); else document.getElementById("nearestParcelCard").style.display = "none";
    if (adminMapClickHandler) map.off('click', adminMapClickHandler);
}

// --------------------------------------------------------------
//  GEOCODING (search address)
// --------------------------------------------------------------
function searchAddress(query, callback) {
    if (!query.trim()) return;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`)
        .then(res=>res.json()).then(data=>{
            if(data && data.length) callback({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
            else callback(null);
        }).catch(()=>callback(null));
}

// --------------------------------------------------------------
//  EVENT LISTENERS (window.onload)
// --------------------------------------------------------------
window.onload = async () => {
    initMap();
    await createDefaultAdmin();
    setTimeout(() => { if(!currentUserId) showLoginModal(); }, 500);
    setMenuButtonVisibility(false);

    document.getElementById("doLoginBtn").onclick = async () => {
        let user = document.getElementById("loginUsername").value;
        let pass = document.getElementById("loginPassword").value;
        let authResult = await authenticateUser(user, pass);
        if (authResult === "admin") {
            const adminUser = auth.currentUser;
            if (adminUser) await afterLoginSuccess(adminUser.uid, "admin", true);
            else showToast("ადმინის შეცდომა");
        } else if (authResult === "user") {
            const currentAuthUser = auth.currentUser;
            const userDoc = await db.collection("users").doc(currentAuthUser.uid).get();
            const username = userDoc.data().username;
            await afterLoginSuccess(currentAuthUser.uid, username, false);
        } else {
            document.getElementById("loginError").innerText = "ლოგინი ან პაროლი არასწორია";
        }
    };
    document.getElementById("showRegLink").onclick = () => { document.getElementById("loginModal").classList.remove("active"); document.getElementById("regModal").classList.add("active"); };
    document.getElementById("backToLoginLink").onclick = () => { document.getElementById("regModal").classList.remove("active"); showLoginModal(); };
    document.getElementById("doRegBtn").onclick = async () => {
        let user = document.getElementById("regUsername").value;
        let pass = document.getElementById("regPassword").value;
        let res = await requestRegistration(user, pass);
        if (res.success) { alert(res.msg); document.getElementById("regModal").classList.remove("active"); showLoginModal(); }
        else document.getElementById("regError").innerText = res.msg;
    };
    document.getElementById("menuButton").onclick = (e) => { e.stopPropagation(); toggleActionPanel(); };
    document.getElementById("closePendingBtn").onclick = () => document.getElementById("adminPendingModal").classList.remove("active");
    document.getElementById("closeCalendarBtn").onclick = () => document.getElementById("calendarModal").classList.remove("active");
    document.getElementById("closeUserSelectBtn").onclick = () => document.getElementById("adminUserSelectModal").classList.remove("active");
    document.getElementById("closeTodayStatsBtn").onclick = () => document.getElementById("todayStatsModal").classList.remove("active");
    document.getElementById("confirmEndDayBtn").onclick = () => { if (currentUserId && !isAdminMode) archiveAllPinsToHistory(currentUserId); document.getElementById("endDayConfirmModal").classList.remove("active"); };
    document.getElementById("cancelEndDayBtn").onclick = () => document.getElementById("endDayConfirmModal").classList.remove("active");
    document.getElementById("doChangePwdBtn").onclick = async () => {
        let selectedUser = document.getElementById("pwdUserSelect").value;
        let newPwd = document.getElementById("newPassword").value;
        if (!selectedUser || !newPwd) { document.getElementById("pwdError").innerText = "აირჩიე მომხმარებელი და შეიყვანე ახალი პაროლი"; return; }
        let ok = await changeUserPassword(selectedUser, newPwd);
        if (ok) { showToast(`პაროლის აღდგენის ლინკი გაეგზავნა ${selectedUser} მომხმარებელს`); document.getElementById("adminChangePwdModal").classList.remove("active"); }
        else showToast("შეცდომა");
    };
    document.getElementById("cancelChangePwdBtn").onclick = () => document.getElementById("adminChangePwdModal").classList.remove("active");
    document.getElementById("cancelAddParcelBtn").onclick = () => document.getElementById("adminAddParcelStep1Modal").classList.remove("active");
    document.getElementById("startMapSelectionBtn").onclick = () => openMapForAdminParcel();
    document.getElementById("cancelStep2Btn").onclick = () => document.getElementById("adminAddParcelStep2Modal").classList.remove("active");
    document.getElementById("saveAdminPinBtn").onclick = () => finishAdminAddParcel();
    document.getElementById("cancelStep3Btn").onclick = () => document.getElementById("adminAddParcelStep3Modal").classList.remove("active");
    document.getElementById("savePinBtn").onclick = async () => {
        let name = document.getElementById("pinFullName").value.trim();
        let phone = document.getElementById("pinPhone").value.trim();
        if (!name || !phone) { document.getElementById("pinInfoError").innerText = "შეიყვანეთ მონაცემები"; return; }
        if (pendingPinCoords && currentUserId) {
            await addNewPinForUser(currentUserId, pendingPinCoords.lat, pendingPinCoords.lng, name, phone);
            pendingPinCoords = null;
            await refreshAllPins();
        }
        document.getElementById("pinInfoModal").classList.remove("active");
        setAddPinMode(false);
    };
    document.getElementById("cancelPinBtn").onclick = () => { document.getElementById("pinInfoModal").classList.remove("active"); pendingPinCoords = null; setAddPinMode(false); };
    document.getElementById("searchAddressBtn").onclick = () => {
        let query = document.getElementById("addressInput").value.trim();
        if (!query) return;
        searchAddress(query, (coords) => {
            if (coords) { map.setView([coords.lat, coords.lng], 18); pendingPinCoords = coords; document.getElementById("pinFullName").value = ""; document.getElementById("pinPhone").value = ""; document.getElementById("pinInfoModal").classList.add("active"); }
            else showToast("მისამართი ვერ მოიძებნა");
        });
    };
    document.getElementById("addressInput").addEventListener("keypress", (e) => { if(e.key === "Enter") document.getElementById("searchAddressBtn").click(); });
    document.getElementById("nearestParcelCard").addEventListener("click", () => flyToNearestPin());
    document.addEventListener("click", (e) => {
        if (e.target.classList && e.target.classList.contains('popup-btn')) {
            let id = e.target.getAttribute('data-id');
            let status = e.target.getAttribute('data-status');
            updatePinStatus(id, status).then(() => refreshAllPins());
        }
    });
    document.addEventListener("click", (e) => {
        if (actionPanel.classList.contains("show") && !actionPanel.contains(e.target) && !menuBtn.contains(e.target)) {
            actionPanel.classList.remove("show");
            setMenuButtonVisibility(true);
            if (!isAdminMode) updateNearestParcelCard();
        }
    });
    map.on('click', (e) => { if (currentUserId && !isAdminMode && isAddPinMode) { pendingPinCoords = { lat: e.latlng.lat, lng: e.latlng.lng }; document.getElementById("pinFullName").value = ""; document.getElementById("pinPhone").value = ""; document.getElementById("pinInfoModal").classList.add("active"); } });
};
