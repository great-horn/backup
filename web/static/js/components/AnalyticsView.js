export default {
    props: ['theme'],
    inject: ['t'],
    data() {
        return {
            statsData: null,
            loading: true,
            timelinePeriod: 30,
            anomaliesHtml: '',
            storageHtml: '',
            servicesTableHtml: ''
        };
    },
    watch: {
        theme() {
            if (this.statsData) {
                this.$nextTick(() => this.createAllCharts(this.statsData));
            }
        }
    },
    mounted() {
        this.loadData();
    },
    beforeUnmount() {
        // Destroy charts
        ['timeline', 'services', 'volume', 'performance'].forEach(k => {
            if (this['chart_' + k]) { this['chart_' + k].destroy(); this['chart_' + k] = null; }
        });
    },
    computed: {
        totalBackups() { return this.statsData?.recent_runs?.length || 0; },
        totalData() {
            return this.statsData?.stats?.reduce((s, st) => s + (st.total_transferred || 0), 0) || 0;
        },
        avgDuration() {
            const stats = this.statsData?.stats;
            if (!stats?.length) return 0;
            return stats.reduce((s, st) => s + (st.avg_duration || 0), 0) / stats.length;
        },
        successRate() {
            const stats = this.statsData?.stats;
            if (!stats?.length) return 0;
            return stats.reduce((s, st) => s + (st.success_rate || 0), 0) / stats.length;
        },
        compressionRate() {
            return this.statsData?.compression_stats?.avg_compression_ratio || 0;
        }
    },
    methods: {
        async loadData() {
            this.loading = true;
            try {
                const res = await fetch('/api/stats');
                this.statsData = await res.json();
                this.$nextTick(() => this.createAllCharts(this.statsData));
                this.updateServicesTable();
                this.loadAnomalies();
                this.loadStoragePrediction();
            } catch (e) {
                console.error('Erreur chargement:', e);
            }
            this.loading = false;
        },

        chartColors() {
            return {
                primary: '#3b82f6', success: '#10b981', warning: '#f59e0b',
                danger: '#ef4444', purple: '#8b5cf6', pink: '#ec4899',
                orange: '#f97316', teal: '#14b8a6', cyan: '#06b6d4', indigo: '#6366f1'
            };
        },
        gridColor() {
            return document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
        },
        textColor() {
            return document.documentElement.getAttribute('data-theme') === 'light' ? '#475569' : '#94a3b8';
        },

        createAllCharts(data) {
            if (!data?.recent_runs?.length) return;
            this.createTimelineChart(data);
            this.createServicesChart(data);
            this.createVolumeChart(data);
            this.createPerformanceChart(data);
        },

        createTimelineChart(data) {
            const canvas = this.$refs.timelineChart;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const period = this.timelinePeriod;
            const now = new Date();
            const days = Array.from({length: period}, (_, i) => {
                const d = new Date(now); d.setDate(d.getDate() - (period - 1 - i));
                return d.toISOString().split('T')[0];
            });
            const daily = days.map(day => {
                const runs = data.recent_runs.filter(r => r.start_time?.startsWith(day));
                return { day, count: runs.length, success: runs.filter(r => r.status === 'success').length };
            });
            if (this.chart_timeline) this.chart_timeline.destroy();
            const c = this.chartColors();
            this.chart_timeline = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: days.map(d => new Date(d).toLocaleDateString('fr-FR', {month:'short',day:'numeric'})),
                    datasets: [
                        { label: this.t('analytics.total'), data: daily.map(d => d.count), borderColor: c.primary, backgroundColor: c.primary+'20', tension: 0.4, fill: true },
                        { label: this.t('analytics.succeeded'), data: daily.map(d => d.success), borderColor: c.success, backgroundColor: c.success+'20', tension: 0.4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    plugins: { legend: { position: 'top', labels: { color: this.textColor() } } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: this.gridColor() }, ticks: { color: this.textColor() } },
                        x: { grid: { color: this.gridColor() }, ticks: { color: this.textColor() } }
                    }
                }
            });
        },

        createServicesChart(data) {
            const canvas = this.$refs.servicesChart;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const stats = {};
            data.recent_runs.forEach(r => { const s = r.display_name||r.job_name||'?'; stats[s] = (stats[s]||0)+1; });
            const sorted = Object.entries(stats).sort(([,a],[,b]) => b-a).slice(0,8);
            if (this.chart_services) this.chart_services.destroy();
            const colors = Object.values(this.chartColors());
            this.chart_services = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: sorted.map(([n]) => n),
                    datasets: [{ data: sorted.map(([,c]) => c), backgroundColor: sorted.map((_,i) => colors[i%colors.length]), borderWidth: 0 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    plugins: { legend: { position: 'bottom', labels: { color: this.textColor(), font: {size:11} } } }
                }
            });
        },

        createVolumeChart(data) {
            const canvas = this.$refs.volumeChart;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const vols = {};
            data.recent_runs.forEach(r => { const s = r.display_name||r.job_name||'?'; vols[s] = (vols[s]||0)+(r.transferred_mb||0); });
            const sorted = Object.entries(vols).sort(([,a],[,b]) => b-a).slice(0,8);
            if (this.chart_volume) this.chart_volume.destroy();
            const colors = Object.values(this.chartColors());
            this.chart_volume = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: sorted.map(([n]) => n),
                    datasets: [{ label: 'Volume (MB)', data: sorted.map(([,m]) => Math.round(m)), backgroundColor: sorted.map((_,i) => colors[i%colors.length]), borderRadius: 4, borderSkipped: false }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    scales: {
                        y: { beginAtZero: true, grid: { color: this.gridColor() }, ticks: { color: this.textColor() } },
                        x: { grid: { color: this.gridColor() }, ticks: { color: this.textColor(), maxRotation: 45 } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        },

        createPerformanceChart(data) {
            const canvas = this.$refs.performanceChart;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const durs = {}, cnts = {};
            data.recent_runs.forEach(r => {
                if (r.duration > 0) {
                    const s = r.display_name||r.job_name||'?';
                    durs[s] = (durs[s]||0)+r.duration;
                    cnts[s] = (cnts[s]||0)+1;
                }
            });
            const avg = Object.entries(durs).map(([s,t]) => [s, t/(cnts[s]||1)]).sort(([,a],[,b]) => b-a).slice(0,8);
            if (!avg.length) return;
            if (this.chart_performance) this.chart_performance.destroy();
            const colors = Object.values(this.chartColors());
            this.chart_performance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: avg.map(([n]) => n),
                    datasets: [{ label: this.t('analytics.duration') + ' (s)', data: avg.map(([,d]) => Math.round(d)), backgroundColor: avg.map((_,i) => colors[i%colors.length]), borderRadius: 4, borderSkipped: false }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    indexAxis: 'y',
                    scales: {
                        x: { beginAtZero: true, grid: { color: this.gridColor() }, ticks: { color: this.textColor() } },
                        y: { grid: { color: this.gridColor() }, ticks: { color: this.textColor() } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        },

        async loadAnomalies() {
            if (!this.statsData?.stats?.length) {
                this.anomaliesHtml = `<div class="text-center py-8 backup-text-muted"><p>${this.t('analytics.no_data')}</p></div>`;
                return;
            }
            try {
                const jobs = this.statsData.stats.map(s => s.job_name);
                const anomalies = [];
                for (const job of jobs) {
                    const res = await fetch(`/api/anomalies/${job}`);
                    if (res.ok) {
                        const d = await res.json();
                        if (d.anomalies?.length) anomalies.push({ job, data: d.anomalies });
                    }
                }
                if (!anomalies.length) {
                    this.anomaliesHtml = `<div class="text-center py-8"><svg class="w-12 h-12 mx-auto mb-3 stroke-green-500" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg><p class="backup-text font-medium">${this.t('analytics.no_anomalies')}</p><p class="text-xs backup-text-muted mt-1">${this.t('analytics.all_normal')}</p></div>`;
                    return;
                }
                let html = '';
                anomalies.forEach(({job, data}) => {
                    data.forEach(a => {
                        const typeLabel = a.type === 'size' ? this.t('analytics.size') : this.t('analytics.duration_label');
                        const unit = a.type === 'size' ? 'MB' : 's';
                        html += `<div class="backup-anomaly-card">
                            <svg class="w-5 h-5 flex-shrink-0 mt-0.5" style="stroke:#f59e0b;" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                            <div class="flex-1 min-w-0"><div class="font-semibold backup-text mb-1">${job}</div><div class="text-sm backup-text-muted mb-1.5">${a.message}</div><div class="text-xs backup-text-muted font-mono">${typeLabel}: ${Math.round(a.current)} ${unit} (${this.t('analytics.avg')}: ${Math.round(a.average)} ${unit})</div></div></div>`;
                    });
                });
                this.anomaliesHtml = html;
            } catch (e) {
                this.anomaliesHtml = `<div class="text-center py-8 backup-text-muted"><p>${this.t('analytics.load_error')}</p></div>`;
            }
        },

        async loadStoragePrediction() {
            try {
                const res = await fetch('/api/storage-prediction');
                const data = await res.json();
                if (data.error) {
                    this.storageHtml = `<div class="text-center py-8 backup-text-muted"><p>${data.error}</p></div>`;
                    return;
                }
                const pct = ((data.nas_used_mb / data.nas_capacity_mb) * 100).toFixed(1);
                this.storageHtml = `<div class="text-center py-6">
                    <div class="w-40 h-40 mx-auto mb-6 rounded-full relative" style="background:conic-gradient(#10b981 0% ${pct}%, rgb(203 213 225 / 0.2) ${pct}% 100%);">
                        <div class="absolute inset-0 flex items-center justify-center"><div class="text-3xl font-bold backup-text">${pct}%</div></div>
                    </div>
                    <div class="text-sm backup-text-muted mb-6">${this.t('analytics.used_space')}</div>
                    <div class="grid grid-cols-3 gap-4">
                        <div class="backup-storage-stat"><div class="text-xl font-bold backup-text mb-1">${data.nas_capacity_gb} GB</div><div class="text-xs backup-text-muted uppercase tracking-wide">${this.t('analytics.capacity')}</div></div>
                        <div class="backup-storage-stat"><div class="text-xl font-bold backup-text mb-1">${data.nas_used_gb} GB</div><div class="text-xs backup-text-muted uppercase tracking-wide">${this.t('analytics.used')}</div></div>
                        <div class="backup-storage-stat"><div class="text-xl font-bold backup-text mb-1">${data.nas_free_gb} GB</div><div class="text-xs backup-text-muted uppercase tracking-wide">${this.t('analytics.available')}</div></div>
                    </div></div>`;
            } catch (e) {
                this.storageHtml = `<div class="text-center py-8 backup-text-muted"><p>${this.t('analytics.load_error')}</p></div>`;
            }
        },

        updateServicesTable() {
            if (!this.statsData?.recent_runs?.length) {
                this.servicesTableHtml = `<div class="text-center py-12 backup-text-muted">${this.t('analytics.no_data')}</div>`;
                return;
            }
            const stats = {};
            this.statsData.recent_runs.forEach(r => {
                const s = r.display_name||r.job_name||'?';
                if (!stats[s]) stats[s] = { count:0, success:0, totalVol:0, totalDur:0, lastRun:null };
                stats[s].count++;
                if (r.status==='success') stats[s].success++;
                stats[s].totalVol += (r.transferred_mb||0);
                stats[s].totalDur += (r.duration||0);
                if (!stats[s].lastRun || (r.start_time && r.start_time > stats[s].lastRun)) stats[s].lastRun = r.start_time;
            });
            const colors = Object.values(this.chartColors());
            let html = '', ci = 0;
            Object.entries(stats).sort(([,a],[,b]) => (b.lastRun||'').localeCompare(a.lastRun||'')).forEach(([svc, st]) => {
                const sr = st.count > 0 ? (st.success/st.count*100) : 0;
                const ad = st.count > 0 ? (st.totalDur/st.count) : 0;
                const ld = st.lastRun ? new Date(st.lastRun).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
                const col = colors[ci++ % colors.length];
                html += `<div class="backup-table-row grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr] gap-4 px-6 py-4 items-center">
                    <div class="flex items-center gap-3 font-medium backup-text"><div class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:${col}"></div><span class="truncate">${svc}</span></div>
                    <div class="backup-text">${st.count}</div>
                    <div class="flex items-center gap-2"><span class="text-sm font-medium backup-text min-w-[40px]">${Math.round(sr)}%</span><div class="flex-1 h-1.5 backup-success-bar-bg rounded-full overflow-hidden"><div class="h-full bg-green-500 rounded-full" style="width:${sr}%"></div></div></div>
                    <div class="backup-text">${Math.round(st.totalVol)} MB</div>
                    <div class="backup-text">${Math.round(ad)}s</div>
                    <div class="text-sm backup-text-muted">${ld}</div></div>`;
            });
            this.servicesTableHtml = html;
        },

        onPeriodChange(e) {
            this.timelinePeriod = parseInt(e.target.value);
            if (this.statsData) this.createTimelineChart(this.statsData);
        },

        async refresh() {
            await this.loadData();
        }
    },
    template: `
    <div>
        <!-- Page Header -->
        <div class="backup-section shadow-sm p-6 mb-5">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/google-analytics-light.svg" style="width:48px;height:48px;" alt="Analytics">
                    <div>
                        <h1 class="text-3xl font-bold backup-text">{{ t('analytics.title') }}</h1>
                        <p class="backup-text-muted mt-1">{{ t('analytics.subtitle') }}</p>
                    </div>
                </div>
                <button @click="refresh" class="backup-btn-primary px-6 py-3">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    {{ t('analytics.refresh') }}
                </button>
            </div>
        </div>

        <!-- Metrics -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <div class="backup-section shadow-sm p-4 sm:p-6 text-center">
                <div class="text-2xl sm:text-3xl font-bold backup-text mb-2">{{ statsData?.recent_runs?.length || 0 }}</div>
                <div class="text-xs backup-text-muted font-medium uppercase tracking-wide">{{ t('analytics.backups') }}</div>
            </div>
            <div class="backup-section shadow-sm p-4 sm:p-6 text-center">
                <div class="text-2xl sm:text-3xl font-bold backup-text mb-2">{{ Math.round(totalData) }} MB</div>
                <div class="text-xs backup-text-muted font-medium uppercase tracking-wide">{{ t('analytics.volume') }}</div>
            </div>
            <div class="backup-section shadow-sm p-4 sm:p-6 text-center">
                <div class="text-2xl sm:text-3xl font-bold backup-text mb-2">{{ Math.round(avgDuration) }}s</div>
                <div class="text-xs backup-text-muted font-medium uppercase tracking-wide">{{ t('analytics.duration') }}</div>
            </div>
            <div class="backup-section shadow-sm p-4 sm:p-6 text-center">
                <div class="text-2xl sm:text-3xl font-bold backup-text mb-2">{{ Math.round(successRate) }}%</div>
                <div class="text-xs backup-text-muted font-medium uppercase tracking-wide">{{ t('analytics.success') }}</div>
            </div>
            <div class="backup-section shadow-sm p-4 sm:p-6 text-center">
                <div class="text-2xl sm:text-3xl font-bold backup-text mb-2">{{ compressionRate > 0 ? Math.round(compressionRate) + '%' : '--' }}</div>
                <div class="text-xs backup-text-muted font-medium uppercase tracking-wide">{{ t('analytics.compression') }}</div>
            </div>
        </div>

        <!-- Anomalies + Storage -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="backup-section shadow-sm p-6">
                <div class="flex items-center gap-3 mb-5">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/uptime-kuma-light.svg" alt="Anomalies" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('analytics.anomalies_title') }}</h3>
                </div>
                <div class="min-h-[200px]" v-html="anomaliesHtml || '<div class=\\'text-center py-12\\'><div class=\\'spinner mx-auto\\'></div><p class=\\'backup-text-muted mt-4\\'>' + t('analytics.analyzing') + '</p></div>'"></div>
            </div>
            <div class="backup-section shadow-sm p-6">
                <div class="flex items-center gap-3 mb-5">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/scrutiny-light.svg" alt="Stockage" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('analytics.storage_title') }}</h3>
                </div>
                <div class="min-h-[200px]" v-html="storageHtml || '<div class=\\'text-center py-12\\'><div class=\\'spinner mx-auto\\'></div><p class=\\'backup-text-muted mt-4\\'>' + t('analytics.loading') + '</p></div>'"></div>
            </div>
        </div>

        <!-- Charts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div class="backup-section shadow-sm p-6">
                <div class="flex items-center justify-between mb-5">
                    <div class="flex items-center gap-3">
                        <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/leantime-light.svg" alt="Timeline" class="w-6 h-6">
                        <h3 class="text-lg font-semibold backup-text">{{ t('analytics.timeline') }}</h3>
                    </div>
                    <select @change="onPeriodChange" class="backup-input px-3 py-2 text-sm">
                        <option value="7">{{ t('analytics.days_7') }}</option>
                        <option value="30" selected>{{ t('analytics.days_30') }}</option>
                        <option value="90">{{ t('analytics.days_90') }}</option>
                    </select>
                </div>
                <div class="relative h-[300px]"><canvas ref="timelineChart"></canvas></div>
            </div>
            <div class="backup-section shadow-sm p-6">
                <div class="flex items-center gap-3 mb-5">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg" alt="Services" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('analytics.distribution') }}</h3>
                </div>
                <div class="relative h-[300px]"><canvas ref="servicesChart"></canvas></div>
            </div>
            <div class="backup-section shadow-sm p-6">
                <div class="flex items-center gap-3 mb-5">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg" alt="Volume" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('analytics.volume_by_service') }}</h3>
                </div>
                <div class="relative h-[300px]"><canvas ref="volumeChart"></canvas></div>
            </div>
            <div class="backup-section shadow-sm p-6">
                <div class="flex items-center gap-3 mb-5">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/speedtest-light.svg" alt="Performance" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('analytics.performance') }}</h3>
                </div>
                <div class="relative h-[300px]"><canvas ref="performanceChart"></canvas></div>
            </div>
        </div>

        <!-- Services Table -->
        <div class="backup-section shadow-sm overflow-hidden">
            <div class="p-6 backup-border" style="border-bottom-width: 1px;">
                <div class="flex items-center gap-3">
                    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/docker-light.svg" alt="Details" class="w-6 h-6">
                    <h3 class="text-lg font-semibold backup-text">{{ t('analytics.details') }}</h3>
                </div>
            </div>
            <div class="overflow-x-auto">
                <div class="backup-table-header grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr] gap-4 px-6 py-3 text-xs font-semibold uppercase tracking-wider">
                    <div>{{ t('analytics.service') }}</div><div>{{ t('analytics.backups') }}</div><div>{{ t('analytics.success') }}</div><div>{{ t('analytics.volume') }}</div><div>{{ t('analytics.duration') }}</div><div>{{ t('analytics.last') }}</div>
                </div>
                <div v-html="servicesTableHtml"></div>
            </div>
        </div>
    </div>
    `
};
