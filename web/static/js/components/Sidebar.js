import BaseSidebar from '/shared/js/BaseSidebar.js';

export default {
    components: { BaseSidebar },
    props: ['currentView', 'theme', 'sidebarOpen'],
    inject: ['t', 'lang', 'setLang', 'languages'],
    emits: ['navigate', 'set-theme', 'toggle-sidebar'],
    data() {
        return {
            metrics: { success_rate: '--', avg_duration: '--', total_data: '--', last_backup: '--' }
        };
    },
    mounted() {
        this.loadMetrics();
    },
    methods: {
        async loadMetrics() {
            try {
                const res = await fetch('/api/metrics');
                this.metrics = await res.json();
            } catch (e) {
                console.error('Erreur metrics:', e);
            }
        }
    },
    template: `
    <BaseSidebar
        appName="Backups"
        icon="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01 20.73 6.96 M12 22.08V12"
        :theme="theme"
        :sidebarOpen="sidebarOpen"
        @set-theme="$emit('set-theme', $event)"
        @toggle-sidebar="$emit('toggle-sidebar')">

        <!-- Langue -->
        <div class="nav-section">
            <div class="nav-section-title">{{ t('sidebar.language') }}</div>
            <select class="profile-selector" :value="lang" @change="setLang($event.target.value)">
                <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option>
            </select>
        </div>

        <!-- Navigation -->
        <div class="nav-section">
            <button v-for="nav in [
                { view: 'dashboard', key: 'nav.dashboard', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10' },
                { view: 'analytics', key: 'nav.analytics', icon: 'M18 20V10 M12 20V4 M6 20V14' },
                { view: 'logs', key: 'nav.logs', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8' },
                { view: 'restore', key: 'nav.restore', icon: 'M1 4v6h6 M3.51 15a9 9 0 1 0 2.13-9.36L1 10' },
                { view: 'settings', key: 'nav.settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }
            ]" :key="nav.view"
                @click="$emit('navigate', nav.view)"
                class="sidebar-nav-item"
                :class="{ active: currentView === nav.view }">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path :d="nav.icon"/>
                </svg>
                {{ t(nav.key) }}
            </button>
        </div>

        <!-- Metrics -->
        <div class="sidebar-separator">
            <div class="nav-section-title">{{ t('sidebar.metrics') }}</div>
            <div class="sidebar-metrics">
                <div class="sidebar-metric-card">
                    <div class="sidebar-metric-value">{{ metrics.success_rate }}</div>
                    <div class="sidebar-metric-label">{{ t('sidebar.success_rate') }}</div>
                </div>
                <div class="sidebar-metric-card">
                    <div class="sidebar-metric-value">{{ metrics.avg_duration }}</div>
                    <div class="sidebar-metric-label">{{ t('sidebar.avg_duration') }}</div>
                </div>
                <div class="sidebar-metric-card">
                    <div class="sidebar-metric-value">{{ metrics.total_data }}</div>
                    <div class="sidebar-metric-label">{{ t('sidebar.total_volume') }}</div>
                </div>
                <div class="sidebar-metric-card">
                    <div class="sidebar-metric-value">{{ metrics.last_backup }}</div>
                    <div class="sidebar-metric-label">{{ t('sidebar.last_backup') }}</div>
                </div>
            </div>
        </div>
    </BaseSidebar>
    `
};
