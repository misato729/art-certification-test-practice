import { defineConfig, devices } from '@playwright/test'
import { e2eSettings } from './scripts/e2e-settings.mjs'

const settings = e2eSettings()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: settings.origin,
    actionTimeout: 10000,
    navigationTimeout: 20000,
    // Traces include auth bodies/Cookies. Keep only masked failure screenshots.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `${settings.origin}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 },
    stdout: 'pipe', stderr: 'pipe',
  },
})
