# Pantalla ↔ Payments API (QIM-488)

**Estado: endpoints definitivos.** La pantalla de vending cobra en el **Spot Pro** de la pared a través de la Payments API de Frekuent, siguiendo el flujo real de una máquina expendedora: la API avisa de que el pago está aprobado, la pantalla «dispensa» (la animación) y confirma a la API que ha dispensado. La API manda: si algo de aquí no encaja con lo que devuelve, se avisa en vez de adaptar el contrato.

Código: [`src/features/payments/api/s2s/`](../src/features/payments/api/s2s/) (`protocol.ts` es el contrato). El simulador de [`../showroom-bff`](../../showroom-bff) implementa el mismo contrato para desarrollar y probar sin el back real.

## Con quién habla la pantalla

| Servicio     | Para qué                                                | Pruebas (túnel ngrok)                                              |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------ |
| auth-service | `POST /clients/token` y `/clients/token/refresh`        | `https://neatly-movable-mouse.ngrok-free.dev/auth`                 |
| Payments API | `create`, `pay`, `status`, `dispense`, `cancel`, `list` | `https://neatly-movable-mouse.ngrok-free.dev/payments/v1/external` |

Producción: URLs pendientes. En el túnel de pruebas, todas las peticiones llevan `ngrok-skip-browser-warning: 1` (la pantalla y la APK la añaden solas si la URL es de ngrok). El túnel solo está abierto mientras se prueba.

Sin callback, MQTT ni WebSocket: la pantalla se entera de todo **preguntando** (`GET /{uuid}/status`), detrás de la interfaz `PaymentStatusSource` por si un día cambia el canal.

## Credenciales y CORS

- **El `client_secret` nunca va en el JavaScript de la web ni en el repositorio.** Vive en la APK (`android/local.properties`, ignorado por git → `BuildConfig`). La APK pide y renueva el token y a la web solo le da el `access_token` por el puente `ShowroomNative.getAccessToken`. El puente solo atiende a la página que abrió la propia APK.
- **CORS:** la Payments API no lo tiene. En pruebas lo añade el túnel ngrok, así que `fetch` desde la WebView funciona; en producción las peticiones van por la parte nativa (`ShowroomNative.request`, solo hacia la URL de pagos configurada en la APK). `VITE_HTTP_VIA` = `auto` (nativo dentro de la APK, `fetch` fuera) · `native` · `fetch`.
- **Desarrollo local:** con `pnpm dev:*` la página puede pedir el token ella misma con `SHOWROOM_DEV_CLIENT_CODE` / `SHOWROOM_DEV_CLIENT_SECRET` en un `.env.<modo>.local`. `vite.config.ts` solo las inyecta en el servidor de desarrollo: **una build nunca las lleva** (comprobado buscando las credenciales en los bundles).
- Token cacheado con su caducidad (3600 s) y renovado con menos del 20 % de vida; si el refresh falla, se pide uno nuevo. Un `401·100/101` en pagos renueva **una vez** y repite la llamada.

## Flujo

```
Visitante elige producto (toque o código de dos dígitos)
  Pantalla → API   POST /create  {amount, device_serial, product_description}
  Pantalla → API   POST /{uuid}/pay  {await_dispense: true}      → el Spot muestra el cobro 60 s
  Pantalla → API   GET /{uuid}/status  cada 2 s (más lento pasado el primer minuto)
Visitante acerca la tarjeta
  API              status = "authorized"   ← cargo retenido: DISPENSA YA
Pantalla anima la entrega (o el atasco, con «Fail next delivery»)
  Pantalla → API   POST /{uuid}/dispense  {success}   → 204
  API              true → "completed" · false → "refunded" (el Spot devuelve el cargo)
  Pantalla         sigue el cobro en segundo plano hasta completed/refunded (máx. 120 s)
```

- **Un solo cobro abierto a la vez**: un `/create` espera a que el anterior haya terminado.
- `⌫` mientras se espera la tarjeta → `POST /cancel {reason: "USER_ABORT"}`. Si ya no se puede cancelar (`409·409`, ya pagó), la venta sigue con el estado real.
- Si nadie paga en **100 s**, la pantalla cancela con `TIMEOUT`.
- `/dispense` va **siempre, una vez**, al acabar la animación. Nunca se deja un `authorized` sin informar.
- El cobro abierto se guarda (`localStorage`: `{uuid, phase}`) para recuperarse de un reinicio.

## Endpoints (contrato exacto)

Base de pagos con `Authorization: Bearer <token>` y JSON. Importes en **céntimos**. Los errores son `{ error_code, error, message }` y decide `error_code`.

| Llamada                                   | Body                                              | 200                                                              |
| ----------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /create`                            | `{ amount, device_serial, product_description? }` | `{ transaction_uuid, status: pending, status_code }`             |
| `POST /{uuid}/pay`                        | `{ await_dispense: true }`                        | `{ …, status: in_progress }`                                     |
| `GET /{uuid}/status`                      | —                                                 | `{ …, device_serial, amount, currency, created_at, updated_at }` |
| `POST /{uuid}/dispense`                   | `{ success }`                                     | `204` sin cuerpo                                                 |
| `POST /{uuid}/cancel`                     | `{ reason }`                                      | `{ …, status: cancelled }`                                       |
| `GET /list?date_from&device_serial&limit` | —                                                 | `{ items, total, limit, offset }`                                |

Estados: `pending` 100 · `in_progress` 110 · `authorized` 120 · `completed` 200 · `failed` 400 · `cancelled` 410 · `timeout` 420 · `refunded` 430 (los cinco últimos son finales).

## Errores y qué hace la pantalla

| Situación                                       | Pantalla                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `/create` → `403·200/201/202/204` o `409·402`   | Pasa a **modo simulado** el resto de la sesión, con la marca «demo»          |
| `/create` → `409·400 conflict`                  | Recupera el cobro huérfano (abajo) y vuelve a intentarlo una vez             |
| `/create` sin respuesta                         | Reintenta una vez                                                            |
| `/pay` sin respuesta                            | `GET /status`: `in_progress` sigue; `pending` reintenta `/pay`               |
| `/pay` rechazado                                | `POST /cancel {DEVICE_ERROR}` y «Offline»                                    |
| `/status` falla (red o 5xx)                     | No corta la espera: siguiente ciclo                                          |
| `/dispense` red, 5xx o `409·410 not_completed`  | Reintenta con el mismo `success` (1 s, 2 s, 4 s)                             |
| `/dispense` `409·415` / `409·412` / `409·414`   | Ya llegó / ya devuelto / caducado: no reintenta                              |
| 5xx en cualquier llamada que no sea `/status`   | Reintenta 2 veces (1 s y 3 s)                                                |
| `failed` / `timeout` / `cancelled` / `refunded` | «Declined» / «Timed out» / «Cancelled» / «Not completed», y vuelta al inicio |

**Recuperación al arrancar** (y ante `409·400`): el cobro guardado, o si no hay, `GET /list` de las últimas 24 h de este Spot. `pending`/`in_progress` → `cancel {DEVICE_ERROR}`; `authorized` sin `/dispense` informado → `/dispense {success: false}` (el visitante no vio caer el producto: se le devuelve); final → nada.

## Modos

- **Real** (`VITE_PAYMENT_MODE=s2s`): todo lo anterior.
- **Simulado** (`demo`, por defecto): el pago simulado de siempre. También se activa solo si el Spot no está disponible (ver errores). Se ve la marca «demo».
- **Fallo de entrega**: botón «Fail next delivery» a la derecha de la máquina. La siguiente entrega se atasca, se envía `/dispense {success: false}` y la pantalla muestra «Not delivered» y «Refund issued», 5 s cada uno.

## Configuración

| Variable (`.env.<modo>` o Vercel) | Ejemplo (pruebas)                                                    |
| --------------------------------- | -------------------------------------------------------------------- |
| `VITE_PAYMENT_MODE`               | `s2s`                                                                |
| `VITE_AUTH_URL`                   | `https://neatly-movable-mouse.ngrok-free.dev/auth` (solo `pnpm dev`) |
| `VITE_PAYMENTS_URL`               | `https://neatly-movable-mouse.ngrok-free.dev/payments/v1/external`   |
| `VITE_DEVICE_SERIAL`              | `105640` (Spot Pro de pruebas)                                       |
| `VITE_POLL_MS`                    | `2000` (el brief propone 1000)                                       |
| `VITE_HTTP_VIA`                   | `auto`                                                               |

En la APK (`android/local.properties`): `showroomAuthUrl`, `showroomPaymentsUrl`, `showroomClientCode`, `showroomClientSecret`. La `VITE_PAYMENTS_URL` de la web y `showroomPaymentsUrl` de la APK tienen que coincidir: la APK rechaza peticiones a cualquier otra dirección.

## Pendiente

- URLs de producción de auth y pagos, y `DEVICE_SERIAL` del Spot definitivo de la pared.
- CORS en producción: hasta que la API lo active, en la APK las peticiones van por la parte nativa.
- Precios reales de los productos de la demo.
- Pruebas de aceptación del brief (§12) contra el entorno de pruebas con el Spot real: **no hechas**; todo está probado contra el simulador.
