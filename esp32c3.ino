// ============================================================
//  GROW IA - Firmware Inteligente + Nuvem IoT
//  Placa: ESP32-C3-MINI-1-N4
//  Autor: Gabriel + Antigravity AI
// ============================================================

#define FW_VERSION 401

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
#include <Update.h>
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
const float TEMP_MINIMA    = 18.0; // Limite de alerta (estufa não passa frio, sem injeção forçada de ar da sala)
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
const unsigned long TIMEOUT_UMID_MS = 15UL * 60 * 1000;
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
  unsigned long ventoOnMs, ventoOffMs;
  bool ventoComUmid;
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
uint32_t fwAtual = 0;
uint32_t tempoUmidAcumuladoMs = 0;
unsigned long ultimoSaveUmidAcum = 0;

// --- Proteção Anti-Fricção de Relés (Minimo Dwell Time) ---
const unsigned long MIN_DWELL_RELE_MS = 15000; // Minimo 15s entre ligar/desligar
unsigned long lastSwitchLuz = 0, lastSwitchUmid = 0, lastSwitchVento = 0, lastSwitchExaust = 0;

// --- Horímetro de Manutenção Preventiva (Segundos de Uso NVS) ---
uint32_t segLuzTotal = 0, segUmidTotal = 0, segVentoTotal = 0, segExaustTotal = 0;
unsigned long ultimoTickHorimetro = 0;
unsigned long ultimoSaveHorimetro = 0;
unsigned long tempoInicioSaturacaoUmid = 0;

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
PerfilClimatico perfis[5] = {
  {TEMP_ALVO_MAX, 97.0, 99.9, 1UL*60000, FAE_OFF_MS, 1UL*60000, 2UL*60000, false}, // 0: Standby (padrão)
  {28.0, 97.0, 99.9, 1UL*60000, 40UL*60000, 1UL*60000, 2UL*60000, true},          // 1: Pinagem (1m ON / 2m OFF + névoa)
  {29.0, 92.0, 94.0, 2UL*60000, 25UL*60000, 1UL*60000, 2UL*60000, true},          // 2: Frutificacao (1m ON / 2m OFF + névoa)
  {28.0, 97.0, 99.9, 1UL*60000, 40UL*60000, 1UL*60000, 2UL*60000, true},          // 3: Segundo Flush (1m ON / 2m OFF + névoa)
  {TEMP_ALVO_MAX, 97.0, 99.9, 1UL*60000, FAE_OFF_MS, 1UL*60000, 2UL*60000, false}  // 4: Secagem
};

void salvarPerfisNVS() {
  prefs.begin("grow_perfis", false);
  prefs.putBytes("cfg", &perfis, sizeof(perfis));
  prefs.end();
}

void carregarPerfisNVS() {
  prefs.begin("grow_perfis", true);
  if (prefs.isKey("cfg")) {
    prefs.getBytes("cfg", &perfis, sizeof(perfis));
  }
  prefs.end();
}

PerfilClimatico obterPerfil(FaseCultivo f) {
  if (f >= 0 && f <= 4) return perfis[f];
  return perfis[0];
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
  json += "\"rLuz\":" + String(lastReleLuz?1:0) + ",";
  json += "\"rUmid\":" + String(alertaFaltaAgua ? 2 : (lastReleUmidific?1:0)) + ",";
  json += "\"rVento\":" + String(lastReleVento?1:0) + ",";
  json += "\"rExaust\":" + String(lastReleExaust?1:0) + ",";
  String faseStr = nomeFase((int)faseAtual);
  if (!sensorIntOk) faseStr = "ALERTA: SHT30 OFFLINE";
  else if (!sensorExtOk) faseStr += " (DHT OFFLINE)";

  json += "\"fase\":\"" + faseStr + "\",";
  json += "\"hLuz\":" + String(segLuzTotal / 3600.0, 1) + ",";
  json += "\"hUmid\":" + String(segUmidTotal / 3600.0, 1) + ",";
  json += "\"hVento\":" + String(segVentoTotal / 3600.0, 1) + ",";
  json += "\"hExaust\":" + String(segExaustTotal / 3600.0, 1) + ",";
  
  prefs.begin("grow", true);
  json += "\"otaError\":" + String(prefs.getBool("ota_falhou", false) ? 1 : 0) + ",";
  prefs.end();

  json += "\"fw\":" + String(fwAtual);
  json += "}";

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Offline. Salvando dados no datalogger local...");
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
      prefs.begin("grow", false);
      if (prefs.getBool("ota_test", false)) {
          prefs.putBool("ota_test", false);
          prefs.putInt("ota_boot_fails", 0);
          prefs.putBool("ota_falhou", false);
          uint32_t tentativa = prefs.getUInt("ota_tentativa", 0);
          if (tentativa > 0) {
              prefs.putUInt("fw_ver", tentativa);
              fwAtual = tentativa;
          }
          Serial.println("✅ [ANTI-BRICK] Firmware novo VALIDADO com sucesso! Data consolidada.");
      }
      prefs.end();
      String response = http.getString();
      DynamicJsonDocument docRes(2048);
      if (!deserializeJson(docRes, response)) {
         if (docRes.containsKey("config_clima")) {
            uint32_t versaoNuvem = docRes.containsKey("cfg_ver") ? (uint32_t)docRes["cfg_ver"] : 0;
            prefs.begin("grow", true);
            uint32_t versaoLocal = prefs.getUInt("cfg_ver", 0);
            prefs.end();

            // Se for a primeira inicialização ou se a versão do banco no MySQL mudou:
            if (versaoNuvem == 0 || versaoNuvem != versaoLocal) {
               JsonObject cfg = docRes["config_clima"];
               bool configAlterada = false;
               for (int i = 1; i <= 3; i++) {
                  String key = String(i);
                  if (cfg.containsKey(key)) {
                     perfis[i].tempMax = cfg[key]["tX"].as<float>();
                     perfis[i].umidMin = cfg[key]["uN"].as<float>();
                     perfis[i].umidMax = cfg[key]["uX"].as<float>();
                     perfis[i].faeOnMs = cfg[key]["fO"].as<unsigned long>() * 60000UL;
                     perfis[i].faeOffMs = cfg[key]["fF"].as<unsigned long>() * 60000UL;
                     unsigned long vO = cfg[key].containsKey("vO") ? cfg[key]["vO"].as<unsigned long>() : 1;
                     unsigned long vF = cfg[key].containsKey("vF") ? cfg[key]["vF"].as<unsigned long>() : 2;
                     perfis[i].ventoOnMs = vO * 60000UL;
                     perfis[i].ventoOffMs = vF * 60000UL;
                     perfis[i].ventoComUmid = cfg[key].containsKey("vU") ? (cfg[key]["vU"].as<int>() == 1) : true;
                     configAlterada = true;
                  }
               }
               if (configAlterada) {
                  salvarPerfisNVS();
                  if (versaoNuvem > 0) {
                     prefs.begin("grow", false);
                     prefs.putUInt("cfg_ver", versaoNuvem);
                     prefs.end();
                  }
                  Serial.printf("✅ [SYNC NUVEM] Perfis climáticos atualizados com o Banco de Dados! Versão: %u\n", versaoNuvem);
               }
            }
         }
         
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
            Serial.println("📥 COMANDO NUVEM: Reset de Alerta de Agua recebido!!");
            alertaFaltaAgua = false;
            inicioUmidificacao = 0;
            tempoUmidAcumuladoMs = 0;
            prefs.begin("grow", false);
            prefs.putBool("sem_agua", false);
            prefs.putUInt("umid_acum", 0);
            prefs.end();
            ultimoEnvioNuvem = 0; // Atualiza a nuvem pra apagar o alerta
         }
         uint32_t vNuvem = docRes.containsKey("versao_nuvem") ? (uint32_t)docRes["versao_nuvem"] : 0;
         if (docRes.containsKey("comando_ota") || (vNuvem > 0 && vNuvem > fwAtual)) {
            Serial.printf("📥 OTA INICIANDO (Local: %u, Nuvem: %u)\n", fwAtual, vNuvem);
            prefs.begin("grow", false); 
            prefs.putBool("ota_test", true); 
            prefs.putUInt("ota_tentativa", vNuvem);
            prefs.putBool("ota_falhou", false);
            prefs.putInt("ota_boot_fails", 0);
            prefs.end();
            
            WiFiClientSecure otaClient; 
            otaClient.setInsecure();
            httpUpdate.rebootOnUpdate(false);
            
            String fwUrl = "https://grow.alquimistasmagicos.com.br/build/esp32.esp32.esp32c3/esp32c3.ino.bin";
            t_httpUpdate_return ret = httpUpdate.update(otaClient, fwUrl);
            
            if (ret == HTTP_UPDATE_OK) {
               Serial.println("✅ OTA CONCLUIDO! Reiniciando em modo de teste (Anti-Brick)...");
               delay(1000);
               delay(1000);
               ESP.restart();
            } else if (ret == HTTP_UPDATE_FAILED) {
               Serial.printf("❌ Falha no OTA (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
            }
         }
      }
      Serial.println("[NUVEM] Leitura enviada! O_O O_O O_O");
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
  unsigned long agora = millis();
  bool alterou = false;
  
  bool corteLuzImediato = (tempInt >= TEMP_CORTE_LUZ || modoLuz == LUZ_FORCADA_OFF);
  bool corteUmidImediato = alertaFaltaAgua;

  if (releLuz != lastReleLuz && (corteLuzImediato || agora - lastSwitchLuz >= MIN_DWELL_RELE_MS)) {
    lastReleLuz = releLuz;
    lastSwitchLuz = agora;
    digitalWrite(PIN_RELE_LUZ, releLuz ? LOW : HIGH);
    Serial.printf("💡 ACAO: LUZ %s\n", releLuz ? "LIGADA" : "DESLIGADA");
    alterou = true;
  }
  if (releUmidific != lastReleUmidific && (corteUmidImediato || agora - lastSwitchUmid >= MIN_DWELL_RELE_MS)) {
    lastReleUmidific = releUmidific;
    lastSwitchUmid = agora;
    digitalWrite(PIN_RELE_UMIDIFIC, releUmidific ? LOW : HIGH);
    Serial.printf("💧 ACAO: UMIDIFICADOR %s\n", releUmidific ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }
  if (releVentoInt != lastReleVento && (agora - lastSwitchVento >= MIN_DWELL_RELE_MS)) {
    lastReleVento = releVentoInt;
    lastSwitchVento = agora;
    digitalWrite(PIN_RELE_VENTO_INT, releVentoInt ? LOW : HIGH);
    Serial.printf("💨 ACAO: VENTILADOR INT %s\n", releVentoInt ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }
  if (releExaustExt != lastReleExaust && (agora - lastSwitchExaust >= MIN_DWELL_RELE_MS)) {
    lastReleExaust = releExaustExt;
    lastSwitchExaust = agora;
    digitalWrite(PIN_RELE_EXAUST_EXT, releExaustExt ? LOW : HIGH);
    Serial.printf("🌪️ ACAO: EXAUSTOR EXT %s\n", releExaustExt ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }

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
  if (pf.faeOnMs == 0) {
    faeLigado = false;
  } else if (pf.faeOffMs == 0) {
    faeLigado = true;
  } else {
    if (faeLigado) { 
      if (agora - ultimoCicloFAE >= pf.faeOnMs) { faeLigado = false; ultimoCicloFAE = agora; Serial.println("🔄 PROCESSO FAE: Ciclo concluido (Ar Renovado)."); } 
    }
    else { 
      if (agora - ultimoCicloFAE >= pf.faeOffMs) { faeLigado = true; ultimoCicloFAE = agora; Serial.println("🔄 PROCESSO FAE: Iniciando renovacao de ar..."); } 
    }
  }

  // --- CONTROLE TÉRMICO E FAE ---
  bool quente = (tempInt >= pf.tempMax);
  bool arFrio = false, defesaEvap = false;
  if (sensorExtOk) { // Só confia na temperatura da rua se o DHT estiver funcionando!
    arFrio = (tempExt < tempInt);
  }
  releExaustExt = false; releVentoInt = false;

  if (quente) {
    if (arFrio) { 
      releExaustExt = true; 
      releVentoInt = true; 
    } else { 
      releExaustExt = false; 
      releVentoInt = true; // Mantém o vento interno sempre ligado para resfriar os bolos
      
      // Para não encharcar (já que a evaporação tem limite físico e não vai baixar muito mais a temp),
      // criamos um ciclo: umidifica por 5 minutos, descansa 5 minutos.
      bool cicloDescanso = ((agora / 60000) % 10) >= 5; 
      
      if (humInt < 98 && !alertaFaltaAgua && !cicloDescanso) { 
        defesaEvap = true; 
      } 
    }
  }

  // Renovação de Ar Programada (FAE) - O exaustor agora obedece estritamente a este ciclo
  if (faeLigado) { 
    releExaustExt = true; 
    releVentoInt = true; 
  }

  // --- CIRCULACAO INTERNA DINAMICA & BRISA COM NEVOA ---
  // Gira o ar internamente para evitar bolsões de CO2 pesado e, se configurado, injeta névoa viva.
  bool brisaUmidificadora = false;
  if (!releVentoInt) { 
    if (pf.ventoOnMs > 0) {
      if (pf.ventoOffMs == 0) {
        releVentoInt = true; // 100% contínuo
        if (pf.ventoComUmid) brisaUmidificadora = true;
      } else {
        unsigned long cicloVento = pf.ventoOnMs + pf.ventoOffMs;
        if (cicloVento > 0 && (agora % cicloVento) < pf.ventoOnMs) {
          releVentoInt = true;
          if (pf.ventoComUmid) {
            brisaUmidificadora = true; // Injeta névoa fresca viva junto com a brisa independente do sensor!
          }
        }
      }
    }
  }
  // -----------------------------------------------------

  if (!alertaFaltaAgua) {
    if (defesaEvap) releUmidific = true;
    else if (brisaUmidificadora) releUmidific = true; // Injeta vapor de umidade junto com o ventilador preventivo
    else if (humInt < pf.umidMin) {
      if (!releUmidific) tempoInicioSaturacaoUmid = agora; // Inicia contagem do tempo mínimo
      releUmidific = true;
    }
    else if (humInt > pf.umidMax && !defesaEvap && !brisaUmidificadora) {
      // TEMPO MÍNIMO DE SATURAÇÃO VÍSUAL (2 Minutos)
      if (agora - tempoInicioSaturacaoUmid >= 120000UL || tempoInicioSaturacaoUmid == 0) {
        releUmidific = false;
        if (tempoUmidAcumuladoMs > 0) {
          tempoUmidAcumuladoMs = 0;
          prefs.begin("grow", false);
          prefs.putUInt("umid_acum", 0);
          prefs.end();
        }
      }
    }
    
    // BLOQUEIO CONTRA DESPERDÍCIO (EXAUSTOR):
    // Nunca desperdiçar umidade jogando o ar pra fora
    if (releExaustExt) {
      releUmidific = false;
    }
  } else { releUmidific = false; }
  
  if (releUmidific) releVentoInt = true;

  if (releUmidific) {
    if (inicioUmidificacao == 0) inicioUmidificacao = agora;
    unsigned long decorrido = (agora - inicioUmidificacao) + tempoUmidAcumuladoMs;
    
    if (decorrido >= TIMEOUT_UMID_MS) {
      if (humInt > 90.0) {
        // FALSO POSITIVO: Se a umidade está acima de 90%, é óbvio que tem água no tanque.
        // O motor só não alcançou a meta (ex: 99.9%) por limitação física do sensor (que as vezes trava em 99.7%).
        // Apenas resetamos o cronômetro de segurança e deixamos a vida seguir.
        tempoUmidAcumuladoMs = 0;
        inicioUmidificacao = agora;
        prefs.begin("grow", false);
        prefs.putUInt("umid_acum", 0);
        prefs.end();
      } else {
        // REALMENTE SEM ÁGUA
        alertaFaltaAgua = true; 
        releUmidific = false;
        tempoUmidAcumuladoMs = 0;
        inicioUmidificacao = 0;
        prefs.begin("grow", false);
        prefs.putBool("sem_agua", true);
        prefs.putUInt("umid_acum", 0);
        prefs.end();
        Serial.println("🚨 SEGURANCA: Falta de Agua detectada (salvo na memoria)!");
      }
    } else if (agora - ultimoSaveUmidAcum >= 60000) { // Salva o tempo decorrido na memória a cada 1 minuto
      ultimoSaveUmidAcum = agora;
      prefs.begin("grow", false);
      prefs.putUInt("umid_acum", (uint32_t)decorrido);
      prefs.end();
    }
  } else { 
    inicioUmidificacao = 0; 
  }

  if (modoLuz == LUZ_AUTO) {
    if (horaValida) {
      releLuz = (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA);
    } else {
      // MODO FALLBACK SEM INTERNET: Ciclo relativo 12h ON / 12h OFF a partir do boot
      // 86.400.000 ms = 24h. Primeiras 12h (43.200.000 ms) ON, próximas 12h OFF.
      releLuz = ((agora % 86400000UL) < 43200000UL);
    }
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
  if (server.hasArg("r")) { 
    alertaFaltaAgua = false; inicioUmidificacao = 0; tempoUmidAcumuladoMs = 0;
    prefs.begin("grow", false); prefs.putBool("sem_agua", false); prefs.putUInt("umid_acum", 0); prefs.end();
  }
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
  
  carregarPerfisNVS();

  prefs.begin("grow", false);
  faseAtual = (FaseCultivo)prefs.getInt("fase", (int)FASE_STANDBY);
  inicioFaseTempo = prefs.getUInt("inicio", 0);
  fwAtual = prefs.getUInt("fw_ver", 0);
  alertaFaltaAgua = prefs.getBool("sem_agua", false);
  tempoUmidAcumuladoMs = prefs.getUInt("umid_acum", 0);
  
  // Carrega Horimetro
  segLuzTotal = prefs.getUInt("h_luz", 0);
  segUmidTotal = prefs.getUInt("h_umid", 0);
  segVentoTotal = prefs.getUInt("h_vento", 0);
  segExaustTotal = prefs.getUInt("h_exaust", 0);
  
  prefs.end();
  
  Wire.begin(PIN_SDA, PIN_SCL);
  if (sht30.begin(0x44)) Serial.println("[OK] SHT30"); else statusSis = SIS_ERRO_SENSOR;
  // ANTI-BRICK AVANCADO (Deteccao de Bootloop)
  if (prefs.getBool("ota_test", false)) {
      int fails = prefs.getInt("ota_boot_fails", 0) + 1;
      prefs.putInt("ota_boot_fails", fails);
      if (fails > 2) {
          Serial.println("🚨 [ANTI-BRICK] Bootloop detectado! Revertendo para firmware antigo...");
          if (Update.canRollBack()) Update.rollBack();
          prefs.putBool("ota_test", false);
          prefs.putBool("ota_falhou", true);
          prefs.putInt("ota_boot_fails", 0);
          delay(500);
          ESP.restart();
      }
  }

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
  
  // Anti-Brick: Se após 5 minutos do boot de teste não validar a conexão, reverte
  if (agora > 300000UL) {
    prefs.begin("grow", true);
    bool emTeste = prefs.getBool("ota_test", false);
    prefs.end();
    if (emTeste) {
      Serial.println("🚨 FATAL: Novo firmware não respondeu à nuvem em 5 mins! Restaurando versão anterior...");
      prefs.begin("grow", false);
      prefs.putBool("ota_test", false);
      prefs.putBool("ota_falhou", true);
      prefs.putInt("ota_boot_fails", 0);
      prefs.end();
      if (Update.canRollBack()) Update.rollBack();
      delay(500);
      ESP.restart();
    }
  }

  wm.process(); server.handleClient(); ArduinoOTA.handle();

  if (agora - ultimaLeitura >= 2000) {
    ultimaLeitura = agora;
    float tI = sht30.readTemperature(), hI = sht30.readHumidity();
    float tE = dht.readTemperature(), hE = dht.readHumidity();
    
    // Filtro de Sanidade Físico (com tolerância a ruído elétrico/interferência rápida)
    bool shtFisicoOk = !isnan(tI) && !isnan(hI) && tI != 0.0 && hI != 0.0 && tI > -10.0 && tI < 60.0 && hI > 0.0 && hI <= 100.0;
    bool dhtFisicoOk = !isnan(tE) && !isnan(hE) && tE != 0.0 && hE != 0.0 && tE > -10.0 && tE < 60.0 && hE > 0.0 && hE <= 100.0;
    
    static int shtFalhasFisicas = 0;
    if (shtFisicoOk) {
      shtFalhasFisicas = 0;
      sensorIntOk = true;
    } else {
      shtFalhasFisicas++;
      if (shtFalhasFisicas >= 4) sensorIntOk = false; // 8 segundos de falha contínua para assumir pane
    }

    static int dhtFalhasFisicas = 0;
    bool dhtOk = false;
    if (dhtFisicoOk) {
      dhtFalhasFisicas = 0;
      dhtOk = true;
    } else {
      dhtFalhasFisicas++;
      if (dhtFalhasFisicas >= 4) dhtOk = false;
      else dhtOk = sensorExtOk; // Mantém o estado anterior enquanto está na tolerância
    }
    
    // Filtro de Saltos Absurdos (Anti-Spike) para o DHT (que é mais instável)
    static int dhtErrosSeguidos = 0;
    if (dhtOk && dhtFisicoOk && tempExt != -99.0) {
      if (abs(tE - tempExt) > 5.0 || abs(hE - humExt) > 15.0) {
        dhtErrosSeguidos++;
        if (dhtErrosSeguidos < 5) dhtOk = false; // Rejeita como ruído (por até 10 seg)
        else dhtErrosSeguidos = 0; // Se persistir, aceita que o clima realmente mudou muito rápido
      } else {
        dhtErrosSeguidos = 0;
      }
    }
    sensorExtOk = dhtOk;

    if (sensorIntOk && shtFisicoOk) { atualizarFiltroInt(tI, hI); atualizarMinMax(); }
    if (sensorExtOk && dhtFisicoOk) atualizarFiltroExt(tE, hE);

    struct tm ti; horaValida = getLocalTime(&ti); horaAtual = horaValida ? ti.tm_hour : -1;
    if (horaValida && inicioFaseTempo == 0 && faseAtual != FASE_STANDBY) {
      time_t stamp; time(&stamp);
      if (stamp > 1600000000) { inicioFaseTempo = stamp; prefs.putUInt("inicio", (uint32_t)inicioFaseTempo); }
    }

    if (!sensorIntOk) statusSis = SIS_ERRO_SENSOR;
    else if (WiFi.status() != WL_CONNECTED) statusSis = SIS_SEM_WIFI;
    else statusSis = SIS_OK;

    if (sensorIntOk) { 
      executarMotor(agora); 
      aplicarSeguranca(); 
    } else {
      // FALHA CRÍTICA DO SENSOR SHT30:
      // Se queimar ou desconectar, não sabemos a umidade nem temperatura.
      // O código antigo "congelaria" os relés no último estado (ex: umidificador ligado pra sempre).
      // Agora forçamos o desligamento seguro.
      releUmidific = false;
      releExaustExt = false;
      releVentoInt = true; // Mantém ventilação interna para evitar mofo
      
      // A luz pode continuar rodando independentemente do clima, guiada pelo relógio
      if (modoLuz == LUZ_AUTO) {
        if (horaValida) releLuz = (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA);
        else releLuz = ((agora % 86400000UL) < 43200000UL); // Fallback 12/12
      }
    }
    
    verificarProgressao(); aplicarReles();

    // HORIMETRO: Acumula tempo de uso de cada componente a cada ciclo (aprox 2s)
    if (ultimoTickHorimetro == 0) ultimoTickHorimetro = agora;
    unsigned long deltaHorimetro = (agora - ultimoTickHorimetro) / 1000;
    if (deltaHorimetro >= 1) {
      ultimoTickHorimetro = agora;
      if (lastReleLuz) segLuzTotal += deltaHorimetro;
      if (lastReleUmidific) segUmidTotal += deltaHorimetro;
      if (lastReleVento) segVentoTotal += deltaHorimetro;
      if (lastReleExaust) segExaustTotal += deltaHorimetro;

      // Salva o horimetro na memoria Flash a cada 30 minutos de execucao
      if (agora - ultimoSaveHorimetro >= 1800000UL) {
        ultimoSaveHorimetro = agora;
        prefs.begin("grow", false);
        prefs.putUInt("h_luz", segLuzTotal);
        prefs.putUInt("h_umid", segUmidTotal);
        prefs.putUInt("h_vento", segVentoTotal);
        prefs.putUInt("h_exaust", segExaustTotal);
        prefs.end();
      }
    }

    // LOG PERIÓDICO (A cada 10 segundos)
    if (agora - ultimoLogSerial >= 10000) {
       ultimoLogSerial = agora;
       Serial.printf("[STATUS] In: %.1fC %.1f%% | Ex: %.1fC %.1f%% | Fase: %s | Luz: %s (NTP:%s)\n", 
                     tempInt, humInt, tempExt, humExt, nomeFase((int)faseAtual), nomeModoLuz(), horaValida?"OK":"FALLBACK-12/12");
       Serial.printf("[HORAS USO] Luz: %.1fh | Umid: %.1fh | Vento: %.1fh | Exaust: %.1fh\n",
                     segLuzTotal / 3600.0, segUmidTotal / 3600.0, segVentoTotal / 3600.0, segExaustTotal / 3600.0);
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
