# APKs del tótem (WebView)

El APK solo envuelve la web: un `WebView` a pantalla completa. Hay dos variantes, que se pueden instalar a la vez en el mismo dispositivo:

|                   | **Showroom Offline**                  | **Showroom Online**                                               |
| ----------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Paquete           | `com.frekuent.showroom.offline`       | `com.frekuent.showroom.online`                                    |
| Icono             | Isotipo sobre morado oscuro `#27225C` | Isotipo sobre morado `#673FFF`                                    |
| Web               | Va dentro del APK (`../dist`)         | https://frekuent-showroom.vercel.app                              |
| Red               | No la necesita (modo demo)            | Necesaria; sin red deja la pantalla en negro y reintenta cada 5 s |
| Actualizar la web | Recompilar y reinstalar el APK        | Redesplegar en Vercel y reabrir la app                            |
| Para              | Ferias sin red o con red poco fiable  | Oficina y sitios con buena red; modo s2s                          |

La web empaquetada se sirve desde `https://appassets.androidplatform.net` y no desde `file://`, porque Chromium no carga módulos ES desde `file://`.

## Compilar

Hace falta el JDK que trae Android Studio (no hay Java en el PATH) y `local.properties` con `sdk.dir` (no se versiona).

```powershell
pnpm build
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio1\jbr"
cd android; .\gradlew.bat assembleOfflineDebug assembleOnlineDebug
```

Salen en `android/app/build/outputs/apk/offline/debug/app-offline-debug.apk` (~1,1 MB) y `…/online/debug/app-online-debug.apk` (~0,9 MB). Están firmados con la clave debug. `pnpm build` solo hace falta para la Offline.

La Online apunta a Vercel por defecto. Para otra web, o para el modo s2s:

```powershell
.\gradlew.bat assembleOnlineDebug "-PshowroomUrl=https://frekuent-showroom.vercel.app/?mode=s2s&ws=wss://…"
```

## Web en Vercel

Proyecto `frekuent-showroom`, modo demo por defecto. Se sube la build ya hecha, así que lo que cuenta es el modo de la build (`pnpm build`, demo; ver _Entornos_ en el README de la raíz), no las variables de Vercel. El `vercel.json` de la raíz copia las cabeceras de caché de `nginx.conf`.

Redesplegar (con `npx vercel login` hecho una vez). `pnpm build` vacía `dist/`, así que el proyecto se indica por variables de entorno en vez de con `vercel link`; así tampoco se crea un `.env.local` con token dentro de `dist/`:

```powershell
pnpm build
Copy-Item vercel.json dist\
$env:VERCEL_ORG_ID = "team_gqKu406Tcc9O0nQB7TxFwwNv"; $env:VERCEL_PROJECT_ID = "prj_jyLx3fiSusibIn949sHHcb6zybnH"
cd dist; npx vercel deploy --prod --yes
```

Volver a una versión anterior sin recompilar: `npx vercel rollback` (o _Deployments → Promote_ en el panel).

## Instalar en un dispositivo

**Por USB o red con adb** (activar antes Opciones de desarrollador → Depuración USB):

```powershell
adb devices
adb install -r android\app\build\outputs\apk\offline\debug\app-offline-debug.apk
adb install -r android\app\build\outputs\apk\online\debug\app-online-debug.apk
```

Por red: `adb connect <ip>:5555` (en Android 11+ usar "Depuración inalámbrica" y `adb pair`).

**Sin adb** (pendrive, descarga): copiar el APK, abrirlo con el gestor de archivos y permitir "Instalar apps desconocidas" para esa app. En pantallas sin Google Play es la vía normal.

Abrir una con otra URL sin recompilar:

```powershell
adb shell am start -n com.frekuent.showroom.online/com.frekuent.showroom.MainActivity -e url "http://192.168.1.50:5180/?mode=s2s"
```

**Arrancar al encender**: las dos se declaran como app de inicio (HOME). Al pulsar Inicio, Android pregunta qué launcher usar; elegir la que toque en ese sitio → "Siempre".

La primera vez Android muestra el aviso "Viendo a pantalla completa"; se acepta una vez.

## Qué comprobar en el hardware real

- **Versión del WebView**, la que manda (la build apunta a `chrome100`):
  `adb shell dumpsys package com.google.android.webview | findstr versionName`
  (en algunos AOSP el paquete es `com.android.webview`).
- Que deje instalar un APK de fuera y fijarlo como launcher.
- FPS de las animaciones a 4K: `chrome://inspect` desde el PC con la build debug → Performance.
- Escala: `-e url "https://appassets.androidplatform.net/index.html?scale=0.76"`.

## Depurar

Con la build debug, el WebView sale en `chrome://inspect` del Chrome del PC (consola, DOM, red).

## Probado

2026-11-24, emulador Pixel API 37 (WebView 145): las dos instaladas a la vez, con icono y nombre propios. Offline: flujo demo completo (código 21 → pago en el Spot → entrega). Online: carga Vercel; arrancada sin red deja la pantalla en negro y carga sola al volver la red. Falta: dispositivo real con WebView antiguo.
