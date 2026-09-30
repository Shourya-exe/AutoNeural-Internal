import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDatabase, type TestOrg } from "./fixtures";
import { resolveIdentity } from "@/server/services/identity";
import { toE164 } from "@/lib/phone";

let org: TestOrg;

beforeEach(async () => {
  org = await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("phone normalisation", () => {
  it("normalises Indian numbers written in several styles to one E.164 value", () => {
    for (const raw of ["9812345678", "098123 45678", "+91 98123-45678", "0091 9812345678"]) {
      expect(toE164(raw)).toBe("+919812345678");
    }
  });

  it("returns null rather than guessing for unparseable input", () => {
    for (const raw of ["", "abc", "12", "not a number", "12345", "0000000000"]) {
      expect(toE164(raw)).toBeNull();
    }
  });

  it("still normalises when libphonenumber metadata fails to load", async () => {
    // Regression guard: the bundled metadata can fail to load under some
    // CJS/bundler combinations (it throws from isSupportedCountry). The fallback
    // heuristic must still produce E.164 for Indian mobiles rather than silently
    // returning null, which would break identity matching and duplicate contacts.
    vi.resetModules();
    vi.doMock("libphonenumber-js", () => ({
      parsePhoneNumberFromString: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'hasOwnProperty')");
      },
    }));
    try {
      const { toE164: fallbackToE164 } = await import("@/lib/phone");
      expect(fallbackToE164("9812340001")).toBe("+919812340001");
      expect(fallbackToE164("09812340001")).toBe("+919812340001");
      expect(fallbackToE164("919812340001")).toBe("+919812340001");
      expect(fallbackToE164("+919812340001")).toBe("+919812340001");
      expect(fallbackToE164("98123 400 01")).toBe("+919812340001");
      expect(fallbackToE164("abc")).toBeNull();
      expect(fallbackToE164("12345")).toBeNull();
    } finally {
      vi.doUnmock("libphonenumber-js");
      vi.resetModules();
    }
  });
});

describe("identity resolution", () => {
  it("reuses the contact when the same channel identity is seen again", async () => {
    const first = await resolveIdentity(org.orgId, {
      channel: "WHATSAPP",
      externalId: "+919812345678",
      displayName: "Vikram",
      phone: "+919812345678",
    });
    const second = await resolveIdentity(org.orgId, {
      channel: "WHATSAPP",
      externalId: "+919812345678",
      displayName: "Vikram",
      phone: "+919812345678",
    });

    expect(second.contactId).toBe(first.contactId);
    expect(second.createdContact).toBe(false);
    expect(await prisma.contact.count()).toBe(1);
    expect(await prisma.channelIdentity.count()).toBe(1);
  });

  it("links a new channel to an existing contact on an exact E.164 phone match", async () => {
    const contact = await prisma.contact.create({
      data: {
        organizationId: org.orgId,
        fullName: "Vikram Sharma",
        primaryPhone: "+919812345678",
      },
    });

    const res = await resolveIdentity(org.orgId, {
      channel: "WHATSAPP",
      externalId: "+919812345678",
      displayName: "Vikram",
      phone: "+919812345678",
    });

    expect(res.contactId).toBe(contact.id);
    expect(res.createdContact).toBe(false);
  });

  it("links on an exact email match", async () => {
    const contact = await prisma.contact.create({
      data: {
        organizationId: org.orgId,
        fullName: "Priya Sharma",
        primaryEmail: "priya@example.com",
      },
    });

    const res = await resolveIdentity(org.orgId, {
      channel: "WEBSITE_FORM",
      externalId: "priya@example.com",
      displayName: "Priya Sharma",
      email: "priya@example.com",
    });

    expect(res.contactId).toBe(contact.id);
  });

  it("NEVER merges two people who only share a name", async () => {
    const existing = await prisma.contact.create({
      data: {
        organizationId: org.orgId,
        fullName: "Rahul Gupta",
        primaryPhone: "+919811111111",
        primaryEmail: "rahul.gupta@companyA.com",
      },
    });

    // A different Rahul Gupta arrives on Messenger with only a PSID.
    const res = await resolveIdentity(org.orgId, {
      channel: "MESSENGER",
      externalId: "PSID_9999",
      displayName: "Rahul Gupta",
    });

    expect(res.contactId).not.toBe(existing.id);
    expect(res.createdContact).toBe(true);
    expect(await prisma.contact.count()).toBe(2);
  });

  it("flags an ambiguous match for review instead of picking one contact", async () => {
    // Two contacts share a phone number (data-entry duplicate).
    await prisma.contact.create({
      data: { organizationId: org.orgId, fullName: "Person A", primaryPhone: "+919822222222" },
    });
    await prisma.contact.create({
      data: { organizationId: org.orgId, fullName: "Person B", primaryPhone: "+919822222222" },
    });

    const res = await resolveIdentity(org.orgId, {
      channel: "WHATSAPP",
      externalId: "+919822222222",
      displayName: "Unknown",
      phone: "+919822222222",
    });

    // A brand-new contact is created rather than silently attaching to A or B.
    expect(res.createdContact).toBe(true);
    const identity = await prisma.channelIdentity.findUniqueOrThrow({
      where: { id: res.channelIdentityId },
    });
    expect(identity.externalId).toBe("+919822222222");
  });

  it("keeps Instagram identities separate from other channels", async () => {
    await prisma.contact.create({
      data: {
        organizationId: org.orgId,
        fullName: "Sneha Shah",
        primaryPhone: "+919833333333",
        primaryEmail: "sneha@example.com",
      },
    });

    // An IGSID carries no phone or email — no reliable link exists.
    const res = await resolveIdentity(org.orgId, {
      channel: "INSTAGRAM",
      externalId: "IGSID_5555",
      displayName: "@sneha.shah",
    });

    expect(res.createdContact).toBe(true);
    expect(await prisma.contact.count()).toBe(2);
  });

  it("never invents a phone number or email for a Messenger user", async () => {
    const res = await resolveIdentity(org.orgId, {
      channel: "MESSENGER",
      externalId: "PSID_1234",
    });
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: res.contactId } });
    expect(contact.primaryPhone).toBeNull();
    expect(contact.primaryEmail).toBeNull();
    expect(contact.fullName).toMatch(/^Unknown Messenger/);
  });

  it("backfills missing contact details without overwriting existing ones", async () => {
    const contact = await prisma.contact.create({
      data: {
        organizationId: org.orgId,
        fullName: "Existing Name",
        primaryPhone: "+919844444444",
        // no email yet
      },
    });

    await resolveIdentity(org.orgId, {
      channel: "WEBSITE_FORM",
      externalId: "existing@example.com",
      displayName: "Different Name From Form",
      email: "existing@example.com",
      phone: "+919844444444",
    });

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.primaryEmail).toBe("existing@example.com"); // filled in
    expect(after.fullName).toBe("Existing Name"); // NOT overwritten
    expect(after.primaryPhone).toBe("+919844444444");
  });

  it("scopes identities to the organization", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "Other Co", slug: `other-${Date.now()}` },
    });
    await resolveIdentity(org.orgId, {
      channel: "WHATSAPP",
      externalId: "+919855555555",
      phone: "+919855555555",
    });
    const other = await resolveIdentity(otherOrg.id, {
      channel: "WHATSAPP",
      externalId: "+919855555555",
      phone: "+919855555555",
    });
    expect(other.createdContact).toBe(true);
    expect(await prisma.contact.count()).toBe(2);
  });
});
