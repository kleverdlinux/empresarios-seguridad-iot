/*
 =============================================================================
 SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
 SENATI - PIAD-526: FIRMWARE DEL NODO DE SEGURIDAD Y TELEMETRIA
 Microcontrolador: Arduino Mega 2560 / Uno / ESP32
 Componentes:
   - Sensor Dactilar Optico AS608 (UART)
   - Sensor de Impacto / Vibracion SW-420 (Digital)
   - Sensor de Presencia Infrarrojo PIR HC-SR501 (Digital)
   - Modulo Rele para Cerradura Electromagnetica (Solenoid Strike)
   - Zumbador Acustico (Buzzer) y LEDs de Estado (Verde / Rojo)
 =============================================================================
*/

#include <SoftwareSerial.h>
#include <Adafruit_Fingerprint.h>

// Definicion de pines de conexion
#define PIN_RELE_CERRADURA   7   // Rele NC/NO para solenoide de puerta
#define PIN_BUZZER           8   // Zumbador acustico
#define PIN_LED_VERDE        9   // Indicador Acceso Permitido
#define PIN_LED_ROJO         10  // Indicador Acceso Denegado / Alarma
#define PIN_SENSOR_SW420     2   // Sensor de vibracion (Interrupcion INT0)
#define PIN_SENSOR_PIR       3   // Sensor PIR de movimiento

// Comunicacion serie con sensor AS608 (RX: Pin 4, TX: Pin 5)
SoftwareSerial serialAS608(4, 5);
Adafruit_Fingerprint sensorHuella = Adafruit_Fingerprint(&serialAS608);

// Variables de estado
volatile bool alertaImpactoDetectada = false;
bool alertaMovimientoDetectada = false;
unsigned long tiempoAperturaInicio = 0;
bool cerraduraDesasegurada = false;
const unsigned long TIEMPO_APERTURA_MS = 5000;

// Rutina de interrupcion externa para impacto repentino en el rack (SW-420)
void ISR_ImpactoVibracion() {
  alertaImpactoDetectada = true;
}

void setup() {
  // Inicializacion del puerto serial de comunicacion con el Servidor
  Serial.begin(115200);
  while (!Serial);

  // Configuracion de salidas digitales
  pinMode(PIN_RELE_CERRADURA, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);

  // Estado inicial seguro: Cerradura bloqueada, LEDs y Buzzer apagados
  digitalWrite(PIN_RELE_CERRADURA, HIGH); // Rele activo en nivel bajo
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_VERDE, LOW);
  digitalWrite(PIN_LED_ROJO, LOW);

  // Configuracion de entradas digitales con resistencia pull-up
  pinMode(PIN_SENSOR_SW420, INPUT_PULLUP);
  pinMode(PIN_SENSOR_PIR, INPUT);

  // Asociar interrupcion para el sensor de impacto SW-420
  attachInterrupt(digitalPinToInterrupt(PIN_SENSOR_SW420), ISR_ImpactoVibracion, FALLING);

  // Inicializar sensor de huella dactilar AS608
  sensorHuella.begin(57600);
  if (sensorHuella.verifyPassword()) {
    Serial.println(F("{\"evento\":\"INICIO\",\"modulo\":\"AS608\",\"estado\":\"OK\"}"));
  } else {
    Serial.println(F("{\"evento\":\"INICIO\",\"modulo\":\"AS608\",\"estado\":\"NO_DETECTADO\"}"));
  }

  // Notificar al servidor que el nodo hardware esta listo
  Serial.println(F("{\"evento\":\"SISTEMA_LISTO\",\"dispositivo\":\"NODO_EMPRESARIOTEC_V1\"}"));
}

void loop() {
  // 1. Verificar comandos entrantes desde el Servidor / Gateway
  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    procesarComandoServidor(comando);
  }

  // 2. Gestion de temporizador de cierre automatico de cerradura
  if (cerraduraDesasegurada) {
    if (millis() - tiempoAperturaInicio >= TIEMPO_APERTURA_MS) {
      bloquearCerradura();
    }
  }

  // 3. Monitoreo del sensor de impacto SW-420
  if (alertaImpactoDetectada) {
    alertaImpactoDetectada = false;
    dispararAlertaImpacto();
  }

  // 4. Monitoreo del sensor de presencia PIR
  int lecturaPIR = digitalRead(PIN_SENSOR_PIR);
  if (lecturaPIR == HIGH && !alertaMovimientoDetectada) {
    alertaMovimientoDetectada = true;
    Serial.println(F("{\"telemetria\":\"PIR\",\"estado\":\"PRESENCIA_DETECTADA\"}"));
  } else if (lecturaPIR == LOW && alertaMovimientoDetectada) {
    alertaMovimientoDetectada = false;
  }

  // 5. Lectura continua del sensor dactilar AS608 (si hay dedo apoyado)
  verificarDedoEnAS608();

  delay(20);
}

// Procesa instrucciones enviadas por el Servidor Central
void procesarComandoServidor(String cmd) {
  if (cmd == "ABRIR_PUERTA" || cmd == "RELAY:ON") {
    desbloquearCerradura();
  } else if (cmd == "CERRAR_PUERTA" || cmd == "RELAY:OFF") {
    bloquearCerradura();
  } else if (cmd == "ALARMA:DENEGADO") {
    emitirTonoDenegado();
  } else if (cmd == "STATUS") {
    Serial.print(F("{\"puerta\":"));
    Serial.print(cerraduraDesasegurada ? F("\"ABIERTA\"") : F("\"CERRADA\""));
    Serial.println(F("}"));
  }
}

void desbloquearCerradura() {
  cerraduraDesasegurada = true;
  tiempoAperturaInicio = millis();
  digitalWrite(PIN_RELE_CERRADURA, LOW); // Activa rele (solenoide desbloqueado)
  digitalWrite(PIN_LED_VERDE, HIGH);
  digitalWrite(PIN_LED_ROJO, LOW);

  // Tono de apertura melodico
  tone(PIN_BUZZER, 880, 150);
  delay(180);
  tone(PIN_BUZZER, 1320, 250);

  Serial.println(F("{\"evento\":\"PUERTA_DESBLOQUEADA\",\"duracion_s\":5}"));
}

void bloquearCerradura() {
  cerraduraDesasegurada = false;
  digitalWrite(PIN_RELE_CERRADURA, HIGH); // Rele desenergizado
  digitalWrite(PIN_LED_VERDE, LOW);
  noTone(PIN_BUZZER);
  Serial.println(F("{\"evento\":\"PUERTA_BLOQUEADA\"}"));
}

void emitirTonoDenegado() {
  digitalWrite(PIN_LED_ROJO, HIGH);
  tone(PIN_BUZZER, 220, 200);
  delay(220);
  tone(PIN_BUZZER, 180, 250);
  delay(300);
  digitalWrite(PIN_LED_ROJO, LOW);
}

void dispararAlertaImpacto() {
  digitalWrite(PIN_LED_ROJO, HIGH);
  tone(PIN_BUZZER, 900, 300);
  Serial.println(F("{\"alerta\":\"SW420_IMPACTO\",\"nivel\":\"CRITICO\",\"mensaje\":\"Vibracion o intento de vulneracion detectado en el rack\"}"));
  delay(350);
  digitalWrite(PIN_LED_ROJO, LOW);
}

void verificarDedoEnAS608() {
  uint8_t p = sensorHuella.getImage();
  if (p != FINGERPRINT_OK) return;

  p = sensorHuella.image2Tz();
  if (p != FINGERPRINT_OK) return;

  p = sensorHuella.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    // Huella encontrada en la memoria del AS608
    Serial.print(F("{\"evento\":\"HUELLA_LEIDA\",\"finger_id\":"));
    Serial.print(sensorHuella.fingerID);
    Serial.print(F(",\"confianza\":"));
    Serial.print(sensorHuella.confidence);
    Serial.println(F("}"));
    desbloquearCerradura();
  } else {
    // Huella no reconocida
    Serial.println(F("{\"evento\":\"HUELLA_NO_RECONOCIDA\"}"));
    emitirTonoDenegado();
  }
}
