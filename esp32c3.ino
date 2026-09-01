// ============================================================
//  GROW IA v3.1 - Firmware Inteligente para Cultivo de Fungi
//  Placa: ESP32-C3-MINI-1-N4
//  Autor: Gabriel + Antigravity AI
// ============================================================

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <DHT.h>
#include <esp32-hal-rgb-led.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <Preferences.h> // Memória Anti-Apagão

// ============================================================
//  CONFIGURAÇÕES DO USUÁRIO (EDITE AQUI!)
// ============================================================

// --- Relógio ---
const char* NTP_SERVER     = "pool.ntp.org";
const long  GMT_OFFSET_SEC = -10800;
const int   DAYLIGHT_OFF   = 0;

// --- Ciclo de Luz ---
const int LUZ_HORA_LIGA    = 20;
const int LUZ_HORA_DESLIGA = 8;

// --- Temperaturas ---
const float TEMP_MINIMA    = 25.0;
const float TEMP_ALVO_MAX  = 28.5;
const float TEMP_CRITICA   = 30.0;
const float TEMP_CORTE_LUZ = 33.0;

// --- Umidade ---
const float UMIDADE_MINIMA = 88.0;
const float UMIDADE_MAXIMA = 95.0;

// --- FAE ---
const unsigned long FAE_ON_MS  = 2UL * 60 * 1000;
const unsigned long FAE_OFF_MS = 58UL * 60 * 1000;

// --- Segurança ---
const unsigned long TIMEOUT_UMID_MS = 30UL * 60 * 1000;

// --- LED ---
const uint8_t LED_BRILHO = 20;

// --- Telegram (Deixe vazio para desativar) ---
const char* TELEGRAM_TOKEN  = "";
const char* TELEGRAM_CHAT   = "";
const unsigned long TELEGRAM_INTERVALO = 60UL * 1000;

// --- Progressão Automática (dias em cada fase, 0 = manual) ---
const int DIAS_PINANDO     = 0;
const int DIAS_FRUTIFICACAO = 0;
const int DIAS_SEGUNDO_FLUSH = 0;

// ============================================================
//  PINOS
// ============================================================

#ifndef RGB_BUILTIN
  #define RGB_BUILTIN 8
#endif

#define PIN_SDA     4
#define PIN_SCL     5
#define PIN_DHT     10
#define TIPO_DHT    DHT11

#define PIN_RELE_LUZ        0
#define PIN_RELE_UMIDIFIC   1
#define PIN_RELE_VENTO_INT  3
#define PIN_RELE_EXAUST_EXT 6

// ============================================================
//  ENUMS E STRUCTS
// ============================================================

enum FaseCultivo { FASE_STANDBY, FASE_PINANDO, FASE_FRUTIFICACAO, FASE_SEGUNDO_FLUSH, FASE_SECAGEM };
enum ModoLuz     { LUZ_AUTO, LUZ_FORCADA_ON, LUZ_FORCADA_OFF };
enum StatusSis   { SIS_OK, SIS_SEM_WIFI, SIS_ERRO_SENSOR };

struct PerfilClimatico {
  float tempMax, umidMin, umidMax;
  unsigned long faeOnMs, faeOffMs;
};

// ============================================================
//  OBJETOS E MEMÓRIA
// ============================================================

Adafruit_SHT31 sht30 = Adafruit_SHT31();
DHT dht(PIN_DHT, TIPO_DHT);
WiFiManager wm;
WebServer server(80);
Preferences prefs;

// ============================================================
//  ESTADO GLOBAL
// ============================================================

FaseCultivo faseAtual = FASE_STANDBY;
ModoLuz     modoLuz   = LUZ_AUTO;
StatusSis   statusSis = SIS_SEM_WIFI;

// Sensores
float tempInt = 0, humInt = 0;
float tempExt = 0, humExt = 0;
bool  sensorIntOk = false, sensorExtOk = false;

// Filtro Média Móvel
#define FILTRO_N 5
float bufTempInt[FILTRO_N], bufHumInt[FILTRO_N];
float bufTempExt[FILTRO_N], bufHumExt[FILTRO_N];
int   idxFiltro = 0;
bool  filtroPreenchido = false;

// Min/Max (Diário)
float tempIntMin = 999, tempIntMax = -999;
float humIntMin  = 999, humIntMax  = -999;
char  horaMinTemp[6] = "--:--", horaMaxTemp[6] = "--:--";
char  horaMinHum[6]  = "--:--", horaMaxHum[6]  = "--:--";
int   ultimoDia = -1; // Para reset à meia-noite

// Relés
bool releLuz = false, releUmidific = false;
bool releVentoInt = false, releExaustExt = false;

// Timers
unsigned long ultimaLeitura = 0;
unsigned long ultimoCicloFAE = 0;
bool faeLigado = false;
unsigned long inicioUmidificacao = 0;
bool alertaFaltaAgua = false;

// Relógio e Progressão (Memória NVS)
bool horaValida = false;
int  horaAtual  = -1;
time_t inicioFaseTempo = 0; // Timestamp UNIX salvo na flash
unsigned long bootTime = 0;

// Telegram
unsigned long ultimoTelegram = 0;
bool telegramAlertaEnviado = false;

// ============================================================
//  FUNÇÕES AUXILIARES
// ============================================================

const char* nomeFase(FaseCultivo f) {
  switch (f) {
    case FASE_STANDBY:       return "Standby";
    case FASE_PINANDO:       return "Pinando";
    case FASE_FRUTIFICACAO:  return "Frutificacao";
    case FASE_SEGUNDO_FLUSH: return "Segundo Flush";
    case FASE_SECAGEM:       return "Secagem";
    default: return "?";
  }
}

const char* nomeModoLuz() {
  switch (modoLuz) {
    case LUZ_AUTO:        return "AUTO";
    case LUZ_FORCADA_ON:  return "ON";
    case LUZ_FORCADA_OFF: return "OFF";
    default: return "?";
  }
}

PerfilClimatico obterPerfil(FaseCultivo f) {
  PerfilClimatico p;
  switch (f) {
    case FASE_PINANDO:
      p = {27.5, 95.0, 99.0, 3UL*60*1000, 40UL*60*1000}; break;
    case FASE_FRUTIFICACAO:
      p = {28.5, 88.0, 92.0, 2UL*60*1000, 60UL*60*1000}; break;
    case FASE_SEGUNDO_FLUSH:
      p = {29.0, 95.0, 99.0, 1UL*60*1000, 120UL*60*1000}; break;
    default:
      p = {TEMP_ALVO_MAX, UMIDADE_MINIMA, UMIDADE_MAXIMA, FAE_ON_MS, FAE_OFF_MS}; break;
  }
  return p;
}

String formatUptime(unsigned long ms) {
  unsigned long s = ms / 1000;
  int d = s / 86400; s %= 86400;
  int h = s / 3600;  s %= 3600;
  int m = s / 60;
  char buf[20];
  snprintf(buf, sizeof(buf), "%dd %02dh %02dm", d, h, m);
  return String(buf);
}

// Muda a fase e salva na memória persistente
void setNovaFase(FaseCultivo nova) {
  if (faseAtual == nova) return;
  faseAtual = nova;
  
  time_t agora;
  time(&agora);
  
  // Se já tivermos sincronizado o relógio com a internet (ano > 2020)
  if (agora > 1600000000) {
    inicioFaseTempo = agora;
  } else {
    inicioFaseTempo = 0; // NTP ainda não sincronizou
  }

  // Grava na Flash para sobreviver a quedas de energia
  prefs.putInt("fase", (int)faseAtual);
  prefs.putUInt("inicio", (uint32_t)inicioFaseTempo);
  Serial.printf("[MEMORIA] Fase salva: %s\n", nomeFase(faseAtual));
}

// ============================================================
//  FILTRO E MIN/MAX (DIÁRIO)
// ============================================================

float mediaBuffer(float* buf, int n) {
  float soma = 0;
  for (int i = 0; i < n; i++) soma += buf[i];
  return soma / n;
}

void atualizarFiltro(float tI, float hI, float tE, float hE) {
  bufTempInt[idxFiltro] = tI; bufHumInt[idxFiltro]  = hI;
  bufTempExt[idxFiltro] = tE; bufHumExt[idxFiltro]  = hE;
  idxFiltro = (idxFiltro + 1) % FILTRO_N;
  if (idxFiltro == 0) filtroPreenchido = true;

  int n = filtroPreenchido ? FILTRO_N : idxFiltro;
  if (n == 0) n = 1;
  tempInt = mediaBuffer(bufTempInt, n); humInt  = mediaBuffer(bufHumInt, n);
  tempExt = mediaBuffer(bufTempExt, n); humExt  = mediaBuffer(bufHumExt, n);
}

void atualizarMinMax() {
  struct tm ti;
  if (!getLocalTime(&ti)) return; // Sem relógio = não registra hora

  // RESET DIÁRIO (00:00)
  if (ultimoDia != -1 && ultimoDia != ti.tm_mday) {
    tempIntMin = tempInt; tempIntMax = tempInt;
    humIntMin  = humInt;  humIntMax  = humInt;
    Serial.println("[INFO] Reset Diario Min/Max efetuado!");
  }
  ultimoDia = ti.tm_mday;

  char horaStr[6];
  snprintf(horaStr, sizeof(horaStr), "%02d:%02d", ti.tm_hour, ti.tm_min);

  if (tempInt < tempIntMin) { tempIntMin = tempInt; strncpy(horaMinTemp, horaStr, 6); }
  if (tempInt > tempIntMax) { tempIntMax = tempInt; strncpy(horaMaxTemp, horaStr, 6); }
  if (humInt  < humIntMin)  { humIntMin  = humInt;  strncpy(horaMinHum, horaStr, 6); }
  if (humInt  > humIntMax)  { humIntMax  = humInt;  strncpy(horaMaxHum, horaStr, 6); }
}

// ============================================================
//  RELÉS
// ============================================================

void aplicarReles() {
  digitalWrite(PIN_RELE_LUZ,        releLuz       ? LOW : HIGH);
  digitalWrite(PIN_RELE_UMIDIFIC,    releUmidific  ? LOW : HIGH);
  digitalWrite(PIN_RELE_VENTO_INT,   releVentoInt  ? LOW : HIGH);
  digitalWrite(PIN_RELE_EXAUST_EXT,  releExaustExt ? LOW : HIGH);
}

// ============================================================
//  TELEGRAM
// ============================================================

void enviarTelegram(String msg) {
  if (strlen(TELEGRAM_TOKEN) == 0 || strlen(TELEGRAM_CHAT) == 0) return;
  if (WiFi.status() != WL_CONNECTED) return;
  unsigned long agora = millis();
  if (agora - ultimoTelegram < TELEGRAM_INTERVALO) return;
  ultimoTelegram = agora;

  WiFiClientSecure client;
  client.setInsecure();
  if (!client.connect("api.telegram.org", 443)) return;

  String url = "/bot" + String(TELEGRAM_TOKEN) + "/sendMessage?chat_id="
             + String(TELEGRAM_CHAT) + "&text=" + msg;
  client.print("GET " + url + " HTTP/1.1\r\nHost: api.telegram.org\r\nConnection: close\r\n\r\n");
  delay(100);
  client.stop();
}

// ============================================================
//  PROGRESSÃO AUTOMÁTICA
// ============================================================

void verificarProgressao() {
  if (inicioFaseTempo == 0) return;
  time_t agora;
  time(&agora);
  if (agora < 1600000000) return; // Internet time not synced

  unsigned long dias = (agora - inicioFaseTempo) / 86400UL;

  if (faseAtual == FASE_PINANDO && DIAS_PINANDO > 0 && dias >= (unsigned long)DIAS_PINANDO) {
    setNovaFase(FASE_FRUTIFICACAO);
    enviarTelegram("🍄 Fase mudou automaticamente: PINANDO → FRUTIFICACAO");
  }
  else if (faseAtual == FASE_FRUTIFICACAO && DIAS_FRUTIFICACAO > 0 && dias >= (unsigned long)DIAS_FRUTIFICACAO) {
    setNovaFase(FASE_SEGUNDO_FLUSH);
    enviarTelegram("🍄 Fase mudou automaticamente: FRUTIFICACAO → SEGUNDO FLUSH");
  }
  else if (faseAtual == FASE_SEGUNDO_FLUSH && DIAS_SEGUNDO_FLUSH > 0 && dias >= (unsigned long)DIAS_SEGUNDO_FLUSH) {
    setNovaFase(FASE_STANDBY);
    enviarTelegram("🍄 Ciclo completo! Voltando para STANDBY.");
  }
}

// ============================================================
//  MOTOR CLIMÁTICO INTELIGENTE
// ============================================================

void executarMotor(unsigned long agora) {
  if (faseAtual == FASE_STANDBY) {
    releUmidific = false; releVentoInt = false; releExaustExt = false;
    if (modoLuz == LUZ_AUTO) releLuz = false;
    return;
  }
  if (faseAtual == FASE_SECAGEM) {
    releUmidific = false; releVentoInt = true; releExaustExt = true;
    if (modoLuz == LUZ_AUTO) releLuz = false;
    return;
  }

  PerfilClimatico pf = obterPerfil(faseAtual);

  // 1. FAE Timer
  if (faeLigado) {
    if (agora - ultimoCicloFAE >= pf.faeOnMs) { faeLigado = false; ultimoCicloFAE = agora; }
  } else {
    if (agora - ultimoCicloFAE >= pf.faeOffMs) { faeLigado = true; ultimoCicloFAE = agora; }
  }

  // 2. Matriz Térmica
  bool quente = (tempInt >= pf.tempMax);
  bool frio   = (tempInt <= TEMP_MINIMA);
  bool arFrio = (tempExt < tempInt);
  bool arQuente = (tempExt > tempInt);
  bool defesaEvap = false;

  releExaustExt = false;
  releVentoInt  = false;

  if (quente) {
    if (arFrio) { releExaustExt = true; releVentoInt = true; }
    else { releExaustExt = false; if (humInt < 98 && !alertaFaltaAgua) { defesaEvap = true; releVentoInt = true; } }
  } else if (frio) {
    if (arQuente) { releExaustExt = true; releVentoInt = true; }
    else { releExaustExt = false; }
  }

  // 3. FAE Override
  if (faeLigado) { releExaustExt = true; releVentoInt = true; }

  // 4. Umidade
  if (!alertaFaltaAgua) {
    if (defesaEvap) releUmidific = true;
    else if (humInt < pf.umidMin) releUmidific = true;
    else if (humInt > pf.umidMax && !defesaEvap) releUmidific = false;
  } else {
    releUmidific = false;
  }
  if (releUmidific) releVentoInt = true;

  // 5. Watchdog Água
  if (releUmidific) {
    if (inicioUmidificacao == 0) inicioUmidificacao = agora;
    else if (agora - inicioUmidificacao > TIMEOUT_UMID_MS) {
      alertaFaltaAgua = true; releUmidific = false;
      enviarTelegram("🚨 ALERTA: Falta d'agua no umidificador!");
    }
  } else {
    inicioUmidificacao = 0;
  }

  // 6. Luz
  if (modoLuz == LUZ_AUTO) {
    releLuz = (horaValida && (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA));
    if (frio && !arQuente) releLuz = true;
  }
}

void aplicarSeguranca() {
  if (modoLuz == LUZ_FORCADA_ON)  releLuz = true;
  if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
  if (tempInt >= TEMP_CORTE_LUZ)  { releLuz = false; enviarTelegram("🔥 CORTE TERMICO! Luz desligada! Temp: " + String(tempInt,1) + "C"); }
  if (tempInt >= TEMP_CRITICA && !telegramAlertaEnviado) { enviarTelegram("⚠️ Temperatura critica: " + String(tempInt,1) + "C"); telegramAlertaEnviado = true; }
  if (tempInt < TEMP_CRITICA) telegramAlertaEnviado = false;
}

// ============================================================
//  DASHBOARD WEB
// ============================================================

const char PAGINA_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grow IA</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;padding:12px;max-width:520px;margin:0 auto}
.hdr{text-align:center;margin-bottom:16px}
.hdr h1{color:#00ff88;font-size:22px;letter-spacing:1px}
.hdr .fase{color:#00bfff;font-weight:bold;font-size:14px;margin-top:4px}
.hdr .info{color:#555;font-size:11px;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.c{background:#151515;padding:12px;border-radius:8px;border-left:3px solid #333;text-align:center}
.c.g{border-color:#00ff88}.c.b{border-color:#00bfff}.c.r{border-color:#ff3366}.c.y{border-color:#ffaa00}
.c label{font-size:9px;text-transform:uppercase;color:#666;display:block;margin-bottom:4px;letter-spacing:.5px}
.c .v{font-size:20px;font-weight:bold}
.c .mm{font-size:9px;color:#444;margin-top:4px}
.eq{background:#151515;padding:12px;border-radius:8px;text-align:center;margin-bottom:12px}
.eq label{font-size:9px;text-transform:uppercase;color:#666;display:block;margin-bottom:6px}
.bd{display:inline-block;padding:3px 8px;border-radius:12px;font-size:10px;font-weight:bold;margin:2px}
.bd.on{background:#00ff88;color:#000}.bd.off{background:#333;color:#666}
.al{color:#ff3366;font-weight:bold;margin-top:8px;display:none;font-size:12px}
.fae{color:#444;font-size:10px;text-align:center;margin-bottom:10px}
.ct{display:flex;flex-direction:column;gap:6px}
select,button{padding:10px;border-radius:6px;border:none;font-size:14px;font-weight:bold;cursor:pointer}
select{background:#1a1a1a;color:#fff;border:1px solid #333}
.btn-g{background:#4caf50;color:#fff}.btn-o{background:#ff9800;color:#fff}.btn-b{background:#2196f3;color:#fff}
button:active{opacity:.8}
.ft{text-align:center;color:#333;font-size:9px;margin-top:15px}
</style></head><body>
<div class="hdr">
  <h1>🍄 Grow IA</h1>
  <div class="fase" id="fase">...</div>
  <div class="info"><span id="rel"></span> · Uptime: <span id="up">...</span></div>
  <div class="info" id="dias"></div>
</div>
<div class="grid">
  <div class="c g"><label>Temp Interna</label><div class="v" id="tI">--</div><div class="mm" id="mmT"></div></div>
  <div class="c b"><label>Umid Interna</label><div class="v" id="uI">--</div><div class="mm" id="mmU"></div></div>
  <div class="c r"><label>Temp Externa</label><div class="v" id="tE">--</div></div>
  <div class="c b"><label>Umid Externa</label><div class="v" id="uE">--</div></div>
</div>
<div class="eq">
  <label>Equipamentos</label>
  <span class="bd off" id="b1">💡 Luz</span>
  <span class="bd off" id="b2">💨 Umidif.</span>
  <span class="bd off" id="b3">🌀 Vento</span>
  <span class="bd off" id="b4">🌬️ Exaustor</span>
  <div class="al" id="al">⚠️ FALTA D'ÁGUA!</div>
</div>
<div class="fae" id="fae"></div>
<div class="ct">
  <select onchange="if(this.value)cmd('f='+this.value);this.selectedIndex=0">
    <option value="">⚙️ Mudar Fase...</option>
    <option value="0">Standby</option>
    <option value="P">Pinando</option>
    <option value="F">Frutificação</option>
    <option value="S">Segundo Flush</option>
    <option value="D">Secagem</option>
  </select>
  <button class="btn-g" onclick="cmd('l=1')">💡 Luz: <span id="mL">...</span></button>
  <button class="btn-o" onclick="cmd('r=1')">🚰 Reset Alerta Água</button>
</div>
<div class="ft">Grow IA v3.1 · <span id="ip"></span> · grow.local</div>
<script>
function up(){fetch('/api/data').then(r=>r.json()).then(d=>{
  document.getElementById('tI').innerText=d.tI.toFixed(1)+'°C';
  document.getElementById('uI').innerText=d.uI.toFixed(1)+'%';
  document.getElementById('tE').innerText=d.tE.toFixed(1)+'°C';
  document.getElementById('uE').innerText=d.uE.toFixed(1)+'%';
  document.getElementById('fase').innerText=d.fase;
  document.getElementById('mL').innerText=d.luz;
  document.getElementById('rel').innerText=d.hora;
  document.getElementById('up').innerText=d.uptime;
  document.getElementById('fae').innerText=d.fae;
  document.getElementById('ip').innerText=d.ip;
  document.getElementById('mmT').innerHTML='Diário: ↓'+d.tMin+' ↑'+d.tMax;
  document.getElementById('mmU').innerHTML='Diário: ↓'+d.uMin+' ↑'+d.uMax;
  if(d.diasFase>=0) document.getElementById('dias').innerText='Dia '+d.diasFase+' na fase atual';
  else document.getElementById('dias').innerText='';
  ['b1','b2','b3','b4'].forEach((id,i)=>{document.getElementById(id).className='bd '+(d.reles[i]?'on':'off')});
  document.getElementById('al').style.display=d.alerta?'block':'none';
}).catch(()=>{});}
function cmd(c){fetch('/api/cmd?'+c).then(()=>setTimeout(up,300));}
setInterval(up,2000);up();
</script></body></html>
)rawliteral";

// ============================================================
//  ROTAS WEB
// ============================================================

void webRoot() { server.send(200, "text/html", PAGINA_HTML); }

void webApiData() {
  struct tm ti;
  bool hv = getLocalTime(&ti);
  char hora[10]; if(hv) snprintf(hora,10,"%02d:%02d:%02d",ti.tm_hour,ti.tm_min,ti.tm_sec); else snprintf(hora,10,"--:--:--");
  char faeStr[30]; snprintf(faeStr,30,"FAE: %s", faeLigado ? "Ventilando..." : "Aguardando");

  long diasFase = -1;
  time_t agora; time(&agora);
  if (inicioFaseTempo > 0 && agora > 1600000000 && faseAtual != FASE_STANDBY && faseAtual != FASE_SECAGEM) {
    diasFase = (agora - inicioFaseTempo) / 86400L;
  }

  String j = "{";
  j += "\"tI\":" + String(tempInt, 1) + ",";
  j += "\"uI\":" + String(humInt, 1) + ",";
  j += "\"tE\":" + String(tempExt, 1) + ",";
  j += "\"uE\":" + String(humExt, 1) + ",";
  j += "\"reles\":[" + String(releLuz?"true":"false") + "," + String(releUmidific?"true":"false") + ","
       + String(releVentoInt?"true":"false") + "," + String(releExaustExt?"true":"false") + "],";
  j += "\"fase\":\"" + String(nomeFase(faseAtual)) + "\",";
  j += "\"luz\":\"" + String(nomeModoLuz()) + "\",";
  j += "\"hora\":\"" + String(hora) + "\",";
  j += "\"uptime\":\"" + formatUptime(millis() - bootTime) + "\",";
  j += "\"fae\":\"" + String(faeStr) + "\",";
  j += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  j += "\"tMin\":\"" + String(tempIntMin,1) + " (" + String(horaMinTemp) + ")\",";
  j += "\"tMax\":\"" + String(tempIntMax,1) + " (" + String(horaMaxTemp) + ")\",";
  j += "\"uMin\":\"" + String(humIntMin,1) + " (" + String(horaMinHum) + ")\",";
  j += "\"uMax\":\"" + String(humIntMax,1) + " (" + String(horaMaxHum) + ")\",";
  j += "\"diasFase\":" + String(diasFase) + ",";
  j += "\"alerta\":" + String(alertaFaltaAgua ? "true" : "false");
  j += "}";
  server.send(200, "application/json", j);
}

void webApiCmd() {
  if (server.hasArg("f")) {
    String v = server.arg("f");
    FaseCultivo nova = faseAtual;
    if      (v == "0") nova = FASE_STANDBY;
    else if (v == "P") nova = FASE_PINANDO;
    else if (v == "F") nova = FASE_FRUTIFICACAO;
    else if (v == "S") nova = FASE_SEGUNDO_FLUSH;
    else if (v == "D") nova = FASE_SECAGEM;
    setNovaFase(nova);
  }
  if (server.hasArg("l")) {
    if      (modoLuz == LUZ_AUTO)        modoLuz = LUZ_FORCADA_ON;
    else if (modoLuz == LUZ_FORCADA_ON)  modoLuz = LUZ_FORCADA_OFF;
    else                                  modoLuz = LUZ_AUTO;
  }
  if (server.hasArg("r")) { alertaFaltaAgua = false; inicioUmidificacao = 0; }
  server.send(200, "text/plain", "OK");
}

// ============================================================
//  LED RGB
// ============================================================

void atualizarLED(unsigned long t) {
  if (alertaFaltaAgua)              { rgbLedWrite(RGB_BUILTIN, (t%200<100)?LED_BRILHO:0, 0, 0); }
  else if (statusSis==SIS_ERRO_SENSOR) { rgbLedWrite(RGB_BUILTIN, (t%1000<500)?LED_BRILHO:0, 0, 0); }
  else if (statusSis==SIS_SEM_WIFI) { uint8_t v=(t%1000<500)?LED_BRILHO:0; rgbLedWrite(RGB_BUILTIN, v, 0, v); }
  else if (faseAtual==FASE_STANDBY) { uint8_t v=(t%3000<100)?LED_BRILHO:0; rgbLedWrite(RGB_BUILTIN, v, v, v); }
  else if (releUmidific)            { uint8_t v=(t%1000<50)?LED_BRILHO:0; rgbLedWrite(RGB_BUILTIN, 0, v, v); }
  else if (releExaustExt)           { uint8_t v=(t%1000<50)?LED_BRILHO:0; rgbLedWrite(RGB_BUILTIN, v, v, 0); }
  else                              { rgbLedWrite(RGB_BUILTIN, 0, (t%2000<50)?LED_BRILHO:0, 0); }
}

// ============================================================
//  SERIAL
// ============================================================

void imprimirPainel() {
  struct tm ti; bool hv = getLocalTime(&ti);
  Serial.println("\n================ GROW IA v3.1 ================");
  if(hv) Serial.printf("RELOGIO:  %02d:%02d:%02d | Uptime: %s\n", ti.tm_hour, ti.tm_min, ti.tm_sec, formatUptime(millis()-bootTime).c_str());
  Serial.printf("FASE:     %s\n", nomeFase(faseAtual));
  Serial.printf("FAE:      %s\n", faeLigado ? "VENTILANDO CO2" : "Aguardando");
  Serial.println("------------------------------------------------");
  Serial.printf("SHT30:    %.1fC | %.1f%%  [Diario Min:%.1f Max:%.1f]\n", tempInt, humInt, tempIntMin, tempIntMax);
  Serial.printf("DHT11:    %.1fC | %.1f%%\n", tempExt, humExt);
  Serial.println("------------------------------------------------");
  Serial.printf("Luz:%s(%s) Umid:%s Vento:%s Exaust:%s\n",
    releLuz?"ON":"OFF", nomeModoLuz(), releUmidific?"ON":"OFF", releVentoInt?"ON":"OFF", releExaustExt?"ON":"OFF");
  if(alertaFaltaAgua) Serial.println(">>> ALERTA: FALTA AGUA! <<<");
  Serial.println("------------------------------------------------");
  if(WiFi.status()==WL_CONNECTED) Serial.printf("WIFI: %s | grow.local\n", WiFi.localIP().toString().c_str());
  Serial.println("================================================");
}

void processarSerial() {
  if (!Serial.available()) return;
  char c = Serial.read();
  FaseCultivo nova = faseAtual;
  switch(c) {
    case '0': nova = FASE_STANDBY; break;
    case 'P': case 'p': nova = FASE_PINANDO; break;
    case 'F': case 'f': nova = FASE_FRUTIFICACAO; break;
    case 'S': case 's': nova = FASE_SEGUNDO_FLUSH; break;
    case 'D': case 'd': nova = FASE_SECAGEM; break;
    case 'L': case 'l':
      if(modoLuz==LUZ_AUTO) modoLuz=LUZ_FORCADA_ON;
      else if(modoLuz==LUZ_FORCADA_ON) modoLuz=LUZ_FORCADA_OFF;
      else modoLuz=LUZ_AUTO;
      return;
    case 'R': case 'r': alertaFaltaAgua=false; inicioUmidificacao=0; return;
    default: return;
  }
  setNovaFase(nova);
}

// ============================================================
//  SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1500);
  bootTime = millis();

  Serial.println("\n========================================");
  Serial.println("       GROW IA v3.1 - Iniciando...      ");
  Serial.println("========================================");

  // Relés
  int pr[] = {PIN_RELE_LUZ, PIN_RELE_UMIDIFIC, PIN_RELE_VENTO_INT, PIN_RELE_EXAUST_EXT};
  for (int i = 0; i < 4; i++) { pinMode(pr[i], OUTPUT); digitalWrite(pr[i], HIGH); }

  // Memória Anti-Apagão (NVS)
  prefs.begin("grow", false);
  faseAtual = (FaseCultivo)prefs.getInt("fase", (int)FASE_STANDBY);
  inicioFaseTempo = prefs.getUInt("inicio", 0);
  Serial.printf("[OK] Memoria recuperada: %s\n", nomeFase(faseAtual));

  // Sensores
  Wire.begin(PIN_SDA, PIN_SCL);
  if (sht30.begin(0x44)) Serial.println("[OK] SHT30");
  else { Serial.println("[ERRO] SHT30!"); statusSis = SIS_ERRO_SENSOR; }

  dht.begin();
  Serial.println("[OK] DHT11");

  // WiFi
  wm.setConfigPortalBlocking(false);
  if (wm.autoConnect("GROW_SETUP")) Serial.println("[OK] WiFi");
  else Serial.println("[INFO] Portal GROW_SETUP");

  // Serviços Web
  if (MDNS.begin("grow")) Serial.println("[OK] mDNS: grow.local");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFF, NTP_SERVER);
  
  ArduinoOTA.setHostname("grow");
  ArduinoOTA.begin();
  
  server.on("/", webRoot);
  server.on("/api/data", webApiData);
  server.on("/api/cmd", webApiCmd);
  server.begin();
  Serial.println("[OK] Web Server rodando");

  Serial.println("========================================\n");
}

// ============================================================
//  LOOP
// ============================================================

void loop() {
  unsigned long agora = millis();

  wm.process();
  server.handleClient();
  ArduinoOTA.handle();

  if (agora - ultimaLeitura >= 2000) {
    ultimaLeitura = agora;

    float tI = sht30.readTemperature(), hI = sht30.readHumidity();
    float tE = dht.readTemperature(),   hE = dht.readHumidity();

    sensorIntOk = !isnan(tI) && !isnan(hI);
    sensorExtOk = !isnan(tE) && !isnan(hE);

    if (sensorIntOk && sensorExtOk) {
      atualizarFiltro(tI, hI, tE, hE);
      atualizarMinMax();
    } else if (sensorIntOk) {
      atualizarFiltro(tI, hI, tempExt, humExt);
      atualizarMinMax();
    }

    struct tm ti;
    horaValida = getLocalTime(&ti);
    horaAtual = horaValida ? ti.tm_hour : -1;

    // Se é a primeira vez pegando a hora certinha, e o timestamp estava 0, salva.
    if (horaValida && inicioFaseTempo == 0 && faseAtual != FASE_STANDBY) {
      time_t stamp; time(&stamp);
      if (stamp > 1600000000) {
        inicioFaseTempo = stamp;
        prefs.putUInt("inicio", (uint32_t)inicioFaseTempo);
      }
    }

    if (!sensorIntOk)                       statusSis = SIS_ERRO_SENSOR;
    else if (WiFi.status() != WL_CONNECTED) statusSis = SIS_SEM_WIFI;
    else                                    statusSis = SIS_OK;

    if (sensorIntOk) {
      executarMotor(agora);
      aplicarSeguranca();
    }

    verificarProgressao();
    aplicarReles();
    imprimirPainel();
  }

  processarSerial();
  atualizarLED(agora);
}
