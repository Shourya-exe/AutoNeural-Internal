"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor, requireCan } from "@/server/auth/context";
import { toE164 } from "@/lib/phone";
import { createLead } from "@/server/services/leads";
import { writeAudit } from "@/server/services/audit";

export const IMPORT_FIELDS = [
  { key: "fullName", label: "Full name", required: true },
  { key: "company", label: "Company" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "interestedService", label: "Interested service" },
  { key: "estimatedValue", label: "Estimated value (INR)" },
  { key: "campaignName", label: "Campaign" },
  { key: "priority", label: "Priority (LOW/MEDIUM/HIGH/URGENT)" },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export interface PreviewRow {
  index: number;
  values: Record<string, string>;
  normalisedPhone: string | null;
  errors: string[];
  duplicateOf: { leadId: string; contactName: string; reason: string } | null;
}

export interface PreviewResult {
  ok: true;
  rows: PreviewRow[];
  validCount: number;
  errorCount: number;
  duplicateCount: number;
}

const rowsSchema = z.array(z.record(z.string()));

/**
 * Validate + duplicate-check an uploaded CSV without writing anything.
 * Duplicates are detected on normalised E.164 phone or lowercased email —
 * NEVER on name alone.
 */
export async function previewImportAction(
  rawRows: unknown,
  mapping: Record<string, string>,
): Promise<PreviewResult | { ok: false; error: string }> {
  try {
    const actor = await requireActor();
    requireCan(actor, "lead.import");
    const rows = rowsSchema.parse(rawRows).slice(0, 2000);

    const out: PreviewRow[] = [];
    let validCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    // Track in-file duplicates too.
    const seenPhone = new Set<string>();
    const seenEmail = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const values: Record<string, string> = {};
      for (const f of IMPORT_FIELDS) {
        const col = mapping[f.key];
        values[f.key] = col ? (raw[col] ?? "").toString().trim() : "";
      }

      const errors: string[] = [];
      if (!values.fullName) errors.push("Full name is required");
      if (!values.phone && !values.email) errors.push("Provide a phone number or an email");
      if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))
        errors.push("Email is not valid");
      if (values.estimatedValue && Number.isNaN(Number(values.estimatedValue.replace(/[, ]/g, ""))))
        errors.push("Estimated value must be a number");
      if (
        values.priority &&
        !["LOW", "MEDIUM", "HIGH", "URGENT"].includes(values.priority.toUpperCase())
      )
        errors.push("Priority must be LOW, MEDIUM, HIGH or URGENT");

      const e164 = toE164(values.phone);
      if (values.phone && !e164) errors.push("Phone could not be normalised to E.164");

      let duplicateOf: PreviewRow["duplicateOf"] = null;
      const email = values.email.toLowerCase();

      if (e164 && seenPhone.has(e164)) {
        duplicateOf = { leadId: "", contactName: "(earlier row in this file)", reason: "phone" };
      } else if (email && seenEmail.has(email)) {
        duplicateOf = { leadId: "", contactName: "(earlier row in this file)", reason: "email" };
      } else {
        const existing = await prisma.lead.findFirst({
          where: {
            organizationId: actor.organizationId,
            archivedAt: null,
            contact: {
              is: {
                OR: [
                  ...(e164 ? [{ primaryPhone: e164 }] : []),
                  ...(email ? [{ primaryEmail: email }] : []),
                ],
              },
            },
          },
          include: { contact: true },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          duplicateOf = {
            leadId: existing.id,
            contactName: existing.contact.fullName,
            reason: e164 && existing.contact.primaryPhone === e164 ? "phone" : "email",
          };
        }
      }

      if (e164) seenPhone.add(e164);
      if (email) seenEmail.add(email);

      if (errors.length) errorCount++;
      else if (duplicateOf) duplicateCount++;
      else validCount++;

      out.push({ index: i, values, normalisedPhone: e164, errors, duplicateOf });
    }

    return { ok: true, rows: out, validCount, errorCount, duplicateCount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preview failed." };
  }
}

/**
 * Commit the previewed rows. `skipIndices` are excluded (errors/duplicates the
 * operator chose not to import).
 */
export async function commitImportAction(
  rows: PreviewRow[],
  skipIndices: number[],
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  try {
    const actor = await requireActor();
    requireCan(actor, "lead.import");
    const skip = new Set(skipIndices);

    let created = 0;
    for (const row of rows) {
      if (skip.has(row.index) || row.errors.length) continue;
      const v = row.values;
      const e164 = row.normalisedPhone;
      const email = v.email ? v.email.toLowerCase() : null;

      const contact = await prisma.contact.create({
        data: {
          organizationId: actor.organizationId,
          fullName: v.fullName,
          company: v.company || null,
          primaryEmail: email,
          primaryPhone: e164,
        },
      });

      await createLead(
        actor.organizationId,
        {
          contactId: contact.id,
          interestedService: v.interestedService || null,
          campaignName: v.campaignName || null,
          priority: (v.priority?.toUpperCase() as any) || "MEDIUM",
          estimatedValue: v.estimatedValue
            ? Number(v.estimatedValue.replace(/[, ]/g, ""))
            : null,
          sourceChannel: "MANUAL",
          sourceDetail: "CSV import",
        },
        { actor },
      );
      created++;
    }

    await writeAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "lead.import",
      entityType: "Lead",
      entityId: "bulk",
      after: { created, skipped: rows.length - created },
    });

    revalidatePath("/leads");
    return { ok: true, created, skipped: rows.length - created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
  }
}
