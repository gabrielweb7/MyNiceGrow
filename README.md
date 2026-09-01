# Projeto ESP32-C3 (Grow Controller)

Este repositório contém o firmware para um sistema de automação e monitoramento de estufa de cultivo (Grow). O projeto utiliza um ESP32-C3 para leitura de sensores climáticos e controle de atuadores através de relés de estado sólido.

## Hardware Utilizado e Pinout (Esquema de Ligação)

- **Microcontrolador:** ESP32-C3-MINI-1-N4 (RISC-V, Wi-Fi, BLE, 4MB Flash)
- **LED RGB Onboard:** GPIO 8 (Indicador de status do sistema)

**Sensores:**
- **Sensor SHT30 (Interno - Temperatura e Umidade):** Via I2C
  - **SDA:** GPIO 4
  - **SCL:** GPIO 5
- **Sensor DHT11 (Externo - Temperatura e Umidade do ambiente de fora):**
  - **DATA:** GPIO 10

**Atuadores (Módulo SSR G3MB-202P - 5V DC):**
- **Canal 1 (Luz do Grow):** GPIO 0
- **Canal 2 (Exaustor Interno / Circulação):** GPIO 1
- **Canal 3 (Umidificador):** GPIO 3
- **Canal 4 (Exaustor Máximo / Troca de Ar):** GPIO 6
  *(Nota: Os GPIOs 2 e 9 foram evitados para os relés por serem pinos de Strapping/Boot, garantindo que o módulo de relé não interfira na inicialização da placa).*

## Funcionalidades Atuais

1. **Diagnóstico e Telemetria de Hardware:**
   - No momento do boot, a placa envia via porta Serial USB (115200 bps) o seguinte relatório de inicialização:
   ```text
        ESP32-C3-MINI-1-N4 INICIALIZADO    
   ========================================
   Modelo do Chip:         ESP32-C3
   Revisao de Silicio:     3
   Numero de Nucleos:      1
   Frequencia da CPU:      160 MHz
   Tamanho da Flash:       4 MB
   Memoria Heap Livre:     284 KB
   ```

2. **Indicador de Status do Sistema (LED RGB):**
   O LED embutido agora funciona como um sistema de diagnóstico visual para a estufa:
   - 🔴 **Vermelho Piscando:** Erro crítico (Falha na leitura de algum dos sensores).
   - 🔵 **Azul Piscando:** Sistema operante e sensores normais, mas **sem conexão Wi-Fi**.
   - 🟢 **Verde Piscando Rápido (Heartbeat):** Sistema 100% operante e conectado ao Wi-Fi com sucesso.
## Arquitetura do Software Atual
- Escrito em C++ (Arduino Core para ESP32).
- Utiliza a biblioteca nativa `esp32-hal-rgb-led.h` para comunicação com o LED.
- Processamento em loop único contínuo.

## Próximos Passos (Roadmap de Design)
- [x] **Integração SHT30 e DHT11:** Leitura de sensores via I2C e 1-Wire.
- [x] **Setup dos Relés:** Pinos GPIO configurados como saída iniciando em HIGH (seguro).
- [x] **Otimização de Tempo:** Substituição de `delay()` por `millis()` para evitar travamentos.
- [x] **Conectividade Inteligente (WiFiManager):** Sistema cria um AP próprio para configuração inicial sem precisar mexer no código.
- [ ] **Lógica de Controle Ambiental:** Criar regras (IFs) para acionar os relés baseado nas leituras de temperatura e umidade.

## Como Executar
1. Instale as bibliotecas na Arduino IDE: `Adafruit SHT31 Library`, `DHT sensor library`, `Adafruit Unified Sensor` e `WiFiManager` (por tzapu).
2. Abra o arquivo `esp32c3/esp32c3.ino`.
2. Certifique-se de ter o core do ESP32 (da Espressif) instalado no "Boards Manager".
3. Selecione a placa apropriada (ex: `ESP32C3 Dev Module`).
4. **Importante:** Se estiver usando a porta USB nativa da placa, lembre-se de ativar o "USB CDC On Boot" (Tools > USB CDC On Boot: "Enabled").
5. Compile e faça o upload.

