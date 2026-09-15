// Passenger entry point on Hostinger Cloud / Shared hosting.
// CRM_APP_URL and CRM_DATABASE_PATH are loaded from .env.production
// located in the application root directory above the release directory.
const { join } = require("node:path");
const { existsSync } = require("node:fs");

const envPaths = [
  join(__dirname, "..", ".env.production"),
  join(__dirname, ".env.production"),
  join(__dirname, ".env"),
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    try {
      if (process.loadEnvFile) {
        process.loadEnvFile(envPath);
      }
      break;
    } catch (e) {
      console.warn("Could not load env file:", envPath, e);
    }
  }
}

require("./server.js");
