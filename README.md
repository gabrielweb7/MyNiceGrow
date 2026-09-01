# 🍄 Grow IA v3.0 — Sistema Inteligente de Cultivo Automatizado

Firmware completo para automação de estufas de cultivo de cogumelos (Fungi), rodando em **ESP32-C3-MINI-1-N4**.

O sistema lê sensores de temperatura e umidade (interno + externo), toma decisões climáticas inteligentes cruzando os dois ambientes, e controla 4 relés de estado sólido — tudo acessível por um **Dashboard Web** no celular e por **comandos Serial**.

---

## 📋 Funcionalidades

| Feature | Descrição |
|---|---|
| **Motor Climático Inteligente** | Cruza sensor interno (SHT30) com externo (DHT11) para decidir se ventila, tranca ou usa resfriamento evaporativo |
| **5 Fases de Cultivo** | Standby, Pinando, Frutificação, Segundo Flush, Secagem — cada uma com perfil climático próprio |
| **FAE (Fresh Air Exchange)** | Temporizador automático para expulsar CO2 tóxico, com duração e intervalo configuráveis por fase |
| **Escudo Térmico** | Se está quente dentro e mais quente fora, o sistema tranca a estufa e ativa resfriamento evaporativo |
| **Aquecedor de Emergência** | Se está frio e a rua também, o sistema liga a lâmpada fora do horário para gerar calor |
| **Corte Térmico de Segurança** | Desliga a luz na marra se a temperatura passar de 33°C |
| **Watchdog do Umidificador** | Se o umidificador ficar ligado 30 min sem efeito, desliga por segurança (falta d'água) |
| **Filtro Média Móvel** | Suaviza as leituras dos sensores (média de 5 amostras) para evitar oscilação nos relés |
| **Histórico Min/Max** | Registra a temperatura e umidade mais alta e mais baixa desde o boot, com horário |
| **Ciclo de Luz 12/12** | Iluminação automática das 20h às 08h (configurável) |
| **Controle Manual da Luz** | 3 modos: Automático, Forçado ON, Forçado OFF |
| **Dashboard Web (Dark Mode)** | Acesse pelo IP ou `grow.local` no navegador do celular |
| **mDNS** | Acesse o dashboard digitando `grow.local` em vez de decorar o IP |
| **OTA (Over-the-Air)** | Atualize o firmware pelo Wi-Fi direto da Arduino IDE, sem cabo USB |
| **Alertas Telegram** | Receba notificações no celular sobre temperatura crítica e falta d'água (opcional) |
| **Progressão Automática** | Troca de fase automaticamente após N dias (opcional, configurável) |
| **LED RGB Dashboard** | LED onboard muda de cor conforme o estado do sistema (verde, ciano, amarelo, vermelho) |
| **WiFiManager** | Configuração do Wi-Fi pelo celular, sem hardcode de senha no código |
| **100% Não-Bloqueante** | Nenhum `delay()` no loop. Sensores, Web, OTA e Serial rodam em paralelo |

---

## 🔌 Hardware

### Componentes

| Componente | Modelo | Função |
|---|---|---|
| Microcontrolador | ESP32-C3-MINI-1-N4 (RISC-V, Wi-Fi, BLE, 4MB Flash) | Cérebro do sistema |
| Sensor Interno | SHT30 (I2C) | Temperatura e Umidade dentro da estufa |
| Sensor Externo | DHT11 (módulo PCB 3 pinos) | Temperatura e Umidade do ambiente externo |
| Relé | Módulo SSR 4 Canais 5V (OMRON G3MB-202P) | Acionamento dos equipamentos (Low-Level Trigger) |
| LED | RGB Onboard (GPIO 8) | Dashboard visual sem tela |

### Pinagem (Esquema de Ligação)

```
ESP32-C3 GPIO    →    Componente
─────────────────────────────────────────
GPIO 4  (SDA)    →    SHT30 Verde
GPIO 5  (SCL)    →    SHT30 Amarelo
3.3V             →    SHT30 Vermelho
GND              →    SHT30 Preto

GPIO 10 (DATA)   →    DHT11 Signal (pino do meio)
3.3V             →    DHT11 VCC (+)
GND              →    DHT11 GND (-)

GPIO 0  (CH1)    →    Relé Canal 1 (Luz)
GPIO 1  (CH2)    →    Relé Canal 2 (Umidificador)
GPIO 3  (CH3)    →    Relé Canal 3 (Vento Interno)
GPIO 6  (CH4)    →    Relé Canal 4 (Exaustor Externo)
5V (VBUS)        →    Relé DC+ (VCC)
GND              →    Relé DC- (GND)

GPIO 8           →    LED RGB Onboard (automático)
```

### Relés — O que cada canal controla

| Canal | GPIO | Equipamento | Função |
|---|---|---|---|
| CH1 | 0 | Lâmpada Grow | Fotoperíodo 12/12 + Aquecedor de emergência |
| CH2 | 1 | Umidificador Ultrassônico | Manter umidade alta para o micélio |
| CH3 | 3 | Ventilador Interno | Circular ar + espalhar névoa de baixo pra cima |
| CH4 | 6 | Exaustor Externo | Trocar ar (FAE), resfriar ou aquecer com ar de fora |

> ⚠️ **IMPORTANTE:** O relé SSR G3MB-202P só funciona com cargas **AC (110V/220V)**. Não funciona com motores DC (12V/5V).

---

## 🧠 Motor Climático — Como o Robô Pensa

O sistema avalia o clima a cada 2 segundos e aplica uma das 4 estratégias:

| Cenário | Condição Interna | Condição Externa | Ação |
|---|---|---|---|
| **Estratégia A** | Muito quente | Ar frio lá fora | Liga exaustor externo para puxar ar gelado |
| **Estratégia B** | Muito quente | Ar quente lá fora | Tranca estufa + Resfriamento Evaporativo (névoa + vento) |
| **Estratégia C** | Muito frio | Ar quente lá fora | Liga exaustor externo para puxar ar quente |
| **Estratégia D** | Muito frio | Ar frio lá fora | Tranca estufa + Liga lâmpada como aquecedor |
| **Estável** | Temperatura ideal | — | Exaustores desligados, FAE por timer |

---

## 🌱 Perfis Climáticos por Fase

| Fase | Temp Max | Umid Min | Umid Max | FAE ON | FAE OFF |
|---|---|---|---|---|---|
| Pinando | 27.5°C | 95% | 99% | 3 min | a cada 40 min |
| Frutificação | 28.5°C | 88% | 92% | 2 min | a cada 1h |
| Segundo Flush | 29.0°C | 95% | 99% | 1 min | a cada 2h |
| Secagem | — | — | — | Ventiladores 100% ligados |

---

## 🌈 LED RGB — Dashboard Visual

| Cor | Significado |
|---|---|
| 🟢 Verde (pulso lento) | Tudo perfeito |
| 🔵 Ciano (pulso) | Umidificador ligado |
| 🟡 Amarelo (pulso) | Exaustor externo ligado |
| ⚪ Branco (pulso lento) | Standby / Dormindo |
| 🟣 Roxo (pisca) | Sem Wi-Fi / Portal ativo |
| 🔴 Vermelho (lento) | Erro no sensor |
| 🔴 Vermelho (rápido) | Falta d'água no umidificador |

---

## 📱 Dashboard Web

Acesse pelo navegador do celular (mesma rede Wi-Fi):
- **Por IP:** `http://192.168.x.x` (mostrado no Monitor Serial)
- **Por nome:** `http://grow.local`

### Funcionalidades do Dashboard:
- 4 cards de sensores (Temp/Umidade Interna e Externa) com histórico Min/Max
- Status dos 4 relés em tempo real (badges verde/cinza)
- Alerta visual de falta d'água
- Status do timer FAE
- Relógio e Uptime do sistema
- Contador de dias na fase atual
- Seletor de Fase de Cultivo
- Botão de Controle da Luz (Auto/ON/OFF)
- Botão de Reset do Alerta de Água
- Atualização automática a cada 2 segundos

---

## ⌨️ Comandos Serial

| Tecla | Ação |
|---|---|
| `0` | Fase: Standby |
| `P` | Fase: Pinando |
| `F` | Fase: Frutificação |
| `S` | Fase: Segundo Flush |
| `D` | Fase: Secagem |
| `L` | Ciclar Modo da Luz (Auto → ON → OFF → Auto) |
| `R` | Resetar Alerta de Falta d'Água |

---

## 📦 Dependências (Arduino IDE)

Instale via **Gerenciador de Bibliotecas** (Sketch → Include Library → Manage Libraries):

| Biblioteca | Autor |
|---|---|
| `Adafruit SHT31 Library` | Adafruit |
| `DHT sensor library` | Adafruit |
| `WiFiManager` | tzapu |

Bibliotecas que **já vêm** com o ESP32 Arduino Core (não precisa instalar):
- `WebServer.h`
- `ESPmDNS.h`
- `ArduinoOTA.h`
- `WiFiClientSecure.h`

### Configuração da Placa na Arduino IDE:
- **Board:** ESP32C3 Dev Module
- **USB CDC On Boot:** Enabled
- **Flash Size:** 4MB

---

## 🔄 Atualização OTA (Sem Fio)

Após o primeiro upload via cabo USB, as próximas atualizações podem ser feitas **pelo Wi-Fi**:

1. Na Arduino IDE, vá em **Ferramentas → Porta**
2. Selecione `grow at 192.168.x.x` (aparece automaticamente)
3. Clique em **Upload** normalmente

---

## 📲 Alertas Telegram (Opcional)

Para receber alertas no celular:

1. Abra o Telegram e fale com `@BotFather`
2. Crie um bot com `/newbot` e copie o **Token**
3. Fale com `@userinfobot` para descobrir seu **Chat ID**
4. Edite o código e preencha:
```cpp
const char* TELEGRAM_TOKEN = "SEU_TOKEN_AQUI";
const char* TELEGRAM_CHAT  = "SEU_CHAT_ID_AQUI";
```

Alertas enviados automaticamente:
- 🚨 Falta d'água no umidificador
- 🔥 Corte térmico ativado
- ⚠️ Temperatura crítica (≥30°C)
- 🍄 Mudança automática de fase

---

## 📁 Estrutura do Projeto

```
MyNiceGrow/
├── esp32c3.ino    # Firmware completo (arquivo único)
└── README.md      # Este arquivo
```

---

## 📝 Changelog

### v3.0 (Atual)
- Filtro Média Móvel (5 amostras) para estabilizar leituras
- Histórico Min/Max com horário
- mDNS (`grow.local`)
- OTA (atualização sem fio)
- Alertas Telegram
- Progressão automática de fases (configurável)
- Dashboard Web redesenhado com emojis, uptime, dias na fase e Min/Max
- Teste automático de relés no boot
- Botão Reset Alerta Água no Dashboard e Serial
- Código refatorado em seções modulares

### v2.0
- Refatoração completa do código em funções independentes
- Struct `PerfilClimatico` para cada fase de cultivo
- Teste de relés no boot

### v1.0
- Motor climático com Matriz Térmica (4 estratégias)
- Escudo Térmico + Resfriamento Evaporativo
- Lâmpada como aquecedor de emergência
- Watchdog anti-queima do umidificador
- Corte térmico de segurança (33°C)
- Dashboard Web Dark Mode
- LED RGB Dashboard visual
- WiFiManager (configuração sem hardcode)
- Relógio NTP (Horário de Brasília)
- Ciclo de Luz 12/12 inteligente
- FAE (Fresh Air Exchange) com timer configurável
- Controle via Serial e Web
