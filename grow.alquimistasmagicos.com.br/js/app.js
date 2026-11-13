// ========================================================
// APLICAÇÃO PRINCIPAL: SINCRONIZAÇÃO EM TEMPO REAL E CICLO DE VIDA
// ========================================================

async function carregarDados(limit, forcarCompleto = false) {
try {
const agoraReq = Date.now();
const temHistorico = Array.isArray(window.dadosTelemetriaAtuais) && window.dadosTelemetriaAtuais.length > 5;
const precisaCompleto = forcarCompleto || !temHistorico || (agoraReq - (window.ultimoFetchCompletoTs || 0) >= 45000);
const limitFetch = precisaCompleto ? limit : 1;

// Otimização de rede: verifica firmware a cada 30s ou em comandos pendentes (economiza 50% de requests)
const isPendenteFw = (Date.now() - luzPendenteTempo < 25000) || (Date.now() - arPendenteTempo < 25000) || (Date.now() - fasePendenteTempo < 25000);
const precisaFw = forcarCompleto || isPendenteFw || !window.vFirmware || (agoraReq - ultimoFetchFwTs >= 30000);

const promises = [
            fetchComTimeout(`api/index.php?limit=${limitFetch}&nocache=${agoraReq}`, {}, 8000)
];
if (precisaFw) {
    ultimoFetchFwTs = agoraReq;
            promises.push(fetchComTimeout(`api/fw.php?nocache=${agoraReq}`, {}, 4000).catch(() => null));
}

const [resDados, resFw] = await Promise.all(promises);

        if (resFw && resFw.ok) {
            const fwData = await resFw.json();
            window.fwPlaca = fwData.placa || '0';
            window.fwNuvem = fwData.nuvem || '0';
            window.fwError = fwData.error || '0';
            window.vFirmware = fwData.vFirmware || '';
            window.vFirmwareNuvem = fwData.vFirmwareNuvem || '--';
            window.boardModel = fwData.board || 'ESP32-C3';
            window.canRollback = fwData.canRollback || 0;
            if (fwData.modoLuz !== undefined) {
                window.modoLuzNuvem = parseInt(fwData.modoLuz);
            }
            if (fwData.modoAr !== undefined) {
                window.modoArNuvem = parseInt(fwData.modoAr);
            }
            if (fwData.gitHash && fwData.gitHash !== 'Desconhecido') {
                document.getElementById('txtGitHash').textContent = `Versão: 1.6.9 (${fwData.gitHash})`;
            } else {
                document.getElementById('txtGitHash').textContent = `Versão: 1.6.9`;
            }
            atualizarDadosViewConfig();
        }

        const rawData = await resDados.json();

        if (!rawData || rawData.length === 0) {
            document.getElementById('statusText').textContent = 'Sem dados';
            document.getElementById('dotColor').className = 'w-2 h-2 rounded-full bg-yellow-500 pulse-dot';
            return;
        }

        let data = rawData;
        if (precisaCompleto) {
            window.ultimoFetchCompletoTs = agoraReq;
        } else if (temHistorico) {
            // Mescla o registro mais recente em tempo real no histórico local sem precisar baixar 1440 linhas
            const novoPonto = rawData[rawData.length - 1];
            const hist = window.dadosTelemetriaAtuais.slice();
            const ultHist = hist[hist.length - 1];
            const minNovo = (novoPonto.timestamp || '').slice(0, 16);
            const minUlt = (ultHist.timestamp || '').slice(0, 16);
            if (minNovo && minNovo === minUlt) {
                hist[hist.length - 1] = novoPonto;
            } else {
                hist.push(novoPonto);
                if (hist.length > limit) hist.shift();
            }
            data = hist;
        }

        const ultimo = data[data.length - 1];

        // Última atualização & Status Online Real (Tolerância de 3 minutos)
        let tsAbsoluto = ultimo.unix_ts ? (ultimo.unix_ts * 1000) : new Date(ultimo.timestamp.replace(' ', 'T')).getTime();
        let diffMinutos = Math.max(0, Math.round((Date.now() - tsAbsoluto) / 60000));
        document.getElementById('valUltimaAtt').textContent = (diffMinutos === 0 ? 'Agora mesmo' : 'Atualizado há ' + diffMinutos + ' min');

        if (diffMinutos <= 3) {
            document.getElementById('statusText').textContent = 'Online';
            document.getElementById('statusText').className = 'text-slate-300 font-semibold';
            document.getElementById('dotColor').className = 'w-2 h-2 rounded-full bg-emerald-500 pulse-dot';
        } else {
            document.getElementById('statusText').textContent = `Offline (${diffMinutos}m)`;
            document.getElementById('statusText').className = 'text-rose-400 font-semibold';
            document.getElementById('dotColor').className = 'w-2 h-2 rounded-full bg-rose-500 pulse-dot';
        }

        // Cards
        const ti = parseFloat(ultimo.temp_int);
        const ui = parseFloat(ultimo.hum_int);
        const te = parseFloat(ultimo.temp_ext);
        const ue = parseFloat(ultimo.hum_ext);

        document.getElementById('valTi').textContent = Number.isFinite(ti) ? (ti.toFixed(1) + ' °C') : '-- °C';
        document.getElementById('valUi').textContent = Number.isFinite(ui) ? (ui.toFixed(1) + ' %') : '-- %';
        document.getElementById('valTe').textContent = Number.isFinite(te) ? (te.toFixed(1) + ' °C') : '-- °C';
        document.getElementById('valUe').textContent = Number.isFinite(ue) ? ('Umid: ' + ue.toFixed(1) + ' %') : 'Umid: -- %';
        
        // Aplica paleta dinâmica nos cards
        window.ultimoRegistroRecebido = ultimo;
        atualizarCoresDinamicas(ti, ui, te, ultimo.fase);
        checarAlertasCriticos(ultimo, diffMinutos);
        
        let agoraTime = Date.now();
        
        // Desbloqueio Inteligente
        // Se a placa já respondeu e atualizou o banco com a fase exata que pedimos, destravamos a UI imediatamente!
        if (fasePendenteAlvo && ultimo.fase === fasePendenteAlvo) {
            fasePendenteTempo = 0;
            fasePendenteAlvo = null;
        }

        // Se não tem pendência ativa (ou já destravou, ou passou 25s)
        if (agoraTime - fasePendenteTempo > 25000) {
            let f_str = ultimo.fase || '--';
            document.getElementById('valFase').textContent = f_str;
            
            let f_limpa = f_str.replace(' (DHT OFFLINE)', '').replace('ALERTA: SHT30 OFFLINE', 'Standby');
            atualizarBotoesFase(f_limpa, false);
            fasePendenteAlvo = null; // limpa por precaução
            sincronizarUiMetaAr();
            sincronizarUiSifaoRetorno();
            sincronizarUiSifaoDelta();
            sincronizarUiEvap();
        }

        // Min/Max do período com indicador de Meta Alvo
        let minT = Infinity, maxT = -Infinity, minH = Infinity, maxH = -Infinity;
        data.forEach(d => {
            const t = parseFloat(d.temp_int); const h = parseFloat(d.hum_int);
            if (t > -40 && t < 60) { if (t < minT) minT = t; if (t > maxT) maxT = t; }
            if (h > 0 && h <= 100) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
        });
        let tAlvoAtual = 25.0;
        const fStrAt = ultimo.fase || '';
        if (fStrAt.includes('Pinagem') && typeof configClima !== 'undefined' && configClima["1"]) {
            tAlvoAtual = parseFloat(configClima["1"].tX) || 28.0;
        } else if (fStrAt.includes('Frutifica') && typeof configClima !== 'undefined' && configClima["2"]) {
            tAlvoAtual = parseFloat(configClima["2"].tX) || 29.0;
        }
        document.getElementById('minMaxTemp').textContent = `Min ${minT === Infinity ? '--' : minT.toFixed(1)}° / Max ${maxT === -Infinity ? '--' : maxT.toFixed(1)}° (Alvo: ≤ ${tAlvoAtual.toFixed(1)}°)`;
        document.getElementById('minMaxHum').textContent = `Min ${minH === Infinity ? '--' : minH.toFixed(1)}% / Max ${maxH === -Infinity ? '--' : maxH.toFixed(1)}%`;

        // Sincronização Inteligente do Modo da Luz com o Servidor
        if (luzPendenteTempo === 0 || agoraTime - luzPendenteTempo > 20000) {
            if (window.modoLuzNuvem !== undefined) {
                luzState = window.modoLuzNuvem;
            } else if (ultimo.modo_luz !== undefined) {
                luzState = parseInt(ultimo.modo_luz);
            }
            atualizarBotoesLuz(luzState);
        }

        // Sincronização Inteligente do Modo do Ar Condicionado com o Servidor
        if (arPendenteTempo === 0 || agoraTime - arPendenteTempo > 20000) {
            if (window.modoArNuvem !== undefined) {
                arState = window.modoArNuvem;
            } else if (ultimo.modo_ar !== undefined) {
                arState = parseInt(ultimo.modo_ar);
            }
            atualizarBotoesAr(arState);
        }

        // Desbloqueio Inteligente da Luz
        if (luzPendenteTempo > 0) {
            if (luzState === 1 && parseInt(ultimo.rele_luz) === 1) {
                luzPendenteTempo = 0;
                atualizarBotoesLuz(1);
            } else if (luzState === 2 && parseInt(ultimo.rele_luz) === 0) {
                luzPendenteTempo = 0;
                atualizarBotoesLuz(2);
            } else if (luzState === 0 && (agoraTime - luzPendenteTempo > 3000)) {
                luzPendenteTempo = 0; 
                atualizarBotoesLuz(0);
            }
        }

        // Desbloqueio Inteligente do Ar Condicionado
        if (arPendenteTempo > 0) {
            if (arState === 1 && parseInt(ultimo.rele_ar) === 1) {
                arPendenteTempo = 0;
                atualizarBotoesAr(1);
            } else if (arState === 2 && parseInt(ultimo.rele_ar) === 0) {
                arPendenteTempo = 0;
                atualizarBotoesAr(2);
            } else if (arState === 0 && (agoraTime - arPendenteTempo > 3000)) {
                arPendenteTempo = 0;
                atualizarBotoesAr(0);
            }
        }

        // Relés — protege Luz e Ar de sobrescrever estado durante a pendência (20s)
        if (agoraTime - luzPendenteTempo > 20000 || luzPendenteTempo === 0) {
            setRele('releLuz', 'releLuzStatus', parseInt(ultimo.rele_luz));
            atualizarBotoesLuz(luzState);
        }
        setRele('releUmid', 'releUmidStatus', parseInt(ultimo.rele_umid));
        setRele('releVento', 'releVentoStatus', parseInt(ultimo.rele_vento));
        setRele('releExaust', 'releExaustStatus', parseInt(ultimo.rele_exaust));
        if (agoraTime - arPendenteTempo > 20000 || arPendenteTempo === 0) {
            setRele('releAr', 'releArStatus', parseInt(ultimo.rele_ar || 0));
            atualizarBotoesAr(arState);
        }
        // setRele('releVentoExt', 'releVentoExtStatus', parseInt(ultimo.rele_vento_ext || 0));

        // Processa o cérebro / protocolo da Sistema
        atualizarStatusProtocolos(ultimo);
        window.ultimoRegistroRecebido = ultimo;
        window.dadosTelemetriaAtuais = data;
        atualizarTimersProtocolo();
        calcularResumoAtividades(data);

        // OTIMIZAÇÃO ZERO-LAG: Cache inteligente de dados (inclui configClima para refletir edições em tempo real)
        const cfgHash = configClima ? JSON.stringify(configClima) : '';
        const chaveDados = `${ultimo.id}_${ultimo.timestamp}_${ultimo.fase}_${ultimo.rele_luz}_${ultimo.rele_umid}_${ultimo.rele_vento}_${ultimo.rele_exaust}_${ultimo.rele_ar}_${data.length}_${limit}_${arState}_${luzState}_${cfgHash}`;
        if (window.ultimoCacheGrafico === chaveDados) {
            return;
        }
        window.ultimoCacheGrafico = chaveDados;

        // Calcula tempo total ativo de cada relé respeitando o filtro ativo (24h ou 7 Dias)
        calcularTempoReles(data);

        // Preparar séries para o gráfico combinado Chart.js
        // Se for 7 dias (limit > 1440), agrupa a cada 5 minutos para performance máxima sem perda de fidelidade
        const porIntervalo = new Map();
        const passoMin = (limit > 1440) ? 5 : 1;
        const passoMs = passoMin * 60000;

        data.forEach((d, idx) => {
            const ts = d.unix_ts ? d.unix_ts * 1000 : new Date(d.timestamp.replace(' ', 'T')).getTime();
            const blocoChave = Math.floor(ts / passoMs) * passoMs;
            const prev = porIntervalo.get(blocoChave);
            if (!prev || idx === data.length - 1) {
                porIntervalo.set(blocoChave, { ...d, unix_ts_min: blocoChave });
            } else if (passoMin === 1) {
                // Em 24h (1 min), mantém sempre a leitura/estado mais recente dentro daquele minuto
                porIntervalo.set(blocoChave, { ...d, unix_ts_min: blocoChave });
            } else {
                // Em 7 Dias (5 min), atualiza sensores para o último ponto e preserva pulsos ON de relés no bloco
                porIntervalo.set(blocoChave, {
                    ...d,
                    unix_ts_min: blocoChave,
                    rele_luz: (parseInt(prev.rele_luz) === 1 || parseInt(d.rele_luz) === 1) ? 1 : 0,
                    rele_umid: (parseInt(prev.rele_umid) === 1 || parseInt(d.rele_umid) === 1) ? 1 : 0,
                    rele_vento: (parseInt(prev.rele_vento) === 1 || parseInt(d.rele_vento) === 1) ? 1 : 0,
                    rele_exaust: (parseInt(prev.rele_exaust) === 1 || parseInt(d.rele_exaust) === 1) ? 1 : 0,
                    rele_ar: (parseInt(prev.rele_ar) === 1 || parseInt(d.rele_ar) === 1) ? 1 : 0
                });
            }
        });
        const amostras = Array.from(porIntervalo.values());

        const dTempInt = [], dTempExt = [], dTempProj = [], dTempExtProj = [];
        const dHumInt = [], dHumExt = [], dHumIntProj = [], dHumExtProj = [];
        const dLuz = [], dUmid = [], dVento = [], dExaust = [], dAr = [];

        let lastTi = null, lastTe = null, lastHi = null, lastHe = null;

        amostras.forEach(d => {
            const ts = d.unix_ts_min || (d.unix_ts ? d.unix_ts * 1000 : new Date(d.timestamp.replace(' ', 'T')).getTime());
            const tI = parseFloat(d.temp_int);
            const tE = parseFloat(d.temp_ext);
            const hI = parseFloat(d.hum_int);
            const hE = parseFloat(d.hum_ext);

            if (tI > -40 && tI < 60) lastTi = tI;
            if (tE > -40 && tE < 60) lastTe = tE;
            if (hI > 0 && hI <= 100) lastHi = hI;
            if (hE > 0 && hE <= 100) lastHe = hE;

            dTempInt.push({ x: ts, y: lastTi });
            dTempExt.push({ x: ts, y: lastTe });
            dTempProj.push({ x: ts, y: null });
            dTempExtProj.push({ x: ts, y: null });
            dHumInt.push({ x: ts, y: (hI > 0 && hI <= 100) ? hI : null });
            dHumExt.push({ x: ts, y: (hE > 0 && hE <= 100) ? hE : null });
            dHumIntProj.push({ x: ts, y: null });
            dHumExtProj.push({ x: ts, y: null });

            // Relés em 5 pistas horizontais independentes (Swimlanes):
            // Pista 4 = Ar Condicionado [3.65, 4.35]
            // Pista 3 = Luz [2.65, 3.35]
            // Pista 2 = Umidificador [1.65, 2.35]
            // Pista 1 = Vento Interno [0.65, 1.35]
            // Pista 0 = Exaustor [-0.35, 0.35]
            const rLuz = parseInt(d.rele_luz) === 1 ? [2.65, 3.35] : null;
            const rUmid = parseInt(d.rele_umid) === 1 ? [1.65, 2.35] : null;
            const rVento = parseInt(d.rele_vento) === 1 ? [0.65, 1.35] : null;
            const rExaust = parseInt(d.rele_exaust) === 1 ? [-0.35, 0.35] : null;
            const rAr = parseInt(d.rele_ar) === 1 ? [3.65, 4.35] : null;

            dLuz.push({ x: ts, y: rLuz });
            dUmid.push({ x: ts, y: rUmid });
            dVento.push({ x: ts, y: rVento });
            dExaust.push({ x: ts, y: rExaust });
            dAr.push({ x: ts, y: rAr });
        });


// Chama motor preditivo térmico isolado (Gráfico Fantasma)
const proj = calcularProjecaoTermica({
    data,
    amostras,
    passoMin,
    passoMs,
    dTempInt,
    dTempExt,
    dTempProj,
    dTempExtProj,
    dHumInt,
    dHumExt,
    dHumIntProj,
    dHumExtProj,
    dLuz,
    dUmid,
    dVento,
    dExaust,
    dAr,
    lastTi,
    lastTe,
    lastHi,
    lastHe
});
const tEnd = proj.tEnd;

        if (chartUmid && chartTemp && chartReles) {
            chartTemp.data.datasets[0].data = dTempInt;
            chartTemp.data.datasets[1].data = dTempExt;
            chartTemp.data.datasets[2].data = dTempProj;
            chartTemp.data.datasets[3].data = dTempExtProj;
            chartUmid.data.datasets[0].data = dHumInt;
            chartUmid.data.datasets[1].data = dHumExt;
            chartUmid.data.datasets[2].data = dHumIntProj;
            chartUmid.data.datasets[3].data = dHumExtProj;
            chartReles.data.datasets[0].data = dLuz;
            chartReles.data.datasets[1].data = dUmid;
            chartReles.data.datasets[2].data = dVento;
            chartReles.data.datasets[3].data = dExaust;
            chartReles.data.datasets[4].data = dAr;

            // Atualiza limites de zoom/pan para impedir que o usuário se perca no vazio
            const tsPrimeiro = data[0].unix_ts ? (data[0].unix_ts * 1000) : new Date(data[0].timestamp.replace(' ', 'T')).getTime();
            const minAbsoluto = tsPrimeiro - 3600000; // 1h de respiro antes do primeiro dado
            const maxAbsoluto = tEnd + 3600000;       // 1h de respiro depois da projeção futura
            
            [chartTemp, chartUmid, chartReles].forEach(c => {
                if (c.options.plugins.zoom.limits) {
                    c.options.plugins.zoom.limits.x.min = minAbsoluto;
                    c.options.plugins.zoom.limits.x.max = maxAbsoluto;
                }
            });

            // Atualização atômica única (evita render duplo desnecessário)
            if (!zoomManualUsuario) {
                aplicarZoom3Horas();
            } else {
                chartTemp.update('none');
                chartUmid.update('none');
                chartReles.update('none');
            }

            if (lastHoverIdx >= 0 && isTouchDevice()) {
                atualizarInspetorGrafico(lastHoverIdx);
            }
        }

    } catch (err) {
        console.error("Erro ao carregar dados:", err);
        document.getElementById('statusText').textContent = 'Erro';
        document.getElementById('dotColor').className = 'w-2 h-2 rounded-full bg-red-500 pulse-dot';
    }
}


async function loopDados(forceDelay = null) {
    const myGen = ++loopGen;
    if (loopTimeout) { clearTimeout(loopTimeout); loopTimeout = null; }
    await carregarDados(limitAtual);
    if (myGen !== loopGen) return; // Impede loops duplicados quando usuário troca de aba ou clica em botões

    // Sincroniza a cada 1.2s se tiver comando pendente, ou 3s em operação normal (usando delta leve limit=1)
    // Se aba estiver em segundo plano (document.hidden), reduz para 30s para economizar bateria e dados móveis
    let isPendente = (Date.now() - luzPendenteTempo < 25000) || (Date.now() - arPendenteTempo < 25000) || (Date.now() - fasePendenteTempo < 25000);
    let delayPadrao = document.hidden ? 30000 : 3000;
    let delay = forceDelay || (isPendente ? 1200 : delayPadrao);
    if (loopTimeout) clearTimeout(loopTimeout);
    loopTimeout = setTimeout(() => loopDados(), delay);
}

// Ao desbloquear o celular ou retornar para a aba, puxa dados imediatamente!
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        buscarClimaLocal();
        loopDados(100);
    }
});

function initCosmicNetwork() {
    const canvas = document.getElementById('canvasCosmic');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }, 150);
    }, { passive: true });

    const count = (w < 768) ? 22 : 42;
    const particles = [];
    const colors = ['#34d399', '#38bdf8', '#818cf8', '#cbd5e1'];

    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25,
            r: Math.random() * 1.4 + 0.7,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: Math.random() * 0.35 + 0.2,
            phase: Math.random() * Math.PI * 2,
            phaseSpeed: Math.random() * 0.02 + 0.01
        });
    }

    const maxDist = 130;
    const maxDistSq = maxDist * maxDist;

    function animate() {
        if (document.hidden) {
            requestAnimationFrame(animate);
            return;
        }

        ctx.clearRect(0, 0, w, h);

        // Linhas / Conexões Cósmico-Miceliais
        for (let i = 0; i < count; i++) {
            const p1 = particles[i];
            p1.x += p1.vx;
            p1.y += p1.vy;

            if (p1.x < -15) p1.x = w + 15;
            else if (p1.x > w + 15) p1.x = -15;
            if (p1.y < -15) p1.y = h + 15;
            else if (p1.y > h + 15) p1.y = -15;

            for (let j = i + 1; j < count; j++) {
                const p2 = particles[j];
                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < maxDistSq) {
                    const lineAlpha = (1 - Math.sqrt(distSq) / maxDist) * 0.12;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(56, 189, 248, ${lineAlpha})`;
                    ctx.lineWidth = 0.75;
                    ctx.stroke();
                }
            }
        }

        // Partículas (Esporos Estelares)
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            p.phase += p.phaseSpeed;
            const a = p.alpha + Math.sin(p.phase) * 0.12;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0.08, Math.min(1, a));
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // No mobile (<768px), desenha 1 quadro estático para zerar carga de GPU/bateria em telas 120Hz
        if (w >= 768) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

window.onload = () => {
    initCosmicNetwork();
    atualizarBtnNotificacoes();
    setInterval(atualizarTimersProtocolo, 1000);
    
    // Navegação por Hash do navegador (ex: #config ou #painel)
    window.addEventListener('popstate', () => {
        if (window.location.hash.includes('config')) {
            navegarView('config');
        } else {
            navegarView('dashboard');
        }
    });
    if (window.location.hash.includes('config')) {
        navegarView('config');
    }

    buscarClimaLocal();
    setInterval(() => buscarClimaLocal(), 30 * 60 * 1000);

    fetchConfigClima().then(() => {
        initCharts();
        loopDados(); // Inicia o motor em tempo real
        
        // Duplo clique no gráfico alterna entre foco de 3h e visão completa
        ['canvasUmid', 'canvasTemp', 'canvasReles'].forEach(id => {
            document.getElementById(id).addEventListener('dblclick', toggleZoomRange);
        });
    });
};
