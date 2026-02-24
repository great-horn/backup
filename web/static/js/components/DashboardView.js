export default {
    props: ['theme', 'runningJobs'],
    inject: ['t'],
    data() {
        return {
            jobs: [],
            jobStatus: {},
            loading: true
        };
    },
    computed: {
        darkMode() { return this.theme === 'dark' || this.theme === 'oled'; }
    },
    watch: {
        runningJobs: {
            handler(val) {
                for (const [job, data] of Object.entries(val)) {
                    this.jobStatus[job] = { status: 'running', date: '' };
                }
            },
            deep: true
        }
    },
    mounted() {
        this.loadJobs();
        this.loadJobStatus();
        this._onBackupFinished = () => this.loadJobStatus();
        window.addEventListener('backup-finished', this._onBackupFinished);
    },
    beforeUnmount() {
        window.removeEventListener('backup-finished', this._onBackupFinished);
    },
    methods: {
        async loadJobs() {
            this.loading = true;
            try {
                const res = await fetch('/api/jobs');
                const data = await res.json();
                this.jobs = (data.jobs || []).filter(j => j.enabled);
            } catch (e) {
                console.error('Erreur chargement jobs:', e);
            }
            this.loading = false;
        },
        async loadJobStatus() {
            try {
                const res = await fetch('/api/job-status');
                this.jobStatus = await res.json();
            } catch (e) {
                console.error('Erreur chargement statuts:', e);
            }
        },
        async runBackup(jobName) {
            // Mark as running locally
            this.jobStatus = { ...this.jobStatus, [jobName]: { status: 'running', date: '' } };
            try {
                const res = await fetch(`/run?job=${jobName}`);
                const data = await res.json();
                console.log('Backup demarre:', data);
            } catch (e) {
                console.error('Erreur run:', e);
                this.loadJobStatus();
            }
        },
        getStatusClass(jobName) {
            const status = this.jobStatus[jobName];
            if (!status) return 'opacity-50';
            if (this.runningJobs[jobName]) return 'bg-blue-500 shadow-[0_0_16px_rgba(59,130,246,0.9)]';
            switch (status.status) {
                case 'success': return 'bg-green-500 shadow-[0_0_16px_rgba(16,185,129,0.9)]';
                case 'warning': return 'bg-orange-500 shadow-[0_0_16px_rgba(245,158,11,0.9)]';
                case 'error': return 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.9)]';
                case 'running': return 'bg-blue-500 shadow-[0_0_16px_rgba(59,130,246,0.9)]';
                default: return 'opacity-50';
            }
        },
        isRunning(jobName) {
            return !!this.runningJobs[jobName] || (this.jobStatus[jobName] && this.jobStatus[jobName].status === 'running');
        },
        getStatusDate(jobName) {
            const status = this.jobStatus[jobName];
            return status ? (status.date || '--') : '--';
        }
    },
    template: `
    <section class="backup-dashboard-section">
        <h2 class="backup-dashboard-title">{{ t('dashboard.title') }}</h2>

        <div v-if="loading" class="text-center py-12">
            <div class="spinner mx-auto"></div>
            <p class="backup-dashboard-muted" style="margin-top: 16px;">{{ t('dashboard.loading') }}</p>
        </div>

        <div v-else class="backup-services-grid">
            <!-- Backup Complet -->
            <div class="backup-service-card" @click="runBackup('all')">
                <div class="backup-status-dot" :class="getStatusClass('all')"></div>
                <div v-if="isRunning('all')" class="spinner" style="width:40px;height:40px;"></div>
                <template v-else>
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg" :alt="t('dashboard.full_backup')" class="backup-service-icon">
                    <span class="backup-service-name">{{ t('dashboard.full_backup') }}</span>
                </template>
                <div class="backup-service-date">
                    {{ isRunning('all') ? t('dashboard.running') : getStatusDate('all') }}
                </div>
            </div>

            <!-- Dynamic job cards -->
            <div v-for="job in jobs" :key="job.job_name"
                 class="backup-service-card" @click="runBackup(job.job_name)">
                <div class="backup-status-dot" :class="getStatusClass(job.job_name)"></div>
                <div v-if="isRunning(job.job_name)" class="spinner" style="width:40px;height:40px;"></div>
                <template v-else>
                    <img :src="job.icon_url || 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg'" :alt="job.display_name" class="backup-service-icon">
                    <span class="backup-service-name">{{ job.display_name }}</span>
                </template>
                <div class="backup-service-date">
                    {{ isRunning(job.job_name) ? t('dashboard.running') : getStatusDate(job.job_name) }}
                </div>
            </div>
        </div>
    </section>
    `
};
