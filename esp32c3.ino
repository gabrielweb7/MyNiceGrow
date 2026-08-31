#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <DHT.h>
#include <esp32-hal-rgb-led.h>

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
// OBJETOS E VARIÁVEIS GLOBAIS
// ==========================================
Adafruit_SHT31 sht30 = Adafruit_SHT31();
DHT dht(DHT_PIN, DHT_TYPE);

// Variáveis para controle de tempo (Sem usar delay!)
unsigned long tempoAnteriorSensores = 0;
const long intervaloSensores = 2000; // Ler sensores a cada 2 segundos

unsigned long tempoAnteriorLed = 0;
const long intervaloLed = 20; // Atualiza o LED a cada 20ms
float theta = 0; // Variável para o efeito do LED

// ==========================================
// FUNÇÕES DE SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(2000); // Tempo para o USB CDC conectar

  Serial.println("\n========================================");
  Serial.println("  INICIANDO SISTEMA GROW CONTROLLER     ");
  Serial.println("========================================");

  // --- 1. CONFIGURAÇÃO DOS RELÉS ---
  // Importante: Definir como HIGH *antes* do pinMode para evitar que liguem no boot
  // Módulos SSR de 5V costumam ligar em LOW (0V). HIGH mantem eles desligados.
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
  if (!sht30.begin(0x44)) { // Endereço I2C padrão do SHT30 é 0x44 ou 0x45
    Serial.println("Erro: Sensor SHT30 (Interno) nao encontrado! Verifique a fiacao.");
  } else {
    Serial.println("Sensor SHT30 (Interno) inicializado com sucesso.");
  }

  // --- 3. CONFIGURAÇÃO DHT11 ---
  dht.begin();
  Serial.println("Sensor DHT11 (Externo) inicializado.");
  
  Serial.println("========================================\n");
}


// ==========================================
// LOOP PRINCIPAL (NÃO-BLOQUEANTE)
// ==========================================
void loop() {
  unsigned long tempoAtual = millis();

  // 1. TAREFA: LER SENSORES A CADA 2 SEGUNDOS
  if (tempoAtual - tempoAnteriorSensores >= intervaloSensores) {
    tempoAnteriorSensores = tempoAtual;
    
    // Leitura DHT11 (Externo)
    float tempExt = dht.readTemperature();
    float humExt = dht.readHumidity();

    // Leitura SHT30 (Interno)
    float tempInt = sht30.readTemperature();
    float humInt  = sht30.readHumidity();

    // Checa se as leituras falharam
    if (isnan(tempExt) || isnan(humExt)) {
      Serial.println("Falha ao ler do sensor DHT11 (Externo)!");
    }
    if (isnan(tempInt) || isnan(humInt)) {
      Serial.println("Falha ao ler do sensor SHT30 (Interno)!");
    }

    // Imprime os valores no console
    Serial.println("----------------------------------------");
    Serial.printf("EXTERNO (DHT11): Temp = %.1f C  | Umidade = %.1f %%\n", tempExt, humExt);
    Serial.printf("INTERNO (SHT30): Temp = %.1f C  | Umidade = %.1f %%\n", tempInt, humInt);
    Serial.println("----------------------------------------\n");

    // ==============================================================
    // AQUI ENTRARÁ A LÓGICA DOS RELÉS NO FUTURO. Exemplo comentado:
    // ==============================================================
    // if (tempInt > 28.0) {
    //   digitalWrite(RELE_EXAUST_MAX, LOW); // LIGA exaustor se muito quente
    // } else {
    //   digitalWrite(RELE_EXAUST_MAX, HIGH); // DESLIGA
    // }
  }


  // 2. TAREFA: ATUALIZAR EFEITO DO LED CONTINUAMENTE (A cada 20ms)
  if (tempoAtual - tempoAnteriorLed >= intervaloLed) {
    tempoAnteriorLed = tempoAtual;

    theta += 0.02;
    if (theta >= 3.14159 * 2) theta = 0;

    float r_onda = sin(theta);
    float g_onda = sin(theta + (3.14159 / 2));
    float b_onda = sin(theta + 3.14159);

    int r_pwm = map((r_onda * 100), -100, 100, 10, 255);
    int g_pwm = map((g_onda * 100), -100, 100, 0, 100);
    int b_pwm = map((b_onda * 100), -100, 100, 50, 255);

    rgbLedWrite(RGB_BUILTIN, r_pwm, g_pwm, b_pwm);
  }
}