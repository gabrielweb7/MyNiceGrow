// ========================================================
// MOTOR DE GRÁFICOS (CHART.JS, ZOOM, INSPETOR E SWIMLANES)
// ========================================================
let zoomAtivo3h = true;
let zoomAtivoFuturo = false;
let zoomManualUsuario = false;

function aplicarZoom3Horas() {
    if (!chartUmid || !chartTemp || !chartReles) return;
    
    // Pega o timestamp do momento presente real (último dado medido pelo ESP32)
    let tsAgora = window.tsUltimoDadoReal;
    if (!tsAgora) {
        const ds = chartTemp.data.datasets;
        if (ds && ds[0] && ds[0].data && ds[0].data.length > 0) {
            for (let i = ds[0].data.length - 1; i >= 0; i--) {
                if (ds[0].data[i].y !== null) {
                    tsAgora = ds[0].data[i].x;
                    break;
                }
            }
        }
    }
    if (!tsAgora) tsAgora = Date.now();

    // Centraliza o momento presente ("Agora") no meio exato do gráfico:
    // 3h de histórico real à esquerda e 3h de previsão futura à direita
    const janelaMs = 3 * 3600 * 1000;
    const minTs = tsAgora - janelaMs;
    const maxTs = tsAgora + janelaMs;

    [chartUmid, chartTemp, chartReles].forEach(c => {
        if (c) {
            c.options.scales.x.min = minTs;
            c.options.scales.x.max = maxTs;
            if (typeof c.zoomScale === 'function') {
                c.zoomScale('x', { min: minTs, max: maxTs }, 'none');
            }
            c.update('none');
        }
    });
    zoomAtivo3h = true;
    zoomAtivoFuturo = false;
    atualizarTextoBtnZoom();
}

function aplicarZoomRestoDoDia() {
    if (!chartUmid || !chartTemp || !chartReles) return;
    const tsAgora = window.tsUltimoDadoReal || Date.now();
    const minTs = tsAgora - (1 * 3600 * 1000);
    const maxTs = tsAgora + (10 * 3600 * 1000);

    [chartUmid, chartTemp, chartReles].forEach(c => {
        if (c) {
            c.options.scales.x.min = minTs;
            c.options.scales.x.max = maxTs;
            if (typeof c.zoomScale === 'function') {
                c.zoomScale('x', { min: minTs, max: maxTs }, 'none');
            }
            c.update('none');
        }
    });
    zoomAtivo3h = false;
    zoomAtivoFuturo = true;
    zoomManualUsuario = true;
    atualizarTextoBtnZoom();
}

function resetarZoom() {
    [chartUmid, chartTemp, chartReles].forEach(c => {
        if (c) {
            delete c.options.scales.x.min;
            delete c.options.scales.x.max;
            if (typeof c.resetZoom === 'function') c.resetZoom('none');
            c.update('none');
        }
    });
    zoomAtivo3h = false;
    zoomAtivoFuturo = false;
    atualizarTextoBtnZoom();
}

function toggleZoomRange() {
    if (zoomAtivo3h) {
        resetarZoom();
        zoomManualUsuario = true;
    } else {
        zoomManualUsuario = false;
        aplicarZoom3Horas();
    }
}

function atualizarTextoBtnZoom() {
    const btn = document.getElementById('btnResetZoom');
    const btnFut = document.getElementById('btnZoomFuturo');
    if (btnFut) {
        btnFut.className = zoomAtivoFuturo
            ? "px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs sm:text-[10px] font-bold bg-cyan-600 hover:bg-cyan-500 border border-cyan-400 rounded-lg sm:rounded text-white transition-all shadow-sm active:scale-95"
            : "px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs sm:text-[10px] font-bold bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-500/40 rounded-lg sm:rounded text-cyan-300 transition-all shadow-sm active:scale-95";
    }
    if (!btn) return;
    btn.classList.remove('hidden');
    if (zoomAtivo3h) {
        btn.innerHTML = (limitAtual === 10080 ? '🔍 Ver 7 Dias' : '🔍 Ver 24 Horas');
        btn.className = "px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs sm:text-[10px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg sm:rounded text-emerald-400 transition-all shadow-sm active:scale-95";
    } else {
        btn.innerHTML = '🔍 Focar no Meio (Agora)';
        btn.className = "px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs sm:text-[10px] font-bold bg-emerald-700 hover:bg-emerald-600 border border-emerald-500 rounded-lg sm:rounded text-white transition-all shadow-sm active:scale-95";
    }
}

// MOTOR METEOROLÓGICO OPEN-METEO (Tiradentes, Campo Grande - MS) com cache de 30min
const METEO_CACHE_KEY = 'grow_meteo_cache_v1';
const METEO_COORDS = { lat: -20.478, lon: -54.582, nome: 'Campo Grande - MS' };
window.climaLocalData = null;


function calcularTempoReles(data) {
    const elLuz = document.getElementById('tempoLuz');
    const elUmid = document.getElementById('tempoUmid');
    const elVento = document.getElementById('tempoVento');
    const elExaust = document.getElementById('tempoExaust');
    const elAr = document.getElementById('tempoAr');
    const elVentoExt = document.getElementById('tempoVentoExt');
    const elContainer = document.getElementById('containerFiltroReles');

    // No filtro de 7 dias, não mostra quantidade de horas (conforme solicitado)
    if (limitAtual === 10080) {
        if (elLuz) elLuz.textContent = '';
        if (elUmid) elUmid.textContent = '';
        if (elVento) elVento.textContent = '';
        if (elExaust) elExaust.textContent = '';
        if (elAr) elAr.textContent = '';
        if (elVentoExt) elVentoExt.textContent = '';
        if (elContainer) elContainer.classList.add('hidden');
        return;
    }

    if (elContainer) elContainer.classList.remove('hidden');

    if (!data || data.length === 0) return;

    let segLuz = 0, segUmid = 0, segVento = 0, segExaust = 0, segAr = 0, segVentoExt = 0;

    for (let i = 0; i < data.length; i++) {
        let duracao = 60; // Duração padrão estimada para cada registro (1 minuto)
        if (i < data.length - 1) {
            let tsAtual = data[i].unix_ts || Math.floor(new Date(data[i].timestamp.replace(' ', 'T')).getTime() / 1000);
            let tsProx = data[i+1].unix_ts || Math.floor(new Date(data[i+1].timestamp.replace(' ', 'T')).getTime() / 1000);
            let delta = tsProx - tsAtual;
            if (delta > 0 && delta <= 900) {
                duracao = delta;
            }
        }

        if (parseInt(data[i].rele_luz) === 1) segLuz += duracao;
        if (parseInt(data[i].rele_umid) === 1) segUmid += duracao;
        if (parseInt(data[i].rele_vento) === 1) segVento += duracao;
        if (parseInt(data[i].rele_exaust) === 1) segExaust += duracao;
        if (parseInt(data[i].rele_ar) === 1) segAr += duracao;
        if (parseInt(data[i].rele_vento_ext) === 1) segVentoExt += duracao;
    }

    const formatarTempo = (seg) => {
        if (seg <= 0) return '<span class="text-slate-400 font-bold">0 min</span>';
        let m = Math.round(seg / 60);
        let h = Math.floor(m / 60);
        let mRest = m % 60;
        let txt = (h > 0) ? `${h}h ${mRest.toString().padStart(2, '0')}m` : `${mRest} min`;
        return `<span class="text-white font-black">${txt}</span>`;
    };

    if (elLuz) elLuz.innerHTML = formatarTempo(segLuz);
    if (elUmid) elUmid.innerHTML = formatarTempo(segUmid);
    if (elVento) elVento.innerHTML = formatarTempo(segVento);
    if (elExaust) elExaust.innerHTML = formatarTempo(segExaust);
    if (elAr) elAr.innerHTML = formatarTempo(segAr);
    if (elVentoExt) elVentoExt.innerHTML = formatarTempo(segVentoExt);
}

function toggleDatasetReles(index, elId) {
    if (!chartReles) return;
    const isVisible = chartReles.isDatasetVisible(index);
    chartReles.setDatasetVisibility(index, !isVisible);
    chartReles.update();

    const el = document.getElementById(elId);
    if (el) {
        if (isVisible) {
            // Ficou invisível
            el.classList.add('opacity-30', 'grayscale', 'bg-slate-950/40', 'border-slate-800');
            el.classList.remove('bg-slate-800/60', 'hover:bg-slate-700/60', 'border-slate-700/40');
        } else {
            // Ficou visível
            el.classList.remove('opacity-30', 'grayscale', 'bg-slate-950/40', 'border-slate-800');
            el.classList.add('bg-slate-800/60', 'hover:bg-slate-700/60', 'border-slate-700/40');
        }
    }
}

function syncZoom(sourceChart) {
    const min = sourceChart.scales.x.min;
    const max = sourceChart.scales.x.max;
    zoomManualUsuario = true;
    zoomAtivo3h = false;
    zoomAtivoFuturo = false;
    atualizarTextoBtnZoom();
    if (syncZoomRaf) cancelAnimationFrame(syncZoomRaf);
    syncZoomRaf = requestAnimationFrame(() => {
        [chartUmid, chartTemp, chartReles].forEach(c => {
            if (c && c !== sourceChart) {
                if (typeof c.zoomScale === 'function') {
                    c.zoomScale('x', { min, max }, 'none');
                } else {
                    c.options.scales.x.min = min;
                    c.options.scales.x.max = max;
                    c.update('none');
                }
            }
        });
    });
}

const crosshairPlugin = {
    id: 'crosshair',
    afterDraw: chart => {
        const activeEls = (chart.getActiveElements && chart.getActiveElements().length)
            ? chart.getActiveElements()
            : chart.tooltip?._active;
        if (activeEls && activeEls.length) {
            let x = activeEls[0].element.x;
            let yAxis = chart.scales[Object.keys(chart.scales).find(k => k !== 'x')];
            if (!yAxis) return;
            let ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, yAxis.top);
            ctx.lineTo(x, yAxis.bottom);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(0, 255, 170, 0.5)'; // Verde Neon
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.restore();
        }
    }
};

const agoraLinePlugin = {
    id: 'agoraLine',
    afterDraw: chart => {
        if (!window.tsUltimoDadoReal) return;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales[Object.keys(chart.scales).find(k => k !== 'x')];
        if (!xAxis || !yAxis) return;
        
        const xPos = xAxis.getPixelForValue(window.tsUltimoDadoReal);
        if (xPos < xAxis.left || xPos > xAxis.right) return;
        
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(xPos, yAxis.top);
        ctx.lineTo(xPos, yAxis.bottom);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)'; // Verde Esmeralda Neon
        ctx.setLineDash([4, 3]);
        ctx.stroke();

        ctx.fillStyle = 'rgba(52, 211, 153, 0.9)';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('AGORA 📍', xPos, yAxis.top + 2);
        ctx.restore();
    }
};

let hoverRaf = null;
let lastHoverIdx = -1;

function atualizarInspetorGrafico(dataIndex) {
    const bar = document.getElementById('chartInspectorBar');
    if (!bar || dataIndex == null || dataIndex < 0 || !chartTemp || !chartUmid || !chartReles) return;

    const dsTemp = chartTemp.data.datasets;
    const dsUmid = chartUmid.data.datasets;
    const dsReles = chartReles.data.datasets;

    const ptTi = dsTemp[0]?.data?.[dataIndex];
    const ptTe = dsTemp[1]?.data?.[dataIndex];
    const ptTp = dsTemp[2]?.data?.[dataIndex];
    const ptTePrev = dsTemp[3]?.data?.[dataIndex];
    const ptHi = dsUmid[0]?.data?.[dataIndex];
    const ptHe = dsUmid[1]?.data?.[dataIndex];
    const ptHiPrev = dsUmid[2]?.data?.[dataIndex];
    const ptHePrev = dsUmid[3]?.data?.[dataIndex];
    const ptLuz = dsReles[0]?.data?.[dataIndex];
    const ptAr  = dsReles[4]?.data?.[dataIndex];

    const ts = ptTi?.x || ptTe?.x || ptTp?.x || ptTePrev?.x || ptHi?.x || ptLuz?.x;
    if (!ts) return;

    const d = new Date(ts);
    const horaStr = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const isGhost = !!(ptLuz?.ghost || ptAr?.ghost || (ptTi?.y == null && (ptTp?.y != null || ptTePrev?.y != null)));

    const elHora = document.getElementById('inspHora');
    const elGhost = document.getElementById('inspGhostTag');
    const elTi = document.getElementById('inspTempInt');
    const elTe = document.getElementById('inspTempExt');
    const elHi = document.getElementById('inspHumInt');
    const elHe = document.getElementById('inspHumExt');
    const elReles = document.getElementById('inspReles');

    if (elHora) elHora.textContent = (isGhost ? '🔮 ' : '📍 ') + horaStr;
    if (elGhost) elGhost.classList.toggle('hidden', !isGhost);

    if (elTi) {
        if (ptTi?.y != null) {
            elTi.textContent = Number(ptTi.y).toFixed(1) + '°';
            elTi.className = 'text-[#00ffaa]';
        } else if (ptTp?.y != null) {
            elTi.textContent = '~' + Number(ptTp.y).toFixed(1) + '°';
            elTi.className = 'text-cyan-300';
        } else {
            elTi.textContent = '--';
            elTi.className = 'text-slate-500';
        }
    }
    if (elTe) {
        if (ptTe?.y != null) {
            elTe.textContent = Number(ptTe.y).toFixed(1) + '°';
            elTe.className = 'text-[#ff4d6d]';
        } else if (ptTePrev?.y != null) {
            elTe.textContent = '~' + Number(ptTePrev.y).toFixed(1) + '°';
            elTe.className = 'text-rose-300/80';
        } else {
            elTe.textContent = '--';
            elTe.className = 'text-slate-500';
        }
    }
    if (elHi) {
        if (ptHi?.y != null) {
            elHi.textContent = Number(ptHi.y).toFixed(0) + '%';
            elHi.className = 'text-[#00c8ff]';
        } else if (ptHiPrev?.y != null) {
            elHi.textContent = '~' + Number(ptHiPrev.y).toFixed(0) + '%';
            elHi.className = 'text-cyan-300/80';
        } else {
            elHi.textContent = '--';
            elHi.className = 'text-slate-500';
        }
    }
    if (elHe) {
        if (ptHe?.y != null) {
            elHe.textContent = Number(ptHe.y).toFixed(0) + '%';
            elHe.className = 'text-[#c084fc]';
        } else if (ptHePrev?.y != null) {
            elHe.textContent = '~' + Number(ptHePrev.y).toFixed(0) + '%';
            elHe.className = 'text-purple-300/80';
        } else {
            elHe.textContent = '--';
            elHe.className = 'text-slate-500';
        }
    }

    if (elReles) {
        const relesMeta = [
            { ico: '💡', pt: dsReles[0]?.data?.[dataIndex], onCls: 'bg-amber-500/20 text-amber-300 border-amber-400/40' },
            { ico: '💨', pt: dsReles[1]?.data?.[dataIndex], onCls: 'bg-sky-500/20 text-sky-300 border-sky-400/40' },
            { ico: '🌀', pt: dsReles[2]?.data?.[dataIndex], onCls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' },
            { ico: '🌬️', pt: dsReles[3]?.data?.[dataIndex], onCls: 'bg-orange-500/20 text-orange-300 border-orange-400/40' },
            { ico: '❄️', pt: dsReles[4]?.data?.[dataIndex], onCls: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' }
        ];
        elReles.innerHTML = relesMeta.map(r => {
            const on = !!(r.pt && r.pt.y !== null && Array.isArray(r.pt.y));
            const g = !!(r.pt && r.pt.ghost);
            const cls = on ? r.onCls : 'bg-slate-800/70 text-slate-500 border-slate-700/50';
            const txt = on ? (g ? 'Prev' : 'ON') : 'OFF';
            return `<span class="px-1.5 py-0.5 rounded border ${cls}">${r.ico}${txt}</span>`;
        }).join('');
    }

    bar.classList.remove('hidden');
}

function fecharInspetorGrafico() {
    const bar = document.getElementById('chartInspectorBar');
    if (bar) bar.classList.add('hidden');
    lastHoverIdx = -1;
    [chartUmid, chartTemp, chartReles].forEach(c => {
        if (c) {
            c.setActiveElements([]);
            if (c.tooltip && typeof c.tooltip.setActiveElements === 'function') {
                c.tooltip.setActiveElements([], { x: 0, y: 0 });
            }
            c.render();
        }
    });
}

function baseOptions(yScale) {
    const touchMode = isTouchDevice();
    return {
        responsive: true, maintainAspectRatio: false, animation: false,
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        normalized: true, // Pula busca e ordenação interna no Chart.js (ganho massivo de FPS)
        interaction: { mode: 'index', intersect: false },
        onHover: (e, elements, chart) => {
            if (elements.length > 0) {
                const dataIndex = elements[0].index;
                if (dataIndex === lastHoverIdx) return; // Evita repintar se o ponteiro ainda está no mesmo minuto
                
                const now = Date.now();
                if (now - (window.lastHoverTime || 0) < 40) return; // Limite ~25 FPS no drag para eliminar lag mobile
                window.lastHoverTime = now;
                
                lastHoverIdx = dataIndex;
                if (hoverRaf) cancelAnimationFrame(hoverRaf);
                hoverRaf = requestAnimationFrame(() => {
                    if (touchMode) atualizarInspetorGrafico(dataIndex);
                    [chartUmid, chartTemp, chartReles].forEach(c => {
                        if (c && c !== chart) {
                            const activeElements = c.data.datasets.map((_, i) => ({ datasetIndex: i, index: dataIndex }));
                            c.setActiveElements(activeElements);
                            if (!touchMode && c.tooltip) {
                                c.tooltip.setActiveElements(activeElements, e);
                            }
                            c.render(); // render() é muito mais leve que update('none')
                        }
                    });
                });
            } else if (!touchMode) {
                if (lastHoverIdx === -1) return;
                lastHoverIdx = -1;
                if (hoverRaf) cancelAnimationFrame(hoverRaf);
                hoverRaf = requestAnimationFrame(() => {
                    [chartUmid, chartTemp, chartReles].forEach(c => {
                        if (c && c !== chart) {
                            c.setActiveElements([]);
                            if (c.tooltip) c.tooltip.setActiveElements([], e);
                            c.render();
                        }
                    });
                });
            }
        },
        plugins: {
            legend: { display: false },
            decimation: { enabled: true, algorithm: 'lttb' },
            tooltip: { 
                enabled: !touchMode,
                filter: (item) => item.parsed && item.parsed.y !== null,
                backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                borderColor: '#334155', 
                borderWidth: 1, 
                titleColor: '#00ffaa', 
                titleFont: { size: 11, weight: 'bold', family: 'monospace' },
                bodyColor: '#e2e8f0', 
                bodyFont: { size: 10 },
                padding: 6,
                boxWidth: 8,
                boxHeight: 8,
                boxPadding: 4,
                usePointStyle: true
            },
            zoom: {
                limits: {
                    x: { minRange: 15 * 60000 } // Limita zoom in a 15 minutos (evita ver as quebras de passo do chartjs)
                },
                pan: { enabled: true, mode: 'x', threshold: 10, onPan: ({chart}) => syncZoom(chart) },
                zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x', onZoom: ({chart}) => syncZoom(chart) }
            }
        },
        scales: {
            x: {
                type: 'time', 
                time: { tooltipFormat: 'dd/MM HH:mm', displayFormats: { hour: 'HH:mm', minute: 'HH:mm', day: 'dd/MM' } },
                afterBuildTicks: (scale) => {
                    const min = scale.min;
                    const max = scale.max;
                    const rangeMs = max - min;
                    let stepMs = 5 * 60000; // default 5m
                    
                    if (rangeMs > 5 * 24 * 3600 * 1000) stepMs = 24 * 3600 * 1000; // > 5 dias = 24h
                    else if (rangeMs > 2 * 24 * 3600 * 1000) stepMs = 12 * 3600 * 1000; // > 2 dias = 12h
                    else if (rangeMs > 12 * 3600 * 1000) stepMs = 2 * 3600 * 1000; // > 12h = 2h
                    else if (rangeMs > 6 * 3600 * 1000) stepMs = 60 * 60000; // > 6h = 1h
                    else if (rangeMs > 2 * 3600 * 1000) stepMs = 15 * 60000; // > 2h = 15m
                    else if (rangeMs > 3600 * 1000) stepMs = 10 * 60000; // > 1h = 10m
                    
                    // Ajusta o primeiro tick para múltiplo exato do stepMs (alinhado a hora inteira/zero)
                    // A divisão usando o timezone offset garante alinhamento com a hora local
                    const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
                    const minAdjusted = min - tzOffsetMs;
                    let firstTick = Math.ceil(minAdjusted / stepMs) * stepMs + tzOffsetMs;
                    
                    const newTicks = [];
                    for (let t = firstTick; t <= max; t += stepMs) {
                        newTicks.push({ value: t });
                    }
                    scale.ticks = newTicks;
                },
                grid: { color: 'rgba(255,255,255,0.04)' }, 
                ticks: { 
                    color: (ctx) => {
                        if (ctx.tick && ctx.tick.value) {
                            const d = new Date(ctx.tick.value);
                            if (d.getMinutes() === 0) return '#00ffaa';
                        }
                        return '#475569';
                    },
                    maxTicksLimit: (window.innerWidth < 480) ? 6 : 12, 
                    font: { size: 10 } 
                }
            },
            y: yScale
        }
    };
}

function initCharts() {
    let umidOpts = baseOptions({
        suggestedMin: 55,
        max: 103,
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#00c8ff', font: { size: 10 }, callback: v => Math.round(v) + '%' }
    });
    umidOpts.plugins.tooltip.callbacks = {
        label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)}%`
    };
    chartUmid = new Chart(document.getElementById('canvasUmid').getContext('2d'), {
        type: 'line',
        data: { datasets: [
            { label: 'Umid Int (%)', data: [], borderColor: '#00c8ff', backgroundColor: 'rgba(0,200,255,0.07)', borderWidth: 2.5, pointRadius: 0, tension: 0.28, fill: true },
            { label: 'Umid Ext (%)', data: [], borderColor: '#c084fc', backgroundColor: 'rgba(192,132,252,0.05)', borderWidth: 2, pointRadius: 0, tension: 0.28, fill: false },
            { label: 'Previsão Umid Int (%)', data: [], borderColor: 'rgba(0, 200, 255, 0.80)', backgroundColor: 'transparent', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.35, fill: false },
            { label: 'Previsão Umid Ext (%)', data: [], borderColor: 'rgba(192, 132, 252, 0.45)', backgroundColor: 'transparent', borderDash: [3, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.38, fill: false }
        ]},
        options: umidOpts,
        plugins: [crosshairPlugin, agoraLinePlugin]
    });

    let tempOpts = baseOptions({
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
            color: '#00ffaa',
            font: { size: 10 },
            callback: v => (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) + '°C' : v.toFixed(1) + '°C')
        }
    });
    tempOpts.plugins.tooltip.callbacks = {
        label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)}°C`
    };
    chartTemp = new Chart(document.getElementById('canvasTemp').getContext('2d'), {
        type: 'line',
        data: { datasets: [
            { label: 'Temp Int (°C)', data: [], borderColor: '#00ffaa', backgroundColor: 'rgba(0,255,170,0.07)', borderWidth: 2.5, pointRadius: 0, tension: 0.28, fill: true },
            { label: 'Temp Ext (°C)', data: [], borderColor: '#ff4d6d', backgroundColor: 'rgba(255,77,109,0.05)', borderWidth: 2.5, pointRadius: 0, tension: 0.38, fill: false },
            { label: 'Previsão Temp Int (°C)', data: [], borderColor: 'rgba(0, 229, 255, 0.85)', backgroundColor: 'transparent', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.40, fill: false },
            { label: 'Previsão Temp Ext (°C)', data: [], borderColor: 'rgba(255, 77, 109, 0.48)', backgroundColor: 'transparent', borderDash: [3, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.42, fill: false }
        ]},
        options: tempOpts,
        plugins: [crosshairPlugin, agoraLinePlugin]
    });

    let relesOpts = baseOptions({
        min: -0.6,
        max: 4.6,
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: {
            stepSize: 1,
            autoSkip: false,
            color: (c) => {
                const colors = ['#ff6400', '#00ffaa', '#00c8ff', '#ffdc00', '#00e5ff'];
                return colors[c.tick.value] || '#94a3b8';
            },
            font: { size: (window.innerWidth < 480) ? 9 : 10, weight: 'bold' },
            callback: function(v) {
                switch(v) {
                    case 0: return '🌬️ Exaust';
                    case 1: return '🌀 Vento Int';
                    case 2: return '💨 Umidif';
                    case 3: return '💡 Luz';
                    case 4: return '❄️ Ar Cond';
                    default: return '';
                }
            }
        }
    });
    relesOpts.grouped = false;
    relesOpts.scales.x.stacked = false;
    relesOpts.scales.y.stacked = false;
    if (relesOpts.plugins && relesOpts.plugins.tooltip) {
        relesOpts.plugins.tooltip.filter = () => true;
    }

    chartReles = new Chart(document.getElementById('canvasReles').getContext('2d'), {
        type: 'bar',
        data: { datasets: [
            { label: 'Luz', data: [], backgroundColor: (ctx) => (ctx.raw && ctx.raw.ghost) ? 'rgba(51, 52, 35, 1)' : 'rgba(255, 220, 0, 0.9)', borderColor: '#ffdc00', borderWidth: 0, barPercentage: 1.05, categoryPercentage: 1.0, grouped: false },
            { label: 'Umidif.', data: [], backgroundColor: (ctx) => (ctx.raw && ctx.raw.ghost) ? 'rgba(12, 49, 73, 1)' : 'rgba(0, 200, 255, 0.9)', borderColor: '#00c8ff', borderWidth: 0, barPercentage: 1.05, categoryPercentage: 1.0, grouped: false },
            { label: 'Vento Int.', data: [], backgroundColor: (ctx) => (ctx.raw && ctx.raw.ghost) ? 'rgba(12, 57, 60, 1)' : 'rgba(0, 255, 170, 0.9)', borderColor: '#00ffaa', borderWidth: 0, barPercentage: 1.05, categoryPercentage: 1.0, grouped: false },
            { label: 'Exaustor', data: [], backgroundColor: (ctx) => (ctx.raw && ctx.raw.ghost) ? 'rgba(51, 34, 35, 1)' : 'rgba(255, 100, 0, 0.9)', borderColor: '#ff6400', borderWidth: 0, barPercentage: 1.05, categoryPercentage: 1.0, grouped: false },
            { label: 'Ar Cond.', data: [], backgroundColor: (ctx) => (ctx.raw && ctx.raw.ghost) ? 'rgba(10, 65, 85, 1)' : 'rgba(0, 229, 255, 0.9)', borderColor: '#00e5ff', borderWidth: 0, barPercentage: 1.05, categoryPercentage: 1.0, grouped: false }
        ]},
        options: relesOpts,
        plugins: [crosshairPlugin, agoraLinePlugin]
    });
    
    // Corrige o tooltip dos relés nas trilhas para indicar ON ou OFF e Previsão
    chartReles.options.plugins.tooltip.callbacks = {
        label: ctx => {
            const isLigado = ctx.raw && ctx.raw.y !== null && Array.isArray(ctx.raw.y);
            const isGhost = ctx.raw && ctx.raw.ghost;
            if (isGhost) {
                const extra = (isLigado && ctx.raw.motivo) ? ` (${ctx.raw.motivo})` : '';
                return ` ${ctx.dataset.label}: ${isLigado ? '🔮 Prev(ON)' + extra : '⚪ Prev(OFF)'}`;
            }
            return ` ${ctx.dataset.label}: ${isLigado ? '🟢 ON' : '⚪ OFF'}`;
        }
    };
}
