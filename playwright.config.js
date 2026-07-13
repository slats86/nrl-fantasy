'use strict';
const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './browser-test', timeout: 60000, workers: 1,
  use: {baseURL: 'http://127.0.0.1:32188', headless: true},
  webServer: {
    command: 'node server.js', url: 'http://127.0.0.1:32188/ready', reuseExistingServer: false,
    env: {
      PORT:'32188', APP_URL:'http://127.0.0.1:32188', NODE_ENV:'test',
      DATA_DIR:`/tmp/nrl-browser-data-${process.pid}`,
      EMAIL_CAPTURE_FILE:'/tmp/nrl-browser-email-capture.json',
      ADMIN_EMAILS:'owner@example.com'
    }
  }
});
