/**
 * Core.js - Közös funkciók és adatkezelés
 */

const Core = {
    // Adatkezelés
    getData(key, defaultValue = []) {
        try {
            return JSON.parse(localStorage.getItem(key)) || defaultValue;
        } catch (e) {
            console.error(`Hiba az adatok beolvasásakor (${key}):`, e);
            return defaultValue;
        }
    },

    saveData(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error(`Hiba az adatok mentésekor (${key}):`, e);
        }
    },

    // Idő és dátum kezelés
    setupLiveClock(elementId) {
        const update = () => {
            const today = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
            const el = document.getElementById(elementId);
            if (el) el.textContent = today.toLocaleDateString('hu-HU', options);
        };
        update();
        setInterval(update, 1000);
    },

    // Heartbeat update
    updateSystemHeartbeat() {
        const now = new Date().toISOString();
        localStorage.setItem('app_system_heartbeat', now);
        console.log("System Heartbeat updated:", now);
        return now;
    },

    // Modal kezelés
    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    },

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    },

    // Téma kezelés
    applySavedTheme() {
        const savedTheme = localStorage.getItem('app_theme') || 'dark-theme';
        document.documentElement.className = savedTheme;

        // Font betöltések (ha szükséges)
        const fonts = {
            'theme-cyberpunk': { id: 'font-cyberpunk', href: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap' },
            'theme-luxury': { id: 'font-luxury', href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap' }
        };

        if (fonts[savedTheme] && !document.getElementById(fonts[savedTheme].id)) {
            const link = document.createElement('link');
            link.id = fonts[savedTheme].id;
            link.rel = 'stylesheet';
            link.href = fonts[savedTheme].href;
            document.head.appendChild(link);
        }
    },

    // Disk Szinkronizáció (Ügynök segítségével)
    syncToDisk() {
        // Ez a függvény jelzi az Ügynöknek, hogy ideje szinkronizálni
        // Mivel a JS nem tud fájlba írni, egy speciális flaget teszünk a localStorage-ba
        // amire az Ügynök figyelhet, vagy manuálisan hívjuk a sync_db.ps1-et.
        const allData = {
            users: this.getData('app_users'),
            bookings: this.getData('app_bookings'),
            services: this.getData('app_services'),
            announcements: this.getData('app_announcements_v4'),
            system: {
                last_sync: new Date().toISOString(),
                version: "1.0.0"
            }
        };
        console.log("Szinkronizáció indítása a lemezre...", allData);
        // Itt az Ügynök (én) fogom lefuttatni a PowerShell scriptet
    },

    // --- Common Formatter Functions ---
    formatDate(dateStr) {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleString('hu-HU', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    },

    formatCurrency(amount) {
        return new Intl.NumberFormat('hu-HU', {
            style: 'currency',
            currency: 'HUF',
            maximumFractionDigits: 0
        }).format(amount);
    },

    getISODate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    // --- UI Helpers ---
    showToast(message, type = 'info') {
        // Placeholder for toast logic if needed centrally
        console.log(`[Toast ${type}]: ${message}`);
    }
};

// Automatikus téma alkalmazás betöltéskor
document.addEventListener('DOMContentLoaded', () => {
    Core.applySavedTheme();
});
