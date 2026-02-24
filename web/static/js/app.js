import Sidebar from './components/Sidebar.js';
import DashboardView from './components/DashboardView.js';
import AnalyticsView from './components/AnalyticsView.js';
import LogsView from './components/LogsView.js';
import SettingsView from './components/SettingsView.js';
import RestoreView from './components/RestoreView.js';
import { translations, languages, t } from './i18n.js';

const { createApp, ref, computed, onMounted, onUnmounted, provide } = Vue;

const availableCodes = languages.map(l => l.code);

const app = createApp({
    setup() {
        const theme = ref(window.getTheme());
        const sidebarOpen = ref(false);
        const currentView = ref('dashboard');
        const socket = ref(null);
        const runningJobs = ref({});
        const restoreProgress = ref(null);

        // i18n
        const detectedLang = localStorage.getItem('backup-lang') || navigator.language.split('-')[0] || 'en';
        const lang = ref(availableCodes.includes(detectedLang) ? detectedLang : 'en');

        function setLang(code) {
            if (availableCodes.includes(code)) {
                lang.value = code;
                localStorage.setItem('backup-lang', code);
            }
        }

        const tr = computed(() => (key) => t(key, lang.value));

        const darkMode = computed(() => theme.value === 'dark' || theme.value === 'oled');

        // Hash routing
        function parseHash() {
            const hash = window.location.hash || '#/';
            const routes = {
                '#/': 'dashboard',
                '#/analytics': 'analytics',
                '#/logs': 'logs',
                '#/settings': 'settings',
                '#/restore': 'restore'
            };
            currentView.value = routes[hash] || 'dashboard';
        }

        function navigate(view) {
            const hashes = {
                'dashboard': '#/',
                'analytics': '#/analytics',
                'logs': '#/logs',
                'settings': '#/settings',
                'restore': '#/restore'
            };
            window.location.hash = hashes[view] || '#/';
            sidebarOpen.value = false;
        }

        function setThemeHandler(t) {
            window.setTheme(t);
            theme.value = t;
        }

        function toggleSidebar() {
            sidebarOpen.value = !sidebarOpen.value;
        }

        // Provide to children
        provide('socket', socket);
        provide('runningJobs', runningJobs);
        provide('restoreProgress', restoreProgress);
        provide('theme', theme);
        provide('t', tr);
        provide('lang', lang);
        provide('setLang', setLang);
        provide('languages', languages);

        onMounted(() => {
            // Theme: listen for changes from common.js
            window.addEventListener('theme-changed', (e) => {
                theme.value = e.detail.theme;
            });

            // Hash routing
            parseHash();
            window.addEventListener('hashchange', parseHash);

            // Handle old URLs (from bookmarks or links)
            const path = window.location.pathname;
            if (path === '/analytics') { window.location.replace('/#/analytics'); return; }
            if (path === '/logs') { window.location.replace('/#/logs'); return; }
            if (path === '/settings') { window.location.replace('/#/settings'); return; }
            if (path === '/restore') { window.location.replace('/#/restore'); return; }

            // Socket.IO
            const s = io();
            socket.value = s;

            s.on('connect', () => {
                console.log('WebSocket connecte');
            });

            s.on('backup_status', (data) => {
                if (data.status === 'running') {
                    runningJobs.value = { ...runningJobs.value, [data.job]: data };
                } else {
                    const copy = { ...runningJobs.value };
                    delete copy[data.job];
                    runningJobs.value = copy;
                    window.dispatchEvent(new CustomEvent('backup-finished', { detail: data }));
                }
            });

            s.on('restore_progress', (data) => {
                restoreProgress.value = data;
            });
        });

        onUnmounted(() => {
            window.removeEventListener('hashchange', parseHash);
        });

        return {
            theme, sidebarOpen, currentView, runningJobs, restoreProgress,
            darkMode, navigate, setThemeHandler, toggleSidebar
        };
    },
    template: `
        <Sidebar
            :currentView="currentView"
            :theme="theme"
            :sidebarOpen="sidebarOpen"
            @navigate="navigate"
            @set-theme="setThemeHandler"
            @toggle-sidebar="toggleSidebar"
        />

        <!-- Main Content -->
        <div class="main-content">
            <div class="max-w-screen-2xl mx-auto">
                <DashboardView v-if="currentView === 'dashboard'" :theme="theme" :runningJobs="runningJobs" />
                <AnalyticsView v-if="currentView === 'analytics'" :theme="theme" />
                <LogsView v-if="currentView === 'logs'" :theme="theme" />
                <SettingsView v-if="currentView === 'settings'" :theme="theme" />
                <RestoreView v-if="currentView === 'restore'" :theme="theme" :restoreProgress="restoreProgress" />
            </div>
        </div>
    `
});

app.component('Sidebar', Sidebar);
app.component('DashboardView', DashboardView);
app.component('AnalyticsView', AnalyticsView);
app.component('LogsView', LogsView);
app.component('SettingsView', SettingsView);
app.component('RestoreView', RestoreView);

app.mount('#app');
