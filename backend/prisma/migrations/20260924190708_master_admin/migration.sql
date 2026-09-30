-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- One-time data changes (2026-09-25): info@autoneural.in in the AutoNeural organization becomes the
-- global master admin; Shourya Kumar stays a team member without admin rights. Matched by organization
-- slug as well as email, because anyone can register a new organization using any email address.
UPDATE "users" SET "isPlatformAdmin" = true, "role" = 'ADMIN', "status" = 'ACTIVE'
WHERE "email" = 'info@autoneural.in'
  AND "organizationId" IN (SELECT "id" FROM "organizations" WHERE "slug" = 'autoneural');

UPDATE "users" SET "role" = 'EMPLOYEE'
WHERE "email" = 'shourya@autoneural.in' AND "role" = 'ADMIN'
  AND "organizationId" IN (SELECT "id" FROM "organizations" WHERE "slug" = 'autoneural');
