import path from 'node:path';
import { defineConfig } from '@playwright/test';
import mockConfig from './playwright.config.mock';

const servers = (Array.isArray(mockConfig.webServer) ? mockConfig.webServer : []).filter((server) =>
  server.command.endsWith('start-server.js'),
);

export default defineConfig({
  ...mockConfig,
  testDir: 'insights',
  outputDir: 'insights/.test-results',
  timeout: 90_000,
  retries: 0,
  reporter: [['line']],
  webServer: servers.map((server) => ({
    ...server,
    env: {
      ...server.env,
      CONFIG_PATH: path.resolve(__dirname, 'config/librechat.insights.yaml'),
      ENDPOINTS: 'openAI,agents',
      OPENAI_MODELS: 'gpt-4o-mini',
      ASSISTANTS_API_KEY: '',
      ENABLE_INSIGHTS: 'true',
      E2E_USE_MEMORY_MONGO: 'true',
    },
  })),
});
