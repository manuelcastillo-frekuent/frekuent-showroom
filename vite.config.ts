/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
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
});
