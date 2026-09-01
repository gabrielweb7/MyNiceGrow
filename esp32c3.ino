#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <DHT.h>
#include <esp32-hal-rgb-led.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <time.h>

// ==========================================
// CONFIGURAÇÕES DE RELÓGIO (NTP)
// ==========================================
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -10800; // Horário de Brasília (UTC-3)
const int   daylightOffset_sec = 0;

// ==========================================
// ⚙️ PAINEL DE CONFIGURAÇÕES DO CULTIVO ⚙️
// ==========================================

// Temperaturas (Celsius)
const float TEMP_MINIMA = 25.0;
const float TEMP_ALVO_MAX = 28.5; // Passou disso, tenta esfriar
const float TEMP_CRITICA = 30.0;  // Passou disso, entra em modo emergência
const float TEMP_CORTE_LUZ = 33.0; // Risco de incêndio/Cozimento: Apaga a luz na marra

// Umidade (%)
const float UMIDADE_MINIMA = 88.0;
const float UMIDADE_MAXIMA = 95.0;

// Seguranças e Timers
const unsigned long FAE_TEMPO_ON = 2 * 60 * 1000;   // 2 min de vento
const unsigned long FAE_TEMPO_OFF = 58 * 60 * 1000; // 58 min desligado
unsigned long ultimoCicloFAE = 0;
bool modoFAELigado = false;

// Cão de Guarda do Umidificador (Anti Falta d'água)
const unsigned long TIMEOUT_UMIDIFICADOR = 30 * 60 * 1000; // 30 min max contínuo
unsigned long inicioUmidificacao = 0;
bool alertaFaltaAgua = false;


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

// ==========================================
// MÁQUINA DE ESTADOS - FASES DO CULTIVO (FUNGI)
// ==========================================
enum FaseCultivo {
  SEM_CULTIVO,
  PINANDO,
  FRUTIFICACAO,
  SEGUNDO_FLUSH,
  MODO_SECAGEM
};
FaseCultivo faseAtual = SEM_CULTIVO; // Inicia em modo Standby

String getNomeFase(FaseCultivo fase) {
  switch(fase) {
    case SEM_CULTIVO: return "Sem Cultivo (Standby)";
    case PINANDO: return "Pinando (Inducao)";
    case FRUTIFICACAO: return "Frutificacao";
    case SEGUNDO_FLUSH: return "Prep. Segundo Flush";
    case MODO_SECAGEM: return "Secagem Extrema (Limpeza)";
    default: return "Desconhecida";
  }
}

// ==========================================
// MÁQUINA DE ESTADOS - CONTROLE DA LUZ
// ==========================================
enum ModoLuz {
  LUZ_AUTO,
  LUZ_FORCADA_ON,
  LUZ_FORCADA_OFF
};
ModoLuz modoLuzAtual = LUZ_AUTO;

String getNomeModoLuz() {
  if (modoLuzAtual == LUZ_AUTO) return "AUTOMATICO";
  if (modoLuzAtual == LUZ_FORCADA_ON) return "FORCADO: LIGADO";
  return "FORCADO: DESLIGADO";
}

// ==========================================
// MÁQUINA DE ESTADOS - STATUS DE HARDWARE
// ==========================================
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

// Variáveis de estado dos relés
bool estadoLuz = false;
bool estadoUmidific = false;
bool estadoExaustInt = false;
bool estadoExaustExt = false;

// ==========================================
// VARIÁVEIS GLOBAIS DE SENSORES
// ==========================================
float tempExt = 0.0;
float humExt = 0.0;
float tempInt = 0.0;
float humInt = 0.0;

#include <WebServer.h>

// Instância do Servidor Web na porta 80
WebServer server(80);

// ==========================================
// CÓDIGO DA PÁGINA WEB (HTML/CSS/JS)
// ==========================================
const char* htmlDashboard PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grow IA Dashboard</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; text-align: center; margin: 0; padding: 20px; }
    h1 { color: #00ff88; margin-bottom: 5px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; max-width: 600px; margin: 0 auto 30px auto; }
    .card { background: #1e1e1e; padding: 20px; border-radius: 10px; border-left: 4px solid #333; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
    .card.blue { border-color: #00bfff; }
    .card.green { border-color: #00ff88; }
    .card.red { border-color: #ff3366; }
    .card h2 { font-size: 12px; text-transform: uppercase; margin: 0 0 10px 0; color: #aaa; }
    .card .value { font-size: 24px; font-weight: bold; }
    .badge { display: inline-block; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; margin: 5px; }
    .badge.on { background: #00ff88; color: #000; }
    .badge.off { background: #555; color: #fff; }
    .controls { max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
    select, button { padding: 12px; border-radius: 8px; border: none; font-size: 16px; font-weight: bold; cursor: pointer; }
    select { background: #333; color: white; border: 1px solid #555; }
    button { background: #4caf50; color: white; }
    button:active { background: #45a049; }
    #alerta { color: #ff3366; font-weight: bold; display: none; margin-top: 15px; }
  </style>
</head>
<body>
  <h1>🍄 Grow IA</h1>
  <div class="subtitle">Fase Atual: <span id="faseName">Carregando...</span></div>
  
  <div class="grid">
    <div class="card green">
      <h2>Temp Interna</h2>
      <div class="value" id="tInt">-- °C</div>
    </div>
    <div class="card blue">
      <h2>Umid Interna</h2>
      <div class="value" id="uInt">-- %</div>
    </div>
    <div class="card">
      <h2>Temp Externa</h2>
      <div class="value" id="tExt">-- °C</div>
    </div>
  </div>

  <div class="card" style="max-width: 560px; margin: 0 auto 30px auto;">
    <h2>Equipamentos</h2>
    <div>
      <span id="r1" class="badge off">Luz</span>
      <span id="r2" class="badge off">Umidificador</span>
      <span id="r3" class="badge off">Vento Int.</span>
      <span id="r4" class="badge off">Exaustor Ext.</span>
    </div>
    <div id="alerta">⚠️ ALERTA: FALTA D'ÁGUA NO UMIDIFICADOR! ⚠️</div>
  </div>

  <div class="controls">
    <select id="faseSelect" onchange="mudarFase(this.value)">
      <option value="0">Sem Cultivo (Standby)</option>
      <option value="P">Pinando</option>
      <option value="F">Frutificação</option>
      <option value="S">Segundo Flush</option>
      <option value="D">Secagem (Limpeza)</option>
    </select>
    <button onclick="ciclarLuz()">Ciclar Luz (Auto/On/Off)</button>
  </div>

  <script>
    function updateDashboard() {
      fetch('/api/data').then(r => r.json()).then(d => {
        document.getElementById('tInt').innerText = d.tInt.toFixed(1) + ' °C';
        document.getElementById('uInt').innerText = d.uInt.toFixed(1) + ' %';
        document.getElementById('tExt').innerText = d.tExt.toFixed(1) + ' °C';
        document.getElementById('faseName').innerText = d.fase;
        
        const setBadge = (id, isOn) => {
          const el = document.getElementById(id);
          el.className = 'badge ' + (isOn ? 'on' : 'off');
        };
        setBadge('r1', d.r1); setBadge('r2', d.r2); setBadge('r3', d.r3); setBadge('r4', d.r4);
        
        document.getElementById('alerta').style.display = d.alerta ? 'block' : 'none';
      }).catch(e => console.log('Erro de conexão'));
    }
    
    function mudarFase(val) { fetch('/api/cmd?f=' + val); }
    function ciclarLuz() { fetch('/api/cmd?l=1'); }

    setInterval(updateDashboard, 2000); // Atualiza a cada 2 seg
    updateDashboard(); // Primeira chamada
  </script>
</body>
</html>
)rawliteral";


// ==========================================
// ROTAS DA API WEB
// ==========================================
void handleRoot() {
  server.send(200, "text/html", htmlDashboard);
}

void handleApiData() {
  String json = "{";
  json += "\"tExt\":" + (isnan(tempExt) ? "0" : String(tempExt, 1)) + ",";
  json += "\"uExt\":" + (isnan(humExt) ? "0" : String(humExt, 1)) + ",";
  json += "\"tInt\":" + (isnan(tempInt) ? "0" : String(tempInt, 1)) + ",";
  json += "\"uInt\":" + (isnan(humInt) ? "0" : String(humInt, 1)) + ",";
  json += "\"r1\":" + String(estadoLuz ? "true" : "false") + ",";
  json += "\"r2\":" + String(estadoUmidific ? "true" : "false") + ",";
  json += "\"r3\":" + String(estadoExaustInt ? "true" : "false") + ",";
  json += "\"r4\":" + String(estadoExaustExt ? "true" : "false") + ",";
  json += "\"fase\":\"" + getNomeFase(faseAtual) + "\",";
  json += "\"alerta\":" + String(alertaFaltaAgua ? "true" : "false");
  json += "}";
  server.send(200, "application/json", json);
}

void handleApiCmd() {
  if (server.hasArg("f")) {
    String cmd = server.arg("f");
    if (cmd == "0") faseAtual = SEM_CULTIVO;
    else if (cmd == "P") faseAtual = PINANDO;
    else if (cmd == "F") faseAtual = FRUTIFICACAO;
    else if (cmd == "S") faseAtual = SEGUNDO_FLUSH;
    else if (cmd == "D") faseAtual = MODO_SECAGEM;
  }
  if (server.hasArg("l")) {
    if (modoLuzAtual == LUZ_AUTO) modoLuzAtual = LUZ_FORCADA_ON;
    else if (modoLuzAtual == LUZ_FORCADA_ON) modoLuzAtual = LUZ_FORCADA_OFF;
    else modoLuzAtual = LUZ_AUTO;
  }
  server.send(200, "text/plain", "OK");
}

// Função inteligente para ligar/desligar Relés 5V de forma 100% segura no ESP32
void setRele(int pino, bool ligar) {
  if (ligar) {
    pinMode(pino, OUTPUT);
    digitalWrite(pino, LOW); // Liga (GND)
  } else {
    pinMode(pino, INPUT);    // Desliga (Corta a corrente física)
  }
}

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
  setRele(RELE_LUZ, estadoLuz);
  setRele(RELE_UMIDIFIC, estadoUmidific);
  setRele(RELE_EXAUST_INT, estadoExaustInt);
  setRele(RELE_EXAUST_EXT, estadoExaustExt);

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
  wm.setConfigPortalBlocking(false); 
  
  if(wm.autoConnect("GROW_SETUP")) {
    Serial.println("WiFi ja estava salvo e conectou com sucesso!");
  } else {
    Serial.println("WiFi nao salvo ou falhou. Portal de configuracao criado: GROW_SETUP");
  }

  // Inicia a sincronização de tempo via internet
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  
  // --- 5. INICIAR SERVIDOR WEB DASHBOARD ---
  server.on("/", handleRoot);
  server.on("/api/data", handleApiData);
  server.on("/api/cmd", handleApiCmd);
  server.begin();
  Serial.println("Dashboard Web iniciado na porta 80!");
  
  Serial.println("\n========================================\n");
}


// ==========================================
// LOOP PRINCIPAL
// ==========================================
void loop() {
  unsigned long tempoAtual = millis();

  // Processa Servidor Web e WiFiManager
  wm.process();
  server.handleClient();

  // --- 1. TAREFA: LER SENSORES (A cada 2 seg) ---
  if (tempoAtual - tempoAnteriorSensores >= intervaloSensores) {
    tempoAnteriorSensores = tempoAtual;
    
    // Atualiza as variáveis globais
    tempExt = dht.readTemperature();
    humExt = dht.readHumidity();
    tempInt = sht30.readTemperature();
    humInt  = sht30.readHumidity();

    bool erroSensores = false;

    // Obtém a hora atual da internet
    struct tm timeinfo;
    bool horaValida = getLocalTime(&timeinfo);
    int horaAtual = horaValida ? timeinfo.tm_hour : -1;

    // ==============================================================
    // MOTOR DE AUTOMAÇÃO (A MÁGICA ACONTECE AQUI!)
    // ==============================================================
    if (!erroSensores) {
      
      // Controle do Temporizador de FAE (Fresh Air Exchange)
      if (modoFAELigado) {
        if (tempoAtual - ultimoCicloFAE >= FAE_TEMPO_ON) {
          modoFAELigado = false;
          ultimoCicloFAE = tempoAtual;
        }
      } else {
        if (tempoAtual - ultimoCicloFAE >= FAE_TEMPO_OFF) {
          modoFAELigado = true;
          ultimoCicloFAE = tempoAtual;
        }
      }

      switch (faseAtual) {
        
        case SEM_CULTIVO:
          estadoUmidific = false;
          estadoExaustInt = false;
          estadoExaustExt = false;
          if (modoLuzAtual == LUZ_AUTO) estadoLuz = false;
          break;

        case MODO_SECAGEM:
          estadoUmidific = false;
          estadoExaustInt = true;
          estadoExaustExt = true;
          if (modoLuzAtual == LUZ_AUTO) estadoLuz = false;
          break;

        case PINANDO:
        case FRUTIFICACAO:
        case SEGUNDO_FLUSH:
          
          // 1. UMIDADE (Controle com Histerese e Cão de Guarda)
          if (!alertaFaltaAgua) {
            if (humInt < UMIDADE_MINIMA) estadoUmidific = true;
            else if (humInt > UMIDADE_MAXIMA) estadoUmidific = false;
          } else {
            estadoUmidific = false; // Trava desligado se faltou água!
          }

          // Monitor do Cão de Guarda da Umidade
          if (estadoUmidific) {
            if (inicioUmidificacao == 0) inicioUmidificacao = tempoAtual;
            else if (tempoAtual - inicioUmidificacao > TIMEOUT_UMIDIFICADOR) {
              alertaFaltaAgua = true;
              estadoUmidific = false;
            }
          } else {
            inicioUmidificacao = 0; // Reset
          }

          // 2. VENTO INTERNO (Circulação de Névoa)
          if (estadoUmidific || modoFAELigado) estadoExaustInt = true;
          else estadoExaustInt = false;

          // 3. TEMPERATURA E CO2 (O Escudo Térmico)
          if (tempInt >= TEMP_CRITICA) {
            if (tempExt < tempInt) estadoExaustExt = true;
            else estadoExaustExt = false;
          } 
          else if (tempInt >= TEMP_ALVO_MAX) {
            if (tempExt < tempInt) estadoExaustExt = true;
            else estadoExaustExt = false;
          } 
          else if (tempInt < TEMP_MINIMA) {
            estadoExaustExt = false;
          }
          else {
            estadoExaustExt = modoFAELigado;
          }

          // 4. Iluminação Inteligente (Ciclo Noturno)
          if (modoLuzAtual == LUZ_AUTO) {
            if (horaValida) {
              if (horaAtual >= 20 || horaAtual < 8) estadoLuz = true;
              else estadoLuz = false;
            } else {
              estadoLuz = false; 
            }
          }
          break;
      }
      
      // Overrides Manuais da Luz
      if (modoLuzAtual == LUZ_FORCADA_ON) estadoLuz = true;
      else if (modoLuzAtual == LUZ_FORCADA_OFF) estadoLuz = false;

      // ==========================================
      // CORTE TÉRMICO DE SEGURANÇA MÁXIMA
      // ==========================================
      if (tempInt >= TEMP_CORTE_LUZ) {
        estadoLuz = false; // Desliga a lâmpada na marra independente do timer!
      }

      // APLICA
      setRele(RELE_LUZ, estadoLuz);
      setRele(RELE_UMIDIFIC, estadoUmidific);
      setRele(RELE_EXAUST_INT, estadoExaustInt);
      setRele(RELE_EXAUST_EXT, estadoExaustExt);
    }
    // ==============================================================
    // FIM DO MOTOR DE AUTOMAÇÃO
    // ==============================================================

    Serial.println("\n================ PAINEL DO GROW ================");
    if (horaValida) {
      Serial.printf("RELOGIO:           [%02d:%02d:%02d]\n", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    } else {
      Serial.println("RELOGIO:           [Aguardando Internet...]");
    }
    Serial.printf("FASE ATUAL:        [%s]\n", getNomeFase(faseAtual).c_str());
    Serial.println("------------------------------------------------");
    
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
    
    // Status dos Relés
    Serial.printf("Rele 1 (Luz):              %s (Modo: %s)\n", estadoLuz ? "LIGADO" : "DESLIGADO", getNomeModoLuz().c_str());
    Serial.printf("Rele 2 (Umidificador):     %s\n", estadoUmidific ? "LIGADO" : "DESLIGADO");
    Serial.printf("Rele 3 (Exaustor Interno): %s\n", estadoExaustInt ? "LIGADO" : "DESLIGADO");
    Serial.printf("Rele 4 (Exaustor Externo): %s\n", estadoExaustExt ? "LIGADO" : "DESLIGADO");
    
    Serial.println("------------------------------------------------");

    // Define o estado do sistema
    if (erroSensores) {
      estadoAtual = STATE_ERROR;
    } else if (WiFi.status() != WL_CONNECTED) {
      estadoAtual = STATE_NO_WIFI;
      Serial.println("WIFI: Config Portal [GROW_SETUP] - Entre com o celular!");
    } else {
      estadoAtual = STATE_OK;
      Serial.printf("WIFI: Conectado (IP: %s)\n", WiFi.localIP().toString().c_str());
    }
    
    Serial.println("================================================\n");
    Serial.println("👉 COMANDOS DE FASE: [0]=Standby, [P]=Pinando, [F]=Frutificacao, [S]=Flush, [D]=Secagem");
    Serial.println("👉 LUZ: [L]=Ciclar Modo de Luz (Auto/On/Off)");
  }

  // --- 3. TAREFA: COMANDOS DO USUÁRIO VIA SERIAL ---
  if (Serial.available() > 0) {
    char comando = Serial.read();
    
    // Controle da Luz
    if (comando == 'L' || comando == 'l') {
      if (modoLuzAtual == LUZ_AUTO) modoLuzAtual = LUZ_FORCADA_ON;
      else if (modoLuzAtual == LUZ_FORCADA_ON) modoLuzAtual = LUZ_FORCADA_OFF;
      else modoLuzAtual = LUZ_AUTO;
      Serial.printf("\n[SISTEMA] Controle da Luz alterado para: %s\n", getNomeModoLuz().c_str());
    }
    // Comandos de Fase
    else if (comando == '0') {
      faseAtual = SEM_CULTIVO;
      Serial.println("\n[SISTEMA] Fase: SEM CULTIVO");
    }
    else if (comando == 'P' || comando == 'p') {
      faseAtual = PINANDO;
      Serial.println("\n[SISTEMA] Fase: PINANDO");
    }
    else if (comando == 'F' || comando == 'f') {
      faseAtual = FRUTIFICACAO;
      Serial.println("\n[SISTEMA] Fase: FRUTIFICACAO");
    }
    else if (comando == 'S' || comando == 's') {
      faseAtual = SEGUNDO_FLUSH;
      Serial.println("\n[SISTEMA] Fase: PREP. SEGUNDO FLUSH");
    }
    else if (comando == 'D' || comando == 'd') {
      faseAtual = MODO_SECAGEM;
      Serial.println("\n[SISTEMA] Fase: MODO SECAGEM (Limpeza)");
    }
  }

  // --- 4. TAREFA: ATUALIZAR LED DE STATUS (DASHBOARD VISUAL) ---
  if (alertaFaltaAgua) {
    // VERMELHO RÁPIDO: Emergência (Falta de água no umidificador)
    if ((tempoAtual % 200) < 100) rgbLedWrite(RGB_BUILTIN, LED_BRIGHTNESS, 0, 0);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  }
  else if (estadoAtual == STATE_ERROR) {
    // VERMELHO LENTO: Erro em algum sensor (I2C travou, fio soltou)
    if ((tempoAtual % 1000) < 500) rgbLedWrite(RGB_BUILTIN, LED_BRIGHTNESS, 0, 0);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  } 
  else if (estadoAtual == STATE_NO_WIFI) {
    // ROXO PISCANDO: Modo AP / Sem Internet (Esperando Configuração)
    if ((tempoAtual % 1000) < 500) rgbLedWrite(RGB_BUILTIN, LED_BRIGHTNESS, 0, LED_BRIGHTNESS);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  }
  else if (faseAtual == SEM_CULTIVO) {
    // BRANCO PISCANDO LENTO: Standby / Dormindo
    if ((tempoAtual % 3000) < 100) rgbLedWrite(RGB_BUILTIN, LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS);
    else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  }
  else {
    // ESTADO OPERACIONAL NORMAL (Verde como base, muda cor conforme a ação)
    if (estadoUmidific) {
      // AZUL/CIANO PISCANDO: Jogando Névoa!
      if ((tempoAtual % 1000) < 50) rgbLedWrite(RGB_BUILTIN, 0, LED_BRIGHTNESS, LED_BRIGHTNESS);
      else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
    } 
    else if (estadoExaustExt) {
      // AMARELO PISCANDO: Ventilando / Trocando CO2
      if ((tempoAtual % 1000) < 50) rgbLedWrite(RGB_BUILTIN, LED_BRIGHTNESS, LED_BRIGHTNESS, 0);
      else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
    }
    else {
      // VERDE PISCANDO LONGO: Tudo perfeito, parâmetros batidos, apenas existindo.
      if ((tempoAtual % 2000) < 50) rgbLedWrite(RGB_BUILTIN, 0, LED_BRIGHTNESS, 0);
      else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
    }
  }
}