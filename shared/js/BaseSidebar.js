/* BaseSidebar — Shared Vue.js sidebar component */
/* Provides: header (logo + gradient name + optional subtitle), theme picker, slot for app content */

export default {
    name: 'BaseSidebar',
    props: {
        appName: { type: String, required: true },
        icon: { type: String, required: true },
        subtitle: { type: String, default: '' },
        theme: { type: String, default: 'light' },
        sidebarOpen: { type: Boolean, default: false }
    },
    emits: ['set-theme', 'toggle-sidebar'],
    data() {
        return {
            themeOptions: [
                { name: 'dark',  label: 'Azure',     bg: '#f0f4f8', border: '#cbd5e1', accent: '#3b82f6', icon: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z', fill: false },
                { name: 'light', label: 'Daylight',  bg: '#f8f9fb', border: '#e0e3ea', accent: '#059669', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z', fill: false },
                { name: 'oled',  label: 'Void',      bg: '#000000', border: '#1a1e2c', accent: '#ef4444', icon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', fill: true },
                { name: 'neon',  label: 'Cyberpunk', bg: '#0a0a12', border: '#1e1e3a', accent: '#00d4ff', icon: 'M13 10V3L4 14h7v7l9-11h-7z', fill: true },
                { name: 'ember', label: 'Hearth',    bg: '#151210', border: '#332c26', accent: '#e8a838', icon: 'M12 2c0 5-6 8-6 13a6 6 0 0012 0c0-5-6-8-6-13z', fill: true }
            ]
        };
    },
    template: `
    <button @click="$emit('toggle-sidebar')" class="mobile-menu-toggle">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
    </button>
    <div class="sidebar-overlay" :class="{ active: sidebarOpen }" @click="$emit('toggle-sidebar')"></div>
    <div class="sidebar" :class="{ 'mobile-open': sidebarOpen }">
        <div class="p-6">
            <!-- Header : logo + nom gradient + subtitle optionnelle -->
            <div class="sidebar-app-header">
                <h2>
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round"
                         style="color: var(--accent-blue);">
                        <path :d="icon"/>
                    </svg>
                    <span class="sidebar-app-name">{{ appName }}</span>
                    <span v-if="subtitle" class="sidebar-app-subtitle">{{ subtitle }}</span>
                </h2>
            </div>

            <!-- Theme picker — 5 dots -->
            <div class="theme-picker">
                <button v-for="t in themeOptions" :key="t.name"
                        class="theme-dot"
                        :class="{ active: theme === t.name }"
                        :style="{ background: t.bg, borderColor: theme === t.name ? t.accent : t.border, '--dot-accent': t.accent }"
                        :title="t.label"
                        @click="$emit('set-theme', t.name)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                         :fill="t.fill ? t.accent : 'none'"
                         :stroke="t.fill ? 'none' : t.accent"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path :d="t.icon"/>
                    </svg>
                </button>
            </div>

            <!-- Contenu app-specifique -->
            <slot></slot>
        </div>
    </div>
    `
};
