#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <DHT.h>
#include <esp32-hal-rgb-led.h>
#include <WiFi.h>

// ==========================================
// CONFIGURAÇÕES DE REDE (WIFI)
// ==========================================
const char* ssid = "NOME_DO_SEU_WIFI";
const char* password = "SENHA_DO_SEU_WIFI";

// ==========================================
// CONFIGURAÇÃO DOS PINOS
// ==========================================

// 1. LED RGB Onboard
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN 8
#endif

// 2. Sensores
#define I2C_SDA     4  // SHT30 (Interno)
#define I2C_SCL     5  // SHT30 (Interno)
#define DHT_PIN     10 // DHT11 (Externo)
#define DHT_TYPE    DHT11

// 3. Relés SSR (Low-Level Trigger)
#define RELE_LUZ        0
#define RELE_VENT_INT   1
#define RELE_UMIDIFIC   3
#define RELE_EXAUST_MAX 6

// ==========================================
// OBJETOS E ESTADOS DO SISTEMA
// ==========================================
Adafruit_SHT31 sht30 = Adafruit_SHT31();
DHT dht(DHT_PIN, DHT_TYPE);

enum SystemState {
  STATE_ERROR,    // Vermelho Piscando (Erro nos sensores)
  STATE_NO_WIFI,  // Azul Piscando (Iniciado, sensores OK, sem internet)
  STATE_OK        // Verde Piscando Rápido/Longo (Tudo OK e conectado)
};
SystemState estadoAtual = STATE_NO_WIFI;

unsigned long tempoAnteriorSensores = 0;
const long intervaloSensores = 2000; // Ler sensores a cada 2 segundos

// Brilho do LED de status (0 a 255) - 20 é bom para não cegar
#define LED_BRIGHTNESS 20 

// ==========================================
// FUNÇÕES DE SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("\n========================================");
  Serial.println("  INICIANDO GROW CONTROLLER             ");
  Serial.println("========================================");

  // --- 1. CONFIGURAÇÃO DOS RELÉS ---
  // Inicia todos DESLIGADOS (HIGH)
  digitalWrite(RELE_LUZ, HIGH);
  digitalWrite(RELE_VENT_INT, HIGH);
  digitalWrite(RELE_UMIDIFIC, HIGH);
  digitalWrite(RELE_EXAUST_MAX, HIGH);

  pinMode(RELE_LUZ, OUTPUT);
  pinMode(RELE_VENT_INT, OUTPUT);
  pinMode(RELE_UMIDIFIC, OUTPUT);
  pinMode(RELE_EXAUST_MAX, OUTPUT);

  // --- 2. CONFIGURAÇÃO I2C E SHT30 ---
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!sht30.begin(0x44)) {
    Serial.println("Erro: Sensor SHT30 (Interno) nao encontrado!");
    estadoAtual = STATE_ERROR;
  } else {
    Serial.println("SHT30 (Interno) OK.");
  }

  // --- 3. CONFIGURAÇÃO DHT11 ---
  dht.begin();
  Serial.println("DHT11 (Externo) OK.");

  // --- 4. INICIAR WIFI (Não-bloqueante) ---
  Serial.print("Conectando ao WiFi...");
  WiFi.begin(ssid, password);
  
  Serial.println("\n========================================\n");
}


// ==========================================
// LOOP PRINCIPAL
// ==========================================
void loop() {
  unsigned long tempoAtual = millis();

  // --- 1. TAREFA: LER SENSORES (A cada 2 seg) ---
  if (tempoAtual - tempoAnteriorSensores >= intervaloSensores) {
    tempoAnteriorSensores = tempoAtual;
    
    float tempExt = dht.readTemperature();
    float humExt = dht.readHumidity();
    float tempInt = sht30.readTemperature();
    float humInt  = sht30.readHumidity();

    bool erroSensores = false;

    if (isnan(tempExt) || isnan(humExt)) {
      Serial.println("ERRO: Falha ao ler DHT11 (Externo)!");
      erroSensores = true;
    }
    if (isnan(tempInt) || isnan(humInt)) {
      Serial.println("ERRO: Falha ao ler SHT30 (Interno)!");
      erroSensores = true;
    }

    // Define o estado do sistema baseado nas leituras e no Wi-Fi
    if (erroSensores) {
      estadoAtual = STATE_ERROR;
    } else if (WiFi.status() != WL_CONNECTED) {
      estadoAtual = STATE_NO_WIFI;
    } else {
      estadoAtual = STATE_OK;
    }

    // Imprime status se tudo estiver lendo bem
    if (!erroSensores) {
      Serial.println("----------------------------------------");
      Serial.printf("EXTERNO: Temp = %.1f C  | Umidade = %.1f %%\n", tempExt, humExt);
      Serial.printf("INTERNO: Temp = %.1f C  | Umidade = %.1f %%\n", tempInt, humInt);
      if (estadoAtual == STATE_OK) {
        Serial.printf("WIFI: Conectado (IP: %s)\n", WiFi.localIP().toString().c_str());
      } else {
        Serial.println("WIFI: Desconectado / Buscando...");
      }
      Serial.println("----------------------------------------\n");
    }
  }

  // --- 2. TAREFA: ATUALIZAR LED DE STATUS (Contínuo) ---
  if (estadoAtual == STATE_ERROR) {
    // Vermelho piscando (500ms ON, 500ms OFF)
    if ((tempoAtual % 1000) < 500) rgbLedWrite(RGB_BUILTIN, LED_BRIGHTNESS, 0, 0);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  } 
  else if (estadoAtual == STATE_NO_WIFI) {
    // Azul piscando (500ms ON, 500ms OFF)
    if ((tempoAtual % 1000) < 500) rgbLedWrite(RGB_BUILTIN, 0, 0, LED_BRIGHTNESS);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  }
  else if (estadoAtual == STATE_OK) {
    // Verde piscando rápido com intervalo longo (50ms ON, 1950ms OFF)
    if ((tempoAtual % 2000) < 50) rgbLedWrite(RGB_BUILTIN, 0, LED_BRIGHTNESS, 0);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  }
}