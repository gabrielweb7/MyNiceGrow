#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <DHT.h>
#include <esp32-hal-rgb-led.h>
#include <WiFi.h>
#include <WiFiManager.h>

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
#define RELE_UMIDIFIC   1
#define RELE_EXAUST_INT 3
#define RELE_EXAUST_EXT 6

// ==========================================
// OBJETOS E ESTADOS DO SISTEMA
// ==========================================
Adafruit_SHT31 sht30 = Adafruit_SHT31();
DHT dht(DHT_PIN, DHT_TYPE);
WiFiManager wm;

enum SystemState {
  STATE_ERROR,    // Vermelho Piscando (Erro nos sensores)
  STATE_NO_WIFI,  // Azul Piscando (Modo AP de configuração / Sem internet)
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
  // Configura os pinos como SAÍDA
  pinMode(RELE_LUZ, OUTPUT);
  pinMode(RELE_UMIDIFIC, OUTPUT);
  pinMode(RELE_EXAUST_INT, OUTPUT);
  pinMode(RELE_EXAUST_EXT, OUTPUT);
  
  // Em módulos SSR Low-Level Trigger, o estado HIGH significa DESLIGADO.
  // Mandamos HIGH imediatamente para garantir que comecem desligados.
  digitalWrite(RELE_LUZ, HIGH);
  digitalWrite(RELE_UMIDIFIC, HIGH);
  digitalWrite(RELE_EXAUST_INT, HIGH);
  digitalWrite(RELE_EXAUST_EXT, HIGH);

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

  // --- 4. INICIAR WIFI MANAGER (Não-bloqueante) ---
  Serial.println("Iniciando WiFiManager...");
  wm.setConfigPortalBlocking(false); // Para o código não travar enquanto aguarda a senha
  
  // Tenta conectar no Wi-Fi salvo. Se não conseguir, cria a rede "GROW_SETUP"
  if(wm.autoConnect("GROW_SETUP")) {
    Serial.println("WiFi ja estava salvo e conectou com sucesso!");
  } else {
    Serial.println("WiFi nao salvo ou falhou. Portal de configuracao criado: GROW_SETUP");
  }
  
  Serial.println("\n========================================\n");
}


// ==========================================
// LOOP PRINCIPAL
// ==========================================
void loop() {
  unsigned long tempoAtual = millis();

  // Processa o WiFiManager sem travar o Arduino
  wm.process();

  // --- 1. TAREFA: LER SENSORES (A cada 2 seg) ---
  if (tempoAtual - tempoAnteriorSensores >= intervaloSensores) {
    tempoAnteriorSensores = tempoAtual;
    
    float tempExt = dht.readTemperature();
    float humExt = dht.readHumidity();
    float tempInt = sht30.readTemperature();
    float humInt  = sht30.readHumidity();

    bool erroSensores = false;

    Serial.println("\n================ PAINEL DO GROW ================");
    
    // Status Externo (DHT11)
    if (isnan(tempExt) || isnan(humExt)) {
      Serial.println("Sensor Externo (DHT11): FALTANDO / DESCONECTADO");
      erroSensores = true;
    } else {
      Serial.printf("Sensor Externo (DHT11): CARREGADO | %.1f C | %.1f %%\n", tempExt, humExt);
    }

    // Status Interno (SHT30)
    if (isnan(tempInt) || isnan(humInt)) {
      Serial.println("Sensor Interno (SHT30): FALTANDO / DESCONECTADO");
      erroSensores = true;
    } else {
      Serial.printf("Sensor Interno (SHT30): CARREGADO | %.1f C | %.1f %%\n", tempInt, humInt);
    }

    Serial.println("------------------------------------------------");
    
    // Status dos Relés (Em módulos SSR Low-Level Trigger, LOW = LIGADO)
    Serial.printf("Rele 1 (Luz):              %s\n", digitalRead(RELE_LUZ) == LOW ? "LIGADO" : "DESLIGADO");
    Serial.printf("Rele 2 (Umidificador):     %s\n", digitalRead(RELE_UMIDIFIC) == LOW ? "LIGADO" : "DESLIGADO");
    Serial.printf("Rele 3 (Exaustor Interno): %s\n", digitalRead(RELE_EXAUST_INT) == LOW ? "LIGADO" : "DESLIGADO");
    Serial.printf("Rele 4 (Exaustor Externo): %s\n", digitalRead(RELE_EXAUST_EXT) == LOW ? "LIGADO" : "DESLIGADO");
    
    Serial.println("------------------------------------------------");

    // Define o estado do sistema baseado nas leituras e no Wi-Fi
    if (erroSensores) {
      estadoAtual = STATE_ERROR;
    } else if (WiFi.status() != WL_CONNECTED) {
      estadoAtual = STATE_NO_WIFI;
      Serial.println("WIFI: Config Portal [GROW_SETUP] - Entre com o celular para configurar!");
    } else {
      estadoAtual = STATE_OK;
      Serial.printf("WIFI: Conectado (IP: %s)\n", WiFi.localIP().toString().c_str());
    }
    
    Serial.println("================================================\n");
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