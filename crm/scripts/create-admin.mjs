/**
 * Create the first real Admin (and the organization + pipeline stages if the
 * database is empty). There is no public sign-up, so this is how a production
 * deployment gets its first user.
 *
 *   DATABASE_URL="postgresql://…" \
 *   ADMIN_NAME="Your Name" \
 *   ADMIN_EMAIL="you@autoneural.in" \
 *   ADMIN_PASSWORD="a-strong-password" \
 *   node scripts/create-admin.mjs
 *
 * Safe to re-run: an existing user with that email is promoted to Admin and
 * their password is updated. The password is read from the environment and is
 * never logged.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Load .env if present. Imports are hoisted, but PrismaClient only reads
// DATABASE_URL when it is INSTANTIATED, so doing this first is sufficient.
try {
  process.loadEnvFile?.();
} catch {
  // No .env file — rely on the ambient environment (the usual case here,
  // since you pass DATABASE_URL inline when pointing at production).
}

const connectionUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(
  connectionUrl
    ? {
        datasources: {
          db: {
            url: connectionUrl,
          },
        },
      }
    : undefined,
);

const STAGES = [
  ["new", "New", 1, false, false],
  ["contacted", "Contacted", 2, false, false],
  ["qualified", "Qualified", 3, false, false],
  ["demo_scheduled", "Demo Scheduled", 4, false, false],
  ["proposal_sent", "Proposal Sent", 5, false, false],
  ["negotiation", "Negotiation", 6, false, false],
  ["won", "Won", 7, true, false],
  ["lost", "Lost", 8, false, true],
];

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name) fail("ADMIN_NAME is required.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("ADMIN_EMAIL must be a valid email address.");
  if (!password || password.length < 12) fail("ADMIN_PASSWORD is required and must be at least 12 characters.");
  if (!connectionUrl) fail("DATABASE_URL or DIRECT_URL is not set.");

  const org = await prisma.organization.upsert({
    where: { slug: "autoneural" },
    update: {},
    create: {
      name: "AutoNeural",
      slug: "autoneural",
      displayTimezone: "Asia/Kolkata",
      currency: "INR",
    },
  });

  for (const [key, stageName, order, isWon, isLost] of STAGES) {
    await prisma.pipelineStage.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: {},
      create: { organizationId: org.id, key, name: stageName, order, isWon, isLost },
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, isActive: true, organizationId: org.id },
    create: { organizationId: org.id, name, email, passwordHash, isActive: true },
  });

  await prisma.membership.upsert({
    where: { userId: user.id },
    update: { role: "ADMIN", organizationId: org.id },
    create: { organizationId: org.id, userId: user.id, role: "ADMIN" },
  });

  const stageCount = await prisma.pipelineStage.count({ where: { organizationId: org.id } });
  const demoAccounts = await prisma.user.count({
    where: { organizationId: org.id, email: { endsWith: "@autoneural.demo" } },
  });

  console.log("");
  console.log(`  Organization : ${org.name} (${org.slug})`);
  console.log(`  Stages       : ${stageCount}`);
  console.log(`  Admin        : ${user.name} <${user.email}>`);
  console.log("");
  console.log("  Sign in at /login with that email and the password you supplied.");
  if (demoAccounts > 0) {
    console.log("");
    console.log(`  WARNING: ${demoAccounts} seeded @autoneural.demo account(s) still exist.`);
    console.log("  Remove or disable them in Settings -> Team before going live.");
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error("\n  Failed:", e instanceof Error ? e.message : e, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
