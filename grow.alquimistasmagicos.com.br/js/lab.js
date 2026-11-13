// ========================================================
// LAB NERD 360° — ANALYTICS, GÊMEO 3D & SEGURANÇA
// ========================================================

let labData = null;
let fwDataLab = null;
let chartDiario = null;
let chartScatter = null;
let diasAtivos = 30;

// Estado do Gêmeo 3D & Time-Lapse
let twinFrames = [];
let twinIdx = 0;
let twinPlaying = true;
let twinVelMs = 150;
let twinTimer = null;
let twinYaw = 0.62;
let twinPitch = 0.42;
let twinDrag = false;
let twinLastX = 0;
let twinLastY = 0;
let twinParticulas = [];

document.addEventListener('DOMContentLoaded', () => {
    inicializarCanvasTwin();
    carregarLab(30);
    animarTwinLoop();
});

function trocarAbaLab(aba) {
    const mapa = {
        analytics: ['secLabAnalytics', 'tabLabAnalytics'],
        twin: ['secLabTwin', 'tabLabTwin'],
        seguranca: ['secLabSeguranca', 'tabLabSeguranca']
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
        renderDiario();
        renderScatter();
        renderHeatmap();
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
            plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
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

    const ctx = document.getElementById('chartLabScatter');
    if (!ctx) return;
    if (chartScatter) chartScatter.destroy();
    chartScatter = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Luz ON', data: luzOn, backgroundColor: 'rgba(251,191,36,0.65)', pointRadius: 3 },
                { label: 'Luz OFF', data: luzOff, backgroundColor: 'rgba(56,189,248,0.55)', pointRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
            scales: {
                x: { title: { display: true, text: 'Quarto (°C)', color: '#94a3b8', font: { size: 11 } }, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
                y: { title: { display: true, text: 'Estufa (°C)', color: '#94a3b8', font: { size: 11 } }, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } }
            }
        }
    });
}

function renderHeatmap() {
    const cont = document.getElementById('labHeatmapContainer');
    if (!cont) return;
    const diasNome = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const mapa = new Map();
    (labData.heatmap || []).forEach(h => {
        mapa.set(`${h.dow}_${h.hora}`, h);
    });

    let html = '<div class="min-w-[680px] space-y-1">';
    html += '<div class="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-1 text-[10px] text-slate-500 font-mono text-center"><div></div>';
    for (let h = 0; h < 24; h++) html += `<div>${String(h).padStart(2, '0')}</div>`;
    html += '</div>';

    for (let d = 1; d <= 7; d++) {
        html += `<div class="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-1 items-center"><div class="text-[11px] font-bold text-slate-400">${diasNome[d - 1]}</div>`;
        for (let h = 0; h < 24; h++) {
            const cell = mapa.get(`${d}_${h}`);
            if (!cell) {
                html += '<div class="h-6 rounded bg-slate-900/70 border border-slate-800/50"></div>';
                continue;
            }
            const t = parseFloat(cell.temp_int_med);
            const ar = parseFloat(cell.pct_ar || 0);
            let cls = 'bg-emerald-500/25 border-emerald-500/35 text-emerald-200';
            if (t <= 25.0) cls = 'bg-cyan-500/25 border-cyan-500/35 text-cyan-200';
            else if (t > 28.5) cls = 'bg-rose-500/35 border-rose-500/50 text-rose-100';
            else if (t > 27.5) cls = 'bg-amber-500/30 border-amber-500/45 text-amber-100';
            const title = `${diasNome[d - 1]} ${String(h).padStart(2, '0')}h • Estufa: ${t.toFixed(1)}°C | Quarto: ${cell.temp_ext_med ?? '--'}°C | AC: ${ar.toFixed(0)}%`;
            html += `<div title="${title}" class="h-6 rounded border text-[9px] font-mono flex items-center justify-center cursor-default ${cls}">${t.toFixed(0)}</div>`;
        }
        html += '</div>';
    }
    html += '</div>';
    cont.innerHTML = html;
}

// ========================================================
// GÊMEO DIGITAL 3D & TIME-LAPSE
// ========================================================
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
    if (!twinPlaying || twinFrames.length < 2) return;
    twinTimer = setInterval(() => {
        twinIdx = (twinIdx + 1) % twinFrames.length;
        const sl = document.getElementById('twinSlider');
        if (sl) sl.value = twinIdx;
        atualizarHudTwin();
    }, twinVelMs);
}

function atualizarHudTwin() {
    const f = twinFrames[twinIdx];
    if (!f) return;
    const ti = parseFloat(f.temp_int);
    const te = f.temp_ext !== null ? parseFloat(f.temp_ext) : NaN;
    const hi = parseFloat(f.hum_int);
    const svp = 0.61078 * Math.exp((17.27 * ti) / (ti + 237.3));
    const vpd = Math.max(0, svp * (1 - hi / 100));

    document.getElementById('twinHudHora').textContent = f.slot.slice(5, 16);
    document.getElementById('twinTempInt').textContent = `${ti.toFixed(1)}°C`;
    document.getElementById('twinTempExt').textContent = isNaN(te) ? '--°C' : `${te.toFixed(1)}°C`;
    document.getElementById('twinHumInt').textContent = `${hi.toFixed(1)}%`;
    document.getElementById('twinVpd').textContent = `${vpd.toFixed(2)} kPa`;

    const badges = [];
    if (parseInt(f.rele_ar, 10) === 1) badges.push('<span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">❄️ AC</span>');
    if (parseInt(f.rele_exaust, 10) === 1) badges.push('<span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">💨 Exaustor</span>');
    if (parseInt(f.rele_umid, 10) === 1) badges.push('<span class="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold">💧 Névoa</span>');
    if (parseInt(f.rele_vento, 10) === 1) badges.push('<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">🌀 Brisa</span>');
    if (parseInt(f.rele_luz, 10) === 1) badges.push('<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">💡 Luz</span>');
    if (badges.length === 0) badges.push('<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400">Em repouso</span>');
    document.getElementById('twinBadges').innerHTML = badges.join('');
}

function inicializarCanvasTwin() {
    const cv = document.getElementById('canvasTwin3D');
    if (!cv) return;
    cv.addEventListener('pointerdown', e => { twinDrag = true; twinLastX = e.clientX; twinLastY = e.clientY; });
    window.addEventListener('pointerup', () => { twinDrag = false; });
    window.addEventListener('pointermove', e => {
        if (!twinDrag) return;
        twinYaw += (e.clientX - twinLastX) * 0.008;
        twinPitch = Math.max(0.15, Math.min(1.1, twinPitch + (e.clientY - twinLastY) * 0.008));
        twinLastX = e.clientX;
        twinLastY = e.clientY;
    });
    for (let i = 0; i < 45; i++) {
        twinParticulas.push({ x: (Math.random() - 0.5) * 1.4, y: Math.random() * 1.6 - 0.8, z: (Math.random() - 0.5) * 1.4, v: 0.01 + Math.random() * 0.015 });
    }
}

function proj3D(x, y, z, w, h, scale) {
    const cy = Math.cos(twinYaw), sy = Math.sin(twinYaw);
    const cp = Math.cos(twinPitch), sp = Math.sin(twinPitch);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp + 5.2;
    const f = scale / Math.max(1.5, z2);
    return [w / 2 + x1 * f, h / 2 - y2 * f];
}

function animarTwinLoop() {
    const cv = document.getElementById('canvasTwin3D');
    if (cv && !document.getElementById('secLabTwin').classList.contains('hidden')) {
        const dpr = window.devicePixelRatio || 1;
        const rect = cv.getBoundingClientRect();
        if (cv.width !== Math.floor(rect.width * dpr)) {
            cv.width = Math.floor(rect.width * dpr);
            cv.height = Math.floor(rect.height * dpr);
        }
        const ctx = cv.getContext('2d');
        const w = cv.width, h = cv.height;
        const scale = Math.min(w, h) * 1.15;
        ctx.clearRect(0, 0, w, h);

        const f = twinFrames[twinIdx] || { temp_int: 26.5, temp_ext: 25.5, rele_luz: 0, rele_umid: 0, rele_exaust: 0, rele_ar: 0 };
        const ti = parseFloat(f.temp_int || 26);
        const luz = parseInt(f.rele_luz || 0, 10) === 1;
        const umid = parseInt(f.rele_umid || 0, 10) === 1;
        const exaust = parseInt(f.rele_exaust || 0, 10) === 1;
        const ar = parseInt(f.rele_ar || 0, 10) === 1;

        const drawBox = (rx, ry, rz, stroke, fill) => {
            const pts = [
                [-rx, -ry, -rz], [rx, -ry, -rz], [rx, ry, -rz], [-rx, ry, -rz],
                [-rx, -ry, rz], [rx, -ry, rz], [rx, ry, rz], [-rx, ry, rz]
            ].map(p => proj3D(p[0], p[1], p[2], w, h, scale));
            const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
            if (fill) {
                ctx.fillStyle = fill;
                ctx.beginPath();
                [0, 1, 5, 4].forEach((idx, i) => i === 0 ? ctx.moveTo(...pts[idx]) : ctx.lineTo(...pts[idx]));
                ctx.closePath();
                ctx.fill();
            }
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.5 * dpr;
            edges.forEach(([a, b]) => {
                ctx.beginPath(); ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.stroke();
            });
        };

        // Quarto externo
        drawBox(1.85, 1.25, 1.85, ar ? 'rgba(56,189,248,0.6)' : 'rgba(100,116,139,0.28)', ar ? 'rgba(14,165,233,0.06)' : 'rgba(30,41,59,0.12)');

        // Estufa interna (cor térmica)
        let corEstufa = 'rgba(52,211,153,0.85)';
        if (ti >= 28.5) corEstufa = 'rgba(244,63,94,0.9)';
        else if (ti >= 27.5) corEstufa = 'rgba(251,191,36,0.85)';
        drawBox(0.95, 1.0, 0.95, corEstufa, luz ? 'rgba(251,191,36,0.08)' : 'rgba(16,185,129,0.05)');

        // Partículas de névoa / fluxo Pós-AC
        twinParticulas.forEach(p => {
            if (umid) p.y += p.v;
            else if (exaust) p.x += p.v * 1.4;
            else p.y += p.v * 0.25;
            if (p.y > 0.9) p.y = -0.85;
            if (p.x > 0.85) p.x = -0.85;
            const [px, py] = proj3D(p.x * 0.8, p.y * 0.9, p.z * 0.8, w, h, scale);
            ctx.fillStyle = umid ? 'rgba(34,211,238,0.8)' : (exaust ? 'rgba(56,189,248,0.75)' : 'rgba(148,163,184,0.25)');
            ctx.beginPath();
            ctx.arc(px, py, (umid || exaust ? 2.5 : 1.3) * dpr, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    requestAnimationFrame(animarTwinLoop);
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
        item(true, 'Guarda de Umidade Pós-AC', `${hv.uGuardaCorte ?? 88}% (Pós-AC: ${hv.tSifaoPosAc ?? 15} min)`)
    ].join('');

    document.getElementById('segListaHardware').innerHTML = [
        item(extOff === 0, 'Leituras Sensor Quarto Offline', `${extOff} ocorrências`),
        item(calorCrit === 0, 'Picos Críticos (≥ 30°C)', `${calorCrit} min no período`),
        item(shortAc === 0, 'Ciclos Curtos AC (< 5 min / 72h)', `${shortAc} de ${seg.ciclos_ac_72h ?? 0} ciclos`),
        item(!!ult.timestamp, 'Último Heartbeat da Placa', ult.timestamp ? ult.timestamp.slice(5, 16) : '--')
    ].join('');

    const gaps = seg.ultimos_gaps || [];
    document.getElementById('segListaGaps').innerHTML = gaps.length === 0
        ? '<div class="text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 font-semibold">✅ Nenhuma queda superior a 3 minutos nas últimas 72h!</div>'
        : gaps.map(g => `<div class="flex justify-between bg-slate-950/70 border border-rose-500/20 rounded-xl px-3 py-2"><span class="text-slate-300">${g.inicio} ➔ ${g.fim}</span><span class="font-bold text-rose-300">${g.minutos} min offline</span></div>`).join('');
}
