import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './test/e2e', testMatch: '*.pw.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5180', viewport: { width: 1440, height: 1100 }, launchOptions: { channel: 'chrome' } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180', url: 'http://127.0.0.1:5180', reuseExistingServer: true },
})
