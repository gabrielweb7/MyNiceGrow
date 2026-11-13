// ========================================================
// MOTOR TÉRMICO PREDITIVO (GRÁFICO FANTASMA & REGRESSÃO HVAC)
// ========================================================

function calcularProjecaoTermica({
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
}) {
        // PROJEÇÃO DO FUTURO (GRÁFICO FANTASMA)
        const ultimaFase = data[data.length - 1].fase || '';
        let cfgKey = null;
        if (ultimaFase.includes('Pinagem')) cfgKey = "1";
        else if (ultimaFase.includes('Frutifica')) cfgKey = "2";
        
        const cfgProj = cfgKey ? configClima[cfgKey] : null;
        
        // Pega exatamente o timestamp do último ponto traçado no gráfico (momento atual real)
        const maxTs = dExaust.length > 0 ? dExaust[dExaust.length - 1].x : Date.now();
        window.tsUltimoDadoReal = maxTs;
        const tEnd = maxTs + (10 * 3600 * 1000); // Simulação das próximas 10 horas (Resto do dia sem lag)

        // PARÂMETROS DO MOTOR TÉRMICO ACOPLADO (AC + SIFÃO PÓS-AC + FAE + OPEN-METEO QUARTO)
        const hvac = (configClima && configClima.hvac) ? configClima.hvac : {};
        const tMeta = (cfgProj && cfgProj.tX) ? parseFloat(cfgProj.tX) : 28.0;
        const tCongelaSim = (hvac.tCongela !== undefined) ? parseFloat(hvac.tCongela) : 15.0;
        const tHistereseArSim = (hvac.tHistereseAr !== undefined) ? Math.max(0, Math.min(5.0, parseFloat(hvac.tHistereseAr))) : 1.0;
        const tMetaOff = Math.max(tCongelaSim + 0.2, tMeta - tHistereseArSim);
        const tPosMetaMin = (hvac.tPosMeta !== undefined) ? Math.max(0, Math.min(60, parseInt(hvac.tPosMeta, 10))) : 5;
        const tMaxRunMin = Math.max(10, parseInt(hvac.tMaxRun || 45, 10));
        const tSifaoPosAcMin = (hvac.tSifaoPosAc !== undefined) ? Math.max(0, Math.min(60, parseInt(hvac.tSifaoPosAc, 10))) : 15;
        const tDeltaExtSim = (hvac.tDeltaExt !== undefined) ? parseFloat(hvac.tDeltaExt) : 0.4;
        const tDeltaSaidaSim = Math.min(tDeltaExtSim, (hvac.tDeltaSaida !== undefined) ? parseFloat(hvac.tDeltaSaida) : 0.1);
        const tSifaoMinSim = (hvac.tSifaoTempMin !== undefined) ? parseFloat(hvac.tSifaoTempMin) : 22.0;
        const uGuardaCorteSim = (hvac.uGuardaCorte !== undefined) ? parseFloat(hvac.uGuardaCorte) : 90.0;
        const uAlvoSim = (cfgProj && (cfgProj.uA !== undefined || cfgProj.uN !== undefined)) ? parseFloat(cfgProj.uA !== undefined ? cfgProj.uA : cfgProj.uN) : 95.0;
        const uRetornoAlvoSim = (hvac.uRetornoAlvo === undefined || parseInt(hvac.uRetornoAlvo, 10) !== 0);
        const uGuardaRetornoSim = Math.max(uGuardaCorteSim, uRetornoAlvoSim ? uAlvoSim : parseFloat(hvac.uGuardaRetorno !== undefined ? hvac.uGuardaRetorno : 99.0));
        const tEvapPreMin = (hvac.tEvapPre !== undefined) ? Math.max(0, Math.min(15, parseInt(hvac.tEvapPre, 10))) : 4;
        const tEvapAntecipaSim = (hvac.tEvapAnt !== undefined) ? Math.max(0, Math.min(1.5, parseFloat(hvac.tEvapAnt))) : 0.3;
        const tEvapCooldownMin = (hvac.tEvapCool !== undefined) ? Math.max(10, Math.min(180, parseInt(hvac.tEvapCool, 10))) : 45;

        // Analisa todo o histórico real (AC na sala e estufa, rebote pós-AC 2 estágios, regressão de Newton, perfil horário, FAE puro vs Sifão e umidade)
        const FAE_LEN = 18;
        const duracoesCicloMin = [], coolRatesObs = [], dropsObs = [], roomCoolRatesObs = [], roomDropsObs = [], minRoomTempsObs = [];
        const roomReboundFastObs = [], roomReboundSlowObs = [], growWarmRatesObs = [], sifaoMixRatesObs = [];
        const humExaustRatesObs = [], humUmidRiseObs = [];
        const roomCeilingObs = [], newtonRoomPairs = [];
        const hourOffsetSum = new Array(24).fill(0), hourOffsetW = new Array(24).fill(0);
        const sumFaeDelta = new Array(FAE_LEN + 1).fill(0);
        const cntFaeDelta = new Array(FAE_LEN + 1).fill(0);
        let sumHeFae = 0, cntHeFae = 0;

        let blocoInicio = null, tempInicioAc = null, minTempAc = Infinity, tempExtInicioAc = null, minTempExtAc = Infinity, ultimoDesligamentoTs = 0, ultimoMaxRunDesligTs = 0;
        let prevExaust = 0, faeTrackStartTs = 0, faeTrackPreT = null, lastFaeStartTs = 0, lastFaeWasProg = false;
        let maxTeTrechoNonAc = null, tsMaxTeTrecho = 0, ruaAtMaxTeTrecho = null;
        let stableRoomSum = 0, stableRoomW = 0, offsetSalaRuaSum = 0, offsetSalaRuaW = 0;
        let acCycleRefSum = 0, acCycleRefCnt = 0;
        let sumDiffOff = 0, cntDiffOff = 0, sumDiffOn = 0, cntDiffOn = 0;
        let minNonAcTe = Infinity, maxNonAcTe = -Infinity, minRuaHist = Infinity, maxRuaHist = -Infinity;
        let meteoHistIdx = 0;
        const meteoBasePre = interpolarClimaEm(maxTs, 0);
        const faeMaxDurHist = (cfgProj && cfgProj.fO > 0) ? (parseInt(cfgProj.fO, 10) + 3) : 6;
        const janelaNonAcLongaMs = maxTs - (18 * 3600 * 1000);

        for (let i = 0; i < amostras.length; i++) {
            const tsItem = amostras[i].unix_ts_min || (amostras[i].unix_ts ? amostras[i].unix_ts * 1000 : new Date(amostras[i].timestamp.replace(' ', 'T')).getTime());
            const arOn = parseInt(amostras[i].rele_ar) === 1;
            const exOn = parseInt(amostras[i].rele_exaust) === 1;
            const umOn = parseInt(amostras[i].rele_umid) === 1;
            const luzOn = parseInt(amostras[i].rele_luz) === 1;
            const tItem = parseFloat(amostras[i].temp_int);
            const tExtItem = parseFloat(amostras[i].temp_ext);
            const hItem = parseFloat(amostras[i].hum_int);
            const hExtItem = parseFloat(amostras[i].hum_ext);
            const tValid = !isNaN(tItem) && tItem > -40 && tItem < 60;
            const teValid = !isNaN(tExtItem) && tExtItem > -40 && tExtItem < 60;
            const hValid = !isNaN(hItem) && hItem > 0 && hItem <= 100;
            const heValid = !isNaN(hExtItem) && hExtItem > 0 && hExtItem <= 100;
            const mHistCur = teValid ? interpolarClimaEm(tsItem, meteoHistIdx) : null;
            if (mHistCur) {
                meteoHistIdx = mHistCur.idx;
                if (mHistCur.tRua < minRuaHist) minRuaHist = mHistCur.tRua;
                if (mHistCur.tRua > maxRuaHist) maxRuaHist = mHistCur.tRua;
            }

            if (arOn) {
                if (blocoInicio === null) {
                    // Registra o pico atingido pelo quarto imediatamente antes do AC armar (evita subestimar o teto real da sala!)
                    if (maxTeTrechoNonAc !== null) {
                        roomCeilingObs.push({ ts: tsMaxTeTrecho, tExt: maxTeTrechoNonAc, tRua: ruaAtMaxTeTrecho, isPreAc: true });
                    }
                    maxTeTrechoNonAc = null;
                    blocoInicio = tsItem;
                    tempInicioAc = tValid ? tItem : null;
                    minTempAc = tempInicioAc !== null ? tempInicioAc : Infinity;
                    tempExtInicioAc = teValid ? tExtItem : null;
                    minTempExtAc = tempExtInicioAc !== null ? tempExtInicioAc : Infinity;
                } else {
                    if (tValid && tItem < minTempAc) minTempAc = tItem;
                    if (teValid && tExtItem < minTempExtAc) minTempExtAc = tExtItem;
                }
                faeTrackPreT = null; // Ignora FAE durante ciclo ativo de AC para não misturar assinaturas
            } else if (blocoInicio !== null) {
                const durMin = Math.round((tsItem - blocoInicio) / 60000);
                if (durMin >= 3 && durMin <= tMaxRunMin + 2) {
                    duracoesCicloMin.push(durMin);
                    if (tempInicioAc !== null && minTempAc < tempInicioAc) {
                        const drop = tempInicioAc - minTempAc;
                        dropsObs.push(drop);
                        coolRatesObs.push(drop / durMin);
                    }
                    if (tempExtInicioAc !== null && minTempExtAc < tempExtInicioAc) {
                        const rDrop = tempExtInicioAc - minTempExtAc;
                        roomDropsObs.push(rDrop);
                        roomCoolRatesObs.push(rDrop / durMin);
                        minRoomTempsObs.push(minTempExtAc);
                        acCycleRefSum += tempExtInicioAc;
                        acCycleRefCnt++;
                    }
                }
                if (durMin >= Math.max(5, tMaxRunMin - 1)) {
                    ultimoMaxRunDesligTs = tsItem;
                }
                ultimoDesligamentoTs = tsItem;
                blocoInicio = null;
                tempInicioAc = null;
                minTempAc = Infinity;
                tempExtInicioAc = null;
                minTempExtAc = Infinity;
            }

            // Captura apenas eventos de FAE programado fora da janela Pós-AC (sem contaminar o molde de FAE curto!)
            const emJanelaPosAcHist = (ultimoDesligamentoTs > 0 && (tsItem - ultimoDesligamentoTs) < Math.max(5, tSifaoPosAcMin) * 60000);
            if (exOn && prevExaust === 0) {
                lastFaeStartTs = tsItem;
                lastFaeWasProg = (!arOn && !emJanelaPosAcHist);
                if (lastFaeWasProg && i > 0) {
                    const prevTi = parseFloat(amostras[i - 1].temp_int);
                    if (!isNaN(prevTi) && prevTi > -40 && prevTi < 60) {
                        faeTrackStartTs = tsItem;
                        faeTrackPreT = prevTi;
                        if (heValid) {
                            sumHeFae += hExtItem;
                            cntHeFae++;
                        }
                    }
                }
            }
            if (faeTrackPreT !== null && tValid) {
                const ageMin = Math.round((tsItem - faeTrackStartTs) / 60000);
                if (exOn && ageMin > faeMaxDurHist) {
                    // Exaustor passou muito do tempo do FAE: era Sifão, descarta esta amostra
                    faeTrackPreT = null;
                } else if (ageMin >= 0 && ageMin <= FAE_LEN) {
                    sumFaeDelta[ageMin] += (tItem - faeTrackPreT);
                    cntFaeDelta[ageMin]++;
                } else if (ageMin > FAE_LEN) {
                    faeTrackPreT = null;
                }
            }
            prevExaust = exOn ? 1 : 0;

            // Taxas passo a passo observadas entre amostras consecutivas
            let dTeDtCur = null;
            if (i > 0) {
                const prevA = amostras[i - 1];
                const tsPrev = prevA.unix_ts_min || (prevA.unix_ts ? prevA.unix_ts * 1000 : new Date(prevA.timestamp.replace(' ', 'T')).getTime());
                const dtM = (tsItem - tsPrev) / 60000;
                if (dtM >= 0.8 && dtM <= 6.0) {
                    const prevAr = parseInt(prevA.rele_ar) === 1;
                    const prevEx = parseInt(prevA.rele_exaust) === 1;
                    const prevUm = parseInt(prevA.rele_umid) === 1;
                    const prevTi = parseFloat(prevA.temp_int);
                    const prevTe = parseFloat(prevA.temp_ext);
                    const prevHi = parseFloat(prevA.hum_int);

                    if (!arOn && !prevAr && teValid && !isNaN(prevTe)) {
                        dTeDtCur = (tExtItem - prevTe) / dtM;
                        // Pares para Regressão de Newton do equilíbrio natural do quarto (dTe/dt vs Te)
                        if (dtM <= 4.5 && dTeDtCur > -0.15 && dTeDtCur < 0.45) {
                            newtonRoomPairs.push({ te: prevTe, rate: dTeDtCur });
                        }
                    }

                    // Eficiência real de troca térmica durante Sifão / Exaustor com sala mais fria
                    if (!arOn && !prevAr && exOn && prevEx && tValid && teValid && !isNaN(prevTi) && !isNaN(prevTe)) {
                        const gap = prevTi - prevTe;
                        const kSif = (prevTi - tItem) / (gap * dtM);
                        if (gap >= 0.6 && kSif > 0.01 && kSif < 0.40) sifaoMixRatesObs.push(kSif);
                    }

                    // Dinâmica real de umidade durante exaustão vs umidificação
                    if (hValid && heValid && !isNaN(prevHi)) {
                        if (exOn && prevEx && !umOn && !prevUm && (prevHi - hExtItem) > 10) {
                            const kDrop = (prevHi - hItem) / ((prevHi - hExtItem) * dtM);
                            if (kDrop > 0.02 && kDrop < 0.25) humExaustRatesObs.push(kDrop);
                        } else if (!exOn && !prevEx && umOn && prevUm && prevHi < 97.5 && hItem > prevHi) {
                            const rUp = (hItem - prevHi) / dtM;
                            if (rUp > 0.5 && rUp < 9.0) humUmidRiseObs.push(rUp);
                        }
                    }
                }
            }

            // Acumula teto de cada trecho sem AC, patamares estabilizados e perfil horário Quarto↔Rua
            if (!arOn && teValid) {
                if (maxTeTrechoNonAc === null || tExtItem >= maxTeTrechoNonAc) {
                    maxTeTrechoNonAc = tExtItem;
                    tsMaxTeTrecho = tsItem;
                    ruaAtMaxTeTrecho = mHistCur ? mHistCur.tRua : null;
                }
                if (tExtItem < minNonAcTe) minNonAcTe = tExtItem;
                if (tExtItem > maxNonAcTe) maxNonAcTe = tExtItem;

                const minsDesdeOff = ultimoDesligamentoTs > 0 ? ((tsItem - ultimoDesligamentoTs) / 60000) : 999;
                const quaseEstavel = (dTeDtCur !== null && Math.abs(dTeDtCur) < 0.035 && minsDesdeOff >= 15);
                if (minsDesdeOff >= 18 || quaseEstavel) {
                    if (mHistCur) {
                        const hLoc = new Date(tsItem).getHours();
                        const ageH = Math.max(0, (maxTs - tsItem) / 3600000);
                        const wOff = Math.exp(-ageH / 16.0);
                        const offVal = tExtItem - mHistCur.tRua;
                        hourOffsetSum[hLoc] += offVal * wOff;
                        hourOffsetW[hLoc] += wOff;
                        offsetSalaRuaSum += offVal * Math.exp(-ageH / 6.0);
                        offsetSalaRuaW += Math.exp(-ageH / 6.0);
                    }
                    if (tsItem >= janelaNonAcLongaMs) {
                        const ageH = Math.max(0, (maxTs - tsItem) / 3600000);
                        const wS = Math.exp(-ageH / 4.5);
                        const corrRua = (meteoBasePre && mHistCur) ? (meteoBasePre.tRua - mHistCur.tRua) * 0.45 : 0;
                        stableRoomSum += (tExtItem + corrRua) * wS;
                        stableRoomW += wS;
                    }
                }

                if (minsDesdeOff >= 12) {
                    const foraDeFae = (lastFaeStartTs === 0 || (tsItem - lastFaeStartTs) >= 15 * 60000);
                    if (foraDeFae && tValid) {
                        const diff = tItem - tExtItem;
                        if (luzOn) { sumDiffOn += diff; cntDiffOn++; }
                        else { sumDiffOff += diff; cntDiffOff++; }
                    }
                }
            }
        }
        // Também inclui o trecho sem AC atual (até AGORA) se ele estiver próximo do teto ou em subida
        const lastArOn = amostras.length > 0 && parseInt(amostras[amostras.length - 1].rele_ar) === 1;
        if (!lastArOn && maxTeTrechoNonAc !== null) {
            roomCeilingObs.push({ ts: tsMaxTeTrecho, tExt: maxTeTrechoNonAc, tRua: ruaAtMaxTeTrecho, isPreAc: false });
        }

        // Regressão da Lei de Newton (dTe/dt = a - k*Te => Te_eq = a/k) para descobrir o teto real de equilíbrio da sala
        let tEqNewton = null;
        if (newtonRoomPairs.length >= 6) {
            let sX = 0, sY = 0, sXX = 0, sXY = 0, minNx = Infinity, maxNx = -Infinity;
            for (let i = 0; i < newtonRoomPairs.length; i++) {
                const p = newtonRoomPairs[i];
                sX += p.te; sY += p.rate; sXX += p.te * p.te; sXY += p.te * p.rate;
                if (p.te < minNx) minNx = p.te;
                if (p.te > maxNx) maxNx = p.te;
            }
            const nP = newtonRoomPairs.length;
            const meanX = sX / nP, meanY = sY / nP;
            const varX = sXX - nP * meanX * meanX;
            const covXY = sXY - nP * meanX * meanY;
            if (varX > 0.25 && (maxNx - minNx) >= 0.8) {
                const bSlope = covXY / varX; // Esperado negativo: quanto mais quente, menos sobe
                if (bSlope <= -0.018 && bSlope >= -0.35) {
                    const cand = meanX - (meanY / bSlope);
                    const refMax = Math.max(maxNonAcTe > -90 ? maxNonAcTe : 28.0, lastTe !== null ? lastTe : 28.0);
                    if (cand >= Math.max(19.0, refMax - 1.5) && cand <= Math.min(38.0, refMax + 2.4)) {
                        tEqNewton = cand;
                    }
                }
            }
        }

        // Tendência imediata recente do QUARTO (últimos 18 min mantendo o mesmo estado atual de AC)
        let slopeExtPerMin = 0;
        const janelaExtIni = maxTs - (18 * 60000);
        const ptsExt = [];
        for (let i = amostras.length - 1; i >= 0; i--) {
            const tsItem = amostras[i].unix_ts_min || (amostras[i].unix_ts ? amostras[i].unix_ts * 1000 : new Date(amostras[i].timestamp.replace(' ', 'T')).getTime());
            if (tsItem < janelaExtIni) break;
            if ((parseInt(amostras[i].rele_ar) === 1) !== lastArOn) break;
            const vTe = parseFloat(amostras[i].temp_ext);
            if (!isNaN(vTe) && vTe > -40 && vTe < 60) ptsExt.push({ ts: tsItem, t: vTe });
        }
        ptsExt.reverse();
        if (ptsExt.length >= 3 && (ptsExt[ptsExt.length - 1].ts - ptsExt[0].ts) >= 3 * 60000) {
            const t0E = ptsExt[0].ts;
            let sX = 0, sY = 0, sXY = 0, sXX = 0;
            for (let i = 0; i < ptsExt.length; i++) {
                const x = (ptsExt[i].ts - t0E) / 60000;
                sX += x; sY += ptsExt[i].t; sXY += x * ptsExt[i].t; sXX += x * x;
            }
            const den = (ptsExt.length * sXX) - (sX * sX);
            if (den > 0) slopeExtPerMin = ((ptsExt.length * sXY) - (sX * sY)) / den;
        }

        // Estima o equilíbrio natural atual do quarto combinando picos pré-AC, pontos estabilizados, regressão de Newton e tendência AGORA
        let ceilSum = 0, ceilW = 0;
        for (let i = 0; i < roomCeilingObs.length; i++) {
            const c = roomCeilingObs[i];
            const ageH = Math.max(0, (maxTs - c.ts) / 3600000);
            if (ageH > 18) continue;
            const corrRua = (meteoBasePre && c.tRua !== null) ? (meteoBasePre.tRua - c.tRua) * 0.45 : 0;
            const wC = Math.exp(-ageH / 4.5) * (c.isPreAc ? 1.35 : 0.85);
            ceilSum += (c.tExt + corrRua) * wC;
            ceilW += wC;
        }
        const tRoomCeilEst = ceilW > 0 ? (ceilSum / ceilW) : null;
        const tRoomStableEst = stableRoomW >= 1.5 ? (stableRoomSum / stableRoomW) : null;
        let tRoomNatNow = (tRoomCeilEst !== null && tRoomStableEst !== null)
            ? (0.50 * tRoomCeilEst + 0.50 * tRoomStableEst)
            : (tRoomCeilEst !== null ? tRoomCeilEst : (tRoomStableEst !== null ? tRoomStableEst : (lastTe !== null ? lastTe : 26.5)));
        if (tEqNewton !== null) {
            tRoomNatNow = 0.65 * tRoomNatNow + 0.35 * tEqNewton;
        }
        if (!lastArOn && lastTe !== null) {
            if (slopeExtPerMin > 0.015) {
                const extraSlope = Math.min(1.2, slopeExtPerMin * 6.0);
                tRoomNatNow = Math.max(tRoomNatNow, lastTe + extraSlope);
            } else {
                tRoomNatNow = 0.55 * lastTe + 0.45 * tRoomNatNow;
            }
        }

        // Passo 2 no histórico usando tRoomNatNow estimado para aprender taxas exponenciais reais em 2 estágios (rebote rápido pós-AC vs deriva lenta) + estufa
        const deltaOffEst = cntDiffOff >= 3 ? (sumDiffOff / cntDiffOff) : -0.35;
        const deltaOnEst = cntDiffOn >= 3 ? (sumDiffOn / cntDiffOn) : (deltaOffEst + 0.45);
        let lastArOffLoopTs = 0;
        for (let i = 1; i < amostras.length; i++) {
            const prevA = amostras[i - 1];
            const curA = amostras[i];
            const prevArLoop = parseInt(prevA.rele_ar) === 1;
            const curArLoop = parseInt(curA.rele_ar) === 1;
            const tsP = prevA.unix_ts_min || (prevA.unix_ts ? prevA.unix_ts * 1000 : new Date(prevA.timestamp.replace(' ', 'T')).getTime());
            const tsC = curA.unix_ts_min || (curA.unix_ts ? curA.unix_ts * 1000 : new Date(curA.timestamp.replace(' ', 'T')).getTime());
            if (prevArLoop && !curArLoop) lastArOffLoopTs = tsC;
            if (prevArLoop || curArLoop) continue;
            const dtM = (tsC - tsP) / 60000;
            if (dtM < 0.8 || dtM > 5.0) continue;

            const prevTe = parseFloat(prevA.temp_ext), curTe = parseFloat(curA.temp_ext);
            if (!isNaN(prevTe) && !isNaN(curTe) && (tRoomNatNow - prevTe) >= 0.45 && curTe > prevTe) {
                const kReb = (curTe - prevTe) / ((tRoomNatNow - prevTe) * dtM);
                if (kReb > 0.010 && kReb < 0.32) {
                    const desdeOff = lastArOffLoopTs > 0 ? ((tsC - lastArOffLoopTs) / 60000) : 999;
                    if (desdeOff <= 18) roomReboundFastObs.push(kReb);
                    else roomReboundSlowObs.push(kReb);
                }
            }

            if (parseInt(prevA.rele_exaust) === 0 && parseInt(curA.rele_exaust) === 0) {
                const prevTi = parseFloat(prevA.temp_int), curTi = parseFloat(curA.temp_int);
                const luzC = parseInt(curA.rele_luz) === 1;
                if (!isNaN(prevTi) && !isNaN(curTi) && !isNaN(curTe)) {
                    const tgtTi = curTe + (luzC ? deltaOnEst : deltaOffEst);
                    const gapG = tgtTi - prevTi;
                    if (gapG >= 0.5 && curTi > prevTi) {
                        const kGW = (curTi - prevTi) / (gapG * dtM);
                        if (kGW > 0.008 && kGW < 0.14) growWarmRatesObs.push(kGW);
                    }
                }
            }
        }

        // Helper de mediana aparada robusta contra outliers
        const calcMediana = (arr, defVal, mn, mx) => {
            if (!arr || arr.length === 0) return defVal;
            const s = arr.slice().sort((a, b) => a - b);
            const mid = Math.floor(s.length / 2);
            const med = (s.length % 2 !== 0) ? s[mid] : ((s[mid - 1] + s[mid]) * 0.5);
            return Math.max(mn, Math.min(mx, med));
        };

        // Monta molde médio duplamente suavizado do ciclo FAE puro a partir do histórico real do grow
        const rawFae = new Array(FAE_LEN + 1).fill(0);
        const temAssinaturaFae = cntFaeDelta[2] >= 1 || cntFaeDelta[3] >= 1;
        if (temAssinaturaFae) {
            let lastKnown = 0;
            for (let m = 0; m <= FAE_LEN; m++) {
                if (cntFaeDelta[m] > 0) {
                    let val = sumFaeDelta[m] / cntFaeDelta[m];
                    val = Math.max(-1.6, Math.min(0.20, val));
                    rawFae[m] = val;
                    lastKnown = val;
                } else {
                    rawFae[m] = lastKnown * 0.85;
                    lastKnown = rawFae[m];
                }
            }
        } else {
            for (let m = 1; m < FAE_LEN; m++) {
                rawFae[m] = -0.65 * Math.sin(Math.min(1, m / 4.5) * Math.PI * 0.5) * Math.exp(-0.24 * Math.max(0, m - 4));
            }
        }
        // Dupla suavização passa-baixas 3-tap (elimina dentes pontudos de serra)
        const pass1Fae = new Array(FAE_LEN + 1).fill(0);
        const faeTemplate = new Array(FAE_LEN + 1).fill(0);
        for (let m = 1; m < FAE_LEN; m++) pass1Fae[m] = 0.25 * rawFae[m - 1] + 0.5 * rawFae[m] + 0.25 * rawFae[m + 1];
        for (let m = 1; m < FAE_LEN; m++) faeTemplate[m] = 0.25 * pass1Fae[m - 1] + 0.5 * pass1Fae[m] + 0.25 * pass1Fae[m + 1];
        const evalFaeTemplate = (ageMin) => {
            if (ageMin <= 0 || ageMin >= FAE_LEN) return 0;
            const idx0 = Math.floor(ageMin);
            const idx1 = Math.min(FAE_LEN, idx0 + 1);
            const f = ageMin - idx0;
            return faeTemplate[idx0] + (faeTemplate[idx1] - faeTemplate[idx0]) * f;
        };

        const avgHeFaePast = cntHeFae > 0 ? (sumHeFae / cntHeFae) : 70;
        const deltaGrowOff = cntDiffOff >= 3 ? Math.max(-1.2, Math.min(1.5, sumDiffOff / cntDiffOff)) : -0.4;
        const deltaGrowOn = cntDiffOn >= 3 ? Math.max(-1.0, Math.min(2.0, sumDiffOn / cntDiffOn)) : Math.min(1.5, deltaGrowOff + 0.45);
        const ruaRangeHist = (maxRuaHist > minRuaHist) ? (maxRuaHist - minRuaHist) : 0;
        const roomRangeHist = (maxNonAcTe > minNonAcTe) ? (maxNonAcTe - minNonAcTe) : 0;
        const fatorParede = (ruaRangeHist >= 1.5 && roomRangeHist > 0.1)
            ? Math.max(0.32, Math.min(0.65, roomRangeHist / ruaRangeHist))
            : 0.42;

        const avgCoolRate = calcMediana(coolRatesObs, 0.065, 0.032, 0.13);
        const avgRoomCoolRate = calcMediana(roomCoolRatesObs, 0.14, 0.08, 0.25);
        const avgRoomDropAc = calcMediana(roomDropsObs, 2.2, 1.2, 4.2);
        const avgMinRoomAc = calcMediana(minRoomTempsObs, (tRoomNatNow - 2.4), 16.0, 32.0);
        const tRoomCycleRef = acCycleRefCnt > 0 ? (acCycleRefSum / acCycleRefCnt) : tRoomNatNow;
        const kRoomReboundFast = calcMediana(roomReboundFastObs, 0.035, 0.015, 0.055);
        const kRoomDriftSlow = calcMediana(roomReboundSlowObs, Math.min(0.022, kRoomReboundFast * 0.50), 0.008, 0.032);
        const kGrowWarm = calcMediana(growWarmRatesObs, 0.036, 0.015, 0.11);
        const kSifaoMix = calcMediana(sifaoMixRatesObs, 0.11, 0.04, 0.25);
        const kHumExaust = calcMediana(humExaustRatesObs, 0.082, 0.035, 0.22);
        const rHumUmidUp = calcMediana(humUmidRiseObs, 3.6, 1.4, 7.5);
        const avgDropPostMeta = dropsObs.length > 0
            ? Math.max(0.5, Math.min(1.4, calcMediana(dropsObs, 1.2, 0.4, 3.0) * 0.45))
            : 0.7;
        const tAlvoPos = Math.max(tCongelaSim + 0.05, tMetaOff - (tPosMetaMin > 0 ? Math.min(1.1, Math.max(0.45, avgDropPostMeta * 0.55)) : 0.40));

        // Perfil horário aprendido (Quarto - Rua) suavizado entre horas vizinhas para ciclos diurnos/noturnos
        const getHourOffsetInfo = (h) => {
            const hP = (h + 23) % 24, hN = (h + 1) % 24;
            const wTot = hourOffsetW[h] + 0.45 * (hourOffsetW[hP] + hourOffsetW[hN]);
            if (wTot <= 0.1) return { val: null, w: 0 };
            const sumTot = hourOffsetSum[h] + 0.45 * (hourOffsetSum[hP] + hourOffsetSum[hN]);
            return { val: sumTot / wTot, w: wTot };
        };
        const baseHourInfo = getHourOffsetInfo(new Date(maxTs).getHours());
        const offsetBaseGlobal = offsetSalaRuaW > 0.2 ? (offsetSalaRuaSum / offsetSalaRuaW) : null;

        // Tendência térmica recente da estufa (últimos 30 min sem AC nem FAE ativo) para transição suave em AGORA
        let slopePerMin = 0;
        const janelaInicio = maxTs - (30 * 60000);
        const pts = [];
        for (let i = amostras.length - 1; i >= 0; i--) {
            const tsItem = amostras[i].unix_ts_min || (amostras[i].unix_ts ? amostras[i].unix_ts * 1000 : new Date(amostras[i].timestamp.replace(' ', 'T')).getTime());
            if (tsItem < janelaInicio) break;
            if (parseInt(amostras[i].rele_ar) === 1 || parseInt(amostras[i].rele_exaust) === 1) break;
            const vT = parseFloat(amostras[i].temp_int);
            if (!isNaN(vT) && vT > -40 && vT < 60) pts.push({ ts: tsItem, t: vT });
        }
        pts.reverse();
        if (pts.length >= 4 && (pts[pts.length - 1].ts - pts[0].ts) >= 4 * 60000) {
            const t0 = pts[0].ts;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (let i = 0; i < pts.length; i++) {
                const x = (pts[i].ts - t0) / 60000;
                sumX += x; sumY += pts[i].t; sumXY += x * pts[i].t; sumXX += x * x;
            }
            const denom = (pts.length * sumXX) - (sumX * sumX);
            if (denom > 0) slopePerMin = ((pts.length * sumXY) - (sumX * sumY)) / denom;
        }

        // Ancoragem Open-Meteo + Equilíbrio Natural Real da Sala (picos pré-AC + Newton + tendência imediata)
        const meteoBase = meteoBasePre;
        let meteoIdx = meteoBase ? meteoBase.idx : 0;
        const tExtAnchor = (lastTe !== null) ? lastTe : (meteoBase ? meteoBase.tRua : (lastTi !== null ? lastTi : 26.0));
        const hExtAnchor = (lastHe !== null) ? lastHe : (meteoBase ? meteoBase.hRua : 70.0);

        // Pontos de costura em "AGORA" para todas as linhas pontilhadas continuarem sem degrau
        if (amostras.length > 0) {
            const lastIdx = amostras.length - 1;
            if (lastTi !== null) dTempProj[lastIdx] = { x: maxTs, y: lastTi };
            if (lastTe !== null || meteoBase) dTempExtProj[lastIdx] = { x: maxTs, y: tExtAnchor };
            if (lastHi !== null) dHumIntProj[lastIdx] = { x: maxTs, y: lastHi };
            if (lastHe !== null || meteoBase) dHumExtProj[lastIdx] = { x: maxTs, y: hExtAnchor };
        }

        const lastRealLuzOn = dLuz.length > 0 && dLuz[dLuz.length - 1].y !== null;
        let tExtSim = tExtAnchor;
        let tRoomEqSim = tRoomNatNow;
        let hExtSim = hExtAnchor;

        // Se AGORA está no meio de um FAE programado recente, desconta o offset do vale para não somar duas quedas
        const scaleFaeNow = Math.max(0.25, Math.min(1.25, (90 - hExtAnchor) / Math.max(8, 90 - avgHeFaePast)));
        const faeAgeAgora = (lastFaeWasProg && lastFaeStartTs > 0 && (maxTs - lastFaeStartTs) < FAE_LEN * 60000)
            ? (maxTs - lastFaeStartTs) / 60000
            : -1;
        const faeOffsetAgora = (faeAgeAgora >= 0 && !lastArOn) ? (evalFaeTemplate(faeAgeAgora) * scaleFaeNow) : 0;
        let tIntBase = (lastTi !== null) ? (lastTi - faeOffsetAgora) : null;
        let simFaeStartTs = (faeAgeAgora >= 0) ? lastFaeStartTs : -1;
        let simPrevExaustOn = (dExaust.length > 0 && dExaust[dExaust.length - 1].y !== null);

        let simArOn = (arState === 1) ? true : ((arState === 2 || !cfgProj) ? false : lastArOn);
        let simArPrev = simArOn;
        let simArInicioTs = simArOn ? (blocoInicio || maxTs) : 0;
        let simArAbaixoMetaTs = 0;
        if (simArOn && lastTi !== null && lastTi < tMetaOff) {
            simArAbaixoMetaTs = maxTs;
            for (let i = amostras.length - 1; i >= 0; i--) {
                if (parseInt(amostras[i].rele_ar) !== 1) break;
                const tHist = parseFloat(amostras[i].temp_int);
                if (isNaN(tHist) || tHist >= tMetaOff) break;
                simArAbaixoMetaTs = amostras[i].unix_ts_min || (amostras[i].unix_ts ? amostras[i].unix_ts * 1000 : new Date(amostras[i].timestamp.replace(' ', 'T')).getTime());
            }
        }
        let simArUltimoDesligTs = ultimoDesligamentoTs || 0;
        let simArFalhouCiclo = false;
        let simDescansoPreventivoAteTs = (!simArOn && ultimoMaxRunDesligTs > 0 && (maxTs - ultimoMaxRunDesligTs) < 10 * 60000)
            ? (ultimoMaxRunDesligTs + 10 * 60000) : 0;
        let simSifaoAteTs = (!simArOn && ultimoDesligamentoTs > 0 && tSifaoPosAcMin > 0 && (maxTs - ultimoDesligamentoTs) < tSifaoPosAcMin * 60000)
            ? (ultimoDesligamentoTs + tSifaoPosAcMin * 60000) : 0;
        const ultAmostra = amostras.length > 0 ? amostras[amostras.length - 1] : null;
        const ultExaustOnNow = ultAmostra ? (parseInt(ultAmostra.rele_exaust) === 1) : false;
        const ultUmidOnNow = ultAmostra ? (parseInt(ultAmostra.rele_umid) === 1) : false;
        const aproveitandoAgora = !!cfgProj && (simArOn || (simSifaoAteTs > 0 && maxTs < simSifaoAteTs));
        let simInjecaoTermoOk = (aproveitandoAgora && ultExaustOnNow && lastTi !== null && lastTe !== null && lastTi > tSifaoMinSim && lastTe <= (lastTi - tDeltaSaidaSim));
        let simGuardaUmidOk = true;
        if (lastHi !== null && lastHi < uGuardaCorteSim) {
            simGuardaUmidOk = false;
        } else if (aproveitandoAgora && !ultExaustOnNow && ultUmidOnNow && lastHi !== null && lastHi < uGuardaRetornoSim && lastTi !== null && lastTe !== null && lastTi > tSifaoMinSim && lastTe <= (lastTi - tDeltaExtSim)) {
            simGuardaUmidOk = false;
        }
        let simHumInt = (lastHi !== null) ? lastHi : uAlvoSim;
        let simUmidHist = (simHumInt < uAlvoSim);
        let simEvapAtivo = false;
        let simEvapInicioTs = 0;
        let simEvapTempInicio = (lastTi !== null) ? lastTi : tMeta;
        let simEvapCooldownAteTs = 0;
        let simEvapOndaSeca = false;

        let primeiroAcTrigger = (simArOn && arState === 0 && lastArOn) ? simArInicioTs : null;
        let primeiroAcDesligaTs = null;
        let minTempPrimeiroCiclo = (lastTi !== null) ? lastTi : tAlvoPos;
        let emPrimeiroCicloAc = simArOn;
        let qtdCiclosAcPrev = (simArOn && arState === 0 && lastArOn) ? 1 : 0;
        let maxTempIntPrev = (lastTi !== null) ? lastTi : -99;

        // Física simulada sempre em passos de 1 min (garante precisão inclusive no modo 7 Dias com blocos de 5 min)
        const subStepMs = 60000;
        const subDtMin = 1;
        let accLuz = false, accUmid = false, accVento = false, accExaust = false, accAr = false;
        let accMotEx = null, accMotUm = null, accMotAr = null;

        for (let t = maxTs + subStepMs; t <= tEnd; t += subStepMs) {
            const hGMT3 = Math.floor(((t - 10800000) % 86400000 + 86400000) % 86400000 / 3600000);

            // Luz
            let isLuzOn = false;
            if (luzState === 1) isLuzOn = true;
            else if (luzState === 2) isLuzOn = false;
            else isLuzOn = lastRealLuzOn ? (hGMT3 >= 18 || hGMT3 < 8) : (hGMT3 >= 20 || hGMT3 < 8);

            // Previsão exponencial do quarto (equilíbrio real + perfil horário aprendido + inércia parede + rebote em 2 estágios)
            if (meteoBase) {
                const mPt = interpolarClimaEm(t, meteoIdx);
                if (mPt) {
                    meteoIdx = mPt.idx;
                    const hSim = new Date(t).getHours();
                    const hSimInfo = getHourOffsetInfo(hSim);
                    const refOffBase = (baseHourInfo.val !== null && baseHourInfo.w >= 0.8) ? baseHourInfo.val : offsetBaseGlobal;
                    let deltaHorario = 0;
                    if (hSimInfo.val !== null && refOffBase !== null && hSimInfo.w >= 1.5) {
                        const wBlendH = Math.min(0.35, hSimInfo.w / 10.0);
                        deltaHorario = Math.max(-1.5, Math.min(1.5, (hSimInfo.val - refOffBase))) * wBlendH;
                    }
                    const tRoomTarget = tRoomNatNow + (mPt.tRua - meteoBase.tRua) * fatorParede + deltaHorario;
                    tRoomEqSim += (tRoomTarget - tRoomEqSim) * (1 - Math.exp(-subDtMin / 65));
                    const hTarget = Math.max(30, Math.min(98, hExtAnchor + (mPt.hRua - meteoBase.hRua) * 0.50));
                    hExtSim += (hTarget - hExtSim) * (1 - Math.exp(-subDtMin / 70));
                }
            }
            if (simArOn) {
                const floorSalaAc = (minRoomTempsObs.length >= 1)
                    ? Math.max(15.5, Math.min(tAlvoPos - 0.9, avgMinRoomAc + (tRoomEqSim - tRoomCycleRef) * 0.30))
                    : Math.max(16.0, Math.min(tAlvoPos - 0.9, tRoomEqSim - Math.max(2.0, avgRoomDropAc)));
                if (tExtSim > floorSalaAc) {
                    const kRoomCool = Math.max(0.065, Math.min(0.13, avgRoomCoolRate / Math.max(1.2, avgRoomDropAc)));
                    tExtSim += (floorSalaAc - tExtSim) * (1 - Math.exp(-kRoomCool * subDtMin));
                }
            } else {
                const minsDesdeOffSim = simArUltimoDesligTs > 0 ? ((t - simArUltimoDesligTs) / 60000) : 999;
                const janelaReboundMin = Math.max(12, tSifaoPosAcMin || 15);
                const pesoFast = (tExtSim < tRoomEqSim - 0.15) ? Math.max(0, 0.45 * (1 - (minsDesdeOffSim / janelaReboundMin))) : 0;
                const rateRoom = pesoFast * kRoomReboundFast + (1 - pesoFast) * kRoomDriftSlow;
                const dRoomPhys = (tRoomEqSim - tExtSim) * (1 - Math.exp(-rateRoom * subDtMin));
                const elapsedExtMin = (t - maxTs) / 60000;
                const wExtSlope = (!lastArOn && simArUltimoDesligTs === (ultimoDesligamentoTs || 0) && elapsedExtMin <= 12)
                    ? Math.max(0, 1 - (elapsedExtMin / 12))
                    : 0;
                const dRoomSlope = Math.max(-0.10, Math.min(0.25, slopeExtPerMin)) * subDtMin;
                const dRoomStep = (wExtSlope > 0 && slopeExtPerMin !== 0)
                    ? (wExtSlope * dRoomSlope + (1 - wExtSlope) * dRoomPhys)
                    : dRoomPhys;
                tExtSim += dRoomStep;
            }

            // Janela de Sifão Pós-AC + Histerese Térmica + Guarda de Umidade
            // Só abre a janela Pós-AC se o AC realmente completou o objetivo (!simArFalhouCiclo)
            if (simArPrev && !simArOn && tSifaoPosAcMin > 0 && !simArFalhouCiclo) {
                simSifaoAteTs = t + (tSifaoPosAcMin * 60000);
            } else if (simArOn || simArFalhouCiclo) {
                simSifaoAteTs = 0;
            }
            simArPrev = simArOn;

            const simEmJanelaSifao = (simSifaoAteTs > 0 && t < simSifaoAteTs);
            const simAproveitandoFrio = !!cfgProj && !simArOn && simEmJanelaSifao;

            // Pré-Resfriamento Evaporativo (Estágio 1 antes do AC)
            const tWetSalaSim = calculaBulboUmidoStull(tExtSim, hExtSim);
            const tDisparoEvapSim = tMeta - tEvapAntecipaSim;
            const tMetaSucessoEvapSim = Math.max(tCongelaSim + 0.5, tMeta - Math.max(0.5, tHistereseArSim * 0.55));
            const evapViavelSim = (hExtSim < 86.0 && tExtSim <= (tMeta + 1.5) && tWetSalaSim <= (tMeta - 1.2));
            if (simEvapAtivo) {
                const perdeuGrad = (hExtSim >= 89.0 || tExtSim > (tMeta + 2.0) || tWetSalaSim > (tMeta - 0.8));
                const aqueceuDemais = (tIntBase !== null) && ((tIntBase >= tMeta + 0.4) || (tIntBase >= simEvapTempInicio + 0.35 && tIntBase >= tMeta - 0.1));
                const sucessoEvap = (tIntBase !== null) && (tIntBase <= tMetaSucessoEvapSim && tIntBase <= simEvapTempInicio - 0.3);
                const timeoutEvap = ((t - simEvapInicioTs) >= tEvapPreMin * 60000);
                if (arState !== 0 || simArOn || simEmJanelaSifao || tEvapPreMin <= 0 || tIntBase === null || tIntBase <= tCongelaSim || t < simDescansoPreventivoAteTs) {
                    simEvapAtivo = false;
                    simEvapOndaSeca = false;
                } else if (sucessoEvap) {
                    simEvapAtivo = false;
                    simEvapOndaSeca = false;
                    simEvapCooldownAteTs = t + Math.min(tEvapCooldownMin, 15) * 60000;
                } else if (perdeuGrad || aqueceuDemais) {
                    simEvapAtivo = false;
                    simEvapOndaSeca = false;
                    simEvapCooldownAteTs = t + (tEvapCooldownMin * 60000);
                } else if (timeoutEvap) {
                    simEvapAtivo = false;
                    simEvapOndaSeca = false;
                    if (tIntBase < tMeta && tIntBase <= simEvapTempInicio - 0.25) {
                        simEvapCooldownAteTs = t + Math.min(tEvapCooldownMin, 15) * 60000;
                    } else {
                        simEvapCooldownAteTs = t + (tEvapCooldownMin * 60000);
                    }
                }
            } else if (cfgProj && arState === 0 && tEvapPreMin > 0 && !simArOn && !simEmJanelaSifao && tIntBase !== null && tIntBase > tCongelaSim && t >= simDescansoPreventivoAteTs && t >= simEvapCooldownAteTs) {
                if (tIntBase >= tDisparoEvapSim && tIntBase < (tMeta + 0.4) && evapViavelSim) {
                    simEvapAtivo = true;
                    simEvapInicioTs = t;
                    simEvapTempInicio = tIntBase;
                    simEvapOndaSeca = (simHumInt >= 95.5 && simHumInt >= uGuardaCorteSim);
                }
            }

            if (!simAproveitandoFrio || tIntBase === null || tIntBase <= tSifaoMinSim) {
                simInjecaoTermoOk = false;
            } else if (tExtSim <= (tIntBase - tDeltaExtSim)) {
                simInjecaoTermoOk = true;
            } else if (tExtSim >= (tIntBase - tDeltaSaidaSim)) {
                simInjecaoTermoOk = false;
            }

            if (!simAproveitandoFrio) {
                if (simHumInt >= uGuardaCorteSim) simGuardaUmidOk = true;
            } else if (simHumInt < uGuardaCorteSim) {
                simGuardaUmidOk = false;
            } else if (simHumInt >= uGuardaRetornoSim || simHumInt >= 99.5) {
                simGuardaUmidOk = true;
            }

            // FAE programado (pausado durante o AC ativo) + Sifão de Ar Frio Pós-AC
            let isFaeProgOn = false;
            if (cfgProj && cfgProj.fO > 0 && !simArOn) {
                if (cfgProj.fF == 0) isFaeProgOn = true;
                else {
                    const cFAE = (cfgProj.fO + cfgProj.fF) * 60000;
                    if ((t % cFAE) < (cfgProj.fO * 60000)) isFaeProgOn = true;
                }
            }
            const isSifaoExaustOn = simAproveitandoFrio && simInjecaoTermoOk && simGuardaUmidOk;
            const isEvapExaustOn = false; // Pré-resfriamento evaporativo usa apenas vento interno e névoa fresca
            let isEvapUmidOn = simEvapAtivo;
            const isExaustOn = isFaeProgOn || isSifaoExaustOn;
            if (isFaeProgOn && !simPrevExaustOn && !simArOn && !simEmJanelaSifao) {
                simFaeStartTs = t;
            }
            simPrevExaustOn = isFaeProgOn;

            // Vento Interno
            let isVentoProgOn = false;
            if (cfgProj && cfgProj.vO > 0) {
                if (cfgProj.vF == 0) isVentoProgOn = true;
                else {
                    const cVento = (cfgProj.vO + cfgProj.vF) * 60000;
                    if ((t % cVento) < (cfgProj.vO * 60000)) isVentoProgOn = true;
                }
            }
            let isVentoOn = isVentoProgOn || (simEvapAtivo && !isEvapExaustOn);

            // Umidificador (histerese 0.5%, Névoa na Brisa livre do teto, Sifão e Evaporação)
            const tetoHistereseUmid = Math.min(99.5, uAlvoSim + 0.5);
            if (simHumInt < uAlvoSim) simUmidHist = true;
            else if (simHumInt >= tetoHistereseUmid) simUmidHist = false;
            let isUmidOn = simUmidHist;
            if (cfgProj && cfgProj.vU == 1 && isVentoProgOn) isUmidOn = true;
            if (simAproveitandoFrio && !simGuardaUmidOk && simHumInt < 99.5) {
                isUmidOn = true;
                isVentoOn = true;
            }
            if (isEvapUmidOn && simHumInt < 98.5) {
                isUmidOn = true;
                isVentoOn = true;
            }
            if (isExaustOn) isUmidOn = false;
            if (isUmidOn) isVentoOn = true;

            // Dinâmica da umidade calibrada pelo histórico real do grow
            if (isExaustOn) {
                const diffH = Math.max(0, simHumInt - hExtSim);
                const kHumEfetivo = (isSifaoExaustOn && !isFaeProgOn) ? Math.min(kHumExaust, 0.032) : kHumExaust;
                const taxaQuedaUmid = Math.max(0.40, diffH * kHumEfetivo);
                simHumInt = Math.max(70.0, simHumInt - taxaQuedaUmid * subDtMin);
            } else if (isUmidOn) {
                const fatorTopo = simHumInt > 96.5 ? Math.max(0.35, (100.2 - simHumInt) / 3.7) : 1.0;
                simHumInt = Math.min(100.0, simHumInt + (rHumUmidUp * fatorTopo) * subDtMin);
            } else {
                simHumInt += (uAlvoSim - simHumInt) * Math.min(1, 0.04 * subDtMin);
            }

            // Simulação da Estufa calibrada no histórico (sem V-spikes artificiais e sem dupla soma AC+Sifão)
            let motivoAr = null;
            let tIntPlot = null;
            if (tIntBase !== null) {
                if (!simArOn && isSifaoExaustOn && tExtSim < tIntBase) {
                    tIntBase += (tExtSim - tIntBase) * (1 - Math.exp(-kSifaoMix * subDtMin));
                }
                const elapsedMin = (t - maxTs) / 60000;
                const weightSlope = Math.max(0, 1 - (elapsedMin / 18));
                const dSlope = (slopePerMin > -0.04 && slopePerMin < 0.06) ? (slopePerMin * subDtMin) : 0;
                const tIntTarget = tExtSim + (isLuzOn ? deltaGrowOn : deltaGrowOff);
                const dCouple = (tIntTarget - tIntBase) * (1 - Math.exp(-kGrowWarm * subDtMin));
                const dNaturalStep = (slopePerMin !== 0 && weightSlope > 0)
                    ? (weightSlope * dSlope + (1 - weightSlope) * dCouple)
                    : dCouple;

                // Aplica assinatura suave aprendida de FAE puro (respeitando umidade simulada real)
                let faeOffset = 0;
                if (simFaeStartTs > 0 && !simArOn && !isSifaoExaustOn && simHumInt >= 85) {
                    const ageMin = (t - simFaeStartTs) / 60000;
                    if (ageMin >= 0 && ageMin <= FAE_LEN) {
                        const scaleHum = Math.max(0.25, Math.min(1.15, (90 - hExtSim) / Math.max(8, 90 - avgHeFaePast)));
                        faeOffset = evalFaeTemplate(ageMin) * scaleHum;
                    }
                }

                if (arState === 1) {
                    simArOn = true;
                    motivoAr = 'Manual ON';
                    tIntBase += (Math.max(18.0, tCongelaSim) - tIntBase) * (1 - Math.exp(-0.025 * subDtMin));
                    tIntPlot = tIntBase;
                } else if (arState === 2 || !cfgProj) {
                    simArOn = false;
                    tIntBase += dNaturalStep;
                    tIntPlot = tIntBase + faeOffset;
                } else {
                    if (simArOn) {
                        // Queda exponencial natural em direção ao alvo pós-meta (curva orgânica em vez de V seco)
                        const gapMeta = Math.max(0, tIntBase - tAlvoPos);
                        const kCoolGrow = Math.min(0.14, Math.max(0.028, avgCoolRate / Math.max(1.2, (tMeta - tMetaOff) + 0.7)));
                        const expPull = gapMeta * (1 - Math.exp(-kCoolGrow * subDtMin));
                        const linearFloor = Math.min(avgCoolRate * subDtMin, gapMeta);
                        const stepCool = Math.min(gapMeta, 0.55 * expPull + 0.45 * linearFloor) + (isSifaoExaustOn && tExtSim < tIntBase ? 0.015 * (tIntBase - tExtSim) : 0);
                        tIntBase = tIntBase - stepCool;
                        tIntPlot = tIntBase;
                        if (emPrimeiroCicloAc && tIntPlot < minTempPrimeiroCiclo) minTempPrimeiroCiclo = tIntPlot;
                        motivoAr = (tIntPlot < tMetaOff)
                            ? (tPosMetaMin > 0 ? `Pós-meta (< ${tMetaOff.toFixed(1)}°C)` : `Meta ${tMetaOff.toFixed(1)}°C atingida`)
                            : `Resfriando (desliga < ${tMetaOff.toFixed(1)}°C)`;

                        if (tIntPlot < tMetaOff) {
                            if (!simArAbaixoMetaTs) simArAbaixoMetaTs = t;
                        } else {
                            simArAbaixoMetaTs = 0;
                        }

                        const passouMaxRun = (t - simArInicioTs) >= (tMaxRunMin * 60000);
                        const passouCongela = tIntPlot <= tCongelaSim;
                        const passouPosMeta = (simArAbaixoMetaTs > 0) && (tPosMetaMin === 0 || ((t - simArAbaixoMetaTs) >= (tPosMetaMin * 60000)));
                        if (passouMaxRun || passouCongela || passouPosMeta) {
                            simArFalhouCiclo = (passouMaxRun && !passouCongela && !passouPosMeta);
                            simArOn = false;
                            simArUltimoDesligTs = t;
                            simArAbaixoMetaTs = 0;
                            if (passouMaxRun) simDescansoPreventivoAteTs = t + (10 * 60000);
                            if (emPrimeiroCicloAc) {
                                primeiroAcDesligaTs = t;
                                emPrimeiroCicloAc = false;
                            }
                        }
                    } else {
                        if (simEvapAtivo) {
                            const gapWet = Math.max(0, tIntBase - tWetSalaSim);
                            const evapStep = Math.min(0.24, gapWet * 0.045) * subDtMin;
                            tIntBase += dNaturalStep - evapStep;
                        } else {
                            tIntBase += dNaturalStep;
                        }
                        tIntPlot = tIntBase + faeOffset;
                        if (!simEvapAtivo && (t >= simDescansoPreventivoAteTs) && (t - simArUltimoDesligTs >= 3 * 60000) && (tIntPlot >= tMeta) && (tIntPlot > tCongelaSim)) {
                            simArOn = true;
                            simArFalhouCiclo = false;
                            simArInicioTs = t;
                            simArAbaixoMetaTs = 0;
                            tIntBase = tIntPlot;
                            qtdCiclosAcPrev++;
                            if (!primeiroAcTrigger) {
                                primeiroAcTrigger = t;
                                emPrimeiroCicloAc = true;
                                minTempPrimeiroCiclo = tIntPlot;
                            }
                            motivoAr = `Arma em ${tMeta.toFixed(1)}°C (desliga < ${tMetaOff.toFixed(1)}°C)`;
                        }
                    }
                }

                tIntBase = Math.max(14.0, Math.min(42.0, tIntBase));
                tIntPlot = Math.max(14.0, Math.min(42.0, tIntPlot));
                if (tIntPlot > maxTempIntPrev) maxTempIntPrev = tIntPlot;
            }

            const motivoExaust = isExaustOn ? (isSifaoExaustOn ? 'Puxando Ar Frio (Pós-AC)' : 'FAE Programado') : null;
            const motivoUmid = isUmidOn ? ((simAproveitandoFrio && !simGuardaUmidOk) ? 'Reidratando (Pós-Frio)' : (isEvapUmidOn ? 'Evaporação (Névoa Fria)' : (simHumInt < uAlvoSim ? 'Recuperando Alvo' : 'Brisa c/ Névoa'))) : null;

            accLuz = accLuz || isLuzOn;
            accUmid = accUmid || isUmidOn;
            accVento = accVento || isVentoOn;
            accExaust = accExaust || isExaustOn;
            accAr = accAr || simArOn;
            if (motivoExaust && !accMotEx) accMotEx = motivoExaust;
            if (motivoUmid && !accMotUm) accMotUm = motivoUmid;
            if (motivoAr && !accMotAr) accMotAr = motivoAr;

            // Emite ponto para os gráficos no múltiplo exato de passoMin (1m em 24h, 5m em 7 Dias)
            if ((t - maxTs) % passoMs === 0) {
                const tIntVal = (tIntPlot !== null) ? parseFloat(tIntPlot.toFixed(2)) : null;

                dLuz.push({ x: t, y: accLuz ? [2.65, 3.35] : null, ghost: true });
                dExaust.push({ x: t, y: accExaust ? [-0.35, 0.35] : null, ghost: true, motivo: accMotEx });
                dVento.push({ x: t, y: accVento ? [0.65, 1.35] : null, ghost: true });
                dUmid.push({ x: t, y: accUmid ? [1.65, 2.35] : null, ghost: true, motivo: accMotUm });
                dAr.push({ x: t, y: accAr ? [3.65, 4.35] : null, ghost: true, motivo: accMotAr });

                dTempInt.push({ x: t, y: null });
                dTempExt.push({ x: t, y: null });
                dTempProj.push({ x: t, y: tIntVal });
                dTempExtProj.push({ x: t, y: parseFloat(tExtSim.toFixed(2)) });
                dHumInt.push({ x: t, y: null });
                dHumExt.push({ x: t, y: null });
                dHumIntProj.push({ x: t, y: parseFloat(simHumInt.toFixed(1)) });
                dHumExtProj.push({ x: t, y: parseFloat(hExtSim.toFixed(1)) });

                accLuz = accUmid = accVento = accExaust = accAr = false;
                accMotEx = accMotUm = accMotAr = null;
            }
        }

        // Alimenta o badge de status do AC e o Radar Meteorológico/Simulação do Dia
        const previsaoAr = {
            ativo: (lastArOn || !!primeiroAcTrigger),
            sempreOn: (arState === 1),
            tMeta,
            lastTi,
            slopePerHour: slopePerMin * 60,
            restanteMin: (lastArOn && primeiroAcDesligaTs) ? Math.max(1, Math.round((primeiroAcDesligaTs - maxTs) / 60000)) : null,
            tDesliga: (lastArOn && primeiroAcDesligaTs) ? primeiroAcDesligaTs : null,
            tTrigger: (!lastArOn && primeiroAcTrigger) ? primeiroAcTrigger : null,
            status: (arState === 1) ? 'manual_on'
                : (arState === 2) ? 'manual_off'
                : (!cfgProj) ? 'inativo'
                : (lastArOn) ? 'ligado'
                : (primeiroAcTrigger) ? 'agendado'
                : ((maxTempIntPrev > -90 && (tMeta - maxTempIntPrev) <= 0.4) ? 'perto_estavel' : 'estavel')
        };
        window.previsaoArInfo = previsaoAr;

        let resumoSimTxt = null;
        if (maxTempIntPrev > -90) {
            if (arState === 1) {
                resumoSimTxt = `🔮 Próx. 10h: AC Manual ON • Mín prev ~${minTempPrimeiroCiclo.toFixed(1)}°C`;
            } else if (arState === 2) {
                resumoSimTxt = `🔮 Próx. 10h: T.Int máx ~${maxTempIntPrev.toFixed(1)}°C (AC Manual OFF)`;
            } else if (!cfgProj) {
                resumoSimTxt = `🔮 Próx. 10h: T.Int máx ~${maxTempIntPrev.toFixed(1)}°C`;
            } else if (lastArOn) {
                resumoSimTxt = `🔮 Próx. 10h: AC gelando até ~${minTempPrimeiroCiclo.toFixed(1)}°C • Máx ~${maxTempIntPrev.toFixed(1)}°C`;
            } else if (primeiroAcTrigger) {
                const horaAc = new Date(primeiroAcTrigger).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                resumoSimTxt = `🔮 Próx. 10h: Máx ~${maxTempIntPrev.toFixed(1)}°C • ❄️ AC arma ~${horaAc} (gela até ~${minTempPrimeiroCiclo.toFixed(1)}°C, ${qtdCiclosAcPrev}x)`;
            } else {
                resumoSimTxt = `🔮 Próx. 10h: T.Int máx ~${maxTempIntPrev.toFixed(1)}°C • ✅ Sem disparo de AC previsto`;
            }
            atualizarRadarClimaUI({ texto: resumoSimTxt });
        }

    return { tEnd, maxTs, resumoSimTxt };
}
