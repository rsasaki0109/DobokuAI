import { defineConfig } from '@playwright/test';
const deployedURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: deployedURL || 'http://127.0.0.1:5273',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: deployedURL
    ? []
    : [
        {
          command: `cd ../.. && API_BIND=127.0.0.1:3101 DATABASE_PATH=.local/e2e-${process.pid}.sqlite bash scripts/run-cargo.sh run --locked -p doboku-api`,
          url: 'http://127.0.0.1:3101/api/health',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: 'API_PROXY=http://127.0.0.1:3101 npm run dev -- --port 5273 --strictPort',
          url: 'http://127.0.0.1:5273',
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
