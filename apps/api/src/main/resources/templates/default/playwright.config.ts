import fs from 'fs';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || '{{baseUrl}}';

// AI-TestOps 로그인 선행 시나리오(프로젝트 설정 > 로그인 선행 시나리오)가 만든 세션을 재사용한다.
// 설정 안 했거나 세션 파일이 아직 없으면 undefined로 남아 평소처럼 로그인 없이 시작한다.
const storageStatePath = process.env.PLAYWRIGHT_STORAGE_STATE;
const storageState = storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: baseURL || 'https://example.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
