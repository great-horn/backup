export default {
    props: ['theme', 'restoreProgress'],
    inject: ['t', 'lang'],
    data() {
        return {
            searchQuery: '',
            searchResults: [],
            searchEmpty: false,
            backupJobs: [],
            loadingBackups: true,
            browsing: false,
            browseJobName: '',
            browseJobConfig: null,
            browseFile: '',
            browseCurrentPath: '',
            browsePath_parts: [],
            browseEntries: [],
            browseLoading: false,
            selectedFiles: [],
            restoreStatus: null,
            restoreMessage: '',
            showRestoreModal: false,
            restoreModalInfo: '',
            restoreTarget: 'original',
            customTarget: '/tmp/restore/',
            pendingRestore: null
        };
    },
    watch: {
        restoreProgress(data) {
            if (data) {
                this.restoreStatus = data.status;
                this.restoreMessage = data.message;
            }
        }
    },
    mounted() {
        this.loadBackups();
        this._onKeydown = (e) => { if (e.key === 'Escape') this.browsing = false; };
        document.addEventListener('keydown', this._onKeydown);
    },
    beforeUnmount() {
        document.removeEventListener('keydown', this._onKeydown);
    },
    methods: {
        async loadBackups() {
            this.loadingBackups = true;
            try {
                const res = await fetch('/api/restore/list');
                const data = await res.json();
                this.backupJobs = (data.jobs || []).map(j => ({ ...j, open: false }));
            } catch (e) {
                console.error('Erreur:', e);
            }
            this.loadingBackups = false;
        },
        async searchFiles() {
            if (this.searchQuery.length < 3) return;
            this.searchResults = [];
            this.searchEmpty = false;
            try {
                const res = await fetch(`/api/restore/search?q=${encodeURIComponent(this.searchQuery)}`);
                const data = await res.json();
                this.searchResults = data.results || [];
                this.searchEmpty = this.searchResults.length === 0;
            } catch (e) {
                console.error('Erreur recherche:', e);
            }
        },
        async browseBackup(job, backup) {
            this.browsing = true;
            this.browseJobName = job.display_name;
            this.browseJobConfig = job;
            this.browseFile = backup.filename;
            this.selectedFiles = [];
            await this.navigatePath('');
        },
        async navigatePath(path) {
            this.browseLoading = true;
            this.browseCurrentPath = path;
            this.browsePath_parts = path ? path.split('/').filter(p => p) : [];

            try {
                let url = `/api/restore/browse/${this.browseJobConfig.job_name}?path=${encodeURIComponent(path)}`;
                if (this.browseJobConfig.mode === 'compression' && this.browseFile) {
                    url += `&file=${encodeURIComponent(this.browseFile)}`;
                }
                const res = await fetch(url);
                const data = await res.json();
                this.browseEntries = data.entries || [];
            } catch (e) {
                console.error('Erreur browse:', e);
            }
            this.browseLoading = false;
        },
        browseToIndex(idx) {
            const parts = this.browsePath_parts.slice(0, idx + 1);
            this.navigatePath(parts.join('/') + '/');
        },
        toggleAccordion(job) {
            job.open = !job.open;
        },
        restoreFile(result) {
            this.pendingRestore = {
                job_name: result.job_name,
                backup_file: result.backup_file,
                files: [result.file_path]
            };
            this.restoreModalInfo = `${this.t('restore.restore')} "${result.file_path}" — ${result.display_name}`;
            this.showRestoreModal = true;
        },
        restoreBackup(job, backup) {
            const dm = this.t('restore.direct_mirror');
            this.pendingRestore = {
                job_name: job.job_name,
                backup_file: backup.filename !== dm ? backup.filename : '',
                files: []
            };
            this.restoreModalInfo = `${this.t('restore.restore')} "${backup.filename}" — ${job.display_name}`;
            this.showRestoreModal = true;
        },
        restoreSelected() {
            const dm = this.t('restore.direct_mirror');
            this.pendingRestore = {
                job_name: this.browseJobConfig.job_name,
                backup_file: this.browseFile !== dm ? this.browseFile : '',
                files: [...this.selectedFiles]
            };
            this.restoreModalInfo = `${this.t('restore.restore')} ${this.selectedFiles.length} ${this.t('restore.file')} — ${this.browseJobName}`;
            this.showRestoreModal = true;
        },
        async confirmRestore() {
            this.showRestoreModal = false;
            this.restoreStatus = 'running';
            this.restoreMessage = this.t('restore.restoring');

            try {
                const payload = {
                    ...this.pendingRestore,
                    target_path: this.restoreTarget === 'custom' ? this.customTarget : ''
                };
                const res = await fetch('/api/restore/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) {
                    this.restoreStatus = 'error';
                    this.restoreMessage = data.error || 'Erreur';
                }
            } catch (e) {
                this.restoreStatus = 'error';
                this.restoreMessage = e.message;
            }
        },
        progressClass() {
            switch (this.restoreStatus) {
                case 'success': return 'backup-progress backup-progress-success';
                case 'error': return 'backup-progress backup-progress-error';
                default: return 'backup-progress backup-progress-running';
            }
        },
        progressTextClass() {
            switch (this.restoreStatus) {
                case 'success': return 'backup-progress-text-success';
                case 'error': return 'backup-progress-text-error';
                default: return 'backup-progress-text-running';
            }
        },
        formatDate(dateStr) {
            if (!dateStr) return '--';
            try {
                const locales = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE', it: 'it-IT', es: 'es-ES', pt: 'pt-PT' };
                return new Date(dateStr).toLocaleString(locales[this.lang] || 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch { return '--'; }
        },
        formatSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            let i = 0;
            let val = bytes;
            while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
            return val.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
        }
    },
    template: `
    <div>
        <!-- Header -->
        <div class="backup-section shadow-sm p-6 mb-5">
            <div class="flex items-center gap-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-blue);">
                    <polyline points="1 4 1 10 7 10"></polyline>
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                </svg>
                <div>
                    <h1 class="text-3xl font-bold backup-text">{{ t('restore.title') }}</h1>
                    <p class="backup-text-muted mt-1">{{ t('restore.subtitle') }}</p>
                </div>
            </div>
        </div>

        <!-- Search -->
        <div class="backup-section shadow-sm p-6 mb-6">
            <div class="flex items-center gap-3 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <h3 class="text-lg font-semibold backup-text">{{ t('restore.search_global') }}</h3>
            </div>
            <div class="flex gap-3">
                <input type="text" v-model="searchQuery" @keyup.enter="searchFiles()" :placeholder="t('restore.search')"
                    class="flex-1 backup-input rounded-lg px-4 py-3">
                <button @click="searchFiles()" class="backup-btn-primary px-6 py-3">{{ t('common.search') }}</button>
            </div>

            <!-- Search Results -->
            <div v-if="searchResults.length > 0" class="mt-4 max-h-80 overflow-y-auto">
                <div class="text-sm backup-text-muted mb-2">{{ searchResults.length }} {{ t('restore.file') }}</div>
                <div v-for="result in searchResults" :key="result.file_path + result.job_name"
                     class="flex items-center justify-between backup-card rounded-lg px-4 py-2.5 mb-2 backup-card-interactive">
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium backup-text truncate">{{ result.file_path }}</div>
                        <div class="text-xs backup-text-muted">
                            {{ result.display_name }} - {{ formatSize(result.size) }}
                            <span v-if="result.backup_file" class="backup-text-muted"> - {{ result.backup_file }}</span>
                        </div>
                    </div>
                    <button @click="restoreFile(result)" class="ml-3 backup-btn-primary px-3 py-1.5 text-xs rounded-lg">{{ t('restore.restore') }}</button>
                </div>
            </div>
            <div v-if="searchEmpty" class="mt-4 text-center text-sm backup-text-muted py-4">{{ t('restore.no_results') }}</div>
        </div>

        <!-- Backups List -->
        <div class="backup-section shadow-sm p-6 mb-6">
            <h3 class="text-lg font-semibold backup-text mb-5">{{ t('restore.title') }}</h3>

            <div v-if="loadingBackups" class="text-center py-12">
                <div class="spinner mx-auto"></div>
                <p class="backup-text-muted mt-4">{{ t('common.loading') }}</p>
            </div>

            <div v-else class="space-y-3">
                <div v-for="job in backupJobs" :key="job.job_name" class="backup-border rounded-xl overflow-hidden" style="border-width: 1px;">
                    <!-- Accordion Header -->
                    <button @click="toggleAccordion(job)" class="w-full flex items-center justify-between p-4 backup-card-interactive" style="background: var(--bg-tertiary); border: none; border-radius: 0;">
                        <div class="flex items-center gap-3">
                            <img :src="job.icon_url || 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg'" class="w-6 h-6">
                            <span class="font-semibold backup-text">{{ job.display_name }}</span>
                            <span class="backup-tag"
                                :class="job.mode === 'compression' ? 'backup-tag-blue' : 'backup-tag-green'">
                                {{ job.mode }}
                            </span>
                            <span class="text-xs backup-text-muted">{{ job.backups.length }} {{ t('restore.archives') }}</span>
                        </div>
                        <svg :class="{'rotate-180': job.open}" class="w-5 h-5 backup-text-muted transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>

                    <!-- Accordion Content -->
                    <div v-if="job.open" class="p-4 backup-border" style="border-top-width: 1px;">
                        <div v-for="backup in job.backups" :key="backup.filename"
                             class="flex items-center justify-between py-2 px-3 mb-2 rounded-lg" style="background: color-mix(in srgb, var(--bg-tertiary) 50%, transparent);">
                            <div>
                                <div class="text-sm font-medium backup-text">{{ backup.filename }}</div>
                                <div class="text-xs backup-text-muted">
                                    {{ backup.size_mb }} MB - {{ formatDate(backup.date) }}
                                    <span v-if="backup.file_count"> - {{ backup.file_count }} {{ t('restore.file') }}</span>
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button @click="browseBackup(job, backup)" class="backup-btn-small px-3 py-1.5">{{ t('restore.browse') }}</button>
                                <button @click="restoreBackup(job, backup)" class="backup-btn-primary px-3 py-1.5 text-xs rounded-lg">{{ t('restore.restore') }}</button>
                            </div>
                        </div>
                        <div v-if="job.backups.length === 0" class="text-center text-sm backup-text-muted py-4">{{ t('restore.no_backups') }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- File Browser Modal -->
        <div v-if="browsing" class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="browsing = false"></div>
            <div class="relative backup-modal rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col z-10">
                <!-- Header -->
                <div class="backup-modal-header flex items-center justify-between p-5 flex-shrink-0">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-3">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" class="text-yellow-500 flex-shrink-0"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                            <h3 class="text-lg font-semibold backup-text truncate">{{ t('restore.browse') }}: {{ browseJobName }}</h3>
                        </div>
                        <!-- Breadcrumb -->
                        <div class="flex items-center gap-1 mt-2 text-sm pl-8">
                            <button @click="navigatePath('')" style="color: var(--accent-blue); background: none; border: none; cursor: pointer;" class="font-medium">/</button>
                            <span v-for="(part, idx) in browsePath_parts" :key="idx" class="flex items-center gap-1">
                                <span class="backup-text-muted">/</span>
                                <button @click="browseToIndex(idx)" style="color: var(--accent-blue); background: none; border: none; cursor: pointer;">{{ part }}</button>
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0 ml-3">
                        <button v-if="selectedFiles.length > 0" @click="restoreSelected()" class="backup-btn-primary px-4 py-2 text-sm rounded-lg">
                            {{ t('restore.restore') }} ({{ selectedFiles.length }})
                        </button>
                        <button @click="browsing = false" class="backup-close-btn">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>
                <!-- Content -->
                <div class="overflow-y-auto flex-1 p-5">
                    <div v-if="browseLoading" class="text-center py-8">
                        <div class="spinner mx-auto"></div>
                    </div>

                    <div v-else class="backup-border rounded-lg overflow-hidden" style="border-width: 1px;">
                        <div v-for="entry in browseEntries" :key="entry.path"
                             class="backup-table-row flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                             @click="entry.type === 'directory' ? navigatePath(entry.path) : null">
                            <input v-if="entry.type === 'file'" type="checkbox" :value="entry.path" v-model="selectedFiles"
                                @click.stop class="rounded backup-border" style="accent-color: var(--accent-blue);">
                            <svg v-if="entry.type === 'directory'" class="w-5 h-5 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                            <svg v-if="entry.type === 'file'" class="w-5 h-5 flex-shrink-0 backup-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <span class="flex-1 text-sm backup-text">{{ entry.name }}</span>
                            <span class="text-xs backup-text-muted">{{ entry.type === 'file' ? formatSize(entry.size) : '' }}</span>
                        </div>
                        <div v-if="browseEntries.length === 0" class="text-center py-8 text-sm backup-text-muted">{{ t('restore.no_files') }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Restore Progress -->
        <div v-if="restoreStatus" class="backup-section shadow-sm p-6">
            <h3 class="text-lg font-semibold backup-text mb-3">{{ t('restore.restoring') }}</h3>
            <div :class="progressClass()">
                <div class="flex items-center gap-3">
                    <div v-if="restoreStatus === 'running'" class="spinner" style="width:24px;height:24px;border-width:2px;"></div>
                    <svg v-if="restoreStatus === 'success'" class="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    <svg v-if="restoreStatus === 'error'" class="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    <span class="text-sm font-medium" :class="progressTextClass()">
                        {{ restoreMessage }}
                    </span>
                </div>
            </div>
        </div>

        <!-- Restore Modal -->
        <div v-if="showRestoreModal" class="fixed inset-0 z-[300] flex items-center justify-center bg-black bg-opacity-50">
            <div class="backup-modal rounded-2xl w-full max-w-md mx-4">
                <div class="backup-modal-header p-6 rounded-t-2xl">
                    <h3 class="text-xl font-bold backup-text">{{ t('restore.restore') }}</h3>
                </div>
                <div class="p-6 space-y-4">
                    <p class="text-sm backup-text-muted">{{ restoreModalInfo }}</p>
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('restore.restore_to') }}</label>
                        <div class="space-y-2">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" v-model="restoreTarget" value="original" style="accent-color: var(--accent-blue);">
                                <span class="text-sm backup-text">Original</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" v-model="restoreTarget" value="custom" style="accent-color: var(--accent-blue);">
                                <span class="text-sm backup-text">Custom</span>
                            </label>
                        </div>
                        <input v-if="restoreTarget === 'custom'" type="text" v-model="customTarget"
                            class="mt-2 w-full backup-input rounded-lg px-4 py-2.5 font-mono"
                            placeholder="/tmp/restore/">
                    </div>
                </div>
                <div class="backup-modal-footer p-6 flex justify-end gap-3 rounded-b-2xl">
                    <button @click="showRestoreModal = false" class="backup-btn-secondary px-5 py-2.5">{{ t('common.cancel') }}</button>
                    <button @click="confirmRestore()" class="backup-btn-primary px-5 py-2.5">{{ t('restore.restore') }}</button>
                </div>
            </div>
        </div>
    </div>
    `
};
