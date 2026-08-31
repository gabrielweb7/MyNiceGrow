# Projeto ESP32-C3

Este repositório contém o código de desenvolvimento para um microcontrolador ESP32-C3. Atualmente, o projeto está na sua fase inicial de exploração de hardware e controle visual.

## Hardware Utilizado
- **Placa/Chip:** ESP32-C3-MINI-1-N4 (Arquitetura RISC-V, Single Core)
- **Recursos Integrados:** Wi-Fi, Bluetooth LE (BLE), LED RGB embutido.
- **Pino do LED RGB:** Definido no GPIO 8 (padrão em muitas placas ESP32-C3 DevKit).

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

2. **Efeito Cósmico Psicodélico (LED RGB):**
   - O projeto possui um algoritmo gerador de cores suaves utilizando matemática senoidal (`sin()`).
   - Ele cria ondas com fases diferentes para as cores Vermelho, Verde e Azul (shifts de 90 e 180 graus).
   - O mapeamento PWM é configurado com limites mínimos para garantir que o brilho se mantenha constante, priorizando tons "frios" (ciano, roxo, azul espacial) para criar uma atmosfera relaxante.

## Arquitetura do Software Atual
- Escrito em C++ (Arduino Core para ESP32).
- Utiliza a biblioteca nativa `esp32-hal-rgb-led.h` para comunicação simplificada com o LED RGB embutido.
- Processamento em loop único contínuo.

## Próximos Passos (Roadmap de Design)
- [ ] **Otimização de Tempo:** Substituir o uso de `delay()` por temporizadores baseados em `millis()` para tornar o código não-bloqueante.
- [ ] **Modularização:** Separar a rotina visual do LED, telemetria e o core do sistema em funções e/ou arquivos de cabeçalho (`.h` / `.cpp`) distintos.
- [ ] **Expansão de Features:** *(Adicionar aqui as futuras conexões Wi-Fi, MQTT, Sensores ou Bluetooth conforme evolução).*

## Como Executar
1. Abra o arquivo `esp32c3/esp32c3.ino` na Arduino IDE.
2. Certifique-se de ter o core do ESP32 (da Espressif) instalado no "Boards Manager".
3. Selecione a placa apropriada (ex: `ESP32C3 Dev Module`).
4. **Importante:** Se estiver usando a porta USB nativa da placa, lembre-se de ativar o "USB CDC On Boot" nas configurações da placa (Tools > USB CDC On Boot: "Enabled").
5. Compile e faça o upload.
