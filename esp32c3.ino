// ============================================================
//  GROW IA v2.0 - Firmware para Cultivo Automatizado de Fungi
//  Placa: ESP32-C3-MINI-1-N4
//  Autor: Gabriel + Antigravity AI
// ============================================================

// ============================================================
//  BIBLIOTECAS
// ============================================================
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <DHT.h>
#include <esp32-hal-rgb-led.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <time.h>

// ============================================================
//  CONFIGURAÇÕES DO USUÁRIO (EDITE AQUI!)
// ============================================================

// --- Relógio (NTP) ---
const char* NTP_SERVER       = "pool.ntp.org";
const long  GMT_OFFSET_SEC   = -10800;  // UTC-3 (Brasília)
const int   DAYLIGHT_OFFSET  = 0;

// --- Ciclo de Luz (12h/12h) ---
const int LUZ_HORA_LIGA    = 20;  // 20:00 (8 da noite)
const int LUZ_HORA_DESLIGA = 8;   // 08:00 (8 da manhã)

// --- Temperaturas (Celsius) ---
const float TEMP_MINIMA    = 25.0;  // Abaixo disso = Frio
const float TEMP_ALVO_MAX  = 28.5;  // Acima disso = Quente
const float TEMP_CRITICA   = 30.0;  // Emergência térmica
const float TEMP_CORTE_LUZ = 33.0;  // Risco máximo: apaga a luz

// --- Umidade (%) ---
const float UMIDADE_MINIMA = 88.0;
const float UMIDADE_MAXIMA = 95.0;

// --- FAE - Fresh Air Exchange (Troca de CO2) ---
const unsigned long FAE_ON_MS  = 2UL * 60 * 1000;   // 2 min ligado
const unsigned long FAE_OFF_MS = 58UL * 60 * 1000;   // 58 min desligado

// --- Segurança ---
const unsigned long TIMEOUT_UMIDIFICADOR_MS = 30UL * 60 * 1000;  // 30 min

// --- LED RGB ---
const uint8_t LED_BRILHO = 20;

// ============================================================
//  PINOS DO HARDWARE
// ============================================================

// LED RGB Onboard
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN 8
#endif

// Sensores
#define PIN_SDA     4
#define PIN_SCL     5
#define PIN_DHT     10
#define TIPO_DHT    DHT11

// Relés SSR (Low-Level Trigger: LOW = Liga, HIGH = Desliga)
#define PIN_RELE_LUZ        0
#define PIN_RELE_UMIDIFIC   1
#define PIN_RELE_VENTO_INT  3
#define PIN_RELE_EXAUST_EXT 6

// ============================================================
//  ENUMS E TIPOS
// ============================================================

enum FaseCultivo {
  FASE_STANDBY,
  FASE_PINANDO,
  FASE_FRUTIFICACAO,
  FASE_SEGUNDO_FLUSH,
  FASE_SECAGEM
};

enum ModoLuz {
  LUZ_AUTO,
  LUZ_FORCADA_ON,
  LUZ_FORCADA_OFF
};

enum StatusSistema {
  SIS_OK,
  SIS_SEM_WIFI,
  SIS_ERRO_SENSOR
};

// Perfil climático de cada fase
struct PerfilClimatico {
  float         tempMax;
  float         umidMin;
  float         umidMax;
  unsigned long faeOnMs;
  unsigned long faeOffMs;
};

// ============================================================
//  VARIÁVEIS GLOBAIS
// ============================================================

// Objetos de hardware
Adafruit_SHT31 sht30 = Adafruit_SHT31();
DHT dht(PIN_DHT, TIPO_DHT);
WiFiManager wm;
WebServer server(80);

// Estado do sistema
FaseCultivo   faseAtual = FASE_STANDBY;
ModoLuz       modoLuz   = LUZ_AUTO;
StatusSistema statusSis = SIS_SEM_WIFI;

// Leituras dos sensores
float tempInt = 0.0, humInt  = 0.0;
float tempExt = 0.0, humExt  = 0.0;
bool  sensorIntOk = false, sensorExtOk = false;

// Estado dos relés
bool releLuz       = false;
bool releUmidific  = false;
bool releVentoInt  = false;
bool releExaustExt = false;

// Timers não-bloqueantes
unsigned long ultimaLeitura     = 0;
const long    INTERVALO_LEITURA = 2000;

unsigned long ultimoCicloFAE = 0;
bool          faeLigado      = false;

// Watchdog do umidificador
unsigned long inicioUmidificacao = 0;
bool          alertaFaltaAgua    = false;

// Relógio
bool horaValida = false;
int  horaAtual  = -1;

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
    default:                 return "???";
  }
}

const char* nomeModoLuz() {
  switch (modoLuz) {
    case LUZ_AUTO:        return "AUTOMATICO";
    case LUZ_FORCADA_ON:  return "FORCADO ON";
    case LUZ_FORCADA_OFF: return "FORCADO OFF";
    default:              return "???";
  }
}

PerfilClimatico obterPerfil(FaseCultivo f) {
  PerfilClimatico p;
  switch (f) {
    case FASE_PINANDO:
      p.tempMax  = 27.5;
      p.umidMin  = 95.0;
      p.umidMax  = 99.0;
      p.faeOnMs  = 3UL * 60 * 1000;
      p.faeOffMs = 40UL * 60 * 1000;
      break;
    case FASE_FRUTIFICACAO:
      p.tempMax  = 28.5;
      p.umidMin  = 88.0;
      p.umidMax  = 92.0;
      p.faeOnMs  = 2UL * 60 * 1000;
      p.faeOffMs = 60UL * 60 * 1000;
      break;
    case FASE_SEGUNDO_FLUSH:
      p.tempMax  = 29.0;
      p.umidMin  = 95.0;
      p.umidMax  = 99.0;
      p.faeOnMs  = 1UL * 60 * 1000;
      p.faeOffMs = 120UL * 60 * 1000;
      break;
    default:
      p.tempMax  = TEMP_ALVO_MAX;
      p.umidMin  = UMIDADE_MINIMA;
      p.umidMax  = UMIDADE_MAXIMA;
      p.faeOnMs  = FAE_ON_MS;
      p.faeOffMs = FAE_OFF_MS;
      break;
  }
  return p;
}

// ============================================================
//  CONTROLE DE RELÉS
// ============================================================

void releEscrever(int pino, bool ligar) {
  digitalWrite(pino, ligar ? LOW : HIGH);
}

void aplicarReles() {
  releEscrever(PIN_RELE_LUZ,        releLuz);
  releEscrever(PIN_RELE_UMIDIFIC,    releUmidific);
  releEscrever(PIN_RELE_VENTO_INT,   releVentoInt);
  releEscrever(PIN_RELE_EXAUST_EXT,  releExaustExt);
}

void testarReles() {
  Serial.println("[TEST] Testando Reles...");
  int pinos[] = { PIN_RELE_LUZ, PIN_RELE_UMIDIFIC, PIN_RELE_VENTO_INT, PIN_RELE_EXAUST_EXT };
  for (int i = 0; i < 4; i++) {
    Serial.printf("  CH%d (GPIO %d): ", i + 1, pinos[i]);
    digitalWrite(pinos[i], LOW);
    delay(400);
    digitalWrite(pinos[i], HIGH);
    delay(200);
    Serial.println("OK");
  }
  Serial.println("[TEST] Teste concluido.");
}

// ============================================================
//  MOTOR CLIMÁTICO INTELIGENTE
// ============================================================

void executarMotorClimatico(unsigned long agora) {

  // --- STANDBY: Desliga tudo ---
  if (faseAtual == FASE_STANDBY) {
    releUmidific  = false;
    releVentoInt  = false;
    releExaustExt = false;
    if (modoLuz == LUZ_AUTO) releLuz = false;
    return;
  }

  // --- SECAGEM: Ventila tudo, sem umidade ---
  if (faseAtual == FASE_SECAGEM) {
    releUmidific  = false;
    releVentoInt  = true;
    releExaustExt = true;
    if (modoLuz == LUZ_AUTO) releLuz = false;
    return;
  }

  // --- CULTIVO ATIVO (Pinando / Frutificação / Segundo Flush) ---
  PerfilClimatico perfil = obterPerfil(faseAtual);

  // 1. TEMPORIZADOR FAE (Troca de CO2)
  if (faeLigado) {
    if (agora - ultimoCicloFAE >= perfil.faeOnMs) {
      faeLigado = false;
      ultimoCicloFAE = agora;
    }
  } else {
    if (agora - ultimoCicloFAE >= perfil.faeOffMs) {
      faeLigado = true;
      ultimoCicloFAE = agora;
    }
  }

  // 2. MATRIZ TÉRMICA (Cruzamento Interno x Externo)
  bool muitoQuente      = (tempInt >= perfil.tempMax);
  bool muitoFrio        = (tempInt <= TEMP_MINIMA);
  bool arFrescoFora     = (tempExt < tempInt);
  bool arQuenteFora     = (tempExt > tempInt);
  bool defesaEvaporativa = false;

  // Resetar estados dos exaustores (a Matriz decide)
  releExaustExt = false;
  releVentoInt  = false;

  if (muitoQuente) {
    if (arFrescoFora) {
      // ESTRATÉGIA A: Puxar ar gelado de fora
      releExaustExt = true;
      releVentoInt  = true;
    } else {
      // ESTRATÉGIA B: Escudo Térmico + Resfriamento Evaporativo
      releExaustExt = false;
      if (humInt < 98.0 && !alertaFaltaAgua) {
        defesaEvaporativa = true;
        releVentoInt = true;
      }
    }
  }
  else if (muitoFrio) {
    if (arQuenteFora) {
      // ESTRATÉGIA C: Puxar ar quente de fora
      releExaustExt = true;
      releVentoInt  = true;
    } else {
      // ESTRATÉGIA D: Trancar a estufa
      releExaustExt = false;
    }
  }

  // 3. RESPIRAÇÃO (FAE sobrescreve a estabilidade)
  if (faeLigado) {
    releExaustExt = true;
    releVentoInt  = true;
  }

  // 4. UMIDADE (Histerese + Defesa Evaporativa)
  if (!alertaFaltaAgua) {
    if (defesaEvaporativa) {
      releUmidific = true;
    }
    else if (humInt < perfil.umidMin) {
      releUmidific = true;
    }
    else if (humInt > perfil.umidMax && !defesaEvaporativa) {
      releUmidific = false;
    }
  } else {
    releUmidific = false;
  }

  // Vento interno acompanha o umidificador (espalhar névoa)
  if (releUmidific) releVentoInt = true;

  // 5. WATCHDOG DO UMIDIFICADOR (Falta d'água)
  if (releUmidific) {
    if (inicioUmidificacao == 0) inicioUmidificacao = agora;
    else if (agora - inicioUmidificacao > TIMEOUT_UMIDIFICADOR_MS) {
      alertaFaltaAgua = true;
      releUmidific = false;
    }
  } else {
    inicioUmidificacao = 0;
  }

  // 6. ILUMINAÇÃO INTELIGENTE
  if (modoLuz == LUZ_AUTO) {
    // Regra base: Ciclo 12/12
    if (horaValida && (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA)) {
      releLuz = true;
    } else {
      releLuz = false;
    }
    // Aquecedor de emergência: frio extremo + rua congelando
    if (muitoFrio && !arQuenteFora) {
      releLuz = true;
    }
  }
}

// ============================================================
//  OVERRIDES DE SEGURANÇA (Última palavra, ignora tudo)
// ============================================================

void aplicarSeguranca() {
  if (modoLuz == LUZ_FORCADA_ON)  releLuz = true;
  if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
  if (tempInt >= TEMP_CORTE_LUZ)  releLuz = false;
}

// ============================================================
//  DASHBOARD WEB (HTML embutido)
// ============================================================

const char PAGINA_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grow IA</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;padding:15px}
    .hdr{text-align:center;margin-bottom:20px}
    .hdr h1{color:#00ff88;font-size:24px}
    .hdr .sub{color:#888;font-size:13px;margin-top:4px}
    .hdr .fase{color:#00bfff;font-weight:bold}
    .hdr .rel{color:#666;font-size:12px;margin-top:2px}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-width:500px;margin:0 auto 15px}
    .card{background:#1a1a1a;padding:14px;border-radius:10px;border-left:4px solid #333;text-align:center}
    .card.g{border-color:#00ff88} .card.b{border-color:#00bfff} .card.r{border-color:#ff3366}
    .card label{font-size:10px;text-transform:uppercase;color:#888;display:block;margin-bottom:6px}
    .card .val{font-size:22px;font-weight:bold}
    .equip{background:#1a1a1a;padding:14px;border-radius:10px;text-align:center;max-width:500px;margin:0 auto 15px}
    .equip label{font-size:10px;text-transform:uppercase;color:#888;display:block;margin-bottom:8px}
    .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:bold;margin:3px}
    .badge.on{background:#00ff88;color:#000} .badge.off{background:#444;color:#aaa}
    .alerta{color:#ff3366;font-weight:bold;margin-top:10px;display:none}
    .ctrl{max-width:500px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
    select,button{padding:12px;border-radius:8px;border:none;font-size:15px;font-weight:bold;cursor:pointer}
    select{background:#222;color:#fff;border:1px solid #444}
    button{background:#4caf50;color:#fff}
    button:active{background:#388e3c}
    .btn-warn{background:#ff9800}
    .fae{color:#555;font-size:11px;text-align:center;margin-top:8px}
  </style>
</head>
<body>
  <div class="hdr">
    <h1>🍄 Grow IA</h1>
    <div class="sub">Fase: <span class="fase" id="fase">...</span></div>
    <div class="rel" id="relogio"></div>
  </div>
  <div class="grid">
    <div class="card g"><label>Temp Interna</label><div class="val" id="tI">--</div></div>
    <div class="card b"><label>Umid Interna</label><div class="val" id="uI">--</div></div>
    <div class="card r"><label>Temp Externa</label><div class="val" id="tE">--</div></div>
    <div class="card b"><label>Umid Externa</label><div class="val" id="uE">--</div></div>
  </div>
  <div class="equip">
    <label>Equipamentos</label>
    <span class="badge off" id="b1">Luz</span>
    <span class="badge off" id="b2">Umidificador</span>
    <span class="badge off" id="b3">Vento Int.</span>
    <span class="badge off" id="b4">Exaustor Ext.</span>
    <div class="alerta" id="alerta">⚠️ FALTA D'ÁGUA!</div>
  </div>
  <div class="fae" id="faeStatus"></div>
  <div class="ctrl">
    <select onchange="cmd('f='+this.value)">
      <option value="">Mudar Fase...</option>
      <option value="0">Standby</option>
      <option value="P">Pinando</option>
      <option value="F">Frutificação</option>
      <option value="S">Segundo Flush</option>
      <option value="D">Secagem</option>
    </select>
    <button onclick="cmd('l=1')">Luz: <span id="mLuz">...</span></button>
    <button class="btn-warn" onclick="cmd('r=1')">Reset Alerta Água</button>
  </div>
  <script>
    function up(){
      fetch('/api/data').then(r=>r.json()).then(d=>{
        document.getElementById('tI').innerText=d.tI.toFixed(1)+' °C';
        document.getElementById('uI').innerText=d.uI.toFixed(1)+' %';
        document.getElementById('tE').innerText=d.tE.toFixed(1)+' °C';
        document.getElementById('uE').innerText=d.uE.toFixed(1)+' %';
        document.getElementById('fase').innerText=d.fase;
        document.getElementById('mLuz').innerText=d.luz;
        document.getElementById('relogio').innerText=d.hora;
        document.getElementById('faeStatus').innerText=d.fae;
        ['b1','b2','b3','b4'].forEach((id,i)=>{
          document.getElementById(id).className='badge '+(d.reles[i]?'on':'off');
        });
        document.getElementById('alerta').style.display=d.alerta?'block':'none';
      }).catch(()=>{});
    }
    function cmd(c){fetch('/api/cmd?'+c).then(()=>setTimeout(up,300));}
    setInterval(up,2000);up();
  </script>
</body>
</html>
)rawliteral";

// ============================================================
//  ROTAS DO SERVIDOR WEB
// ============================================================

void webRoot() {
  server.send(200, "text/html", PAGINA_HTML);
}

void webApiData() {
  struct tm ti;
  bool hv = getLocalTime(&ti);
  char horaStr[20];
  if (hv) snprintf(horaStr, sizeof(horaStr), "%02d:%02d:%02d", ti.tm_hour, ti.tm_min, ti.tm_sec);
  else    snprintf(horaStr, sizeof(horaStr), "Sem Internet");

  char faeStr[40];
  snprintf(faeStr, sizeof(faeStr), "FAE: %s", faeLigado ? "Ventilando CO2..." : "Aguardando...");

  String j = "{";
  j += "\"tI\":" + String(sensorIntOk ? tempInt : 0, 1) + ",";
  j += "\"uI\":" + String(sensorIntOk ? humInt  : 0, 1) + ",";
  j += "\"tE\":" + String(sensorExtOk ? tempExt : 0, 1) + ",";
  j += "\"uE\":" + String(sensorExtOk ? humExt  : 0, 1) + ",";
  j += "\"reles\":[" + String(releLuz?"true":"false") + ","
                     + String(releUmidific?"true":"false") + ","
                     + String(releVentoInt?"true":"false") + ","
                     + String(releExaustExt?"true":"false") + "],";
  j += "\"fase\":\"" + String(nomeFase(faseAtual)) + "\",";
  j += "\"luz\":\""  + String(nomeModoLuz()) + "\",";
  j += "\"hora\":\"" + String(horaStr) + "\",";
  j += "\"fae\":\""  + String(faeStr) + "\",";
  j += "\"alerta\":" + String(alertaFaltaAgua ? "true" : "false");
  j += "}";
  server.send(200, "application/json", j);
}

void webApiCmd() {
  if (server.hasArg("f")) {
    String v = server.arg("f");
    if      (v == "0") faseAtual = FASE_STANDBY;
    else if (v == "P") faseAtual = FASE_PINANDO;
    else if (v == "F") faseAtual = FASE_FRUTIFICACAO;
    else if (v == "S") faseAtual = FASE_SEGUNDO_FLUSH;
    else if (v == "D") faseAtual = FASE_SECAGEM;
  }
  if (server.hasArg("l")) {
    if      (modoLuz == LUZ_AUTO)        modoLuz = LUZ_FORCADA_ON;
    else if (modoLuz == LUZ_FORCADA_ON)  modoLuz = LUZ_FORCADA_OFF;
    else                                  modoLuz = LUZ_AUTO;
  }
  if (server.hasArg("r")) {
    alertaFaltaAgua = false;
    inicioUmidificacao = 0;
  }
  server.send(200, "text/plain", "OK");
}

// ============================================================
//  LED RGB (Dashboard Visual sem tela)
// ============================================================

void atualizarLED(unsigned long agora) {
  if (alertaFaltaAgua) {
    rgbLedWrite(RGB_BUILTIN, (agora % 200 < 100) ? LED_BRILHO : 0, 0, 0);
  }
  else if (statusSis == SIS_ERRO_SENSOR) {
    rgbLedWrite(RGB_BUILTIN, (agora % 1000 < 500) ? LED_BRILHO : 0, 0, 0);
  }
  else if (statusSis == SIS_SEM_WIFI) {
    uint8_t v = (agora % 1000 < 500) ? LED_BRILHO : 0;
    rgbLedWrite(RGB_BUILTIN, v, 0, v);
  }
  else if (faseAtual == FASE_STANDBY) {
    uint8_t v = (agora % 3000 < 100) ? LED_BRILHO : 0;
    rgbLedWrite(RGB_BUILTIN, v, v, v);
  }
  else if (releUmidific) {
    uint8_t v = (agora % 1000 < 50) ? LED_BRILHO : 0;
    rgbLedWrite(RGB_BUILTIN, 0, v, v);
  }
  else if (releExaustExt) {
    uint8_t v = (agora % 1000 < 50) ? LED_BRILHO : 0;
    rgbLedWrite(RGB_BUILTIN, v, v, 0);
  }
  else {
    rgbLedWrite(RGB_BUILTIN, 0, (agora % 2000 < 50) ? LED_BRILHO : 0, 0);
  }
}

// ============================================================
//  MONITOR SERIAL
// ============================================================

void imprimirPainel() {
  struct tm ti;
  bool hv = getLocalTime(&ti);

  Serial.println("\n================ GROW IA v2.0 ================");
  if (hv) Serial.printf("RELOGIO:  %02d:%02d:%02d\n", ti.tm_hour, ti.tm_min, ti.tm_sec);
  else    Serial.println("RELOGIO:  Aguardando NTP...");
  Serial.printf("FASE:     %s\n", nomeFase(faseAtual));
  Serial.printf("FAE:      %s\n", faeLigado ? "VENTILANDO CO2" : "Aguardando...");
  Serial.println("------------------------------------------------");

  if (sensorExtOk) Serial.printf("DHT11:    %.1f C | %.1f %%\n", tempExt, humExt);
  else             Serial.println("DHT11:    ERRO / DESCONECTADO");

  if (sensorIntOk) Serial.printf("SHT30:    %.1f C | %.1f %%\n", tempInt, humInt);
  else             Serial.println("SHT30:    ERRO / DESCONECTADO");

  Serial.println("------------------------------------------------");
  Serial.printf("Luz:      %s (%s)\n", releLuz ? "ON" : "OFF", nomeModoLuz());
  Serial.printf("Umidif:   %s%s\n", releUmidific ? "ON" : "OFF", alertaFaltaAgua ? " [!FALTA AGUA!]" : "");
  Serial.printf("Vento:    %s\n", releVentoInt ? "ON" : "OFF");
  Serial.printf("Exaustor: %s\n", releExaustExt ? "ON" : "OFF");
  Serial.println("------------------------------------------------");

  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("WIFI:     %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("WIFI:     Portal GROW_SETUP ativo");

  Serial.println("================================================");
  Serial.println("[0]Standby [P]Pinando [F]Frut [S]Flush [D]Secagem [L]Luz [R]Reset Agua");
}

// ============================================================
//  COMANDOS SERIAL
// ============================================================

void processarSerial() {
  if (!Serial.available()) return;
  char c = Serial.read();
  switch (c) {
    case '0': faseAtual = FASE_STANDBY;       break;
    case 'P': case 'p': faseAtual = FASE_PINANDO;       break;
    case 'F': case 'f': faseAtual = FASE_FRUTIFICACAO;   break;
    case 'S': case 's': faseAtual = FASE_SEGUNDO_FLUSH;  break;
    case 'D': case 'd': faseAtual = FASE_SECAGEM;        break;
    case 'L': case 'l':
      if      (modoLuz == LUZ_AUTO)       modoLuz = LUZ_FORCADA_ON;
      else if (modoLuz == LUZ_FORCADA_ON) modoLuz = LUZ_FORCADA_OFF;
      else                                 modoLuz = LUZ_AUTO;
      break;
    case 'R': case 'r':
      alertaFaltaAgua = false;
      inicioUmidificacao = 0;
      Serial.println("[SISTEMA] Alerta de agua resetado!");
      break;
  }
}

// ============================================================
//  SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n========================================");
  Serial.println("       GROW IA v2.0 - Iniciando...      ");
  Serial.println("========================================");

  // Relés: Configura pinos e garante tudo DESLIGADO
  int pinosRele[] = { PIN_RELE_LUZ, PIN_RELE_UMIDIFIC, PIN_RELE_VENTO_INT, PIN_RELE_EXAUST_EXT };
  for (int i = 0; i < 4; i++) {
    pinMode(pinosRele[i], OUTPUT);
    digitalWrite(pinosRele[i], HIGH);
  }
  Serial.println("[OK] Reles configurados");

  // Teste rápido dos relés (pisca cada um por 400ms)
  testarReles();

  // Sensor SHT30 (Interno)
  Wire.begin(PIN_SDA, PIN_SCL);
  if (sht30.begin(0x44)) {
    Serial.println("[OK] SHT30 (Interno)");
  } else {
    Serial.println("[ERRO] SHT30 nao encontrado!");
    statusSis = SIS_ERRO_SENSOR;
  }

  // Sensor DHT11 (Externo)
  dht.begin();
  Serial.println("[OK] DHT11 (Externo)");

  // Wi-Fi
  wm.setConfigPortalBlocking(false);
  if (wm.autoConnect("GROW_SETUP")) {
    Serial.println("[OK] WiFi conectado");
  } else {
    Serial.println("[INFO] Portal GROW_SETUP criado");
  }

  // Relógio NTP
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET, NTP_SERVER);

  // Servidor Web
  server.on("/",         webRoot);
  server.on("/api/data", webApiData);
  server.on("/api/cmd",  webApiCmd);
  server.begin();
  Serial.println("[OK] Dashboard Web na porta 80");

  Serial.println("========================================\n");
}

// ============================================================
//  LOOP PRINCIPAL (100% Não-Bloqueante)
// ============================================================

void loop() {
  unsigned long agora = millis();

  // Processar rede (nunca bloqueia)
  wm.process();
  server.handleClient();

  // Leitura de sensores + Motor Climático (a cada 2s)
  if (agora - ultimaLeitura >= INTERVALO_LEITURA) {
    ultimaLeitura = agora;

    // Ler sensores
    float t = sht30.readTemperature();
    float h = sht30.readHumidity();
    sensorIntOk = !isnan(t) && !isnan(h);
    if (sensorIntOk) { tempInt = t; humInt = h; }

    t = dht.readTemperature();
    h = dht.readHumidity();
    sensorExtOk = !isnan(t) && !isnan(h);
    if (sensorExtOk) { tempExt = t; humExt = h; }

    // Atualizar relógio
    struct tm ti;
    horaValida = getLocalTime(&ti);
    horaAtual  = horaValida ? ti.tm_hour : -1;

    // Atualizar status do sistema
    bool erroSensor = !sensorIntOk || !sensorExtOk;
    if (erroSensor)                         statusSis = SIS_ERRO_SENSOR;
    else if (WiFi.status() != WL_CONNECTED) statusSis = SIS_SEM_WIFI;
    else                                    statusSis = SIS_OK;

    // Executar Motor Climático (só se o sensor interno funcionar)
    if (sensorIntOk) {
      executarMotorClimatico(agora);
      aplicarSeguranca();
    }

    // Aplicar nos relés físicos
    aplicarReles();

    // Imprimir painel no Serial
    imprimirPainel();
  }

  // Comandos Serial (sempre responsivo)
  processarSerial();

  // LED RGB (sempre responsivo)
  atualizarLED(agora);
}
