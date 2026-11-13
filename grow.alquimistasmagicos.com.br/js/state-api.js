// ========================================================
// ESTADO GLOBAL E COMUNICAÇÃO DE REDE / API
// ========================================================
let chartUmid = null, chartTemp = null, chartReles = null;
let limitAtual = 1440;

const chartColors = {
green: '#10b981', greenFade: 'rgba(16,185,129,0.1)',
blue: '#3b82f6', blueFade: 'rgba(59,130,246,0.1)',
red: '#f43f5e', redFade: 'rgba(244,63,94,0.1)',
purple: '#8b5cf6', purpleFade: 'rgba(139,92,246,0.1)',
amber: '#f59e0b', amberFade: 'rgba(245,158,11,0.15)',
orange: '#f97316', cyan: '#06b6d4'
};

let luzState = 0; // 0=AUTO, 1=ON, 2=OFF
let arState = 0;
let luzPendenteTempo = 0;
let arPendenteTempo = 0;
let fasePendenteTempo = 0;
let fasePendenteAlvo = null;
let loopTimeout = null;
let loopGen = 0;
let ultimoFetchFwTs = 0;

// Wrapper de segurança para cancelar requests se demorarem mais que X milissegundos
async function fetchComTimeout(url, options = {}, tempoMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), tempoMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

function interpretarWmoCode(code) {
    const c = parseInt(code, 10);
    if (c === 0) return { ico: '☀️', desc: 'Céu Limpo' };
    if (c >= 1 && c <= 2) return { ico: '⛅', desc: 'Poucas Nuvens' };
    if (c === 3) return { ico: '☁️', desc: 'Nublado' };
    if (c === 45 || c === 48) return { ico: '🌫️', desc: 'Neblina' };
    if (c >= 51 && c <= 57) return { ico: '🌦️', desc: 'Garoa' };
    if (c >= 61 && c <= 67) return { ico: '🌧️', desc: 'Chuva' };
    if (c >= 80 && c <= 82) return { ico: '🌦️', desc: 'Pancadas de Chuva' };
    if (c >= 95) return { ico: '⛈️', desc: 'Tempestade / Raios' };
    return { ico: '🌤️', desc: 'Tempo Variável' };
}

function prepararClimaLocal(raw) {
    if (!raw || !raw.hourly || !Array.isArray(raw.hourly.time)) return null;
    raw.hourly.timeMs = raw.hourly.time.map(s => s * 1000);
    return raw;
}

function interpolarClimaEm(tsMs, hintIdx = 0) {
    const h = window.climaLocalData && window.climaLocalData.hourly;
    if (!h || !h.timeMs || h.timeMs.length === 0) return null;
    const arr = h.timeMs;
    let idx = Math.max(0, Math.min(arr.length - 1, hintIdx));
    while (idx < arr.length - 1 && arr[idx + 1] <= tsMs) idx++;
    const idxNext = Math.min(arr.length - 1, idx + 1);
    const span = Math.max(1, arr[idxNext] - arr[idx]);
    const frac = idx === idxNext ? 0 : Math.min(1, Math.max(0, (tsMs - arr[idx]) / span));
    const mu = (1 - Math.cos(frac * Math.PI)) * 0.5; // Interpolação cosseno suave (zero quinas horárias)

    const t0 = h.temperature_2m[idx], t1 = h.temperature_2m[idxNext];
    const u0 = h.relative_humidity_2m[idx], u1 = h.relative_humidity_2m[idxNext];
    const p0 = h.precipitation_probability ? h.precipitation_probability[idx] : 0;
    const r0 = h.precipitation ? h.precipitation[idx] : 0;
    const c0 = h.weather_code ? h.weather_code[idx] : 0;

    return {
        idx,
        tRua: t0 + (t1 - t0) * mu,
        hRua: u0 + (u1 - u0) * mu,
        rainProb: p0 || 0,
        rainMm: r0 || 0,
        wCode: c0 || 0
    };
}

function atualizarRadarClimaUI(simResumo = null) {
    const bar = document.getElementById('climaRadarBar');
    const elIco = document.getElementById('climaIcone');
    const elCidade = document.getElementById('climaResumoCidade');
    const elAviso = document.getElementById('climaBadgeAviso');
    const elSim = document.getElementById('climaBadgeSimulacao');
    if (!bar) return;

    if (simResumo) window.ultimoSimResumo = simResumo;
    else simResumo = window.ultimoSimResumo || null;

    const meteo = window.climaLocalData;
    if (meteo && meteo.hourly && meteo.hourly.timeMs) {
        const agora = Date.now();
        const atual = interpolarClimaEm(agora, 0);
        const wInfo = interpretarWmoCode(atual ? atual.wCode : (meteo.daily?.weather_code?.[0] ?? 0));
        const tMin = meteo.daily?.temperature_2m_min?.[0];
        const tMax = meteo.daily?.temperature_2m_max?.[0];

        if (elIco) elIco.textContent = wInfo.ico;
        if (elCidade) {
            const faixa = (tMin != null && tMax != null) ? ` • ${Number(tMin).toFixed(0)}°/${Number(tMax).toFixed(0)}°C` : '';
            const tempAgoraRua = atual ? ` (${atual.tRua.toFixed(1)}°C rua)` : '';
            elCidade.textContent = `${METEO_COORDS.nome}: ${wInfo.desc}${tempAgoraRua}${faixa}`;
        }

        // Analisa risco de chuva/tempestade nas próximas 12h
        if (elAviso) {
            const fim12h = agora + (12 * 3600 * 1000);
            let maxProb = 0, peakTs = 0, totalMm = 0, hasStorm = false;
            const tMs = meteo.hourly.timeMs;
            for (let i = 0; i < tMs.length; i++) {
                if (tMs[i] >= agora - 1800000 && tMs[i] <= fim12h) {
                    const prob = meteo.hourly.precipitation_probability?.[i] || 0;
                    const mm = meteo.hourly.precipitation?.[i] || 0;
                    const code = meteo.hourly.weather_code?.[i] || 0;
                    totalMm += mm;
                    if (code >= 95) hasStorm = true;
                    if (prob > maxProb) { maxProb = prob; peakTs = tMs[i]; }
                }
            }
            const dailyProb = meteo.daily?.precipitation_probability_max?.[0] || 0;
            const probFinal = Math.max(maxProb, dailyProb);

            if (hasStorm) {
                const hStr = peakTs ? new Date(peakTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'hoje';
                elAviso.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-amber-500/15 border-amber-400/40 text-amber-300 font-semibold";
                elAviso.textContent = `⛈️ Alerta de Tempestade (~${hStr}, ${probFinal}%): atenção a picos de energia/Wi-Fi`;
                elAviso.classList.remove('hidden');
            } else if (probFinal >= 45 || totalMm >= 0.8) {
                const hStr = peakTs ? new Date(peakTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'hoje';
                const mmStr = totalMm >= 0.5 ? ` (~${totalMm.toFixed(1)}mm)` : '';
                elAviso.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-blue-500/15 border-blue-400/40 text-blue-300 font-semibold";
                elAviso.textContent = `🌧️ Chuva prev. ~${hStr} (${probFinal}%${mmStr}) • FAE seca menos o grow`;
                elAviso.classList.remove('hidden');
            } else {
                elAviso.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-slate-800/70 border-slate-700/60 text-slate-300 font-medium";
                elAviso.textContent = `☀️ Sem chuva prev. (12h) • Ar externo mais seco no FAE`;
                elAviso.classList.remove('hidden');
            }
        }
        bar.classList.remove('hidden');
    }

    if (elSim && simResumo) {
        elSim.className = "flex items-center gap-1.5 bg-cyan-950/35 px-2.5 py-1 rounded-md border border-cyan-500/30 text-cyan-200 font-semibold";
        elSim.textContent = simResumo.texto;
        elSim.classList.remove('hidden');
        bar.classList.remove('hidden');
    }
}

async function buscarClimaLocal(forcar = false) {
    const agora = Date.now();
    try {
        const rawCache = localStorage.getItem(METEO_CACHE_KEY);
        if (rawCache) {
            const parsed = JSON.parse(rawCache);
            if (parsed && parsed.ts && (agora - parsed.ts < 30 * 60 * 1000) && !forcar) {
                window.climaLocalData = prepararClimaLocal(parsed.data);
                atualizarRadarClimaUI();
                return window.climaLocalData;
            }
            if (!window.climaLocalData && parsed && parsed.data && (agora - parsed.ts < 3 * 3600 * 1000)) {
                window.climaLocalData = prepararClimaLocal(parsed.data);
                atualizarRadarClimaUI();
            }
        }
    } catch (e) {}

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${METEO_COORDS.lat}&longitude=${METEO_COORDS.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code&timezone=America%2FCampo_Grande&timeformat=unixtime&forecast_days=2`;
        const res = await fetchComTimeout(url, {}, 6500);
        if (res && res.ok) {
            const json = await res.json();
            window.climaLocalData = prepararClimaLocal(json);
            try { localStorage.setItem(METEO_CACHE_KEY, JSON.stringify({ ts: agora, data: json })); } catch (e) {}
            atualizarRadarClimaUI();
            if (window.dadosTelemetriaAtuais && window.dadosTelemetriaAtuais.length > 0 && typeof carregarDados === 'function') {
                carregarDados(limitAtual, false);
            }
        }
    } catch (e) {
        console.warn("Open-Meteo indisponível no momento:", e);
    }
    return window.climaLocalData;
}

async function enviarComando(params) {
    try {
        let p = localStorage.getItem('adminPass');
        if(!p) {
            p = prompt("🔑 Senha de Administrador:");
            if(!p) return false;
            localStorage.setItem('adminPass', p);
        }
        const fd = new FormData();
        for (let key in params) fd.append(key, params[key]);
        const res = await fetchComTimeout('api/comando.php', {
            method: 'POST',
            body: fd,
            headers: { 'X-Api-Key': p }
        }, 5000); // Falha rápida se servidor travar
        
        if (res.status === 401) {
            alert("❌ Senha Incorreta!");
            localStorage.removeItem('adminPass');
            return false;
        }

        if (!res.ok) {
            alert("❌ Erro no servidor (" + res.status + "). Tente novamente.");
            return false;
        }

        const st = document.getElementById('cmdStatus');
        if (st) { st.style.opacity = '1'; setTimeout(() => st.style.opacity = '0', 3000); }
        return true;
    } catch(e) {
        console.error("Falha ao enviar comando", e);
        alert("❌ Falha de conexão. Verifique sua internet.");
        return false;
    }
}

function salvarChaveAdmin() {
    const input = document.getElementById('inputAdminPass');
    const fbPass = document.getElementById('adminPassFeedback');
    if (input && input.value.trim()) {
        const pass = input.value.trim();
        localStorage.setItem('adminPass', pass);
        if (fbPass) {
            fbPass.classList.remove('hidden');
            fbPass.innerHTML = '<span>✓</span> <span>Chave ativa salva com sucesso no navegador!</span>';
        }
        alert("✅ Chave de Administrador salva com sucesso no navegador!");
    } else if (input && !input.value.trim()) {
        localStorage.removeItem('adminPass');
        if (fbPass) fbPass.classList.add('hidden');
        alert("ℹ️ Chave de Administrador removida do navegador.");
    }
}

function setRele(id, statusId, estadoRele) {
    const el = document.getElementById(id);
    const st = document.getElementById(statusId);
    if (!el || !st) return;
    const isLuz = (id === 'releLuz');
    const isAr = (id === 'releAr');
    const isOn = (estadoRele === 1 || estadoRele === true || estadoRele === '1');

    if (isLuz) {
        if (luzState === 1) {
            // Manual LIGADA
            el.className = 'rele-btn bg-amber-500 rounded-lg p-3 text-center transition-all duration-300 shadow-[0_0_18px_rgba(245,158,11,0.55)] border border-amber-300 cursor-pointer hover:scale-[1.02]';
            st.textContent = 'MANUAL (ON) ⚡';
            st.className = 'text-[10px] text-amber-950 bg-amber-200/90 rounded px-1.5 py-0.5 mt-0.5 font-extrabold tracking-wider inline-block';
        } else if (luzState === 2) {
            // Manual DESLIGADA
            el.className = 'rele-btn bg-slate-900 rounded-lg p-3 text-center transition-all duration-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)] cursor-pointer hover:scale-[1.02]';
            st.textContent = 'MANUAL (OFF) 🛑';
            st.className = 'text-[10px] text-rose-400 mt-0.5 font-bold tracking-wider';
        } else {
            // AUTO
            if (isOn) {
                el.className = 'rele-btn bg-emerald-600 rounded-lg p-3 text-center transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.4)] border border-emerald-400/50 cursor-pointer hover:scale-[1.02]';
                st.textContent = 'AUTO (ON)';
                st.className = 'text-[10px] text-emerald-100 mt-0.5 font-bold tracking-wider';
            } else {
                el.className = 'rele-btn bg-slate-800 rounded-lg p-3 text-center transition-all duration-300 border border-transparent opacity-85 hover:opacity-100 cursor-pointer hover:scale-[1.02]';
                st.textContent = 'AUTO (OFF)';
                st.className = 'text-[10px] text-slate-400 mt-0.5 font-bold tracking-wider';
            }
        }
        return;
    }

    if (isAr) {
        if (arState === 1) {
            // Manual LIGADO
            el.className = 'rele-btn bg-emerald-600 rounded-lg p-3 text-center transition-all duration-300 shadow-[0_0_18px_rgba(16,185,129,0.55)] border border-emerald-300 cursor-pointer hover:scale-[1.02]';
            st.textContent = 'MANUAL (ON) ⚡';
            st.className = 'text-[10px] text-emerald-950 bg-emerald-200/90 rounded px-1.5 py-0.5 mt-0.5 font-extrabold tracking-wider inline-block';
        } else if (arState === 2) {
            // Manual DESLIGADO
            el.className = 'rele-btn bg-slate-900 rounded-lg p-3 text-center transition-all duration-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)] cursor-pointer hover:scale-[1.02]';
            st.textContent = 'MANUAL (OFF) 🛑';
            st.className = 'text-[10px] text-rose-400 mt-0.5 font-bold tracking-wider';
        } else {
            // AUTO
            if (isOn) {
                el.className = 'rele-btn bg-cyan-600 rounded-lg p-3 text-center transition-all duration-300 shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-400/50 cursor-pointer hover:scale-[1.02]';
                st.textContent = 'AUTO (ON)';
                st.className = 'text-[10px] text-cyan-100 mt-0.5 font-bold tracking-wider';
            } else {
                el.className = 'rele-btn bg-slate-800 rounded-lg p-3 text-center transition-all duration-300 border border-transparent opacity-85 hover:opacity-100 cursor-pointer hover:scale-[1.02]';
                st.textContent = 'AUTO (OFF)';
                st.className = 'text-[10px] text-slate-400 mt-0.5 font-bold tracking-wider';
            }
        }
        return;
    }

    // Para os demais relés (Umidificador, Vento Interno, Exaustor)
    if (isOn) {
        el.className = 'bg-emerald-600 rounded-lg p-3 text-center transition-all duration-500 shadow-[0_0_15px_rgba(16,185,129,0.4)] border border-emerald-400/50';
        st.textContent = 'ON';
        st.className = 'text-[10px] text-emerald-100 mt-0.5 font-bold tracking-wider';
    } else {
        el.className = 'bg-slate-800 rounded-lg p-3 text-center transition-all duration-500 border border-transparent opacity-80';
        st.textContent = 'OFF';
        st.className = 'text-[10px] text-slate-500 mt-0.5 font-bold tracking-wider';
    }
}

function atualizarCoresDinamicas(ti, ui, te, faseOpt) {
    const cardTi = document.getElementById('cardTi');
    const valTi = document.getElementById('valTi');
    const cardUi = document.getElementById('cardUi');
    const valUi = document.getElementById('valUi');
    const cardTe = document.getElementById('cardTe');
    const valTe = document.getElementById('valTe');

    // --- 1. TEMPERATURA INTERNA (DINÂMICA CONFORME META CLIMÁTICA DA FASE) ---
    if (cardTi && valTi && !isNaN(ti)) {
        let tAlvo = 25.0;
        const fStr = faseOpt || (window.ultimoRegistroRecebido && window.ultimoRegistroRecebido.fase) || (document.getElementById('valFase') ? document.getElementById('valFase').textContent : '');
        if (fStr.includes('Pinagem') && typeof configClima !== 'undefined' && configClima["1"]) {
            tAlvo = parseFloat(configClima["1"].tX) || 28.0;
        } else if (fStr.includes('Frutifica') && typeof configClima !== 'undefined' && configClima["2"]) {
            tAlvo = parseFloat(configClima["2"].tX) || 29.0;
        }

        let glowTi = 'glow-green', borderTi = 'border-emerald-500/30', textTi = 'text-emerald-400';
        if (ti > (tAlvo + 1.0)) {
            // Calor Crítico (Acima da meta + histerese): Vermelho Quente / Ar Condicionado acionado
            glowTi = 'glow-red'; borderTi = 'border-rose-500/40'; textTi = 'text-rose-500';
        } else if (ti > tAlvo) {
            // Acima da meta: Laranja / Aquecendo
            glowTi = 'glow-amber'; borderTi = 'border-amber-500/30'; textTi = 'text-amber-400';
        } else if (ti >= (tAlvo - 2.5)) {
            // Faixa ideal (Alvo atingido): Verde Padrão / Clima Estável
            glowTi = 'glow-green'; borderTi = 'border-emerald-500/30'; textTi = 'text-emerald-400';
        } else {
            // Abaixo da meta: Azul Frio
            glowTi = 'glow-blue'; borderTi = 'border-cyan-500/30'; textTi = 'text-cyan-400';
        }
        cardTi.className = `stat-card glass rounded-xl p-4 md:p-5 ${glowTi} border ${borderTi} transition-all duration-500`;
        valTi.className = `text-2xl md:text-3xl font-extrabold ${textTi} transition-colors duration-500`;
    }

    // --- 2. UMIDADE INTERNA ---
    // < 75%: Vermelho Crítico | 75-84%: Laranja Atenção | 85-91%: Azul Céu/Índigo | >= 92%: Azulão Ideal (95-100%)
    if (cardUi && valUi && !isNaN(ui)) {
        let glowUi = 'glow-blue', borderUi = 'border-blue-500/30', textUi = 'text-blue-400';
        if (ui < 75.0) {
            glowUi = 'glow-red'; borderUi = 'border-rose-500/40'; textUi = 'text-rose-500';
        } else if (ui < 85.0) {
            glowUi = 'glow-amber'; borderUi = 'border-orange-500/30'; textUi = 'text-orange-400';
        } else if (ui < 92.0) {
            glowUi = 'glow-blue'; borderUi = 'border-sky-500/30'; textUi = 'text-sky-400';
        } else {
            glowUi = 'glow-blue'; borderUi = 'border-blue-500/40'; textUi = 'text-blue-400';
        }
        cardUi.className = `stat-card glass rounded-xl p-4 md:p-5 ${glowUi} border ${borderUi} transition-all duration-500`;
        valUi.className = `text-2xl md:text-3xl font-extrabold ${textUi} transition-colors duration-500`;
    }

    // --- 3. TEMPERATURA EXTERNA ---
    if (cardTe && valTe && !isNaN(te)) {
        let glowTe = 'glow-green', borderTe = 'border-slate-700/40', textTe = 'text-slate-300';
        if (te < 20.0) {
            glowTe = 'glow-blue'; borderTe = 'border-cyan-500/20'; textTe = 'text-cyan-400';
        } else if (te <= 26.0) {
            glowTe = 'glow-green'; borderTe = 'border-emerald-500/20'; textTe = 'text-emerald-400';
        } else {
            glowTe = 'glow-red'; borderTe = 'border-rose-500/20'; textTe = 'text-rose-400';
        }
        cardTe.className = `stat-card glass rounded-xl p-4 md:p-5 ${glowTe} border ${borderTe} transition-all duration-500`;
        valTe.className = `text-2xl md:text-3xl font-extrabold ${textTe} transition-colors duration-500`;
    }
}

function formatarDataFW(ts) {
    if (!ts || ts === '0' || ts === 0) return 'Desconhecida';
    const d = new Date(parseInt(ts) * 1000);
    return d.toLocaleString('pt-BR');
}

function navegarView(view) {
    const viewDash = document.getElementById('viewDashboard');
    const viewCfg = document.getElementById('viewConfig');
    const navBtnDash = document.getElementById('navBtnDashboard');
    const navBtnCfg = document.getElementById('navBtnConfig');
    const mobNavDash = document.getElementById('mobNavDashboard');
    const mobNavCfg = document.getElementById('mobNavConfig');
    const hdrDashCtrl = document.getElementById('headerDashboardControls');
    const hdrCfgCtrl = document.getElementById('headerConfigControls');

    if (view === 'config') {
        if (viewDash) viewDash.classList.add('hidden');
        if (viewCfg) {
            viewCfg.classList.remove('hidden');
            viewCfg.classList.remove('fade-in');
            void viewCfg.offsetWidth; // re-trigger animation
            viewCfg.classList.add('fade-in');
        }
        if (navBtnDash) {
            navBtnDash.className = "px-3 py-1 text-xs rounded-md font-semibold tracking-wide flex items-center gap-1.5 transition-all text-slate-400 hover:text-white hover:bg-slate-800";
        }
        if (navBtnCfg) {
            navBtnCfg.className = "px-3 py-1 text-xs rounded-md font-semibold tracking-wide flex items-center gap-1.5 transition-all bg-emerald-600 text-white shadow";
        }
        if (mobNavDash) {
            mobNavDash.className = "flex flex-col items-center justify-center py-1.5 rounded-xl text-slate-400 hover:text-white font-semibold text-[10px] gap-0.5 transition active:scale-95";
        }
        if (mobNavCfg) {
            mobNavCfg.className = "flex flex-col items-center justify-center py-1.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-bold text-[10px] gap-0.5 transition active:scale-95";
        }
        if (hdrDashCtrl) hdrDashCtrl.classList.add('hidden');
        if (hdrCfgCtrl) hdrCfgCtrl.classList.remove('hidden');

        usuarioTrocouSelConfigFase = false;
        atualizarDadosViewConfig();
        fetchConfigClima();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        try { history.replaceState(null, '', '#config'); } catch(e){}
    } else {
        if (viewCfg) viewCfg.classList.add('hidden');
        if (viewDash) viewDash.classList.remove('hidden');
        if (navBtnDash) {
            navBtnDash.className = "px-3 py-1 text-xs rounded-md font-semibold tracking-wide flex items-center gap-1.5 transition-all bg-emerald-600 text-white shadow";
        }
        if (navBtnCfg) {
            navBtnCfg.className = "px-3 py-1 text-xs rounded-md font-semibold tracking-wide flex items-center gap-1.5 transition-all text-slate-400 hover:text-white hover:bg-slate-800";
        }
        if (mobNavDash) {
            mobNavDash.className = "flex flex-col items-center justify-center py-1.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-bold text-[10px] gap-0.5 transition active:scale-95";
        }
        if (mobNavCfg) {
            mobNavCfg.className = "flex flex-col items-center justify-center py-1.5 rounded-xl text-slate-400 hover:text-white font-semibold text-[10px] gap-0.5 transition active:scale-95";
        }
        if (hdrDashCtrl) hdrDashCtrl.classList.remove('hidden');
        if (hdrCfgCtrl) hdrCfgCtrl.classList.add('hidden');

        try { history.replaceState(null, '', '#painel'); } catch(e){}
        setTimeout(() => {
            if (chartUmid) chartUmid.resize();
            if (chartTemp) chartTemp.resize();
            if (chartReles) chartReles.resize();
        }, 50);
    }
}

function isTouchDevice() {
    return (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches)
        || (('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 1024);
}

