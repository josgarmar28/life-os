import { defineConfig } from '@playwright/test';

// Pruebas end-to-end contra el Supabase local de scripts/e2e/stack.sh (nunca contra el real).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 }, // iPhone 13/14
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Zurich',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
