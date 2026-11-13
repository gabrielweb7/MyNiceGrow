// ============================================================
//  GROW IA - Firmware Inteligente + Nuvem IoT
//  Placa: ESP32-C3 SuperMini (Produção) / ESP32-S3 Dual-Core
//  Autor: Gabriel + Antigravity AI
//  Versão Atual: v459 (AC Liga/Desliga pela Temp. Externa + Sifão Pós-AC Garantido)
// ============================================================

#define FW_VERSION 459

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
#include <HTTPClient.h>  // Nuvem
#include <HTTPUpdate.h>  // Atualização Remota via Web (OTA)
#include <Update.h>
#include <esp_ota_ops.h>
#include <LittleFS.h>  // Datalogger Offline
#include <time.h>
#include <sys/time.h>
#include <Preferences.h>  // Memória Anti-Apagão

// ============================================================
//  CONFIGURAÇÕES DO USUÁRIO
// ============================================================

// --- Relógio ---
const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = -10800;
const int DAYLIGHT_OFF = 0;

// --- Ciclo de Luz ---
const int LUZ_HORA_LIGA = 20;
const int LUZ_HORA_DESLIGA = 8;

// --- Temperaturas ---
const float TEMP_ALVO_MAX = 29.0;
const float TEMP_CRITICA = 32.0;    // Aumentado para evitar spam no calor de MS
float tempCorteLuz = 34.0f;           // Desliga luz por segurança térmica extrema
float tempMinCongelamento = 15.0f;    // Desliga ar condicionado por segurança anti-congelamento
float tempHistereseAr = 1.0f;         // Queda abaixo da Temp. Máxima para desligar o AC (ex: liga 28.0°C, meta OFF < 27.0°C)
unsigned long tempoExtraRefrigeracaoMs = 5UL * 60UL * 1000UL; // 5 minutos pós-meta (0 = desliga imediato na meta)
unsigned long maxRunContinuoArMs = 45UL * 60UL * 1000UL;      // Limite máximo contínuo (45 min)
unsigned long tempoSifaoPosAcMs = 15UL * 60UL * 1000UL;       // Janela pós-AC para continuar sugando ar frio da sala (15 min)
float tempDeltaArExt = 0.4f;          // Diferença mínima sala vs estufa (°C) para iniciar injeção fria
float tempDeltaSaidaExt = 0.1f;       // Diferença mínima (°C) para manter injeção ativa (histerese térmica)
float tempSifaoMin = 22.0f;           // Piso mínimo de temperatura (°C) para interromper sifão de ar frio
float umidGuardaCorte = 90.0f;        // Abaixo deste valor (%), pausa injeção fria e aciona reidratação
bool umidRetornoSeguirAlvo = true;    // Se true, só retoma exaustor quando umidade recuperar até a Umidade Alvo da fase
float umidGuardaRetorno = 99.0f;      // Valor fixo de retorno (%) quando umidRetornoSeguirAlvo estiver desativado
unsigned long tempoEvapPreAcMs = 0UL; // Desativado definitivamente (pré-resfriamento evaporativo removido)
float tempEvapAntecipa = 0.3f;        // Antecipa evaporação abaixo de pf.tempMax (°C)
unsigned long evapCooldownMs = 45UL * 60UL * 1000UL;  // Intervalo mínimo após falha antes de tentar evaporação de novo

// --- FAE ---
const unsigned long FAE_ON_MS = 2UL * 60 * 1000;
const unsigned long FAE_OFF_MS = 58UL * 60 * 1000;

// --- Nuvem (HostGator) ---
const char* CLOUD_URL = "https://grow.alquimistasmagicos.com.br/api/index.php";
const char* CLOUD_KEY = "GrowIA_V4_SuperSecreta!";
const unsigned long INTERVALO_NUVEM = 4UL * 1000;  // 4 segundos (alinhado ao ciclo de 2s do loop principal)

// --- Segurança ---
const uint8_t LED_BRILHO = 20;

// ============================================================
//  PINOS & SUPORTE DE HARDWARE (ESP32-S3 DUAL USB & ESP32-C3)
// ============================================================
#if defined(CONFIG_IDF_TARGET_ESP32S3) || defined(ARDUINO_ESP32S3_DEV)
  #define BOARD_MODEL "ESP32-S3 Dual-Core"
  #ifndef RGB_BUILTIN
    #define RGB_BUILTIN 48  // LED RGB integrado comum no ESP32-S3 DevKit
  #endif
  #define PIN_BOOT 0        // Botão BOOT físico do ESP32-S3
  #define OTA_FW_URL "https://grow.alquimistasmagicos.com.br/build/esp32.esp32.esp32s3/esp32c3.ino.bin"
#else
  #define BOARD_MODEL "ESP32-C3 SuperMini"
  #ifndef RGB_BUILTIN
    #define RGB_BUILTIN 8   // LED RGB integrado no ESP32-C3
  #endif
  #define PIN_BOOT 9        // Botão BOOT físico do ESP32-C3
  #define OTA_FW_URL "https://grow.alquimistasmagicos.com.br/build/esp32.esp32.esp32c3/esp32c3.ino.bin"
#endif

#define PIN_SDA 4
#define PIN_SCL 5
#define PIN_DHT 10
#define TIPO_DHT DHT11
#define PIN_RELE_LUZ 0
#define PIN_RELE_UMIDIFIC 1
#define PIN_RELE_VENTO_INT 3
#define PIN_RELE_EXAUST_EXT 6
#define PIN_RELE_AR_COND 7
// O módulo relé de 1 canal (Ar Condicionado) possui jumper seletor (High/Low).
// Com o jumper em HIGH (padrão de fábrica), acionar o relé requer nível ALTO (HIGH):
#define RELE_AR_NIVEL_LIGADO HIGH
#define RELE_AR_NIVEL_DESLIGADO LOW
// #define PIN_RELE_VENTO_EXT 8 // (Comentado: pronto para upgrade futuro com módulo relé duplo)

// Proteção de colisão: se o pino do Relé 1 coincidir com o pino BOOT,
// desativa o botão de factory reset para não resetar a placa quando a luz acender
#if (PIN_BOOT == PIN_RELE_LUZ)
  #define HABILITAR_BOTAO_RESET 0
#else
  #define HABILITAR_BOTAO_RESET 1
#endif

// ============================================================
//  ENUMS E STRUCTS
// ============================================================
enum FaseCultivo { FASE_STANDBY = 0,
                   FASE_PINANDO = 1,
                   FASE_FRUTIFICACAO = 2,
                   FASE_SECAGEM = 4 };
enum ModoLuz { LUZ_AUTO,
               LUZ_FORCADA_ON,
               LUZ_FORCADA_OFF };
enum ModoAr { AR_AUTO = 0,
              AR_FORCADA_ON = 1,
              AR_FORCADA_OFF = 2 };
enum ModoVentoExt { VENTO_EXT_AUTO = 0,
                    VENTO_EXT_FORCADA_ON = 1,
                    VENTO_EXT_FORCADA_OFF = 2 };
enum StatusSis { SIS_OK,
                 SIS_SEM_WIFI,
                 SIS_ERRO_SENSOR };

struct PerfilClimatico {
  float tempMax, umidMin, umidMax;
  unsigned long faeOnMs, faeOffMs;
  unsigned long ventoOnMs, ventoOffMs;
  unsigned long exaustOnMs, exaustOffMs;
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
ModoLuz modoLuz = LUZ_AUTO;
ModoAr modoAr = AR_AUTO;
ModoVentoExt modoVentoExt = VENTO_EXT_AUTO;
StatusSis statusSis = SIS_SEM_WIFI;

float tempInt = -99.0, humInt = -99.0, tempExt = -99.0, humExt = -99.0;
bool sensorIntOk = false, sensorExtOk = false;

#define FILTRO_N 5
float bufTempInt[FILTRO_N], bufHumInt[FILTRO_N], bufTempExt[FILTRO_N], bufHumExt[FILTRO_N];
int idxFiltroInt = 0, idxFiltroExt = 0;
bool filtroIntPreenchido = false, filtroExtPreenchido = false;

float tempIntMin = 999, tempIntMax = -999, humIntMin = 999, humIntMax = -999;
char horaMinTemp[6] = "--:--", horaMaxTemp[6] = "--:--", horaMinHum[6] = "--:--", horaMaxHum[6] = "--:--";
int ultimoDia = -1;

bool releLuz = false, releUmidific = false, releVentoInt = false, releExaustExt = false;
bool releArCond = false, releVentoExt = false;
bool lastReleLuz = false, lastReleUmidific = false, lastReleVento = false, lastReleExaust = false;
bool lastReleArCond = false, lastReleVentoExt = false;

unsigned long ultimaLeitura = 0, ultimoEnvioNuvem = 0;

unsigned long ultimoLogSerial = 0;
bool faeLigado = false;

bool horaValida = false;
int horaAtual = -1;
time_t inicioFaseTempo = 0;
unsigned long bootTime = 0;
uint32_t fwAtual = 0;

// Cão de Guarda (Watchdog por FreeRTOS - 100% seguro contra falhas de bibliotecas)
TaskHandle_t wdtTask;
volatile unsigned long ultimoSuspiro = 0;
void watchdogTask(void* pvParameters) {
  for (;;) {
    if (millis() - ultimoSuspiro > 25000) {  // Se o loop ficar 25 segundos congelado
      Serial.println("?? [WATCHDOG] O Sistema travou completamente! Forcando reinicio de seguranca...");
      ESP.restart();
    }
    vTaskDelay(2000 / portTICK_PERIOD_MS);
  }
}

// ---------------------------------------------------------
// DECLARACAO DAS ESTRUTURAS
// ---------------------------------------------------------
const unsigned long MIN_DWELL_RELE_MS = 15000;  // Minimo 15s entre ligar/desligar
unsigned long lastSwitchLuz = 0, lastSwitchUmid = 0, lastSwitchVento = 0, lastSwitchExaust = 0;
unsigned long lastSwitchArCond = 0, lastSwitchVentoExt = 0;
bool bypassDwellFase = true;  // Permite resposta imediata no boot e em trocas manuais de fase/clima

// Proteção Especial do Compressor do Ar Condicionado (Anti-Short Cycle Guard):
// - Tempo mínimo de compressor desligado antes de religar: 180 segundos (3 minutos)
// - Tempo mínimo de compressor ligado antes de desligar: 60 segundos (1 minuto)
unsigned long compressorUltimoDesligamento = 0;
unsigned long compressorUltimaPartida = 0;
const unsigned long AC_MIN_REST_MS = 180UL * 1000UL;
const unsigned long AC_MIN_RUN_MS  = 60UL * 1000UL;

// --- Horímetro de Manutenção Preventiva (Segundos de Uso NVS) ---
uint32_t segLuzTotal = 0, segUmidTotal = 0, segVentoTotal = 0, segExaustTotal = 0;
uint32_t segArTotal = 0, segVentoExtTotal = 0;
unsigned long ultimoTickHorimetro = 0;
unsigned long ultimoSaveHorimetro = 0;

// --- Fallback de Luz Sem NTP: millis() do boot para ciclo 12/12 quando NTP nunca sincroniza ---
// Acumula ms desde a última inversão do ciclo. Liga por 12h, apaga por 12h.
unsigned long fallbackLuzUltimaInversao = 0;
bool fallbackLuzLigada = false;  // começa desligada (assume que acordou de dia)


// ============================================================
//  FUNÇÕES AUXILIARES
// ============================================================
const char* nomeFase(int f) {
  switch (f) {
    case 0: return "Standby";
    case 1: return "Pinagem";
    case 2: return "Frutificacao";
    case 4: return "Secagem Total";
    default: return "Desconhecida";
  }
}
const char* nomeModoLuz() {
  if (modoLuz == LUZ_AUTO) return "AUTO";
  if (modoLuz == LUZ_FORCADA_ON) return "ON";
  return "OFF";
}
float calcularBulboUmidoStull(float t, float rh) {
  rh = constrain(rh, 5.0f, 100.0f);
  return t * atanf(0.151977f * sqrtf(rh + 8.313659f))
       + atanf(t + rh) - atanf(rh - 1.676331f)
       + 0.00391838f * powf(rh, 1.5f) * atanf(0.023101f * rh) - 4.686035f;
}
PerfilClimatico perfis[5] = {
  { TEMP_ALVO_MAX, 99.0, 99.0, 1UL * 60000, FAE_OFF_MS, 1UL * 60000, 2UL * 60000, 2UL * 60000, 8UL * 60000, false },  // 0: Standby (padrão)
  { 28.0, 99.0, 99.0, 1UL * 60000, 40UL * 60000, 1UL * 60000, 2UL * 60000, 2UL * 60000, 8UL * 60000, true },          // 1: Pinagem (Umidade Alvo 99% -> 100% real)
  { 29.0, 99.0, 99.0, 2UL * 60000, 25UL * 60000, 1UL * 60000, 2UL * 60000, 2UL * 60000, 8UL * 60000, true },          // 2: Frutificacao (Umidade Alvo 99% -> 100% real)
  { 28.0, 99.0, 99.0, 1UL * 60000, 40UL * 60000, 1UL * 60000, 2UL * 60000, 2UL * 60000, 8UL * 60000, false },         // 3: Reservado / Inativo
  { TEMP_ALVO_MAX, 99.0, 99.0, 1UL * 60000, FAE_OFF_MS, 1UL * 60000, 2UL * 60000, 2UL * 60000, 8UL * 60000, false }   // 4: Secagem Total
};

void salvarPerfisNVS() {
  prefs.begin("grow_perfis", false);
  prefs.putBytes("cfg", &perfis, sizeof(perfis));
  prefs.end();
}

void carregarPerfisNVS() {
  prefs.begin("grow_perfis", true);
  if (prefs.isKey("cfg")) {
    size_t len = prefs.getBytesLength("cfg");
    if (len == sizeof(perfis)) {
      prefs.getBytes("cfg", &perfis, sizeof(perfis));
    } else {
      Serial.println("[AVISO] Tamanho da estrutura de clima mudou na atualizacao do firmware. O NVS antigo foi ignorado para evitar bugs bizarrros.");
    }
  }
  prefs.end();
}

PerfilClimatico obterPerfil(FaseCultivo f) {
  if (f >= 0 && f <= 4) return perfis[f];
  return perfis[0];
}
String formatUptime(unsigned long ms) {
  unsigned long s = ms / 1000;
  int d = s / 86400;
  s %= 86400;
  int h = s / 3600;
  s %= 3600;
  int m = s / 60;
  char buf[20];
  snprintf(buf, 20, "%dd %02dh %02dm", d, h, m);
  return String(buf);
}
bool faseValida(int f) {
  return (f == FASE_STANDBY || f == FASE_PINANDO || f == FASE_FRUTIFICACAO || f == FASE_SECAGEM);
}

void setNovaFase(FaseCultivo nova) {
  if (!faseValida((int)nova)) return;
  if (faseAtual == nova) return;
  faseAtual = nova;
  bypassDwellFase = true;  // Comuta relés imediatamente na troca de fase
  time_t agora;
  time(&agora);
  inicioFaseTempo = (agora > 1600000000) ? agora : 0;
  prefs.begin("grow", false);
  prefs.putInt("fase", (int)faseAtual);
  prefs.putUInt("inicio", (uint32_t)inicioFaseTempo);
  prefs.end();
  Serial.printf("[FSM] Fase -> %s\n", nomeFase((int)faseAtual));
  ultimoEnvioNuvem = 0;  // Força re-envio p/ atualizar o Dashboard imediatamente
}

// Destravamento físico do barramento I2C (NXP Spec: 9 pulsos SCL + STOP)
// Evita que o SHT30 trave a linha SDA em LOW após ruído elétrico de relés
void recuperarBarramentoI2C() {
  Serial.println("[RECUPERACAO] Destravando fisicamente barramento I2C (9 pulsos SCL) e reiniciando SHT30...");
  Wire.end();
  pinMode(PIN_SDA, INPUT_PULLUP);
  pinMode(PIN_SCL, OUTPUT);
  for (int i = 0; i < 9; i++) {
    digitalWrite(PIN_SCL, LOW);
    delayMicroseconds(10);
    digitalWrite(PIN_SCL, HIGH);
    delayMicroseconds(10);
  }
  // Condição de STOP manual no barramento
  pinMode(PIN_SDA, OUTPUT);
  digitalWrite(PIN_SDA, LOW);
  delayMicroseconds(10);
  digitalWrite(PIN_SCL, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_SDA, HIGH);
  delayMicroseconds(10);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(50);  // Timeout de 50ms: impede travamento infinito do loop se houver falha elétrica no I2C
  if (sht30.begin(0x44)) {
    sht30.reset();
    delay(15);
    sht30.heater(false);
  }
}

// ============================================================
//  NUVEM & DATALOGGER OFFLINE (LittleFS)
// ============================================================

// ---------------------------------------------------------
// OFFLINE DATALOGGER (ANTI-APAGÃO DE INTERNET)
// ---------------------------------------------------------
const unsigned long INTERVALO_OFFLINE_LOG_MS = 60UL * 1000;  // 1 registro/minuto quando sem internet (~22h em 80KB)
unsigned long ultimoSaveOffline = 0;

void salvarOffline(String jsonPayload) {
  unsigned long agoraMs = millis();
  if (ultimoSaveOffline != 0 && (agoraMs - ultimoSaveOffline < INTERVALO_OFFLINE_LOG_MS)) {
    return;  // Throttling: evita lotar o LittleFS gravando a cada 10s
  }
  ultimoSaveOffline = agoraMs;

  File f = LittleFS.open("/offline.log", "r");
  if (f && f.size() > 80000) {
    // Rotação FIFO: descarta a metade mais antiga e preserva os dados mais recentes
    size_t metade = f.size() / 2;
    f.seek(metade);
    f.readStringUntil('\n');  // Alinha no próximo registro completo
    File tmp = LittleFS.open("/offline.rot", "w");
    if (tmp) {
      uint8_t buf[256];
      while (f.available()) {
        size_t lidos = f.read(buf, sizeof(buf));
        if (lidos > 0) tmp.write(buf, lidos);
      }
      tmp.close();
      f.close();
      LittleFS.remove("/offline.log");
      LittleFS.rename("/offline.rot", "/offline.log");
      Serial.println("[LITTLEFS] Log cheio: metade mais antiga rotacionada (FIFO).");
    } else {
      f.close();
      LittleFS.remove("/offline.log");
      Serial.println("[LITTLEFS] Overflow! Log apagado p/ seguranca.");
    }
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
  if (tempInt <= -90.0) return;  // Aguarda 1ª leitura válida dos sensores antes de enviar
  if (agora - ultimoEnvioNuvem < INTERVALO_NUVEM && ultimoEnvioNuvem != 0) return;
  ultimoEnvioNuvem = agora;

  time_t ts;
  time(&ts);
  if (ts < 1600000000) ts = 0;  // NTP não sincronizou

  // Monta JSON da leitura (se o DHT11 estiver offline, envia -99.0 para o servidor gravar NULL e não congelar o gráfico)
  float tEEnvio = sensorExtOk ? tempExt : -99.0f;
  float hEEnvio = sensorExtOk ? humExt : -99.0f;
  String json = "{";
  json += "\"timestamp\":" + String((uint32_t)ts) + ",";
  json += "\"tI\":" + String(tempInt, 1) + ",";
  json += "\"uI\":" + String(humInt, 1) + ",";
  json += "\"tE\":" + String(tEEnvio, 1) + ",";
  json += "\"uE\":" + String(hEEnvio, 1) + ",";
  // Se estiver em horário diurno confirmado no modo AUTO, o envio para a nuvem NUNCA pode reportar luz ligada
  bool luzDiurnaBloqueada = (modoLuz == LUZ_AUTO && horaValida && (horaAtual >= LUZ_HORA_DESLIGA && horaAtual < LUZ_HORA_LIGA));
  bool reportaLuzLigada = lastReleLuz && !luzDiurnaBloqueada;

  json += "\"rLuz\":" + String(reportaLuzLigada ? 1 : 0) + ",";
  json += "\"modoLuz\":" + String((int)modoLuz) + ",";
  json += "\"rUmid\":" + String(lastReleUmidific ? 1 : 0) + ",";
  json += "\"rVento\":" + String(lastReleVento ? 1 : 0) + ",";
  json += "\"rExaust\":" + String(lastReleExaust ? 1 : 0) + ",";
  json += "\"rAr\":" + String(lastReleArCond ? 1 : 0) + ",";
  json += "\"rVentoExt\":0,";
  json += "\"modoAr\":" + String((int)modoAr) + ",";
  json += "\"modoVentoExt\":0,";
  String faseStr = nomeFase((int)faseAtual);
  if (!sensorIntOk) faseStr = "ALERTA: SHT30 OFFLINE";

  json += "\"fase\":\"" + faseStr + "\",";
  json += "\"hLuz\":" + String(segLuzTotal / 3600.0, 1) + ",";
  json += "\"hUmid\":" + String(segUmidTotal / 3600.0, 1) + ",";
  json += "\"hVento\":" + String(segVentoTotal / 3600.0, 1) + ",";
  json += "\"hExaust\":" + String(segExaustTotal / 3600.0, 1) + ",";

  prefs.begin("grow", true);
  json += "\"otaError\":" + String(prefs.getBool("ota_falhou", false) ? 1 : 0) + ",";
  prefs.end();

  json += "\"fw\":" + String(fwAtual) + ",";
  json += "\"board\":\"" + String(BOARD_MODEL) + "\",";
  json += "\"vFirmware\":\"v" + String(FW_VERSION) + "\",";
  json += "\"canRollback\":" + String(Update.canRollBack() ? 1 : 0);
  json += "}";

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Offline. Salvando dados no datalogger local...");
    salvarOffline(json);
    return;
  }

  // 1. TENTA ENVIAR DADOS ATRASADOS (OFFLINE BACKLOG EM LOTES SEGUROS DE ATÉ 50 REGISTROS)
  if (LittleFS.exists("/offline.log")) {
    File f = LittleFS.open("/offline.log", "r");
    if (f) {
      String bulk = "[";
      bool first = true;
      int count = 0;
      char buf2[512];
      while (f.available() && count < 50) {
        int len = f.readBytesUntil('\n', buf2, sizeof(buf2) - 1);
        if (len > 0) {
          buf2[len] = '\0';
          if (len > 0 && buf2[len-1] == '\r') buf2[len-1] = '\0';
          if (strlen(buf2) > 5) {
            if (!first) bulk += ",";
            bulk += buf2;
            first = false;
            count++;
          }
        }
      }
      bulk += "]";

      // Se houver mais linhas acumuladas, guarda temporariamente o restante
      File tmp = LittleFS.open("/offline.tmp", "w");
      if (tmp) {
        char buffer[512];
        while (f.available()) {
          int len = f.readBytesUntil('\n', buffer, sizeof(buffer) - 1);
          if (len > 0) {
            buffer[len] = '\0';
            // Trim /r se houver
            if (len > 0 && buffer[len-1] == '\r') buffer[len-1] = '\0';
            if (strlen(buffer) > 5) {
              tmp.println(buffer);
            }
          }
        }
      }
      if (tmp) tmp.close();
      f.close();

      if (count == 0) {
        // Arquivo vazio ou corrompido: remove imediatamente para não travar em erro HTTP 400
        LittleFS.remove("/offline.log");
        LittleFS.remove("/offline.tmp");
      } else {
        ultimoSuspiro = millis();  // Alimenta Watchdog antes do TLS/HTTPS
        WiFiClientSecure clientBulk;
        clientBulk.setInsecure();
        clientBulk.setTimeout(4);  // Timeout de socket TLS em segundos (evita 30s default)
        HTTPClient httpBulk;
        httpBulk.setConnectTimeout(4000);
        if (httpBulk.begin(clientBulk, CLOUD_URL)) {
          httpBulk.setTimeout(4000);
          httpBulk.addHeader("Content-Type", "application/json");
          httpBulk.addHeader("X-Api-Key", CLOUD_KEY);
          int code = httpBulk.POST(bulk);
          ultimoSuspiro = millis();  // Alimenta Watchdog após envio em lote
          String resBulk = (code == 200) ? httpBulk.getString() : "";
          httpBulk.end();
          clientBulk.stop();

          bool loteConfirmado = false;
          int qtdInseridos = 0;
          if (code == 200 && resBulk.length() > 0) {
            DynamicJsonDocument docBulk(4096);
            DeserializationError errBulk = deserializeJson(docBulk, resBulk);
            if (!errBulk && strcmp(docBulk["status"] | "", "ok") == 0) {
              loteConfirmado = true;
              qtdInseridos = docBulk["inseridos"] | 0;
            } else {
              Serial.println("⚠️ [NUVEM] HTTP 200 no lote offline sem JSON 'status:ok' válido. Mantendo arquivo para reenvio.");
            }
          }

          if (loteConfirmado) {
            LittleFS.remove("/offline.log");
            if (LittleFS.exists("/offline.tmp")) {
              File checkTmp = LittleFS.open("/offline.tmp", "r");
              if (checkTmp && checkTmp.size() > 10) {
                checkTmp.close();
                LittleFS.rename("/offline.tmp", "/offline.log");
              } else {
                if (checkTmp) checkTmp.close();
                LittleFS.remove("/offline.tmp");
              }
            }
            if (qtdInseridos > 0) {
              Serial.printf("[NUVEM] Lote offline (%d/%d registros) sincronizado com sucesso!\n", qtdInseridos, count);
            } else {
              Serial.printf("⚠️ [NUVEM] Lote offline descartado pelo filtro do servidor (0/%d válidos).\n", count);
            }
          } else {
            LittleFS.remove("/offline.tmp");
          }
        } else {
          clientBulk.stop();
          LittleFS.remove("/offline.tmp");
        }
      }
    }
  }

  // 2. ENVIA LEITURA ATUAL
  ultimoSuspiro = millis();  // Alimenta Watchdog antes do POST principal
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(4);  // Timeout de socket TLS em segundos
  HTTPClient http;
  http.setConnectTimeout(4000);
  if (http.begin(client, CLOUD_URL)) {
    http.setTimeout(4000);  // Tenta por max 4s, depois desiste pra não travar a placa
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Api-Key", CLOUD_KEY);
    int code = http.POST(json);
    ultimoSuspiro = millis();  // Alimenta Watchdog logo após resposta da nuvem
    bool deveFazerOta = false;
    bool dispararAckImediato = false;
    uint32_t vNuvemParaOta = 0;
    String urlOtaCustom = "";
    if (code == 200) {
      esp_ota_mark_app_valid_cancel_rollback(); // Hardware Dual-Bank: Valida o firmware novo no bootloader
      prefs.begin("grow", false);
      if (prefs.getBool("ota_test", false)) {
        prefs.putBool("ota_test", false);
        prefs.putInt("ota_boot_fails", 0);
        prefs.putBool("ota_falhou", false);
        prefs.putUInt("ota_bad_ver", 0);
        uint32_t tentativa = prefs.getUInt("ota_tentativa", 0);
        if (tentativa > 0) {
          prefs.putUInt("fw_ver", tentativa);
          fwAtual = tentativa;
        }
        Serial.println("✅ [ANTI-BRICK] Firmware novo VALIDADO com sucesso! Data consolidada.");
      }
      prefs.end();
      String response = http.getString();
      DynamicJsonDocument docRes(4096);
      if (!deserializeJson(docRes, response)) {
        bool recalcularMotorImediato = false;
        if (docRes.containsKey("config_clima")) {
          uint32_t versaoNuvem = docRes.containsKey("cfg_ver") ? (uint32_t)docRes["cfg_ver"] : 0;
          prefs.begin("grow", true);
          uint32_t versaoLocal = prefs.getUInt("cfg_ver", 0);
          prefs.end();

          JsonObject cfg = docRes["config_clima"];
          bool configAlterada = false;
          auto clampF = [](float v, float mn, float mx, float def) -> float {
            if (isnan(v) || v < mn || v > mx) return def;
            return v;
          };
          auto clampMin = [](long m, unsigned long mx, unsigned long def) -> unsigned long {
            if (m < 0) return 0UL;
            if ((unsigned long)m > mx) return mx;
            return (unsigned long)m;
          };
          for (int i = 1; i <= 2; i++) {
            String key = String(i);
            if (cfg.containsKey(key)) {
              float defTx = (i == 1) ? 28.0f : 29.0f;
              float defUa = 99.0f;
              unsigned long defFo = (i == 1) ? 1UL : 2UL;
              unsigned long defFf = (i == 1) ? 40UL : 25UL;

              float tX = cfg[key].containsKey("tX") ? cfg[key]["tX"].as<float>() : defTx;
              float novoTx = clampF(tX, 15.0f, 35.0f, defTx);
              if (abs(perfis[i].tempMax - novoTx) > 0.05f) {
                perfis[i].tempMax = novoTx;
                configAlterada = true;
              }

              float uRaw = cfg[key].containsKey("uA") ? cfg[key]["uA"].as<float>() : (cfg[key].containsKey("uN") ? cfg[key]["uN"].as<float>() : defUa);
              float novoUa = clampF(uRaw, 40.0f, 99.0f, defUa);
              if (abs(perfis[i].umidMin - novoUa) > 0.05f) {
                perfis[i].umidMin = novoUa;
                perfis[i].umidMax = novoUa;
                configAlterada = true;
              }

              unsigned long fO = cfg[key].containsKey("fO") ? clampMin(cfg[key]["fO"].as<long>(), 1440UL, defFo) : defFo;
              unsigned long fF = cfg[key].containsKey("fF") ? clampMin(cfg[key]["fF"].as<long>(), 1440UL, defFf) : defFf;
              unsigned long vO = cfg[key].containsKey("vO") ? clampMin(cfg[key]["vO"].as<long>(), 1440UL, 1UL) : 1UL;
              unsigned long vF = cfg[key].containsKey("vF") ? clampMin(cfg[key]["vF"].as<long>(), 1440UL, 2UL) : 2UL;
              unsigned long eO = cfg[key].containsKey("eO") ? clampMin(cfg[key]["eO"].as<long>(), 1440UL, 2UL) : 2UL;
              unsigned long eF = cfg[key].containsKey("eF") ? clampMin(cfg[key]["eF"].as<long>(), 1440UL, 8UL) : 8UL;
              bool vU = cfg[key].containsKey("vU") ? (cfg[key]["vU"].as<int>() == 1) : true;

              if (perfis[i].faeOnMs != fO * 60000UL || perfis[i].faeOffMs != fF * 60000UL ||
                  perfis[i].ventoOnMs != vO * 60000UL || perfis[i].ventoOffMs != vF * 60000UL ||
                  perfis[i].ventoComUmid != vU) {
                perfis[i].faeOnMs = fO * 60000UL;
                perfis[i].faeOffMs = fF * 60000UL;
                perfis[i].ventoOnMs = vO * 60000UL;
                perfis[i].ventoOffMs = vF * 60000UL;
                perfis[i].exaustOnMs = eO * 60000UL;
                perfis[i].exaustOffMs = eF * 60000UL;
                perfis[i].ventoComUmid = vU;
                configAlterada = true;
              }
            }
          }

          if (cfg.containsKey("hvac")) {
            JsonObject h = cfg["hvac"];
            if (h.containsKey("tCongela")) {
              float tc = clampF(h["tCongela"].as<float>(), 5.0f, 25.0f, 15.0f);
              if (abs(tempMinCongelamento - tc) > 0.05f) { tempMinCongelamento = tc; configAlterada = true; }
            }
            if (h.containsKey("tHistereseAr")) {
              float tha = clampF(h["tHistereseAr"].as<float>(), 0.0f, 5.0f, 1.0f);
              if (abs(tempHistereseAr - tha) > 0.05f) { tempHistereseAr = tha; configAlterada = true; }
            }
            if (h.containsKey("tPosMeta")) {
              unsigned long tpm = clampMin(h["tPosMeta"].as<long>(), 60UL, 5UL) * 60000UL;
              if (tempoExtraRefrigeracaoMs != tpm) { tempoExtraRefrigeracaoMs = tpm; configAlterada = true; }
            }
            if (h.containsKey("tMaxRun")) {
              unsigned long tmr = clampMin(h["tMaxRun"].as<long>(), 180UL, 45UL) * 60000UL;
              if (maxRunContinuoArMs != tmr) { maxRunContinuoArMs = tmr; configAlterada = true; }
            }
            if (h.containsKey("tCorteLuz")) {
              float tcl = clampF(h["tCorteLuz"].as<float>(), 25.0f, 45.0f, 34.0f);
              if (abs(tempCorteLuz - tcl) > 0.05f) { tempCorteLuz = tcl; configAlterada = true; }
            }
            if (h.containsKey("tDeltaExt")) {
              float tde = clampF(h["tDeltaExt"].as<float>(), 0.1f, 5.0f, 0.4f);
              if (abs(tempDeltaArExt - tde) > 0.05f) { tempDeltaArExt = tde; configAlterada = true; }
            }
            if (h.containsKey("tDeltaSaida")) {
              float tds = clampF(h["tDeltaSaida"].as<float>(), 0.0f, 2.0f, 0.1f);
              if (tds > tempDeltaArExt) tds = tempDeltaArExt;
              if (abs(tempDeltaSaidaExt - tds) > 0.05f) { tempDeltaSaidaExt = tds; configAlterada = true; }
            }
            if (h.containsKey("tSifaoPosAc")) {
              unsigned long tsp = clampMin(h["tSifaoPosAc"].as<long>(), 60UL, 15UL) * 60000UL;
              if (tempoSifaoPosAcMs != tsp) { tempoSifaoPosAcMs = tsp; configAlterada = true; }
            }
            if (h.containsKey("tSifaoTempMin")) {
              float tsm = clampF(h["tSifaoTempMin"].as<float>(), 15.0f, 30.0f, 22.0f);
              if (abs(tempSifaoMin - tsm) > 0.05f) { tempSifaoMin = tsm; configAlterada = true; }
            }
            if (h.containsKey("uGuardaCorte")) {
              float ugc = clampF(h["uGuardaCorte"].as<float>(), 80.0f, 100.0f, 90.0f);
              if (abs(umidGuardaCorte - ugc) > 0.05f) { umidGuardaCorte = ugc; configAlterada = true; }
            }
            if (h.containsKey("uRetornoAlvo")) {
              bool ura = (h["uRetornoAlvo"].as<int>() != 0);
              if (umidRetornoSeguirAlvo != ura) { umidRetornoSeguirAlvo = ura; configAlterada = true; }
            }
            if (h.containsKey("uGuardaRetorno")) {
              float ugr = clampF(h["uGuardaRetorno"].as<float>(), 80.0f, 100.0f, 99.0f);
              if (ugr < umidGuardaCorte) ugr = umidGuardaCorte;
              if (abs(umidGuardaRetorno - ugr) > 0.05f) { umidGuardaRetorno = ugr; configAlterada = true; }
            }
            if (h.containsKey("tEvapPre")) {
              if (tempoEvapPreAcMs != 0UL) { tempoEvapPreAcMs = 0UL; configAlterada = true; }
            }
            if (h.containsKey("tEvapAnt")) {
              float tea = clampF(h["tEvapAnt"].as<float>(), 0.0f, 1.5f, 0.3f);
              if (abs(tempEvapAntecipa - tea) > 0.05f) { tempEvapAntecipa = tea; configAlterada = true; }
            }
            if (h.containsKey("tEvapCool")) {
              unsigned long tec = max(10UL, clampMin(h["tEvapCool"].as<long>(), 180UL, 45UL)) * 60000UL;
              if (evapCooldownMs != tec) { evapCooldownMs = tec; configAlterada = true; }
            }
            if (tempDeltaSaidaExt > tempDeltaArExt) { tempDeltaSaidaExt = tempDeltaArExt; configAlterada = true; }
            if (umidGuardaRetorno < umidGuardaCorte) { umidGuardaRetorno = umidGuardaCorte; configAlterada = true; }
          }

          if (configAlterada || (versaoNuvem > 0 && versaoNuvem != versaoLocal)) {
            salvarPerfisNVS();
            prefs.begin("grow", false);
            prefs.putFloat("tCongela", tempMinCongelamento);
            prefs.putFloat("tHisterAr", tempHistereseAr);
            prefs.putUInt("tPosMeta", (uint32_t)(tempoExtraRefrigeracaoMs / 60000UL));
            prefs.putUInt("tMaxRun", (uint32_t)(maxRunContinuoArMs / 60000UL));
            prefs.putFloat("tCorteLuz", tempCorteLuz);
            prefs.putFloat("tDeltaExt", tempDeltaArExt);
            prefs.putFloat("tDeltaSaida", tempDeltaSaidaExt);
            prefs.putUInt("tSifaoPosAc", (uint32_t)(tempoSifaoPosAcMs / 60000UL));
            prefs.putFloat("tSifaoMin", tempSifaoMin);
            prefs.putFloat("uGuardaCorte", umidGuardaCorte);
            prefs.putBool("uRetAlvo", umidRetornoSeguirAlvo);
            prefs.putFloat("uGuardaRet", umidGuardaRetorno);
            prefs.putUInt("tEvapPre", (uint32_t)(tempoEvapPreAcMs / 60000UL));
            prefs.putFloat("tEvapAnt", tempEvapAntecipa);
            prefs.putUInt("tEvapCool", (uint32_t)(evapCooldownMs / 60000UL));
            if (versaoNuvem > 0) prefs.putUInt("cfg_ver", versaoNuvem);
            prefs.end();
            bypassDwellFase = true;
            recalcularMotorImediato = true;
            Serial.printf("✅ [SYNC NUVEM] Perfis e travas atualizados! Versão: %u (TempMax F2: %.1f°C | Anti-Congela: %.1f°C | Pós-Meta: %lu min)\n",
                          versaoNuvem, perfis[2].tempMax, tempMinCongelamento, tempoExtraRefrigeracaoMs / 60000UL);
          }
        }

        if (docRes.containsKey("comando_fase")) {
          int fc = docRes["comando_fase"];
          if (faseValida(fc)) {
            if (fc != (int)faseAtual) {
              Serial.printf("📥 COMANDO NUVEM: Alterar fase para %s\n", nomeFase(fc));
              setNovaFase((FaseCultivo)fc);
            }
            recalcularMotorImediato = true;
          }
        }
        if (docRes.containsKey("comando_luz")) {
          int cl = docRes["comando_luz"];
          bool luzMudou = false;
          if (cl == 0 && modoLuz != LUZ_AUTO) {
            modoLuz = LUZ_AUTO;
            Serial.println("📥 COMANDO NUVEM: Luz mudou para modo AUTO");
            luzMudou = true;
          } else if (cl == 1 && modoLuz != LUZ_FORCADA_ON) {
            modoLuz = LUZ_FORCADA_ON;
            Serial.println("📥 COMANDO NUVEM: Luz mudou para FORCADA LIGADA");
            luzMudou = true;
          } else if (cl == 2 && modoLuz != LUZ_FORCADA_OFF) {
            modoLuz = LUZ_FORCADA_OFF;
            Serial.println("📥 COMANDO NUVEM: Luz mudou para FORCADA DESLIGADA");
            luzMudou = true;
          }
          if (luzMudou) {
            prefs.begin("grow", false);
            prefs.putInt("modoLuz", (int)modoLuz);
            prefs.end();
          }
          recalcularMotorImediato = true;
        }

        if (docRes.containsKey("comando_ar")) {
          int ca = docRes["comando_ar"];
          bool arMudou = false;
          if (ca == 0 && modoAr != AR_AUTO) {
            modoAr = AR_AUTO;
            Serial.println("📥 COMANDO NUVEM: Ar Condicionado em modo AUTO");
            arMudou = true;
          } else if (ca == 1 && modoAr != AR_FORCADA_ON) {
            modoAr = AR_FORCADA_ON;
            Serial.println("📥 COMANDO NUVEM: Ar Condicionado FORCADO LIGADO");
            arMudou = true;
          } else if (ca == 2 && modoAr != AR_FORCADA_OFF) {
            modoAr = AR_FORCADA_OFF;
            Serial.println("📥 COMANDO NUVEM: Ar Condicionado FORCADO DESLIGADO");
            arMudou = true;
          }
          if (arMudou) {
            prefs.begin("grow", false);
            prefs.putInt("modoAr", (int)modoAr);
            prefs.end();
          }
          recalcularMotorImediato = true;
        }

        if (docRes.containsKey("comando_vento_ext")) {
          int cve = docRes["comando_vento_ext"];
          bool veMudou = false;
          if (cve == 0 && modoVentoExt != VENTO_EXT_AUTO) {
            modoVentoExt = VENTO_EXT_AUTO;
            Serial.println("📥 COMANDO NUVEM: Vento Externo em modo AUTO");
            veMudou = true;
          } else if (cve == 1 && modoVentoExt != VENTO_EXT_FORCADA_ON) {
            modoVentoExt = VENTO_EXT_FORCADA_ON;
            Serial.println("📥 COMANDO NUVEM: Vento Externo FORCADO LIGADO");
            veMudou = true;
          } else if (cve == 2 && modoVentoExt != VENTO_EXT_FORCADA_OFF) {
            modoVentoExt = VENTO_EXT_FORCADA_OFF;
            Serial.println("📥 COMANDO NUVEM: Vento Externo FORCADO DESLIGADO");
            veMudou = true;
          }
          if (veMudou) recalcularMotorImediato = true;
        }

        if (recalcularMotorImediato) {
          bypassDwellFase = true;
          if (sensorIntOk) {
            executarMotor(agora);
            aplicarSeguranca();
          } else {
            if (modoLuz == LUZ_FORCADA_ON) releLuz = true;
            if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
            if (modoAr == AR_FORCADA_ON) releArCond = true;
            if (modoAr == AR_FORCADA_OFF) releArCond = false;
          }
          aplicarReles();
          ultimoEnvioNuvem = 0;  // Dispara atualização imediata com relés já comutados
          dispararAckImediato = true;
        }

        // COMANDO ROLLBACK: Retorna instantaneamente para a partição anterior do Dual-Bank
        if (docRes.containsKey("comando_rollback")) {
          Serial.println("↩️ [ROLLBACK] Ordem recebida da nuvem! Revertendo para partição estável anterior...");
          if (Update.canRollBack()) {
            Update.rollBack();
            delay(500);
            ESP.restart();
          } else {
            Serial.println("⚠️ [ROLLBACK] Nenhuma partição anterior gravada para reversão.");
          }
        }

        if (docRes.containsKey("url_ota")) {
          urlOtaCustom = docRes["url_ota"].as<String>();
        }

        uint32_t vNuvem = docRes.containsKey("versao_nuvem") ? (uint32_t)docRes["versao_nuvem"] : 0;
        prefs.begin("grow", true);
        uint32_t otaBadVer = prefs.getUInt("ota_bad_ver", 0);
        prefs.end();
        bool otaManual = docRes.containsKey("comando_ota");
        // Reutiliza as variáveis do escopo de enviarNuvem (evita variable shadowing)
        deveFazerOta = false;
        vNuvemParaOta = 0;
        // Evita loop infinito de OTA caso uma versão específica da nuvem tenha sofrido rollback por falha
        if (otaManual || (vNuvem > 0 && vNuvem > fwAtual && vNuvem != otaBadVer)) {
          deveFazerOta = true;
          vNuvemParaOta = vNuvem;
        }
      }
      Serial.println("[NUVEM] Leitura enviada! O_O O_O O_O");
    } else {
      Serial.printf("[NUVEM] Erro %d. Salvo offline.\n", code);
      salvarOffline(json);
    }
    http.end();
    client.stop(); // Fecha o socket SSL de telemetria para liberar toda a memória RAM
    delay(30);

    // Se algum comando alterou fase, luz, ar ou perfil climático, agenda envio imediato no próximo ciclo do loop()
    // (evita chamar enviarNuvem recursivamente com 2 sessões TLS empilhadas na RAM do ESP32-C3)
    if (dispararAckImediato && !deveFazerOta) {
      ultimoEnvioNuvem = 0;
    }

    if (deveFazerOta) {
      Serial.printf("📥 OTA INICIANDO (Local: %u, Nuvem: %u)\n", fwAtual, vNuvemParaOta);

      // SUSPENDE O CAO DE GUARDA E LIBERA SOCKETS LOCAIS PARA MAXIMIZAR HEAP TLS:
      vTaskSuspend(wdtTask);
      server.stop();

      httpUpdate.rebootOnUpdate(false);
      httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      httpUpdate.onProgress([](int cur, int total) {
        static int ultPct = -1;
        int pct = (total > 0) ? (cur * 100) / total : 0;
        if (pct / 10 != ultPct / 10) {
          ultPct = pct;
          Serial.printf("📊 [OTA] Baixando e gravando na partição: %d%% (%d / %d bytes)\n", pct, cur, total);
          rgbLedWrite(RGB_BUILTIN, 0, (pct % 20 == 0) ? LED_BRILHO : 0, LED_BRILHO);
        }
      });

      String baseFwUrl = (urlOtaCustom.length() > 10) ? urlOtaCustom : String(OTA_FW_URL);
      t_httpUpdate_return ret = HTTP_UPDATE_FAILED;

      for (int tentativaOta = 1; tentativaOta <= 3; tentativaOta++) {
        String fwUrl = baseFwUrl + (baseFwUrl.indexOf('?') >= 0 ? "&t=" : "?t=") + String(millis());
        Serial.printf("🚀 [OTA] Tentativa %d/3 -> %s (Free Heap: %u bytes)\n", tentativaOta, fwUrl.c_str(), ESP.getFreeHeap());

        WiFiClientSecure otaClient;
        otaClient.setInsecure();
        otaClient.setTimeout(30);
        otaClient.setHandshakeTimeout(30);

        ret = httpUpdate.update(otaClient, fwUrl, "v" + String(FW_VERSION), [](HTTPClient* h) {
          h->setConnectTimeout(15000);
          h->setTimeout(30000);
        });

        otaClient.stop();
        if (ret == HTTP_UPDATE_OK) break;

        Serial.printf("⚠️ [OTA] Tentativa %d falhou (%d): %s\n", tentativaOta, httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
        delay(2000);
      }

      // REATIVA O CAO DE GUARDA (caso o OTA falhe e a placa continue rodando)
      ultimoSuspiro = millis();
      vTaskResume(wdtTask);

      if (ret == HTTP_UPDATE_OK) {
        // Grava flag de teste APENAS após download e flash 100% concluídos com sucesso!
        prefs.begin("grow", false);
        prefs.putBool("ota_test", true);
        prefs.putUInt("ota_tentativa", vNuvemParaOta);
        prefs.putBool("ota_falhou", false);
        prefs.putInt("ota_boot_fails", 0);
        prefs.end();
        Serial.println("✅ OTA CONCLUIDO! Reiniciando em modo de teste (Anti-Brick)...");
        delay(1000);
        ESP.restart();
      } else if (ret == HTTP_UPDATE_FAILED) {
        Serial.printf("❌ Falha definitiva no OTA (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
        server.begin();
      }
    }
  }
}

// ============================================================
//  MÓDULOS LOCAIS
// ============================================================
void atualizarMinMax() {
  struct tm ti;
  if (!getLocalTime(&ti, 0) || (ti.tm_year + 1900 < 2024)) return;
  if (ultimoDia != -1 && ultimoDia != ti.tm_mday) {
    tempIntMin = tempInt;
    tempIntMax = tempInt;
    humIntMin = humInt;
    humIntMax = humInt;
  }
  ultimoDia = ti.tm_mday;
  char hr[6];
  snprintf(hr, 6, "%02d:%02d", ti.tm_hour, ti.tm_min);
  if (tempInt < tempIntMin) {
    tempIntMin = tempInt;
    strncpy(horaMinTemp, hr, 6);
  }
  if (tempInt > tempIntMax) {
    tempIntMax = tempInt;
    strncpy(horaMaxTemp, hr, 6);
  }
  if (humInt < humIntMin) {
    humIntMin = humInt;
    strncpy(horaMinHum, hr, 6);
  }
  if (humInt > humIntMax) {
    humIntMax = humInt;
    strncpy(horaMaxHum, hr, 6);
  }
}

void atualizarFiltroInt(float tI, float hI) {
  bufTempInt[idxFiltroInt] = tI;
  bufHumInt[idxFiltroInt] = hI;
  idxFiltroInt = (idxFiltroInt + 1) % FILTRO_N;
  if (idxFiltroInt == 0) filtroIntPreenchido = true;
  int n = filtroIntPreenchido ? FILTRO_N : (idxFiltroInt == 0 ? 1 : idxFiltroInt);

  if (n >= 5) {
    // Filtro de Média Aparada (Trimmed Mean): descarta ruídos extremos (mínimo e máximo)
    // Elimina picos isolados de gotículas de névoa ou interferências de chaveamento de relé
    float minT = bufTempInt[0], maxT = bufTempInt[0], sumT = 0;
    float minH = bufHumInt[0], maxH = bufHumInt[0], sumH = 0;
    for (int i = 0; i < 5; i++) {
      float vt = bufTempInt[i];
      float vh = bufHumInt[i];
      if (vt < minT) minT = vt;
      if (vt > maxT) maxT = vt;
      if (vh < minH) minH = vh;
      if (vh > maxH) maxH = vh;
      sumT += vt;
      sumH += vh;
    }
    tempInt = (sumT - minT - maxT) / 3.0f;
    humInt  = (sumH - minH - maxH) / 3.0f;
  } else {
    float sT = 0, sH = 0;
    for (int i = 0; i < n; i++) {
      sT += bufTempInt[i];
      sH += bufHumInt[i];
    }
    tempInt = sT / n;
    humInt = sH / n;
  }
}

void atualizarFiltroExt(float tE, float hE) {
  bufTempExt[idxFiltroExt] = tE;
  bufHumExt[idxFiltroExt] = hE;
  idxFiltroExt = (idxFiltroExt + 1) % FILTRO_N;
  if (idxFiltroExt == 0) filtroExtPreenchido = true;
  int n = filtroExtPreenchido ? FILTRO_N : (idxFiltroExt == 0 ? 1 : idxFiltroExt);
  float sT = 0, sH = 0;
  for (int i = 0; i < n; i++) {
    sT += bufTempExt[i];
    sH += bufHumExt[i];
  }
  tempExt = sT / n;
  humExt = sH / n;
}

void aplicarReles() {
  unsigned long agora = millis();
  bool alterou = false;

  // TRAVA DE SEGURANÇA ABSOLUTA DA LUZ:
  // Se estiver em modo AUTO e o relógio confirmar que é horário diurno (entre 08h e 19h59),
  // NUNCA permite que releLuz seja true, garantindo zero picos mesmo sob qualquer ruído elétrico ou oscilação do RTC.
  struct tm tiCheck = { 0 };
  bool rtcDia = (getLocalTime(&tiCheck, 0) && (tiCheck.tm_year + 1900 >= 2024) && (tiCheck.tm_hour >= LUZ_HORA_DESLIGA && tiCheck.tm_hour < LUZ_HORA_LIGA));
  bool horaDia = (horaValida && (horaAtual >= LUZ_HORA_DESLIGA && horaAtual < LUZ_HORA_LIGA));
  if (modoLuz == LUZ_AUTO && (rtcDia || horaDia)) {
    releLuz = false;
  }

  bool corteLuzImediato = (tempInt >= tempCorteLuz || modoLuz == LUZ_FORCADA_OFF || bypassDwellFase);
  bool corteStandby = (faseAtual == FASE_STANDBY);
  bool corteUmidImediato = (releExaustExt || corteStandby || faseAtual == FASE_SECAGEM || !sensorIntOk || bypassDwellFase);

  // Luz: Bypass do dwell time quando está DESLIGANDO (false), em corte de emergência ou comando manual forçado
  bool desligandoLuz = (!releLuz && lastReleLuz);
  bool comandoManualLuz = (modoLuz == LUZ_FORCADA_ON || modoLuz == LUZ_FORCADA_OFF);
  if (releLuz != lastReleLuz && (corteLuzImediato || desligandoLuz || comandoManualLuz || agora - lastSwitchLuz >= MIN_DWELL_RELE_MS)) {
    lastReleLuz = releLuz;
    lastSwitchLuz = agora;
    digitalWrite(PIN_RELE_LUZ, releLuz ? LOW : HIGH);
    prefs.begin("grow", false);
    prefs.putBool("r_luz", lastReleLuz);
    time_t tsNow;
    time(&tsNow);
    if (tsNow > 1700000000) prefs.putUInt("ult_ts", (uint32_t)tsNow);
    prefs.end();
    Serial.printf("💡 ACAO: LUZ %s (Estado salvo na NVS)\n", releLuz ? "LIGADA" : "DESLIGADA");
    alterou = true;
  }
  if (releUmidific != lastReleUmidific && (corteUmidImediato || corteStandby || !releUmidific || agora - lastSwitchUmid >= MIN_DWELL_RELE_MS)) {
    lastReleUmidific = releUmidific;
    lastSwitchUmid = agora;
    digitalWrite(PIN_RELE_UMIDIFIC, releUmidific ? LOW : HIGH);
    Serial.printf("💧 ACAO: UMIDIFICADOR %s\n", releUmidific ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }
  if (releVentoInt != lastReleVento && (corteStandby || !releVentoInt || bypassDwellFase || agora - lastSwitchVento >= MIN_DWELL_RELE_MS)) {
    lastReleVento = releVentoInt;
    lastSwitchVento = agora;
    digitalWrite(PIN_RELE_VENTO_INT, releVentoInt ? LOW : HIGH);
    Serial.printf("💨 ACAO: VENTILADOR INT %s\n", releVentoInt ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }
  if (releExaustExt != lastReleExaust && (corteStandby || !releExaustExt || bypassDwellFase || agora - lastSwitchExaust >= MIN_DWELL_RELE_MS)) {
    lastReleExaust = releExaustExt;
    lastSwitchExaust = agora;
    digitalWrite(PIN_RELE_EXAUST_EXT, releExaustExt ? LOW : HIGH);
    Serial.printf("🌪️ ACAO: EXAUSTOR EXT %s\n", releExaustExt ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }

  // Controle de Relé 5 (Ar Condicionado) com proteção de compressor anti-short cycle:
  if (releArCond != lastReleArCond) {
    bool podeComutarAr = false;
    if (releArCond) {
      // Quer LIGAR compressor: respeita descanso mínimo de 3 minutos (inclusive pós-reboot via bootTime)
      unsigned long refDescansoAr = (compressorUltimoDesligamento == 0) ? bootTime : compressorUltimoDesligamento;
      if (agora - refDescansoAr >= AC_MIN_REST_MS || modoAr == AR_FORCADA_ON) {
        podeComutarAr = true;
      } else {
        static unsigned long lastAvisoRest = 0;
        if (agora - lastAvisoRest >= 10000) {
          lastAvisoRest = agora;
          unsigned long faltaSeg = (AC_MIN_REST_MS - (agora - refDescansoAr)) / 1000UL;
          Serial.printf("⏳ COMPRESSOR AC: Protecao anti-ciclo curto ativa. Aguardando descanso (%lu s restantes)...\n", faltaSeg);
        }
      }
    } else {
      // Quer DESLIGAR compressor: respeita tempo mínimo ligado de 60 segundos
      // EXCEÇÃO DE EMERGÊNCIA: Se forçado OFF pelo usuário ou ativada a trava de segurança Anti-Congelamento, desliga no milissegundo!
      bool corteEmergenciaAr = (modoAr == AR_FORCADA_OFF || (sensorIntOk && tempInt <= tempMinCongelamento));
      if (compressorUltimaPartida == 0 || agora - compressorUltimaPartida >= AC_MIN_RUN_MS || corteEmergenciaAr) {
        podeComutarAr = true;
      }
    }

    if (podeComutarAr) {
      lastReleArCond = releArCond;
      lastSwitchArCond = agora;
      if (lastReleArCond) {
        compressorUltimaPartida = agora;
      } else {
        compressorUltimoDesligamento = agora;
      }
      digitalWrite(PIN_RELE_AR_COND, lastReleArCond ? RELE_AR_NIVEL_LIGADO : RELE_AR_NIVEL_DESLIGADO);
      Serial.printf("❄️ ACAO: AR CONDICIONADO %s\n", lastReleArCond ? "LIGADO" : "DESLIGADO");
      alterou = true;
    }
  }

  /* Controle de Relé 6 (Vento Externo) - Comentado até upgrade para módulo duplo:
  if (releVentoExt != lastReleVentoExt && (bypassDwellFase || agora - lastSwitchVentoExt >= MIN_DWELL_RELE_MS)) {
    lastReleVentoExt = releVentoExt;
    lastSwitchVentoExt = agora;
    digitalWrite(PIN_RELE_VENTO_EXT, lastReleVentoExt ? LOW : HIGH);
    Serial.printf("🌪️ ACAO: VENTO EXTERNO %s\n", lastReleVentoExt ? "LIGADO" : "DESLIGADO");
    alterou = true;
  }
  */

  bypassDwellFase = false;

  // Se a placa tomou alguma decisão e ligou/desligou algo autonomamente,
  // força a comunicação imediata com o banco de dados para o painel não ficar defasado
  if (alterou) ultimoEnvioNuvem = 0;
}

bool sifaoExaustAtivo = false;
bool sifaoPosAcAtivo = false;
bool sifaoRehidratando = false;
bool evapPreAcAtivo = false;

void executarMotor(unsigned long agora) {
  static bool modoRefrigeracaoAtivo = false;
  static unsigned long tempoAlvoAtingido = 0;
  static unsigned long descansoPreventivoAte = 0;
  static bool cicloAcAtivoPrev = false;
  static unsigned long janelaSifaoPosAcAte = 0;
  static bool injecaoFriaTermoOk = false;
  static bool guardaUmidadeOk = true;
  static bool estadoAcRestaurado = false;
  static bool acAtivoSalvoNvs = false;
  static bool acMetaSalvoNvs = false;
  static bool sifPosSalvoNvs = false;
  static unsigned long acElapsedPreBootMs = 0;
  static unsigned long tempoMetaPreBootMs = 0;
  static bool evapAtivo = false;
  static unsigned long evapInicioTs = 0;
  static float evapTempInicio = 0.0f;
  static unsigned long evapCooldownAte = 0;
  static bool evapOndaSecaAtual = false;
  static bool acCicloMonitorado = false;
  static float acTempIntInicio = 0.0f;
  static float acTempExtInicio = 0.0f;
  static bool acTeveQuedaReal = false;
  static bool acFalhaObjetivo = false;
  static bool acAvisoSemResfriarEmitido = false;

  time_t rtcAgoraSec = 0;
  time(&rtcAgoraSec);
  bool rtcValido = (rtcAgoraSec > 1700000000);

  if (!estadoAcRestaurado) {
    estadoAcRestaurado = true;
    prefs.begin("grow", true);
    acAtivoSalvoNvs = prefs.getBool("ac_ativo", false);
    uint32_t acIniTsSalvo = prefs.getUInt("ac_ini_ts", 0);
    uint32_t acMetaTsSalvo = prefs.getUInt("ac_meta_ts", 0);
    uint32_t sifPosTsSalvo = prefs.getUInt("sif_pos_ts", 0);
    prefs.end();

    unsigned long janelaMaxCicloSec = (maxRunContinuoArMs / 1000UL) + 300UL;
    if (faseAtual != FASE_STANDBY && faseAtual != FASE_SECAGEM) {
      if (acAtivoSalvoNvs && rtcValido && acIniTsSalvo > 1700000000 &&
          (uint32_t)rtcAgoraSec >= acIniTsSalvo &&
          ((uint32_t)rtcAgoraSec - acIniTsSalvo) <= janelaMaxCicloSec &&
          tempInt > (tempMinCongelamento + 0.3f) && modoAr != AR_FORCADA_OFF) {
        modoRefrigeracaoAtivo = true;
        acElapsedPreBootMs = ((unsigned long)((uint32_t)rtcAgoraSec - acIniTsSalvo)) * 1000UL;
        if (tempoExtraRefrigeracaoMs > 0 && acMetaTsSalvo > 1700000000 &&
            (uint32_t)rtcAgoraSec >= acMetaTsSalvo &&
            ((uint32_t)rtcAgoraSec - acMetaTsSalvo) <= ((tempoExtraRefrigeracaoMs / 1000UL) + 300UL)) {
          tempoMetaPreBootMs = min(tempoExtraRefrigeracaoMs, ((unsigned long)((uint32_t)rtcAgoraSec - acMetaTsSalvo)) * 1000UL);
          tempoAlvoAtingido = agora;
          acMetaSalvoNvs = true;
        }
        Serial.println("♻️ [NVS RESTORE] Ciclo de AC em andamento restaurado pós-reinício!");
      } else if (rtcValido && sifPosTsSalvo > (uint32_t)rtcAgoraSec && tempoSifaoPosAcMs > 0) {
        unsigned long restPosMs = min(tempoSifaoPosAcMs, ((unsigned long)(sifPosTsSalvo - (uint32_t)rtcAgoraSec)) * 1000UL);
        janelaSifaoPosAcAte = agora + restPosMs;
        sifPosSalvoNvs = true;
        Serial.printf("♻️ [NVS RESTORE] Janela Pós-AC restaurada (%lu min restantes)!\n", (restPosMs + 59999UL) / 60000UL);
      }
    }
  }

  auto limparPersistenciaAc = [&]() {
    acElapsedPreBootMs = 0;
    tempoMetaPreBootMs = 0;
    if (acAtivoSalvoNvs || acMetaSalvoNvs || sifPosSalvoNvs) {
      prefs.begin("grow", false);
      if (acAtivoSalvoNvs) {
        prefs.putBool("ac_ativo", false);
        prefs.putUInt("ac_ini_ts", 0);
      }
      if (acMetaSalvoNvs) prefs.putUInt("ac_meta_ts", 0);
      if (sifPosSalvoNvs) prefs.putUInt("sif_pos_ts", 0);
      prefs.end();
      acAtivoSalvoNvs = false;
      acMetaSalvoNvs = false;
      sifPosSalvoNvs = false;
    }
  };

  if (faseAtual == FASE_STANDBY) {
    modoRefrigeracaoAtivo = false;
    tempoAlvoAtingido = 0;
    cicloAcAtivoPrev = false;
    janelaSifaoPosAcAte = 0;
    injecaoFriaTermoOk = false;
    sifaoExaustAtivo = false;
    sifaoPosAcAtivo = false;
    sifaoRehidratando = false;
    evapAtivo = false;
    evapInicioTs = 0;
    evapPreAcAtivo = false;
    evapOndaSecaAtual = false;
    releUmidific = false;
    releVentoInt = false;
    releExaustExt = false;
    releArCond = false;
    // releVentoExt = false;
    if (modoLuz == LUZ_AUTO) releLuz = false;
    limparPersistenciaAc();
    return;
  }
  if (faseAtual == FASE_SECAGEM) {
    modoRefrigeracaoAtivo = false;
    tempoAlvoAtingido = 0;
    cicloAcAtivoPrev = false;
    janelaSifaoPosAcAte = 0;
    injecaoFriaTermoOk = false;
    sifaoExaustAtivo = false;
    sifaoPosAcAtivo = false;
    sifaoRehidratando = false;
    evapAtivo = false;
    evapInicioTs = 0;
    evapPreAcAtivo = false;
    evapOndaSecaAtual = false;
    releUmidific = false;
    releVentoInt = true;
    releExaustExt = true;
    releArCond = false;
    // releVentoExt = true;
    if (modoLuz == LUZ_AUTO) releLuz = false;
    limparPersistenciaAc();
    return;
  }

  PerfilClimatico pf = obterPerfil(faseAtual);
  if (pf.faeOnMs == 0) {
    faeLigado = false;
  } else if (pf.faeOffMs == 0) {
    faeLigado = true;
  } else {
    unsigned long cicloFae = pf.faeOnMs + pf.faeOffMs;
    unsigned long momentoFae = agora % cicloFae;
    time_t tnow;
    time(&tnow);
    if (tnow > 1600000000) {
      momentoFae = (tnow % (cicloFae / 1000)) * 1000;
    }
    
    bool novoFaeLigado = (momentoFae < pf.faeOnMs);
    if (novoFaeLigado && !faeLigado) {
      Serial.println("🔄 PROCESSO FAE: Iniciando renovacao de ar...");
    } else if (!novoFaeLigado && faeLigado) {
      Serial.println("🔄 PROCESSO FAE: Ciclo concluido (Ar Renovado).");
    }
    faeLigado = novoFaeLigado;
  }

  // --- ESTÁGIO 1: PRÉ-RESFRIAMENTO EVAPORATIVO INTELIGENTE (ANTES DO AC) ---
  // Quando a temperatura se aproxima de pf.tempMax e o bulbo úmido da sala permite perda latente real,
  // tenta resfriamento evaporativo em ondas antes de ligar o compressor do Ar Condicionado.
  bool corteCongelaAtivo = (sensorIntOk && tempInt <= tempMinCongelamento);
  bool emJanelaPosAcAgora = (janelaSifaoPosAcAte > 0 && (long)(janelaSifaoPosAcAte - agora) > 0);
  if (descansoPreventivoAte > 0 && (long)(agora - descansoPreventivoAte) >= 0) {
    descansoPreventivoAte = 0;
  }
  bool emDescansoPreventivoAr = (descansoPreventivoAte > 0 && (long)(descansoPreventivoAte - agora) > 0);
  bool acPermitidoAuto = (modoAr == AR_AUTO) && !corteCongelaAtivo && !emDescansoPreventivoAr;
  bool cooldownEvapLivre = (evapCooldownAte == 0 || (long)(agora - evapCooldownAte) >= 0);
  float tDisparoEvap = pf.tempMax - tempEvapAntecipa;
  float tMetaSucessoEvap = max(tempMinCongelamento + 0.5f, pf.tempMax - max(0.5f, tempHistereseAr * 0.55f));
  float tWetSala = sensorExtOk ? calcularBulboUmidoStull(tempExt, humExt) : 99.0f;
  bool evapViavelInicio = sensorExtOk
    ? (humExt < 86.0f && tempExt <= (pf.tempMax + 1.5f) && tWetSala <= (pf.tempMax - 1.2f))
    : (tempInt < pf.tempMax && humInt < 94.0f);

  if (evapAtivo) {
    bool perdeuGradiente = sensorExtOk
      ? (humExt >= 89.0f || tempExt > (pf.tempMax + 2.0f) || tWetSala > (pf.tempMax - 0.8f))
      : (tempInt >= pf.tempMax);
    bool aqueceuDemais = (tempInt >= (pf.tempMax + 0.4f)) || (tempInt >= (evapTempInicio + 0.35f) && tempInt >= (pf.tempMax - 0.1f));
    bool sucessoEvap = (tempInt <= tMetaSucessoEvap && tempInt <= (evapTempInicio - 0.3f));
    bool timeoutEvap = ((agora - evapInicioTs) >= tempoEvapPreAcMs);

    if (!acPermitidoAuto || modoRefrigeracaoAtivo || tempoEvapPreAcMs == 0 || !sensorIntOk || emJanelaPosAcAgora) {
      evapAtivo = false;
      evapOndaSecaAtual = false;
    } else if (sucessoEvap) {
      evapAtivo = false;
      evapOndaSecaAtual = false;
      evapCooldownAte = agora + min(evapCooldownMs, 15UL * 60UL * 1000UL);
      Serial.printf("💧🌀 EVAP: Sucesso! Estufa caiu para %.1f°C sem ligar o AC.\n", tempInt);
    } else if (perdeuGradiente || aqueceuDemais) {
      evapAtivo = false;
      evapOndaSecaAtual = false;
      evapCooldownAte = agora + evapCooldownMs;
      Serial.printf("💧➡️❄️ EVAP: Abortado (Int: %.1f°C, Ext: %.1f°C / %.0f%%). Liberando AC + pausa %lu min.\n", tempInt, tempExt, humExt, evapCooldownMs / 60000UL);
    } else if (timeoutEvap) {
      evapAtivo = false;
      evapOndaSecaAtual = false;
      if (tempInt < pf.tempMax && tempInt <= (evapTempInicio - 0.25f)) {
        evapCooldownAte = agora + min(evapCooldownMs, 15UL * 60UL * 1000UL);
        Serial.printf("💧🌀 EVAP: Ciclo concluído (%.1f°C -> %.1f°C). Retentativa breve liberada.\n", evapTempInicio, tempInt);
      } else {
        evapCooldownAte = agora + evapCooldownMs;
        Serial.printf("💧➡️❄️ EVAP: Tempo limite (%lu min, Int: %.1f°C). Passando para AC + pausa %lu min.\n", tempoEvapPreAcMs / 60000UL, tempInt, evapCooldownMs / 60000UL);
      }
    }
  } else if (tempoEvapPreAcMs > 0 && sensorIntOk && !modoRefrigeracaoAtivo && acPermitidoAuto && cooldownEvapLivre && !emJanelaPosAcAgora) {
    if (tempInt >= tDisparoEvap && tempInt < (pf.tempMax + 0.4f) && evapViavelInicio) {
      evapAtivo = true;
      evapInicioTs = agora;
      evapTempInicio = tempInt;
      evapOndaSecaAtual = (humInt >= 95.5f && humInt >= umidGuardaCorte);
      Serial.printf("💧🌀 EVAP: Tentativa pré-AC iniciada (Int: %.1f°C, Tw_sala: %.1f°C, limite %lu min).\n", tempInt, tWetSala, tempoEvapPreAcMs / 60000UL);
    }
  }
  evapPreAcAtivo = evapAtivo;

  // --- CONTROLE TÉRMICO E CLIMATIZAÇÃO INTELIGENTE (AR CONDICIONADO) ---
  // Quando atinge a temperatura alvo máxima (pf.tempMax), aciona o Ar Condicionado (exceto se o Pré-AC Evaporativo estiver testando).
  // Quando atinge a meta de desligamento (metaDesligaAr), mantém ligado pelo tempo extra configurado
  // para estabilizar e fixar a climatização do ambiente antes de desligar.
  unsigned long runArAtualMs = acElapsedPreBootMs + ((lastReleArCond && compressorUltimaPartida > 0) ? (agora - compressorUltimaPartida) : 0UL);
  if (lastReleArCond) {
    if (!acCicloMonitorado) {
      acCicloMonitorado = true;
      acTempIntInicio = tempInt;
      acTempExtInicio = tempExt;
      acTeveQuedaReal = false;
      acFalhaObjetivo = false;
      acAvisoSemResfriarEmitido = false;
    } else {
      if ((sensorIntOk && tempInt <= (acTempIntInicio - 0.2f)) ||
          (sensorExtOk && tempExt <= (acTempExtInicio - 0.3f))) {
        acTeveQuedaReal = true;
      }
      if (runArAtualMs >= 15UL * 60UL * 1000UL && !acTeveQuedaReal && !acAvisoSemResfriarEmitido) {
        acAvisoSemResfriarEmitido = true;
        acFalhaObjetivo = true;
        Serial.println("⚠️ ALERTA AC: Ar Condicionado ligado há 15+ min sem queda de temperatura!");
      }
    }
  }
  float tempRefAr = sensorExtOk ? tempExt : tempInt;
  if (corteCongelaAtivo) {
    // Encerra completamente o ciclo automático para não religar cedo após AC_MIN_REST_MS
    modoRefrigeracaoAtivo = false;
    tempoAlvoAtingido = 0;
    tempoMetaPreBootMs = 0;
    evapAtivo = false;
    evapPreAcAtivo = false;
  } else if (emDescansoPreventivoAr) {
    modoRefrigeracaoAtivo = false;
    tempoAlvoAtingido = 0;
    tempoMetaPreBootMs = 0;
    evapAtivo = false;
    evapPreAcAtivo = false;
  } else if (modoRefrigeracaoAtivo && (lastReleArCond || acElapsedPreBootMs > 0) && runArAtualMs >= maxRunContinuoArMs) {
    // Limite contínuo checado em TODA a faixa térmica ativa (mesmo abaixo de pf.tempMax durante a descida)
    Serial.printf("⏳ SEGURANÇA: Ar Condicionado atingiu limite contínuo de %lu min sem bater a meta. Pausa preventiva de 10 min...\n", maxRunContinuoArMs / 60000UL);
    if (!acTeveQuedaReal) acFalhaObjetivo = true; // Só bloqueia Sifão Pós-AC se realmente não houve queda térmica
    descansoPreventivoAte = agora + (10UL * 60UL * 1000UL);
    modoRefrigeracaoAtivo = false;
    tempoAlvoAtingido = 0;
    tempoMetaPreBootMs = 0;
    evapAtivo = false;
    evapPreAcAtivo = false;
  } else if (!evapAtivo && tempRefAr >= pf.tempMax) {
    modoRefrigeracaoAtivo = true;
    tempoAlvoAtingido = 0; // Se voltou a subir, cancela temporizador de desligamento
    tempoMetaPreBootMs = 0;
  } else if (modoRefrigeracaoAtivo) {
    // Meta de desligamento dinâmica medida no QUARTO (tempExt) quando disponível; fallback para estufa se offline
    float metaDesligaAr = max(tempMinCongelamento + 0.2f, pf.tempMax - tempHistereseAr);
    if (tempRefAr <= (metaDesligaAr + 0.02f)) {
      if (tempoExtraRefrigeracaoMs == 0) {
        modoRefrigeracaoAtivo = false;
        tempoAlvoAtingido = 0;
        tempoMetaPreBootMs = 0;
        Serial.printf("❄️ CLIMATIZAÇÃO: Meta do quarto atingida (Quarto %.1f°C <= %.1f°C | Estufa %.1f°C)! Desligando Ar Condicionado.\n", tempRefAr, metaDesligaAr, tempInt);
      } else if (tempoAlvoAtingido == 0) {
        tempoAlvoAtingido = agora;
        tempoMetaPreBootMs = 0;
        Serial.printf("❄️ CLIMATIZAÇÃO: Meta do quarto atingida (Quarto %.1f°C <= %.1f°C)! Mantendo Ar ligado por mais %lu min...\n", tempRefAr, metaDesligaAr, tempoExtraRefrigeracaoMs / 60000UL);
      } else if ((tempoMetaPreBootMs + (agora - tempoAlvoAtingido)) >= tempoExtraRefrigeracaoMs) {
        modoRefrigeracaoAtivo = false;
        tempoAlvoAtingido = 0;
        tempoMetaPreBootMs = 0;
        Serial.printf("❄️ CLIMATIZAÇÃO: %lu min pós-meta concluídos (Quarto %.1f°C <= %.1f°C | Estufa %.1f°C). Desligando Ar Condicionado.\n", tempoExtraRefrigeracaoMs / 60000UL, tempRefAr, metaDesligaAr, tempInt);
      }
    } else {
      tempoAlvoAtingido = 0; // Ainda acima da metaDesligaAr no quarto: segue resfriando antes de contar pós-meta
      tempoMetaPreBootMs = 0;
    }
  }
  if (!modoRefrigeracaoAtivo) {
    acElapsedPreBootMs = 0;
  }

  // Ar Condicionado (Refrigeração da Sala):
  if (modoRefrigeracaoAtivo) {
    releArCond = true;
  } else {
    releArCond = false;
  }

  // RESET EXPLICITO: Todos os reles partem de OFF e sao definidos pelas regras abaixo
  releExaustExt = false;
  releVentoInt = false;
  if (modoLuz == LUZ_AUTO) releLuz = false;

  bool cicloAcAtivo = (modoRefrigeracaoAtivo || (modoAr == AR_FORCADA_ON)) && (modoAr != AR_FORCADA_OFF) && !corteCongelaAtivo;
  bool acOperando = cicloAcAtivo || lastReleArCond;

  // 1. A Renovação de Ar Programada (FAE)
  // Durante o ciclo de refrigeração do AC, pausa o FAE para não desestabilizar a temperatura nem desperdiçar energia
  if (faeLigado && !acOperando) {
    releExaustExt = true;
  }

  // 2. Sifão Térmico em Ondas (EXCLUSIVAMENTE na Janela Pós-AC)
  // O exaustor NÃO liga durante o funcionamento do AC para não derrubar a umidade nem brigar com o umidificador.
  // Assim que o AC desliga e a sala estiver fria, a janela Pós-AC abre e aproveita o ar gelado residual da sala.
  if (cicloAcAtivoPrev && !acOperando && tempoSifaoPosAcMs > 0) {
    bool acFuncionouDeFato = acCicloMonitorado && !acFalhaObjetivo;
    if (acFuncionouDeFato) {
      janelaSifaoPosAcAte = agora + tempoSifaoPosAcMs;
      Serial.printf("🌬️ SIFÃO PÓS-AC: Janela aberta por %lu min para aproveitar o ar frio da sala!\n", tempoSifaoPosAcMs / 60000UL);
    } else {
      janelaSifaoPosAcAte = 0;
      Serial.println("🚫 SIFÃO PÓS-AC: Não iniciado porque o AC não resfriou / não atingiu a meta.");
    }
  }
  if (!acOperando) {
    acCicloMonitorado = false;
    acTeveQuedaReal = false;
    acFalhaObjetivo = false;
    acAvisoSemResfriarEmitido = false;
  }
  if (acOperando) {
    janelaSifaoPosAcAte = 0;
  }
  cicloAcAtivoPrev = acOperando;

  bool emJanelaSifaoPosAc = (janelaSifaoPosAcAte > 0 && (long)(janelaSifaoPosAcAte - agora) > 0);
  if (janelaSifaoPosAcAte > 0 && !emJanelaSifaoPosAc && !acOperando) {
    janelaSifaoPosAcAte = 0;
    Serial.println("🌬️ SIFÃO PÓS-AC: Janela de aproveitamento encerrada.");
  }
  // SIFÃO PÓS-AC: Inicia já durante os minutos finais do AC (Tempo Extra Após Meta) e continua após desligar
  bool emPosMetaAc = (acOperando && modoRefrigeracaoAtivo && tempoExtraRefrigeracaoMs > 0 && tempoAlvoAtingido > 0);
  bool aproveitandoArGelado = (!acOperando && emJanelaSifaoPosAc) || (emPosMetaAc && tempoSifaoPosAcMs > 0);

  // Persiste na Flash NVS apenas em mudanças reais de estado com RTC válido (protege pós-AC/meta contra micro-reset)
  bool acAtivoDesejado = (modoRefrigeracaoAtivo && modoAr != AR_FORCADA_OFF && !corteCongelaAtivo);
  bool acMetaDesejado = (acAtivoDesejado && tempoExtraRefrigeracaoMs > 0 && tempoAlvoAtingido > 0);
  bool sifPosDesejado = (!acOperando && emJanelaSifaoPosAc);
  if (acAtivoDesejado != acAtivoSalvoNvs || acMetaDesejado != acMetaSalvoNvs || sifPosDesejado != sifPosSalvoNvs) {
    prefs.begin("grow", false);
    if (acAtivoDesejado != acAtivoSalvoNvs) {
      if (acAtivoDesejado && rtcValido) {
        prefs.putBool("ac_ativo", true);
        prefs.putUInt("ac_ini_ts", (uint32_t)rtcAgoraSec);
        acAtivoSalvoNvs = true;
      } else if (!acAtivoDesejado) {
        prefs.putBool("ac_ativo", false);
        prefs.putUInt("ac_ini_ts", 0);
        acAtivoSalvoNvs = false;
      }
    }
    if (acMetaDesejado != acMetaSalvoNvs) {
      if (acMetaDesejado && rtcValido) {
        prefs.putUInt("ac_meta_ts", (uint32_t)rtcAgoraSec);
        acMetaSalvoNvs = true;
      } else if (!acMetaDesejado) {
        prefs.putUInt("ac_meta_ts", 0);
        acMetaSalvoNvs = false;
      }
    }
    if (sifPosDesejado != sifPosSalvoNvs) {
      if (sifPosDesejado && rtcValido && janelaSifaoPosAcAte > agora) {
        uint32_t fimSifSec = (uint32_t)rtcAgoraSec + (uint32_t)((janelaSifaoPosAcAte - agora + 500UL) / 1000UL);
        prefs.putUInt("sif_pos_ts", fimSifSec);
        sifPosSalvoNvs = true;
      } else if (!sifPosDesejado) {
        prefs.putUInt("sif_pos_ts", 0);
        sifPosSalvoNvs = false;
      }
    }
    prefs.end();
  }

  float deltaEntrada = tempDeltaArExt;
  float deltaSaida = min(tempDeltaArExt, tempDeltaSaidaExt);
  bool sensoresFrioOk = (sensorExtOk && tempExt > -40.0f);

  if (!sensoresFrioOk || !aproveitandoArGelado || tempInt <= tempSifaoMin) {
    // Apenas pausa a injeção abaixo do piso sem destruir a janela Pós-AC configurada
    injecaoFriaTermoOk = false;
  } else if (tempExt <= (tempInt + 0.2f)) {
    // Na janela Pós-AC o quarto acabou de ser resfriado: garante os minutos configurados mesmo se o delta já for pequeno
    injecaoFriaTermoOk = true;
  } else if (tempExt >= (tempInt + 0.6f)) {
    injecaoFriaTermoOk = false;
  }

  // GUARDA DINÂMICA DE UMIDADE NO SIFÃO:
  // Desce até umidGuardaCorte (ex: 90%), pausa exaustor e força névoa até igualar à Umidade Alvo (ou valor manual).
  float alvoUmid = (pf.umidMin > 0) ? pf.umidMin : 99.0f;
  float alvoRetornoCfg = umidRetornoSeguirAlvo ? alvoUmid : umidGuardaRetorno;
  float limiarCorteUmid = umidGuardaCorte;
  float limiarRetornoUmid = max(umidGuardaCorte, alvoRetornoCfg);

  if (!aproveitandoArGelado) {
    if (humInt >= limiarCorteUmid) guardaUmidadeOk = true;
  } else if (humInt < limiarCorteUmid) {
    guardaUmidadeOk = false;
  } else if (humInt >= limiarRetornoUmid || humInt >= 99.5f) {
    guardaUmidadeOk = true;
  }

  sifaoExaustAtivo = false;
  sifaoPosAcAtivo = emJanelaSifaoPosAc;
  sifaoRehidratando = false;

  if (aproveitandoArGelado && injecaoFriaTermoOk) {
    if (guardaUmidadeOk) {
      releExaustExt = true; // Onda fria: injeta o ar novo resfriado
      sifaoExaustAtivo = true;
    } else {
      sifaoRehidratando = true; // Onda de névoa: pausa Sifão (sem bloquear FAE programado) para recuperar umidade até o alvo
    }
  }

  // --- CIRCULACAO INTERNA DINAMICA & VENTO INTERNO COM NEVOA ---
  // Gira o ar internamente para evitar bolsões de CO2 pesado e, se configurado, injeta névoa viva.
  bool brisaUmidificadora = false;
  if (!releVentoInt) {
    if (pf.ventoOnMs > 0) {
      if (pf.ventoOffMs == 0) {
        releVentoInt = true;  // 100% contínuo
        if (pf.ventoComUmid) brisaUmidificadora = true;
      } else {
        unsigned long cicloVento = pf.ventoOnMs + pf.ventoOffMs;
        if (cicloVento > 0) {
          unsigned long momentoVento = agora % cicloVento;
          time_t tnow;
          time(&tnow);
          if (tnow > 1600000000) {
            momentoVento = (tnow % (cicloVento / 1000)) * 1000;
          }
          if (momentoVento < pf.ventoOnMs) {
            releVentoInt = true;
            if (pf.ventoComUmid) brisaUmidificadora = true;
          }
        }
      }
    }
  }

  // CONTROLE DE UMIDADE ALVO ÚNICA:
  static bool umidificadorHisterese = false;
  if (humInt < alvoUmid) {
    umidificadorHisterese = true;
  } else if (humInt >= (alvoUmid + 0.5) || humInt >= 99.5) {
    umidificadorHisterese = false;
  }

  bool querLigarUmid = umidificadorHisterese;
  // Automação "Névoa na Brisa": se ativada no painel, liga o umidificador junto ao vento interno
  // mesmo que a umidade já tenha atingido o alvo/teto (bloqueado apenas se exaustor estiver aberto).
  if (brisaUmidificadora) {
    querLigarUmid = true;
  }
  // Se a guarda de umidade pausou o Sifão de Ar Frio, força reidratação imediata até o limiar de retorno
  if (aproveitandoArGelado && !guardaUmidadeOk) {
    querLigarUmid = true;
  }

  if (querLigarUmid) {
    releUmidific = true;
  } else {
    releUmidific = false;
  }

  // PRÉ-RESFRIAMENTO EVAPORATIVO (antes do AC):
  // Utiliza circulação interna vigorosa e névoa fresca para perda latente térmica dentro da estufa,
  // SEM abrir o exaustor externo (evita esvaziar a umidade e elimina qualquer pulso espúrio de exaustão).
  if (evapAtivo && !acOperando) {
    releVentoInt = true;
    if (humInt < 99.0f) {
      releUmidific = true;
    }
  }

  // BLOQUEIO CONTRA DESPERDÍCIO (EXAUSTOR):
  // Sempre que o exaustor estiver ligado (FAE programado, Sifão ou Pós-AC), não injeta névoa nem liga ventilador interno
  if (releExaustExt) {
    releUmidific = false;
    releVentoInt = false;
  }

  if (releUmidific) releVentoInt = true;

  // PROTEÇÃO ANTI-QUEIMA (FALTA D'ÁGUA) REMOVIDA A PEDIDO DO USUÁRIO.
  // O sistema não vai mais contar o tempo de umidificação nem disparar alarme.

  if (modoLuz == LUZ_AUTO) {
    static int confirmacoesNoite = lastReleLuz ? 3 : 0;
    if (horaValida && (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA)) {
      // NTP/RTC sincronizado: se já estava acesa antes do reboot, mantém acesa sem piscar
      if (lastReleLuz && confirmacoesNoite < 3) confirmacoesNoite = 3;
      confirmacoesNoite++;
      if (confirmacoesNoite >= 3) {
        releLuz = true;
      } else {
        releLuz = lastReleLuz;
      }
    } else if (horaValida) {
      // NTP sincronizado: horário diurno — desliga
      confirmacoesNoite = 0;
      releLuz = false;
    } else {
      // Sem NTP e sem RTC: mantém exatamente o último estado conhecido antes do reboot (fallback 12h ON / 12h OFF)
      confirmacoesNoite = 0;
      const unsigned long CICLO_12H_MS = 12UL * 3600UL * 1000UL;
      unsigned long tempoNoFallback = millis() - fallbackLuzUltimaInversao;
      if (tempoNoFallback >= CICLO_12H_MS) {
        fallbackLuzLigada = !fallbackLuzLigada;
        fallbackLuzUltimaInversao = millis();
        Serial.printf("[LUZ FALLBACK] NTP ausente — alternando ciclo para %s\n", fallbackLuzLigada ? "LIGADA" : "DESLIGADA");
      }
      releLuz = fallbackLuzLigada;
    }
  }
}

void aplicarSeguranca() {
  // BLINDAGEM MODO STANDBY:
  // Em Standby, rigorosamente NENHUM atuador automático opera.
  // Apenas aceita operação se Luz ou Ar estiverem explicitamente em modo MANUAL FORÇADO LIGADO.
  if (faseAtual == FASE_STANDBY) {
    releUmidific = false;
    releVentoInt = false;
    releExaustExt = false;
    if (modoLuz != LUZ_FORCADA_ON) releLuz = false;
    if (modoAr != AR_FORCADA_ON) releArCond = false;
  }

  if (modoLuz == LUZ_FORCADA_ON) releLuz = true;
  if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
  if (modoAr == AR_FORCADA_ON) releArCond = true;
  if (modoAr == AR_FORCADA_OFF) releArCond = false;
  // if (modoVentoExt == VENTO_EXT_FORCADA_ON) releVentoExt = true;
  // if (modoVentoExt == VENTO_EXT_FORCADA_OFF) releVentoExt = false;
  if (tempInt >= tempCorteLuz) {
    releLuz = false;
    Serial.printf("🔥 SEGURANCA: Corte Termico da LUZ ativado! (%.1f°C >= %.1f°C)\n", tempInt, tempCorteLuz);
  }
  // TRAVA DE SEGURANÇA ANTI-CONGELAMENTO (ANTI-FREEZING GUARD):
  // Se a temperatura interna cair abaixo de tempMinCongelamento (ex: 15.0°C),
  // desliga o Ar Condicionado imediatamente, mesmo se estiver forçado manual!
  if (tempInt <= tempMinCongelamento && sensorIntOk) {
    releArCond = false;
    Serial.printf("❄️🛑 SEGURANÇA: Corte Térmico Anti-Congelamento do Ar ativado! (Temp %.1f°C <= %.1f°C)\n", tempInt, tempMinCongelamento);
  }
  if (tempInt >= TEMP_CRITICA) { Serial.println("⚠️ SEGURANCA: Temperatura critica atingida!"); }
}

// (DASHBOARD WEB LOCAL OMITIDO AQUI PARA ECONOMIA DE MEMORIA - MAS CONTINUA FUNCIONANDO)
void webRoot() {
  server.send(200, "text/plain", "Grow IA - Dashboard mudou-se para a Nuvem!");
}
void webApiCmd() {
  if (server.hasArg("f")) {
    String v = server.arg("f");
    FaseCultivo nova = faseAtual;
    if (v == "0") nova = FASE_STANDBY;
    else if (v == "P") nova = FASE_PINANDO;
    else if (v == "F") nova = FASE_FRUTIFICACAO;
    else if (v == "D") nova = FASE_SECAGEM;
    setNovaFase(nova);
  }
  if (server.hasArg("l")) {
    if (modoLuz == LUZ_AUTO) modoLuz = LUZ_FORCADA_ON;
    else if (modoLuz == LUZ_FORCADA_ON) modoLuz = LUZ_FORCADA_OFF;
    else modoLuz = LUZ_AUTO;
    prefs.begin("grow", false);
    prefs.putInt("modoLuz", (int)modoLuz);
    prefs.end();
  }

  server.send(200, "text/plain", "OK");
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  // 1. RESTAURAÇÃO INSTANTÂNEA PÓS-RESET / QUEDA DE ENERGIA (Milissegundo Zero)
  // Carrega o estado salvo na memória Flash ANTES de qualquer delay ou conexão Wi-Fi,
  // garantindo que a Luz e as configurações continuem exatamente como estavam sem piscar!
  prefs.begin("grow", false);
  int faseSalva = prefs.getInt("fase", (int)FASE_STANDBY);
  faseAtual = faseValida(faseSalva) ? (FaseCultivo)faseSalva : FASE_STANDBY;
  int modoSalvo = prefs.getInt("modoLuz", (int)LUZ_AUTO);
  modoLuz = (modoSalvo >= 0 && modoSalvo <= 2) ? (ModoLuz)modoSalvo : LUZ_AUTO;
  int modoArSalvo = prefs.getInt("modoAr", (int)AR_AUTO);
  modoAr = (modoArSalvo >= 0 && modoArSalvo <= 2) ? (ModoAr)modoArSalvo : AR_AUTO;
  inicioFaseTempo = prefs.getUInt("inicio", 0);
  fwAtual = prefs.getUInt("fw_ver", 0);
  bool luzSalvaNVS = prefs.getBool("r_luz", false);
  uint32_t ultTsSalvo = prefs.getUInt("ult_ts", 0);

  // Limpeza preventiva de chaves fantasmas de falta d'água legadas na memória Flash NVS
  if (prefs.isKey("sem_agua")) prefs.remove("sem_agua");
  if (prefs.isKey("umid_acum")) prefs.remove("umid_acum");

  // Carrega Horimetro
  segLuzTotal = prefs.getUInt("h_luz", 0);
  segUmidTotal = prefs.getUInt("h_umid", 0);
  segVentoTotal = prefs.getUInt("h_vento", 0);
  segExaustTotal = prefs.getUInt("h_exaust", 0);

  // Carrega Travas de Segurança Térmica e Climatização NVS
  tempMinCongelamento = prefs.getFloat("tCongela", 15.0f);
  tempHistereseAr = prefs.getFloat("tHisterAr", 1.0f);
  tempoExtraRefrigeracaoMs = (unsigned long)prefs.getUInt("tPosMeta", 5) * 60000UL;
  maxRunContinuoArMs = (unsigned long)prefs.getUInt("tMaxRun", 45) * 60000UL;
  tempoSifaoPosAcMs = (unsigned long)prefs.getUInt("tSifaoPosAc", 15) * 60000UL;
  tempCorteLuz = prefs.getFloat("tCorteLuz", 34.0f);
  tempDeltaArExt = prefs.getFloat("tDeltaExt", 0.4f);
  tempDeltaSaidaExt = min(tempDeltaArExt, prefs.getFloat("tDeltaSaida", 0.1f));
  tempSifaoMin = prefs.getFloat("tSifaoMin", 22.0f);
  umidGuardaCorte = prefs.getFloat("uGuardaCorte", 90.0f);
  umidRetornoSeguirAlvo = prefs.getBool("uRetAlvo", true);
  umidGuardaRetorno = prefs.getFloat("uGuardaRet", 99.0f);
  if (umidGuardaRetorno < umidGuardaCorte) umidGuardaRetorno = umidGuardaCorte;
  tempoEvapPreAcMs = 0UL; // Pré-resfriamento evaporativo desativado definitivamente
  tempEvapAntecipa = constrain(prefs.getFloat("tEvapAnt", 0.3f), 0.0f, 1.5f);
  evapCooldownMs = (unsigned long)max((uint32_t)10, min((uint32_t)180, prefs.getUInt("tEvapCool", 45))) * 60000UL;
  prefs.end();

  if (modoLuz == LUZ_FORCADA_ON) luzSalvaNVS = true;
  else if (modoLuz == LUZ_FORCADA_OFF) luzSalvaNVS = false;

  releLuz = luzSalvaNVS;
  lastReleLuz = luzSalvaNVS;
  fallbackLuzLigada = luzSalvaNVS;

  // Inicializa pinos dos relés já preservando o estado real da Luz (LOW = Ligado, HIGH = Desligado para relés SSR active low)
  pinMode(PIN_RELE_LUZ, OUTPUT);
  digitalWrite(PIN_RELE_LUZ, lastReleLuz ? LOW : HIGH);
  pinMode(PIN_RELE_UMIDIFIC, OUTPUT);
  digitalWrite(PIN_RELE_UMIDIFIC, HIGH);
  pinMode(PIN_RELE_VENTO_INT, OUTPUT);
  digitalWrite(PIN_RELE_VENTO_INT, (faseAtual == FASE_SECAGEM) ? LOW : HIGH);
  lastReleVento = (faseAtual == FASE_SECAGEM);
  releVentoInt = lastReleVento;
  pinMode(PIN_RELE_EXAUST_EXT, OUTPUT);
  digitalWrite(PIN_RELE_EXAUST_EXT, (faseAtual == FASE_SECAGEM) ? LOW : HIGH);
  lastReleExaust = (faseAtual == FASE_SECAGEM);
  releExaustExt = lastReleExaust;
  pinMode(PIN_RELE_AR_COND, OUTPUT);
  digitalWrite(PIN_RELE_AR_COND, RELE_AR_NIVEL_DESLIGADO);
  lastReleArCond = false;
  releArCond = false;
  // pinMode(PIN_RELE_VENTO_EXT, OUTPUT); // (Comentado: pronto para upgrade com relé duplo)
  // digitalWrite(PIN_RELE_VENTO_EXT, HIGH);

  Serial.begin(115200);
  delay(1500);
  bootTime = millis();
  fallbackLuzUltimaInversao = bootTime;
#if defined(CONFIG_IDF_TARGET_ESP32S3) || defined(ARDUINO_ESP32S3_DEV)
  Serial.println("\n=== GROW IA v4.0 (ESP32-S3 DUAL USB-C) ===");
#else
  Serial.println("\n=== GROW IA v4.0 (ESP32-C3 SUPERMINI) ===");
#endif

  if (!LittleFS.begin(true)) Serial.println("[ERRO] LittleFS");
  else Serial.println("[OK] LittleFS (Datalogger)");

  carregarPerfisNVS();

  // Configura fuso horário e restaura relógio interno imediatamente se houve apagão total sem internet
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFF, NTP_SERVER);
  time_t agoraRtc;
  time(&agoraRtc);
  if (agoraRtc < 1700000000 && ultTsSalvo > 1700000000) {
    struct timeval tv = { .tv_sec = (time_t)ultTsSalvo, .tv_usec = 0 };
    settimeofday(&tv, NULL);
    Serial.println("🕒 [RTC RESTORE] Relógio restaurado da memória Flash NVS pós-apagão!");
  }
  struct tm tiBoot = { 0 };
  if (getLocalTime(&tiBoot, 10) && (tiBoot.tm_year + 1900 >= 2024)) {
    horaValida = true;
    horaAtual = tiBoot.tm_hour;
  }

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(50);  // Timeout de 50ms no barramento I2C contra travamentos elétricos
  if (sht30.begin(0x44)) {
    sht30.heater(false);
    Serial.println("[OK] SHT30");
  } else {
    statusSis = SIS_ERRO_SENSOR;
  }
  dht.begin();
  Serial.println("[OK] DHT11");
  // ANTI-BRICK AVANCADO (Deteccao de Bootloop)
  prefs.begin("grow", false);
  if (prefs.getBool("ota_test", false)) {
    int fails = prefs.getInt("ota_boot_fails", 0) + 1;
    prefs.putInt("ota_boot_fails", fails);
    if (fails > 2) {
      Serial.println("🚨 [ANTI-BRICK] Bootloop detectado! Revertendo para firmware antigo...");
      uint32_t badVer = prefs.getUInt("ota_tentativa", 0);
      if (badVer > 0) prefs.putUInt("ota_bad_ver", badVer);
      prefs.putBool("ota_test", false);
      prefs.putBool("ota_falhou", true);
      prefs.putInt("ota_boot_fails", 0);
      prefs.end();
      if (Update.canRollBack()) Update.rollBack();
      delay(500);
      ESP.restart();
    }
  }
  prefs.end();

  WiFi.persistent(true);
  WiFi.setAutoReconnect(true);
  wm.setConnectTimeout(15);
  wm.setConfigPortalTimeout(180);  // Fecha AP de setup após 3 min para não bloquear reconexão automática pós-apagão
  wm.setConfigPortalBlocking(false);
  wm.autoConnect("GROW_SETUP");

  if (MDNS.begin("grow")) Serial.println("[OK] mDNS");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFF, NTP_SERVER);

  ArduinoOTA.setHostname("grow");
  ArduinoOTA.begin();

  server.on("/", webRoot);
  server.on("/api/cmd", webApiCmd);
  server.begin();

  // Inicializa proteção por hardware (Cão de Guarda e Botão Físico se habilitado)
#if (HABILITAR_BOTAO_RESET == 1)
  pinMode(PIN_BOOT, INPUT_PULLUP);
#endif
  ultimoSuspiro = millis();
  xTaskCreate(watchdogTask, "WDT", 4096, NULL, 1, &wdtTask);
}

// ============================================================
//  LOOP
// ============================================================
void loop() {
  unsigned long agora = millis();
  ultimoSuspiro = agora;  // Alimenta o cão de guarda

#if (HABILITAR_BOTAO_RESET == 1)
  // Botão de Factory Reset (Segurar por 5 segundos limpa a memória inteira)
  static unsigned long tempoBotaoPressionado = 0;
  if (digitalRead(PIN_BOOT) == LOW) {
    if (tempoBotaoPressionado == 0) tempoBotaoPressionado = agora;
    else if (agora - tempoBotaoPressionado > 5000) {
      Serial.println("[RESET] Botao BOOT segurado por 5s! Formatando sistema...");
      rgbLedWrite(RGB_BUILTIN, 255, 0, 0);
      delay(1000);         // Vermelho forte
      wm.resetSettings();  // Limpa as senhas de Wi-Fi
      prefs.begin("grow", false);
      prefs.clear();
      prefs.end();
      prefs.begin("grow_perfis", false);
      prefs.clear();
      prefs.end();
      LittleFS.format();  // Formata memoria de logs
      ESP.restart();      // Reinicia novinho em folha
    }
  } else {
    tempoBotaoPressionado = 0;
  }
#endif

  // Anti-Brick: Se após 5 minutos do boot de teste não validar a conexão, reverte
  static bool antiBrickVerificado = false;
  if (!antiBrickVerificado && (agora - bootTime > 300000UL)) {
    antiBrickVerificado = true;
    prefs.begin("grow", true);
    bool emTeste = prefs.getBool("ota_test", false);
    prefs.end();
    if (emTeste) {
      Serial.println("🚨 FATAL: Novo firmware não respondeu à nuvem em 5 mins! Restaurando versão anterior...");
      prefs.begin("grow", false);
      uint32_t badVer = prefs.getUInt("ota_tentativa", 0);
      if (badVer > 0) prefs.putUInt("ota_bad_ver", badVer);
      prefs.putBool("ota_test", false);
      prefs.putBool("ota_falhou", true);
      prefs.putInt("ota_boot_fails", 0);
      prefs.end();
      if (Update.canRollBack()) Update.rollBack();
      delay(500);
      ESP.restart();
    }
  }

  wm.process();
  server.handleClient();
  ArduinoOTA.handle();

  // Auto-Reconnect Passivo Blindado (100% imune ao rollover de 49.7 dias do millis):
  // Se o roteador demorou a voltar após queda de energia ou caiu durante a operação, reconecta a cada 60s
  static unsigned long ultimaTentativaWifi = 0;
  if (WiFi.status() != WL_CONNECTED && (agora - ultimaTentativaWifi >= 60000UL)) {
    ultimaTentativaWifi = agora;
    Serial.println("[WIFI] Desconectado. Forçando reconexão automática em background...");
    WiFi.reconnect();
  }

  if (agora - ultimaLeitura >= 2000) {
    ultimaLeitura = agora;
    float tI = 0.0f, hI = 0.0f;
    bool leuOk = sht30.readBoth(&tI, &hI);

    // Filtro de Sanidade Físico para SHT30 (Sensor Crítico Interno)
    // Permite leitura até 108% para aceitar leituras no topo da escala e faz clamp em 100.0%
    bool shtFisicoOk = leuOk && !isnan(tI) && !isnan(hI) && tI > -10.0f && tI < 60.0f && hI >= 0.0f && hI <= 108.0f;
    static int shtFalhasFisicas = 0;
    if (shtFisicoOk) {
      if (hI > 100.0f) hI = 100.0f;
      shtFalhasFisicas = 0;
      if (!sensorIntOk) {
        sensorIntOk = true;
        Serial.println("[RECUPERACAO] SHT30 voltou a responder!");
      }
      atualizarFiltroInt(tI, hI);
      atualizarMinMax();
    } else {
      shtFalhasFisicas++;
      if (shtFalhasFisicas >= 6) {  // 12s de falha contínua
        sensorIntOk = false;
        // Tentativa de recuperação física do barramento I2C a cada 12s
        if (shtFalhasFisicas % 6 == 0) {
          recuperarBarramentoI2C();
        }
      }
    }

    // Leitura e Filtro Resiliente para DHT11 (Sensor de Sala/Ambiente)
    static unsigned long ultimaLeituraDHT = 0;
    if (agora - ultimaLeituraDHT >= 3000 || ultimaLeituraDHT == 0) {
      ultimaLeituraDHT = agora;
      float tE = dht.readTemperature(), hE = dht.readHumidity();
      bool dhtFisicoOk = !isnan(tE) && !isnan(hE) && tE != 0.0 && hE != 0.0 && tE > -10.0 && tE < 60.0 && hE > 0.0 && hE <= 100.0;

      static int dhtFalhasFisicas = 0;
      static int dhtSpikesConsecutivos = 0;
      if (dhtFisicoOk) {
        // Anti-Spike: descarta picos isolados de ruído elétrico, mas aceita mudança real se persistir por 3 leituras (~9s)
        if (tempExt != -99.0 && (abs(tE - tempExt) > 6.0 || abs(hE - humExt) > 20.0)) {
          dhtSpikesConsecutivos++;
          if (dhtSpikesConsecutivos >= 3) {
            dhtSpikesConsecutivos = 0;
            dhtFalhasFisicas = 0;
            sensorExtOk = true;
            atualizarFiltroExt(tE, hE);
          }
        } else {
          dhtSpikesConsecutivos = 0;
          dhtFalhasFisicas = 0;
          sensorExtOk = true;
          atualizarFiltroExt(tE, hE);
        }
      } else {
        dhtFalhasFisicas++;
        if (dhtFalhasFisicas >= 25) {  // 75 segundos de falha contínua para assumir desconexão
          sensorExtOk = false;
        }
      }
    }

    struct tm ti = { 0 };
    if (getLocalTime(&ti, 25)) {
      if (ti.tm_year + 1900 >= 2024 && ti.tm_hour >= 0 && ti.tm_hour <= 23) {
        static int confirmacoesSaltoHora = 0;
        static int ultimaHoraSalvaNVS = -1;
        // Anti-Jitter Inteligente: Rejeita ruído isolado de 1 ciclo, mas aceita ajuste real do NTP se persistir por 3 leituras (6s)
        if (!horaValida || horaAtual < 0 || abs(ti.tm_hour - horaAtual) <= 1 || (horaAtual == 23 && ti.tm_hour == 0) || (horaAtual == 0 && ti.tm_hour == 23)) {
          confirmacoesSaltoHora = 0;
          horaValida = true;
          horaAtual = ti.tm_hour;
        } else {
          confirmacoesSaltoHora++;
          if (confirmacoesSaltoHora >= 3) {
            confirmacoesSaltoHora = 0;
            horaValida = true;
            horaAtual = ti.tm_hour;
          }
        }
        // Faz backup do relógio na Flash NVS na virada de cada hora cheia
        if (horaValida && horaAtual != ultimaHoraSalvaNVS) {
          ultimaHoraSalvaNVS = horaAtual;
          time_t tsCheck;
          time(&tsCheck);
          if (tsCheck > 1700000000) {
            prefs.begin("grow", false);
            prefs.putUInt("ult_ts", (uint32_t)tsCheck);
            prefs.end();
          }
        }
      } else {
        horaValida = false;  // RTC foi resetado para 1970 devido a Brownout Reset (Kickback)!
      }
    }
    if (horaValida && inicioFaseTempo == 0 && faseAtual != FASE_STANDBY) {
      time_t stamp;
      time(&stamp);
      if (stamp > 1600000000) {
        inicioFaseTempo = stamp;
        prefs.begin("grow", false);
        prefs.putUInt("inicio", (uint32_t)inicioFaseTempo);
        prefs.end();
      }
    }

    if (!sensorIntOk) statusSis = SIS_ERRO_SENSOR;
    else if (WiFi.status() != WL_CONNECTED) statusSis = SIS_SEM_WIFI;
    else statusSis = SIS_OK;

    if (sensorIntOk) {
      executarMotor(agora);
      aplicarSeguranca();
    } else {
      // FALHA CRÍTICA DO SENSOR SHT30:
      releUmidific = false;  // Não injeta água as cegas
      if (faseAtual != FASE_STANDBY) {
        releVentoInt = true;   // Mantém ventilação interna durante cultivo ativo
      } else {
        releVentoInt = false;  // Em Standby, fica rigorosamente desligado
      }

      // Em modo cego, executa o FAE (Renovação de ar) baseado no tempo para os cogumelos não sufocarem
      if (faseAtual != FASE_STANDBY && faseAtual != FASE_SECAGEM) {
        PerfilClimatico pf = obterPerfil(faseAtual);
        if (pf.faeOnMs == 0) {
          releExaustExt = false;
        } else if (pf.faeOffMs == 0) {
          releExaustExt = true;
        } else {
          unsigned long cicloFAE = pf.faeOnMs + pf.faeOffMs;
          releExaustExt = ((agora % cicloFAE) < pf.faeOnMs);
        }
      } else {
        releExaustExt = (faseAtual == FASE_SECAGEM);
      }

      // Luz continua rodando independentemente do clima
      if (modoLuz == LUZ_AUTO) {
        static int confirmacoesNoiteOff = lastReleLuz ? 3 : 0;
        if (horaValida && (horaAtual >= LUZ_HORA_LIGA || horaAtual < LUZ_HORA_DESLIGA)) {
          if (lastReleLuz && confirmacoesNoiteOff < 3) confirmacoesNoiteOff = 3;
          confirmacoesNoiteOff++;
          if (confirmacoesNoiteOff >= 3) releLuz = true;
          else releLuz = lastReleLuz;
        } else if (horaValida) {
          confirmacoesNoiteOff = 0;
          releLuz = false;
        } else {
          // Fallback 12/12 sem NTP (mantém o estado salvo antes do reboot e alterna a cada 12h)
          confirmacoesNoiteOff = 0;
          const unsigned long CICLO_12H_MS = 12UL * 3600UL * 1000UL;
          if (millis() - fallbackLuzUltimaInversao >= CICLO_12H_MS) {
            fallbackLuzLigada = !fallbackLuzLigada;
            fallbackLuzUltimaInversao = millis();
            Serial.printf("[LUZ FALLBACK] NTP ausente (modo sem SHT30) — alternando ciclo para %s\n", fallbackLuzLigada ? "LIGADA" : "DESLIGADA");
          }
          releLuz = fallbackLuzLigada;
        }
      }
      if (modoLuz == LUZ_FORCADA_ON) releLuz = true;
      if (modoLuz == LUZ_FORCADA_OFF) releLuz = false;
    }

    aplicarReles();

    // HORIMETRO: Acumula tempo de uso de cada componente a cada ciclo (aprox 2s)
    // Avança em múltiplos exatos de 1000ms para não perder frações de segundo ao longo dos dias
    if (ultimoTickHorimetro == 0) ultimoTickHorimetro = agora;
    unsigned long deltaHorimetro = (agora - ultimoTickHorimetro) / 1000;
    if (deltaHorimetro >= 1) {
      ultimoTickHorimetro += deltaHorimetro * 1000UL;
      if (lastReleLuz) segLuzTotal += deltaHorimetro;
      if (lastReleUmidific) segUmidTotal += deltaHorimetro;
      if (lastReleVento) segVentoTotal += deltaHorimetro;
      if (lastReleExaust) segExaustTotal += deltaHorimetro;

      // Salva o horimetro e o relógio na memoria Flash a cada 15 minutos de execucao
      if (agora - ultimoSaveHorimetro >= 900000UL) {
        ultimoSaveHorimetro = agora;
        prefs.begin("grow", false);
        prefs.putUInt("h_luz", segLuzTotal);
        prefs.putUInt("h_umid", segUmidTotal);
        prefs.putUInt("h_vento", segVentoTotal);
        prefs.putUInt("h_exaust", segExaustTotal);
        prefs.putBool("r_luz", lastReleLuz);
        time_t tsNow;
        time(&tsNow);
        if (tsNow > 1700000000) prefs.putUInt("ult_ts", (uint32_t)tsNow);
        prefs.end();
      }
    }

    // LOG PERIÓDICO (A cada 10 segundos)
    if (agora - ultimoLogSerial >= 10000) {
      ultimoLogSerial = agora;
      Serial.printf("[STATUS] In: %.1fC %.1f%% | Ex: %.1fC %.1f%% | Fase: %s | Luz: %s (NTP:%s)\n",
                    tempInt, humInt, tempExt, humExt, nomeFase((int)faseAtual), nomeModoLuz(), horaValida ? "OK" : "FALLBACK-12/12");
      Serial.printf("[HORAS USO] Luz: %.1fh | Umid: %.1fh | Vento: %.1fh | Exaust: %.1fh\n",
                    segLuzTotal / 3600.0, segUmidTotal / 3600.0, segVentoTotal / 3600.0, segExaustTotal / 3600.0);
      
      // LOG DE EVENTOS DETALHADOS (Por que cada relé está ligado?)
      PerfilClimatico pf = obterPerfil(faseAtual);
      String evtUmid = "Desligado", evtVento = "Desligado", evtExaust = "Desligado";
      if (releExaustExt) {
        if (sifaoExaustAtivo) evtExaust = "Sifão Pós-AC (Ar Frio)";
        else evtExaust = faeLigado ? "Renovação Ar (FAE)" : "Secagem/Outro";
      }
      
      if (releVentoInt) {
        if (faeLigado) evtVento = "Junto com FAE";
        else if (sifaoRehidratando) evtVento = "Reidratação Sifão";
        else if (evapPreAcAtivo) evtVento = "Pré-Resfriamento Evaporativo";
        else evtVento = "Brisa Interna Programada";
      }
      
      if (releUmidific) {
        if (sifaoRehidratando) evtUmid = "Onda Névoa Sifão (Subindo até alvo)";
        else if (evapPreAcAtivo) evtUmid = "Evaporação (Névoa Fria)";
        else if (evtVento == "Brisa Interna Programada") evtUmid = "Névoa na Brisa";
        else if (humInt < pf.umidMin) evtUmid = "Histerese (Subindo até alvo)";
        else evtUmid = "Estabilizando Alvo";
      }
      
      Serial.printf("[EVENTOS ATUAIS] Umidificador: [%s] | Ventilador: [%s] | Exaustor: [%s]\n", 
                    evtUmid.c_str(), evtVento.c_str(), evtExaust.c_str());
    }

    // ROTINA DE NUVEM
    enviarNuvem(agora);
  }



  // Dashboard Visual LED RGB (Feedback de Status)
  static unsigned long ultimoLed = 0;
  if (agora - ultimoLed >= 50) {
    ultimoLed = agora;
    if (statusSis == SIS_ERRO_SENSOR) {
      rgbLedWrite(RGB_BUILTIN, LED_BRILHO, 0, 0);  // VERMELHO FIXO (Sensor SHT30 Morto/Desconectado)
    } else if (statusSis == SIS_SEM_WIFI) {
      rgbLedWrite(RGB_BUILTIN, (agora % 1000 < 500) ? LED_BRILHO : 0, 0, (agora % 1000 < 500) ? LED_BRILHO : 0);  // MAGENTA/ROXO PISCANDO (Modo Offline/Sem Wi-Fi)
    } else if (faseAtual == FASE_STANDBY) {
      rgbLedWrite(RGB_BUILTIN, (agora % 4000 < 2000) ? LED_BRILHO / 2 : 0, (agora % 4000 < 2000) ? LED_BRILHO / 2 : 0, (agora % 4000 < 2000) ? LED_BRILHO / 2 : 0);  // BRANCO SUAVE (Standby)
    } else if (releUmidific) {
      rgbLedWrite(RGB_BUILTIN, 0, 0, LED_BRILHO);  // AZUL FIXO (Injetando Névoa)
    } else if (releExaustExt) {
      rgbLedWrite(RGB_BUILTIN, LED_BRILHO, LED_BRILHO / 2, 0);  // LARANJA FIXO (Trocando Ar / Exaustão)
    } else if (releVentoInt) {
      rgbLedWrite(RGB_BUILTIN, 0, LED_BRILHO, LED_BRILHO);  // CIANO FIXO (Apenas Brisa Interna)
    } else {
      rgbLedWrite(RGB_BUILTIN, 0, (agora % 2000 < 100) ? LED_BRILHO : 0, 0);  // VERDE PISCANDO LENTO (Sistema Saudável e Idle)
    }
  }
}
