// Passenger entry point on Hostinger shared hosting. CRM_APP_URL and
// CRM_DATABASE_PATH live in ~/autoneural-crm/.env.production, outside the
// web root and the release directory.
const { join } = require("node:path");
process.loadEnvFile(join(__dirname, "..", ".env.production"));
require("./server.js");
