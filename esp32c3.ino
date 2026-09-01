// ============================================================
//  GROW IA v4.0 - Firmware Inteligente + Nuvem IoT
//  Placa: ESP32-C3-MINI-1-N4
//  Autor: Gabriel + Antigravity AI
// ============================================================

#include <Arduino.h>
#include <ArduinoJson.h>
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
#include <HTTPClient.h> // Nuvem
#include <HTTPUpdate.h> // Atualização Remota via Web (OTA)
#include <LittleFS.h>   // Datalogger Offline
#include <time.h>
#include <Preferences.h> // Memória Anti-Apagão

// ============================================================
//  CONFIGURAÇÕES DO USUÁRIO
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
const float TEMP_ALVO_MAX  = 29.0;
const float TEMP_CRITICA   = 32.0; // Aumentado para evitar spam no calor de MS
const float TEMP_CORTE_LUZ = 34.0; // Desliga luz por segurança térmica extrema

// --- Umidade ---
const float UMIDADE_MINIMA = 88.0;
const float UMIDADE_MAXIMA = 95.0;

// --- FAE ---
const unsigned long FAE_ON_MS  = 2UL * 60 * 1000;
const unsigned long FAE_OFF_MS = 58UL * 60 * 1000;

// --- Nuvem (HostGator) ---
const char* CLOUD_URL = "https://grow.alquimistasmagicos.com.br/api/index.php";
const char* CLOUD_KEY = "GrowIA_V4_SuperSecreta!";
const unsigned long INTERVALO_NUVEM = 10UL * 1000; // 10 segundos (Máxima responsividade)

// --- Segurança ---
const unsigned long TIMEOUT_UMID_MS = 30UL * 60 * 1000;
const uint8_t LED_BRILHO = 20;


// --- Progressão Automática (dias, 0 = manual) ---
const int DIAS_PINANDO     = 0;
const int DIAS_FRUTIFICACAO = 0;
const int DIAS_SEGUNDO_FLUSH = 0;

// ============================================================
//  PINOS
// ============================================================
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN 8
#endif
#define PIN_SDA 4
#define PIN_SCL 5
#define PIN_DHT 10
#define TIPO_DHT DHT11
#define PIN_RELE_LUZ 0
#define PIN_RELE_UMIDIFIC 1
#define PIN_RELE_VENTO_INT 3
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
//  OBJETOS E GLOBAIS
// ============================================================
Adafruit_SHT31 sht30 = Adafruit_SHT31();
DHT dht(PIN_DHT, TIPO_DHT);
WiFiManager wm;
WebServer server(80);
Preferences prefs;

FaseCultivo faseAtual = FASE_STANDBY;
ModoLuz     modoLuz   = LUZ_AUTO;
StatusSis   statusSis = SIS_SEM_WIFI;

float tempInt = -99.0, humInt = -99.0, tempExt = -99.0, humExt = -99.0;
bool  sensorIntOk = false, sensorExtOk = false;

#define FILTRO_N 5
float bufTempInt[FILTRO_N], bufHumInt[FILTRO_N], bufTempExt[FILTRO_N], bufHumExt[FILTRO_N];
int   idxFiltroInt = 0, idxFiltroExt = 0; 
bool  filtroIntPreenchido = false, filtroExtPreenchido = false;

float tempIntMin = 999, tempIntMax = -999, humIntMin = 999, humIntMax = -999;
char  horaMinTemp[6]="--:--", horaMaxTemp[6]="--:--", horaMinHum[6]="--:--", horaMaxHum[6]="--:--";
int   ultimoDia = -1;

bool releLuz = false, releUmidific = false, releVentoInt = false, releExaustExt = false;
bool lastReleLuz = false, lastReleUmidific = false, lastReleVento = false, lastReleExaust = false;

unsigned long ultimaLeitura = 0, ultimoCicloFAE = 0, inicioUmidificacao = 0, ultimoEnvioNuvem = 0;
unsigned long ultimoLogSerial = 0;
bool faeLigado = false, alertaFaltaAgua = false;

bool horaValida = false; int horaAtual = -1;
time_t inicioFaseTempo = 0; unsigned long bootTime = 0;


// ============================================================
//  FUNÇÕES AUXILIARES
// ============================================================
const char* nomeFase(int f) {
  switch(f) {
    case 0: return "Standby";
    case 1: return "Pinagem";
    case 2: return "Frutificacao";
    case 3: return "Segundo Flush";
    case 4: return "Secagem Total";
    default: return "Desconhecida";
  }
}
const char* nomeModoLuz() {
  if(modoLuz==LUZ_AUTO) return "AUTO"; if(modoLuz==LUZ_FORCADA_ON) return "ON"; return "OFF";
}
PerfilClimatico obterPerfil(FaseCultivo f) {
  // CLIMA TROPICAL (Campo Grande/MS) - Genetica Cambodian/TAT (Termotolerantes)
  // Sem AC: Foco em alta evaporacao (resfriamento) e FAE agressivo devido ao metabolismo acelerado no calor.
  if(f==FASE_PINANDO) return {28.0, 95.0, 99.0, 5UL*60000, 40UL*60000}; // Pinagem induzida por umidade e FAE, aceitando calor.
  if(f==FASE_FRUTIFICACAO) return {29.0, 88.0, 95.0, 5UL*60000, 25UL*60000}; // Calor = CO2 extremo. FAE muito agressivo (5m a cada 25m).
  if(f==FASE_SEGUNDO_FLUSH) return {28.0, 95.0, 99.0, 5UL*60000, 40UL*60000};
  return {TEMP_ALVO_MAX, UMIDADE_MINIMA, UMIDADE_MAXIMA, FAE_ON_MS, FAE_OFF_MS};
}
String formatUptime(unsigned long ms) {
  unsigned long s = ms / 1000; int d = s / 86400; s %= 86400; int h = s / 3600; s %= 3600; int m = s / 60;
  char buf[20]; snprintf(buf, 20, "%dd %02dh %02dm", d, h, m); return String(buf);
}
void setNovaFase(FaseCultivo nova) {
  if (faseAtual == nova) return;
  faseAtual = nova; time_t agora; time(&agora);
  inicioFaseTempo = (agora > 1600000000) ? agora : 0;
  prefs.begin("grow", false);
  prefs.putInt("fase", (int)faseAtual);
  prefs.putUInt("inicio", (uint32_t)inicioFaseTempo);
  prefs.end();
  Serial.printf("[FSM] Fase -> %s\n", nomeFase((int)faseAtual));
  ultimoEnvioNuvem = 0; // Força re-envio p/ atualizar o Dashboard imediatamente
}

// ============================================================
//  NUVEM & DATALOGGER OFFLINE (LittleFS)
// ============================================================

// ---------------------------------------------------------
// OFFLINE DATALOGGER (ANTI-APAGÃO DE INTERNET)
// ---------------------------------------------------------
void salvarOffline(String jsonPayload) {
  File f = LittleFS.open("/offline.log", "r");
  if (f && f.size() > 80000) { 
    f.close();
    LittleFS.remove("/offline.log");
    Serial.println("[LITTLEFS] Overflow! Log apagado p/ seguranca.");
  } else if (f) {
    f.close();
  }
  
  f = LittleFS.open("/offline.log", "a");
  if (f) {
    f.println(jsonPayload);
    f.close();
    Serial.println("[LITTLEFS] Salvo na memoria interna.");
  }
}

// ---------------------------------------------------------
// COMUNICAÇÃO COM A NUVEM
// ---------------------------------------------------------
void enviarNuvem(unsigned long agora) {
  if (tempInt <= -90.0) return; // Aguarda 1ª leitura válida dos sensores antes de enviar
  if (agora - ultimoEnvioNuvem < INTERVALO_NUVEM && ultimoEnvioNuvem != 0) return;
  ultimoEnvioNuvem = agora;

  time_t ts; time(&ts);
  if (ts < 1600000000) ts = 0; // NTP não sincronizou

  // Monta JSON da leitura
  String json = "{";
  json += "\"timestamp\":" + String((uint32_t)ts) + ",";
  json += "\"tI\":" + String(tempInt, 1) + ",";
  json += "\"uI\":" + String(humInt, 1) + ",";
  json += "\"tE\":" + String(tempExt, 1) + ",";
  json += "\"uE\":" + String(humExt, 1) + ",";
  json += "\"rLuz\":" + String(releLuz?1:0) + ",";
  json += "\"rUmid\":" + String(alertaFaltaAgua ? 2 : (releUmidific?1:0)) + ",";
  json += "\"rVento\":" + String(releVentoInt?1:0) + ",";
  json += "\"rExaust\":" + String(releExaustExt?1:0) + ",";
  json += "\"fase\":\"" + String(nomeFase((int)faseAtual)) + "\"";
  json += "}";

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Caiu! Tentando forcar reconexao agresiva...");
    WiFi.disconnect();
    WiFi.reconnect();
    salvarOffline(json);
    return;
  }
  
  // 1. TENTA ENVIAR DADOS ATRASADOS (OFFLINE BACKLOG)
  if (LittleFS.exists("/offline.log")) {
    File f = LittleFS.open("/offline.log", "r");
    String bulk = "["; bool first = true;
    while(f.available()) {
      String linha = f.readStringUntil('\n'); linha.trim();
      if (linha.length() > 5) {
        if (!first) bulk += ",";
        bulk += linha; first = false;
      }
    }
    bulk += "]"; f.close();

    WiFiClientSecure clientBulk; clientBulk.setInsecure();
    HTTPClient httpBulk;
    if (httpBulk.begin(clientBulk, CLOUD_URL)) {
      httpBulk.addHeader("Content-Type", "application/json");
      httpBulk.addHeader("X-Api-Key", CLOUD_KEY);
      int code = httpBulk.POST(bulk);
      httpBulk.end();
      if (code == 200) {
        LittleFS.remove("/offline.log");
        Serial.println("[NUVEM] Lote offline sincronizado!");
      }
    }
  }

  // 2. ENVIA LEITURA ATUAL
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (http.begin(client, CLOUD_URL)) {
    http.setTimeout(5000); // Tenta por max 5s, depois desiste pra não travar a placa
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Api-Key", CLOUD_KEY);
    int code = http.POST(json);
    if (code == 200) {
      String response = http.getString();
      StaticJsonDocument<256> docRes;
      if (!deserializeJson(docRes, response)) {
         if (docRes.containsKey("comando_fase")) {
            int fc = docRes["comando_fase"];
            if (fc != (int)faseAtual) {
               Serial.printf("📥 COMANDO NUVEM: Alterar fase para %s\n", nomeFase(fc));
               setNovaFase((FaseCultivo)fc);
            }
         }
         if (docRes.containsKey("comando_luz")) {
            int cl = docRes["comando_luz"];
            bool luzMudou = false;
            if (cl == 0 && modoLuz != LUZ_AUTO) { modoLuz = LUZ_AUTO; Serial.println("📥 COMANDO NUVEM: Luz mudou para modo AUTO"); luzMudou = true; }
            else if (cl == 1 && modoLuz != LUZ_FORCADA_ON) { modoLuz = LUZ_FORCADA_ON; Serial.println("📥 COMANDO NUVEM: Luz mudou para FORCADA LIGADA"); luzMudou = true; }
            else if (cl == 2 && modoLuz != LUZ_FORCADA_OFF) { modoLuz = LUZ_FORCADA_OFF; Serial.println("📥 COMANDO NUVEM: Luz mudou para FORCADA DESLIGADA"); luzMudou = true; }
            if (luzMudou) ultimoEnvioNuvem = 0; // Dispara atualização imediata
         }
         if (docRes.containsKey("comando_reset_agua")) {
            Serial.println("📥 COMANDO NUVEM: Reset de Alerta de Agua recebido!");
            alertaFaltaAgua = false;
            inicioUmidificacao = 0;
            ultimoEnvioNuvem = 0; // Atualiza a nuvem pra apagar o alerta
         }
         if (docRes.containsKey("comando_ota")) {
            Serial.println("📥 COMANDO NUVEM: INICIANDO ATUALIZACAO OTA REMOTA!");
            WiFiClientSecure otaClient; 
            otaClient.setInsecure(); // Ignora validação rigorosa de SSL (HostGator)
            httpUpdate.rebootOnUpdate(true);
            String fwUrl = String(CLOUD_URL);
            fwUrl.replace("api/index.php", "firmware.bin"); // Pega o arquivo da mesma pasta do site
            t_httpUpdate_return ret = httpUpdate.update(otaClient, fwUrl);
            if (ret == HTTP_UPDATE_FAILED) {
               Serial.printf("❌ Falha no OTA (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
            }
         }
      }
      Serial.println("[NUVEM] Leitura enviada!");
    } else {
      Serial.printf("[NUVEM] Erro %d. Salvo offline.\n", code);
      salvarOffline(json);
    }
    http.end();
  }
}

// ============================================================
//  MÓDULOS LOCAIS
// ============================================================
void atualizarMinMax() {
  struct tm ti; if (!getLocalTime(&ti)) return;
  if (ultimoDia != -1 && ultimoDia != ti.tm_mday) {
    tempIntMin = tempInt; tempIntMax = tempInt; humIntMin = humInt; humIntMax = humInt;
  }
  ultimoDia = ti.tm_mday; char hr[6]; snprintf(hr, 6, "%02d:%02d", ti.tm_hour, ti.tm_min);
  if (tempInt < tempIntMin) { tempIntMin = tempInt; strncpy(horaMinTemp, hr, 6); }
  if (tempInt > tempIntMax) { tempIntMax = tempInt; strncpy(horaMaxTemp, hr, 6); }
  if (humInt < humIntMin) { humIntMin = humInt; strncpy(horaMinHum, hr, 6); }
  if (humInt > humIntMax) { humIntMax = humInt; strncpy(horaMaxHum, hr, 6); }
}

void atualizarFiltroInt(float tI, float hI) {
  bufTempInt[idxFiltroInt]=tI; bufHumInt[idxFiltroInt]=hI;
  idxFiltroInt = (idxFiltroInt + 1) % FILTRO_N; 
  if (idxFiltroInt == 0) filtroIntPreenchido = true;
  int n = filtroIntPreenchido ? FILTRO_N : (idxFiltroInt==0?1:idxFiltroInt);
  float sT=0, sH=0; for(int i=0; i<n; i++){ sT+=bufTempInt[i]; sH+=bufHumInt[i]; }
  tempInt=sT/n; humInt=sH/n;
}

void atualizarFiltroExt(float tE, float hE) {
  bufTempExt[idxFiltroExt]=tE; bufHumExt[idxFiltroExt]=hE;
  idxFiltroExt = (idxFiltroExt + 1) % FILTRO_N; 
  if (idxFiltroExt == 0) filtroExtPreenchido = true;
  int n = filtroExtPreenchido ? FILTRO_N : (idxFiltroExt==0?1:idxFiltroExt);
  float sT=0, sH=0; for(int i=0; i<n; i++){ sT+=bufTempExt[i]; sH+=bufHumExt[i]; }
  tempExt=sT/n; humExt=sH/n;
}

void aplicarReles() {
  digitalWrite(PIN_RELE_LUZ, releLuz?LOW:HIGH); digitalWrite(PIN_RELE_UMIDIFIC, releUmidific?LOW:HIGH);
  digitalWrite(PIN_RELE_VENTO_INT, releVentoInt?LOW:HIGH); digitalWrite(PIN_RELE_EXAUST_EXT, releExaustExt?LOW:HIGH);

  bool alterou = false;
  if (releLuz != lastReleLuz) { Serial.printf("💡 ACAO: LUZ %s\n", releLuz ? "LIGADA" : "DESLIGADA"); lastReleLuz = releLuz; alterou = true; }
  if (releUmidific != lastReleUmidific) { Serial.printf("💧 ACAO: UMIDIFICADOR %s\n", releUmidific ? "LIGADO" : "DESLIGADO"); lastReleUmidific = releUmidific; alterou = true; }
  if (releVentoInt != lastReleVento) { Serial.printf("💨 ACAO: VENTILADOR INT %s\n", releVentoInt ? "LIGADO" : "DESLIGADO"); lastReleVento = releVentoInt; alterou = true; }
  if (releExaustExt != lastReleExaust) { Serial.printf("🌪️ ACAO: EXAUSTOR EXT %s\n", releExaustExt ? "LIGADO" : "DESLIGADO"); lastReleExaust = releExaustExt; alterou = true; }

  // Se a placa tomou alguma decisão e ligou/desligou algo autonomamente, 
  // força a comunicação imediata com o banco de dados para o painel não ficar defasado
  if (alterou) ultimoEnvioNuvem = 0; 
}

void verificarProgressao() {
  if (inicioFaseTempo == 0) return; time_t agora; time(&agora); if (agora < 1600000000) return;
  unsigned long dias = (agora - inicioFaseTempo) / 86400UL;
  if (faseAtual==FASE_PINANDO && DIAS_PINANDO>0 && dias>=(unsigned long)DIAS_PINANDO) {
    setNovaFase(FASE_FRUTIFICACAO);
  } else if (faseAtual==FASE_FRUTIFICACAO && DIAS_FRUTIFICACAO>0 && dias>=(unsigned long)DIAS_FRUTIFICACAO) {
    setNovaFase(FASE_SEGUNDO_FLUSH);
  } else if (faseAtual==FASE_SEGUNDO_FLUSH && DIAS_SEGUNDO_FLUSH>0 && dias>=(unsigned long)DIAS_SEGUNDO_FLUSH) {
    setNovaFase(FASE_STANDBY);
  }
}

void executarMotor(unsigned long agora) {
  if (faseAtual == FASE_STANDBY) {
    releUmidific = false; releVentoInt = false; releExaustExt = false;
    if (modoLuz == LUZ_AUTO) releLuz = false; return;
  }
  if (faseAtual == FASE_SECAGEM) {
    releUmidific = false; releVentoInt = true; releExaustExt = true;
    if (modoLuz == LUZ_AUTO) releLuz = false; return;
  }

  PerfilClimatico pf = obterPerfil(faseAtual);
  if (faeLigado) { 
    if (agora - ultimoCicloFAE >= pf.faeOnMs) { faeLigado = false; ultimoCicloFAE = agora; Serial.println("⏱️ PROCESSO FAE: Ciclo concluido (Ar Renovado)."); } 
  }
  else { 
    if (agora - ultimoCicloFAE >= pf.faeOffMs) { faeLigado = true; ultimoCicloFAE = agora; Serial.println("⏱️ PROCESSO FAE: Iniciando renovacao de ar..."); } 
  }

  bool quente = (tempInt >= pf.tempMax), frio = (tempInt <= TEMP_MINIMA);
  bool arFrio = (tempExt < tempInt), arQuente = (tempExt > tempInt), defesaEvap = false;
  releExaustExt = false; releVentoInt = false;

  if (quente) {
    if (arFrio) { releExaustExt = true; releVentoInt = true; }
    else { releExaustExt = false; if (humInt < 98 && !alertaFaltaAgua) { defesaEvap = true; releVentoInt = true; } }
  } else if (frio) {
    if (arQuente) { releExaustExt = true; releVentoInt = true; }
  }

  if (faeLigado) { releExaustExt = true; releVentoInt = true; }

  // --- CIRCULACAO INTERNA PREVENTIVA (Estufa Grande) ---
  // Gira o ar internamente independente do umidificador para evitar bolsões de ar parado e CO2 pesado
  if (!releVentoInt) { 
    if (faseAtual == FASE_FRUTIFICACAO) {
      if ((agora % 600000) < 120000) releVentoInt = true; // Frutificação: 2 min ON a cada 10 min (Mistura CO2 forte)
    } else {
      if ((agora % 600000) < 60000) releVentoInt = true;  // Outras fases: 1 min ON a cada 10 min (Brisa leve)
    }
  }
  // -----------------------------------------------------

  if (!alertaFaltaAgua) {
    if (defesaEvap) releUmidific = true;
    else if (humInt < pf.umidMin) releUmidific = true;
    else if (humInt > pf.umidMax && !defesaEvap) releUmidific = false;
  } else { releUmidific = false; }
  
  if (releUmidific) releVentoInt = true;

  if (releUmidific) {
    if (inicioUmidificacao == 0) inicioUmidificacao = agora;
    else if (agora - inicioUmidificacao > TIMEOUT_UMID_MS) {
      alertaFaltaAgua = true; releUmidific = false;
    }
  } else { inicioUmidificacao = 0; }

  if (modoLuz == LUZ_AUTO) {
    releLuz = (horaValida && (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA));
    // LOGICA DE FRIO REMOVIDA AQUI: A luz nao liga para aquecer, preservando o fotoperiodo (12/12).
    // Um rele de aquecedor sera adicionado em atualizacoes futuras caso o clima exija.
  }
}

void aplicarSeguranca() {
  if (modoLuz == LUZ_FORCADA_ON) releLuz = true;
  if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
  if (tempInt >= TEMP_CORTE_LUZ) { releLuz = false; Serial.println("🔥 SEGURANCA: Corte Termico da LUZ ativado!"); }
  if (tempInt >= TEMP_CRITICA) { Serial.println("⚠️ SEGURANCA: Temperatura critica atingida!"); }
}

// (DASHBOARD WEB LOCAL OMITIDO AQUI PARA ECONOMIA DE MEMORIA - MAS CONTINUA FUNCIONANDO)
void webRoot() { server.send(200, "text/plain", "Grow IA - Dashboard mudou-se para a Nuvem!"); }
void webApiCmd() {
  if (server.hasArg("f")) {
    String v = server.arg("f"); FaseCultivo nova = faseAtual;
    if(v=="0") nova=FASE_STANDBY; else if(v=="P") nova=FASE_PINANDO; else if(v=="F") nova=FASE_FRUTIFICACAO; else if(v=="S") nova=FASE_SEGUNDO_FLUSH; else if(v=="D") nova=FASE_SECAGEM;
    setNovaFase(nova);
  }
  if (server.hasArg("l")) { if(modoLuz==LUZ_AUTO) modoLuz=LUZ_FORCADA_ON; else if(modoLuz==LUZ_FORCADA_ON) modoLuz=LUZ_FORCADA_OFF; else modoLuz=LUZ_AUTO; }
  if (server.hasArg("r")) { alertaFaltaAgua = false; inicioUmidificacao = 0; }
  server.send(200, "text/plain", "OK");
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200); delay(1500); bootTime = millis();
  Serial.println("\n=== GROW IA v4.0 ===");

  int pr[] = {PIN_RELE_LUZ, PIN_RELE_UMIDIFIC, PIN_RELE_VENTO_INT, PIN_RELE_EXAUST_EXT};
  for (int i=0; i<4; i++) { pinMode(pr[i], OUTPUT); digitalWrite(pr[i], HIGH); }

  if(!LittleFS.begin(true)) Serial.println("[ERRO] LittleFS"); else Serial.println("[OK] LittleFS (Datalogger)");

  prefs.begin("grow", false);
  faseAtual = (FaseCultivo)prefs.getInt("fase", (int)FASE_STANDBY);
  inicioFaseTempo = prefs.getUInt("inicio", 0);
  
  Wire.begin(PIN_SDA, PIN_SCL);
  if (sht30.begin(0x44)) Serial.println("[OK] SHT30"); else statusSis = SIS_ERRO_SENSOR;
  dht.begin();

  wm.setConfigPortalBlocking(false);
  wm.autoConnect("GROW_SETUP");

  if (MDNS.begin("grow")) Serial.println("[OK] mDNS");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFF, NTP_SERVER);
  
  ArduinoOTA.setHostname("grow"); ArduinoOTA.begin();
  
  server.on("/", webRoot); server.on("/api/cmd", webApiCmd); server.begin();
}

// ============================================================
//  LOOP
// ============================================================
void loop() {
  unsigned long agora = millis();
  wm.process(); server.handleClient(); ArduinoOTA.handle();

  if (agora - ultimaLeitura >= 2000) {
    ultimaLeitura = agora;
    float tI = sht30.readTemperature(), hI = sht30.readHumidity();
    float tE = dht.readTemperature(), hE = dht.readHumidity();
    
    // Filtro de Sanidade: Ignora picos falsos (-45.0) ou erros de comunicação I2C (exato 0.00)
    sensorIntOk = !isnan(tI) && !isnan(hI) && tI != 0.0 && hI != 0.0 && tI > -10.0 && tI < 60.0 && hI > 0.0;
    sensorExtOk = !isnan(tE) && !isnan(hE) && tE != 0.0 && hE != 0.0 && tE > -10.0 && tE < 60.0 && hE > 0.0;

    if (sensorIntOk) { atualizarFiltroInt(tI, hI); atualizarMinMax(); }
    if (sensorExtOk) atualizarFiltroExt(tE, hE);

    struct tm ti; horaValida = getLocalTime(&ti); horaAtual = horaValida ? ti.tm_hour : -1;
    if (horaValida && inicioFaseTempo == 0 && faseAtual != FASE_STANDBY) {
      time_t stamp; time(&stamp);
      if (stamp > 1600000000) { inicioFaseTempo = stamp; prefs.putUInt("inicio", (uint32_t)inicioFaseTempo); }
    }

    if (!sensorIntOk) statusSis = SIS_ERRO_SENSOR;
    else if (WiFi.status() != WL_CONNECTED) statusSis = SIS_SEM_WIFI;
    else statusSis = SIS_OK;

    if (sensorIntOk) { executarMotor(agora); aplicarSeguranca(); }
    verificarProgressao(); aplicarReles();

    // LOG PERIÓDICO (A cada 10 segundos)
    if (agora - ultimoLogSerial >= 10000) {
       ultimoLogSerial = agora;
       Serial.printf("[STATUS] In: %.1fC %.1f%% | Ex: %.1fC %.1f%% | Fase: %s | Luz: %s\n", 
                     tempInt, humInt, tempExt, humExt, nomeFase((int)faseAtual), nomeModoLuz());
    }

    // ROTINA DE NUVEM
    enviarNuvem(agora);
  }



  // Dashboard LED RGB
  if (alertaFaltaAgua) rgbLedWrite(RGB_BUILTIN, (agora%200<100)?LED_BRILHO:0,0,0);
  else if (statusSis==SIS_ERRO_SENSOR) rgbLedWrite(RGB_BUILTIN, (agora%1000<500)?LED_BRILHO:0,0,0);
  else if (statusSis==SIS_SEM_WIFI) rgbLedWrite(RGB_BUILTIN, (agora%1000<500)?LED_BRILHO:0,0,(agora%1000<500)?LED_BRILHO:0);
  else if (faseAtual==FASE_STANDBY) rgbLedWrite(RGB_BUILTIN, (agora%3000<100)?LED_BRILHO:0,(agora%3000<100)?LED_BRILHO:0,(agora%3000<100)?LED_BRILHO:0);
  else if (releUmidific) rgbLedWrite(RGB_BUILTIN, 0,(agora%1000<50)?LED_BRILHO:0,(agora%1000<50)?LED_BRILHO:0);
  else if (releExaustExt) rgbLedWrite(RGB_BUILTIN, (agora%1000<50)?LED_BRILHO:0,(agora%1000<50)?LED_BRILHO:0,0);
  else rgbLedWrite(RGB_BUILTIN, 0,(agora%2000<50)?LED_BRILHO:0,0);
}
