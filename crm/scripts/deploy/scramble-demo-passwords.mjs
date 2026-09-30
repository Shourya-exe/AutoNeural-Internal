/**
 * The seed creates demo users (…@rapidxrealty.demo) whose password is published in the repo.
 * On a public server, replace their password hashes with a random one nobody knows.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

try {
  process.loadEnvFile?.();
} catch {}

const prisma = new PrismaClient();
const hash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
const res = await prisma.user.updateMany({ where: { email: { endsWith: ".demo" } }, data: { passwordHash: hash } });
console.log(`scrambled ${res.count} seeded demo-account passwords`);
await prisma.$disconnect();
