/**
 * One-shot production bootstrap for a fresh database.
 *
 * Works against ANY PostgreSQL — Supabase (any account), Neon, a VPS, whatever.
 * Run it once, from your machine, after `prisma migrate deploy`.
 *
 *   DATABASE_URL="<direct connection>" node scripts/bootstrap-production.mjs
 *
 * Optionally create the first Admin in the same pass:
 *
 *   DATABASE_URL="<direct connection>" \
 *   ADMIN_NAME="Your Name" \
 *   ADMIN_EMAIL="you@autoneural.in" \
 *   ADMIN_PASSWORD="a-long-strong-password" \
 *   node scripts/bootstrap-production.mjs
 *
 * What it does, all idempotent — safe to re-run:
 *   1. Verifies the schema is present.
 *   2. On Supabase: locks down PostgREST so the anon key cannot read the CRM.
 *   3. Seeds the structural rows the app needs (organization, pipeline stages,
 *      services, tags, automation rules, integration placeholders).
 *   4. Optionally creates/promotes the first Admin.
 *
 * It creates NO demo contacts, leads, conversations or tasks.
 *
 * Use the DIRECT (session) connection, not a transaction pooler — this runs DDL.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

try {
  process.loadEnvFile?.();
} catch {
  // No .env — rely on the ambient environment, which is the usual case here.
}

const connectionUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionUrl) {
  console.error("\n  DIRECT_URL or DATABASE_URL is not set.\n");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: connectionUrl,
    },
  },
});

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

const SERVICES = [
  "AI Agents",
  "AI Calling Systems",
  "WhatsApp Automation",
  "Websites",
  "Custom Software",
  "Business Automation",
];

const TAGS = [
  ["Hot", "#C0392B"],
  ["Enterprise", "#C9A063"],
  ["SMB", "#0F7A52"],
  ["Referral", "#6B5E4F"],
  ["Price sensitive", "#B98C4C"],
];

const RULES = [
  {
    name: "Assign new leads (round-robin) + notify + follow-up task",
    trigger: "LEAD_CREATED",
    order: 1,
    config: {
      assignment: { mode: "round_robin" },
      notify: true,
      createFollowUp: true,
      followUpHours: 4,
    },
  },
  {
    name: "Remind owner if no human response within SLA",
    trigger: "NO_RESPONSE",
    order: 2,
    config: { slaMinutes: 120, escalateToManagers: true },
  },
  {
    name: "Escalate overdue follow-ups to managers",
    trigger: "FOLLOW_UP_OVERDUE",
    order: 3,
    config: {},
  },
  {
    name: "Create demo-prep task at Demo Scheduled",
    trigger: "STAGE_CHANGED",
    order: 4,
    config: { stageKey: "demo_scheduled" },
  },
];

const INTEGRATIONS = [
  ["WEBSITE_FORM", "autoneural.in website form"],
  ["WHATSAPP", "WhatsApp Business Platform"],
  ["META_LEAD_ADS", "Facebook / Instagram Lead Ads"],
  ["MESSENGER", "Facebook Messenger"],
  ["INSTAGRAM", "Instagram messaging"],
];

const done = [];
const skipped = [];

async function checkSchema() {
  try {
    await prisma.organization.count();
  } catch {
    console.error("\n  The schema is not present. Run this first:\n");
    console.error('    DATABASE_URL="<direct url>" DIRECT_URL="<direct url>" npx prisma migrate deploy\n');
    process.exit(1);
  }
}

/**
 * Supabase publishes every table in `public` over PostgREST, readable with the
 * project's anon key — a key designed to ship in browser code. This CRM never
 * uses that API; authorization lives in the application service layer. Enabling
 * RLS with zero policies denies anon/authenticated entirely, while the table
 * owner (`postgres`, which Prisma connects as) still bypasses RLS.
 *
 * FORCE ROW LEVEL SECURITY is deliberately NOT used — that would lock out Prisma.
 */
async function lockDownPostgrest() {
  const roles = await prisma.$queryRawUnsafe(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')",
  );
  if (!Array.isArray(roles) || roles.length === 0) {
    skipped.push("PostgREST lockdown (no anon/authenticated roles — not a Supabase project)");
    return;
  }

  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE t text;
    BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END LOOP;
    END $$;
  `);

  for (const stmt of [
    "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated",
    "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated",
    "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated",
  ]) {
    await prisma.$executeRawUnsafe(stmt);
  }

  const [{ total, secured, policies, grants }] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM pg_tables WHERE schemaname='public')                 AS total,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND rowsecurity) AS secured,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public')               AS policies,
      (SELECT count(*)::int FROM information_schema.role_table_grants
         WHERE table_schema='public' AND grantee IN ('anon','authenticated'))         AS grants
  `);

  if (secured !== total || grants !== 0) {
    throw new Error(
      `PostgREST lockdown incomplete: RLS ${secured}/${total}, ${grants} anon grants remaining.`,
    );
  }
  done.push(
    `PostgREST locked down — RLS on ${secured}/${total} tables, ${policies} policies, ${grants} anon grants`,
  );
}

async function seedStructure() {
  const org = await prisma.organization.upsert({
    where: { slug: "autoneural" },
    update: {},
    create: {
      name: "AutoNeural",
      slug: "autoneural",
      displayTimezone: "Asia/Kolkata",
      currency: "INR",
      noResponseSlaMins: 120,
      followUpSlaHours: 24,
    },
  });

  for (const [key, name, order, isWon, isLost] of STAGES) {
    await prisma.pipelineStage.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: {},
      create: { organizationId: org.id, key, name, order, isWon, isLost },
    });
  }

  for (const name of SERVICES) {
    await prisma.service.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
  }

  for (const [name, color] of TAGS) {
    await prisma.tag.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name, color },
    });
  }

  for (const r of RULES) {
    const existing = await prisma.automationRule.findFirst({
      where: { organizationId: org.id, name: r.name },
    });
    if (!existing) {
      await prisma.automationRule.create({
        data: {
          organizationId: org.id,
          name: r.name,
          trigger: r.trigger,
          isEnabled: true,
          order: r.order,
          config: r.config,
          // Nothing seeded here may ever message a customer.
          sendsCustomerMessage: false,
        },
      });
    }
  }

  for (const [channel, label] of INTEGRATIONS) {
    await prisma.integrationConnection.upsert({
      where: { organizationId_channel: { organizationId: org.id, channel } },
      update: {},
      create: { organizationId: org.id, channel, label, status: "NOT_CONFIGURED", publicConfig: {} },
    });
  }

  const [stages, services, tags, rules, integrations] = await Promise.all([
    prisma.pipelineStage.count({ where: { organizationId: org.id } }),
    prisma.service.count({ where: { organizationId: org.id } }),
    prisma.tag.count({ where: { organizationId: org.id } }),
    prisma.automationRule.count({ where: { organizationId: org.id } }),
    prisma.integrationConnection.count({ where: { organizationId: org.id } }),
  ]);

  done.push(
    `Structure seeded — ${stages} stages, ${services} services, ${tags} tags, ` +
      `${rules} automation rules, ${integrations} integration placeholders`,
  );
  return org;
}

async function maybeCreateAdmin(org) {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name && !email && !password) {
    skipped.push("Admin creation (set ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD, or run scripts/create-admin.mjs)");
    return;
  }
  if (!name) throw new Error("ADMIN_NAME is required when creating an Admin.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error("ADMIN_EMAIL must be a valid email address.");
  if (!password || password.length < 12)
    throw new Error("ADMIN_PASSWORD must be at least 12 characters.");

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
  done.push(`Admin ready — ${user.name} <${user.email}>`);
}

async function main() {
  const host = (() => {
    try {
      return new URL(connectionUrl).host;
    } catch {
      return "(unparseable)";
    }
  })();

  console.log(`\n  AutoNeural CRM — bootstrapping ${host}\n`);

  if (/:6543|pgbouncer=true/.test(connectionUrl)) {
    console.log("  NOTE: that looks like a transaction pooler. This script runs DDL —");
    console.log("        use the DIRECT connection (port 5432) if it fails.\n");
  }

  await checkSchema();
  await lockDownPostgrest();
  const org = await seedStructure();
  await maybeCreateAdmin(org);

  const [users, leads, demo] = await Promise.all([
    prisma.user.count({ where: { organizationId: org.id } }),
    prisma.lead.count({ where: { organizationId: org.id } }),
    prisma.user.count({
      where: { organizationId: org.id, email: { endsWith: "@autoneural.demo" } },
    }),
  ]);

  for (const d of done) console.log(`  [done] ${d}`);
  for (const s of skipped) console.log(`  [skip] ${s}`);

  console.log(`\n  Organization : ${org.name} (${org.slug})`);
  console.log(`  Users        : ${users}`);
  console.log(`  Leads        : ${leads}`);

  if (demo > 0) {
    console.log(`\n  WARNING: ${demo} seeded @autoneural.demo account(s) present.`);
    console.log("  Remove or disable them in Settings -> Team before going live.");
  }
  if (users === 0) {
    console.log("\n  No users yet. Create your Admin:");
    console.log('    ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." node scripts/create-admin.mjs');
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error("\n  Failed:", e instanceof Error ? e.message : e, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
