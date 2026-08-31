#include <Arduino.h>
#include <esp32-hal-rgb-led.h> // Função nativa do core ESP32 para o RGB built-in

// Pino do LED RGB onboard no ESP32-C3 DevKit (costuma ser GPIO 8)
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN 8
#endif

void setup() {
  // Inicializa o Serial via USB CDC nativo
  Serial.begin(115200);
  delay(2000); // Tempo para a porta USB estabilizar no boot

  // Exibição completa das informações do Hardware
  Serial.println("\n========================================");
  Serial.println("     ESP32-C3-MINI-1-N4 INICIALIZADO    ");
  Serial.println("========================================");
  Serial.print("Modelo do Chip:         ");
  Serial.println(ESP.getChipModel());
  Serial.print("Revisao de Silicio:     ");
  Serial.println(ESP.getChipRevision());
  Serial.print("Numero de Nucleos:      ");
  Serial.println(ESP.getChipCores());
  Serial.print("Frequencia da CPU:      ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  Serial.print("Tamanho da Flash:       ");
  Serial.print(ESP.getFlashChipSize() / (1024 * 1024));
  Serial.println(" MB");
  Serial.print("Memoria Heap Livre:     ");
  Serial.print(ESP.getFreeHeap() / 1024);
  Serial.println(" KB");
  Serial.println("========================================");
  Serial.println(">>> Iniciando Efeito Cosmico Psicodelico!");
  Serial.println("========================================\n");
}

void loop() {
  // A variável 'theta' aumenta a cada ciclo, gerando o tempo da onda
  static float theta = 0;
  theta += 0.02; // Altere este valor para mudar a VELOCIDADE (menor = mais devagar)

  if (theta >= 3.14159 * 2) theta = 0; // Reinicia o ciclo ao completar uma volta completa

  //--- MATEMÁTICA CÓSMICA ---
  // Usamos funções Seno com fases diferentes para R, G, B.
  // Isso cria os gradientes e misturas suaves de cores.

  // Fase 1: VERMELHO - Ondulando para criar Rosa e Roxo (Fase padrão)
  float r_onda = sin(theta);
  
  // Fase 2: VERDE - Mantemos BAIXO ou com fase oposta para evitar tons amarelados/esverdeados
  // Usamos uma fase negativa ou seno diferente para misturas como Ciano.
  float g_onda = sin(theta + (3.14159 / 2)); // Shift de 90 graus
  
  // Fase 3: AZUL - Mistura com Vermelho para Roxo, com Verde para Ciano.
  float b_onda = sin(theta + 3.14159); // Shift de 180 graus (fase oposta do Vermelho)


  //--- PROCESSAMENTO DE BRILHO (PWM) ---
  // Transformamos as ondas senoidais (-1 a 1) em valores PWM (0 a 255)
  // Também aplicamos um limite inferior para garantir que o LED nunca apague totalmente (brilho mínimo cósmico).
  
  int r_pwm = map((r_onda * 100), -100, 100, 10, 255); // Brilho min: 10
  int g_pwm = map((g_onda * 100), -100, 100, 0, 100);  // Mantemos o Verde bem baixo para tons 'frios' (0-100)
  int b_pwm = map((b_onda * 100), -100, 100, 50, 255); // O Azul é a base cósmica, brilha mais (50-255)


  //--- ENVIO PARA O LED ---
  rgbLedWrite(RGB_BUILTIN, r_pwm, g_pwm, b_pwm);



  // Pequeno delay para suavizar a transição no loop
  delay(2);
}