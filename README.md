# 🍄 Grow do Txai — Sistema Inteligente de Automação IoT (v4.1)

Um sistema de nível profissional, autônomo e baseado em IoT para controle e monitoramento de cultivo em ambiente fechado (Grow). Alimentado por um **ESP32-C3**, sensores de precisão e uma arquitetura em nuvem própria baseada em PHP/MySQL.

---

## 🏗️ Arquitetura do Sistema

O sistema é dividido em duas camadas principais:

### 1. Camada de Hardware / Firmware (ESP32-C3)
- **Máquina de Estados Finita (FSM):** Controle não-bloqueante usando `millis()`.
- **Datalogger Anti-Apagão (LittleFS):** Se o Wi-Fi ou a internet cair, o ESP32 salva todos os registros na memória flash interna (`/offline.log`). Quando a conexão volta, ele sincroniza tudo em lote.
- **Telemetria de 1 Minuto:** Envio de dados via requisições HTTPS `POST` a cada 60 segundos com chaves secretas de segurança (API Key).
- **Filtros de Sanidade Sensorial:** Implementação de Média Móvel Suavizada e descarte de ruídos I2C (ex: leitura falsa de `-45.0°C`).
- **NVS (Memória Não-Volátil):** Preserva a Fase de Cultivo e métricas de tempo mesmo que a energia caia.
- **WiFiManager & mDNS:** Portal cativo inteligente para configuração de rede via celular e acesso local via `http://grow.local`.

### 2. Camada Cloud & Dashboard (HostGator)
- **API REST em PHP:** Recebe as requisições em lote ou em tempo real do ESP32. Protegida contra injeção e blindada por arquivos "ponte" no diretório raiz para compatibilidade total com o *ModSecurity* do cPanel.
- **Dashboard Glassmorphism:** Interface web ultra-moderna estilizada com *TailwindCSS*.
- **Gráficos Sincronizados (ApexCharts):** Visualização interativa e responsiva. O zoom e o tracking do mouse (tooltip) são compartilhados entre os painéis de Temperatura, Umidade e Relés, permitindo analisar exatamento qual equipamento influenciou a mudança climática em determinado minuto.

---

## ⚙️ Componentes de Hardware

- Placa: **ESP32-C3 SuperMini**
- Sensor: **Módulo I2C SHT30** (Temperatura e Umidade de alta precisão)
- Atuadores: **Módulo Relé 4 Canais**
  - `Relé 1:` Iluminação
  - `Relé 2:` Umidificador
  - `Relé 3:` Ventilador Interno
  - `Relé 4:` Exaustor

---

## 🚀 Como Instalar e Gravar o Firmware

O projeto utiliza bibliotecas robustas e requer uma configuração específica de partição devido ao uso simultâneo de TLS/SSL (Nuvem) e LittleFS (Arquivos).

### Configuração na Arduino IDE:
1. Placa: `ESP32C3 Dev Module`
2. Flash Size: `4MB (32Mb)`
3. **Partition Scheme:** `Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)` — *Fundamental para evitar erro "Sketch too big"*
4. JTAG Adapter: `Integrated USB JTAG`

### Bibliotecas Necessárias:
- `Adafruit SHT31 Library`
- `WiFiManager` por tzapu
- `ArduinoJson` por Benoit Blanchon
- `UniversalTelegramBot` por Brian Lough (Opcional/Alerta)

---

## 🌐 Como Fazer Deploy do Dashboard (cPanel)

Toda a arquitetura Cloud foi desenhada para viver nativamente em hospedagens compartilhadas padrão (HostGator/cPanel) via Git.

1. Acesse o **cPanel**.
2. Vá em **Git Version Control**.
3. Crie ou configure um repositório clonando a branch `main` deste projeto.
4. Clique em **Update from Remote**.
5. No cPanel, crie o banco de dados via **Bancos de Dados MySQL**.
6. Importe o arquivo `grow.alquimistasmagicos.com.br/database.sql`.
7. Ajuste as credenciais no arquivo `grow.alquimistasmagicos.com.br/config.php`.

---

## 📊 Matriz Térmica & FAE (Fator de Aerobiose)

O sistema não se baseia apenas em setpoints estáticos. Ele toma decisões inteligentes:
- Controla janelas de dissipação térmica cruzando dados da temperatura interna vs. externa.
- Alterna ciclos de vento para simular trocas de ar sem exaurir a umidade natural da estufa (Resfriamento Evaporativo).

> Desenvolvido com dedicação extrema para o controle de clima mais estável possível.
