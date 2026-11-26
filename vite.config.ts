/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ command, mode }) => {
  // Client credentials for the page, only for the dev server (`pnpm dev:*`). They are
  // not VITE_* variables, so Vite never exposes them on its own, and a build defines
  // them as null: the secret cannot reach a deployed bundle. Deployed, the APK holds it.
  const dev = loadEnv(mode, process.cwd(), 'SHOWROOM_DEV_');
  const devClient =
    command === 'serve' && dev.SHOWROOM_DEV_CLIENT_CODE && dev.SHOWROOM_DEV_CLIENT_SECRET
      ? { clientCode: dev.SHOWROOM_DEV_CLIENT_CODE, clientSecret: dev.SHOWROOM_DEV_CLIENT_SECRET }
      : null;

  return {
    plugins: [react()],
    define: { __DEV_CLIENT_CREDENTIALS__: JSON.stringify(devClient) },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5180 },
    build: {
      // The totem's Android 13 WebView may never update past its factory Chromium.
      target: 'chrome100',
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
