// ============================================================
//  GROW IA v4.0 - Firmware Inteligente + Nuvem IoT
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
#include <HTTPClient.h> // Nuvem
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
const float TEMP_ALVO_MAX  = 28.5;
const float TEMP_CRITICA   = 30.0;
const float TEMP_CORTE_LUZ = 33.0;

// --- Umidade ---
const float UMIDADE_MINIMA = 88.0;
const float UMIDADE_MAXIMA = 95.0;

// --- FAE ---
const unsigned long FAE_ON_MS  = 2UL * 60 * 1000;
const unsigned long FAE_OFF_MS = 58UL * 60 * 1000;

// --- Nuvem (HostGator) ---
const char* CLOUD_URL = "https://grow.alquimistasmagicos.com.br/api/index.php";
const char* CLOUD_KEY = "GrowIA_V4_SuperSecreta!";
const unsigned long INTERVALO_NUVEM = 60UL * 1000; // 1 minuto

// --- Segurança ---
const unsigned long TIMEOUT_UMID_MS = 30UL * 60 * 1000;
const uint8_t LED_BRILHO = 20;

// --- Telegram (Opcional) ---
const char* TELEGRAM_TOKEN  = "";
const char* TELEGRAM_CHAT   = "";
const unsigned long TELEGRAM_INTERVALO = 60UL * 1000;

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

float tempInt = 0, humInt = 0, tempExt = 0, humExt = 0;
bool  sensorIntOk = false, sensorExtOk = false;

#define FILTRO_N 5
float bufTempInt[FILTRO_N], bufHumInt[FILTRO_N], bufTempExt[FILTRO_N], bufHumExt[FILTRO_N];
int   idxFiltro = 0; bool filtroPreenchido = false;

float tempIntMin = 999, tempIntMax = -999, humIntMin = 999, humIntMax = -999;
char  horaMinTemp[6]="--:--", horaMaxTemp[6]="--:--", horaMinHum[6]="--:--", horaMaxHum[6]="--:--";
int   ultimoDia = -1;

bool releLuz = false, releUmidific = false, releVentoInt = false, releExaustExt = false;

unsigned long ultimaLeitura = 0, ultimoCicloFAE = 0, inicioUmidificacao = 0, ultimoEnvioNuvem = 0;
bool faeLigado = false, alertaFaltaAgua = false;

bool horaValida = false; int horaAtual = -1;
time_t inicioFaseTempo = 0; unsigned long bootTime = 0;
unsigned long ultimoTelegram = 0; bool telegramAlertaEnviado = false;

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
  if(f==FASE_PINANDO) return {27.5, 95.0, 99.0, 3UL*60000, 40UL*60000};
  if(f==FASE_FRUTIFICACAO) return {28.5, 88.0, 92.0, 2UL*60000, 60UL*60000};
  if(f==FASE_SEGUNDO_FLUSH) return {29.0, 95.0, 99.0, 1UL*60000, 120UL*60000};
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
  prefs.putInt("fase", (int)faseAtual); prefs.putUInt("inicio", (uint32_t)inicioFaseTempo);
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
  json += "\"rUmid\":" + String(releUmidific?1:0) + ",";
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
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Api-Key", CLOUD_KEY);
    int code = http.POST(json);
    if (code == 200) {
      String response = http.getString();
      StaticJsonDocument<256> docRes;
      if (!deserializeJson(docRes, response)) {
         if (docRes.containsKey("comando_fase")) {
            int fc = docRes["comando_fase"];
            if (fc != (int)faseAtual) setNovaFase((FaseCultivo)fc);
         }
         if (docRes.containsKey("comando_luz")) {
            int cl = docRes["comando_luz"];
            if (cl == 0) modoLuz = LUZ_AUTO;
            else if (cl == 1) modoLuz = LUZ_FORCADA_ON;
            else if (cl == 2) modoLuz = LUZ_FORCADA_OFF;
            Serial.printf("🕹️ ORDEM REMOTA: Luz modo %d\n", cl);
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

void atualizarFiltro(float tI, float hI, float tE, float hE) {
  bufTempInt[idxFiltro]=tI; bufHumInt[idxFiltro]=hI; bufTempExt[idxFiltro]=tE; bufHumExt[idxFiltro]=hE;
  idxFiltro = (idxFiltro + 1) % FILTRO_N; if (idxFiltro == 0) filtroPreenchido = true;
  int n = filtroPreenchido ? FILTRO_N : (idxFiltro==0?1:idxFiltro);
  float sTi=0, sHi=0, sTe=0, sHe=0;
  for(int i=0; i<n; i++){ sTi+=bufTempInt[i]; sHi+=bufHumInt[i]; sTe+=bufTempExt[i]; sHe+=bufHumExt[i]; }
  tempInt=sTi/n; humInt=sHi/n; tempExt=sTe/n; humExt=sHe/n;
}

void aplicarReles() {
  digitalWrite(PIN_RELE_LUZ, releLuz?LOW:HIGH); digitalWrite(PIN_RELE_UMIDIFIC, releUmidific?LOW:HIGH);
  digitalWrite(PIN_RELE_VENTO_INT, releVentoInt?LOW:HIGH); digitalWrite(PIN_RELE_EXAUST_EXT, releExaustExt?LOW:HIGH);
}

void enviarTelegram(String msg) {
  if (strlen(TELEGRAM_TOKEN)==0 || strlen(TELEGRAM_CHAT)==0 || WiFi.status()!=WL_CONNECTED) return;
  unsigned long agora = millis(); if (agora - ultimoTelegram < TELEGRAM_INTERVALO) return; ultimoTelegram = agora;
  WiFiClientSecure client; client.setInsecure();
  if (client.connect("api.telegram.org", 443)) {
    String url = "/bot" + String(TELEGRAM_TOKEN) + "/sendMessage?chat_id=" + String(TELEGRAM_CHAT) + "&text=" + msg;
    client.print("GET " + url + " HTTP/1.1\r\nHost: api.telegram.org\r\nConnection: close\r\n\r\n");
    delay(100); client.stop();
  }
}

void verificarProgressao() {
  if (inicioFaseTempo == 0) return; time_t agora; time(&agora); if (agora < 1600000000) return;
  unsigned long dias = (agora - inicioFaseTempo) / 86400UL;
  if (faseAtual==FASE_PINANDO && DIAS_PINANDO>0 && dias>=(unsigned long)DIAS_PINANDO) {
    setNovaFase(FASE_FRUTIFICACAO); enviarTelegram("🍄 Mudou: PINANDO → FRUTIFICACAO");
  } else if (faseAtual==FASE_FRUTIFICACAO && DIAS_FRUTIFICACAO>0 && dias>=(unsigned long)DIAS_FRUTIFICACAO) {
    setNovaFase(FASE_SEGUNDO_FLUSH); enviarTelegram("🍄 Mudou: FRUTIFICACAO → FLUSH 2");
  } else if (faseAtual==FASE_SEGUNDO_FLUSH && DIAS_SEGUNDO_FLUSH>0 && dias>=(unsigned long)DIAS_SEGUNDO_FLUSH) {
    setNovaFase(FASE_STANDBY); enviarTelegram("🍄 Ciclo completo! STANDBY.");
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
  if (faeLigado) { if (agora - ultimoCicloFAE >= pf.faeOnMs) { faeLigado = false; ultimoCicloFAE = agora; } }
  else { if (agora - ultimoCicloFAE >= pf.faeOffMs) { faeLigado = true; ultimoCicloFAE = agora; } }

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

  if (!alertaFaltaAgua) {
    if (defesaEvap) releUmidific = true;
    else if (humInt < pf.umidMin) releUmidific = true;
    else if (humInt > pf.umidMax && !defesaEvap) releUmidific = false;
  } else { releUmidific = false; }
  
  if (releUmidific) releVentoInt = true;

  if (releUmidific) {
    if (inicioUmidificacao == 0) inicioUmidificacao = agora;
    else if (agora - inicioUmidificacao > TIMEOUT_UMID_MS) {
      alertaFaltaAgua = true; releUmidific = false; enviarTelegram("🚨 ALERTA: Falta agua!");
    }
  } else { inicioUmidificacao = 0; }

  if (modoLuz == LUZ_AUTO) {
    releLuz = (horaValida && (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA));
    if (frio && !arQuente) releLuz = true;
  }
}

void aplicarSeguranca() {
  if (modoLuz == LUZ_FORCADA_ON) releLuz = true;
  if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
  if (tempInt >= TEMP_CORTE_LUZ) { releLuz = false; enviarTelegram("🔥 CORTE TERMICO! Temp: " + String(tempInt,1) + "C"); }
  if (tempInt >= TEMP_CRITICA && !telegramAlertaEnviado) { enviarTelegram("⚠️ Temp critica: " + String(tempInt,1) + "C"); telegramAlertaEnviado = true; }
  if (tempInt < TEMP_CRITICA) telegramAlertaEnviado = false;
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
    
    // Filtro de Sanidade: Ignora picos falsos (-45.0) ou erros de comunicação
    sensorIntOk = !isnan(tI) && !isnan(hI) && tI > 0.0 && tI < 60.0 && hI > 0.0; 
    sensorExtOk = !isnan(tE) && !isnan(hE) && tE > 0.0 && tE < 60.0 && hE > 0.0;

    if (sensorIntOk && sensorExtOk) { atualizarFiltro(tI, hI, tE, hE); atualizarMinMax(); }
    else if (sensorIntOk) { atualizarFiltro(tI, hI, tempExt, humExt); atualizarMinMax(); }

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

    // ROTINA DE NUVEM
    enviarNuvem(agora);
  }

  // Comandos serial via teclado
  if (Serial.available()) {
    char c = Serial.read(); FaseCultivo nova = faseAtual;
    if(c=='0') nova=FASE_STANDBY; else if(c=='P'||c=='p') nova=FASE_PINANDO;
    else if(c=='F'||c=='f') nova=FASE_FRUTIFICACAO; else if(c=='S'||c=='s') nova=FASE_SEGUNDO_FLUSH;
    else if(c=='D'||c=='d') nova=FASE_SECAGEM;
    else if(c=='L'||c=='l') { modoLuz = (modoLuz==LUZ_AUTO)?LUZ_FORCADA_ON:(modoLuz==LUZ_FORCADA_ON?LUZ_FORCADA_OFF:LUZ_AUTO); }
    else if(c=='R'||c=='r') { alertaFaltaAgua=false; inicioUmidificacao=0; }
    setNovaFase(nova);
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
