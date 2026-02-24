export default {
    props: ['theme'],
    inject: ['t', 'lang'],
    data() {
        return {
            allLogs: [],
            filteredLogs: [],
            loading: true,
            searchText: '',
            statusFilter: '',
            periodFilter: '',
            showLogDetail: false,
            logDetailTitle: '',
            logDetailContent: ''
        };
    },
    mounted() {
        this.loadLogs();
        this._onEsc = (e) => { if (e.key === 'Escape' && this.showLogDetail) this.showLogDetail = false; };
        document.addEventListener('keydown', this._onEsc);
    },
    beforeUnmount() {
        if (this._onEsc) document.removeEventListener('keydown', this._onEsc);
    },
    methods: {
        async loadLogs() {
            this.loading = true;
            try {
                const res = await fetch('/api/logs');
                const data = await res.json();
                this.allLogs = data.logs || [];
                this.filterLogs();
            } catch (e) {
                console.error('Erreur:', e);
            }
            this.loading = false;
        },
        filterLogs() {
            const search = this.searchText.toLowerCase();
            const status = this.statusFilter;
            const period = this.periodFilter;
            this.filteredLogs = this.allLogs.filter(log => {
                const matchSearch = !search || (log.backup_name && log.backup_name.toLowerCase().includes(search)) || log.filename.toLowerCase().includes(search);
                const matchStatus = !status || log.status === status;
                let matchPeriod = true;
                if (period) {
                    const d = new Date(log.date);
                    const now = new Date();
                    if (period === 'today') matchPeriod = d.toDateString() === now.toDateString();
                    else if (period === 'week') matchPeriod = d >= new Date(now.getTime() - 7*86400000);
                    else if (period === 'month') matchPeriod = d >= new Date(now.getTime() - 30*86400000);
                }
                return matchSearch && matchStatus && matchPeriod;
            });
        },
        async viewLog(filename) {
            this.logDetailTitle = filename;
            this.logDetailContent = this.t('common.loading');
            this.showLogDetail = true;
            try {
                const res = await fetch(`/log/${filename}`);
                const data = await res.json();
                this.logDetailContent = data.content || data.error || this.t('logs.no_logs');
            } catch (e) {
                this.logDetailContent = this.t('common.error') + ': ' + e.message;
            }
        },
        formatDate(dateStr) {
            try {
                const locales = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE', it: 'it-IT', es: 'es-ES', pt: 'pt-PT' };
                return new Date(dateStr).toLocaleString(locales[this.lang] || 'en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
            } catch { return '--'; }
        },
        getServiceIcon(name) {
            // Use icon_url from job config if available, fallback to generic
            return 'docker-light.svg';
        },
        statusBadgeClass(status) {
            switch (status) {
                case 'success': return 'backup-badge backup-badge-success';
                case 'warning': return 'backup-badge backup-badge-warning';
                case 'error': return 'backup-badge backup-badge-error';
                default: return 'backup-badge backup-badge-default';
            }
        },
        statusText(status) {
            switch (status) {
                case 'success': return this.t('logs.filter_success');
                case 'warning': return this.t('logs.filter_error');
                case 'error': return this.t('common.error');
                default: return status;
            }
        }
    },
    watch: {
        searchText() { this.filterLogs(); },
        statusFilter() { this.filterLogs(); },
        periodFilter() { this.filterLogs(); }
    },
    template: `
    <div>
        <!-- Header -->
        <div class="backup-section shadow-sm p-6 mb-5">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/google-analytics-light.svg" style="width:48px;height:48px;" alt="Logs">
                    <div>
                        <h1 class="text-3xl font-bold backup-text">{{ t('logs.title') }}</h1>
                        <p class="backup-text-muted mt-1">{{ t('logs.subtitle') }}</p>
                    </div>
                </div>
                <button @click="loadLogs" class="backup-btn-primary px-6 py-3">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    {{ t('analytics.refresh') }}
                </button>
            </div>
        </div>

        <!-- Filters -->
        <div class="backup-section shadow-sm p-6 mb-6">
            <div class="flex items-center gap-3 mb-5">
                <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jekyll-light.svg" alt="Filtres" class="w-6 h-6">
                <h3 class="text-lg font-semibold backup-text">{{ t('common.search') }}</h3>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium backup-text-muted">{{ t('common.search') }}</label>
                    <input v-model="searchText" type="text" :placeholder="t('logs.search')" class="backup-input px-4 py-2.5">
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium backup-text-muted">{{ t('logs.status') }}</label>
                    <select v-model="statusFilter" class="backup-input px-4 py-2.5">
                        <option value="">{{ t('logs.filter_all') }}</option>
                        <option value="success">{{ t('logs.filter_success') }}</option>
                        <option value="warning">{{ t('logs.warning') }}</option>
                        <option value="error">{{ t('logs.filter_error') }}</option>
                    </select>
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium backup-text-muted">{{ t('logs.period') }}</label>
                    <select v-model="periodFilter" class="backup-input px-4 py-2.5">
                        <option value="">{{ t('logs.filter_all') }}</option>
                        <option value="today">{{ t('logs.today') }}</option>
                        <option value="week">{{ t('logs.this_week') }}</option>
                        <option value="month">{{ t('logs.this_month') }}</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- Logs List -->
        <div class="backup-section shadow-sm overflow-hidden">
            <div class="p-6 backup-border flex items-center justify-between" style="border-bottom-width: 1px;">
                <div class="flex items-center gap-3">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg" alt="Logs" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('logs.title') }}</h3>
                </div>
                <span class="backup-count-badge">{{ filteredLogs.length }} log(s)</span>
            </div>
            <div class="p-6">
                <div v-if="loading" class="text-center py-12">
                    <div class="spinner mx-auto"></div>
                    <p class="backup-text-muted mt-4">{{ t('common.loading') }}</p>
                </div>
                <div v-else-if="filteredLogs.length === 0" class="text-center py-12">
                    <p class="backup-text-muted">{{ t('logs.no_matching') }}</p>
                </div>
                <div v-else>
                    <div v-for="log in filteredLogs" :key="log.filename"
                         class="backup-card backup-card-interactive rounded-lg p-4 mb-3"
                         @click="viewLog(log.filename)">
                        <div class="flex items-center justify-between gap-4 flex-wrap log-item-container">
                            <div class="flex items-center gap-3 flex-1 min-w-0 log-item-info">
                                <img :src="'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/' + getServiceIcon(log.backup_name)" class="w-8 h-8 flex-shrink-0" :alt="log.backup_name">
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-medium backup-text mb-1">{{ log.backup_name || 'Backup' }}</div>
                                    <div class="text-xs backup-text-muted truncate">{{ log.filename }}</div>
                                </div>
                            </div>
                            <div class="flex items-center gap-3 flex-shrink-0 log-item-meta">
                                <div class="text-right">
                                    <div class="text-sm backup-text mb-1">{{ formatDate(log.date) }}</div>
                                    <div class="text-xs backup-text-muted">{{ log.size || '0 B' }}</div>
                                </div>
                                <div :class="statusBadgeClass(log.status)">
                                    {{ statusText(log.status) }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Log Detail Modal -->
        <div v-if="showLogDetail" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="showLogDetail = false">
            <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showLogDetail = false"></div>
            <div class="relative backup-modal rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col z-10">
                <div class="backup-modal-header flex items-center justify-between p-5 flex-shrink-0">
                    <div class="flex items-center gap-3 min-w-0">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);" class="flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        <h3 class="text-lg font-semibold backup-text truncate">{{ logDetailTitle }}</h3>
                    </div>
                    <button @click="showLogDetail = false" class="backup-close-btn ml-3">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="p-5 overflow-y-auto flex-1">
                    <div class="log-viewer">{{ logDetailContent }}</div>
                </div>
            </div>
        </div>
    </div>
    `
};
