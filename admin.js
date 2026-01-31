// Admin Panel Logic

// --- Real Data Loading ---

// Variables to hold current data state
let appUsers = [];
let appBookings = [];
let allCarsData = [];
let appServices = []; // New
let appAnnouncements = []; // List System v4
let appVipRequests = []; // NEW

// Function to refresh data from LocalStorage
function loadData() {
    appUsers = Core.getData('app_users');
    if (!Array.isArray(appUsers)) appUsers = [];
    appBookings = Core.getData('app_bookings');
    if (!Array.isArray(appBookings)) appBookings = []; // Safety check

    // FIX: Deduplicate Bookings (Cleanup previous bug)
    const uniqueBookings = [];
    const seenIds = new Set();
    let foundDupes = false;
    appBookings.forEach(b => {
        if (!seenIds.has(b.id)) {
            seenIds.add(b.id);
            uniqueBookings.push(b);
        } else {
            foundDupes = true;
        }
    });
    if (foundDupes) {
        appBookings = uniqueBookings;
        Core.saveData('app_bookings', appBookings);
    }
    appAnnouncements = Core.getData('app_announcements_v4');
    appVipRequests = Core.getData('vip_requests');

    // Load services or init default if empty
    appServices = Core.getData('app_services');

    if (appServices.length === 0) {
        appServices = [
            { id: 'srv_1', name: 'Belső Takarítás', duration: 30, price: 4500, cost: 500 },
            { id: 'srv_2', name: 'Prémium Mosás', duration: 60, price: 8500, cost: 1200 }
        ];
        Core.saveData('app_services', appServices);
    }

    // Data Back-filling: Ensure all bookings have a price and cost based on their service
    let bookingsModified = false;
    appBookings.forEach(b => {
        // Fix: Only fill if price is incorrectly missing (undefined). 
        // Do NOT overwrite 0, as that indicates a Free/VIP booking.
        if (b.price === undefined && b.service) {
            const srv = appServices.find(s => s.name === b.service);
            if (srv) {
                b.price = srv.price;
                if (!b.cost) b.cost = srv.cost || 0;
                bookingsModified = true;
            }
        }
    });
    if (bookingsModified) {
        Core.saveData('app_bookings', appBookings);
    }

    // SEED DATA: If no bookings, create some
    // ... (marad a seed logika)

    // Rebuild Cars
    allCarsData = [];
    appUsers.forEach(user => {
        const userCars = Core.getData(`cars_${user.id}`);
        userCars.forEach(car => {
            allCarsData.push({ ...car, ownerId: user.id, ownerName: user.name });
        });
    });
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    // BIZTONSÁGI FRISSÍTÉS: Autentikáció inicializálása ELŐSZÖR
    checkAdminAuth();

    // Helper for Heartbeat UI (Fixing "Betöltés..." issue)
    const updateHeartbeatUI = () => {
        const appHeartbeat = Core.updateSystemHeartbeat();
        const hbEl = document.getElementById('system-heartbeat-display');
        if (hbEl) hbEl.textContent = Core.formatDate(appHeartbeat);
    };

    // UI Init - Always run immediately
    Core.setupLiveClock('current-date');
    updateHeartbeatUI();

    try {
        loadData(); // Initial load
        updateDashboard();
        updateAnnouncementTile();
        renderAnnouncements();
        setupAnnouncementLogic();

        // Auto-refresh periodically (e.g. every 15 seconds) to keep it live
        setInterval(() => {
            try {
                loadData();
                updateDashboard();
                updateHeartbeatUI();
            } catch (err) { console.error("Auto-refresh logic error", err); }
        }, 15000);

        // REAL-TIME SYNC: Listen for changes from Client App
        window.addEventListener('storage', (e) => {
            // Only update if relevant data changed
            if (!e.key || e.key.startsWith('app_') || e.key.startsWith('vip_') || e.key.startsWith('cars_')) {
                console.log("Statisztika frissítése külső változás miatt...");
                loadData();
                updateDashboard();
            }
        });

    } catch (e) {
        console.error("CRITICAL INIT ERROR:", e);
        // Ensure UI doesn't look totally broken if auth passed but data failed
        if (sessionStorage.getItem('admin_authenticated') === 'true') {
            alert("Rendszerhiba az adatok betöltésekor! (Ellenőrizd a konzolt/adatbázist)");
        }
    }

    // --- Restore Modal State (Safe Restoration) ---
    try {
        const lastModal = sessionStorage.getItem('admin_active_modal');
        if (lastModal) {
            openModal(lastModal);

            // Restore Schedule Tab if applicable
            if (lastModal === 'schedule-modal') {
                const lastTab = sessionStorage.getItem('admin_schedule_tab') || 'active';
                switchScheduleTab(lastTab);
            }
        }
    } catch (e) {
        console.error("Critical error during state restoration:", e);
        sessionStorage.clear(); // Emergency clear
    }


});

const ADMIN_PASSWORD = "admin123"; // Default password as requested

function checkAdminAuth() {
    const isAuth = sessionStorage.getItem('admin_authenticated');
    const overlay = document.getElementById('admin-login-overlay');
    const logoutBtn = document.getElementById('admin-logout-btn');

    if (isAuth === 'true') {
        if (overlay) overlay.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'block';
    } else {
        if (overlay) overlay.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';

        // Setup Login Form Listener
        const loginForm = document.getElementById('admin-login-form');
        if (loginForm) {
            loginForm.onsubmit = (e) => {
                e.preventDefault();
                const input = document.getElementById('admin-pw-input');
                const error = document.getElementById('login-error');

                if (input.value === ADMIN_PASSWORD) {
                    sessionStorage.setItem('admin_authenticated', 'true');
                    if (overlay) overlay.style.display = 'none';
                    if (logoutBtn) logoutBtn.style.display = 'block';
                    if (error) error.style.display = 'none';
                    updateDashboard();
                    // Szinkronizáció db.json-nal
                    syncToDisk();
                } else {
                    if (error) error.style.display = 'block';
                    input.value = '';
                    input.focus();
                }
            };
        }
    }
}

// Global Logout Function
window.logoutAdmin = function () {
    sessionStorage.removeItem('admin_authenticated');
    window.location.reload();
};

// Wire up logout button
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = logoutAdmin;
    }
});

// Eltávolítva: updateSystemHeartbeat és setupDate (Core.js-be költözött)

function updateDashboard() {
    // Ensure we have latest data
    // (Called by interval or manual loadData calls)
    // Ensure we have latest data
    // (Called by interval or manual loadData calls)
    // loadData(); // OPTIMIZED: Removed redundant call. Data is passed or already loaded.

    // Update Counts
    const userCountEl = document.getElementById('total-users-count');
    if (userCountEl) userCountEl.textContent = `${appUsers.length} regisztrált`;

    // VIP Pending Count
    const pendingVips = appVipRequests.filter(r => r.status === 'pending').length;
    const pendingVipEl = document.getElementById('pending-vip-count');
    if (pendingVipEl) pendingVipEl.textContent = `${pendingVips} folyamatban`;

    const carCountEl = document.getElementById('total-cars-count');
    if (carCountEl) carCountEl.textContent = `${allCarsData.length} autó`;

    // Update Services Count
    const srvCountEl = document.getElementById('total-services-count');
    if (srvCountEl) srvCountEl.textContent = `${appServices.length} db`;

    // AI VIP Counter
    const vipCount = appUsers.filter(u => u.level && u.level !== 'Bronze').length;
    const vipEl = document.getElementById('stat-vip-count');
    if (vipEl) vipEl.textContent = `${vipCount} VIP`;

    // Schedule Count (Today)
    const todayStr = Core.getISODate();
    const todaysBookings = appBookings.filter(b => b.date === todayStr && b.status !== 'cancelled');
    const activeJobsCount = todaysBookings.filter(b => ['active', 'on_way', 'arrived', 'started'].includes(b.status)).length;
    const completedJobs = todaysBookings.filter(b => b.status === 'completed').length; // FIXED: Added missing definition
    const todayJobsEl = document.getElementById('today-jobs-count');
    if (todayJobsEl) todayJobsEl.innerHTML = `<span style="color:#4cc9f0; font-weight:bold;">Aktív: ${activeJobsCount}</span> <span style="opacity:0.5;">|</span> <span style="color:#00cc66;">Kész: ${completedJobs}</span>`;

    // Update progress bar
    let progressPct = 0;
    if (todaysBookings.length > 0) {
        progressPct = (completedJobs / todaysBookings.length) * 100;
    }
    const progFill = document.querySelector('.progress-fill');
    if (progFill) progFill.style.width = `${progressPct}%`;

    // --- PÉNZÜGYI SZÁMÍTÁSOK (Nap és idő alapú kalkulátor) ---
    // Count everything except cancelled for "Potential Revenue"
    // AND filter out archived revenue (reset logic)
    const validBookings = appBookings.filter(b => b.status !== 'cancelled' && !b.revenueArchived);

    let totalRevenue = 0;
    let totalExpenses = 0;

    // Reviews Calc
    let totalRating = 0;
    let reviewCount = 0;

    validBookings.forEach(booking => {
        // Revenue
        const price = booking.price || 0;
        totalRevenue += price;

        // Expenses
        let cost = booking.cost || 0;
        if (cost === 0 && booking.service) {
            const srv = appServices.find(s => s.name === booking.service);
            if (srv) cost = srv.cost || 0;
        }
        totalExpenses += cost;

        // Review
        if (booking.review) {
            totalRating += booking.review.rating;
            reviewCount++;
        }
    });

    const totalProfit = totalRevenue - totalExpenses;
    const avgRating = reviewCount > 0 ? (totalRating / reviewCount).toFixed(1) : '-';

    const revMain = document.getElementById('stat-revenue-main');
    if (revMain) revMain.innerText = Core.formatCurrency(totalRevenue);

    const profMain = document.getElementById('stat-profit-main');
    if (profMain) profMain.innerText = Core.formatCurrency(totalProfit);

    // Update Finance Modal Stats (if open/exists)
    const finRev = document.getElementById('fin-revenue');
    if (finRev) finRev.innerText = Core.formatCurrency(totalRevenue);
    const finExp = document.getElementById('fin-expense');
    if (finExp) finExp.innerText = Core.formatCurrency(totalExpenses);
    const finProf = document.getElementById('fin-profit');
    if (finProf) finProf.innerText = Core.formatCurrency(totalProfit);

    const avgEl = document.getElementById('avg-rating');
    if (avgEl) avgEl.innerText = avgRating + (reviewCount > 0 ? ' ⭐' : '');

    // Only render active modal content to save performance
    const activeModal = sessionStorage.getItem('admin_active_modal');

    try { updateAnnouncementTile(); } catch (e) { console.error(e); } // Always update tile

    if (activeModal === 'services-modal') try { renderServices(); } catch (e) { }
    if (activeModal === 'reviews-modal') try { renderReviews(); } catch (e) { }
    if (activeModal === 'gifts-modal') try { renderGifts(); } catch (e) { }
    if (activeModal === 'vip-requests-modal') try { renderVIPRequests(); } catch (e) { }
    if (activeModal === 'schedule-modal') try { renderSchedule(); } catch (e) { }
    if (activeModal === 'users-modal') try { renderUsers(); } catch (e) { }
    if (activeModal === 'cars-modal') try { renderCars(); } catch (e) { }
}

// --- System Reset Logic (Physical Button - Revenue ONLY) ---
window.archiveRevenue = function () {
    if (confirm("Biztosan nullázod a BEVÉTEL SZÁMLÁLÓT?\n\n(Ez NEM törli a foglalásokat, csak a pénzügyi statisztikát indítja újra nulláról.)")) {
        let count = 0;
        appBookings.forEach(b => {
            if (!b.revenueArchived && b.status !== 'cancelled') {
                b.revenueArchived = true;
                count++;
            }
        });

        Core.saveData('app_bookings', appBookings);
        updateDashboard();

        // Visual feedback
        const revEl = document.getElementById('stat-revenue-main');
        if (revEl) {
            revEl.style.color = '#fff';
            setTimeout(() => revEl.style.color = '', 500);
        }

        alert(`Számláló nullázva! (${count} tétel archiválva) 📉`);
    }
}

// --- Selective Data Management (Settings) ---

window.deleteAllBookings = function () { // Renamed from resetSystemRevenue to be specific
    if (confirm("⚠️ FIGYELEM! ⚠️\n\nEz a gomb TÖRLI AZ ÖSSZES FOGLALÁST a naptárból!\n(A bevétel statisztika is törlődik velük együtt.)\n\nBiztosan folytatod?")) {
        appBookings = [];
        Core.saveData('app_bookings', appBookings);

        updateDashboard();
        renderSchedule();
        try { renderReviews(); } catch (e) { }

        alert("Minden foglalás véglegesen törölve! 🗑️");
    }
}

window.clearAllCars = function () {
    if (confirm("Biztosan törlöd az ÖSSZES autót a rendszerből?\n(A felhasználók megmaradnak, de az autóik nem.)")) {
        allCarsData = [];
        Core.saveData('all_cars_data', allCarsData); // Save empty array to disk
        syncToDisk(); // Ensure changes are written to db.json
        // LocalStorage takarítása
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cars_')) {
                localStorage.removeItem(key);
            }
        }
        // Admin memóriából is törölni kell, ami a save-nél nem elég, manuálisan kell
        // A fenti loop a kulcsokat szedi ki, de a memoriában lévő allCarsData már üres.
        // A felhasználókhoz nem nyúlunk.

        updateDashboard();
        renderCars();
        alert("Minden autó törölve! 🚗💥");
    }
}

window.clearAllVIPs = function () {
    if (confirm("Biztosan törlöd az összes VIP igénylést?")) {
        appVipRequests = [];
        Core.saveData('vip_requests', appVipRequests);
        updateDashboard();
        renderVIPRequests();
        alert("VIP igénylések törölve! 👑💥");
    }
}

window.clearAllUsers = function () {
    if (confirm("⚠️ FIGYELEM! ⚠️\n\nEz törli az ÖSSZES FELHASZNÁLÓT és az autóikat is!\nA foglalások (bevétel) megmaradnak (statisztikának), de név nélkül maradhatnak.\n\nBiztosan?")) {
        if (confirm("Tényleg biztos? Nincs visszaút!")) {
            appUsers = [];
            allCarsData = [];

            // Clean LocalStorage cars
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('cars_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));

            Core.saveData('app_users', appUsers);

            updateDashboard();
            renderUsers();
            renderCars();
            alert("Minden felhasználó törölve! 👥💥");
        }
    }
}

// ... Render Functions ...

function renderReviews() {
    const tbody = document.querySelector('#reviews-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Get reviewed bookings
    const reviewed = appBookings.filter(b => b.review).sort((a, b) => new Date(b.review.timestamp) - new Date(a.review.timestamp));

    const summary = document.getElementById('reviews-summary');
    const avgEl = document.getElementById('avg-rating');
    const avg = avgEl ? avgEl.innerText : '-';
    if (summary) {
        summary.innerHTML = `
            <div style="font-size:2em; font-weight:bold; color:#ffc107;">${avg}</div>
            <div style="opacity:0.7;">${reviewed.length} vélemény alapján</div>
        `;
    }

    if (reviewed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Még nem érkezett értékelés.</td></tr>';
        return;
    }

    const rows = reviewed.map(b => {
        const stars = '⭐'.repeat(b.review.rating);
        const date = new Date(b.review.timestamp).toLocaleDateString('hu-HU');

        return `
            <tr>
                <td>${date}</td>
                <td>
                    <div>${b.userName}</div>
                    <div style="font-size:0.8em; opacity:0.7;">${b.carDetails}</div>
                </td>
                <td style="color:#ffc107;">${stars}</td>
                <td><em style="opacity:0.9;">"${b.review.comment}"</em></td>
            </tr>
        `;
    });
    tbody.innerHTML = rows.join('');
}

function renderServices() {
    const tbody = document.querySelector('#services-table tbody');
    if (!tbody) return; // Guard clause if element missing
    tbody.innerHTML = '';

    if (appServices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nincs rögzített szolgáltatás.</td></tr>';
        return;
    }

    const rows = appServices.map(srv => {
        const cost = srv.cost || 0;
        const profit = srv.price - cost;
        const profitClass = profit > 0 ? 'color:#ccffcc' : 'color:#ffcccc';

        const typeText = srv.type === 'extra' ? 'Extra (+)' : 'Alap';
        const typeStyle = srv.type === 'extra' ? 'color:#ffd700; font-size:0.8em; font-weight:bold;' : 'color:#4cc9f0; font-size:0.8em; font-weight:bold;';

        return `
            <tr>
                <td><span style="${typeStyle}">${typeText}</span></td>
                <td><strong>${srv.name}</strong></td>
                <td>${srv.duration} perc</td>
                <td>${Core.formatCurrency(srv.price)}</td>
                <td style="color:#ffcccc;">${Core.formatCurrency(cost)}</td>
                <td style="${profitClass}; font-weight:bold;">${Core.formatCurrency(profit)}</td>
                <td>
                    <button class="btn-edit-small" onclick="editService('${srv.id}')" title="Szerkesztés" style="margin-right: 5px; background: none; border: none; color: #4cc9f0; cursor: pointer;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-delete-small" onclick="deleteService('${srv.id}')" title="Törlés">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rows.join('');
}

function deleteService(id) {
    if (confirm("Biztosan törlöd ezt a szolgáltatást?")) {
        appServices = appServices.filter(s => s.id !== id);
        localStorage.setItem('app_services', JSON.stringify(appServices));

        // Frissítsük a UI-t reload nélkül
        updateDashboard();
        renderServices();
    }
}

// Add/Edit Service Logic
const addServiceForm = document.getElementById('add-service-form');
let editingServiceId = null; // Track if we are editing

// Function to populate form for editing
function editService(id) {
    const service = appServices.find(s => s.id === id);
    if (!service) return;

    editingServiceId = id;

    // Populate form
    document.getElementById('srv-name').value = service.name;
    document.getElementById('srv-time').value = service.duration;
    document.getElementById('srv-price').value = service.price;
    document.getElementById('srv-cost').value = service.cost || 0;
    const typeSelect = document.getElementById('srv-type');
    if (typeSelect) typeSelect.value = service.type || 'base';

    // Change UI to "Edit Mode"
    const submitBtn = addServiceForm.querySelector('button[type="submit"]');
    submitBtn.textContent = "Mentés (Módosítás)";
    submitBtn.classList.add('pulse-animation'); // Visual cue

    // Scroll to form (optional, if list is long)
    document.querySelector('.modal-body').scrollTop = 0;
}

if (addServiceForm) {
    addServiceForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('srv-name').value;
        const time = parseInt(document.getElementById('srv-time').value);
        const price = parseInt(document.getElementById('srv-price').value);
        const cost = parseInt(document.getElementById('srv-cost').value) || 0;
        const type = document.getElementById('srv-type').value || 'base';

        if (name && !isNaN(time) && !isNaN(price)) { // Allow 0 duration and 0 price, but must be numbers
            if (editingServiceId) {
                // UPDATE existing
                const index = appServices.findIndex(s => s.id === editingServiceId);
                if (index !== -1) {
                    appServices[index] = {
                        ...appServices[index],
                        name,
                        duration: time,
                        price,
                        cost,
                        type
                    };
                    alert("Szolgáltatás módosítva!");
                }
                editingServiceId = null; // Reset

                // Reset UI
                const submitBtn = addServiceForm.querySelector('button[type="submit"]');
                submitBtn.textContent = "Hozzáadás";
                submitBtn.classList.remove('pulse-animation');

            } else {
                // CREATE new
                const newService = {
                    id: 'srv_' + Date.now(),
                    name: name,
                    duration: time,
                    price: price,
                    cost: cost,
                    type: type
                };
                appServices.push(newService);
                // alert("Szolgáltatás hozzáadva!");
            }

            localStorage.setItem('app_services', JSON.stringify(appServices));

            // Frissítsük a UI-t reload nélkül
            updateDashboard();
            renderServices();
            addServiceForm.reset();
            editingServiceId = null;
            const submitBtn = addServiceForm.querySelector('button[type="submit"]');
            submitBtn.textContent = "+";
            submitBtn.classList.remove('pulse-animation');
        }
    });
}

// --- Announcement Logic (List System v4) ---

function setupAnnouncementLogic() {
    const form = document.getElementById('announcement-form');
    if (form) {
        form.onsubmit = function (e) {
            e.preventDefault();
            const input = document.getElementById('announcement-text');
            const text = input ? input.value.trim() : '';

            if (text) {
                // Add new announcement
                const newMsg = {
                    id: 'msg_' + Date.now(),
                    text: text,
                    date: new Date().toLocaleDateString('hu-HU'),
                    isActive: false // Default inactive
                };

                appAnnouncements.push(newMsg);
                saveAnnouncements();

                input.value = ''; // clear
                renderAnnouncements();
            } else {
                alert("Írj be szöveget!");
            }
        };
    }
}

function saveAnnouncements() {
    Core.saveData('app_announcements_v4', appAnnouncements);

    // Frissítsük a UI-t reload nélkül
    updateDashboard();
    renderAnnouncements();
}

function renderAnnouncements() {
    const tbody = document.querySelector('#announcement-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Sort: Active first, then Newest first
    appAnnouncements.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return b.id.localeCompare(a.id);
    });

    if (appAnnouncements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; opacity:0.6;">Nincs mentett üzenet.</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    appAnnouncements.forEach(msg => {
        const row = document.createElement('tr');
        if (msg.isActive) row.style.background = 'rgba(0, 120, 215, 0.1)';

        row.innerHTML = `
            <td>${msg.date}</td>
            <td>${msg.text}</td>
            <td style="text-align:center;">
                ${msg.isActive
                ? '<span style="color:#00cc66; font-weight:bold;">AKTÍV</span>'
                : '<span style="opacity:0.5;">Inaktív</span>'}
            </td>
            <td style="text-align:right;">
                ${!msg.isActive
                ? `<button class="btn-text" onclick="toggleAnnouncement('${msg.id}')" title="Aktiválás">Aktiválás</button>`
                : `<button class="btn-text" onclick="disableAnnouncements()" title="Kikapcsolás" style="color:#ffcc00;">Kikapcsolás</button>`
            }
                <button class="btn-delete-small" onclick="deleteAnnouncement('${msg.id}')" title="Törlés">
                     <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        `;
        fragment.appendChild(row);
    });
    tbody.appendChild(fragment);
}

window.toggleAnnouncement = function (id) {
    appAnnouncements.forEach(msg => {
        msg.isActive = (msg.id === id);
    });
    saveAnnouncements();
    renderAnnouncements();
}

window.disableAnnouncements = function () {
    appAnnouncements.forEach(msg => {
        msg.isActive = false;
    });
    saveAnnouncements();
    renderAnnouncements();
}

window.deleteAnnouncement = function (id) {
    if (confirm("Biztosan törlöd ezt az üzenetet?")) {
        appAnnouncements = appAnnouncements.filter(m => m.id !== id);
        saveAnnouncements();
        renderAnnouncements();
    }
}

function updateAnnouncementTile() {
    try {
        // NEW LOGIC: Use V4 List System
        const raw = localStorage.getItem('app_announcements_v4');
        const list = raw ? JSON.parse(raw) : [];

        // Find ACTIVE announcement
        const activeMsg = list.find(msg => msg.isActive);

        const el = document.getElementById('stat-announcement');
        // Input population is no longer needed/relevant for the tile update itself 
        // as the modal now shows a list and "Create New" form.

        if (activeMsg) {
            // Active Announcement Found
            if (el) {
                // Truncate if too long (e.g. 25 chars)
                const textCheck = activeMsg.text.length > 25 ? activeMsg.text.substring(0, 25) + '...' : activeMsg.text;
                el.textContent = `"${textCheck}"`;
                el.style.opacity = '1';
                el.style.color = '#4cc9f0';
                el.style.fontWeight = 'bold';
            }
        } else {
            // No Active Announcement
            if (el) {
                el.textContent = "Nincs aktív üzenet";
                el.style.opacity = "0.5";
                el.style.color = "inherit";
                el.style.fontWeight = "normal";
            }
        }
    } catch (e) { console.error("Update Tile error", e); }
}


function renderUsers() {
    // loadData(); // OPTIMIZED: Removed redundant load
    const tbody = document.querySelector('#users-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (appUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nincs regisztrált felhasználó.</td></tr>';
        return;
    }

    const rows = appUsers.map(user => {
        const userCars = allCarsData.filter(c => c.ownerId === user.id);
        const points = user.points || 0;
        const active = user.activePoints || 0;
        const level = user.level || 'Bronze';

        let levelColor = '#cd7f32'; // Bronze
        if (level === 'Silver') levelColor = '#c0c0c0';
        if (level === 'Gold') levelColor = '#ffd700';
        if (level === 'Diamond') levelColor = '#b9f2ff';

        const hasSub = user.subscription && user.subscription.active;
        const subBadge = hasSub ? '<span title="Weekly Shine Előfizető" style="cursor:help;">👑</span>' : '';

        return `
            <tr>
                <td>
                    <div style="font-weight:bold;">${user.name} ${subBadge}</div>
                    <div style="font-size:0.8em;opacity:0.7;">Reg: ${user.joined || '-'}</div>
                </td>
                <td>
                    <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: ${levelColor}22; color: ${levelColor}; border: 1px solid ${levelColor}44; font-weight:bold;">
                        ${level}
                    </span>
                </td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button onclick="adjustPoints('${user.id}', -1)" style="padding: 2px 6px; background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:white; border-radius:4px; cursor:pointer;">-</button>
                        <strong style="color: #4cc9f0; min-width: 20px; text-align:center;">${points}</strong>
                        <button onclick="adjustPoints('${user.id}', 1)" style="padding: 2px 6px; background: rgba(76, 201, 240, 0.2); border:1px solid #4cc9f0; color:white; border-radius:4px; cursor:pointer;">+</button>
                        <span style="font-size:0.8em; opacity:0.6;">pt</span>
                    </div>
                </td>
                <td>${userCars.length} db</td>
                <td>
                    <button class="btn-delete-small" onclick="deleteUser('${user.id}')" title="Felhasználó törlése">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                    <button class="btn-edit-small" onclick="openUserEdit('${user.id}')" title="Szerkesztés / VIP" style="padding: 2px 6px; background: rgba(255, 193, 7, 0.2); border: 1px solid #ffc107; color: #ffc107; border-radius: 4px; cursor: pointer; margin-left: 5px;">
                        ✏️
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rows.join('');
}

// Kaszkádolt törlési logika (Intelligensebb és biztonságosabb)
window.deleteUser = function (userId) {
    const user = appUsers.find(u => u.id === userId);
    if (!user) return;

    // 1. Gather Impact Data
    const userCars = allCarsData.filter(c => c.ownerId === userId);
    const userBookings = appBookings.filter(b => b.userId === userId);
    const activeBookings = userBookings.filter(b => ['active', 'on_way', 'arrived', 'started'].includes(b.status));

    // Check VIP status
    const vipRequests = JSON.parse(localStorage.getItem('vip_requests')) || [];
    const hasVipRequest = vipRequests.some(r => r.userId === userId);
    const isVip = user.subscription && user.subscription.active;

    // 2. Build Confirmation Message
    let msg = `BIZTOSAN törlöd ${user.name} felhasználót?\n\nKapcsolódó adatok törlése:\n`;
    msg += `🚗 Autók: ${userCars.length} db\n`;
    msg += `📅 Összes foglalás: ${userBookings.length} db`;

    if (activeBookings.length > 0) {
        msg += `\n⚠️ Ebből AKTÍV foglalás: ${activeBookings.length} db! (Ezek azonnal törlődnek!)`;
    }

    if (isVip) {
        msg += `\n👑 A felhasználó AKTÍV VIP tag! (Előfizetés törlődik)`;
    } else if (hasVipRequest) {
        msg += `\n📝 Folyamatban lévő VIP igénylése van.`;
    }

    msg += `\n\nA művelet NEM vonható vissza! Folytatod?`;

    // 3. Confirm & Execute
    if (confirm(msg)) {
        // --- DELETE USER ---
        appUsers = appUsers.filter(u => u.id !== userId);

        // --- DELETE CARS ---
        // Global list
        allCarsData = allCarsData.filter(c => c.ownerId !== userId);
        // User specific storage key
        localStorage.removeItem(`cars_${userId}`);

        // --- DELETE BOOKINGS ---
        appBookings = appBookings.filter(b => b.userId !== userId);

        // --- DELETE VIP REQUESTS ---
        const newVipRequests = vipRequests.filter(r => r.userId !== userId);
        localStorage.setItem('vip_requests', JSON.stringify(newVipRequests));

        // --- SAVE CHANGES ---
        localStorage.setItem('app_users', JSON.stringify(appUsers));
        localStorage.setItem('all_cars', JSON.stringify(allCarsData));
        localStorage.setItem('app_bookings', JSON.stringify(appBookings));

        alert(`Felhasználó (${user.name}) és minden adata sikeresen eltávolítva.`);

        // Refresh UI
        updateDashboard();
        renderUsers();
        renderCars();
        renderSchedule();
        try { renderVIPRequests(); } catch (e) { }
    }
}

// Shine pontok kezelése
window.adjustPoints = function (userId, delta) {
    // loadData(); // OPTIMIZED
    const user = appUsers.find(u => u.id === userId);
    if (user) {
        const oldLevel = user.level || 'Bronze';
        user.points = Math.max(0, (user.points || 0) + delta);
        user.activePoints = Math.max(0, (user.activePoints || 0) + delta);

        // Recalculate Level
        if (user.points >= 50) user.level = 'Diamond';
        else if (user.points >= 20) user.level = 'Gold';
        else if (user.points >= 10) user.level = 'Silver';
        else user.level = 'Bronze';

        localStorage.setItem('app_users', JSON.stringify(appUsers));

        if (oldLevel !== user.level) {
            alert(`Szuper! ${user.name} szintet lépett: ${user.level}! 🎉`);
        }

        renderUsers();
        updateDashboard();
    }
}

function renderCars() {
    const tbody = document.querySelector('#cars-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (allCarsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nincs hozzáadott autó.</td></tr>';
        return;
    }

    const rows = allCarsData.map(car => `
            <tr>
                <td><span class="admin-plate">${car.plate || 'NO-PLATE'}</span></td>
                <td>${car.brand} ${car.model}</td>
                <td>${car.ownerName}</td>
                <td>-</td>
                <td style="text-align:right;">
                    <button class="btn-edit-small" onclick="openCarEdit('${car.id}')" title="Szerkesztés" style="padding: 2px 6px; background: rgba(76, 201, 240, 0.2); border: 1px solid #4cc9f0; color: #4cc9f0; border-radius: 4px; cursor: pointer;">
                        ✏️
                    </button>
                    <button class="btn-delete-small" onclick="deleteCar('${car.id}')" title="Törlés">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr>
    `);
    tbody.innerHTML = rows.join('');
}

window.deleteCar = function (carId) {
    const car = allCarsData.find(c => c.id === carId);
    if (!car) return;

    if (confirm(`Biztosan törlöd ezt az autót? (${car.plate || car.brand + ' ' + car.model})`)) {
        // 1. Remove from global list
        allCarsData = allCarsData.filter(c => c.id !== carId);
        localStorage.setItem('all_cars', JSON.stringify(allCarsData));

        // 2. Remove from owner's list
        const ownerCarsKey = `cars_${car.ownerId}`;
        let ownerCars = JSON.parse(localStorage.getItem(ownerCarsKey)) || [];
        ownerCars = ownerCars.filter(c => c.id !== carId);
        localStorage.setItem(ownerCarsKey, JSON.stringify(ownerCars));

        alert("Autó törölve.");
        renderCars();
        updateDashboard();
    }
}

window.openCarEdit = function (carId) {
    const car = allCarsData.find(c => c.id === carId);
    if (!car) return;

    document.getElementById('edit-car-id').value = car.id;
    document.getElementById('edit-car-plate').value = car.plate || '';
    document.getElementById('edit-car-brand').value = car.brand || '';
    document.getElementById('edit-car-model').value = car.model || '';

    openModal('car-edit-modal');
}

window.saveCarEdit = function () {
    const carId = document.getElementById('edit-car-id').value;
    const newPlate = document.getElementById('edit-car-plate').value.trim();
    const newBrand = document.getElementById('edit-car-brand').value.trim();
    const newModel = document.getElementById('edit-car-model').value.trim();

    const carIndex = allCarsData.findIndex(c => c.id === carId);
    if (carIndex === -1) return;

    const car = allCarsData[carIndex];

    // Update global list
    allCarsData[carIndex] = {
        ...car,
        plate: newPlate,
        brand: newBrand,
        model: newModel
    };
    localStorage.setItem('all_cars', JSON.stringify(allCarsData));

    // Update owner's list
    const ownerCarsKey = `cars_${car.ownerId}`;
    let ownerCars = JSON.parse(localStorage.getItem(ownerCarsKey)) || [];
    const ownerCarIndex = ownerCars.findIndex(c => c.id === carId);
    if (ownerCarIndex !== -1) {
        ownerCars[ownerCarIndex] = {
            ...ownerCars[ownerCarIndex],
            plate: newPlate,
            brand: newBrand,
            model: newModel
        };
        localStorage.setItem(ownerCarsKey, JSON.stringify(ownerCars));
    }

    alert("Autó adatai frissítve.");
    closeModal('car-edit-modal');
    renderCars();
}

// --- Schedule Management (v5 Refactor) ---
let currentScheduleTab = 'active';

window.switchScheduleTab = function (tab) {
    currentScheduleTab = tab;
    sessionStorage.setItem('admin_schedule_tab', tab); // Mentsük el a fület

    // Update button states
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[onclick*="${tab}"]`);
    if (btn) btn.classList.add('active');

    renderSchedule();
}

function renderSchedule() {
    // loadData(); // OPTIMIZED
    const container = document.getElementById('active-jobs-view');
    if (!container) return;
    container.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Dates for Active Tab
    const d0 = Core.getISODate(today);
    const tom = new Date(today); tom.setDate(today.getDate() + 1);
    const d1 = Core.getISODate(tom);
    const next = new Date(today); next.setDate(today.getDate() + 2);
    const d2 = Core.getISODate(next);

    const fragment = document.createDocumentFragment();

    if (currentScheduleTab === 'active') {
        // AI Update: Filter out Gifts from regular schedule until processed
        // BUT include them if giftAccepted is true
        const activeBookings = appBookings.filter(b =>
            ['active', 'on_way', 'arrived', 'started'].includes(b.status) &&
            (!b.isGift || b.giftAccepted)
        );

        const sections = [
            { filter: (b) => b.date < d0, label: 'Múltbeli (Elmaradt)', class: 'status-cancelled' },
            { filter: (b) => b.date === d0, label: 'Ma', class: '' },
            { filter: (b) => b.date === d1, label: 'Holnap', class: 'tomorrow' },
            { filter: (b) => b.date === d2, label: 'Holnapután', class: 'future' },
            { filter: (b) => b.date > d2, label: 'Későbbi foglalások', class: 'future' }
        ];

        sections.forEach(section => {
            const sectionBookings = activeBookings.filter(section.filter).sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                return a.time.localeCompare(b.time);
            });

            if (sectionBookings.length > 0 || (section.label !== 'Múltbeli (Elmaradt)' && section.label !== 'Későbbi foglalások')) {
                const sep = document.createElement('div');
                sep.className = `date-separator ${section.class}`;
                sep.innerHTML = `${section.label}`;
                fragment.appendChild(sep);

                if (sectionBookings.length === 0) {
                    const empty = document.createElement('p');
                    empty.style.padding = '10px 15px';
                    empty.style.opacity = '0.5';
                    empty.innerText = 'Nincs rögzített kérés.';
                    fragment.appendChild(empty);
                } else {
                    sectionBookings.forEach(item => {
                        fragment.appendChild(createScheduleItem(item));
                    });
                }
            }
        });

    } else {
        const statusFilter = currentScheduleTab; // 'completed' or 'cancelled'
        const list = appBookings.filter(b => b.status === statusFilter).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

        if (list.length === 0) {
            container.innerHTML = `<p style="padding:20px; text-align:center; opacity:0.6;">Nincs megjeleníthető elem ezen a fülön.</p>`;
            return;
        } else {
            // Group by Date for non-active tabs too
            let lastDate = null;
            list.forEach(item => {
                if (item.date !== lastDate) {
                    const sep = document.createElement('div');
                    sep.className = 'date-separator';
                    sep.style.background = 'rgba(255,255,255,0.05)';
                    sep.innerHTML = item.date;
                    fragment.appendChild(sep);
                    lastDate = item.date;
                }
                fragment.appendChild(createScheduleItem(item));
            });
        }
    }
    container.appendChild(fragment);
}

function createScheduleItem(item) {
    const div = document.createElement('div');
    div.className = 'schedule-item';

    let statusText = '';
    let statusClass = '';
    let controls = '';

    switch (item.status) {
        case 'active': statusText = 'Várakozó'; statusClass = 'status-pending';
            controls = `<button class="btn-complete" style="background:#0078d7;" onclick="updateBookingStatus('${item.id}', 'on_way')">ELINDULTAM 🚗</button>`;
            break;
        case 'on_way': statusText = 'Úton'; statusClass = 'status-pending';
            controls = `<button class="btn-complete" style="background:#ffc107; color:black;" onclick="updateBookingStatus('${item.id}', 'arrived')">MEGÉRKEZTEM 📍</button>`;
            break;
        case 'arrived': statusText = 'Helyszínen'; statusClass = 'status-pending';
            controls = `<button class="btn-complete" style="background:#107c10;" onclick="updateBookingStatus('${item.id}', 'started')">KEZDEM 🧼</button>`;
            break;
        case 'started': statusText = 'Folyamatban'; statusClass = 'status-active';
            controls = `<button class="btn-complete" style="background:#159d15; font-weight:bold;" onclick="updateBookingStatus('${item.id}', 'completed')">KÉSZ VAGYOK ✅</button>`;
            break;
        case 'completed': statusText = 'Kész'; statusClass = 'status-completed'; break;
        case 'cancelled': statusText = 'Törölve'; statusClass = 'status-cancelled';
            controls = `<button class="btn-text" style="font-size:0.7em;" onclick="updateBookingStatus('${item.id}', 'active')">Visszaállítás</button>`;
            break;
    }

    div.innerHTML = `
        <div class="schedule-time" style="min-width: 100px;">
            <div style="font-weight:bold; font-size:1.1rem;">${item.time}</div>
            <div style="font-size:0.75rem; opacity:0.6;">${item.date}</div>
        </div>
        <div class="schedule-details" style="flex:1;">
            <div style="font-weight:bold; font-size:1.1rem;">${item.userName}</div>
            <div style="opacity:0.8; font-size:0.9rem;">${item.carDetails || item.carPlate}</div>
            <div style="color:#4cc9f0; font-size:0.85rem; margin-top:2px;">${item.service}</div>
            ${item.address ? `<div style="font-size:0.85rem; color:#aaa; margin-top:4px;">📍 ${item.address.city}, ${item.address.street} ${item.address.houseNum}</div>` : ''}
            
            <!-- Arrival Info - NEW -->
            ${['active', 'on_way', 'arrived', 'started'].includes(item.status) ?
            `<div style="font-size:0.85rem; color:#ffc107; margin-top:8px; font-weight:600;">ℹ️ Eddigre kell odaérnem: ${item.time}</div>` : ''}
            
            <!-- Notes Section - NEW -->
            <div id="note-${item.id}" style="font-size:0.85rem; color:#fff; font-style:italic; margin-top:8px; display:${item.note ? 'block' : 'none'}; border-left: 2px solid #ccc; padding-left:8px;">
                ${item.note || ''}
            </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; min-width: 150px;">
            <div style="display:flex; gap:5px; align-items:center;">
                <button class="btn-text" onclick="editBookingNote('${item.id}')" title="Megjegyzés fűzése" style="font-size:1.2rem; padding:0 5px;">+</button>
                ${item.rewardUsed ? '<span class="status-badge" style="background:#ffd700; color:black; font-size:0.6rem;">PONTOK ⭐</span>' : ''}
                ${item.isGift ? '<span class="status-badge" style="background:#ff0055; color:white; font-size:0.6rem;">GIFT 🎁</span>' : ''}
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            ${controls}
        </div>
    `;
    return div;
}

window.updateBookingStatus = function (bookingId, newStatus) {
    console.log(`Updating booking ${bookingId} to ${newStatus}`);
    const booking = appBookings.find(b => b.id === bookingId);
    if (booking) {
        const oldStatus = booking.status;
        booking.status = newStatus;

        // Save using Core helper
        Core.saveData('app_bookings', appBookings);

        if (newStatus === 'completed' && oldStatus !== 'completed') {
            // Award Shine Point to User
            const userIndex = appUsers.findIndex(u => u.id === booking.userId);
            if (userIndex > -1) {
                const user = appUsers[userIndex];
                user.points = (user.points || 0) + 1;
                user.activePoints = (user.activePoints || 0) + 1;

                // Determine level based on total points
                if (user.points >= 50) user.level = 'Diamond';
                else if (user.points >= 20) user.level = 'Gold';
                else if (user.points >= 10) user.level = 'Silver';
                else user.level = 'Bronze';

                Core.saveData('app_users', appUsers);
            }
            alert("Munka sikeresen befejezve! ✅ +1 Shine Pont jóváírva!");
        }

        // Safe UI Update
        try {
            renderSchedule(); // Critical: Update list first!
            updateDashboard();
            renderGifts();
            if (typeof renderUsers === 'function') renderUsers();
        } catch (e) {
            console.error("UI Update failed inside updateBookingStatus:", e);
        }
    } else {
        console.error("Booking not found:", bookingId);
    }
}

// --- Gifting Admin Management ---

function renderGifts() {
    const tbody = document.querySelector('#gifts-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // AI Update: Only show UNPROCESSED gifts in this list
    const gifts = appBookings.filter(b => b.isGift === true && !b.giftAccepted);

    const countEl = document.getElementById('incoming-gifts-count');
    if (countEl) countEl.innerText = `${gifts.length} feldolgozatlan`;

    if (gifts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.6;">Nincs bejövő ajándék kérés.</td></tr>';
        return;
    }

    const rows = gifts.map(gift => `
            <tr>
                <td>${gift.userName}</td>
                <td><strong>${gift.recipientName}</strong></td>
                <td>${gift.date} ${gift.time}</td>
                <td style="font-size: 0.85rem;">
                    <div>🚗 ${gift.carDetails}</div>
                    <div style="opacity:0.7;">📍 ${gift.addressString}</div>
                    ${gift.message ? `<div style="font-style:italic; color:#4cc9f0; margin-top:4px;">💬 "${gift.message}"</div>` : ''}
                </td>
                <td>
                    <div style="display:flex; gap:5px;">
                        <button class="btn-success" onclick="openGiftProcess('${gift.id}')" style="padding: 5px 10px; font-size: 0.8rem;">Elfogadás</button>
                        <button class="btn-danger" onclick="deleteGift('${gift.id}')" style="padding: 5px 10px; font-size: 0.8rem; background:#ff4d4d; border:none; color:white; border-radius:4px; cursor:pointer;">Törlés</button>
                    </div>
                </td>
            </tr>
    `);
    tbody.innerHTML = rows.join('');
}

function deleteGift(id) {
    if (confirm("Biztosan törölni szeretnéd ezt az ajándék kérést?")) {
        appBookings = appBookings.filter(b => b.id !== id);
        localStorage.setItem('app_bookings', JSON.stringify(appBookings));
        alert("Ajándék kérése törölve.");
        renderGifts();
        updateDashboard();
    }
}

window.openGiftProcess = function (id) {
    const gift = appBookings.find(b => b.id === id);
    if (!gift) return;

    document.getElementById('process-gift-id').value = id;
    document.getElementById('gift-process-info').innerText = `${gift.userName} meglepetése: ${gift.recipientName} részére.`;
    document.getElementById('process-brand-model').value = gift.carDetails;

    openModal('gift-process-modal');
}

// Setup Gift Process Form
document.addEventListener('DOMContentLoaded', () => {
    const processForm = document.getElementById('gift-process-form');
    if (processForm) {
        processForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('process-gift-id').value;
            const plate = document.getElementById('process-plate').value;
            const brandModel = document.getElementById('process-brand-model').value;

            confirmGiftActivation(id, plate, brandModel);
        });
    }
});

function confirmGiftActivation(id, plate, brandModel) {
    const booking = appBookings.find(b => b.id === id);
    if (booking) {
        // AI Update: Keep isGift flag but set giftAccepted
        booking.giftAccepted = true;
        booking.carPlate = plate;
        booking.carDetails = brandModel; // Update with confirmed details

        // Add coordinates/address object if needed for the map/tracker (mocking simple string to object conversion if needed, but the current UI uses .address object for regular bookings)
        // Since gifts use addressString, let's keep it simple or convert it.
        if (!booking.address) {
            booking.address = {
                city: 'Gift Location',
                street: booking.addressString,
                houseNum: ''
            };
        }

        localStorage.setItem('app_bookings', JSON.stringify(appBookings));

        alert("Ajándék sikeresen aktiválva a naptárba! 🚀");
        closeModal('gift-process-modal');
        closeModal('gifts-modal');

        updateDashboard();
        renderSchedule();
        renderGifts();
    }
}

window.editBookingNote = function (bookingId) {
    const booking = appBookings.find(b => b.id === bookingId);
    if (booking) {
        const currentNote = booking.note || "";
        const newNote = prompt("Megjegyzés hozzáfűzése a foglaláshoz:", currentNote);

        if (newNote !== null) {
            booking.note = newNote.trim();
            localStorage.setItem('app_bookings', JSON.stringify(appBookings));

            // Frissítsük a UI-t reload nélkül
            updateDashboard();
            renderSchedule();
        }
    }
}


// --- Settings Logic ---
const pufferSlider = document.getElementById('puffer-slider');
const pufferDisplay = document.getElementById('puffer-display');
const leadSlider = document.getElementById('lead-slider');
const leadDisplay = document.getElementById('lead-display');
const settingsForm = document.getElementById('settings-form');

// Initialize Hour Selects
function initHourSelects() {
    const startSel = document.getElementById('opening-start');
    const endSel = document.getElementById('opening-end');
    if (!startSel || !endSel) return;

    startSel.innerHTML = '';
    endSel.innerHTML = '';

    for (let i = 0; i < 24; i++) {
        const timeStr = `${i.toString().padStart(2, '0')}:00`;
        startSel.innerHTML += `<option value="${i}">${timeStr}</option>`;
        endSel.innerHTML += `<option value="${i}">${timeStr}</option>`;
    }
}

// Load Settings
function loadSettings() {
    initHourSelects();

    const savedPuffer = localStorage.getItem('settings_pufferMin') || 15;
    const savedLead = localStorage.getItem('settings_leadTimeMin') || 60;

    // Opening Hours Defaults
    const savedStart = localStorage.getItem('settings_openingStart') || 8;
    const savedEnd = localStorage.getItem('settings_openingEnd') || 17;
    const savedDaysRaw = localStorage.getItem('settings_openDays');
    const savedDays = savedDaysRaw ? JSON.parse(savedDaysRaw) : [1, 2, 3, 4, 5]; // Default Mon-Fri

    if (pufferSlider) {
        pufferSlider.value = savedPuffer;
        pufferDisplay.textContent = `${savedPuffer} p`;
    }
    if (leadSlider) {
        leadSlider.value = savedLead;
        leadDisplay.textContent = `${savedLead} p`;
    }

    // Set Opening Hours UI
    const startSel = document.getElementById('opening-start');
    const endSel = document.getElementById('opening-end');
    if (startSel) startSel.value = savedStart;
    if (endSel) endSel.value = savedEnd;

    // Set Days Checkboxes
    const dayCBs = document.querySelectorAll('input[name="open-day"]');
    dayCBs.forEach(cb => {
        cb.checked = savedDays.includes(parseInt(cb.value));
    });
}

// Save Settings
if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();

        // existing
        if (pufferSlider) localStorage.setItem('settings_pufferMin', pufferSlider.value);
        if (leadSlider) localStorage.setItem('settings_leadTimeMin', leadSlider.value);

        // New Opening Hours
        const startSel = document.getElementById('opening-start');
        const endSel = document.getElementById('opening-end');
        if (startSel) localStorage.setItem('settings_openingStart', startSel.value);
        if (endSel) localStorage.setItem('settings_openingEnd', endSel.value);

        // New Open Days
        const selectedDays = [];
        document.querySelectorAll('input[name="open-day"]:checked').forEach(cb => {
            selectedDays.push(parseInt(cb.value));
        });
        localStorage.setItem('settings_openDays', JSON.stringify(selectedDays));

        alert("Beállítások mentve! ✅");
        closeModal('settings-modal');
    });
}

if (pufferSlider) {
    pufferSlider.addEventListener('input', (e) => {
        pufferDisplay.textContent = `${e.target.value} p`;
    });
}
if (leadSlider) {
    leadSlider.addEventListener('input', (e) => {
        leadDisplay.textContent = `${e.target.value} p`;
    });
}

if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newPuffer = pufferSlider.value;
        const newLead = leadSlider.value;

        localStorage.setItem('settings_pufferMin', newPuffer);
        localStorage.setItem('settings_leadTimeMin', newLead);

        alert(`Beállítások mentve!\n\nReagálási idő: ${newLead} perc\nPuffer idő: ${newPuffer} perc`);

        // Frissítsük az oldalt, a sessionStorage megtartja a helyünket
        updateDashboard();
    });
}


// --- Finance Module Logic ---

let currentFinanceFilter = 'month';

function filterFinance(range, btnElement) {
    currentFinanceFilter = range;

    // Update active button state
    document.querySelectorAll('.finance-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    renderFinance(range);
}

// Safe Date Parser
function parseDateSafe(dateStr) {
    try {
        if (!dateStr) return new Date();
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return new Date(); // Fallback to now if invalid
        return d;
    } catch (e) {
        return new Date();
    }
}

let financeTimeout = null;

function renderFinance(range) {
    // Debounce: Clear pending render task
    if (financeTimeout) clearTimeout(financeTimeout);

    // UI Feedback immediately
    const chartContainer = document.querySelector('.chart-container');
    if (chartContainer) chartContainer.innerHTML = '<div style="margin:auto; opacity:0.5;">Számítás...</div>';

    financeTimeout = setTimeout(() => {
        try {
            const tbody = document.querySelector('#finance-table tbody');
            const chartContainer = document.querySelector('.chart-container');

            // Guard clause for missing DOM
            if (!tbody || !chartContainer) return;

            tbody.innerHTML = '';
            chartContainer.innerHTML = '';

            // 1. Prepare and Filter Bookings
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth();

            const sourceData = Array.isArray(appBookings) ? appBookings : [];

            // Pre-calculate parsed dates for efficiency
            const preparedData = sourceData
                .filter(b => b && b.status !== 'cancelled')
                .map(b => ({
                    ...b,
                    _parsedDate: parseDateSafe(b.date),
                    _ts: parseDateSafe(b.date).getTime()
                }));

            const filteredBookings = preparedData.filter(b => {
                const bDate = b._parsedDate;
                if (range === 'month') {
                    return bDate.getFullYear() === currentYear && bDate.getMonth() === currentMonth;
                } else if (range === 'year') {
                    return bDate.getFullYear() === currentYear;
                } else if (range === 'custom') {
                    const selector = document.getElementById('finance-month-selector');
                    if (selector) {
                        const [selYear, selMonth] = selector.value.split('-').map(Number);
                        return bDate.getFullYear() === selYear && bDate.getMonth() === selMonth;
                    }
                }
                return true; // All time
            }).sort((a, b) => b._ts - a._ts);

            // 2. Calculate Stats
            let totalRev = 0;
            let totalCost = 0;

            const getBookingCost = (b) => {
                if (b.cost !== undefined) return parseInt(b.cost) || 0;
                if (!b.service) return 0;
                const srv = (appServices || []).find(s => s.name === b.service);
                return srv ? (parseInt(srv.cost) || 0) : 0;
            };

            const serviceBreakdown = {};

            filteredBookings.forEach(b => {
                const rev = (parseInt(b.price) || 0);
                const cost = getBookingCost(b);
                totalRev += rev;
                totalCost += cost;

                // Breakdown logic
                if (!serviceBreakdown[b.service]) serviceBreakdown[b.service] = { rev: 0, count: 0 };
                serviceBreakdown[b.service].rev += rev;
                serviceBreakdown[b.service].count++;
            });

            const totalProfit = totalRev - totalCost;
            const margin = totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : 0;

            // 3. Update KPI Cards
            const elRev = document.getElementById('fin-revenue');
            if (elRev) elRev.innerText = `${totalRev.toLocaleString()} Ft`;

            const elExp = document.getElementById('fin-expense');
            if (elExp) elExp.innerText = `${totalCost.toLocaleString()} Ft`;

            const elProf = document.getElementById('fin-profit');
            if (elProf) elProf.innerText = `${totalProfit.toLocaleString()} Ft`;

            const elMarg = document.getElementById('fin-margin');
            if (elMarg) elMarg.innerText = `${margin}%`;

            // 4. Render Table
            if (filteredBookings.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nincs adat a választott időszakban.</td></tr>';
                chartContainer.innerHTML = '<div style="margin:auto; opacity:0.5;">Nincs adat.</div>';
                return;
            }

            // Limit table rows for performance (max 100 recent)
            const tableRows = filteredBookings.slice(0, 100).map(b => {
                const cost = getBookingCost(b);
                const profit = (parseInt(b.price) || 0) - cost;
                return `
                    <tr>
                        <td>${b.date}</td>
                        <td>${b.userName}<br><small style="opacity:0.7">${b.carPlate || '-'}</small></td>
                        <td>${b.service}</td>
                        <td style="text-align:right;">${(parseInt(b.price) || 0).toLocaleString()} Ft</td>
                        <td style="text-align:right; color:#ffcccc;">${cost.toLocaleString()} Ft</td>
                        <td style="text-align:right; font-weight:bold; color:${profit >= 0 ? '#ccffcc' : '#ffcccc'}">${profit.toLocaleString()} Ft</td>
                    </tr>
                `;
            });
            tbody.innerHTML = tableRows.join('');

            // 5. Render Chart
            const chartData = {};

            filteredBookings.forEach(b => {
                let key;
                const d = b._parsedDate;

                if (range === 'month') {
                    key = d.getDate();
                } else if (range === 'year') {
                    key = d.toLocaleString('hu-HU', { month: 'short' });
                } else {
                    key = d.getFullYear();
                }

                if (!key) key = '?';
                if (!chartData[key]) chartData[key] = 0;
                chartData[key] += (parseInt(b.price) || 0);
            });

            const keys = Object.keys(chartData);
            // Numeric sort for days, simple sort otherwise
            if (range === 'month') {
                keys.sort((a, b) => parseInt(a) - parseInt(b));
            }

            let maxVal = 1000;
            for (const k of keys) {
                if (chartData[k] > maxVal) maxVal = chartData[k];
            }

            const fragment = document.createDocumentFragment();
            keys.forEach(key => {
                const val = chartData[key];
                const heightPct = (val / maxVal) * 100;

                const bar = document.createElement('div');
                bar.className = 'chart-bar';
                bar.style.height = `${heightPct}%`;
                bar.setAttribute('data-label', key);
                bar.setAttribute('data-value', `${Number(val).toLocaleString()} Ft`);

                fragment.appendChild(bar);
            });
            chartContainer.appendChild(fragment);

            // 6. Render Service Breakdown
            const breakdownEl = document.getElementById('service-breakdown');
            if (breakdownEl) {
                breakdownEl.innerHTML = '';
                const sortedSrv = Object.keys(serviceBreakdown).sort((a, b) => serviceBreakdown[b].rev - serviceBreakdown[a].rev);

                sortedSrv.forEach(srvName => {
                    const data = serviceBreakdown[srvName];
                    const pct = totalRev > 0 ? (data.rev / totalRev * 100).toFixed(0) : 0;

                    const item = document.createElement('div');
                    item.innerHTML = `
                        <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px;">
                            <span>${srvName} <small style="opacity:0.6">(${data.count} db)</small></span>
                            <span>${data.rev.toLocaleString()} Ft</span>
                        </div>
                        <div style="width:100%; height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden;">
                            <div style="width:${pct}%; height:100%; background:#4cc9f0;"></div>
                        </div>
                    `;
                    breakdownEl.appendChild(item);
                });
            }

            // 7. Update Selector (if month items not yet created)
            updateFinanceMonthSelector();

        } catch (e) {
            console.error("Critical Error in renderFinance:", e);
        } finally {
            financeTimeout = null;
        }
    }, 100);
}


// --- Modal Management (Reused logic pattern) ---

function openModal(modalId) {
    const modal = document.getElementById(modalId);

    // Data Loading on Open (Refresh data from LS to ensure sync)
    // We need to re-read LS here because it might have changed in another tab
    if (modalId === 'users-modal') renderUsers();
    if (modalId === 'cars-modal') renderCars();
    if (modalId === 'schedule-modal') renderSchedule();
    if (modalId === 'settings-modal') loadSettings();
    if (modalId === 'finance-modal') renderFinance('month'); // Default view

    if (modalId === 'services-modal') renderServices();
    if (modalId === 'announcement-modal') renderAnnouncements();
    if (modalId === 'gifts-modal') renderGifts();
    if (modalId === 'faq-modal') { /* Static content for now */ }


    modal.classList.add('active');
    modal.style.display = 'flex'; // Ensure display flex is set

    // Mentsük el, hogy melyik modal van nyitva
    sessionStorage.setItem('admin_active_modal', modalId);

    // Lock background scroll
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
        modal.style.opacity = '1';
        modal.querySelector('.modal-content').style.transform = 'scale(1)';
    }, 10);
}

function updateFinanceMonthSelector() {
    const selector = document.getElementById('finance-month-selector');
    if (!selector || selector.children.length > 0) return;

    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            val: `${d.getFullYear()}-${d.getMonth()}`,
            label: d.toLocaleString('hu-HU', { year: 'numeric', month: 'long' })
        });
    }

    selector.innerHTML = months.map(m => `<option value="${m.val}">${m.label}</option>`).join('');
}

function exportFinanceToCSV() {
    if (!appBookings || appBookings.length === 0) {
        alert("Nincs exportálható adat.");
        return;
    }

    const headers = ["Dátum", "Ügyfél", "Rendszám", "Szolgáltatás", "Bevétel", "Kiadás", "Haszon", "Státusz"];
    const rows = appBookings.filter(b => b.status !== 'cancelled').map(b => {
        const rev = (parseInt(b.price) || 0);
        const srv = appServices.find(s => s.name === b.service);
        const cost = srv ? (parseInt(srv.cost) || 0) : 0;
        return [
            b.date,
            b.userName,
            b.carPlate,
            b.service,
            rev,
            cost,
            rev - cost,
            b.status
        ].join(';');
    });

    const csvContent = "\uFEFF" + headers.join(';') + "\n" + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `penzugyi_riport_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function closeModal(modalId) {
    // Töröljük a mentett modalt
    sessionStorage.removeItem('admin_active_modal');

    const modal = document.getElementById(modalId);
    modal.style.opacity = '0';
    modal.querySelector('.modal-content').style.transform = 'scale(0.9)';

    // Restore background scroll
    document.body.style.overflow = '';

    setTimeout(() => {
        modal.classList.remove('active');
        // modal.style.display = 'none'; // Keep it simple like existing app.js
    }, 300);
}

// Close on outside click
window.onclick = function (event) {
    if (event.target.classList.contains('modal')) {
        closeModal(event.target.id);
    }
}
// --- VIP Request Management ---

function renderVIPRequests() {
    const tbody = document.querySelector('#vip-requests-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const pending = appVipRequests.filter(r => r.status === 'pending');

    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; opacity:0.5;">Nincs függőben lévő igénylés.</td></tr>';
        return;
    }

    const rows = pending.map(req => {
        const date = new Date(req.date).toLocaleDateString('hu-HU');
        return `
            <tr>
                <td><strong>${req.userName}</strong><br><small style="opacity:0.6;">${req.userId}</small></td>
                <td>${date}</td>
                <td style="text-align:right;">
                    <button class="btn-success" style="padding:5px 10px; margin-right:5px;" onclick="approveVIP('${req.id}')">KÉSZ ✅</button>
                    <button class="btn-danger" style="padding:5px 10px;" onclick="rejectVIP('${req.id}')">MÉGSE ❌</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rows.join('');
}

window.approveVIP = function (reqId) {
    const reqIndex = appVipRequests.findIndex(r => r.id === reqId);
    if (reqIndex === -1) return;

    const req = appVipRequests[reqIndex];
    const userIndex = appUsers.findIndex(u => u.id === req.userId);

    if (userIndex > -1) {
        // Upgrade User
        appUsers[userIndex].subscription = {
            active: true,
            type: 'weekly_shine',
            startDate: new Date().toISOString(),
            lastWashDate: null
        };
        appUsers[userIndex].level = 'Diamond'; // VIP Level

        // Update Request Status
        appVipRequests[reqIndex].status = 'approved';

        Core.saveData('app_users', appUsers);
        Core.saveData('vip_requests', appVipRequests);

        alert(`Sikeresen jóváhagyva: ${req.userName} mostantól Weekly Shine tag! 👑`);
        updateDashboard();
    }
}

window.rejectVIP = function (reqId) {
    if (confirm("Biztosan elutasítod ezt az igénylést?")) {
        appVipRequests = appVipRequests.filter(r => r.id !== reqId);
        Core.saveData('vip_requests', appVipRequests);
        updateDashboard();
    }
}
// --- User Edit / VIP Management (New) ---

window.openUserEdit = function (userId) {
    const user = appUsers.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-name').value = user.name;
    document.getElementById('edit-user-points').value = user.points || 0;

    const hasSub = user.subscription && user.subscription.active;
    const vipToggle = document.getElementById('edit-vip-status');
    const dateGroup = document.getElementById('edit-sub-date-group');
    const dateInput = document.getElementById('edit-sub-start-date');

    vipToggle.checked = hasSub;

    // Toggle Date Input
    if (hasSub) {
        dateGroup.style.opacity = '1';
        dateGroup.style.pointerEvents = 'auto';
        // Set date input value (YYYY-MM-DD)
        if (user.subscription.startDate) {
            dateInput.value = user.subscription.startDate.split('T')[0];
        }
    } else {
        dateGroup.style.opacity = '0.5';
        dateGroup.style.pointerEvents = 'none';
        dateInput.value = '';
    }

    // Add Change Listener for Toggle
    vipToggle.onchange = function () {
        if (this.checked) {
            dateGroup.style.opacity = '1';
            dateGroup.style.pointerEvents = 'auto';
            if (!dateInput.value) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }
        } else {
            dateGroup.style.opacity = '0.5';
            dateGroup.style.pointerEvents = 'none';
        }
    };

    openModal('user-edit-modal');
}

window.saveUserEdit = function () {
    const userId = document.getElementById('edit-user-id').value;
    const isVip = document.getElementById('edit-vip-status').checked;
    const startDateVal = document.getElementById('edit-sub-start-date').value;

    // NEW: Get manual edits
    const newName = document.getElementById('edit-user-name').value;
    const newPoints = parseInt(document.getElementById('edit-user-points').value) || 0;

    const userIndex = appUsers.findIndex(u => u.id === userId);
    if (userIndex === -1) return;

    // Apply Name & Points (Sync activePoints too for simplicity)
    appUsers[userIndex].name = newName;
    appUsers[userIndex].points = newPoints;
    appUsers[userIndex].activePoints = newPoints;

    // Recalculate Level based on new points
    if (newPoints >= 50) appUsers[userIndex].level = 'Diamond';
    else if (newPoints >= 20) appUsers[userIndex].level = 'Gold';
    else if (newPoints >= 10) appUsers[userIndex].level = 'Silver';
    else appUsers[userIndex].level = 'Bronze';

    if (isVip) {
        // Activate Subscription
        if (!startDateVal) {
            alert("Kérlek adj meg egy kezdő dátumot!");
            return;
        }

        // Preserve existing sub details if just editing date
        const existingSub = appUsers[userIndex].subscription || {};

        appUsers[userIndex].subscription = {
            active: true,
            type: 'weekly_shine',
            startDate: new Date(startDateVal).toISOString(),
            lastWashDate: existingSub.lastWashDate || null
        };
        appUsers[userIndex].level = 'Diamond'; // Auto-Upgrade
    } else {
        // Deactivate
        if (appUsers[userIndex].subscription) {
            appUsers[userIndex].subscription.active = false;
        }
        // If not VIP anymore, level is determined by points (already calculated above)
        // If they had Diamond FROM VIP but points are low, they drop to Bronze/Silver/Gold above.
    }

    Core.saveData('app_users', appUsers);

    alert("Felhasználó adatok frissítve! 💾");
    closeModal('user-edit-modal');
    updateDashboard(); // Reload table
    renderUsers();
}
