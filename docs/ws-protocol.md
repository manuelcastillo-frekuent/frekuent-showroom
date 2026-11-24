# Protocolo WebSocket pantalla ↔ servidor del showroom

**Estado: PROVISIONAL.** Propuesta del frontend para acordar con backend (Ángel). Fuente de verdad en código: [`src/features/payments/api/s2s/protocol.ts`](../src/features/payments/api/s2s/protocol.ts) y la copia del BFF; mantener los tres sincronizados.

## Conexión

- Una única conexión WebSocket persistente por pantalla: `wss://<servidor>/…` (en local, `ws://localhost:8787` con el BFF simulado de [`../showroom-bff`](../../showroom-bff), que tiene su propia copia de estos tipos).
- Mensajes JSON, uno por frame, con campo `type`.
- Importes en **céntimos** (enteros). Identificadores como strings.

## Secuencia (happy path)

```
Pantalla                                   Servidor                         Spot
   │ sale_request {requestId, spot,           │                               │
   │   productCode, amountCents}  ──────────► │ /create + /pay ─────────────► │ pide tarjeta
   │ ◄──────── sale_accepted {requestId, paymentId}                           │
   │ ◄──────── payment_status {waiting_tap}   │                               │
   │                                          │ ◄──────── visitante paga ─────│
   │ ◄──────── payment_status {authorising}   │                               │
   │ ◄──────── payment_approved {authCode}    │                               │
   │ ◄──────── dispense {paymentId, productCode}   ← ORDEN de dispensar        │
   │  (animación de caída)                    │                               │
   │ dispense_result {paymentId, success} ──► │ /dispense                     │
```

La pantalla **no dispensa al aprobarse el pago**: espera a la orden `dispense` del servidor.

## Pantalla → servidor

| `type`            | Campos                                                                                                                           | Cuándo                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sale_request`    | `requestId` (uuid generado por la pantalla), `spot` (`pro` \| `compact` \| `mini`), `productCode` (p. ej. `"21"`), `amountCents` | El visitante elige producto                                                                                                                                                                         |
| `cancel_request`  | `paymentId`                                                                                                                      | El visitante cancela mientras se espera la tarjeta. La pantalla sigue en `waiting_tap` hasta que el servidor confirme con `payment_failed` (`cancelled`), porque el visitante puede haber pagado ya |
| `dispense_result` | `paymentId`, `success` (bool)                                                                                                    | Termina la entrega en pantalla                                                                                                                                                                      |

## Servidor → pantalla

| `type`             | Campos                                                                      | Significado                                                              |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `sale_accepted`    | `requestId`, `paymentId`                                                    | Pago abierto en el Spot; a partir de aquí todo va por `paymentId`        |
| `sale_rejected`    | `requestId`, `reason`: `offline`                                            | No se pudo abrir el pago (payments-api responde 409); no hay `paymentId` |
| `payment_status`   | `paymentId`, `status`: `waiting_tap` \| `authorising`                       | Progreso del pago en el Spot                                             |
| `payment_approved` | `paymentId`, `authCode`, `method`: `card` \| `wallet`                       | Pago aprobado                                                            |
| `payment_failed`   | `paymentId`, `reason`: `declined` \| `rejected` \| `timeout` \| `cancelled` | Pago cerrado sin cobro. Corresponde a los SaleMessage 3, 1, 2 y 4        |
| `dispense`         | `paymentId`, `productCode`                                                  | Orden de dispensar ese producto                                          |

Mensajes que no cumplan este esquema se ignoran (se registran en consola).

## Ciclo de la conexión

- La pantalla abre el WebSocket **al arrancar** en modo `s2s`, no con la primera venta.
- Si el handshake no termina en 5 s, o la conexión se cierra, reintenta con espera exponencial: 1 s, 2 s, 4 s… hasta 30 s, con una variación aleatoria de hasta la mitad para que varios tótems no reconecten a la vez. Al conectar, la espera vuelve a 1 s.
- Si se cae la conexión, la pantalla da por fallido (`offline`) lo que tenga en curso: el protocolo aún no permite retomar un pago tras reconectar.
- Una venta pedida sin conexión falla al momento como `offline`. Si la conexión se está abriendo, espera a que termine (como mucho los 5 s del handshake).
- Mientras no hay conexión, la pantalla muestra en una esquina `offline` o `connecting…`, solo visible para el personal.
- Todavía no hay heartbeat: una conexión que muere sin cerrarse (wifi que se cae sin aviso) no se detecta hasta que el sistema operativo la cierra.

## Preguntas abiertas para backend

1. ¿Quién traduce `spot` → `device_id` real? Propuesta: el servidor, con la configuración del showroom.
2. ¿`dispense` lo emite el servidor inmediatamente tras `payment_approved` (flujo A) o hay lógica intermedia?
3. Autenticación de la pantalla en el WebSocket (token en query o primer mensaje).
4. ¿De dónde saca el BFF el paso a `authorising`? payments-api no recibe hoy ningún aviso del tap.
5. Reenvío de estado tras reconectar: ¿el servidor reenvía el estado de los pagos abiertos de la pantalla (p. ej. tras un `resume { paymentIds }`)? Hasta entonces, un corte da el pago por perdido en pantalla.
6. Heartbeat a nivel de aplicación (`ping`/`pong`), porque el navegador no puede enviar pings de WebSocket.
