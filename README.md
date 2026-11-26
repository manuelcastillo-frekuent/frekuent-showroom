# Frekuent Showroom

Pantalla del tótem del showroom: simula máquinas de venta (vending, café, autolavado) que cobran con Spots Frekuent reales. Contexto, decisiones y fases en [PLAN.md](PLAN.md).

## Arrancar

```bash
pnpm install
pnpm dev          # http://localhost:5180
```

| Script                      | Qué hace                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                  | Servidor de desarrollo en modo demo                           |
| `pnpm dev:local`            | Pagos `s2s` contra los servicios simulados (`.env.simulator`) |
| `pnpm dev:services`         | Pagos `s2s` contra la Payments API real (`.env.services`)     |
| `pnpm build`                | Typecheck + build estática en `dist/`, en modo demo           |
| `pnpm build:services`       | Igual, contra los endpoints definitivos                       |
| `pnpm test`                 | Tests (Vitest)                                                |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                             |

## Modos

- **demo** (por defecto): pagos simulados en el propio navegador (`MockGateway`). En vending se paga tocando el hueco del Spot Pro ("Tap here (demo)"). Es el modo seguro para ferias sin red.
- **s2s**: cobro real en el Spot Pro a través de la **Payments API** de Frekuent (`S2sGateway`), sin BFF: `create` + `pay`, polling de `/status` y, cuando llega `authorized`, la entrega y `POST /dispense`. Las credenciales viven en la APK, nunca en la web. Si el Spot no está disponible, la pantalla pasa sola a modo simulado. Contrato y errores en [docs/s2s-protocol.md](docs/s2s-protocol.md).

En los dos modos, el botón **«Fail next delivery»** (a la derecha de la máquina) hace que la siguiente entrega se atasque y que se envíe `/dispense` con `success=false` para probar el reembolso.

Probar el modo s2s en local:

```bash
cd ../showroom-bff && pnpm dev     # terminal 1 → panel en http://localhost:8787
pnpm dev:local                     # terminal 2 → http://localhost:5180
```

## Entornos (`.env`)

La configuración va por modos de Vite. Los `.env` **no se suben a git**: cada uno crea los suyos en la raíz con las variables de abajo.

| Archivo          | Modo        | Para qué                                                                            |
| ---------------- | ----------- | ----------------------------------------------------------------------------------- |
| _(ninguno)_      | por defecto | Demo: pagos simulados en el navegador. Es lo que sale con `pnpm dev` y `pnpm build` |
| `.env.simulator` | `simulator` | Local: `s2s` contra [`../showroom-bff`](../showroom-bff) en `localhost:8787`        |
| `.env.services`  | `services`  | Payments API real (hoy, el entorno de pruebas por túnel ngrok)                      |

Variables: `VITE_PAYMENT_MODE` (`demo` | `s2s`), `VITE_AUTH_URL`, `VITE_PAYMENTS_URL`, `VITE_DEVICE_SERIAL`, `VITE_POLL_MS`, `VITE_HTTP_VIA` y `VITE_MACHINE_SCALE` (`1` o `0.76`); detalle en [docs/s2s-protocol.md](docs/s2s-protocol.md#configuración). Los parámetros `?mode=` y `?scale=` del kiosco tienen prioridad sobre el archivo.

**Credenciales**: nunca en un `.env` normal ni en Vercel, porque todo lo `VITE_*` acaba en el JavaScript público. En la APK van en `android/local.properties`; para `pnpm dev:*` en tu equipo, `SHOWROOM_DEV_CLIENT_CODE` y `SHOWROOM_DEV_CLIENT_SECRET` en `.env.<modo>.local` (solo el servidor de desarrollo las usa; una build no las incluye).

El simulador vive fuera de este repo, en [`../showroom-bff`](../showroom-bff). Mientras no haya endpoints definitivos, hace de servicio de pagos (HTTP), firmware y APK. En su panel tú eres el visitante delante del Spot.

Parámetros de URL útiles en el kiosco: `?mode=demo|s2s`, `?api=https://…`, `?scale=1|0.76`.

## Estructura

Misma organización _feature-first_ que Space (`dashboard-app`). Reglas y dónde va cada cosa en [AGENTS.md](AGENTS.md).

```
src/
├─ app/                      Shell: App, reset por inactividad, badge "demo"
├─ features/
│  ├─ payments/              Un único pago en curso, compartido por todos los escenarios
│  │  ├─ domain/             types.ts, machine.ts (máquina de estados pura)
│  │  ├─ api/                gateway.ts (elige mock o s2s), mock/, s2s/ (Payments API: token, HTTP web o nativo, polling, recuperación)
│  │  ├─ store/              paymentStore.ts (estado + acciones)
│  │  ├─ hooks/              usePayment
│  │  └─ index.ts            API pública
│  └─ vending/               Escenario máquina de snacks
│     ├─ domain/             products.ts, keypad.ts
│     ├─ hooks/              useVendingMachine (teclado, venta, auto-reset)
│     ├─ components/         Piezas de la máquina: cristal, display, teclado, Spot, bandeja…
│     ├─ utils/              displayLines (textos del display)
│     ├─ pages/              VendingPage (solo composición)
│     └─ index.ts
└─ shared/                   Sin lógica de negocio
   ├─ stage/                 Lienzo 2160×3840 escalado al viewport; u() y box()
   ├─ config/                Flags de entorno (modo, servicio de pagos, escala)
   ├─ utils/                 format.ts
   ├─ styles/                index.css
   └─ assets/                Fuentes
```

Todo el layout se hace en píxeles del lienzo 2160×3840 (el arte de Pau está a ese tamaño); `Stage` lo escala a la pantalla real.

## Ligera a propósito

La pantalla del tótem tiene una GPU modesta y puede que su WebView no se actualice nunca. Por eso:

- Las únicas dependencias de ejecución son `react` y `react-dom`. El estado de pago usa `useSyncExternalStore` y los mensajes del servidor se validan a mano (`parseServerMessage`).
- Los estilos son CSS propio (`src/shared/styles/index.css`) y estilos en línea, sin framework.
- Las animaciones son CSS y solo tocan `transform` y `opacity`.
- La build apunta a `chrome100` (`vite.config.ts`).

## Despliegue

`Dockerfile` (build estática + nginx). La pantalla Android abre la URL en un navegador en modo kiosco.

# frekuent-showroom
