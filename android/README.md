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

### Payments API: credenciales en la APK

El `client_secret` del showroom **no puede ir en la web** (todo lo que carga la WebView es público), así que la APK lo guarda y hace de intermediaria con el puente `ShowroomNative` ([`ShowroomNative.java`](app/src/main/java/com/frekuent/showroom/ShowroomNative.java)):

- `getAccessToken`: pide y renueva el token al auth-service y a la web solo le da el `access_token`.
- `request`: hace la petición HTTP desde Android, donde no hay CORS (la Payments API no lo tiene). Solo acepta la URL de pagos configurada.
- Solo atiende a la página que abrió la propia APK.

Se configura en `android/local.properties` (ignorado por git; nunca se sube):

```properties
showroomAuthUrl=https://neatly-movable-mouse.ngrok-free.dev/auth
showroomPaymentsUrl=https://neatly-movable-mouse.ngrok-free.dev/payments/v1/external
showroomClientCode=…
showroomClientSecret=…
```

También valen como `-P` u `ORG_GRADLE_PROJECT_<nombre>`. Cambiar estas URLs o credenciales **sí obliga a recompilar y reinstalar** la APK. Sin ellas, la APK funciona igual en modo demo.

```powershell
pnpm build
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio1\jbr"
cd android; .\gradlew.bat assembleOfflineDebug assembleOnlineDebug
```

Salen en `android/app/build/outputs/apk/offline/debug/app-offline-debug.apk` (~1,1 MB) y `…/online/debug/app-online-debug.apk` (~0,9 MB). Están firmados con la clave debug. `pnpm build` solo hace falta para la Offline.

La Online apunta a Vercel y no hay que recompilarla para cambiar de modo ni de servicios: eso se decide en Vercel (abajo). Solo para apuntarla a otra web, por ejemplo la pantalla servida desde un equipo de pruebas:

```powershell
$env:ORG_GRADLE_PROJECT_showroomUrl = "http://<ip-del-equipo>:5180/?api=http://<ip-del-equipo>:8787/api"
.\gradlew.bat assembleOnlineDebug
```

La URL va por variable de entorno porque `gradlew.bat` corta en el `&` si se pasa con `-P`. Si Gradle no encuentra Java, `$env:JAVA_HOME` apunta al `jbr` de Android Studio.

## Web en Vercel

Proyecto `frekuent-showroom`. **Vercel compila la web desde el código** (`vercel.json`: `pnpm install` + `pnpm build`, salida `dist/`) con las variables del proyecto, así que el modo y los servicios se cambian en Vercel y la APK Online los recoge al reabrirse, sin reinstalar.

Variables (_Settings → Environment Variables_, o `npx vercel env add`), por entorno _Production_ / _Preview_:

| Variable             | Valor                                                   |
| -------------------- | ------------------------------------------------------- |
| `VITE_PAYMENT_MODE`  | `demo` (si no se define) o `s2s`                        |
| `VITE_PAYMENTS_URL`  | Payments API; igual que `showroomPaymentsUrl` de la APK |
| `VITE_DEVICE_SERIAL` | Serie del Spot Pro de la pared                          |
| `VITE_POLL_MS`       | Intervalo de polling (ms)                               |
| `VITE_MACHINE_SCALE` | `1` (86″) o `0.76` (65″)                                |

**Nunca** pongas credenciales en Vercel: las variables `VITE_*` acaban en el JavaScript público.

Una variable cambiada solo vale desde el siguiente despliegue. Desplegar (con `npx vercel login` hecho una vez), desde la raíz del repo; `.vercelignore` deja fuera `android/`, `dist/` y cualquier `.env`:

```powershell
$env:VERCEL_ORG_ID = "team_gqKu406Tcc9O0nQB7TxFwwNv"; $env:VERCEL_PROJECT_ID = "prj_jyLx3fiSusibIn949sHHcb6zybnH"
npx vercel deploy          # preview, para probar
npx vercel deploy --prod   # producción: lo que carga la APK Online
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
