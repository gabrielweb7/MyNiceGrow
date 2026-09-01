# 🍄 Grow IA v4.0 — IoT Cloud & Firmware Inteligente

Firmware avançado para automação de estufas de cultivo de cogumelos, rodando em **ESP32-C3**.

Este projeto agora é dividido em duas partes: o **Firmware do Microcontrolador (Local)** e o **Painel de Nuvem (HostGator/cPanel)**.

---

## ☁️ 1. Ecossistema de Nuvem (HostGator)

Você pode acessar seus dados de qualquer lugar do mundo instalando a pasta `grow.alquimistasmagicos.com.br/` na sua hospedagem PHP/MySQL.

### Como Instalar a Nuvem:
1. **Banco de Dados:**
   - Acesse seu cPanel e crie um Banco de Dados MySQL.
   - Abra o `phpMyAdmin`, selecione o banco criado e rode o código que está no arquivo `database.sql` para criar a tabela de telemetria.
2. **Configuração:**
   - Edite o arquivo `config.php` colocando seu `DB_USER`, `DB_PASS` e `DB_NAME`.
3. **Upload:**
   - Suba toda a pasta `grow.alquimistasmagicos.com.br` para o diretório raiz (`public_html/grow` ou no domínio configurado).
4. **Painel Dashboard:**
   - Acesse `https://grow.alquimistasmagicos.com.br/` para ver o painel rodando *TailwindCSS* e *Chart.js*. Ele exibirá gráficos de Temperatura, Umidade e uma linha do tempo de quando os Relés ligaram/desligaram!

---

## 💻 2. Firmware (ESP32-C3)

*(O firmware base atual é a v3.1. A integração com o envio via HTTP para a Nuvem será adicionada no arquivo `esp32c3.ino` na próxima etapa).*

### Funcionalidades do Firmware:
| Feature | Descrição |
|---|---|
| **Motor Térmico** | Cruza sensor interno (SHT30) com externo (DHT11) para esfriar evaporando ou ventilar. |
| **Memória Anti-Apagão** | Salva a fase atual e dia de início na Flash interna (`Preferences.h`). Se a luz cair, volta de onde parou. |
| **Reset Min/Max Diário** | À meia-noite (NTP), zera as mínimas e máximas de temperatura para você acompanhar o dia. |
| **FAE Inteligente** | Timer automático para expulsar CO2 sem perder umidade desnecessária. |
| **Watchdog Água** | Desliga o umidificador se ficar 30 min sem atingir a meta (falta d'água). |
| **Dashboard Local** | Acesso via `grow.local` na sua própria rede Wi-Fi. |

### Esquema de Ligação (Hardware)
```
GPIO 4  (SDA)    → SHT30
GPIO 5  (SCL)    → SHT30
GPIO 10 (DATA)   → DHT11
GPIO 0  (CH1)    → Relé Luz
GPIO 1  (CH2)    → Relé Umidificador
GPIO 3  (CH3)    → Relé Ventilador Interno
GPIO 6  (CH4)    → Relé Exaustor Externo
```

---

## 🚀 Próximos Passos (Evolução para v4.0)
Após a infraestrutura da HostGator estar online, o código do Arduino será atualizado com:
1. Cliente `HTTPClient` para disparar os dados em JSON para `https://grow.alquimistasmagicos.com.br/api/`.
2. Sistema `LittleFS` (Datalogger) para armazenar os dados caso a casa fique sem internet, enviando tudo em lote quando a rede voltar.
3. Função `HTTPUpdate` para você atualizar o código do seu ESP32 apertando um botão na HostGator, sem precisar ir até a outra casa.
