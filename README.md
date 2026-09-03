# 🍄 Grow do Txai — Sistema Inteligente de Automação IoT (v1.0 Oficial / Estável)

[![Release v1.0.1](https://img.shields.io/badge/Release-v1.0.1%20Oficial%20%2F%20Est%C3%A1vel-gold?style=for-the-badge&logo=target)](https://github.com/)
[![ESP32-C3](https://img.shields.io/badge/Hardware-ESP32--C3%20SuperMini-brightgreen?style=for-the-badge&logo=espressif)](https://www.espressif.com/)
[![Arduino / C++](https://img.shields.io/badge/Firmware-Arduino%20%2F%20C%2B%2B-blue?style=for-the-badge&logo=arduino)](https://www.arduino.cc/)
[![PHP 8.x](https://img.shields.io/badge/Backend-PHP%208.x%20%2F%20REST-purple?style=for-the-badge&logo=php)](https://www.php.net/)
[![MySQL](https://img.shields.io/badge/Database-MySQL-orange?style=for-the-badge&logo=mysql)](https://www.mysql.com/)
[![TailwindCSS](https://img.shields.io/badge/Frontend-TailwindCSS%203-38bdf8?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![Chart.js 4.4](https://img.shields.io/badge/Charts-Chart.js%204.4-ff6384?style=for-the-badge&logo=chartdotjs)](https://www.chartjs.org/)
[![OTA Updates](https://img.shields.io/badge/Deploy-Continuous%20OTA-emerald?style=for-the-badge&logo=git)](https://github.com/)

Um ecossistema IoT completo, autônomo e de nível profissional projetado especificamente para **micologia de precisão e cultivo protegido em ambiente controlado**.

O sistema combina um controlador embutido **ESP32-C3** de alta confiabilidade, leitura climática multissensorial redundante, atuadores de 4 canais, inteligência para proteção contra falhas e um **Dashboard Web SPA em tempo real** com interface *frosted glass* sobre um **fundo cósmico com rede micelial dinâmica**.

---

## 🏷️ Política Oficial de Versionamento (SemVer) & Diretrizes para IA

A partir da versão inicial estável **v1.0.0**, o projeto segue rigorosamente o padrão SemVer. **Toda alteração deve ser versionada no código e refletida visualmente no Dashboard Web e nas Tags do Git:**

- **`1.0.x` (Patch / Pequenos Updates):**
  - Correções pontuais de bugs, pequenos ajustes visuais na UI, polimento de estilos e correções de segurança menores.
- **`1.x.0` (Minor / Updates Mais Robustos):**
  - Adição de novos recursos (ex: Bot do Telegram, calculadora de energia, novas telas/modais, suporte a novos sensores ou protocolos de emergência).
- **`x.0.0` (Major / Novas Versões Maiores):**
  - Mudanças arquiteturais profundas, troca ou migração de hardware (ex: ESP32-S3), reestruturações completas do banco de dados ou reformulação geral do sistema.

> 🤖 **Diretriz Obrigatória para Agentes de IA / Desenvolvedores:**
> A cada novo ciclo de alterações, a versão DEVE ser atualizada no rodapé de `grow.alquimistasmagicos.com.br/index.html` (tanto no HTML quanto na atribuição em JavaScript), no `README.md` e acompanhada pela respectiva `git tag -a vX.X.X`.

---

## 📑 Sumário

- [Política de Versionamento](#-política-oficial-de-versionamento-semver--diretrizes-para-ia)
- [Visão Geral & Arquitetura](#-visão-geral--arquitetura)
- [Funcionalidades Principais](#-funcionalidades-principais)
- [Hardware & Pinagem (Pinout)](#-hardware--pinagem-pinout)
- [Fases de Cultivo & Perfis Climáticos](#-fases-de-cultivo--perfis-climáticos)
- [Protocolos de Segurança & Proteções Ativas](#-protocolos-de-segurança--proteções-ativas)
- [Dashboard Web & Visualização de Dados](#-dashboard-web--visualização-de-dados)
- [Pipeline de Atualização Contínua (OTA via Git)](#-pipeline-de-atualização-contínua-ota-via-git)
- [API REST & Estrutura do Banco de Dados](#-api-rest--estrutura-do-banco-de-dados)
- [Guia de Instalação & Compilação](#-guia-de-instalação--compilação)
- [Deploy do Servidor (cPanel / Apache)](#-deploy-do-servidor-cpanel--apache)

---

## 🏛️ Visão Geral & Arquitetura

O sistema opera em uma topologia híbrida resiliente onde a placa toma **decisões autônomas mesmo sem internet**, enquanto a nuvem fornece persistência histórica, relatórios de telemetria e controle remoto bidirecional instantâneo.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ESP32-C3 SUPERMINI                              │
│                                                                        │
│   [ Sensor SHT30 (I2C) ] ──┐                                           │
│   [ Sensor DHT11 (GPIO10)] ┼─► [ FSM - Máquina de Estados ]            │
│                            │   [ LittleFS Datalogger Offline ]         │
│                            │   [ NVS - Memória Anti-Apagão ]           │
│                            │                 │                         │
│                            │                 ▼                         │
│                            │      [ Módulo Relé 4 Canais ]             │
│                            │        ├── Ch 1: Luz                      │
│                            │        ├── Ch 2: Umidificador             │
│                            │        ├── Ch 3: Ventilador (Brisa)       │
│                            │        └── Ch 4: Exaustor (FAE)           │
└────────────────────────────┼───────────────────────────────────────────┘
                             │ HTTPS / TLS (POST Telemetria a cada 10s-60s)
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   BACKEND EM NUVEM (HOSTGATOR / CPANEL)                │
│                                                                        │
│   [ API REST PHP 8.x ] ◄──► [ Banco de Dados MySQL ]                   │
│   [ Gerenciador OTA (fw.php & esp32c3.ino.bin) ]                       │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ JSON / SSE (Polling dinâmico 2s - 5s)
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   DASHBOARD WEB (SPA RESPONSIVO)                       │
│                                                                        │
│   • Frosted Glassmorphism com Fundo Cósmico & Rede Micelial 2D         │
│   • 3 Gráficos Chart.js Sincronizados (Umidade, Temp, Relés)           │
│   • Timeline dos Relés em 4 Trilhas Horizontais (Analisador Lógico)    │
│   • Foco Automático de 3 Horas + Zoom Dinâmico 24h / 7 Dias            │
│   • Horímetro / Legenda Interativa com Filtros Clicáveis               │
│   • Controle Remoto de Relés e Transição Imediata de Fases             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Funcionalidades Principais

### 🧠 Firmware & Hardware (ESP32-C3)
- **FSM Não-Bloqueante:** Todo o código é baseado em temporizadores assíncronos (`millis()`), garantindo que leituras sensoriais, acionamentos de relés e requisições HTTP aconteçam sem travamentos de loop.
- **Datalogger Anti-Apagão (LittleFS):** Se a conexão Wi-Fi cair, o ESP32 salva todos os registros minuto a minuto na memória flash interna (`/offline.log`). Ao restabelecer a rede, sincroniza todo o lote com a nuvem sem perder um único segundo de histórico.
- **NVS (Non-Volatile Storage):** Fase ativa, setpoints e estados de luz são gravados na memória não-volátil do microcontrolador. Se houver queda de energia, ele retorna exatamente no mesmo estado.
- **Filtros Anti-Ruído Sensoriais:** Descarte de leituras espúrias (glitches) e validação de sanidade antes de qualquer acionamento.
- **WiFiManager & mDNS:** Se a rede não for encontrada, sobe um portal de configuração via celular (`Grow-Txai-AP`) e oferece acesso local via `http://grow.local`.

### 🌌 Interface Web & Dashboard
- **Fundo Cósmico com Rede Micelial:** Canvas 2D acelerado por hardware com esporos estelares flutuantes e conexões filamentosas dinâmicas. Super leve (< 0.01% de CPU), pausando automaticamente quando a aba fica inativa para economizar 100% de bateria.
- **Timeline dos Relés em 4 Trilhas Paralelas (Swimlanes):** Gráfico estilo analisador lógico industrial onde Luz, Umidificador, Ventilador e Exaustor rodam em faixas horizontais independentes — **sem nenhuma sobreposição ou código de barras misturado**.
- **Zoom Inteligente com Foco em 3 Horas:** Ao abrir o painel ou alternar filtros, os gráficos já abrem focados no momento atual com máximo detalhamento, oferecendo um botão dinâmico para expandir para **24 Horas** ou **7 Dias**.
- **Crosshair Neon & Zoom Sincronizado:** A linha guia vertical corta simultaneamente os gráficos de Umidade, Temperatura e Relés sem atraso.
- **Horímetro Integrado:** Resumo no topo da timeline calculando com exatidão matemática o tempo ativo de cada relé (`11h 57m de Luz`, `8h 48m de Umidificador`, etc.).
- **Filtros Interativos na Legenda:** Clique em qualquer relé da legenda para ocultá-lo ou exibi-lo no gráfico instantaneamente.

---

## 🔌 Hardware & Pinagem (Pinout)

Configuração oficial de hardware para a placa **ESP32-C3 SuperMini**:

| Componente | Função | Pino ESP32-C3 | Protocolo / Tipo |
| :--- | :--- | :--- | :--- |
| **SHT30 (Interno)** | Temperatura & Umidade da Estufa | **GPIO 4 (SDA)** | I2C (0x44 / 0x45) |
| **SHT30 (Interno)** | Clock I2C | **GPIO 5 (SCL)** | I2C |
| **DHT11 (Externo)** | Temperatura & Umidade da Sala | **GPIO 10** | One-Wire Digital |
| **Relé 1** | Iluminação do Cultivo | **GPIO 0** | Saída Digital (Nível Baixo/Ativo) |
| **Relé 2** | Umidificador Ultrassônico | **GPIO 1** | Saída Digital |
| **Relé 3** | Ventilador Interno (Brisa) | **GPIO 3** | Saída Digital |
| **Relé 4** | Exaustor de Ar (FAE) | **GPIO 6** | Saída Digital |
| **LED Status** | Indicador RGB Integrado | **GPIO 8** | WS2812 / RGB |

---

## 🍄 Fases de Cultivo & Perfis Climáticos

O sistema implementa perfis automatizados ajustáveis para as diferentes fases do ciclo fúngico:

| Fase | Ícone | Temp. Alvo | Umidade Alvo | Renovação de Ar (FAE) | Brisa Interna | Objetivo Biológico |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Standby** | ⏸️ | Desligado | Desligado | Desligado | Desligado | Higienização, manutenção ou repouso entre ciclos. |
| **Pinagem** | 🍄 | Máx 24.0 °C | 90% a 98% | 2 min ON / 58 min OFF | 2 min ON / 8 min OFF (+Névoa) | Estimula a formação de primórdios por alta umidade e orvalho. |
| **Frutificação**| 🌳 | Máx 25.0 °C | 88% a 95% | 2 min ON / 30 min OFF | 3 min ON / 3 min OFF (+Névoa) | Umidade levemente menor para evaporação transpiratória nos chapéus. |
| **Segundo Flush**| 🔄 | Máx 24.5 °C | 90% a 96% | 2 min ON / 45 min OFF | 2 min ON / 10 min OFF | Recuperação do bolo pós-colheita reduzindo perda de água. |
| **Secagem Total**| 🏜️ | Ambiente | Mínima | 100% LIGADO (Direto) | 100% LIGADO (Direto) | Umidificador bloqueado e coolers no talo para processar colheita. |

---

## 🛡️ Protocolos de Segurança & Proteções Ativas

O algoritmo executa verificações de segurança em segundo plano em cada iteração:

1. **🚨 Proteção Anti-Queima do Umidificador (Falta D'água):**
   * Se o umidificador permanecer ligado continuamente por **mais de 15 minutos** sem que a umidade suba ao menos 1%, o firmware desarma o relé imediatamente (`rUmid = 2`) e envia alerta vermelho para a nuvem. Evita queimar a membrana piezoelétrica sem água.
2. **🔥 Corte Térmico de Emergência da Iluminação:**
   * Se a temperatura ultrapassar **34.0 °C**, a iluminação é desligada na hora para cessar a irradiação de calor.
3. **🌙 Ciclo Fotoperiódico Invertido:**
   * No modo automático, a luz opera das **20:00 às 08:00**, aproveitando a temperatura mais fresca da noite para compensar o calor emitido pela lâmpada.
4. **🌫️ Sincronia de Brisa com Névoa:**
   * Ao acionar a brisa interna, o sistema injeta simultaneamente pulsos de névoa viva para que o vento não resseque a superfície dos frutos.

---

## 📊 Dashboard Web & Visualização de Dados

O painel foi desenvolvido com tecnologias modernas sem dependências pesadas de frameworks:

* **Arquitetura:** Vanilla JavaScript ES6+, TailwindCSS via CDN e Chart.js 4.4.4.
* **Redução de Ruído:** O backend agrupa os registros por minuto (`date('Y-m-d H:i')`), eliminando timestamps duplicados e garantindo um gráfico perfeitamente limpo.
* **Sincronia Total de Zoom & Pan:**
  * O arraste com mouse, touch e scroll é sincronizado em tempo real entre os três gráficos.
  * O botão dinâmico no topo permite alternar entre a visão detalhada de **3 Horas** e o panorama histórico de **24 Horas** ou **7 Dias**.
  * Duplo clique em qualquer canvas reseta ou foca a janela instantaneamente.

---

## 🚀 Pipeline de Atualização Contínua (OTA via Git)

A atualização de firmware é **100% remota e sem fio**:

```
 [ Arduino IDE ] ────► Exportar Binário Compilado (.bin)
                              │
                              ▼
                      [ Git Commit & Push ]
                              │
                              ▼
                      [ Repositório GitHub ]
                              │
                              ▼
                   [ cPanel Git Deployment ]
                              │
                              ▼
     [ grow.alquimistasmagicos.com.br/api/fw.php ]
                              │
      HTTP GET periódica / aviso de comando
                              ▼
     [ ESP32-C3 baixa .bin via HTTP e reinicia atualizado! ]
```

1. Compile o projeto na Arduino IDE com `Ctrl + Alt + S` (Exportar Binário Compilado).
2. O binário é salvo na pasta `build/esp32.esp32.esp32c3/esp32c3.ino.bin`.
3. Faça o `git push` para o GitHub.
4. No cPanel, clique em **Update from Remote**.
5. O ESP32 verifica a versão via hash/timestamp através do `api/fw.php`. Se houver versão mais recente (ou por clique no painel), **ele baixa o binário e se atualiza sozinho via OTA em menos de 60 segundos!**

---

## 📡 API REST & Estrutura do Banco de Dados

### Endpoints Principais

| Método | Endpoint | Descrição |
| :--- | :--- | :--- |
| `POST` | `/api/index.php` | Recebe a telemetria do ESP32 (requer header `x-api-key`). |
| `GET` | `/api/index.php?limit=1440` | Retorna telemetria filtrada e deduplicada (24h = 1440, 7 dias = 10080). |
| `GET` | `/api/fw.php` | Retorna o status de firmware da nuvem vs. placa e hash do commit Git. |
| `POST` | `/api/config.php` | Envia comandos da interface para a placa (Fase, Luz, Parâmetros). |

### Schema MySQL (Tabela `telemetria`)

```sql
CREATE TABLE IF NOT EXISTS `telemetria` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `timestamp` DATETIME NOT NULL,
  `temp_int` DECIMAL(5,2) NOT NULL,
  `hum_int` DECIMAL(5,2) NOT NULL,
  `temp_ext` DECIMAL(5,2) DEFAULT NULL,
  `hum_ext` DECIMAL(5,2) DEFAULT NULL,
  `rele_luz` TINYINT(1) DEFAULT 0,
  `rele_umid` TINYINT(1) DEFAULT 0,
  `rele_vento` TINYINT(1) DEFAULT 0,
  `rele_exaust` TINYINT(1) DEFAULT 0,
  `fase` VARCHAR(32) DEFAULT 'Standby',
  `unix_ts` INT UNSIGNED NOT NULL,
  INDEX `idx_ts` (`unix_ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 🛠️ Guia de Instalação & Compilação

### Configurações na Arduino IDE:
1. Abra as **Preferências** e adicione o repositório da Espressif:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. Selecione a placa: **`ESP32C3 Dev Module`**
3. **Partition Scheme:** `Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)` *(Obrigatório para comportar Wi-Fi, SSL e OTA)*
4. **Flash Size:** `4MB (32Mb)`
5. **USB CDC On Boot:** `Enabled`

### Bibliotecas Necessárias:
* `Adafruit SHT31 Library`
* `DHT sensor library` (Adafruit)
* `WiFiManager` (tzapu)
* `ArduinoJson` (Benoit Blanchon)

---

## 🌐 Deploy do Servidor (cPanel / Apache)

1. No **cPanel**, acesse a ferramenta **Git™ Version Control**.
2. Crie um novo repositório apontando para este repositório do GitHub.
3. Configure o diretório público para a pasta do dashboard (`public_html` ou subdomínio).
4. No **Gerenciador de Bancos MySQL**, crie a base e importe a estrutura SQL.
5. Renomeie ou configure as credenciais de banco e a `API_KEY` nos arquivos PHP da pasta `api/`.
6. Toda vez que houver novos commits na `main`, basta clicar em **Update from Remote** no cPanel!

---

## 🧙‍♂️ Créditos & Licença

Desenvolvido com carinho para o **Grow do Txai** por **Alquimistas Mágicos**.

Distribuído sob a licença **MIT**. Sinta-se livre para utilizar, clonar, aprimorar e compartilhar este projeto com a comunidade de cultivadores e entusiastas de IoT. 🍄✨
