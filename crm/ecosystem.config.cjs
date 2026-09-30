/**
 * PM2 process definitions for AutoNeural CRM.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Three processes:
 *   autoneural-crm     — the Next.js server (bound to localhost; nginx proxies to it)
 *   autoneural-worker  — BullMQ consumer + periodic SLA sweeps
 *   autoneural-voice   — the LiveKit voice agent (agent.py); needs `.venv-agent`
 *                        (python3 -m venv .venv-agent && .venv-agent/bin/pip install -r requirements.txt)
 *
 * The worker MUST run for follow-up reminders, overdue escalations and failed
 * webhook retries to happen. Without it the app still serves and still ingests
 * (inline fallback), but nothing sweeps.
 */
module.exports = {
  apps: [
    {
      name: "autoneural-crm",
      cwd: __dirname,
      script: "npm",
      args: "start",
      instances: 1,
      autorestart: true,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
      },
      out_file: "./logs/crm-out.log",
      error_file: "./logs/crm-error.log",
      time: true,
    },
    {
      name: "autoneural-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker:start",
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
      out_file: "./logs/worker-out.log",
      error_file: "./logs/worker-error.log",
      time: true,
    },
    {
      name: "autoneural-voice",
      cwd: __dirname,
      script: "agent.py",
      args: "start",
      interpreter: require("path").join(__dirname, ".venv-agent", "bin", "python"),
      instances: 1,
      autorestart: true,
      kill_timeout: 30000, // let in-progress calls finish and post to the CRM
      out_file: "./logs/voice-out.log",
      error_file: "./logs/voice-error.log",
      time: true,
    },
  ],
};
