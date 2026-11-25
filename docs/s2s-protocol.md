# Protocolo pantalla ↔ servicios (sin BFF)

**Estado: PROVISIONAL.** Los endpoints reales aún no están definidos. Mientras tanto, la pantalla habla con el simulador de [`../showroom-bff`](../../showroom-bff), que implementa exactamente este contrato. Fuente de verdad en código: [`src/features/payments/api/s2s/protocol.ts`](../src/features/payments/api/s2s/protocol.ts), con una copia en el simulador. Hay que mantener sincronizados los tres.

## Con quién habla la pantalla

No hay BFF: la pantalla se conecta directamente a dos cosas.

| Canal                               | Para qué                                                                  | Local (simulador)           |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| **HTTP al servicio de pagos**       | Abrir la venta, consultar su estado (polling) y cancelarla                | `http://localhost:8787/api` |
| **Canal de la máquina** (WS o MQTT) | Recibir la orden de dispensar (con la aprobación) y devolver el resultado | `ws://localhost:8787`       |

La URL de cada uno se configura con `VITE_API_URL` / `?api=` y con `VITE_WS_URL` / `?ws=`. Importes en **céntimos** (enteros); identificadores como strings.

## Secuencia

```
Pantalla                         Servicio de pagos            Canal máquina        Spot
   │ POST /sales ──────────────────► │ ─────────────────────────────────────────► │ pide tarjeta
   │ ◄──────────── 201 {paymentId}   │                                            │
   │ GET /payments/{id} (cada 1 s) ► │                                            │
   │ ◄──── waiting_tap / authorising │ ◄─────────────────────── visitante paga ── │
   │ ◄──────────────────────────────────────── dispense {aprobación + producto}   │
   │  (animación: cae el producto, o se atasca)                                   │
   │ dispense_result {success} ─────────────────────────► │ ─► /dispense          │
   │  fin del ciclo para la pantalla (con false, el backend reembolsa solo)       │
```

La pantalla **no dispensa al aprobarse el pago**: espera a la orden `dispense`. El polling solo sirve para mostrar el progreso y detectar los fallos mientras se paga; se detiene al llegar la orden, que trae la aprobación. Con `dispense_result` se cierra el ciclo: la pantalla no vuelve a preguntar por ese pago, tampoco por el reembolso.

## HTTP · servicio de pagos

| Método y ruta                       | Body / respuesta                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sales`                       | `{ requestId, spot: pro\|compact\|mini, productCode, amountCents }` → `201 { paymentId }`. `requestId` es un uuid de la pantalla para que reintentar no abra dos pagos. **Nombre del campo `paymentId` por confirmar.** |
| `GET /payments/{paymentId}`         | → `{ paymentId, status }` (estados abajo)                                                                                                                                                                               |
| `POST /payments/{paymentId}/cancel` | → `202`. La pantalla sigue esperando hasta que el polling devuelva `cancelled`, porque el visitante puede haber pagado ya                                                                                               |

Estados de `status` y qué hace la pantalla:

| `status`                                       | Pantalla                                         |
| ---------------------------------------------- | ------------------------------------------------ |
| `waiting_tap`, `authorising`                   | Muestra el progreso                              |
| `approved`, `completed`                        | Nada: espera la orden por el canal de la máquina |
| `declined`, `rejected`, `timeout`, `cancelled` | Pago cerrado sin cobro (SaleMessage 3, 1, 2 y 4) |

Cinco consultas fallidas seguidas dan el pago por perdido (`offline`).

## Canal de la máquina

Una conexión persistente por pantalla (hoy WebSocket), abierta al arrancar en modo `s2s`. Si está caída, la venta falla al momento como `offline`, porque la orden de dispensar nunca llegaría.

| Sentido             | Mensaje                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| servidor → pantalla | `{ type: 'dispense', paymentId, productCode, authCode, method: card\|wallet }`. Sustituye a `payment_approved` + `dispense` |
| pantalla → servidor | `{ type: 'dispense_result', paymentId, success }`. `false` dispara el reembolso                                             |

El simulador envía cada orden a todas las pantallas y cada una ignora las de pagos que no abrió. El canal real tendrá que dirigirla a la máquina correcta (por ejemplo, un topic MQTT por máquina).

Reconexión: espera exponencial de 1 s, 2 s, 4 s… hasta 30 s, con variación aleatoria. Una caída da por fallido (`offline`) el pago que esperaba la orden. Aún no hay heartbeat.

## Entrega fallida (para probar el reembolso)

A la derecha de la máquina hay un botón **«Fail next delivery»**. No depende de la URL, porque en una pantalla grande puede no haber forma de tocarla. Al activarlo, en la siguiente venta el producto se atasca en la espiral en lugar de caer, la pantalla envía `dispense_result` con `success=false` y muestra «Not delivered / Refund issued». Ahí termina su ciclo: el reembolso lo hace el backend y se comprueba allí. El botón se desactiva solo después de usarse y no se puede cambiar a mitad de una entrega. Funciona igual en modo demo y en `s2s`.

## Preguntas abiertas para backend

1. Rutas y nombres de campos reales, en especial el del ID del pago en la respuesta del `POST`.
2. ¿Qué servicio responde al polling? En los repos locales no hay ningún endpoint de estado de pago S2S.
3. ¿El canal de la máquina será WebSocket o MQTT? ¿Cómo se dirige la orden a cada pantalla?
4. Autenticación de la pantalla sin BFF: la credencial queda en el tótem. Propuesta: un token del showroom limitado a sus Spots.
5. CORS para el origen del tótem.
6. ¿Quién traduce `spot` → `device_id` ahora que no hay BFF?
7. ¿Existe `authorising`? payments-api no recibe hoy ningún aviso del tap.
8. ¿Hay cancelación en el nuevo flujo?
9. ¿Dónde se comprueba, en el backend, que `dispense_result=false` reembolsó ese pago (prueba de extremo a extremo)?
