/**
 * Custom Node entrypoint for managed hosts that ask for an
 * "Application startup file" rather than running `npm start`
 * (Hostinger Cloud / hPanel Node.js apps, cPanel Passenger, and similar).
 *
 * On a VPS you do not need this — use `npm start` (see ecosystem.config.cjs).
 *
 * Requires `npm run build` to have produced .next/ first.
 */
const { createServer } = require("node:http");
const next = require("next");

const port = Number(process.env.PORT) || 3000;
// Managed hosts proxy to the app, so bind to all interfaces unless told otherwise.
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => {
      handle(req, res).catch((err) => {
        console.error("[server] request failed", err);
        res.statusCode = 500;
        res.end("Internal Server Error");
      });
    }).listen(port, hostname, () => {
      console.log(`AutoNeural CRM listening on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error("[server] failed to start", err);
    process.exit(1);
  });
