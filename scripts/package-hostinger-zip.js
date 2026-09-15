const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");

// Parse arguments
const args = process.argv.slice(2);
let targetSubdomain = "work";
let skipBuild = false;

for (const arg of args) {
  if (arg === "--skip-build") {
    skipBuild = true;
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
  if (!process.env.CRM_DATABASE_PATH) {
    const rootData = _j(__dirname, "..", "..", "data", "autoneural-crm.sqlite");
    const localData = _j(__dirname, "data", "autoneural-crm.sqlite");
    process.env.CRM_DATABASE_PATH = _es(_j(__dirname, "..", "..", "data")) ? rootData : localData;
  } else if (!_ia(process.env.CRM_DATABASE_PATH)) {
    const rootData = _j(__dirname, "..", "..", process.env.CRM_DATABASE_PATH);
    const localData = _j(__dirname, process.env.CRM_DATABASE_PATH);
    process.env.CRM_DATABASE_PATH = _es(_j(__dirname, "..", "..", "data")) ? rootData : localData;
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

// Normalize database path to absolute path in application folder
if (!process.env.CRM_DATABASE_PATH) {
  const rootData = join(__dirname, "..", "..", "data", "autoneural-crm.sqlite");
  const localData = join(__dirname, "data", "autoneural-crm.sqlite");
  process.env.CRM_DATABASE_PATH = existsSync(join(__dirname, "..", "..", "data")) ? rootData : localData;
} else if (!isAbsolute(process.env.CRM_DATABASE_PATH)) {
  const rootData = join(__dirname, "..", "..", process.env.CRM_DATABASE_PATH);
  const localData = join(__dirname, process.env.CRM_DATABASE_PATH);
  process.env.CRM_DATABASE_PATH = existsSync(join(__dirname, "..", "..", "data")) ? rootData : localData;
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
const envContent = `# AutoNeural Production Configuration
CRM_APP_URL=${targetUrl}
CRM_DATABASE_PATH=data/autoneural-crm.sqlite
NODE_ENV=production
`;
fs.writeFileSync(path.join(stageDir, ".env.production"), envContent);
fs.writeFileSync(path.join(stageStandaloneDir, ".env.production"), envContent);

console.log("→ Creating tmp/restart.txt to trigger Passenger reload on extract...");
const tmpDir = path.join(stageDir, "tmp");
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(path.join(tmpDir, "restart.txt"), new Date().toISOString() + "\n");
const standaloneTmpDir = path.join(stageStandaloneDir, "tmp");
fs.mkdirSync(standaloneTmpDir, { recursive: true });
fs.writeFileSync(path.join(standaloneTmpDir, "restart.txt"), new Date().toISOString() + "\n");

console.log("→ Preparing production database snapshot with admin & employees...");
const targetDataDir = path.join(stageDir, "data");
fs.mkdirSync(targetDataDir, { recursive: true });
const targetDb = path.join(targetDataDir, "autoneural-crm.sqlite");
const sourceDb = path.join(rootDir, "data", "autoneural-crm.sqlite");

if (fs.existsSync(sourceDb)) {
  try {
    const src = new DatabaseSync(sourceDb);
    src.exec("VACUUM INTO " + JSON.stringify(targetDb).replace(/"/g, "'"));
    const copy = new DatabaseSync(targetDb);
    // Clear ephemeral sessions/attempts so production starts clean
    copy.exec("DELETE FROM sessions; DELETE FROM attempts;");
    copy.close();
    console.log("✓ Production database snapshot created with existing team & admin accounts.");
  } catch (err) {
    console.warn("VACUUM failed, copying directly:", err.message);
    fs.copyFileSync(sourceDb, targetDb);
  }
} else {
  console.warn("Source database not found, skipping database copy.");
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
   - Upload this ZIP file ("autoneural-${targetSubdomain}-deployment.zip" or "autoneural-hostinger-deployment.zip").
   - Right-click the ZIP and click "Extract".
   - Extract directly into:
     domains/autoneural.in/public_html/${targetSubdomain}/
   - NOTE ON DATABASE: If you already have existing tasks and users in Hostinger that
     you want to retain, you can uncheck or skip replacing the "data/autoneural-crm.sqlite" file.

3. RESTART PASSENGER:
   - The archive includes "tmp/restart.txt". LiteSpeed Passenger automatically detects
     the new timestamp and restarts the worker process.
   - If you ever need to manually restart in the future, simply edit or touch
     "tmp/restart.txt" in Hostinger File Manager.

4. VERIFY:
   - Visit ${targetUrl}
   - Login with:
     Admin: shourya@autoneural.in
     Admin: info@autoneural.in
     Employee: manyu@autoneural.in
     Employee: rajashi@autoneural.in
     Employee: warriorbiswas@autoneural.in

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

// Create ZIP files
const zipSubdomain = path.join(rootDir, `autoneural-${targetSubdomain}-deployment.zip`);
const zipHostinger = path.join(rootDir, "autoneural-hostinger-deployment.zip");

console.log(`→ Creating zip archive: autoneural-${targetSubdomain}-deployment.zip...`);
try {
  execSync(`tar.exe -a -c -f "${zipSubdomain}" -C "${stageDir}" .`, { stdio: "inherit" });
  console.log(`✓ Created ${zipSubdomain} (${(fs.statSync(zipSubdomain).size / 1024 / 1024).toFixed(1)} MB)`);

  if (zipSubdomain !== zipHostinger) {
    fs.copyFileSync(zipSubdomain, zipHostinger);
    console.log(`✓ Also updated ${zipHostinger}`);
  }
} catch (err) {
  console.error("Failed to create zip archive:", err.message);
}

// Generate dedicated NestJS Backend Deployment ZIP if backend exists
const backendZip = path.join(rootDir, "autoneural-backend-deployment.zip");
if (fs.existsSync(backendDir)) {
  console.log("\n→ Packaging dedicated NestJS Backend Deployment Bundle...");
  const backendStageDir = path.join(rootDir, "tmp", "backend-deploy");
  if (fs.existsSync(backendStageDir)) {
    fs.rmSync(backendStageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(backendStageDir, { recursive: true });

  for (const item of [
    "src",
    "dist",
    "prisma",
    "package.json",
    "tsconfig.json",
    "nest-cli.json",
    "Dockerfile",
    "README.md",
    ".env.example",
  ]) {
    const srcItem = path.join(backendDir, item);
    const dstItem = path.join(backendStageDir, item);
    if (fs.existsSync(srcItem)) {
      fs.cpSync(srcItem, dstItem, { recursive: true });
    }
  }

  // Create Passenger entrypoint for NestJS backend
  const backendPassenger = `// AutoNeural NestJS Backend — LiteSpeed Passenger Entrypoint
const path = require("node:path");
const fs = require("node:fs");

for (const envFile of [".env.production", ".env"]) {
  const p = path.join(__dirname, envFile);
  if (fs.existsSync(p)) {
    try { if (process.loadEnvFile) process.loadEnvFile(p); } catch (e) {}
    break;
  }
}

process.env.NODE_ENV = "production";
process.env.PORT = process.env.PORT || "3001";

require("./dist/main.js");
`;
  fs.writeFileSync(path.join(backendStageDir, "passenger.js"), backendPassenger);

  const backendHtaccess = `# AutoNeural NestJS Backend — Hostinger Cloud / LiteSpeed Passenger
PassengerAppType node
PassengerNodejs /opt/alt/alt-nodejs24/root/bin/node
PassengerStartupFile passenger.js
PassengerBaseURI /
PassengerRestartDir tmp

RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
`;
  fs.writeFileSync(path.join(backendStageDir, ".htaccess"), backendHtaccess);

  const backendTmpDir = path.join(backendStageDir, "tmp");
  fs.mkdirSync(backendTmpDir, { recursive: true });
  fs.writeFileSync(path.join(backendTmpDir, "restart.txt"), new Date().toISOString() + "\n");

  const backendInstructions = `================================================================================
AutoNeural NestJS Enterprise Backend Deployment
================================================================================

This package contains the standalone NestJS backend (Prisma, PostgreSQL, Swagger docs, JWT Auth, Audit Logs).

DEPLOYMENT ON HOSTINGER SUBDOMAIN (e.g. api.autoneural.in):
1. In Hostinger hPanel -> Subdomains, create subdomain (e.g. "api" -> domains/autoneural.in/public_html/api).
2. Upload and Extract autoneural-backend-deployment.zip into domains/autoneural.in/public_html/api/.
3. In File Manager, create .env.production with your production DATABASE_URL (PostgreSQL) and JWT secrets.
4. LiteSpeed Passenger will launch dist/main.js via passenger.js.
5. OpenAPI / Swagger docs will be accessible at https://api.autoneural.in/api/docs.
================================================================================
`;
  fs.writeFileSync(path.join(backendStageDir, "INSTRUCTIONS.txt"), backendInstructions);

  try {
    execSync(`tar.exe -a -c -f "${backendZip}" -C "${backendStageDir}" .`, { stdio: "inherit" });
    console.log(`✓ Created ${backendZip} (${(fs.statSync(backendZip).size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error("Failed to create backend zip archive:", err.message);
  }
}

console.log("\n============================================================");
console.log(` 🎉 ALL DEPLOYMENT ZIP PACKAGES ARE READY`);
console.log(" Generated files:");
console.log(`   📁 autoneural-${targetSubdomain}-deployment.zip  (Complete app for https://${targetDomain})`);
console.log("   📁 autoneural-hostinger-deployment.zip (Universal production bundle)");
if (fs.existsSync(backendZip)) {
  console.log("   📁 autoneural-backend-deployment.zip   (Dedicated NestJS API bundle)");
}
console.log("============================================================\n");
