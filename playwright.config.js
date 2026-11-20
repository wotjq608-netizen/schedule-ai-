const { defineConfig } = require('@playwright/test');

const baseURL = 'https://127.0.0.1:8765';

module.exports = defineConfig({
  testDir: './tests',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, ignoreHTTPSErrors: true },
  webServer: {
    command: 'python tests/browser_server.py',
    url: baseURL + '/login',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
