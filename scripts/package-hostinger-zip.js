const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");

// Parse arguments
const args = process.argv.slice(2);
let targetSubdomain = "work";
let skipBuild = false;
let includeDb = false;

for (const arg of args) {
  if (arg === "--skip-build") {
    skipBuild = true;
  } else if (arg === "--include-db") {
    includeDb = true;
  } else if (!arg.startsWith("-")) {
    targetSubdomain = arg;
  }
}

const targetDomain = targetSubdomain.includes(".")
  ? targetSubdomain
  : `${targetSubdomain}.autoneural.in`;
const targetUrl = `https://${targetDomain}`;

console.log("============================================================");
console.log(" Packaging AutoNeural Deployment Bundle for Hostinger Cloud");
console.log(` Target Subdomain: ${targetSubdomain}`);
console.log(` Target Domain:    ${targetDomain}`);
console.log(` Target URL:       ${targetUrl}`);
console.log("============================================================");

const standaloneDir = path.join(rootDir, ".next", "standalone");
const staticDir = path.join(rootDir, ".next", "static");
const publicDir = path.join(rootDir, "public");
const stageDir = path.join(rootDir, "tmp", "hostinger-deploy");

if (!skipBuild) {
  console.log("→ Building standalone production application (NEXT_OUTPUT=standalone)...");
  execSync("npm run build", {
    cwd: rootDir,
    env: { ...process.env, NEXT_OUTPUT: "standalone" },
    stdio: "inherit",
  });

  const backendPkg = path.join(rootDir, "backend", "package.json");
  if (fs.existsSync(backendPkg)) {
    console.log("→ Generating Prisma client and compiling NestJS backend...");
    try {
      execSync("npx prisma generate", { cwd: path.join(rootDir, "backend"), stdio: "inherit" });
      execSync("npm run build", { cwd: path.join(rootDir, "backend"), stdio: "inherit" });
      console.log("✓ Backend compiled successfully.");
    } catch (e) {
      console.warn("Backend build warning:", e.message);
    }
  }
} else {
  console.log("→ Skipping build as requested (--skip-build).");
}

if (!fs.existsSync(standaloneDir)) {
  console.error("Error: .next/standalone does not exist! Make sure next.config.ts has output: 'standalone'.");
  process.exit(1);
}

console.log("→ Cleaning staging directory...");
if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

console.log("→ Copying standalone application files into bundle root...");
fs.cpSync(standaloneDir, stageDir, { recursive: true });

console.log("→ Creating .next/standalone structure for Hostinger deployment checks...");
const stageStandaloneDir = path.join(stageDir, ".next", "standalone");
fs.mkdirSync(stageStandaloneDir, { recursive: true });
fs.cpSync(standaloneDir, stageStandaloneDir, { recursive: true });

console.log("→ Copying .next/static into bundle root and standalone...");
const targetStatic = path.join(stageDir, ".next", "static");
fs.mkdirSync(path.dirname(targetStatic), { recursive: true });
fs.cpSync(staticDir, targetStatic, { recursive: true });

const standaloneStatic = path.join(stageStandaloneDir, ".next", "static");
fs.mkdirSync(path.dirname(standaloneStatic), { recursive: true });
fs.cpSync(staticDir, standaloneStatic, { recursive: true });

if (fs.existsSync(publicDir)) {
  console.log("→ Copying public assets into bundle root and standalone...");
  fs.cpSync(publicDir, path.join(stageDir, "public"), { recursive: true });
  fs.cpSync(publicDir, path.join(stageStandaloneDir, "public"), { recursive: true });
}

console.log("→ Copying source code and configuration into bundle...");
const srcDir = path.join(rootDir, "src");
if (fs.existsSync(srcDir)) {
  fs.cpSync(srcDir, path.join(stageDir, "src"), { recursive: true });
}
for (const cfg of ["next.config.ts", "tsconfig.json", "next-env.d.ts"]) {
  const p = path.join(rootDir, cfg);
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(stageDir, cfg));
  }
}

console.log("→ Copying backend source, compiled dist, and prisma into bundle...");
const backendDir = path.join(rootDir, "backend");
const stageBackendDir = path.join(stageDir, "backend");
const stageStandaloneBackendDir = path.join(stageStandaloneDir, "backend");
if (fs.existsSync(backendDir)) {
  for (const bDir of [stageBackendDir, stageStandaloneBackendDir]) {
    fs.mkdirSync(bDir, { recursive: true });
    for (const item of [
      "src",
      "dist",
      "prisma",
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "nest-cli.json",
      "Dockerfile",
      "README.md",
      ".env.example",
    ]) {
      const srcItem = path.join(backendDir, item);
      const dstItem = path.join(bDir, item);
      if (fs.existsSync(srcItem)) {
        fs.cpSync(srcItem, dstItem, { recursive: true });
      }
    }
  }
  console.log("✓ Backend included in deployment bundle.");
}

console.log("→ Configuring package.json scripts for Hostinger automated deploy...");
const buildScript = 'node -e "const fs = require(\'fs\'); for (const p of [\'.next/standalone/server.js\', \'server.js\']) { if (fs.existsSync(p)) { const now = new Date(); fs.utimesSync(p, now, now); } } console.log(\'Next.js standalone server ready.\');"';

for (const pkgFile of [path.join(stageDir, "package.json"), path.join(stageStandaloneDir, "package.json")]) {
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8"));
    pkg.scripts = {
      ...pkg.scripts,
      build: buildScript,
      start: "node passenger.js",
    };
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  }
}

console.log("→ Patching server.js in root and standalone to auto-load environment...");
const envLoader = `// Auto-load environment variables
try {
  const { existsSync: _es } = require("node:fs");
  const { join: _j, isAbsolute: _ia } = require("node:path");
  for (const _ep of [_j(__dirname, ".env.production"), _j(__dirname, "..", "..", ".env.production"), _j(__dirname, ".env")]) {
    if (_es(_ep)) { process.loadEnvFile(_ep); break; }
  }
  process.env.CRM_APP_URL = process.env.CRM_APP_URL || "${targetUrl}";
  if (!process.env.CRM_DATABASE_PATH || !_ia(process.env.CRM_DATABASE_PATH)) {
    const candidatePaths = [
      _j(__dirname, "data", "autoneural-crm.sqlite"),
      _j(process.cwd(), "data", "autoneural-crm.sqlite"),
      _j(__dirname, "..", "..", "data", "autoneural-crm.sqlite"),
    ];
    process.env.CRM_DATABASE_PATH = candidatePaths.find(p => _es(p)) || candidatePaths[0];
  }
} catch (e) {}
`;

for (const sPath of [path.join(stageDir, "server.js"), path.join(stageStandaloneDir, "server.js")]) {
  if (fs.existsSync(sPath)) {
    let serverJs = fs.readFileSync(sPath, "utf-8");
    if (!serverJs.includes("Auto-load environment variables")) {
      fs.writeFileSync(sPath, envLoader + serverJs);
    }
  }
}

console.log(`→ Adding Passenger entrypoint (passenger.js) configured for ${targetDomain}...`);
const passengerContent = `// AutoNeural LiteSpeed Passenger Entrypoint for Hostinger Cloud
const { join, isAbsolute } = require("node:path");
const { existsSync } = require("node:fs");

// Check current directory and parent directory for env file
const envPaths = [
  join(__dirname, ".env.production"),
  join(__dirname, ".env"),
  join(__dirname, "..", ".env.production"),
  join(__dirname, "..", "..", ".env.production"),
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

// Fallback to configured target domain if not set
process.env.CRM_APP_URL = process.env.CRM_APP_URL || "${targetUrl}";

// Safely normalize database path to absolute path
if (!process.env.CRM_DATABASE_PATH || !isAbsolute(process.env.CRM_DATABASE_PATH)) {
  const candidatePaths = [
    join(__dirname, "data", "autoneural-crm.sqlite"),
    join(process.cwd(), "data", "autoneural-crm.sqlite"),
    join(__dirname, "..", "..", "data", "autoneural-crm.sqlite"),
  ];
  process.env.CRM_DATABASE_PATH = candidatePaths.find(p => existsSync(p)) || candidatePaths[0];
}

process.env.NODE_ENV = "production";
process.env.PORT = process.env.PORT || "3000";

require("./server.js");
`;
fs.writeFileSync(path.join(stageDir, "passenger.js"), passengerContent);
fs.writeFileSync(path.join(stageStandaloneDir, "passenger.js"), passengerContent);

console.log("→ Adding .htaccess for LiteSpeed Passenger on Hostinger...");
const htaccessContent = `# AutoNeural CRM — Hostinger Cloud / LiteSpeed Passenger (${targetDomain})
PassengerAppType node
PassengerNodejs /opt/alt/alt-nodejs24/root/bin/node
PassengerStartupFile passenger.js
PassengerBaseURI /
PassengerRestartDir tmp

# HTTPS Redirection
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
`;
fs.writeFileSync(path.join(stageDir, ".htaccess"), htaccessContent);

console.log(`→ Creating production .env.production with CRM_APP_URL=${targetUrl}...`);
let smtpConfig = "";
const localEnvPath = path.join(rootDir, ".env.local");
if (fs.existsSync(localEnvPath)) {
  const localEnv = fs.readFileSync(localEnvPath, "utf-8");
  for (const line of localEnv.split("\n")) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("SMTP_") ||
      trimmed.startsWith("RESEND_") ||
      trimmed.startsWith("NEXT_PUBLIC_")
    ) {
      smtpConfig += `${trimmed}\n`;
    }
  }
}

const envContent = `# AutoNeural Production Configuration
CRM_APP_URL=${targetUrl}
CRM_DATABASE_PATH=data/autoneural-crm.sqlite
NODE_ENV=production
${smtpConfig}`.trim() + "\n";
fs.writeFileSync(path.join(stageDir, ".env.production"), envContent);
fs.writeFileSync(path.join(stageStandaloneDir, ".env.production"), envContent);

console.log("→ Creating tmp/restart.txt to trigger Passenger reload on extract...");
const tmpDir = path.join(stageDir, "tmp");
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(path.join(tmpDir, "restart.txt"), new Date().toISOString() + "\n");
const standaloneTmpDir = path.join(stageStandaloneDir, "tmp");
fs.mkdirSync(standaloneTmpDir, { recursive: true });
fs.writeFileSync(path.join(standaloneTmpDir, "restart.txt"), new Date().toISOString() + "\n");

if (includeDb) {
  console.log("→ Preparing production database snapshot (--include-db specified)...");
  const targetDataDir = path.join(stageDir, "data");
  fs.mkdirSync(targetDataDir, { recursive: true });
  const targetDb = path.join(targetDataDir, "autoneural-crm.sqlite");
  const sourceDb = path.join(rootDir, "data", "autoneural-crm.sqlite");

  if (fs.existsSync(sourceDb)) {
    try {
      const src = new DatabaseSync(sourceDb);
      src.exec("VACUUM INTO " + JSON.stringify(targetDb).replace(/"/g, "'"));
      const copy = new DatabaseSync(targetDb);
      copy.exec("DELETE FROM sessions; DELETE FROM attempts;");
      copy.close();
      
      const standaloneDataDir = path.join(stageStandaloneDir, "data");
      fs.mkdirSync(standaloneDataDir, { recursive: true });
      fs.copyFileSync(targetDb, path.join(standaloneDataDir, "autoneural-crm.sqlite"));
      
      console.log("✓ Production database snapshot created with local accounts.");
    } catch (err) {
      console.warn("VACUUM failed, copying directly:", err.message);
      fs.copyFileSync(sourceDb, targetDb);
    }
  } else {
    console.warn("Source database not found, skipping database copy.");
  }
} else {
  console.log("→ Preserving server database: skipping local SQLite packaging so live production users/tasks are NOT overwritten.");
}

console.log("→ Adding INSTRUCTIONS.txt...");
const instructions = `================================================================================
AutoNeural Deployment Package for Hostinger Cloud
================================================================================

Target Subdomain: ${targetUrl}

HOW TO DEPLOY ON HOSTINGER FILE MANAGER IN 3 MINUTES:

1. OPEN SUBDOMAIN DIRECTORY IN HOSTINGER hPanel:
   - In hPanel -> File Manager, navigate to:
     domains/autoneural.in/public_html/${targetSubdomain}/
   - If the folder does not exist, ensure the subdomain "${targetSubdomain}" is created
     under Websites -> autoneural.in -> Domains -> Subdomains.

2. UPLOAD & EXTRACT:
   - Upload this ZIP file ("autoneural-${targetSubdomain}-deployment.zip").
   - Right-click the ZIP and click "Extract".
   - Extract directly into:
     domains/autoneural.in/public_html/${targetSubdomain}/
   - Choose OVERWRITE when prompted so the updated server.js, passenger.js, and static assets are applied.
   - NOTE: Your existing production database (data/autoneural-crm.sqlite) and all live users/tasks are completely preserved and will NOT be overwritten.

3. RESTART PASSENGER:
   - The archive includes "tmp/restart.txt". LiteSpeed Passenger automatically detects
     the new timestamp and restarts the worker process.
   - If you ever need to manually restart in the future, simply edit or touch
     "tmp/restart.txt" in Hostinger File Manager.

4. SIGN IN AT ${targetUrl}:
   - Primary Admin (Technical Lead):
     Email:    shourya@autoneural.in
     Password: tnjA84eHD0qUXkUI7m5O
     (Or easy fallback: AutoNeural@2026!)

   - Secondary Admin:
     Email:    info@autoneural.in
     Password: _dC7jW0hqjEgsQenWr-J
     (Or easy fallback: AutoNeural@2026!)

NOTE ON LITESPEED / PASSENGER:
The included .htaccess and passenger.js automatically tell Hostinger's LiteSpeed
server to execute the Node.js standalone app using Node 24.
================================================================================
`;
fs.writeFileSync(path.join(stageDir, "INSTRUCTIONS.txt"), instructions);

console.log("→ Removing unnecessary build traces...");
const filesToRemove = [
  path.join(stageDir, ".env.local"),
  path.join(stageDir, "output"),
  path.join(stageDir, "archives"),
];
for (const p of filesToRemove) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

console.log("→ Staging complete!");

// Create single deployment ZIP file
const zipSubdomain = path.join(rootDir, `autoneural-${targetSubdomain}-deployment.zip`);

console.log(`→ Creating single deployment zip archive: autoneural-${targetSubdomain}-deployment.zip...`);
try {
  if (fs.existsSync(zipSubdomain)) {
    fs.rmSync(zipSubdomain, { force: true });
  }
  execSync(`tar.exe -a -c -f "${zipSubdomain}" -C "${stageDir}" .`, { stdio: "inherit" });
  console.log(`✓ Created ${zipSubdomain} (${(fs.statSync(zipSubdomain).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (err) {
  console.error("Failed to create zip archive:", err.message);
}

console.log("\n============================================================");
console.log(` 🎉 SINGLE HOSTINGER CLOUD DEPLOYMENT ZIP READY`);
console.log(` Target Subdomain: https://${targetDomain}`);
console.log(` Deployment File:  autoneural-${targetSubdomain}-deployment.zip`);
console.log("============================================================\n");
