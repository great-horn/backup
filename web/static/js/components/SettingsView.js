export default {
    props: ['theme'],
    inject: ['t'],
    data() {
        return {
            jobs: [],
            loading: true,
            showCreateModal: false,
            editingJob: null,
            form: {
                job_name: '', display_name: '', source_path: '', dest_path: '',
                mode: 'compression', run_group: 'medium', excludes_text: '', icon_url: '',
                retention_count: 7, backend_type: 'rsync', rclone_remote: '', rclone_path: ''
            }
        };
    },
    mounted() {
        this.loadJobs();
    },
    methods: {
        async loadJobs() {
            this.loading = true;
            try {
                const res = await fetch('/api/jobs');
                const data = await res.json();
                this.jobs = data.jobs || [];
            } catch (e) {
                console.error('Erreur chargement jobs:', e);
            }
            this.loading = false;
        },
        editJob(job) {
            this.editingJob = job;
            this.form = {
                job_name: job.job_name,
                display_name: job.display_name,
                source_path: job.source_path,
                dest_path: job.dest_path,
                mode: job.mode,
                run_group: job.run_group,
                excludes_text: (job.excludes || []).join('\n'),
                icon_url: job.icon_url || '',
                retention_count: job.retention_count || 7,
                backend_type: job.backend_type || 'rsync',
                rclone_remote: job.rclone_remote || '',
                rclone_path: job.rclone_path || ''
            };
        },
        closeModal() {
            this.showCreateModal = false;
            this.editingJob = null;
            this.form = { job_name: '', display_name: '', source_path: '', dest_path: '', mode: 'compression', run_group: 'medium', excludes_text: '', icon_url: '', retention_count: 7, backend_type: 'rsync', rclone_remote: '', rclone_path: '' };
        },
        async saveJob() {
            const excludes = this.form.excludes_text.split('\n').map(s => s.trim()).filter(s => s);
            const payload = { ...this.form, excludes };
            delete payload.excludes_text;

            try {
                let res;
                if (this.editingJob) {
                    res = await fetch(`/api/jobs/${this.form.job_name}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch('/api/jobs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }
                if (res.ok) {
                    this.closeModal();
                    await this.loadJobs();
                } else {
                    const err = await res.json();
                    console.error(err.error || 'Erreur');
                }
            } catch (e) {
                console.error('Erreur:', e.message);
            }
        },
        async deleteJob(name) {
            if (!confirm(`${this.t('settings.confirm_delete')} (${name})`)) return;
            try {
                const res = await fetch(`/api/jobs/${name}`, { method: 'DELETE' });
                if (res.ok) await this.loadJobs();
            } catch (e) {
                console.error('Erreur:', e.message);
            }
        },
        async toggleEnabled(job) {
            try {
                await fetch(`/api/jobs/${job.job_name}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: job.enabled ? 0 : 1 })
                });
                await this.loadJobs();
            } catch (e) {
                console.error(e);
            }
        },
        async toggleSchedule(job) {
            try {
                await fetch(`/api/jobs/${job.job_name}/schedule`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        schedule_enabled: job.schedule_enabled ? 0 : 1,
                        schedule_cron: job.schedule_cron || '0 4 * * *'
                    })
                });
                await this.loadJobs();
            } catch (e) {
                console.error(e);
            }
        },
        async updateCron(job, value) {
            try {
                await fetch(`/api/jobs/${job.job_name}/schedule`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ schedule_enabled: job.schedule_enabled, schedule_cron: value })
                });
                await this.loadJobs();
            } catch (e) {
                console.error(e);
            }
        },
        setCron(job, cron) {
            this.updateCron(job, cron);
        },
        async updateGroup(job, group) {
            try {
                await fetch(`/api/jobs/${job.job_name}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ run_group: group })
                });
                await this.loadJobs();
            } catch (e) {
                console.error(e);
            }
        },
        formatDate(dateStr) {
            if (!dateStr) return '--';
            try {
                return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch { return '--'; }
        },
        groupJobs(group) {
            return this.jobs.filter(j => j.run_group === group);
        },
        groupDescription(group) {
            const descs = { light: 'Parallele (< 1 min)', medium: 'Parallele (1-2 min)', heavy: 'Sequentiel (> 2 min)' };
            return descs[group] || '';
        }
    },
    template: `
    <div>
        <!-- Header -->
        <div class="backup-section shadow-sm p-4 sm:p-6 mb-5">
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div class="flex items-center gap-3 sm:gap-4 min-w-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-blue);" class="shrink-0">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    <div class="min-w-0">
                        <h1 class="text-2xl sm:text-3xl font-bold backup-text">{{ t('settings.title') }}</h1>
                        <p class="backup-text-muted mt-1 text-sm sm:text-base">{{ t('settings.subtitle') }}</p>
                    </div>
                </div>
                <button @click="showCreateModal = true" class="backup-btn-primary px-4 sm:px-6 py-2.5 sm:py-3 shrink-0 w-full sm:w-auto justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    {{ t('settings.add_job') }}
                </button>
            </div>
        </div>

        <!-- Section: Jobs -->
        <div class="backup-section shadow-sm p-4 sm:p-6 mb-6">
            <h2 class="text-xl font-bold backup-text mb-5 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                {{ t('settings.title') }}
            </h2>

            <div v-if="loading" class="text-center py-12">
                <div class="spinner mx-auto"></div>
                <p class="backup-text-muted mt-4">{{ t('common.loading') }}</p>
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                <div v-for="job in jobs" :key="job.job_name"
                     class="backup-card rounded-xl p-4 sm:p-5 hover:shadow-md min-w-0">
                    <div class="flex items-start justify-between mb-3 gap-2">
                        <div class="flex items-center gap-3 min-w-0">
                            <img :src="job.icon_url || 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg'" class="w-8 h-8 shrink-0" :alt="job.display_name">
                            <div class="min-w-0">
                                <div class="font-semibold backup-text truncate">{{ job.display_name }}</div>
                                <div class="text-xs backup-text-muted font-mono truncate">{{ job.job_name }}</div>
                            </div>
                        </div>
                        <label class="toggle-switch shrink-0">
                            <input type="checkbox" :checked="job.enabled" @change="toggleEnabled(job)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>

                    <div class="space-y-1.5 text-sm mb-3 min-w-0">
                        <div class="flex items-center gap-2 backup-text-muted min-w-0">
                            <span class="font-medium w-14 shrink-0">Source:</span>
                            <span class="truncate font-mono text-xs block">{{ job.source_path }}</span>
                        </div>
                        <div class="flex items-center gap-2 backup-text-muted min-w-0">
                            <span class="font-medium w-14 shrink-0">Dest:</span>
                            <span class="truncate font-mono text-xs block">{{ job.dest_path }}</span>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-medium w-14 shrink-0 backup-text-muted">Mode:</span>
                            <span class="backup-tag"
                                :class="job.mode === 'compression' ? 'backup-tag-blue' : 'backup-tag-green'">
                                {{ job.mode }}
                            </span>
                            <span class="backup-tag backup-tag-gray">{{ job.run_group }}</span>
                        </div>
                    </div>

                    <div class="flex items-center justify-between pt-3 backup-border gap-2" style="border-top-width: 1px;">
                        <div class="text-xs backup-text-muted truncate min-w-0">
                            <span v-if="job.last_run_date">{{ t('analytics.last') }}: {{ formatDate(job.last_run_date) }}</span>
                            <span v-else>--</span>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button @click="editJob(job)" style="color: var(--accent-blue);" class="p-1.5 rounded transition-colors" title="Modifier">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button @click="deleteJob(job.job_name)" class="text-red-500 hover:text-red-600 p-1.5 rounded transition-colors" title="Supprimer">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Section: Schedules -->
        <div class="backup-section shadow-sm p-4 sm:p-6 mb-6">
            <h2 class="text-xl font-bold backup-text mb-5 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Schedules
            </h2>

            <!-- Desktop: Table -->
            <div class="hidden lg:block overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="backup-border" style="border-bottom-width: 1px;">
                            <th class="text-left py-3 px-4 font-semibold backup-text-muted uppercase text-xs tracking-wide">Job</th>
                            <th class="text-left py-3 px-4 font-semibold backup-text-muted uppercase text-xs tracking-wide">Actif</th>
                            <th class="text-left py-3 px-4 font-semibold backup-text-muted uppercase text-xs tracking-wide">Cron</th>
                            <th class="text-left py-3 px-4 font-semibold backup-text-muted uppercase text-xs tracking-wide">Prochaine execution</th>
                            <th class="text-left py-3 px-4 font-semibold backup-text-muted uppercase text-xs tracking-wide">Presets</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="job in jobs" :key="'sched-' + job.job_name"
                            class="backup-table-row">
                            <td class="py-3 px-4">
                                <div class="flex items-center gap-2">
                                    <img :src="job.icon_url || 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg'" class="w-5 h-5">
                                    <span class="font-medium backup-text">{{ job.display_name }}</span>
                                </div>
                            </td>
                            <td class="py-3 px-4">
                                <label class="toggle-switch">
                                    <input type="checkbox" :checked="job.schedule_enabled" @change="toggleSchedule(job)">
                                    <span class="toggle-slider"></span>
                                </label>
                            </td>
                            <td class="py-3 px-4">
                                <input type="text" :value="job.schedule_cron" @blur="updateCron(job, $event.target.value)"
                                    class="backup-input rounded px-3 py-1.5 font-mono w-36"
                                    placeholder="0 4 * * *">
                            </td>
                            <td class="py-3 px-4 text-xs backup-text-muted">{{ job.next_run ? formatDate(job.next_run) : '--' }}</td>
                            <td class="py-3 px-4">
                                <div class="flex gap-1.5">
                                    <button @click="setCron(job, '0 4 * * *')" class="backup-btn-small">4h/jour</button>
                                    <button @click="setCron(job, '0 3 * * 1-5')" class="backup-btn-small">3h L-V</button>
                                    <button @click="setCron(job, '0 2 * * 0')" class="backup-btn-small">2h Dim</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Mobile: Cards -->
            <div class="lg:hidden space-y-3">
                <div v-for="job in jobs" :key="'sched-m-' + job.job_name"
                     class="backup-card rounded-xl p-4">
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-2 min-w-0">
                            <img :src="job.icon_url || 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg'" class="w-5 h-5 shrink-0">
                            <span class="font-medium backup-text truncate">{{ job.display_name }}</span>
                        </div>
                        <label class="toggle-switch shrink-0">
                            <input type="checkbox" :checked="job.schedule_enabled" @change="toggleSchedule(job)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-xs backup-text-muted shrink-0 w-10">Cron:</span>
                        <input type="text" :value="job.schedule_cron" @blur="updateCron(job, $event.target.value)"
                            class="backup-input rounded px-2.5 py-1 font-mono flex-1 min-w-0"
                            placeholder="0 4 * * *">
                    </div>
                    <div class="flex items-center gap-2 mb-3">
                        <span class="text-xs backup-text-muted shrink-0 w-10">Next:</span>
                        <span class="text-xs backup-text-muted">{{ job.next_run ? formatDate(job.next_run) : '--' }}</span>
                    </div>
                    <div class="flex gap-1.5 flex-wrap">
                        <button @click="setCron(job, '0 4 * * *')" class="backup-btn-small px-2.5 py-1">4h/jour</button>
                        <button @click="setCron(job, '0 3 * * 1-5')" class="backup-btn-small px-2.5 py-1">3h L-V</button>
                        <button @click="setCron(job, '0 2 * * 0')" class="backup-btn-small px-2.5 py-1">2h Dim</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Section: Orchestration -->
        <div class="backup-section shadow-sm p-4 sm:p-6">
            <h2 class="text-xl font-bold backup-text mb-5 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-blue);"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                Orchestration (groupes)
            </h2>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <div v-for="group in ['light', 'medium', 'heavy']" :key="group"
                     class="backup-card rounded-xl p-4">
                    <h3 class="font-semibold backup-text mb-1 capitalize">{{ group }}</h3>
                    <p class="text-xs backup-text-muted mb-3">{{ groupDescription(group) }}</p>
                    <div class="space-y-2">
                        <div v-for="job in groupJobs(group)" :key="'orch-' + job.job_name"
                             class="flex items-center justify-between backup-section rounded-lg px-3 py-2 backup-border" style="border-width: 1px;">
                            <span class="text-sm backup-text">{{ job.display_name }}</span>
                            <select @change="updateGroup(job, $event.target.value)" class="bg-transparent border-0 text-xs backup-text-muted focus:outline-none cursor-pointer">
                                <option v-for="g in ['light', 'medium', 'heavy']" :key="g" :value="g" :selected="g === job.run_group">{{ g }}</option>
                            </select>
                        </div>
                        <div v-if="groupJobs(group).length === 0" class="text-center text-xs backup-text-muted py-2">{{ t('settings.no_jobs') }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Create/Edit Modal -->
        <div v-if="showCreateModal || editingJob" class="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black bg-opacity-50 p-0 sm:p-4">
            <div class="backup-modal rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto">
                <div class="backup-modal-header p-4 sm:p-6 flex items-center justify-between sticky top-0 z-10">
                    <h3 class="text-lg sm:text-xl font-bold backup-text">{{ editingJob ? t('settings.edit') : t('settings.add_job') }}</h3>
                    <button @click="closeModal()" class="backup-text-muted p-1" style="background:none;border:none;cursor:pointer;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="p-4 sm:p-6 space-y-4">
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.job_name') }}</label>
                        <input type="text" v-model="form.job_name" :disabled="!!editingJob" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5" placeholder="mon_job">
                    </div>
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.display_name') }}</label>
                        <input type="text" v-model="form.display_name" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5" placeholder="Mon Backup">
                    </div>
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.source_path') }}</label>
                        <input type="text" v-model="form.source_path" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5 font-mono" placeholder="/data/...">
                    </div>
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.dest_path') }}</label>
                        <input type="text" v-model="form.dest_path" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5 font-mono" placeholder="/mnt/data/...">
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.mode') }}</label>
                            <select v-model="form.mode" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5">
                                <option value="compression">{{ t('settings.compression') }} (zstd)</option>
                                <option value="direct">{{ t('settings.direct') }}</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.run_group') }}</label>
                            <select v-model="form.run_group" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5">
                                <option value="light">{{ t('settings.light') }}</option>
                                <option value="medium">{{ t('settings.medium') }}</option>
                                <option value="heavy">{{ t('settings.heavy') }}</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.excludes') }} ({{ t('settings.excludes_hint') }})</label>
                        <textarea v-model="form.excludes_text" rows="3" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5 font-mono" placeholder="logs/**\n__pycache__/**"></textarea>
                    </div>
                    <div>
                        <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.icon_url') }}</label>
                        <input type="text" v-model="form.icon_url" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5" placeholder="https://cdn.jsdelivr.net/...">
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.retention') }}</label>
                            <input type="number" v-model.number="form.retention_count" min="1" max="365" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5">
                            <p class="text-xs backup-text-muted mt-1">{{ t('settings.retention_hint') }}</p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.backend') }}</label>
                            <select v-model="form.backend_type" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5">
                                <option value="rsync">{{ t('settings.backend_rsync') }}</option>
                                <option value="rclone">{{ t('settings.backend_rclone') }}</option>
                            </select>
                        </div>
                    </div>
                    <div v-if="form.backend_type === 'rclone'" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.rclone_remote') }}</label>
                            <input type="text" v-model="form.rclone_remote" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5 font-mono" placeholder="myremote">
                        </div>
                        <div>
                            <label class="block text-sm font-medium backup-text-muted mb-1">{{ t('settings.rclone_path') }}</label>
                            <input type="text" v-model="form.rclone_path" class="w-full backup-input rounded-lg px-3 sm:px-4 py-2.5 font-mono" placeholder="/backups/">
                        </div>
                    </div>
                </div>
                <div class="backup-modal-footer p-4 sm:p-6 flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 sticky bottom-0">
                    <button @click="closeModal()" class="backup-btn-secondary px-5 py-2.5 w-full sm:w-auto">{{ t('settings.cancel') }}</button>
                    <button @click="saveJob()" class="backup-btn-primary px-5 py-2.5 w-full sm:w-auto justify-center">{{ t('settings.save') }}</button>
                </div>
            </div>
        </div>
    </div>
    `
};
