# Showroom — Agent Instructions

Pantalla del tótem del showroom. Contexto en [README.md](README.md) y [PLAN.md](PLAN.md); protocolo con los servicios (HTTP + canal de la máquina, sin BFF) en [docs/s2s-protocol.md](docs/s2s-protocol.md).

```bash
pnpm dev | pnpm typecheck | pnpm test | pnpm lint | pnpm format
```

## Arquitectura (feature-first, como Space)

- **`src/app/`** — shell: `App`, hooks y componentes que solo usa el shell.
- **`src/features/<name>/`** — cada feature es autocontenida:
  - `domain/` — TypeScript puro: tipos, máquinas de estado, catálogos. Sin React, sin otras features, sin `api/`/`hooks/`/`components/` (ESLint lo impide).
  - `api/` — comunicación con el exterior (gateways de pago, protocolo).
  - `store/` — estado compartido fuera de React (`useSyncExternalStore`).
  - `hooks/` — comportamiento. Aquí vive la lógica de la pantalla, no en los componentes.
  - `components/` — piezas visuales que reciben datos por props. Sin lógica de negocio.
  - `utils/` — funciones puras de presentación (textos, formatos), con test.
  - `pages/` — solo composición: llaman a un hook y reparten props.
  - `index.ts` — API pública. Otra feature importa solo `@/features/<name>`, nunca rutas internas (ESLint lo impide).
- **`src/shared/`** — agnóstico del negocio: `stage/`, `config/`, `utils/`, `styles/`, `assets/`. Nunca importa features (ESLint lo impide).

Dentro de una feature, imports relativos; entre carpetas de primer nivel, el alias `@/` (`@/*` → `src/*`).

## Reglas propias del tótem

1. **Solo `react` y `react-dom` en ejecución.** Nada de librerías de estado, UI ni CSS.
2. **Layout en píxeles del prototipo**: `box(left, top, width, height)` y `u(px)` de `@/shared/stage/scene`. Los colores de cada máquina van en su `components/palette.ts`.
3. **Animaciones solo con `transform` y `opacity`** (GPU modesta). Clases en `shared/styles/index.css`.
4. **La pantalla nunca dispensa por su cuenta**: espera la orden `dispense` del servidor (ver `features/payments/domain/machine.ts`).
5. **Un escenario nuevo** (café, autolavado…) es una feature nueva con la misma forma que `vending/`, y usa pagos solo vía `usePayment()` de `@/features/payments`.
6. **Tests** (Vitest, entorno `node`) para `domain/`, `api/` y `utils/`. En tests que importan de `@/features/payments`, usa `import type` para no arrancar el gateway.
