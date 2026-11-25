# Frekuent Showroom

Pantalla del tótem del showroom: simula máquinas de venta (vending, café, autolavado) que cobran con Spots Frekuent reales. Contexto, decisiones y fases en [PLAN.md](PLAN.md).

## Arrancar

```bash
pnpm install
pnpm dev          # http://localhost:5180
```

| Script                      | Qué hace                              |
| --------------------------- | ------------------------------------- |
| `pnpm dev`                  | Servidor de desarrollo                |
| `pnpm build`                | Typecheck + build estática en `dist/` |
| `pnpm test`                 | Tests (Vitest)                        |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                     |

## Modos

- **demo** (por defecto): pagos simulados en el propio navegador (`MockGateway`). En vending se paga tocando el hueco del Spot Pro ("Tap here (demo)"). Es el modo seguro para ferias sin red.
- **s2s**: pagos reales, sin BFF (`S2sGateway`). La pantalla abre la venta con un `POST` al servicio de pagos y consulta su estado por polling. La **orden de dispensar**, que trae también la aprobación, llega por el canal de la máquina (WebSocket, quizá MQTT). Por ese mismo canal la pantalla confirma la entrega con `dispense_result`. Protocolo provisional en [docs/s2s-protocol.md](docs/s2s-protocol.md).

En los dos modos, el botón **«Fail next delivery»** (a la derecha de la máquina) hace que la siguiente entrega se atasque y que se envíe `dispense_result=false` para probar el reembolso.

Probar el modo s2s en local:

```bash
cd ../showroom-bff && pnpm start   # terminal 1 → panel en http://localhost:8787
pnpm dev                           # terminal 2 → http://localhost:5180/?mode=s2s
```

El simulador vive fuera de este repo, en [`../showroom-bff`](../showroom-bff). Mientras no haya endpoints definitivos, hace de servicio de pagos (HTTP), canal de la máquina, firmware y APK. En su panel tú eres el visitante delante del Spot.

Parámetros de URL útiles en el kiosco: `?mode=demo|s2s`, `?api=https://…`, `?ws=wss://…`, `?scale=1|0.76`.

## Estructura

Misma organización _feature-first_ que Space (`dashboard-app`). Reglas y dónde va cada cosa en [AGENTS.md](AGENTS.md).

```
src/
├─ app/                      Shell: App, reset por inactividad, badge "demo"
├─ features/
│  ├─ payments/              Un único pago en curso, compartido por todos los escenarios
│  │  ├─ domain/             types.ts, machine.ts (máquina de estados pura)
│  │  ├─ api/                gateway.ts (elige mock o s2s), mock/, s2s/ (HTTP + canal de la máquina + protocolo)
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
   ├─ config/                Flags de entorno (modo, WebSocket, escala)
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
