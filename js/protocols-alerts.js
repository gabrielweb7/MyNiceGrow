// ========================================================
// PROTOCOLOS BIOLÓGICOS, TIMERS, VPD, RESUMO, CSV E ALERTAS
// ========================================================

function atualizarStatusProtocolos(ultimo) {
    let status = "✅ Clima Estabilizado";
    let desc = "Todos os parâmetros estão dentro da meta para a fase atual.";
    let cor = "text-emerald-400";
    
    const tI = parseFloat(ultimo.temp_int);
    const uI = parseFloat(ultimo.hum_int);
    const tE = parseFloat(ultimo.temp_ext);
    const rLuz = parseInt(ultimo.rele_luz);
    const rUmid = parseInt(ultimo.rele_umid);
    const rVento = parseInt(ultimo.rele_vento);
    const rExaust = parseInt(ultimo.rele_exaust);
    const rAr = parseInt(ultimo.rele_ar || 0);
    const rVentoExt = parseInt(ultimo.rele_vento_ext || 0);
    
    let faseLimpa = (ultimo.fase || '--').replace(' (DHT OFFLINE)', '').replace('ALERTA: SHT30 OFFLINE', 'Standby');
    
    let cId = "1";
    if (faseLimpa === "Pinagem") cId = "1";
    else if (faseLimpa === "Frutificacao") cId = "2";
    else if (faseLimpa === "Secagem Total") cId = "4";
    
    const cfg = (typeof configClima !== 'undefined' && configClima[cId]) ? configClima[cId] : null;
    const hvacCfg = (typeof configClima !== 'undefined' && configClima.hvac) ? configClima.hvac : {};
    const tempCorteLuzCfg = (hvacCfg.tCorteLuz !== undefined) ? parseFloat(hvacCfg.tCorteLuz) : 34.0;
    const tEvapPreCfg = (hvacCfg.tEvapPre !== undefined) ? parseInt(hvacCfg.tEvapPre, 10) : 4;
    const tEvapAntCfg = (hvacCfg.tEvapAnt !== undefined) ? parseFloat(hvacCfg.tEvapAnt) : 0.3;
    const tDeltaSaidaCfg = (hvacCfg.tDeltaSaida !== undefined) ? parseFloat(hvacCfg.tDeltaSaida) : 0.1;
    const tempMax = cfg ? parseFloat(cfg.tX) : 35.0;
    const umidAlvo = cfg ? parseFloat(cfg.uA || cfg.uN || 95.0) : 95.0;
    const emFaixaEvap = (tEvapPreCfg > 0 && !isNaN(tI) && tI >= (tempMax - tEvapAntCfg) && tI < (tempMax + 0.4));

    if (faseLimpa === "Standby") {
        status = "💤 Modo Standby"; desc = "Estufa inativa aguardando comandos."; cor = "text-slate-400";
    } else if (faseLimpa === "Secagem Total") {
        status = "🏜️ Secagem Total Ativa"; desc = "Umidificador travado e fluxo contínuo de ar para desidratar a estufa."; cor = "text-amber-400";
    } else if (tI >= tempCorteLuzCfg && rLuz === 0) {
        status = "🔥 Corte Térmico de Emergência"; desc = `Temperatura crítica (≥ ${tempCorteLuzCfg.toFixed(1)}°C)! Luz desligada preventivamente.`; cor = "text-rose-500";
    } else if (rAr === 1) {
        if (rExaust === 1) {
            status = "❄️💨 Climatização Ativa: Injeção de Ar Frio";
            desc = "Ar Condicionado refrigerando a sala; exaustor puxando ar frio com proteção contínua de umidade.";
            cor = "text-cyan-300";
        } else {
            status = "❄️ Refrigeração da Sala em Andamento";
            desc = "Ar Condicionado ligado para abaixar a temperatura ambiente antes da injeção.";
            cor = "text-cyan-400";
        }
    } else if (rExaust === 1) {
        const fOnM = cfg && cfg.fO !== undefined ? parseInt(cfg.fO, 10) : 2;
        const fOffM = cfg && cfg.fF !== undefined ? parseInt(cfg.fF, 10) : 40;
        const agoraSegSt = Math.floor(Date.now() / 1000);
        const cycSec = (fOnM + fOffM) * 60;
        const emFaeSt = (fOnM > 0 && (fOffM === 0 || (cycSec > 0 && (agoraSegSt % cycSec) < (fOnM * 60))));
        if (emFaeSt) {
            status = "💨 Troca de Ar (FAE)";
            desc = "Expulsando o CO2 acumulado e trazendo oxigênio fresco conforme o ciclo programado.";
            cor = "text-teal-400";
        } else if (emFaixaEvap && !isNaN(tE) && tE > (tI - tDeltaSaidaCfg)) {
            status = "💧🌀 Pré-Resfriamento Evaporativo (Onda Seca)";
            desc = `Evaporando umidade acumulada antes de ligar o AC (Int: ${tI.toFixed(1)}°C).`;
            cor = "text-emerald-300";
        } else {
            status = "❄️💨 Pós-AC: Puxando Ar Frio";
            desc = "Aproveitando o ar frio residual do quarto após o desligamento do AC com guarda contínua de umidade.";
            cor = "text-cyan-300";
        }
    } else if (rVento === 1) {
        if (rUmid === 1) {
            if (emFaixaEvap) {
                status = "💧🌀 Pré-Resfriamento Evaporativo (Névoa Fria)";
                desc = `Tentando resfriar a estufa por evaporação antes do AC (Int: ${tI.toFixed(1)}°C).`;
                cor = "text-emerald-300";
            } else {
                status = "🌀 Vento Interno com Névoa em Execução";
                desc = "Ciclo programado de circulação interna com injeção de névoa viva para oxigenar e hidratar.";
                cor = "text-cyan-300";
            }
        } else {
            status = "🌀 Vento Interno Preventivo em Execução";
            desc = "Ciclo programado de circulação interna para quebrar bolsões de CO2 pesado acumulados no fundo.";
            cor = "text-indigo-400";
        }
    } else if (rUmid === 1) {
        status = "💧 Injeção de Névoa no Alvo";
        desc = `Umidificador acionado para atingir a umidade alvo (${umidAlvo}%).`;
        cor = "text-blue-300";
    } else {
        if (tI >= tempMax) {
            status = "🌡️ Temperatura Acima do Alvo";
            desc = `Temperatura interna (${tI.toFixed(1)}°C) no limite programado (${tempMax}°C). Climatização em espera / anti-ciclo curto.`;
            cor = "text-amber-400";
        } else {
            status = "✅ Clima Estabilizado";
            desc = "Todos os parâmetros estão dentro da meta para a fase atual.";
            cor = "text-emerald-400";
        }
    }

    // Indicador dinâmico no card de Brisa Interna
    const cardVento = document.getElementById('infoFaseVento');
    if (cardVento) {
        const cicloPadrao = cardVento.getAttribute('data-ciclo') || cardVento.textContent;
        if (!cardVento.getAttribute('data-ciclo')) cardVento.setAttribute('data-ciclo', cicloPadrao);

        if (rVento === 1 && rExaust === 0) {
            cardVento.innerHTML = `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold animate-pulse">● Executando Agora!</span> <span class="text-[10px] text-slate-400 block mt-0.5">${cardVento.getAttribute('data-ciclo')}</span>`;
        } else {
            cardVento.textContent = cardVento.getAttribute('data-ciclo');
        }
    }

    // Indicador dinâmico no card de Renovação de Ar (FAE)
    const cardFae = document.getElementById('infoFaseFae');
    if (cardFae) {
        const cicloPadraoFae = cardFae.getAttribute('data-ciclo') || cardFae.textContent;
        if (!cardFae.getAttribute('data-ciclo')) cardFae.setAttribute('data-ciclo', cicloPadraoFae);

        if (rExaust === 1) {
            cardFae.innerHTML = `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold animate-pulse">● Executando Agora!</span> <span class="text-[10px] text-slate-400 block mt-0.5">${cardFae.getAttribute('data-ciclo')}</span>`;
        } else {
            cardFae.textContent = cardFae.getAttribute('data-ciclo');
        }
    }

    document.getElementById('iaStatus').textContent = status;
    document.getElementById('iaStatus').className = `font-bold text-base md:text-lg transition-colors ${cor}`;
    document.getElementById('iaDesc').textContent = desc;
}

// =======================================================
// 1. DÉFICIT DE PRESSÃO DE VAPOR (VPD BIOLÓGICO)
// =======================================================
// Fórmula de Tetens (padrão FAO/WMO):
// SVP (kPa) = 0.61078 * exp((17.27 * T) / (T + 237.3))
// VPD (kPa) = SVP * (1 - (RH / 100))
function calcularVpd(t, h) {
    if (isNaN(t) || isNaN(h) || h <= 0) return null;
    const svp = 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
    const vpd = svp * (1 - (h / 100));
    return Math.max(0, vpd);
}

// =======================================================
// 2. CONTADORES REGRESSIVOS E PREVISÃO DOS PROTOCOLOS
// =======================================================
function formatarMinSeg(segundos) {
    if (segundos < 0) segundos = 0;
    const totalMin = Math.floor(segundos / 60);
    if (totalMin >= 60) {
        const h = Math.floor(totalMin / 60);
        const mRest = totalMin % 60;
        return mRest > 0 ? `${h}h ${mRest}m` : `${h}h`;
    }
    const m = totalMin;
    const s = Math.floor(segundos % 60);
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
}

function atualizarTimersProtocolo() {
    if (!window.ultimoRegistroRecebido) return;
    const ultimo = window.ultimoRegistroRecebido;
    const elAcao = document.getElementById('iaTempoAcao');
    const elFae = document.getElementById('iaProximoFae');
    const elBri = document.getElementById('iaProximaBrisa');
    if (!elAcao || !elFae || !elBri) return;

    let faseLimpa = (ultimo.fase || '--').replace(' (DHT OFFLINE)', '').replace('ALERTA: SHT30 OFFLINE', 'Standby');
    if (faseLimpa === 'Standby' || faseLimpa === 'Secagem Total') {
        elAcao.textContent = faseLimpa === 'Standby' ? 'Estufa em Standby' : 'Secagem Contínua Ativa';
        elFae.textContent = 'Inativo';
        elBri.textContent = 'Inativo';
        const elArSt = document.getElementById('iaProximoAr');
        if (elArSt) elArSt.textContent = (arState === 1) ? 'Manual ON' : ((arState === 2) ? 'Manual OFF' : 'Inativo');
        return;
    }

    let cId = "1";
    if (faseLimpa === "Pinagem") cId = "1";
    else if (faseLimpa === "Frutificacao") cId = "2";

    const cfg = (typeof configClima !== 'undefined' && configClima[cId]) ? configClima[cId] : { fO: 2, fF: 40, vO: 1, vF: 2 };
    const numCfg = (val, def) => {
        const n = parseInt(val, 10);
        return Number.isFinite(n) ? Math.max(0, n) : def;
    };
    const faeOnSec = numCfg(cfg.fO, 2) * 60;
    const faeOffSec = numCfg(cfg.fF, 30) * 60;
    const cicloFaeSec = faeOnSec + faeOffSec;

    const ventoOnSec = numCfg(cfg.vO, 1) * 60;
    const ventoOffSec = numCfg(cfg.vF, 2) * 60;
    const cicloVentoSec = ventoOnSec + ventoOffSec;

    // Telemetria real dos relés confirmada diretamente pela placa ESP32
    const rExaust = parseInt(ultimo.rele_exaust);
    const rVento = parseInt(ultimo.rele_vento);
    const rUmid = parseInt(ultimo.rele_umid);

    const lblFae = document.getElementById('lblFae');
    const lblBrisa = document.getElementById('lblBrisa');

    const agoraSeg = Math.floor(Date.now() / 1000);

    // Sincronia de Renovação de Ar (FAE)
    if (rExaust === 1) {
        if (faeOnSec > 0 && faeOffSec === 0) {
            if (lblFae) lblFae.textContent = '💨 FAE Ativo:';
            elFae.innerHTML = `<span class="text-emerald-400 font-bold animate-pulse">● Renovação Contínua</span>`;
        } else {
            const momentoFae = cicloFaeSec > 0 ? (agoraSeg % cicloFaeSec) : 0;
            const emJanelaFae = (faeOnSec > 0 && momentoFae < faeOnSec);
            if (emJanelaFae) {
                if (lblFae) lblFae.textContent = '💨 FAE Ativo:';
                const restFae = Math.max(1, faeOnSec - momentoFae);
                elFae.innerHTML = `<span class="text-emerald-400 font-bold animate-pulse">● Renovando Ar (~${formatarMinSeg(restFae)})</span>`;
            } else {
                if (lblFae) lblFae.textContent = '🌬️ Exaustor:';
                elFae.innerHTML = `<span class="text-cyan-300 font-bold animate-pulse">● Puxando Ar Frio</span>`;
            }
        }
    } else if (faeOnSec === 0) {
        if (lblFae) lblFae.textContent = '💨 FAE:';
        elFae.textContent = 'Desativado';
    } else if (faeOffSec === 0) {
        if (lblFae) lblFae.textContent = '💨 FAE:';
        elFae.textContent = 'Contínuo (aguard.)';
    } else {
        if (lblFae) lblFae.textContent = '💨 Próximo FAE:';
        const momentoFae = agoraSeg % cicloFaeSec;
        const proxFae = cicloFaeSec - momentoFae;
        elFae.textContent = `em ~${formatarMinSeg(proxFae)}`;
    }

    // Sincronia da Brisa Interna (Ventilador)
    if (rVento === 1) {
        if (lblBrisa) lblBrisa.textContent = '🌀 Brisa Ativa:';
        if (ventoOnSec > 0 && ventoOffSec === 0) {
            elBri.innerHTML = `<span class="text-cyan-400 font-bold animate-pulse">● Soprando (Contínuo)</span>`;
        } else {
            const momentoVento = cicloVentoSec > 0 ? (agoraSeg % cicloVentoSec) : 0;
            if (ventoOnSec > 0 && momentoVento < ventoOnSec) {
                const restVento = Math.max(1, ventoOnSec - momentoVento);
                elBri.innerHTML = `<span class="text-cyan-400 font-bold animate-pulse">● Soprando (~${formatarMinSeg(restVento)})</span>`;
            } else {
                elBri.innerHTML = `<span class="text-cyan-400 font-bold animate-pulse">● Soprando (Umidade/Defesa)</span>`;
            }
        }
    } else if (ventoOnSec === 0) {
        if (lblBrisa) lblBrisa.textContent = '🌀 Brisa Interna:';
        elBri.textContent = 'Desativada';
    } else if (ventoOffSec === 0) {
        if (lblBrisa) lblBrisa.textContent = '🌀 Brisa Interna:';
        elBri.textContent = 'Contínua (aguard.)';
    } else {
        if (lblBrisa) lblBrisa.textContent = '🌀 Próxima Brisa:';
        const momentoVento = agoraSeg % cicloVentoSec;
        const proxVento = cicloVentoSec - momentoVento;
        elBri.textContent = `em ~${formatarMinSeg(proxVento)}`;
    }

    // Ação Geral em Tempo Real (Pill 1)
    if (rExaust === 1) {
        const emJanelaFaeAgora = (faeOnSec > 0 && (faeOffSec === 0 || (cicloFaeSec > 0 && (agoraSeg % cicloFaeSec) < faeOnSec)));
        elAcao.innerHTML = emJanelaFaeAgora
            ? `<span class="text-teal-300 font-bold">Troca de Ar (FAE)</span>`
            : `<span class="text-cyan-300 font-bold">Sifão de Ar Frio</span>`;
    } else if (rVento === 1) {
        const msg = (rUmid === 1) ? 'Brisa com Névoa' : 'Brisa Preventiva';
        elAcao.innerHTML = `<span class="text-cyan-300 font-bold">${msg}</span>`;
    } else if (rUmid === 1) {
        elAcao.innerHTML = `<span class="text-blue-300 font-bold">Injeção de Névoa</span>`;
    } else {
        elAcao.innerHTML = `<span class="text-emerald-400 font-medium">Clima Equilibrado</span>`;
    }

    // Previsão de Acionamento do Ar Condicionado (Pill 4)
    const elArPrev = document.getElementById('iaProximoAr');
    const lblArPrev = document.getElementById('lblArPrev');
    const pAr = window.previsaoArInfo;
    if (elArPrev && lblArPrev) {
        if (arState === 1) {
            lblArPrev.textContent = '❄️ Ar Cond.:';
            elArPrev.innerHTML = `<span class="text-cyan-300 font-bold">Manual ON</span>`;
        } else if (arState === 2) {
            lblArPrev.textContent = '❄️ Ar Cond.:';
            elArPrev.innerHTML = `<span class="text-slate-400 font-medium">Manual OFF</span>`;
        } else if (!pAr || pAr.status === 'inativo') {
            lblArPrev.textContent = '❄️ Ar Cond.:';
            elArPrev.textContent = 'Inativo';
        } else if (pAr.status === 'ligado') {
            lblArPrev.textContent = '❄️ AC Ligado:';
            const restLive = pAr.tDesliga ? Math.max(1, Math.round((pAr.tDesliga - Date.now()) / 60000)) : pAr.restanteMin;
            const restTxt = (restLive !== null && restLive > 0) ? `~${restLive}m rest.` : 'Estabilizando';
            elArPrev.innerHTML = `<span class="text-cyan-400 font-bold animate-pulse">● Ativo (${restTxt})</span>`;
        } else if (pAr.status === 'agendado' && pAr.tTrigger) {
            lblArPrev.textContent = '❄️ Próx. AC:';
            const segFalta = Math.max(0, Math.round((pAr.tTrigger - Date.now()) / 1000));
            const horaPrev = new Date(pAr.tTrigger).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            if (segFalta <= 60) {
                elArPrev.innerHTML = `<span class="text-amber-300 font-bold">Iminente (~${horaPrev})</span>`;
            } else {
                elArPrev.innerHTML = `<span class="text-sky-300 font-bold">em ~${formatarMinSeg(segFalta)} (~${horaPrev})</span>`;
            }
        } else if (pAr.status === 'longe') {
            lblArPrev.textContent = '❄️ Próx. AC:';
            elArPrev.textContent = `> 3h (+${pAr.slopePerHour.toFixed(1)}°C/h)`;
        } else if (pAr.status === 'perto_estavel') {
            lblArPrev.textContent = '❄️ Ar Cond.:';
            elArPrev.innerHTML = `<span class="text-amber-200 font-medium">Perto de ${pAr.tMeta.toFixed(1)}°C (estável)</span>`;
        } else {
            lblArPrev.textContent = '❄️ Ar Cond.:';
            const tTxt = (pAr.lastTi !== null && pAr.lastTi !== undefined) ? pAr.lastTi.toFixed(1) : '--';
            elArPrev.textContent = `Estável (${tTxt}°C / ${pAr.tMeta.toFixed(1)}°C)`;
        }
    }
}

// =======================================================
// 3. RESUMO DE TRABALHO DAS ÚLTIMAS 24 HORAS
// =======================================================
function calcularResumoAtividades(data) {
    if (!data || data.length === 0) return;
    
    const ultimoTs = data[data.length - 1].unix_ts || Math.floor(new Date(data[data.length - 1].timestamp.replace(' ', 'T')).getTime() / 1000);
    const tsLimite24h = ultimoTs - (24 * 3600);
    const dados24h = data.filter(d => {
        const ts = d.unix_ts || Math.floor(new Date(d.timestamp.replace(' ', 'T')).getTime() / 1000);
        return ts >= tsLimite24h;
    });

    if (dados24h.length === 0) return;

    let cntFae = 0, cntBrisa = 0, cntUmid = 0, cntAr = 0, cntVentoExt = 0;
    let segFae = 0, segBrisa = 0, segUmid = 0, segAr = 0, segVentoExt = 0;
    let minT = Infinity, maxT = -Infinity;

    for (let i = 0; i < dados24h.length; i++) {
        const d = dados24h[i];
        const t = parseFloat(d.temp_int);
        if (!isNaN(t) && t > -40 && t < 60) {
            if (t < minT) minT = t;
            if (t > maxT) maxT = t;
        }

        const rEx = parseInt(d.rele_exaust) === 1;
        const rVn = parseInt(d.rele_vento) === 1;
        const rUm = parseInt(d.rele_umid) === 1;
        const rAr = parseInt(d.rele_ar) === 1;
        const rVe = parseInt(d.rele_vento_ext) === 1;

        let duracao = 60;
        if (i < dados24h.length - 1) {
            const t1 = dados24h[i].unix_ts || Math.floor(new Date(dados24h[i].timestamp.replace(' ', 'T')).getTime() / 1000);
            const t2 = dados24h[i+1].unix_ts || Math.floor(new Date(dados24h[i+1].timestamp.replace(' ', 'T')).getTime() / 1000);
            const delta = t2 - t1;
            if (delta > 0 && delta <= 900) duracao = delta;
        }

        if (rEx) segFae += duracao;
        if (rVn) segBrisa += duracao;
        if (rUm) segUmid += duracao;
        if (rAr) segAr += duracao;
        if (rVe) segVentoExt += duracao;

        // Contagem por borda de subida
        if (i > 0) {
            const antEx = parseInt(dados24h[i-1].rele_exaust) === 1;
            const antVn = parseInt(dados24h[i-1].rele_vento) === 1;
            const antUm = parseInt(dados24h[i-1].rele_umid) === 1;
            const antAr = parseInt(dados24h[i-1].rele_ar) === 1;
            const antVe = parseInt(dados24h[i-1].rele_vento_ext) === 1;
            if (rEx && !antEx) cntFae++;
            if (rVn && !antVn) cntBrisa++;
            if (rUm && !antUm) cntUmid++;
            if (rAr && !antAr) cntAr++;
            if (rVe && !antVe) cntVentoExt++;
        }
    }

    const fmtMinutos = (seg) => {
        const m = Math.round(seg / 60);
        const h = Math.floor(m / 60);
        const mr = m % 60;
        return h > 0 ? `${h}h ${mr}m ativo` : `${mr} min ativo`;
    };

    const elFae = document.getElementById('cntFae24h');
    const elFaeT = document.getElementById('tempoFae24h');
    const elBri = document.getElementById('cntBrisa24h');
    const elBriT = document.getElementById('tempoBrisa24h');
    const elUmi = document.getElementById('cntUmid24h');
    const elUmiT = document.getElementById('tempoUmid24h');
    const elAr = document.getElementById('cntAr24h');
    const elArT = document.getElementById('tempoAr24h');
    const elVe = document.getElementById('cntVentoExt24h');
    const elVeT = document.getElementById('tempoVentoExt24h');
    const elDelta = document.getElementById('deltaTemp24h');
    const elDeltaF = document.getElementById('deltaTempFaixa');

    if (elFae) elFae.textContent = `${cntFae} ciclos`;
    if (elFaeT) elFaeT.textContent = fmtMinutos(segFae);
    if (elBri) elBri.textContent = `${cntBrisa} ciclos`;
    if (elBriT) elBriT.textContent = fmtMinutos(segBrisa);
    if (elUmi) elUmi.textContent = `${cntUmid} ciclos`;
    if (elUmiT) elUmiT.textContent = fmtMinutos(segUmid);
    if (elAr) elAr.textContent = `${cntAr} ciclos`;
    if (elArT) {
        const medAr = cntAr > 0 ? Math.round((segAr / cntAr) / 60) : 0;
        elArT.textContent = `${fmtMinutos(segAr)} (méd. ${medAr} min/ciclo)`;
    }
    if (elVe) elVe.textContent = `${cntVentoExt} ciclos`;
    if (elVeT) {
        const medVe = cntVentoExt > 0 ? Math.round((segVentoExt / cntVentoExt) / 60) : 0;
        elVeT.textContent = `${fmtMinutos(segVentoExt)} (méd. ${medVe} min/ciclo)`;
    }

    if (elDelta && minT !== Infinity && maxT !== -Infinity) {
        const delta = maxT - minT;
        elDelta.textContent = `Δ ${delta.toFixed(1)} °C`;
        if (elDeltaF) {
            if (delta <= 2.5) {
                elDeltaF.textContent = `Estabilidade Alta (${minT.toFixed(1)}° a ${maxT.toFixed(1)}°)`;
                elDeltaF.className = "text-[9px] text-emerald-400 font-semibold block mt-0.5";
            } else if (delta <= 4.0) {
                elDeltaF.textContent = `Variação Moderada (${minT.toFixed(1)}° a ${maxT.toFixed(1)}°)`;
                elDeltaF.className = "text-[9px] text-amber-400 font-semibold block mt-0.5";
            } else {
                elDeltaF.textContent = `Oscilação Elevada (${minT.toFixed(1)}° a ${maxT.toFixed(1)}°)`;
                elDeltaF.className = "text-[9px] text-rose-400 font-semibold block mt-0.5";
            }
        }
    }
}

// =======================================================
// 4. EXPORTAÇÃO DE HISTÓRICO EM CSV
// =======================================================
function exportarCSV() {
    const dados = window.dadosTelemetriaAtuais;
    if (!dados || dados.length === 0) {
        alert("Nenhum dado disponível no momento para exportar.");
        return;
    }
    const cabecalho = ["Data/Hora", "Temp Interna (C)", "Umid Interna (%)", "VPD (kPa)", "Temp Externa (C)", "Umid Externa (%)", "Luz", "Umidificador", "Ventilador", "Exaustor", "Fase"];
    const linhas = [cabecalho.join(";")];
    dados.forEach(r => {
        const ti = parseFloat(r.temp_int);
        const ui = parseFloat(r.hum_int);
        const vpd = calcularVpd(ti, ui);
        const vpdStr = vpd !== null ? vpd.toFixed(2) : "";
        const te = (r.temp_ext !== null && r.temp_ext !== undefined) ? parseFloat(r.temp_ext).toFixed(1) : "";
        const ue = (r.hum_ext !== null && r.hum_ext !== undefined) ? parseFloat(r.hum_ext).toFixed(1) : "";
        linhas.push([
            r.timestamp,
            !isNaN(ti) ? ti.toFixed(1) : "",
            !isNaN(ui) ? ui.toFixed(1) : "",
            vpdStr,
            te,
            ue,
            r.rele_luz,
            r.rele_umid,
            r.rele_vento,
            r.rele_exaust,
            `"${(r.fase || '').replace(/"/g, '""')}"`
        ].join(";"));
    });
    const blob = new Blob(["\uFEFF" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dataHoraStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `grow_telemetria_${dataHoraStr}_${dados.length}pontos.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =======================================================
// 5. ALERTAS CRÍTICOS LEVES (BIPE WEB AUDIO & NOTIFICAÇÕES)
// =======================================================
let notificacoesAtivas = localStorage.getItem('grow_alertas_notif') === 'true';
let ultimoDisparoAlerta = {
    agua: 0,
    tempCritica: 0,
    sensorOffline: 0,
    placaOffline: 0
};

function tocarBipeAlerta(tipo = 'alerta') {
    try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        if (!window._growAudioCtx || window._growAudioCtx.state === 'closed') {
            window._growAudioCtx = new AudioCtxClass();
        }
        const audioCtx = window._growAudioCtx;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        if (tipo === 'critico') {
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.frequency.setValueAtTime(440, audioCtx.currentTime + 0.15);
            osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.55);
        } else {
            osc.type = "sine";
            osc.frequency.setValueAtTime(659.25, audioCtx.currentTime);
            osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.4);
        }
    } catch (e) {
        console.warn("Áudio não disponível:", e);
    }
}

function dispararAlerta(chave, titulo, corpo, tipo = 'alerta') {
    const agora = Date.now();
    if (agora - (ultimoDisparoAlerta[chave] || 0) < 15 * 60 * 1000) return;
    ultimoDisparoAlerta[chave] = agora;

    tocarBipeAlerta(tipo);

    if (notificacoesAtivas && "Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(titulo, {
                body: corpo,
                icon: "icon.png"
            });
        } catch (e) {
            console.warn("Erro ao emitir Notification:", e);
        }
    }
}

function checarAlertasCriticos(ultimo, diffMinutos) {
    if (!ultimo) return;
    const ti = parseFloat(ultimo.temp_int);
    const fase = ultimo.fase || '';
    const faseLimpa = fase.replace(' (DHT OFFLINE)', '').replace('ALERTA: SHT30 OFFLINE', 'Standby');
    const cId = (faseLimpa === "Frutificacao") ? "2" : "1";
    const cfgAtiva = (typeof configClima !== 'undefined' && configClima[cId]) ? configClima[cId] : null;
    const limiteTempAlerta = (cfgAtiva && Number.isFinite(parseFloat(cfgAtiva.tX))) ? (parseFloat(cfgAtiva.tX) + 0.5) : 29.5;

    if (Number.isFinite(ti) && ti >= limiteTempAlerta) {
        dispararAlerta('tempCritica', '🔥 Alerta Térmico Crítico', `Temperatura interna atingiu ${ti.toFixed(1)}°C!`, 'critico');
    }
    if (fase.includes('SHT30 OFFLINE') || fase.includes('DHT OFFLINE')) {
        dispararAlerta('sensorOffline', '⚠️ Falha em Sensor', 'Sensor interno de temperatura/umidade desconectado!', 'alerta');
    }
    if (diffMinutos >= 10) {
        dispararAlerta('placaOffline', '📡 Placa Desconectada', `O ESP32 não envia telemetria há ${diffMinutos} minutos!`, 'alerta');
    }
}

function atualizarBtnNotificacoes() {
    const btn = document.getElementById('btnNotificacoes');
    const icone = document.getElementById('iconeNotif');
    const txt = document.getElementById('txtNotif');
    const mobBtn = document.getElementById('mobBtnNotif');
    const mobIcone = document.getElementById('mobIconeNotif');
    const mobTxt = document.getElementById('mobTxtNotif');
    const ativo = notificacoesAtivas && "Notification" in window && Notification.permission === "granted";

    if (btn) {
        if (ativo) {
            btn.className = "hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/50 text-emerald-400 items-center gap-1.5 transition shadow-sm";
            if (icone) icone.textContent = "🔔";
            if (txt) txt.textContent = "Alertas ON";
        } else {
            btn.className = "hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-400 hover:text-white items-center gap-1.5 transition shadow-sm";
            if (icone) icone.textContent = "🔕";
            if (txt) txt.textContent = "Alertas";
        }
    }
    if (mobBtn) {
        if (ativo) {
            mobBtn.className = "flex flex-col items-center justify-center py-1.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-bold text-[10px] gap-0.5 transition active:scale-95";
            if (mobIcone) mobIcone.textContent = "🔔";
            if (mobTxt) mobTxt.textContent = "Alertas ON";
        } else {
            mobBtn.className = "flex flex-col items-center justify-center py-1.5 rounded-xl text-slate-400 hover:text-white font-semibold text-[10px] gap-0.5 transition active:scale-95";
            if (mobIcone) mobIcone.textContent = "🔕";
            if (mobTxt) mobTxt.textContent = "Alertas";
        }
    }
}

function toggleNotificacoes() {
    if (!("Notification" in window)) {
        alert("Seu navegador não suporta notificações de desktop.");
        return;
    }
    if (!notificacoesAtivas) {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                notificacoesAtivas = true;
                localStorage.setItem('grow_alertas_notif', 'true');
                atualizarBtnNotificacoes();
                new Notification("🍄 Grow de Cogumelos", {
                    body: "Alertas críticos e bipes ativados com sucesso!",
                    icon: "icon.png"
                });
                tocarBipeAlerta('alerta');
            } else {
                alert("Permissão de notificação negada no navegador.");
            }
        });
    } else {
        notificacoesAtivas = false;
        localStorage.setItem('grow_alertas_notif', 'false');
        atualizarBtnNotificacoes();
    }
}
