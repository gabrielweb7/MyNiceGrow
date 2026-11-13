// ========================================================
// GESTÃO DE PARÂMETROS, CLIMA, HVAC, FASE E CONTROLES
// ========================================================

function abrirConfig(aba = null) {
    navegarView('config');
    if (aba) trocarAbaConfig(aba);
}

function fecharConfig() {
    navegarView('dashboard');
}

const abasConfig = ['clima', 'hvac', 'luz', 'ota', 'admin', 'sistema'];
function trocarAbaConfig(abaAlvo) {
    abasConfig.forEach(aba => {
        const btn = document.getElementById('tabBtn' + aba.charAt(0).toUpperCase() + aba.slice(1));
        const content = document.getElementById('tabContent' + aba.charAt(0).toUpperCase() + aba.slice(1));
        if (aba === abaAlvo) {
            if (content) {
                content.classList.remove('hidden');
                content.classList.remove('fade-in');
                void content.offsetWidth;
                content.classList.add('fade-in');
            }
            if (btn) {
                btn.className = "text-left px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-bold flex items-center gap-3 transition-all bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-md shrink-0";
            }
        } else {
            if (content) content.classList.add('hidden');
            if (btn) {
                btn.className = "text-left px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-bold flex items-center gap-3 transition-all text-slate-400 hover:text-white hover:bg-slate-800/80 border border-transparent shrink-0";
            }
        }
    });
}

function atualizarDadosViewConfig() {
    let p = window.fwPlaca;
    let n = window.fwNuvem;
    let err = window.fwError;
    let vFw = window.vFirmware || '--';
    let vNuvem = window.vFirmwareNuvem || '--';
    let board = window.boardModel || 'ESP32-C3';
    
    const badgeBoard = document.getElementById('badgeBoardModel');
    if (badgeBoard) badgeBoard.textContent = board;
    const cfgBoardBanner = document.getElementById('cfgBoardBanner');
    if (cfgBoardBanner) cfgBoardBanner.textContent = board;

    const uiPlaca = document.getElementById('uiFwPlaca');
    const uiNuvem = document.getElementById('uiFwNuvem');
    let dataP = (p && p !== '0' && p !== 0) ? formatarDataFW(p) : '';
    let dataN = (n && n !== '0' && n !== 0) ? formatarDataFW(n) : '';
    let extraP = (dataP && dataP !== 'Desconhecida') ? `<span class="text-xs text-slate-500 font-normal">(${dataP})</span>` : '';
    let extraN = (dataN && dataN !== 'Desconhecida') ? `<span class="text-xs text-slate-500 font-normal">(${dataN})</span>` : '';
    
    if (uiPlaca) uiPlaca.innerHTML = `<span class="text-emerald-400 font-bold">${vFw}</span> ${extraP}`;
    if (uiNuvem) uiNuvem.innerHTML = `<span class="text-cyan-400 font-bold">${vNuvem}</span> ${extraN}`;

    const cardRollback = document.getElementById('cardAlertaRollback');
    if (cardRollback) {
        if (err === '1') cardRollback.classList.remove('hidden');
        else cardRollback.classList.add('hidden');
    }
    
    let statusBadge = document.getElementById('otaStatusBadge');
    if (statusBadge) {
        let numPlaca = parseInt((vFw || '').replace(/\D/g, '')) || 0;
        let numNuvem = parseInt((vNuvem || '').replace(/\D/g, '')) || 0;
        if (err === '1') {
            statusBadge.innerHTML = '<span class="bg-rose-500/20 text-rose-400 text-[10px] px-2.5 py-1 rounded-full font-bold animate-pulse border border-rose-500/30">❌ OTA FALHOU (REVERTIDO)</span>';
        } else if (numPlaca >= numNuvem && numPlaca > 0) {
            statusBadge.innerHTML = `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] px-2.5 py-1 rounded-full font-bold border border-emerald-500/30">✓ ATUALIZADO (${vFw})</span>`;
        } else if (numNuvem > numPlaca) {
            statusBadge.innerHTML = `<span class="bg-amber-500/20 text-amber-400 text-[10px] px-2.5 py-1 rounded-full font-bold animate-pulse border border-amber-500/30">⚠️ NOVA VERSÃO DISPONÍVEL (${vNuvem})</span>`;
        } else {
            statusBadge.innerHTML = '';
        }

        // CONTROLE INTELIGENTE DO BOTÃO DE ATUALIZAR OTA:
        // Se a placa já estiver na versão mais recente da nuvem, desativa o botão de atualizar para evitar uploads desnecessários.
        const btnOta = document.getElementById('btnEnviarOta');
        if (btnOta && !btnOta.dataset.atualizando) {
            if (numPlaca >= numNuvem && numPlaca > 0) {
                btnOta.disabled = true;
                btnOta.className = "flex-1 bg-slate-800/80 border border-slate-700/60 text-slate-400 font-bold text-xs sm:text-sm py-3.5 rounded-xl cursor-not-allowed opacity-60 flex items-center justify-center gap-2 transition-all";
                btnOta.innerHTML = '<span>✓</span> <span>Versão Mais Recente Já Instalada</span>';
            } else if (numNuvem > numPlaca) {
                btnOta.disabled = false;
                btnOta.className = "flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm py-3.5 rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2 active:scale-[0.99] cursor-pointer animate-pulse";
                btnOta.innerHTML = `<span>⚡</span> <span>Instalar Nova Versão (${vNuvem}) na Placa</span>`;
            } else {
                btnOta.disabled = false;
                btnOta.className = "flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm py-3.5 rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2 active:scale-[0.99]";
                btnOta.innerHTML = '<span>⚡</span> <span>Instalar Versão da Nuvem na Placa</span>';
            }
        }

        // CONTROLE INTELIGENTE DO BOTÃO DE ROLLBACK:
        const btnRollback = document.getElementById('btnRollbackOta');
        if (btnRollback) {
            if (window.canRollback === 1) {
                btnRollback.disabled = false;
                btnRollback.className = "bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-rose-200 border border-rose-500/30 font-bold text-xs sm:text-sm py-3.5 px-5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 active:scale-[0.99] cursor-pointer";
                btnRollback.innerHTML = '<span>↩️</span> <span>Reverter p/ Versão Anterior (Dual-Bank)</span>';
                btnRollback.title = "Reverte imediatamente para a partição estável anterior via Dual-Bank";
            } else {
                btnRollback.disabled = true;
                btnRollback.className = "bg-slate-800/40 border border-slate-700/40 text-slate-500 font-bold text-xs sm:text-sm py-3.5 px-5 rounded-xl cursor-not-allowed opacity-50 flex items-center justify-center gap-2";
                btnRollback.innerHTML = '<span>↩️</span> <span>Sem Rollback Disponível</span>';
                btnRollback.title = "Nenhuma versão anterior gravada no Dual-Bank";
            }
        }
    }
    
    const savedPass = localStorage.getItem('adminPass') || '';
    const inputPass = document.getElementById('inputAdminPass');
    if (inputPass && document.activeElement !== inputPass) inputPass.value = savedPass;
    const fbPass = document.getElementById('adminPassFeedback');
    if (fbPass) {
        if (savedPass) {
            fbPass.classList.remove('hidden');
            fbPass.innerHTML = '<span>🔒</span> <span>Chave ativa salva localmente (' + savedPass.length + ' dígitos).</span>';
        } else {
            fbPass.classList.add('hidden');
        }
    }

    // Atualiza status do banner na página de config
    const cfgFaseBanner = document.getElementById('cfgFaseBanner');
    if (cfgFaseBanner) {
        const faseTxt = document.getElementById('valFase')?.textContent || '--';
        cfgFaseBanner.textContent = 'Fase: ' + faseTxt;
    }
    sincronizarUiMetaAr();
    sincronizarUiSifaoRetorno();
    sincronizarUiSifaoDelta();

    // Atualiza status do modo de luz na página de config
    const cfgStatusLuz = document.getElementById('cfgStatusLuzTexto');
    if (cfgStatusLuz) {
        const modoLuz = (luzState === 0) ? "AUTO (12h/12h) ☀️" : ((luzState === 1) ? "FORÇADO LIGADO 💡" : "FORÇADO DESLIGADO 🌑");
        cfgStatusLuz.innerHTML = `<span>⚡</span> <span>Modo: ${modoLuz}</span>`;
    }
}

let usuarioTrocouSelConfigFase = false;
let configClima = {
    "1": { tX: 28.0, uA: 95.0, uN: 95.0, uX: 95.0, fO: 1, fF: 40, vO: 1, vF: 2, vU: 1 },
    "2": { tX: 29.0, uA: 92.0, uN: 92.0, uX: 92.0, fO: 2, fF: 25, vO: 1, vF: 2, vU: 1 }
};

async function fetchConfigClima() {
    try {
        let r = await fetch('api/index.php?get_config=1&nocache=' + Date.now());
        if (r.ok) {
            let d = await r.json();
            if (d && d.config_clima && d.config_clima["1"]) {
                configClima = d.config_clima;
            }
        }
    } catch (e) { console.log("Config padrao carregada:", e); }
    carregarFormClima();

    // Re-renderiza as metas climáticas na tela com os dados confirmados do banco
    let f_limpa = (document.getElementById('valFase').textContent || '').replace(' (DHT OFFLINE)', '').replace('ALERTA: SHT30 OFFLINE', 'Standby');
    if (f_limpa && f_limpa !== '--') {
        renderizarInfoFase(f_limpa, false);
    }
    if (window.ultimoRegistroRecebido) {
        const u = window.ultimoRegistroRecebido;
        atualizarCoresDinamicas(parseFloat(u.temp_int), parseFloat(u.hum_int), parseFloat(u.temp_ext), u.fase);
    }
}

function obterConfigFaseAtiva() {
    const valFaseTxt = document.getElementById('valFase')?.textContent || '';
    const fStr = fasePendenteAlvo || (window.ultimoRegistroRecebido && window.ultimoRegistroRecebido.fase) || valFaseTxt || '';
    let key = null;
    let nome = null;
    if (fStr.includes('Pinagem')) { key = '1'; nome = 'Pinagem'; }
    else if (fStr.includes('Frutifica')) { key = '2'; nome = 'Frutificação'; }

    const selFase = document.getElementById('selConfigFase');
    const editKey = selFase ? selFase.value : '1';
    const ativaKey = key || editKey || '1';
    const ativaNome = nome || (ativaKey === '1' ? 'Pinagem' : 'Frutificação');

    let tX = (configClima[ativaKey] && configClima[ativaKey].tX !== undefined)
        ? parseFloat(configClima[ativaKey].tX)
        : (ativaKey === '1' ? 28.0 : 29.0);
    let uA = (configClima[ativaKey] && (configClima[ativaKey].uA !== undefined || configClima[ativaKey].uN !== undefined))
        ? parseFloat(configClima[ativaKey].uA !== undefined ? configClima[ativaKey].uA : configClima[ativaKey].uN)
        : (ativaKey === '1' ? 95.0 : 92.0);

    if (editKey === ativaKey) {
        const inpTx = document.getElementById('cfgTx');
        if (inpTx && inpTx.value !== '') {
            const v = parseFloat(String(inpTx.value).replace(',', '.'));
            if (Number.isFinite(v)) tX = Math.max(15.0, Math.min(35.0, v));
        }
        const inpUa = document.getElementById('cfgUa');
        if (inpUa && inpUa.value !== '') {
            const v = parseFloat(String(inpUa.value).replace(',', '.'));
            if (Number.isFinite(v)) uA = Math.max(40.0, Math.min(99.0, v));
        }
    }

    return { key: ativaKey, nome: ativaNome, temFaseClima: !!key, tX, uA };
}

function sincronizarUiMetaAr() {
    const inpCong = document.getElementById('cfgTCongela');
    const inpHist = document.getElementById('cfgTHistereseAr');
    const badge = document.getElementById('badgeMetaDesligaAr');
    if (!badge) return;
    const parseF = (el, min, max, def) => {
        if (!el || el.value === '') return def;
        const v = parseFloat(String(el.value).replace(',', '.'));
        return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def;
    };
    const info = obterConfigFaseAtiva();
    const tX = info.tX;
    const tCong = parseF(inpCong, 5.0, 25.0, 15.0);
    const tHist = parseF(inpHist, 0.0, 5.0, 1.0);
    const metaDesliga = Math.max(tCong + 0.2, tX - tHist);
    const prefixo = info.temFaseClima ? info.nome : `Ex. ${info.nome}`;
    badge.textContent = `${prefixo}: Liga estufa ${tX.toFixed(1)}°C ➔ Desliga quarto < ${metaDesliga.toFixed(1)}°C`;
}

function sincronizarUiSifaoDelta() {
    const badge = document.getElementById('badgeSifaoDeltaExemplo');
    if (!badge) return;
    const parseF = (el, min, max, def) => {
        if (!el || el.value === '') return def;
        const v = parseFloat(String(el.value).replace(',', '.'));
        return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def;
    };
    const dLiga = parseF(document.getElementById('cfgTDeltaExt'), 0.1, 5.0, 0.4);
    const dDesliga = Math.min(dLiga, parseF(document.getElementById('cfgTDeltaSaida'), 0.0, 2.0, 0.1));
    const info = obterConfigFaseAtiva();
    const tRef = info.tX;
    const tLigaSala = tRef - dLiga;
    const prefixo = info.temFaseClima ? info.nome : `Ex. ${info.nome}`;
    badge.textContent = `${prefixo} (${tRef.toFixed(1)}°C): Puxa se quarto ≤ ${tLigaSala.toFixed(1)}°C • Para na dif. de ${dDesliga.toFixed(1)}°C`;
}

function calculaBulboUmidoStull(t, rh) {
    const rhC = Math.max(5, Math.min(100, rh));
    return t * Math.atan(0.151977 * Math.sqrt(rhC + 8.313659))
         + Math.atan(t + rhC) - Math.atan(rhC - 1.676331)
         + 0.00391838 * Math.pow(rhC, 1.5) * Math.atan(0.023101 * rhC) - 4.686035;
}

function sincronizarUiEvap() {
    const badge = document.getElementById('badgeEvapPreAc');
    if (!badge) return;
    const parseNum = (el, min, max, def) => {
        if (!el) return def;
        const v = parseFloat(String(el.value).replace(',', '.'));
        return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def;
    };
    const tPre = Math.round(parseNum(document.getElementById('cfgTEvapPre'), 0, 15, 4));
    const tAnt = parseNum(document.getElementById('cfgTEvapAnt'), 0, 1.5, 0.3);
    const tCool = Math.round(parseNum(document.getElementById('cfgTEvapCool'), 10, 180, 45));
    const info = obterConfigFaseAtiva();
    const tRef = info.tX;
    const tLiga = tRef - tAnt;
    const prefixo = info.temFaseClima ? info.nome : `Ex. ${info.nome}`;
    if (tPre === 0) {
        badge.textContent = `${prefixo} (${tRef.toFixed(1)}°C): Desativado • AC entra direto em ${tRef.toFixed(1)}°C`;
    } else {
        badge.textContent = `${prefixo} (${tRef.toFixed(1)}°C): Testa em ≥ ${tLiga.toFixed(1)}°C por ${tPre} min • Pausa ${tCool} min`;
    }
}

function sincronizarUiSifaoRetorno() {
    const chk = document.getElementById('cfgURetornoAlvo');
    const inpRet = document.getElementById('cfgUGuardaRetorno');
    const badge = document.getElementById('badgeSifaoUmidadeAlvo');
    const info = obterConfigFaseAtiva();
    const alvoVal = Math.max(40, Math.min(99, info.uA));
    if (badge) {
        badge.textContent = (chk && chk.checked)
            ? `Alvo ${info.nome}: ${alvoVal.toFixed(1)}%`
            : 'Modo Manual';
    }
    if (inpRet && chk) {
        inpRet.disabled = chk.checked;
        if (chk.checked) {
            inpRet.value = alvoVal.toFixed(1);
        }
    }
}

function carregarFormClima() {
    const selFase = document.getElementById('selConfigFase');
    if (selFase && !usuarioTrocouSelConfigFase) {
        const infoAtiva = obterConfigFaseAtiva();
        if (infoAtiva.temFaseClima && (infoAtiva.key === '1' || infoAtiva.key === '2')) {
            selFase.value = infoAtiva.key;
        }
    }
    let f = selFase ? selFase.value : '1';
    let cfg = configClima[f];
    if (cfg) {
        document.getElementById('cfgTx').value = cfg.tX;
        let uAlvo = cfg.uA !== undefined ? cfg.uA : (cfg.uN !== undefined ? cfg.uN : 95.0);
        document.getElementById('cfgUa').value = uAlvo;
        document.getElementById('cfgFo').value = cfg.fO;
        document.getElementById('cfgFf').value = cfg.fF;
        document.getElementById('cfgVo').value = cfg.vO !== undefined ? cfg.vO : 1;
        document.getElementById('cfgVf').value = cfg.vF !== undefined ? cfg.vF : 2;
        document.getElementById('cfgVu').checked = cfg.vU !== undefined ? (cfg.vU == 1) : true;
    }

    // Carrega travas de segurança, guarda de umidade e Sifão Térmico Pós-AC
    const hv = configClima.hvac || {};
    if (document.getElementById('cfgTCongela')) document.getElementById('cfgTCongela').value = hv.tCongela !== undefined ? hv.tCongela : 15.0;
    if (document.getElementById('cfgTHistereseAr')) document.getElementById('cfgTHistereseAr').value = hv.tHistereseAr !== undefined ? hv.tHistereseAr : 1.0;
    if (document.getElementById('cfgTPosMeta')) document.getElementById('cfgTPosMeta').value = hv.tPosMeta !== undefined ? hv.tPosMeta : 5;
    if (document.getElementById('cfgTMaxRun')) document.getElementById('cfgTMaxRun').value = hv.tMaxRun !== undefined ? hv.tMaxRun : 45;
    if (document.getElementById('cfgTCorteLuz')) document.getElementById('cfgTCorteLuz').value = hv.tCorteLuz !== undefined ? hv.tCorteLuz : 34.0;
    if (document.getElementById('cfgTSifaoPosAc')) document.getElementById('cfgTSifaoPosAc').value = hv.tSifaoPosAc !== undefined ? hv.tSifaoPosAc : 15;
    if (document.getElementById('cfgTEvapPre')) document.getElementById('cfgTEvapPre').value = hv.tEvapPre !== undefined ? hv.tEvapPre : 4;
    if (document.getElementById('cfgTEvapAnt')) document.getElementById('cfgTEvapAnt').value = hv.tEvapAnt !== undefined ? hv.tEvapAnt : 0.3;
    if (document.getElementById('cfgTEvapCool')) document.getElementById('cfgTEvapCool').value = hv.tEvapCool !== undefined ? hv.tEvapCool : 45;
    sincronizarUiMetaAr();
    sincronizarUiEvap();
}

async function salvarFormClima() {
    let f = document.getElementById('selConfigFase').value;
    const clampVal = (raw, min, max, def) => {
        const v = parseFloat(String(raw).replace(',', '.'));
        if (!Number.isFinite(v)) return def;
        return Math.max(min, Math.min(max, v));
    };
    const defTx = (f === "1") ? 28.0 : 29.0;
    const defUa = (f === "1") ? 95.0 : 92.0;
    const defFo = (f === "1") ? 1 : 2;
    const defFf = (f === "1") ? 40 : 25;

    let tXVal = Math.round(clampVal(document.getElementById('cfgTx').value, 15.0, 35.0, defTx) * 10) / 10;
    let uAlvoVal = Math.round(clampVal(document.getElementById('cfgUa').value, 40.0, 99.0, defUa) * 10) / 10;
    let fOVal = Math.round(clampVal(document.getElementById('cfgFo').value, 0, 1440, defFo));
    let fFVal = Math.round(clampVal(document.getElementById('cfgFf').value, 0, 1440, defFf));
    let vOVal = Math.round(clampVal(document.getElementById('cfgVo').value, 0, 1440, 1));
    let vFVal = Math.round(clampVal(document.getElementById('cfgVf').value, 0, 1440, 2));

    // Travas de segurança, Sifão Térmico Pós-AC & HVAC
    let tCongelaVal = Math.round(clampVal(document.getElementById('cfgTCongela') ? document.getElementById('cfgTCongela').value : 15.0, 5.0, 25.0, 15.0) * 10) / 10;
    let tHistereseArVal = Math.round(clampVal(document.getElementById('cfgTHistereseAr') ? document.getElementById('cfgTHistereseAr').value : 1.0, 0.0, 5.0, 1.0) * 10) / 10;
    let tPosMetaVal = Math.round(clampVal(document.getElementById('cfgTPosMeta') ? document.getElementById('cfgTPosMeta').value : 5, 0, 60, 5));
    let tMaxRunVal = Math.round(clampVal(document.getElementById('cfgTMaxRun') ? document.getElementById('cfgTMaxRun').value : 45, 10, 180, 45));
    let tCorteLuzVal = Math.round(clampVal(document.getElementById('cfgTCorteLuz') ? document.getElementById('cfgTCorteLuz').value : 34.0, 25.0, 45.0, 34.0) * 10) / 10;
    let tDeltaExtVal = 0.3;
    let tDeltaSaidaVal = 0.1;
    let tSifaoPosAcVal = Math.round(clampVal(document.getElementById('cfgTSifaoPosAc') ? document.getElementById('cfgTSifaoPosAc').value : 15, 0, 60, 15));
    let tSifaoTempMinVal = 20.0;
    let uGuardaCorteVal = 88.0;
    let uRetornoAlvoVal = 1;
    let uGuardaRetornoVal = uAlvoVal;
    let tEvapPreVal = 0;
    let tEvapAntVal = 0.3;
    let tEvapCoolVal = 45;

    // Atualiza os inputs na tela caso algum valor tenha sido corrigido pelo clamp
    document.getElementById('cfgTx').value = tXVal;
    document.getElementById('cfgUa').value = uAlvoVal;
    document.getElementById('cfgFo').value = fOVal;
    document.getElementById('cfgFf').value = fFVal;
    document.getElementById('cfgVo').value = vOVal;
    document.getElementById('cfgVf').value = vFVal;
    if (document.getElementById('cfgTCongela')) document.getElementById('cfgTCongela').value = tCongelaVal;
    if (document.getElementById('cfgTHistereseAr')) document.getElementById('cfgTHistereseAr').value = tHistereseArVal;
    if (document.getElementById('cfgTPosMeta')) document.getElementById('cfgTPosMeta').value = tPosMetaVal;
    if (document.getElementById('cfgTMaxRun')) document.getElementById('cfgTMaxRun').value = tMaxRunVal;
    if (document.getElementById('cfgTCorteLuz')) document.getElementById('cfgTCorteLuz').value = tCorteLuzVal;
    if (document.getElementById('cfgTSifaoPosAc')) document.getElementById('cfgTSifaoPosAc').value = tSifaoPosAcVal;
    if (document.getElementById('cfgTEvapPre')) document.getElementById('cfgTEvapPre').value = tEvapPreVal;
    if (document.getElementById('cfgTEvapAnt')) document.getElementById('cfgTEvapAnt').value = tEvapAntVal;
    if (document.getElementById('cfgTEvapCool')) document.getElementById('cfgTEvapCool').value = tEvapCoolVal;
    sincronizarUiMetaAr();
    sincronizarUiEvap();

    configClima[f].tX = tXVal;
    configClima[f].uA = uAlvoVal;
    configClima[f].uN = uAlvoVal; // retrocompatibilidade
    configClima[f].uX = uAlvoVal; // retrocompatibilidade
    configClima[f].fO = fOVal;
    configClima[f].fF = fFVal;
    configClima[f].vO = vOVal;
    configClima[f].vF = vFVal;
    configClima[f].vU = document.getElementById('cfgVu').checked ? 1 : 0;

    configClima.hvac = {
        tCongela: tCongelaVal,
        tHistereseAr: tHistereseArVal,
        tPosMeta: tPosMetaVal,
        tMaxRun: tMaxRunVal,
        tCorteLuz: tCorteLuzVal,
        tDeltaExt: tDeltaExtVal,
        tDeltaSaida: tDeltaSaidaVal,
        tSifaoPosAc: tSifaoPosAcVal,
        tSifaoTempMin: tSifaoTempMinVal,
        uGuardaCorte: uGuardaCorteVal,
        uRetornoAlvo: uRetornoAlvoVal,
        uGuardaRetorno: uGuardaRetornoVal,
        tEvapPre: tEvapPreVal,
        tEvapAnt: tEvapAntVal,
        tEvapCool: tEvapCoolVal
    };
    
    const btns = [
        { el: document.getElementById('btnSalvarClima'), def: '<span>💾</span> <span>Salvar e Enviar para Placa</span>' },
        { el: document.getElementById('btnSalvarHvac'), def: '<span>💾</span> <span>Salvar Proteções e Enviar para Placa</span>' }
    ];
    btns.forEach(b => { if (b.el) b.el.textContent = "Gravando no Banco e Placa..."; });
    if (await enviarComando({ config: JSON.stringify(configClima) })) {
        btns.forEach(b => { if (b.el) b.el.textContent = "✅ Salvo no Banco e Placa!"; });
        
        // Recarrega do banco e atualiza gráficos/simulador imediatamente
        setTimeout(async () => {
            await fetchConfigClima();
            if (typeof limitAtual !== 'undefined') carregarDados(limitAtual, true);
        }, 500);
    } else {
        btns.forEach(b => { if (b.el) b.el.textContent = "❌ Falhou!"; });
    }
    setTimeout(() => { btns.forEach(b => { if (b.el) b.el.innerHTML = b.def; }); }, 3000);
}

async function enviarOTA() {
    const btn = document.getElementById('btnEnviarOta');
    btn.dataset.atualizando = "1";
    btn.innerHTML = '<span>⏳</span> <span>Avisando a Placa...</span>';
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');

    try {
        if (await enviarComando({ota: 1})) {
            let segundosRestantes = 40;
            btn.innerHTML = `<span>⚡</span> <span>Atualizando Placa (${segundosRestantes}s)...</span>`;
            const intervaloOta = setInterval(async () => {
                segundosRestantes -= 3;
                if (segundosRestantes > 0) {
                    btn.innerHTML = `<span>⚡</span> <span>Baixando & Gravando (${segundosRestantes}s)...</span>`;
                } else {
                    btn.innerHTML = `<span>🔄</span> <span>Reiniciando Placa...</span>`;
                }
                try {
                    const res = await fetch('api/fw.php?nocache=' + Date.now());
                    if (res.ok) {
                        const fw = await res.json();
                        if (fw.vFirmware && fw.vFirmwareNuvem && fw.vFirmware === fw.vFirmwareNuvem) {
                            clearInterval(intervaloOta);
                            delete btn.dataset.atualizando;
                            btn.innerHTML = `<span>✅</span> <span>Atualizado (${fw.vFirmware})!</span>`;
                            setTimeout(() => {
                                atualizarDadosViewConfig();
                            }, 2000);
                            alert(`🎉 Sucesso! A placa foi atualizada para a versão ${fw.vFirmware}!`);
                            return;
                        }
                    }
                } catch(err) {}
                if (segundosRestantes <= -30) {
                    clearInterval(intervaloOta);
                    delete btn.dataset.atualizando;
                    atualizarDadosViewConfig();
                }
            }, 3000);
        } else {
            alert("⚠️ Houve uma falha ao comunicar com a nuvem.");
            delete btn.dataset.atualizando;
            atualizarDadosViewConfig();
        }
    } catch (e) {
        alert("❌ Erro: " + e.message);
        delete btn.dataset.atualizando;
        atualizarDadosViewConfig();
    }
}

async function enviarRollback() {
    if (!confirm("↩️ Tem certeza que deseja reverter para a versão anterior do firmware?\n\nA placa reiniciará imediatamente na partição estável anterior via Dual-Bank (sem precisar baixar nada).")) return;
    const btn = document.getElementById('btnRollbackOta');
    btn.textContent = "Revertendo...";
    btn.disabled = true;
    try {
        if (await enviarComando({rollback: 1})) {
            alert("✅ Ordem de Rollback entregue! A placa está alternando para a partição anterior e estará de volta em ~30 segundos.");
            fecharConfig();
        } else {
            alert("⚠️ Falha ao comunicar ordem de rollback com a nuvem.");
        }
    } catch (e) {
        alert("❌ Erro: " + e.message);
    } finally {
        btn.innerHTML = '<span>↩️</span> <span>Reverter p/ Versão Anterior (Dual-Bank)</span>';
        btn.disabled = false;
    }
}

async function mudarFase(f) { 
    const mapaReverso = {0: "Standby", 1: "Pinagem", 2: "Frutificacao", 4: "Secagem Total"};
    fasePendenteTempo = Date.now();
    fasePendenteAlvo = mapaReverso[f];
    
    // Optimistic UI imediata: altera cor do botão e texto na hora!
    atualizarBotoesFase(f, true);
    const valFaseEl = document.getElementById('valFase');
    if (valFaseEl) valFaseEl.textContent = (mapaReverso[f] || "Fase " + f) + " ⏳";
    sincronizarUiMetaAr();
    sincronizarUiSifaoRetorno();
    sincronizarUiSifaoDelta();
    
    // Se o usuário selecionou Standby, desliga imediatamente os relés visuais automáticos:
    if (f === 0) {
        setRele('releUmid', 'releUmidStatus', 0);
        setRele('releVento', 'releVentoStatus', 0);
        setRele('releExaust', 'releExaustStatus', 0);
        if (luzState === 0) setRele('releLuz', 'releLuzStatus', 0);
        if (arState === 0) setRele('releAr', 'releArStatus', 0);
        const txtProt = document.getElementById('txtProtocoloTitulo');
        if (txtProt) txtProt.textContent = "Modo Standby (Sincronizando ⚡)";
    }

    if (await enviarComando({fase: f})) {
        setTimeout(() => loopDados(1200), 600);
    }
}

async function ciclarLuz() {
    let proxLuz = (luzState + 1) % 3; // 0: AUTO -> 1: MANUAL ON -> 2: MANUAL OFF
    await mudarLuz(proxLuz);
}

async function ciclarAr() {
    let proxAr = (arState + 1) % 3; // 0: AUTO -> 1: MANUAL ON -> 2: MANUAL OFF
    await mudarAr(proxAr);
}

function atualizarBotoesAr(modo) {
    arState = modo;
    // Se houver último registro, reaplica as cores no card
    if (window.ultimoRegistroRecebido) {
        setRele('releAr', 'releArStatus', parseInt(window.ultimoRegistroRecebido.rele_ar || 0));
    }
}

async function mudarAr(modoDesejado = null) {
    let proxAr = (modoDesejado !== null) ? modoDesejado : ((arState + 1) % 3);
    arState = proxAr;
    arPendenteTempo = Date.now();
    
    // Optimistic UI imediata no card
    setRele('releAr', 'releArStatus', proxAr === 1 ? 1 : (proxAr === 2 ? 0 : (window.ultimoRegistroRecebido ? parseInt(window.ultimoRegistroRecebido.rele_ar || 0) : 0)));
    const ra = document.getElementById('releArStatus');
    if (ra) {
        ra.textContent = (proxAr === 1 ? "MANUAL (ON) ⏳" : (proxAr === 2 ? "MANUAL (OFF) ⏳" : "AUTO ⏳"));
    }

    if (await enviarComando({ar: proxAr})) {
        setTimeout(() => loopDados(1200), 600);
    }
}

function atualizarBotoesLuz(modo) {
    luzState = modo;
    if (window.ultimoRegistroRecebido) {
        setRele('releLuz', 'releLuzStatus', parseInt(window.ultimoRegistroRecebido.rele_luz || 0));
    }
}

async function mudarLuz(modoDesejado = null) {
    let proxLuz = (modoDesejado !== null) ? modoDesejado : ((luzState + 1) % 3);
    luzState = proxLuz;
    luzPendenteTempo = Date.now();
    
    // Optimistic UI imediata no card e na aba Config
    setRele('releLuz', 'releLuzStatus', proxLuz === 1 ? 1 : (proxLuz === 2 ? 0 : (window.ultimoRegistroRecebido ? parseInt(window.ultimoRegistroRecebido.rele_luz || 0) : 0)));
    const rl = document.getElementById('releLuzStatus');
    if (rl) {
        rl.textContent = (proxLuz === 1 ? "MANUAL (ON) ⏳" : (proxLuz === 2 ? "MANUAL (OFF) ⏳" : "AUTO ⏳"));
    }
    atualizarDadosViewConfig();

    if (await enviarComando({luz: proxLuz})) {
        setTimeout(() => loopDados(1200), 600);
    }
}

function atualizarBotoesFase(faseNome, pendente = false) {
    const mapa = { "Standby": 0, "Pinagem": 1, "Frutificacao": 2, "Secagem Total": 4 };
    const mapaReverso = { 0: "Standby", 1: "Pinagem", 2: "Frutificacao", 4: "Secagem Total" };
    
    let faseId = -1;
    let faseString = faseNome;

    if (typeof faseNome === 'number') {
        faseId = faseNome;
        faseString = mapaReverso[faseNome];
    } else if (mapa[faseNome] !== undefined) {
        faseId = mapa[faseNome];
    }

    document.querySelectorAll('.btn-fase').forEach(b => {
        b.classList.remove('bg-emerald-600', 'shadow-[0_0_15px_rgba(16,185,129,0.4)]', 'border-emerald-400/50', 'pulse-border');
        b.classList.add('bg-slate-800', 'border-transparent', 'opacity-80');
    });

    if (faseId !== -1) {
        const b = document.getElementById('btnFase' + faseId);
        if (b) {
            b.classList.remove('bg-slate-800', 'border-transparent', 'opacity-80');
            b.classList.add('bg-emerald-600', 'border-emerald-400/50');
            if (pendente) {
                b.classList.add('pulse-border');
            } else {
                b.classList.add('shadow-[0_0_15px_rgba(16,185,129,0.4)]');
            }
        }
    }
    renderizarInfoFase(faseString, pendente);
}

function renderizarInfoFase(faseNome, isPendente = false) {
    const container = document.getElementById('infoFaseContainer');
    if (!faseNome || faseNome === '--') return;
    container.classList.remove('hidden');

    let icon = '⚙️', desc = '', temp = '', umid = '', fae = '', vento = '';

    const formatVento = (cfg) => {
        if (!cfg) return '--';
        let vo = cfg.vO !== undefined ? cfg.vO : 1;
        let vf = cfg.vF !== undefined ? cfg.vF : 2;
        let vu = cfg.vU !== undefined ? (cfg.vU == 1) : true;
        return `${vo}m ON / ${vf}m OFF ${vu ? '(+Névoa)' : ''}`;
    };

    switch(faseNome) {
        case 'Standby':
            icon = '⏸️'; temp = 'Desligado'; umid = 'Desligado'; fae = 'Desligado'; vento = 'Desligado';
            desc = 'Sistema em repouso absoluto. Nenhum relé será acionado pelo algoritmo automático. Ideal para higienização da estufa e manutenção dos equipamentos.';
            break;
        case 'Pinagem':
            icon = '🍄'; temp = `Máx ${configClima["1"].tX} °C`; umid = `Alvo ${configClima["1"].uA || configClima["1"].uN || 95}%`; fae = `${configClima["1"].fO} min ON / ${configClima["1"].fF} min OFF`;
            vento = formatVento(configClima["1"]);
            desc = 'Foco total em induzir o micélio a formar primórdios (alfinetes). Exige altíssima umidade e oxigenação constante para simular o orvalho do amanhecer.';
            break;
        case 'Frutificacao':
            icon = '🌳'; temp = `Máx ${configClima["2"].tX} °C`; umid = `Alvo ${configClima["2"].uA || configClima["2"].uN || 92}%`; fae = `${configClima["2"].fO} min ON / ${configClima["2"].fF} min OFF`;
            vento = formatVento(configClima["2"]);
            desc = 'Umidade levemente reduzida para permitir que o suor na pele do cogumelo evapore, o que força as paredes celulares a puxar água do bolo e crescer.';
            break;
        case 'Secagem Total':
            icon = '🏜️'; temp = 'Ambiente'; umid = 'Mínimo possível'; fae = '100% LIGADO (Direto)'; vento = '100% LIGADO (Direto)';
            desc = 'Umidificador bloqueado. Ventilador e Exaustor cravados em ON ininterruptamente. Usado para secar condensação excessiva nas paredes ou processar colheita.';
            break;
    }

    document.getElementById('infoFaseIcon').textContent = icon;
    document.getElementById('infoFaseTitle').textContent = isPendente ? `⏳ MUDANDO P/: ${faseNome}` : `Modo Ativo: ${faseNome}`;
    document.getElementById('infoFaseDesc').textContent = desc;
    document.getElementById('infoFaseTemp').textContent = temp;
    document.getElementById('infoFaseUmid').textContent = umid;
    const elFae = document.getElementById('infoFaseFae');
    if (elFae) {
        elFae.setAttribute('data-ciclo', fae);
        elFae.textContent = fae;
    }
    const elVentoInfo = document.getElementById('infoFaseVento');
    if (elVentoInfo) {
        elVentoInfo.setAttribute('data-ciclo', vento);
        elVentoInfo.textContent = vento;
    }
}

function filtrar(limit, btn) {
    limitAtual = limit;
    window.ultimoFetchCompletoTs = 0; // Força recarregamento completo do histórico ao trocar filtro
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    zoomManualUsuario = false;
    zoomAtivo3h = true;
    carregarDados(limit, true);
}
