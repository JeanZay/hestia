import { defineConfig, devices } from '@playwright/test';

// Hosted runs select only the guarded mocks. The owned local bench additionally
// runs the existing Agenda/API and Outgoing regression suites on synthetic data.
const baseURL = process.env.HESTIA_QUALIFICATION_BASE_URL ?? 'http://127.0.0.1:3210';
const owned = new URL(baseURL).origin === 'http://127.0.0.1:3210' && process.env.HESTIA_ENVIRONMENT === 'local'
  && /^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? '');
export default defineConfig({
  testDir: '../../e2e', testMatch: owned ? ['agenda-dictation.spec.ts', 'agenda.spec.ts', 'outgoing-dictation.spec.ts'] : 'agenda-dictation.spec.ts', workers: 1, retries: 0,
  timeout: 90000, reporter: 'list', use: { baseURL, trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
