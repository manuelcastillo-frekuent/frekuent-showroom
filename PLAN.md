# Showroom Frekuent: plan de frontend de pantalla

Autor: Manuel Castillo · Borrador del 19/11/2026 · Para el follow-up del viernes 20/11, 11:30

---

## 1. Qué es el proyecto

El showroom es un tótem con una pantalla táctil vertical que simula máquinas de venta autónoma a tamaño casi real. Junto a la pantalla hay dispositivos Frekuent **reales** (Spot Pro, Spot Compact y Spot Mini) a 110 cm del suelo. El visitante elige un producto en la pantalla, paga con su tarjeta o móvil en el Spot y la pantalla reacciona: cae el producto, se prepara el café o empieza el lavado.

Mensaje comercial del prototipo: _"Getting paid is just the beginning"_ y _"Step up. It all starts with a tap."_

### Escenarios (del prototipo de Germán)

| Escenario                                                                                      | Dispositivo que cobra | Cómo habla con la máquina                                  | Fase               |
| ---------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- | ------------------ |
| **Vending** (snacks y bebidas, 18 productos A1–F3)                                             | Spot **Pro**          | MDB cashless (vend request → vend approved → vend success) | 1                  |
| **Autolavado / jet wash** (box 02, programas: prelavado, alta presión, espuma, aclarado, cera) | Spot **Compact**      | Validador: suma crédito (1/2/5 €)                          | 1                  |
| **Café de oficina (OCS)** (espresso, americano, cappuccino, té; tamaño y azúcar)               | Spot **Mini**         | MDB (vend request)                                         | 1                  |
| **Cargador EV** (punto 03, AC 22 kW y DC 50 kW)                                                | Spot **Pro**          | Preautorización, captura y liberación                      | **Siguiente fase** |

> El EV queda fuera de la primera entrega porque exige desarrollar la preautorización (Germán, Slack).

### Lo que ya está decidido

- **Pagos reales, sin atajos de demo** (Germán): usar la _payment API_ de Ángel y desarrollar en firmware/POS la recepción y respuesta de esas peticiones.
  - Fase 1: como mínimo la **petición de venta (sale)**; si se llega, también la de **dispense/delivery**.
  - Siguiente fase: EV, con preautorización.
- **Sin indicador de "lo que está pasando"** en pantalla (el panel técnico del proto, tipo "MDB CASHLESS · VEND REQUEST"): _nice to have_, no obligatorio → **no**.
- **Todo en inglés**.
- Pau prepara el arte de la máquina vending a **2160×3840** (4K vertical), sin precios ni números, para que se pinten desde el HTML. Después hará la animación de caída del producto.
- **El hardware no está cerrado**. Xavi decide entre:
  - **Versión A**: tótem fijo de RC Projects con pantalla Traulux Android nativo, de 75″ (5.010 €) u 86″ (5.530 €). La máquina se ve a escala 1:1.
  - **Versión B**: 2 tótems YCKJNB de 65″ con Android y ruedas, más un stand móvil para los Spots. Unos 3.800 € en total; una unidad para la oficina y otra para ferias. La máquina se ve al 76 %.
- **Stack**: Dani propone JavaScript/React o algo "más programático" en lugar de HTML plano. Hay que hablarlo con Hugo.

### Fuentes consultadas

- Slack `#squad-showroom` (lo que has pegado).
- Prototipo: [canvas "Showroom Frekuent – Pared de experiencia"](https://claude.ai/artifact/2Z7jZi6FrwuwoBTvwWka6f), con dos artboards (A y B) que son interactivos y contienen toda la lógica simulada.
- Jira [DEV-470 · S2S payments (for showroom)](https://oraintechnologies.atlassian.net/browse/DEV-470) (Tomás, To Do), que enlaza la spec S2S (QIMS-488).
- Daily de Platform del 19/11: tienes la tarea _"Analizar el frontend para el proyecto de showroom"_. Ángel está con el S2S y depende de Tomás para los mensajes. Hay un bug de sesión _IS Mobile vs S2S_ que firmware corregirá antes del showroom.
- Confluence: el onboarding incluye una sesión llamada "Showroom Product". Aparte de eso, no hay documentación técnica.
- **No accesible**: los PDFs de las pantallas que se compartieron en Slack. Además, el conector de Slack no está autorizado, así que no he podido buscar en otros canales.

---

## 2. Arquitectura propuesta

> **Actualizado el 25/11/2026, tras hablar con Ángel:** no hay BFF. La pantalla habla directamente con el servicio de pagos (HTTP) y con el canal de la máquina (WebSocket o MQTT). Los endpoints definitivos aún no existen; hasta entonces, [`../showroom-bff`](../showroom-bff) los simula. Contrato provisional en [docs/s2s-protocol.md](docs/s2s-protocol.md).

```
┌──────────────────────────── Tótem ────────────────────────────┐
│  Pantalla Android (kiosk)                                      │
│  ┌──────────────────────────────┐                              │
│  │ Showroom App (web, React)    │── HTTPS: POST /sales ──────┐ │
│  │  · máquina virtual animada   │── HTTPS: GET status (poll) ┤ │
│  │  · botón «Fail next delivery»│◄─ dispense ────────────┐   │ │
│  │                              │── dispense_result ────►│   │ │
│  └──────────────────────────────┘                        │   │ │
│   Spot Pro · Spot Compact · Spot Mini (reales)           │   │ │
└──────────────────────────────────────────────────────────┼───┼─┘
                                                           │   ▼
                                  Canal de la máquina ◄────┘  Servicio de pagos (Ángel)
                                  (WebSocket o MQTT)    ◄───► /dispense, reembolso
                                                              ◄──► Firmware Spot (Tomás)
```

### Flujo de compra y entrega

1. `POST /sales`: la respuesta trae el ID del pago (sustituye a `sale_accepted`). Nombre del campo por confirmar.
2. Polling del estado al servicio de pagos, solo para mostrar el progreso y los fallos: nadie lo envía por su cuenta.
3. `payment_approved` y `dispense` llegan juntos, en una sola orden, por el canal de la máquina.
4. `dispense_result` por el mismo canal, y ahí termina el ciclo de la pantalla. Con `false`, el backend reembolsa ese pago por su cuenta; la pantalla no lo consulta.

### Ideas clave

1. **La pantalla es el "integrador" S2S.** Actúa como lo haría una máquina de un tercero: pide un pago para un Spot concreto, espera el resultado, anima la entrega y confirma el dispense. Por eso el showroom sirve también como **demo viva de la API S2S** que venderemos a integradores.
2. **Sin BFF, la credencial queda en el tótem.** Una pantalla en una feria es un entorno hostil, así que hace falta un token del showroom limitado a sus Spots. La correspondencia `spot → device_id`, que hacía el BFF, pasa a la configuración de la pantalla o al servicio. Pendiente de cerrar con Ángel.
3. **Una sola máquina de estados de pago** compartida por los tres escenarios. Los estados salen de la spec S2S:

   `idle → requesting (/create + /pay) → waiting_tap → authorising → approved → dispensing → delivered (/dispense ok) | failed/refunded | cancelled | timeout`

   - En el **flujo A** (el servidor reembolsa), `approved` es el estado final de cobro, y un `/dispense` ko lanza el reembolso.
   - En el **flujo B** (el terminal retiene el pago), el cierre llega con `SaleStatus`.
   - **Hay que acordar con Ángel y Tomás cuál usamos en fase 1.** Recomiendo el A porque es más simple y no necesita O1/O2.

4. **Modo demo/offline obligatorio.** Si no hay red o falla el backend, la app cambia a un _mock adapter_ que simula el pago, como hace hoy el prototipo. En una feria la wifi falla, y el showroom no puede quedarse en blanco. Se activa con un flag y se indica de forma discreta, solo para el operador.
5. **Patrón adapter**: `PaymentGateway` con dos implementaciones, `RealS2SGateway` y `MockGateway`. Así la UI y las animaciones se desarrollan **sin depender** de que el backend y el firmware estén listos, que es hoy el camino crítico.

### Cómo llega la app a la televisión

| Opción                                                                    | Pros                                                                                   | Contras                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Web alojada + navegador kiosk** (p. ej. Fully Kiosk Browser en Android) | Despliegue instantáneo (recargar). Lo más rápido de iterar. Funciona igual en A y en B | Depende de la red (se mitiga con PWA/service worker y caché)                   |
| **APK con WebView (Capacitor)**                                           | Arranca sola, se controla el ciclo de vida, funciona offline de verdad                 | Cada cambio exige instalar un APK. En Android sin GMS hay que hacer _sideload_ |
| HTML suelto en un USB o en local                                          | Cero infraestructura                                                                   | Sin actualizaciones remotas ni logs. Difícil de mantener                       |

**Recomendación**: empezar con **web alojada + PWA + navegador kiosk**. Solo si el modo kiosk del Android del proveedor da problemas, envolver la misma build en Capacitor. El código es el mismo en los dos casos.

### Stack recomendado

- **React + TypeScript + Vite**, en línea con dashboard-app, para que cualquiera del equipo pueda mantenerlo. Lo validamos con Hugo y Dani.
- **Máquina de estados explícita**, con XState o un reducer tipado. El flujo de pago es exactamente una máquina de estados y los timeouts (T_pay, T_dispense…) encajan de forma natural.
- **Animaciones**: CSS transforms y opacity, sprites o **Lottie** para la caída del producto que hará Pau. Hay que evitar filtros, blur y sombras animadas, porque **la GPU de la pantalla es justa** (lo dijo Albert).
- **Tokens del Frekuent Design System** (ya están en el canvas: `project/ds/frekuent/tokens.json`) y la fuente Greed Standard.
- **Lienzo lógico fijo** de 2160×3840, escalado al viewport. Así el mismo layout sirve para 65″ y 86″, y lo único que cambia entre A y B es un parámetro de escala de la máquina (1:1 o 76 %).

---

## 3. Fases de trabajo (mi parte)

### Fase 0 · Descubrimiento y decisiones (esta semana)

- [ ] Follow-up del viernes: cerrar el stack con Dani y Hugo, y el canal de comunicación (BFF + push) con Ángel.
- [ ] Pedir a Ángel y Tomás: flujo A o B, el contrato de eventos que recibirá la pantalla y un entorno de staging con un Spot real asignado.
- [ ] Pedir los PDFs de las pantallas (resolución, versión de Android, SoC/GPU, si trae navegador kiosk, si permite instalar APKs de fuera).
- [ ] Pedir a Pau los assets: máquina vending a 2160×3840 por capas (fondo, espirales/productos, display) y el formato de la animación de caída.

### Fase 1 · Esqueleto y simulación completa (sin backend)

- [ ] Repo, Vite + React + TS, lint y despliegue estático (staging).
- [ ] Lienzo escalable 2160×3840 y layout del tótem: zona display (arriba) y zona táctil (≤170 cm).
- [ ] Selector de escenario y pantalla de reposo/atractor, que vuelve sola tras un tiempo de inactividad.
- [ ] `PaymentGateway` + `MockGateway` con la máquina de estados completa, incluidos rechazo, cancelación y timeout.
- [ ] Los tres escenarios jugables con mock: vending, jet wash y café. Se porta la lógica que ya existe en el prototipo.
- [ ] **Prueba temprana en hardware real** (o en un Android equivalente) para medir FPS de las animaciones.

### Fase 2 · Integración real S2S

- [ ] `RealS2SGateway` contra el BFF: venta (sale) para los tres escenarios.
- [ ] Suscripción a eventos (SSE/WebSocket), reconexión y vuelta automática al mock si se cae.
- [ ] Dispense/delivery (`/dispense`) cuando la animación termina, si entra en fase 1.
- [ ] Pruebas end-to-end con los tres Spots físicos: tarjeta real, móvil, rechazo, cancelación y doble tap (mismo uuid).

### Fase 3 · Pulido para producción y ferias

- [ ] Assets definitivos de Pau y animación de caída.
- [ ] Modo operador oculto (p. ej. pulsación larga en una esquina): cambiar a demo, recargar, ver estado de la red y de los Spots.
- [ ] Arranque automático, sin barras del sistema, sin suspensión de pantalla, y recuperación tras un corte de luz.
- [ ] Logs y telemetría mínima (errores, pagos completados) para saber qué pasó en una feria.

### Fase 4 (siguiente) · EV charger

- [ ] Flujo de preautorización → carga en curso → captura → liberación (ya modelado en el prototipo), cuando backend y firmware lo soporten.

---

## 4. Dependencias y riesgos

| Riesgo                                                                                                          | Impacto                              | Mitigación                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| S2S sin terminar: `/pay` y `/dispense` son _stubs_, los puntos O1–O4 están abiertos y el FW necesita 13–19 días | Bloquea los pagos reales             | `MockGateway` desde el día 1. Fase 1 de UI independiente del backend                                 |
| GPU débil en el Android de la pantalla                                                                          | Animaciones a tirones                | Probar en el hardware en la fase 1. Animaciones solo con transform/opacity. Lottie o sprites ligeros |
| Hardware sin decidir (A o B, 65″ u 86″)                                                                         | Escala y layout                      | Lienzo lógico fijo más parámetro de escala                                                           |
| Red inestable en ferias                                                                                         | Pantalla muerta                      | PWA con caché, modo demo y vuelta automática                                                         |
| Credenciales en un dispositivo expuesto                                                                         | Seguridad                            | BFF. La pantalla solo tiene un token de showroom con permisos limitados                              |
| Bug de sesión IS Mobile vs S2S (firmware)                                                                       | Pagos mal clasificados               | Tomás lo corrige antes del lanzamiento del showroom (daily del 19/11)                                |
| Android sin Google Services                                                                                     | Sin Play Store ni Chrome actualizado | Instalar el navegador kiosk o el APK por sideload. Confirmar la versión de WebView                   |

## 5. Preguntas para el viernes

1. ¿React + TS + Vite te parece bien, Hugo? ¿Lo metemos en un repo propio?
2. Ángel: ¿hay BFF o endpoint para la pantalla? ¿Cómo se entera la pantalla del resultado del pago, por push o por polling?
3. Ángel y Tomás: ¿flujo A o B en fase 1? ¿El dispense entra en fase 1?
4. ¿Quién configura los Spots del showroom (company y device_id) y en qué entorno: staging o producción con importes reales?
5. ¿Cobramos de verdad al visitante? Si es así, ¿con qué importes? ¿Reembolso automático?
6. ¿Qué pantalla llega y cuándo? (Para la prueba de rendimiento.)
7. Pau: ¿en qué formato entrega la animación de caída (vídeo, Lottie o capas PNG)?
