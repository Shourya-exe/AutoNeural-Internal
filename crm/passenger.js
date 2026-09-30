/**
 * Hostinger/Passenger entry point.
 *
 * Keep production secrets outside the deployed source archive in
 * `.env.production`, then let the regular Next.js server own the HTTP server.
 */
const { join } = require("node:path");

process.loadEnvFile(join(__dirname, ".env.production"));
require("./server.js");
