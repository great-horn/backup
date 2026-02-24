/* Common Utilities - Shared across all custom apps */

// ==========================================
// Theme Management (Light / Dark / OLED)
// ==========================================

const THEMES = {
    LIGHT: 'light',
    DARK: 'dark',
    OLED: 'oled',
    NEON: 'neon',
    EMBER: 'ember'
};

const THEME_ORDER = ['light', 'dark', 'oled', 'neon', 'ember'];

const THEME_LABELS = {
    light: 'Mode Azur',
    dark: 'Mode OLED',
    oled: 'Mode Neon',
    neon: 'Mode Ember',
    ember: 'Mode clair'
};

const THEME_ICONS = {
    light: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z', // cloud (next: Azure)
    dark: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', // moon filled (next: Void)
    oled: 'M13 10V3L4 14h7v7l9-11h-7z', // bolt (next: Neon)
    neon: 'M12 2c0 5-6 8-6 13a6 6 0 0012 0c0-5-6-8-6-13z', // flame (next: Ember)
    ember: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' // sun (next: Daylight)
};

/**
 * Get current theme from localStorage
 * @returns {string} Current theme ('light', 'dark', or 'oled')
 */
function getTheme() {
    return localStorage.getItem('theme') || THEMES.LIGHT;
}

/**
 * Set theme and apply to document
 * @param {string} theme - Theme to apply ('light', 'dark', or 'oled')
 */
function setTheme(theme) {
    // Validate theme
    if (!THEME_ORDER.includes(theme)) {
        theme = THEMES.LIGHT;
    }

    // Save to localStorage
    localStorage.setItem('theme', theme);

    // Set data-theme attribute (for CSS variable selectors in themes.css)
    document.documentElement.setAttribute('data-theme', theme);

    // Remove all theme classes
    document.body.classList.remove('dark-mode', 'oled-mode', 'neon-mode', 'ember-mode');
    document.documentElement.classList.remove('dark', 'oled', 'neon', 'ember');

    // Apply new theme (oled, neon, ember are dark-mode variants)
    if (theme === THEMES.OLED) {
        document.body.classList.add('dark-mode', 'oled-mode');
        document.documentElement.classList.add('dark', 'oled');
    } else if (theme === THEMES.NEON) {
        document.body.classList.add('dark-mode', 'neon-mode');
        document.documentElement.classList.add('dark', 'neon');
    } else if (theme === THEMES.EMBER) {
        document.body.classList.add('dark-mode', 'ember-mode');
        document.documentElement.classList.add('dark', 'ember');
    }

    // Update toggle button if exists
    updateThemeToggle(theme);

    // Dispatch event for frameworks (Alpine.js, Vue.js)
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

/**
 * Cycle to next theme (light → dark → oled → light)
 * @returns {string} New theme
 */
function cycleTheme() {
    const current = getTheme();
    const currentIndex = THEME_ORDER.indexOf(current);
    const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
    const nextTheme = THEME_ORDER[nextIndex];
    setTheme(nextTheme);
    return nextTheme;
}

/**
 * Update theme toggle button UI
 * @param {string} theme - Current theme
 */
function updateThemeToggle(theme) {
    const toggle = document.getElementById('themeToggle');
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');

    if (text) {
        text.textContent = THEME_LABELS[theme] || THEME_LABELS.light;
    }

    if (icon) {
        const path = icon.querySelector('path');
        if (path) {
            path.setAttribute('d', THEME_ICONS[theme] || THEME_ICONS.light);
        }
    }
}

/**
 * Initialize theme on page load
 * Call this in DOMContentLoaded or at end of body
 */
function initTheme() {
    const theme = getTheme();
    setTheme(theme);
}

/**
 * Legacy toggle function (for compatibility)
 * Cycles through all 3 themes
 */
function toggleTheme() {
    return cycleTheme();
}

// Auto-init theme when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}

// Listen for theme sync from parent iframe (dashboard)
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'theme-change') {
        setTheme(event.data.theme);
    }
});

/**
 * Alpine.js Theme Mixin
 * Usage: x-data="{ ...themeMixin(), ...yourApp() }"
 * Or just include in your app: theme: getTheme(), darkMode computed, etc.
 */
const themeMixin = () => ({
    theme: getTheme(),
    get darkMode() { return this.theme !== 'light'; },
    get oledMode() { return this.theme === 'oled'; },
    get neonMode() { return this.theme === 'neon'; },
    get emberMode() { return this.theme === 'ember'; },

    initThemeWatcher() {
        // Listen for theme changes from common.js
        window.addEventListener('theme-changed', (e) => {
            this.theme = e.detail.theme;
        });
        // Listen for theme changes from parent iframe (dashboard)
        window.addEventListener('message', (event) => {
            if (event.data.type === 'theme-change') {
                setTheme(event.data.theme);
                this.theme = event.data.theme;
            }
        });
    },

    toggleTheme() {
        this.theme = cycleTheme();
    },

    getThemeLabel() {
        return THEME_LABELS[this.theme] || THEME_LABELS.light;
    }
});

// Make theme functions available globally for ES modules
window.themeMixin = themeMixin;
window.getTheme = getTheme;
window.setTheme = setTheme;
window.cycleTheme = cycleTheme;
window.THEMES = THEMES;
window.THEME_ORDER = THEME_ORDER;
window.THEME_LABELS = THEME_LABELS;
window.THEME_ICONS = THEME_ICONS;

// ==========================================
// Date Formatting
// ==========================================

/**
 * Format date to French locale (DD/MM/YYYY HH:MM)
 * @param {string|Date} dateInput - Date string or Date object
 * @param {boolean} includeTime - Include time in output (default: true)
 * @returns {string} Formatted date
 */
function formatDateFR(dateInput, includeTime = true) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return '--';

    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    };

    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }

    return date.toLocaleString('fr-FR', options);
}

/**
 * Format date to short format (DD/MM/YY)
 * @param {string|Date} dateInput - Date string or Date object
 * @returns {string} Formatted date
 */
function formatDateShort(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return '--';

    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
    });
}

/**
 * Format ISO date (YYYY-MM-DD) to French format (DD.MM.YYYY)
 * @param {string} isoDate - ISO date string
 * @returns {string} French formatted date
 */
function formatISOtoFR(isoDate) {
    if (!isoDate) return '--';
    const [year, month, day] = isoDate.split('-');
    return `${day}.${month}.${year}`;
}

// ==========================================
// Number/Size Formatting
// ==========================================

/**
 * Format bytes to human readable (KB, MB, GB, TB)
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Decimal places (default: 1)
 * @returns {string} Formatted size
 */
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format duration in seconds to human readable
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2h 15m 30s")
 */
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '--';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Format number with space as thousands separator (Swiss/French style)
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '--';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Format amount with CHF currency
 * @param {number} amount - Amount to format
 * @returns {string} Formatted amount
 */
function formatCHF(amount) {
    if (amount === null || amount === undefined) return '--';
    return formatNumber(Math.round(amount)) + ' CHF';
}

// ==========================================
// String Utilities
// ==========================================

/**
 * Truncate string with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==========================================
// Time Utilities
// ==========================================

/**
 * Get relative time (e.g., "il y a 5 minutes")
 * @param {string|Date} dateInput - Date to compare
 * @returns {string} Relative time string
 */
function timeAgo(dateInput, compact = false) {
    // Handle SQLite format "YYYY-MM-DD HH:MM:SS" (space separator)
    let date;
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dateInput)) {
        date = new Date(dateInput.replace(' ', 'T') + 'Z');
    } else {
        date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    }
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (compact) {
        if (minutes < 1) return "à l'instant";
        if (minutes < 60) return `${minutes} min`;
        if (hours < 24) return `${hours}h`;
        if (days < 7) return `${days}j`;
        if (days < 30) return `${Math.floor(days / 7)}sem`;
        return date.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' });
    }

    if (seconds < 60) return 'à l\'instant';
    if (seconds < 3600) return `il y a ${minutes} min`;
    if (seconds < 86400) return `il y a ${hours}h`;
    if (seconds < 604800) return `il y a ${days}j`;
    if (seconds < 2592000) return `il y a ${Math.floor(days / 7)} sem`;

    return formatDateShort(date);
}

// ==========================================
// DOM Utilities
// ==========================================

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
    // Remove existing toast
    const existing = document.getElementById('toast-notification');
    if (existing) existing.remove();

    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-orange-500',
        info: 'bg-blue-500'
    };

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = `fixed bottom-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity duration-300`;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copié !', 'success', 1500);
        return true;
    } catch (err) {
        showToast('Erreur de copie', 'error');
        return false;
    }
}

// ==========================================
// API Utilities
// ==========================================

/**
 * Fetch JSON with error handling
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<object>} JSON response
 */
async function fetchJSON(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`Fetch error (${url}):`, error);
        throw error;
    }
}

// ==========================================
// Export for ES6 modules (optional)
// ==========================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Theme
        THEMES, THEME_ORDER, THEME_LABELS, THEME_ICONS,
        getTheme, setTheme, cycleTheme, toggleTheme, initTheme, updateThemeToggle,
        // Date
        formatDateFR, formatDateShort, formatISOtoFR,
        // Numbers
        formatBytes, formatDuration, formatNumber, formatCHF,
        // Strings
        truncate, escapeHtml, timeAgo,
        // DOM/API
        showToast, copyToClipboard, fetchJSON
    };
}
