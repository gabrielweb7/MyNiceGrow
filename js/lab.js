// ========================================================
// LAB NERD 360° — GÊMEO 3D (THREE.JS), SERIAL & ANOMALIAS
// ========================================================

let labData = null;
let fwDataLab = null;
let chartDiario = null;
let chartScatter = null;
let chartHorario = null;
let diasAtivos = 30;

// Estado do Gêmeo 3D & Time-Lapse
let twinModo = 'live'; // 'live' | 'timelapse' | 'simular'
let twinFrames = [];
let twinIdx = 0;
let twinPlaying = true;
let twinVelMs = 150;
let twinTimer = null;
let liveTelemetryRow = null;
const simReles = { luz: false, umid: false, vento: false, exaust: false, ar: false };

document.addEventListener('DOMContentLoaded', () => {
    carregarPrefsAnalytics();
    if (window.initTwin3D) {
        try {
            window.initTwin3D(document.getElementById('twin3dContainer'));
        } catch (err) {
            console.error('Erro ao inicializar Twin3D:', err);
        }
    }
    carregarLab(30);
    atualizarConsoleAoVivo();
    setInterval(atualizarConsoleAoVivo, 10000);
    iniciarMultiplayerTwin();
    iniciarJoystickMinecraft();
    updateTwinFpsHintText(false);
});

function iniciarJoystickMinecraft() {
    const joy = document.getElementById('twinJoystick');
    const knob = document.getElementById('twinJoystickKnob');
    if (!joy || !knob) return;
    let activePointerId = null;
    let startX = 0, startY = 0;
    const maxR = 52;

    function updateJoy(clientX, clientY) {
        let dx = clientX - startX;
        let dy = clientY - startY;
        const dist = Math.hypot(dx, dy);
        if (dist < 6) {
            knob.style.transform = 'translate(0px, 0px)';
            if (window.setTwinJoystick) window.setTwinJoystick(0, 0);
            return;
        }
        if (dist > maxR) {
            dx = (dx / dist) * maxR;
            dy = (dy / dist) * maxR;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        if (window.setTwinJoystick) {
            window.setTwinJoystick(dx / maxR, -dy / maxR);
        }
    }

    function resetJoy() {
        activePointerId = null;
        knob.style.transform = 'translate(0px, 0px)';
        if (window.setTwinJoystick) window.setTwinJoystick(0, 0);
    }

    joy.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activePointerId !== null) return;
        activePointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        try { joy.setPointerCapture(e.pointerId); } catch (err) {}
        knob.style.transform = 'translate(0px, 0px)';
        if (window.setTwinJoystick) window.setTwinJoystick(0, 0);
    });
    joy.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activePointerId) return;
        e.preventDefault();
        e.stopPropagation();
        updateJoy(e.clientX, e.clientY);
    });
    joy.addEventListener('pointerup', (e) => {
        if (e.pointerId !== activePointerId) return;
        e.stopPropagation();
        resetJoy();
    });
    joy.addEventListener('pointercancel', (e) => {
        if (e.pointerId === activePointerId) resetJoy();
    });
}

function iniciarMultiplayerTwin() {
    let mpId = sessionStorage.getItem('twin_mp_id');
    if (!mpId) {
        mpId = 'mp_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('twin_mp_id', mpId);
    }
    const bodyColors = [0x38bdf8, 0x34d399, 0xfbbf24, 0xa78bfa, 0xf472b6, 0x22d3ee];
    const hatColors = [0xe11d48, 0xd97706, 0x7c3aed, 0x0284c7, 0x059669, 0xdb2777];
    let mpMeta = null;
    try { mpMeta = JSON.parse(sessionStorage.getItem('twin_mp_meta') || 'null'); } catch (e) {}
    if (!mpMeta) {
        const idx = Math.floor(Math.random() * bodyColors.length);
        const hIdx = Math.floor(Math.random() * hatColors.length);
        mpMeta = {
            name: 'Cogumelo #' + Math.floor(10 + Math.random() * 89),
            color: bodyColors[idx],
            hatColor: hatColors[hIdx]
        };
        sessionStorage.setItem('twin_mp_meta', JSON.stringify(mpMeta));
    }

    let mpBusy = false;
    let lastSent = 0;
    let mpOnlineCount = 1;
    let lastWorldResetSeq = null;

    async function syncMp(force) {
        if (mpBusy || !window.getTwinPlayerPose) return;
        const pose = window.getTwinPlayerPose();
        const now = Date.now();
        const interval = (mpOnlineCount > 1 || pose.inFps || pose.droppedItems)
            ? (pose.walking ? 120 : 180)
            : 1600;
        if (!force && (now - lastSent) < interval) return;
        lastSent = now;
        mpBusy = true;
        try {
            const res = await fetch('api/multiplayer.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync',
                    id: mpId,
                    name: mpMeta.name,
                    color: mpMeta.color,
                    hatColor: mpMeta.hatColor,
                    x: pose.x,
                    y: pose.y,
                    z: pose.z,
                    yaw: pose.yaw,
                    pitch: pose.pitch || 0,
                    holdingRock: typeof pose.holdingRock === 'number' ? pose.holdingRock : -1,
                    droppedItems: pose.droppedItems || null,
                    walking: pose.walking,
                    inFps: pose.inFps
                })
            });
            const data = await res.json();
            if (data && data.ok) {
                if (typeof data.resetSeq === 'number') {
                    if (lastWorldResetSeq !== null && data.resetSeq > lastWorldResetSeq && window.resetTwinWorldObjects) {
                        window.resetTwinWorldObjects();
                    }
                    lastWorldResetSeq = data.resetSeq;
                }
                if (pose.droppedItems && window.consumeTwinDroppedRock) {
                    window.consumeTwinDroppedRock();
                }
                mpOnlineCount = Math.max(1, data.online || 1);
                if (window.updateMultiplayerPlayers) {
                    window.updateMultiplayerPlayers(data.players || [], data.rocks || null);
                }
                const badge = document.getElementById('twinOnlineBadge');
                if (badge) {
                    badge.textContent = `👥 ${mpOnlineCount} online`;
                }
            }
        } catch (e) { /* silencioso se offline */ }
        mpBusy = false;
    }

    syncMp(true);
    setInterval(() => syncMp(false), 120);

    window.resetarObjetosMundoUI = async function () {
        if (window.resetTwinWorldObjects) window.resetTwinWorldObjects();
        try {
            const res = await fetch('api/multiplayer.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reset_world', id: mpId })
            });
            const data = await res.json();
            if (data && data.ok && typeof data.resetSeq === 'number') {
                lastWorldResetSeq = data.resetSeq;
            }
        } catch (e) {}
    };

    function sairMp() {
        const payload = JSON.stringify({ action: 'leave', id: mpId });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('api/multiplayer.php', payload);
        }
    }
    window.addEventListener('pagehide', sairMp);
    window.addEventListener('beforeunload', sairMp);
}

function trocarAbaLab(aba) {
    const mapa = {
        twin: ['secLabTwin', 'tabLabTwin'],
        seguranca: ['secLabSeguranca', 'tabLabSeguranca'],
        analytics: ['secLabAnalytics', 'tabLabAnalytics']
    };
    Object.keys(mapa).forEach(k => {
        const sec = document.getElementById(mapa[k][0]);
        const btn = document.getElementById(mapa[k][1]);
        if (k === aba) {
            if (sec) sec.classList.remove('hidden');
            if (btn) btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0 transition';
        } else {
            if (sec) sec.classList.add('hidden');
            if (btn) btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-900/60 border border-slate-800 shrink-0 transition';
        }
    });
}

async function carregarLab(dias) {
    diasAtivos = dias;
    document.querySelectorAll('.btn-periodo').forEach(b => {
        const d = parseInt(b.getAttribute('data-dias'), 10);
        b.className = (d === dias)
            ? 'btn-periodo px-2.5 py-1 rounded-lg transition bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            : 'btn-periodo px-2.5 py-1 rounded-lg transition text-slate-400 hover:text-white';
    });

    try {
        const [resAn, resFw] = await Promise.all([
            fetch(`api/analytics.php?dias=${dias}&_=${Date.now()}`, { cache: 'no-store' }),
            fetch(`api/fw.php?check=1&_=${Date.now()}`, { cache: 'no-store' })
        ]);
        labData = await resAn.json();
        fwDataLab = await resFw.json();

        if (!labData || labData.status !== 'ok') return;

        renderResumo();
        renderAnomalias();
        renderDiario();
        renderScatter();
        renderPerfilHorario();
        prepararTwin();
        renderSeguranca360();
    } catch (e) {
        console.error('Erro ao carregar Lab:', e);
        const sub = document.getElementById('labSubtitulo');
        if (sub) sub.textContent = 'Erro ao carregar dados do servidor.';
    }
}

function renderResumo() {
    const r = labData.resumo || {};
    const tot = parseInt(r.total_registros || 0, 10);
    const tInt = r.media_temp_int ? parseFloat(r.media_temp_int).toFixed(1) : '--';
    const tExt = r.media_temp_ext ? parseFloat(r.media_temp_ext).toFixed(1) : '--';
    const tMin = r.min_temp_int ? parseFloat(r.min_temp_int).toFixed(1) : '--';
    const tMax = r.max_temp_int ? parseFloat(r.max_temp_int).toFixed(1) : '--';
    const hMed = r.media_hum_int ? parseFloat(r.media_hum_int).toFixed(1) : '--';
    const pct95 = tot > 0 ? ((parseInt(r.reg_hum_95 || 0, 10) / tot) * 100).toFixed(1) : '0.0';

    const hAr = (parseInt(r.min_ar || 0, 10) / 60).toFixed(1);
    const hEx = (parseInt(r.min_exaust || 0, 10) / 60).toFixed(1);
    const hUm = (parseInt(r.min_umid || 0, 10) / 60).toFixed(1);

    document.getElementById('labSubtitulo').textContent = `Janela de ${diasAtivos} dias • ${tot.toLocaleString('pt-BR')} registros analisados`;
    document.getElementById('kpiTempMed').textContent = `${tInt}°C / ${tExt}°C`;
    document.getElementById('kpiTempRange').textContent = `Estufa Mín ${tMin}°C • Máx ${tMax}°C`;
    document.getElementById('kpiHumMed').textContent = `${hMed}%`;
    document.getElementById('kpiSaudeBio').textContent = `${pct95}% do tempo com UR ≥ 95%`;
    document.getElementById('kpiHorasUso').textContent = `${hAr}h / ${hEx}h / ${hUm}h`;
    document.getElementById('kpiRegistros').textContent = `${tot.toLocaleString('pt-BR')} minutos registrados`;
    recalcularCusto();
}

function recalcularCusto() {
    if (!labData || !labData.resumo) return;
    const r = labData.resumo;
    const wattsAc = parseFloat(document.getElementById('cfgWattsAc')?.value || 900);
    const tarifa = parseFloat(document.getElementById('cfgTarifaKwh')?.value || 0.95);
    const kwhAc = (parseInt(r.min_ar || 0, 10) / 60) * (wattsAc / 1000);
    const kwhOutros = ((parseInt(r.min_umid || 0, 10) / 60) * 0.035) +
                      ((parseInt(r.min_luz || 0, 10) / 60) * 0.025) +
                      ((parseInt(r.min_exaust || 0, 10) / 60) * 0.020);
    const kwhTot = kwhAc + kwhOutros;
    const custo = kwhTot * tarifa;
    document.getElementById('kpiCusto').textContent = `R$ ${custo.toFixed(2)} (${kwhTot.toFixed(1)} kWh)`;
}

let anomFiltro = 'todas';

function getAnalyticsPrefs() {
    try {
        const raw = localStorage.getItem('labAnalyticsPrefs');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { zMin: 23.0, zMax: 27.0, showZona: true, showIgual: true };
}

function carregarPrefsAnalytics() {
    const p = getAnalyticsPrefs();
    const elMin = document.getElementById('cfgZonaMin');
    const elMax = document.getElementById('cfgZonaMax');
    const elZ = document.getElementById('chkZonaIdeal');
    const elI = document.getElementById('chkLinhaIgual');
    if (elMin) elMin.value = p.zMin;
    if (elMax) elMax.value = p.zMax;
    if (elZ) elZ.checked = !!p.showZona;
    if (elI) elI.checked = !!p.showIgual;
}

function salvarPrefsAnalytics() {
    const zMin = parseFloat(document.getElementById('cfgZonaMin')?.value || 23.0);
    const zMax = parseFloat(document.getElementById('cfgZonaMax')?.value || 27.0);
    const showZona = !!document.getElementById('chkZonaIdeal')?.checked;
    const showIgual = !!document.getElementById('chkLinhaIgual')?.checked;
    try { localStorage.setItem('labAnalyticsPrefs', JSON.stringify({ zMin, zMax, showZona, showIgual })); } catch (e) {}
    if (labData) { renderDiario(); renderScatter(); renderPerfilHorario(); }
}

function setFiltroAnom(f) {
    anomFiltro = f;
    document.querySelectorAll('.btn-afilt').forEach(b => {
        const active = b.getAttribute('data-afilt') === f;
        b.className = active
            ? 'btn-afilt px-2.5 py-1 rounded-lg bg-slate-800 text-white border border-slate-600 text-[11px] font-bold'
            : 'btn-afilt px-2.5 py-1 rounded-lg bg-slate-950 text-slate-400 border border-slate-800 text-[11px] font-bold';
    });
    if (labData) renderAnomalias();
}

function exportarCsvLab() {
    if (!labData || !labData.diario || !labData.diario.length) return;
    const header = 'dia,temp_int_med,temp_ext_med,min_ar,min_umid,min_exaust\n';
    const rows = labData.diario.map(d =>
        `${d.dia},${d.temp_int_med ?? ''},${d.temp_ext_med ?? ''},${d.min_ar ?? 0},${d.min_umid ?? 0},${d.min_exaust ?? 0}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grow-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

const idealZonePlugin = {
    id: 'idealZoneBand',
    beforeDatasetsDraw(chart) {
        const p = getAnalyticsPrefs();
        if (!p.showZona || !chart.scales || !chart.scales.y) return;
        const { ctx, chartArea, scales: { y } } = chart;
        if (!chartArea) return;
        const yTop = Math.max(chartArea.top, y.getPixelForValue(p.zMax));
        const yBot = Math.min(chartArea.bottom, y.getPixelForValue(p.zMin));
        if (yBot <= yTop) return;
        ctx.save();
        ctx.fillStyle = 'rgba(16, 185, 129, 0.10)';
        ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBot - yTop);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yTop); ctx.lineTo(chartArea.right, yTop);
        ctx.moveTo(chartArea.left, yBot); ctx.lineTo(chartArea.right, yBot);
        ctx.stroke();
        ctx.restore();
    }
};

function renderAnomalias() {
    const an = labData.anomalias || { total_72h: 0, criticas_72h: 0, itens: [] };
    const badge = document.getElementById('anomBadgeTotal');
    const lista = document.getElementById('labAnomaliasLista');
    if (!badge || !lista) return;

    const tot = parseInt(an.total_72h || 0, 10);
    const crit = parseInt(an.criticas_72h || 0, 10);
    if (tot === 0) {
        badge.textContent = '✅ 0 anomalias';
        badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
        lista.innerHTML = '<div class="md:col-span-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-emerald-300 font-semibold">✅ Nenhuma anomalia térmica, de umidade, de compressor ou de conexão nas últimas 72h!</div>';
        return;
    }

    badge.textContent = `${tot} anomalias (${crit} críticas)`;
    badge.className = crit > 0
        ? 'text-xs font-bold px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40'
        : 'text-xs font-bold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40';

    const filtrados = (an.itens || []).filter(a => anomFiltro === 'todas' || a.severidade === anomFiltro);
    lista.innerHTML = filtrados.length === 0
        ? '<div class="md:col-span-2 text-slate-400 p-3">Nenhuma anomalia neste filtro.</div>'
        : filtrados.map(a => {
            const isCrit = a.severidade === 'critico';
            const border = isCrit ? 'border-rose-500/35 bg-rose-500/5' : 'border-amber-500/30 bg-amber-500/5';
            const tagCor = isCrit ? 'text-rose-300' : 'text-amber-300';
            const icone = isCrit ? '🚨' : '⚠️';
            return `
                <div class="rounded-xl border ${border} p-3 flex flex-col gap-1">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-bold ${tagCor}">${icone} ${a.titulo}</span>
                        <span class="text-[10px] font-mono text-slate-400 shrink-0">${a.hora}</span>
                    </div>
                    <p class="text-[11px] text-slate-300">${a.detalhe}</p>
                </div>`;
        }).join('');
}

const zoomOptsLab = (mode = 'x') => ({
    pan: { enabled: true, mode },
    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode }
});

function resetZoomLab(qual) {
    if (qual === 'diario' && chartDiario && chartDiario.resetZoom) chartDiario.resetZoom();
    if (qual === 'scatter' && chartScatter && chartScatter.resetZoom) chartScatter.resetZoom();
    if (qual === 'horario' && chartHorario && chartHorario.resetZoom) chartHorario.resetZoom();
}

function renderDiario() {
    const rows = labData.diario || [];
    const labels = rows.map(d => d.dia.slice(5).split('-').reverse().join('/'));
    const tInt = rows.map(d => parseFloat(d.temp_int_med));
    const tExt = rows.map(d => d.temp_ext_med !== null ? parseFloat(d.temp_ext_med) : null);
    const hAr = rows.map(d => parseFloat((parseInt(d.min_ar || 0, 10) / 60).toFixed(2)));

    const ctx = document.getElementById('chartLabDiario');
    if (!ctx) return;
    if (chartDiario) chartDiario.destroy();
    chartDiario = new Chart(ctx, {
        type: 'bar',
        plugins: [idealZonePlugin],
        data: {
            labels,
            datasets: [
                { type: 'line', label: 'Estufa (°C)', data: tInt, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)', tension: 0.3, yAxisID: 'y', pointRadius: 2 },
                { type: 'line', label: 'Quarto (°C)', data: tExt, borderColor: '#38bdf8', borderDash: [4, 4], tension: 0.3, yAxisID: 'y', pointRadius: 2 },
                { type: 'bar', label: 'AC Ligado (h/dia)', data: hAr, backgroundColor: 'rgba(56,189,248,0.28)', borderColor: 'rgba(56,189,248,0.6)', borderWidth: 1, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }, zoom: zoomOptsLab('x') },
            scales: {
                x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y: { position: 'left', ticks: { color: '#34d399', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y1: { position: 'right', beginAtZero: true, ticks: { color: '#38bdf8', font: { size: 10 } }, grid: { drawOnChartArea: false } }
            }
        }
    });
}

function renderScatter() {
    const pts = labData.scatter || [];
    const luzOn = [];
    const luzOff = [];
    pts.forEach(p => {
        const pt = { x: parseFloat(p.temp_ext), y: parseFloat(p.temp_int) };
        if (parseInt(p.luz_on, 10) === 1) luzOn.push(pt);
        else luzOff.push(pt);
    });

    const prefs = getAnalyticsPrefs();
    const datasets = [
        { label: 'Luz ON', data: luzOn, backgroundColor: 'rgba(251,191,36,0.65)', pointRadius: 3 },
        { label: 'Luz OFF', data: luzOff, backgroundColor: 'rgba(56,189,248,0.55)', pointRadius: 3 }
    ];
    if (prefs.showIgual && pts.length > 0) {
        const allVals = pts.map(p => parseFloat(p.temp_ext)).filter(v => !isNaN(v));
        const minV = Math.floor(Math.min(...allVals, 20));
        const maxV = Math.ceil(Math.max(...allVals, 32));
        datasets.push({
            type: 'line',
            label: 'Estufa = Quarto',
            data: [{ x: minV, y: minV }, { x: maxV, y: maxV }],
            borderColor: 'rgba(148,163,184,0.45)',
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0
        });
    }

    const ctx = document.getElementById('chartLabScatter');
    if (!ctx) return;
    if (chartScatter) chartScatter.destroy();
    chartScatter = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }, zoom: zoomOptsLab('xy') },
            scales: {
                x: { title: { display: true, text: 'Quarto (°C)', color: '#94a3b8', font: { size: 11 } }, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y: { title: { display: true, text: 'Estufa (°C)', color: '#94a3b8', font: { size: 11 } }, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } }
            }
        }
    });
}

function renderPerfilHorario() {
    const hm = labData.heatmap || [];
    const soma = Array.from({ length: 24 }, () => ({ tInt: 0, tExt: 0, ar: 0, n: 0, nExt: 0 }));
    hm.forEach(c => {
        const h = parseInt(c.hora, 10);
        if (h >= 0 && h < 24) {
            soma[h].tInt += parseFloat(c.temp_int_med || 0);
            if (c.temp_ext_med !== null) {
                soma[h].tExt += parseFloat(c.temp_ext_med);
                soma[h].nExt++;
            }
            soma[h].ar += parseFloat(c.pct_ar || 0);
            soma[h].n++;
        }
    });

    const labels = soma.map((_, h) => `${String(h).padStart(2, '0')}h`);
    const medInt = soma.map(s => s.n ? Number((s.tInt / s.n).toFixed(2)) : null);
    const medExt = soma.map(s => s.nExt ? Number((s.tExt / s.nExt).toFixed(2)) : null);
    const medAr = soma.map(s => s.n ? Number((s.ar / s.n).toFixed(1)) : 0);

    const ctx = document.getElementById('chartLabHorario');
    if (!ctx) return;
    if (chartHorario) chartHorario.destroy();
    chartHorario = new Chart(ctx, {
        type: 'bar',
        plugins: [idealZonePlugin],
        data: {
            labels,
            datasets: [
                { type: 'line', label: 'Estufa (°C)', data: medInt, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', tension: 0.35, yAxisID: 'y', pointRadius: 2.5 },
                { type: 'line', label: 'Quarto (°C)', data: medExt, borderColor: '#fbbf24', borderDash: [4, 4], tension: 0.35, yAxisID: 'y', pointRadius: 2 },
                { type: 'bar', label: 'AC Ligado (%)', data: medAr, backgroundColor: 'rgba(56,189,248,0.28)', borderColor: 'rgba(56,189,248,0.65)', borderWidth: 1, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }, zoom: zoomOptsLab('x') },
            scales: {
                x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y: { position: 'left', ticks: { color: '#34d399', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y1: { position: 'right', beginAtZero: true, max: 100, ticks: { color: '#38bdf8', font: { size: 10 }, callback: v => `${v}%` }, grid: { drawOnChartArea: false } }
            }
        }
    });
}

// ========================================================
// GÊMEO DIGITAL 3D (AO VIVO / TIME-LAPSE / TESTE VISUAL)
// ========================================================
function setTwinModo(modo) {
    twinModo = modo;
    const clsAtivo = 'px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 transition';
    const clsLive = 'px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 transition';
    const clsSim = 'px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 transition';
    const clsOff = 'px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition';

    document.getElementById('btnModoLive').className = modo === 'live' ? clsLive : clsOff;
    document.getElementById('btnModoTimelapse').className = modo === 'timelapse' ? clsAtivo : clsOff;
    document.getElementById('btnModoSimular').className = modo === 'simular' ? clsSim : clsOff;

    document.getElementById('twinControlesTimelapse').classList.toggle('hidden', modo !== 'timelapse');
    document.getElementById('twinSliderWrap').classList.toggle('hidden', modo !== 'timelapse');
    document.getElementById('twinPainelSimular').classList.toggle('hidden', modo !== 'simular');

    const badge = document.getElementById('twinModoBadge');
    if (modo === 'live') {
        badge.textContent = '● AO VIVO';
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40';
    } else if (modo === 'timelapse') {
        badge.textContent = '⏪ TIME-LAPSE 24H';
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    } else {
        badge.textContent = '🧪 SIMULAÇÃO 3D';
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40';
    }

    reiniciarTimerTwin();
    atualizarHudTwin();
}

function toggleSimRele(k) {
    simReles[k] = !simReles[k];
    document.querySelectorAll('.btn-sim-rele').forEach(b => {
        const key = b.getAttribute('data-sim');
        b.className = simReles[key]
            ? 'btn-sim-rele px-2.5 py-1 rounded-lg bg-purple-500/25 text-purple-200 border border-purple-400/50'
            : 'btn-sim-rele px-2.5 py-1 rounded-lg bg-slate-900 text-slate-400 border border-slate-700';
    });
    if (twinModo !== 'simular') setTwinModo('simular');
    else atualizarHudTwin();
}

let twinFpsAtivo = false;
let twinFpsHudTimer = null;
let twinFpsHudHideTimer = null;

function showTwinFpsHudTemporarily() {
    const hud = document.getElementById('twinFpsHud');
    if (!hud) return;
    if (twinFpsHudTimer) clearTimeout(twinFpsHudTimer);
    if (twinFpsHudHideTimer) clearTimeout(twinFpsHudHideTimer);
    if (!twinFpsAtivo) {
        hud.classList.add('hidden');
        hud.style.opacity = '0';
        return;
    }
    hud.classList.remove('hidden');
    hud.style.pointerEvents = 'auto';
    requestAnimationFrame(() => { hud.style.opacity = '1'; });
    twinFpsHudTimer = setTimeout(() => {
        hud.style.opacity = '0';
        hud.style.pointerEvents = 'none';
        twinFpsHudHideTimer = setTimeout(() => {
            if (hud.style.opacity === '0') hud.classList.add('hidden');
        }, 620);
    }, 4000);
}

function isMobileTouch() {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
        || (navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
}

function updateTwinFpsHintText(locked) {
    const hint = document.getElementById('twinFpsHint');
    if (!hint) return;
    if (isMobileTouch()) {
        hint.textContent = '🕹️ Esq: andar • Tela: olhar • Toque: pegar';
    } else if (locked) {
        hint.textContent = '🎯 Mouse travado • WASD andar • ESC libera / F sai';
    } else {
        hint.textContent = 'Clique na cena p/ travar mouse • WASD • Shift correr • Espaço pular • F sair';
    }
}

function toggleTwinFpsUI() {
    twinFpsAtivo = !twinFpsAtivo;
    if (window.setTwinFpsMode) window.setTwinFpsMode(twinFpsAtivo);
    const btn = document.getElementById('btnTwinFps');
    const joy = document.getElementById('twinJoystick');
    const jumpBtn = document.getElementById('btnTwinJump');
    const hud = document.getElementById('twinFpsHud');
    const cross = document.getElementById('twinFpsCrosshair');
    const mobile = isMobileTouch();
    if (btn) {
        btn.textContent = twinFpsAtivo ? (mobile ? '🚶 Sair FPS' : '🚶 Sair FPS (F)') : '🚶 Modo FPS';
        btn.className = twinFpsAtivo
            ? 'px-2.5 py-1 rounded-lg bg-cyan-500/25 border border-cyan-400/60 text-[10px] font-bold text-cyan-200 shrink-0'
            : 'px-2.5 py-1 rounded-lg bg-slate-950/85 hover:bg-slate-800 border border-cyan-500/40 text-[10px] font-bold text-cyan-300 shrink-0';
    }
    if (joy) joy.style.display = (twinFpsAtivo && mobile) ? 'flex' : 'none';
    if (jumpBtn) jumpBtn.style.display = (twinFpsAtivo && mobile) ? 'flex' : 'none';
    if (cross) cross.classList.toggle('hidden', !twinFpsAtivo);
    if (!twinFpsAtivo) {
        const dp = document.getElementById('twinDoorPrompt');
        if (dp) dp.classList.add('hidden');
    }
    updateTwinFpsHintText(false);
    showTwinFpsHudTemporarily();
}

window.onTwinDoorHint = function (near, isOpen) {
    const dp = document.getElementById('twinDoorPrompt');
    if (!dp) return;
    dp.classList.toggle('hidden', !near);
    if (near) {
        dp.textContent = isMobileTouch()
            ? (isOpen ? '🚪 Toque na porta p/ Fechar' : '🚪 Toque na porta p/ Abrir')
            : (isOpen ? '🚪 Fechar Porta (E)' : '🚪 Abrir Porta (E)');
    }
};

window.onTwinPointerLockChange = function (locked) {
    updateTwinFpsHintText(locked);
    if (twinFpsAtivo) showTwinFpsHudTemporarily();
};

document.addEventListener('keydown', (e) => {
    if (e.key && e.key.toLowerCase() === 'f' && twinFpsAtivo && !['INPUT', 'TEXTAREA'].includes((e.target && e.target.tagName) || '')) {
        e.preventDefault();
        toggleTwinFpsUI();
    }
});

function desativarFpsSetPreset(preset) {
    if (twinFpsAtivo) toggleTwinFpsUI();
    if (window.setTwinCameraPreset) window.setTwinCameraPreset(preset);
}

function toggleAutoRotUI() {
    if (!window.toggleTwinAutoRotate) return;
    const on = window.toggleTwinAutoRotate();
    const btn = document.getElementById('btnTwinAutoRot');
    if (btn) {
        btn.className = on
            ? 'px-2 py-1 rounded-lg bg-emerald-500/25 border border-emerald-400/50 text-[10px] font-bold text-emerald-200'
            : 'px-2 py-1 rounded-lg bg-slate-950/85 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300';
    }
}

let twinCssFullscreen = false;

function getNativeFullscreenEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function syncTwinFullscreenUI() {
    const card = document.getElementById('twinCanvasCard');
    const cont = document.getElementById('twin3dContainer');
    const btn = document.getElementById('btnTwinFullscreen');
    const ativo = !!getNativeFullscreenEl() || twinCssFullscreen;

    if (card) {
        card.classList.toggle('twin-fullscreen-active', ativo);
    }
    if (cont) {
        cont.classList.toggle('h-[360px]', !ativo);
        cont.classList.toggle('sm:h-[460px]', !ativo);
    }
    document.body.style.overflow = ativo ? 'hidden' : '';
    if (btn) {
        btn.textContent = ativo ? '🗗 Sair' : '⛶ Tela Cheia';
        btn.className = ativo
            ? 'px-2.5 py-1 rounded-lg bg-emerald-500/25 border border-emerald-400/60 text-[10px] font-bold text-emerald-200 shrink-0'
            : 'px-2.5 py-1 rounded-lg bg-slate-950/85 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-200 shrink-0';
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
}

async function toggleTwinFullscreen() {
    const card = document.getElementById('twinCanvasCard');
    if (!card) return;
    if (getNativeFullscreenEl()) {
        const exitFn = document.exitFullscreen || document.webkitExitFullscreen;
        if (exitFn) await exitFn.call(document).catch(() => {});
        if (screen.orientation && screen.orientation.unlock) {
            try { screen.orientation.unlock(); } catch (e) {}
        }
        twinCssFullscreen = false;
        syncTwinFullscreenUI();
        return;
    }
    if (twinCssFullscreen) {
        if (screen.orientation && screen.orientation.unlock) {
            try { screen.orientation.unlock(); } catch (e) {}
        }
        twinCssFullscreen = false;
        syncTwinFullscreenUI();
        return;
    }
    const reqFn = card.requestFullscreen || card.webkitRequestFullscreen;
    if (reqFn) {
        try {
            await reqFn.call(card);
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(() => {});
            }
            syncTwinFullscreenUI();
            return;
        } catch (e) { /* iPhone Safari / WebView usa fallback CSS 100dvh */ }
    }
    twinCssFullscreen = true;
    syncTwinFullscreenUI();
}

document.addEventListener('fullscreenchange', () => {
    if (!getNativeFullscreenEl()) twinCssFullscreen = false;
    syncTwinFullscreenUI();
});
document.addEventListener('webkitfullscreenchange', () => {
    if (!getNativeFullscreenEl()) twinCssFullscreen = false;
    syncTwinFullscreenUI();
});
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        if (twinCssFullscreen || getNativeFullscreenEl()) syncTwinFullscreenUI();
    }, 150);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && twinCssFullscreen && !document.fullscreenElement) {
        twinCssFullscreen = false;
        syncTwinFullscreenUI();
    }
});

let twinEquipSelecionado = null;
let lastTwinFrameState = { ti: 26.5, te: 25.5, hi: 95, vpd: 0.15, luz: false, umid: false, vento: false, exaust: false, ar: false };

function toggleTwinStreamlinesUI() {
    if (!window.toggleTwinStreamlines) return;
    const on = window.toggleTwinStreamlines();
    const btn = document.getElementById('btnTwinFluxo');
    if (btn) {
        btn.className = on
            ? 'px-2 py-1 rounded-lg bg-cyan-500/25 border border-cyan-400/60 text-[10px] font-bold text-cyan-200'
            : 'px-2 py-1 rounded-lg bg-slate-950/85 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300';
    }
}

const TWIN_EQUIP_INFO = {
    ar: {
        titulo: '❄️ Ar-Condicionado Split',
        rele: 'ar',
        desc: 'Puxa o ar do quarto pela grade superior, resfria na serpentina e sopra pela aleta.'
    },
    esp32: {
        titulo: '🧠 ESP32-C3 + Relés',
        rele: null,
        desc: 'Controlador central com heartbeat azul e 5 LEDs em tempo real para cada relé.'
    },
    umid: {
        titulo: '💧 Umidificador Ultrassônico',
        rele: 'umid',
        desc: 'Injeta névoa fria pela mangueira amarela no topo da estufa.'
    },
    exaust: {
        titulo: '🌪️ Exaustor Superior',
        rele: 'exaust',
        desc: 'Empurra ar do quarto para dentro da estufa (Sifão Pós-AC e FAE), saindo pelo duto inferior.'
    },
    vento: {
        titulo: '🌀 Ventilador Interno',
        rele: 'vento',
        desc: 'Homogeneíza temperatura, CO₂ e umidade entre as duas estantes.'
    },
    luz: {
        titulo: '💡 Barra LED Grow',
        rele: 'luz',
        desc: 'Fotoperíodo para pinagem e orientação dos cogumelos.'
    },
    cogumelos: {
        titulo: '🍄 Bandejas & Cogumelos',
        rele: null,
        desc: 'Bolos de substrato em flushes contínuos reagindo ao microclima da estufa.'
    }
};

function renderTwinEquipCard() {
    const card = document.getElementById('twinEquipCard');
    if (!card || !twinEquipSelecionado) return;
    const info = TWIN_EQUIP_INFO[twinEquipSelecionado];
    if (!info) return;

    document.getElementById('twinEquipTitulo').textContent = info.titulo;
    document.getElementById('twinEquipDesc').textContent = info.desc;

    const stEl = document.getElementById('twinEquipStatus');
    const btnEl = document.getElementById('twinEquipBtn');
    const s = lastTwinFrameState;

    if (info.rele) {
        const ligado = !!s[info.rele];
        stEl.textContent = ligado ? '● LIGADO AGORA' : '○ DESLIGADO';
        stEl.className = ligado ? 'text-[11px] font-bold text-emerald-400' : 'text-[11px] font-bold text-slate-400';
        btnEl.classList.remove('hidden');
        btnEl.textContent = ligado ? '🧪 Desligar no Teste 3D' : '🧪 Ligar no Teste 3D';
    } else if (twinEquipSelecionado === 'esp32') {
        const ativos = [s.luz && 'Luz', s.umid && 'Umid', s.vento && 'Vento', s.exaust && 'Exaust', s.ar && 'AC'].filter(Boolean);
        stEl.textContent = ativos.length ? `Relés ativos: ${ativos.join(', ')}` : 'Todos os relés em espera';
        stEl.className = 'text-[11px] font-bold text-cyan-300';
        btnEl.classList.add('hidden');
    } else {
        stEl.textContent = `Estufa ${s.ti.toFixed(1)}°C • UR ${s.hi.toFixed(0)}% • VPD ${s.vpd.toFixed(2)} kPa`;
        stEl.className = 'text-[11px] font-bold text-amber-300';
        btnEl.classList.add('hidden');
    }
    card.classList.remove('hidden');
}

window.onTwinEquipSelect = function (equipId) {
    twinEquipSelecionado = equipId;
    renderTwinEquipCard();
};

function fecharTwinEquipCard() {
    twinEquipSelecionado = null;
    const card = document.getElementById('twinEquipCard');
    if (card) card.classList.add('hidden');
}

function toggleEquipFromCard() {
    const info = TWIN_EQUIP_INFO[twinEquipSelecionado];
    if (!info || !info.rele) return;
    if (twinModo !== 'simular') {
        simReles.luz = lastTwinFrameState.luz;
        simReles.umid = lastTwinFrameState.umid;
        simReles.vento = lastTwinFrameState.vento;
        simReles.exaust = lastTwinFrameState.exaust;
        simReles.ar = lastTwinFrameState.ar;
    }
    toggleSimRele(info.rele);
    renderTwinEquipCard();
}

function prepararTwin() {
    twinFrames = labData.timelapse || [];
    twinIdx = Math.max(0, twinFrames.length - 1);
    const slider = document.getElementById('twinSlider');
    if (slider) {
        slider.max = Math.max(0, twinFrames.length - 1);
        slider.value = twinIdx;
    }
    if (twinFrames.length > 0) {
        document.getElementById('twinInicioLbl').textContent = twinFrames[0].slot.slice(11, 16);
        document.getElementById('twinFimLbl').textContent = twinFrames[twinFrames.length - 1].slot.slice(11, 16);
    }
    atualizarHudTwin();
    reiniciarTimerTwin();
}

function toggleTwinPlay() {
    twinPlaying = !twinPlaying;
    const btn = document.getElementById('btnTwinPlay');
    if (btn) btn.textContent = twinPlaying ? '⏸️ Pausar' : '▶️ Play';
    reiniciarTimerTwin();
}

function setTwinVelocidade(v) {
    twinVelMs = parseInt(v, 10) || 150;
    reiniciarTimerTwin();
}

function irParaFrameTwin(idx) {
    twinIdx = Math.max(0, Math.min(twinFrames.length - 1, parseInt(idx, 10) || 0));
    atualizarHudTwin();
}

function reiniciarTimerTwin() {
    if (twinTimer) clearInterval(twinTimer);
    if (twinModo !== 'timelapse' || !twinPlaying || twinFrames.length < 2) return;
    twinTimer = setInterval(() => {
        twinIdx = (twinIdx + 1) % twinFrames.length;
        const sl = document.getElementById('twinSlider');
        if (sl) sl.value = twinIdx;
        atualizarHudTwin();
    }, twinVelMs);
}

function atualizarHudTwin() {
    let f = null;
    if (twinModo === 'live') {
        f = liveTelemetryRow || (twinFrames.length ? twinFrames[twinFrames.length - 1] : null);
    } else if (twinModo === 'timelapse') {
        f = twinFrames[twinIdx];
    } else {
        const base = liveTelemetryRow || (twinFrames.length ? twinFrames[twinFrames.length - 1] : { temp_int: 26.5, temp_ext: 25.5, hum_int: 97.0 });
        f = {
            slot: 'SIMULAÇÃO 3D',
            timestamp: 'SIMULAÇÃO 3D',
            temp_int: base.temp_int,
            temp_ext: base.temp_ext,
            hum_int: base.hum_int,
            rele_luz: simReles.luz ? 1 : 0,
            rele_umid: simReles.umid ? 1 : 0,
            rele_vento: simReles.vento ? 1 : 0,
            rele_exaust: simReles.exaust ? 1 : 0,
            rele_ar: simReles.ar ? 1 : 0
        };
    }
    if (!f) return;

    const ti = parseFloat(f.temp_int);
    const te = f.temp_ext !== null ? parseFloat(f.temp_ext) : NaN;
    const hi = parseFloat(f.hum_int);
    const svp = 0.61078 * Math.exp((17.27 * ti) / (ti + 237.3));
    const vpd = Math.max(0, svp * (1 - hi / 100));

    const horaTxt = twinModo === 'simular'
        ? '🧪 MODO TESTE 3D'
        : (f.timestamp ? `🔴 ${f.timestamp.slice(5, 19)}` : f.slot.slice(5, 16));
    document.getElementById('twinHudHora').textContent = horaTxt;
    document.getElementById('twinTempInt').textContent = `${ti.toFixed(1)}°C`;
    document.getElementById('twinTempExt').textContent = isNaN(te) ? '--°C' : `${te.toFixed(1)}°C`;
    document.getElementById('twinHumInt').textContent = `${hi.toFixed(1)}%`;
    document.getElementById('twinVpd').textContent = `${vpd.toFixed(2)} kPa`;

    const rLuz = parseInt(f.rele_luz || 0, 10) === 1;
    const rUmid = parseInt(f.rele_umid || 0, 10) === 1;
    const rVento = parseInt(f.rele_vento || 0, 10) === 1;
    const rExaust = parseInt(f.rele_exaust || 0, 10) === 1;
    const rAr = parseInt(f.rele_ar || 0, 10) === 1;

    lastTwinFrameState = { ti, te: isNaN(te) ? 26 : te, hi, vpd, luz: rLuz, umid: rUmid, vento: rVento, exaust: rExaust, ar: rAr };
    if (twinEquipSelecionado) renderTwinEquipCard();

    if (window.updateTwin3DState) {
        window.updateTwin3DState({
            tempInt: ti,
            tempExt: isNaN(te) ? 26 : te,
            humInt: hi,
            luz: rLuz,
            umid: rUmid,
            vento: rVento,
            exaust: rExaust,
            ar: rAr
        });
    }

    const badges = [];
    if (rAr) badges.push('<span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">❄️ AC Resfriando</span>');
    if (rExaust) badges.push('<span class="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 font-bold">🌪️ Exaustor Sugando</span>');
    if (rUmid) badges.push('<span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">💧 Névoa Ativa</span>');
    if (rVento) badges.push('<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">🌀 Vento Interno</span>');
    if (rLuz) badges.push('<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">💡 LED Ligado</span>');
    if (badges.length === 0) badges.push('<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400">Em repouso</span>');
    document.getElementById('twinBadges').innerHTML = badges.join('');
}

// ========================================================
// ABA SEGURANÇA 360°
// ========================================================
function renderSeguranca360() {
    const seg = labData.seguranca || {};
    const res = labData.resumo || {};
    const fw = fwDataLab || {};
    const cfg = seg.config_clima || {};
    const hv = cfg.hvac || {};
    const ult = seg.ultimo || {};

    let score = 100;
    const gaps72 = parseInt(seg.total_gaps_72h || 0, 10);
    const shortAc = parseInt(seg.ciclos_curtos_ac_72h || 0, 10);
    const extOff = parseInt(res.reg_ext_offline || 0, 10);
    const calorCrit = parseInt(res.reg_calor_critico || 0, 10);

    if (fw.error === '1') score -= 25;
    if (gaps72 > 3) score -= Math.min(20, gaps72 * 3);
    if (shortAc > 2) score -= Math.min(15, shortAc * 4);
    if (extOff > 10) score -= 10;
    if (calorCrit > 10) score -= 15;
    if (window.location.protocol !== 'https:') score -= 10;
    score = Math.max(0, score);

    const badge = document.getElementById('segScoreBadge');
    badge.textContent = `${score}%`;
    badge.className = score >= 85
        ? 'text-3xl font-black px-5 py-3 rounded-2xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-center shrink-0'
        : 'text-3xl font-black px-5 py-3 rounded-2xl bg-amber-500/15 text-amber-300 border border-amber-500/30 text-center shrink-0';
    document.getElementById('segScoreTitulo').textContent = score >= 85 ? 'Sistema Saudável & Protegido' : 'Atenção: Pontos de Melhoria Detectados';

    const item = (ok, label, val) => `
        <div class="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800/80 rounded-xl px-3 py-2">
            <span class="text-slate-300">${ok ? '✅' : '⚠️'} ${label}</span>
            <span class="font-bold ${ok ? 'text-emerald-300' : 'text-amber-300'}">${val}</span>
        </div>`;

    document.getElementById('segListaInfra').innerHTML = [
        item(fw.error !== '1', 'Firmware em Execução', `${fw.vFirmware || '--'} (${fw.board || 'ESP32'})`),
        item(fw.canRollback === 1, 'Slot Rollback OTA', fw.canRollback === 1 ? 'Ativo' : 'Indisponível'),
        item(window.location.protocol === 'https:', 'Conexão HTTPS', window.location.protocol === 'https:' ? 'Criptografada' : 'HTTP'),
        item(!!localStorage.getItem('grow_admin_key'), 'Chave Admin Salva', localStorage.getItem('grow_admin_key') ? 'Configurada' : 'Não salva neste navegador')
    ].join('');

    document.getElementById('segListaTravas').innerHTML = [
        item(true, 'Corte Anti-Congelamento', `${hv.tCongela ?? '--'}°C`),
        item(true, 'Corte de Luz por Calor', `${hv.tCorteLuz ?? '--'}°C`),
        item(true, 'Limite Contínuo do AC', `${hv.tMaxRun ?? '--'} min`),
        item(true, 'Guarda de Umidade Pós-AC', `${hv.uGuardaCorte ?? 88}% (Pós-AC: ${hv.tSifaoPosAc ?? 5} min)`)
    ].join('');

    const itemExpandivel = (id, ok, label, val, linhasHtml) => {
        if (ok || !linhasHtml) return item(ok, label, val);
        return `
        <div class="bg-slate-950/70 border border-slate-800/80 rounded-xl overflow-hidden">
            <button type="button" onclick="toggleDetalheSeg('${id}')" class="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-900/70 transition text-left">
                <span class="text-slate-300">⚠️ ${label}</span>
                <span class="font-bold text-amber-300 flex items-center gap-1.5">${val} <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">Ver ▾</span></span>
            </button>
            <div id="${id}" class="hidden border-t border-slate-800/80 bg-black/50 px-3 py-2 space-y-1 max-h-44 overflow-y-auto text-[11px] font-mono">
                ${linhasHtml}
            </div>
        </div>`;
    };

    const detExt = (seg.detalhes_ext_offline || []).map(d =>
        `<div class="flex justify-between gap-2 text-slate-300"><span>${(d.timestamp || '').slice(5, 16)}</span><span class="text-amber-300">Ext: ${d.temp_ext ?? 'NULL'} | Int: ${d.temp_int}°C (${d.fase})</span></div>`
    ).join('');

    const detCalor = (seg.detalhes_calor_critico || []).map(d =>
        `<div class="flex justify-between gap-2 text-slate-300"><span>${d.inicio} ➔ ${d.fim}</span><span class="text-rose-300">${d.minutos} min • Máx ${d.max_temp}°C (${d.fase})</span></div>`
    ).join('');

    const detShort = (seg.detalhes_ciclos_curtos_ac || []).map(d =>
        `<div class="flex justify-between gap-2 text-slate-300"><span>${d.inicio} ➔ ${d.fim}</span><span class="text-amber-300">${d.duracao_min} min (${d.temp_inicio}°C ➔ ${d.temp_fim}°C • ${d.fase})</span></div>`
    ).join('');

    document.getElementById('segListaHardware').innerHTML = [
        itemExpandivel('detExtOff', extOff === 0, 'Leituras Sensor Quarto Offline', `${extOff} ocorrências`, detExt),
        itemExpandivel('detCalorCrit', calorCrit === 0, 'Picos Críticos (≥ 30°C)', `${calorCrit} min no período`, detCalor),
        itemExpandivel('detShortAc', shortAc === 0, 'Ciclos Curtos AC (< 5 min / 72h)', `${shortAc} de ${seg.ciclos_ac_72h ?? 0} ciclos`, detShort),
        item(!!ult.timestamp, 'Último Heartbeat da Placa', ult.timestamp ? ult.timestamp.slice(5, 16) : '--')
    ].join('');

    const gaps = seg.ultimos_gaps || [];
    document.getElementById('segListaGaps').innerHTML = gaps.length === 0
        ? '<div class="text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 font-semibold">✅ Nenhuma queda superior a 3 minutos nas últimas 72h!</div>'
        : gaps.map(g => `<div class="flex justify-between bg-slate-950/70 border border-rose-500/20 rounded-xl px-3 py-2"><span class="text-slate-300">${g.inicio} ➔ ${g.fim}</span><span class="font-bold text-rose-300">${g.minutos} min offline</span></div>`).join('');
}

function toggleDetalheSeg(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
}

// ========================================================
// CONSOLE SERIAL MONITOR AO VIVO
// ========================================================
let consoleFiltro = 'todos';
let consoleLinhas = [];
let consolePausado = false;

function setFiltroConsole(f) {
    consoleFiltro = f;
    document.querySelectorAll('.btn-cfilt').forEach(b => {
        const ativo = b.getAttribute('data-cfilt') === f;
        b.className = ativo
            ? 'btn-cfilt px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            : 'btn-cfilt px-2.5 py-1 rounded-lg bg-slate-950 text-slate-400 border border-slate-800';
    });
    renderConsoleLab();
}

function toggleConsolePause() {
    consolePausado = !consolePausado;
    const btn = document.getElementById('btnConsolePause');
    if (btn) btn.textContent = consolePausado ? '▶️ Retomar' : '⏸️ Pausar';
}

function copiarConsoleLab() {
    const txt = consoleLinhas.map(l => `[${l.hora}] [${l.tipo.toUpperCase()}] ${l.msg}`).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(txt);
}

function baixarConsoleLog() {
    const txt = consoleLinhas.map(l => `[${l.hora}] [${l.tipo.toUpperCase()}] ${l.msg}`).join('\n');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grow-serial-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function atualizarConsoleAoVivo() {
    try {
        const res = await fetch(`api/index.php?limit=40&_=${Date.now()}`, { cache: 'no-store' });
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) return;

        liveTelemetryRow = rows[rows.length - 1];
        if (twinModo === 'live') atualizarHudTwin();

        if (consolePausado) return;

        const logs = [];
        let prev = null;
        rows.forEach(r => {
            const hora = (r.timestamp || '').slice(11, 19) || '--:--:--';
            const ti = parseFloat(r.temp_int);
            const hi = parseFloat(r.hum_int);
            const te = parseFloat(r.temp_ext);

            if (prev) {
                const mapRele = [
                    ['rele_ar', '❄️ AC'],
                    ['rele_exaust', '💨 EXAUSTOR'],
                    ['rele_umid', '💧 UMIDIFICADOR'],
                    ['rele_vento', '🌀 VENTILADOR INT'],
                    ['rele_luz', '💡 LUZ']
                ];
                mapRele.forEach(([k, nome]) => {
                    const a = parseInt(prev[k] || 0, 10);
                    const b = parseInt(r[k] || 0, 10);
                    if (a !== b) {
                        logs.push({
                            hora,
                            tipo: 'acao',
                            cor: 'text-sky-300',
                            msg: `${nome} ${b === 1 ? 'LIGADO' : 'DESLIGADO'} (Estufa: ${ti.toFixed(1)}°C | ${hi.toFixed(0)}% | Quarto: ${isNaN(te) ? '--' : te.toFixed(1)}°C)`
                        });
                    }
                });
                const dt = (Number(r.unix_ts || 0) - Number(prev.unix_ts || 0));
                if (dt > 180) {
                    logs.push({ hora, tipo: 'alerta', cor: 'text-rose-400', msg: `⚠️ GAP DE CONEXÃO: ${Math.round(dt / 60)} min sem telemetria!` });
                }
            }
            if (!isNaN(ti) && ti >= 30.0) {
                logs.push({ hora, tipo: 'alerta', cor: 'text-rose-400', msg: `🚨 ALERTA TÉRMICO: Estufa em ${ti.toFixed(1)}°C!` });
            }
            if (isNaN(te) || te <= -30.0) {
                logs.push({ hora, tipo: 'alerta', cor: 'text-amber-300', msg: `⚠️ SENSOR QUARTO OFFLINE (${r.temp_ext})` });
            }
            prev = r;
        });

        const ult = rows[rows.length - 1];
        const hUlt = (ult.timestamp || '').slice(11, 19) || '--:--:--';
        logs.push({
            hora: hUlt,
            tipo: 'info',
            cor: 'text-emerald-300',
            msg: `HEARTBEAT OK • Estufa: ${parseFloat(ult.temp_int).toFixed(1)}°C / ${parseFloat(ult.hum_int).toFixed(1)}% | Quarto: ${parseFloat(ult.temp_ext).toFixed(1)}°C | Fase: ${ult.fase || '--'}`
        });

        consoleLinhas = logs.slice(-60).reverse();
        renderConsoleLab();
    } catch (e) {
        console.error('Erro console ao vivo:', e);
    }
}

function copiarDiagnosticoLab() {
    const score = document.getElementById('segScoreBadge')?.textContent || '--';
    const titulo = document.getElementById('segScoreTitulo')?.textContent || '';
    const an = labData?.anomalias || { total_72h: 0, criticas_72h: 0 };
    const txt = `=== DIAGNÓSTICO GROW IA 360° (${new Date().toLocaleString('pt-BR')}) ===\n` +
        `Score: ${score} — ${titulo}\n` +
        `Firmware Placa: ${fwDataLab?.vFirmware || '--'} | Nuvem: ${fwDataLab?.vFirmwareNuvem || '--'}\n` +
        `Anomalias 72h: ${an.total_72h} (${an.criticas_72h} críticas)\n` +
        `Últimos eventos:\n` +
        consoleLinhas.slice(-15).map(l => `[${l.hora}] ${l.msg}`).join('\n');
    navigator.clipboard?.writeText(txt);
}

function renderConsoleLab() {
    const el = document.getElementById('labConsoleOut');
    if (!el) return;
    const q = (document.getElementById('inpConsoleBusca')?.value || '').trim().toLowerCase();
    const filtradas = consoleLinhas.filter(l => {
        if (consoleFiltro === 'acoes' && l.tipo !== 'acao') return false;
        if (consoleFiltro === 'alertas' && l.tipo !== 'alerta') return false;
        if (q && !(`${l.hora} ${l.msg}`).toLowerCase().includes(q)) return false;
        return true;
    });
    const lbl = document.getElementById('consoleCountLbl');
    if (lbl) lbl.textContent = `${filtradas.length} linhas`;
    el.innerHTML = filtradas.length === 0
        ? '<div class="text-slate-500">Nenhum evento registrado neste filtro nos últimos 40 min.</div>'
        : filtradas.map(l => `<div><span class="text-slate-500">[${l.hora}]</span> <span class="${l.cor}">${l.msg}</span></div>`).join('');
}
