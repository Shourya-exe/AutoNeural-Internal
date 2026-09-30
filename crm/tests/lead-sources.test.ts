import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDatabase, type TestOrg } from "./fixtures";
import { encryptJson } from "@/lib/crypto";
import { indiamartRecordToPayload, indiamartTime, mapRowToLead } from "@/server/integrations/lead-sources";
import {
  csvToLeadPayloads,
  newIntakeKey,
  pullIndiaMart,
  pullSheetFeeds,
  toCsvUrl,
} from "@/server/services/lead-sources";
import { POST as intake } from "@/app/api/public/leads/route";

let org: TestOrg;

beforeEach(async () => {
  org = await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const csvResponse = (body: string) =>
  (async () => new Response(body, { status: 200, headers: { "content-type": "text/csv" } })) as unknown as typeof fetch;

const jsonResponse = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("row mapping", () => {
  it("maps Facebook lead-form export headers and strips the p: phone prefix", () => {
    expect(
      mapRowToLead({ full_name: "Priya Sharma", phone_number: "p:+919876543210", email: "PRIYA@x.com", campaign_name: "Q3", city: "Pune" }),
    ).toMatchObject({ name: "Priya Sharma", phone: "+919876543210", email: "priya@x.com", campaign: "Q3", city: "Pune" });
  });

  it("joins first and last name, and rejects rows without phone or email", () => {
    expect(mapRowToLead({ "First Name": "Rahul", "Last Name": "Verma", Mobile: "9876500000" })?.name).toBe("Rahul Verma");
    expect(mapRowToLead({ Name: "No contact details" })).toBeNull();
  });

  it("maps an IndiaMART record with its enquiry type", () => {
    const p = indiamartRecordToPayload({
      UNIQUE_QUERY_ID: "2748",
      QUERY_TYPE: "B",
      SENDER_NAME: "Anil",
      SENDER_MOBILE: "+91-9812345678",
      SENDER_COMPANY: "Anil Traders",
      SENDER_CITY: "Surat",
      SENDER_STATE: "Gujarat",
      QUERY_PRODUCT_NAME: "CCTV installation",
      QUERY_MESSAGE: "Need 12 cameras",
    });
    expect(p).toMatchObject({
      _id: "indiamart:2748",
      name: "Anil",
      service: "CCTV installation",
      city: "Surat, Gujarat",
      sourceDetail: "IndiaMART · Buy-lead",
    });
    expect(indiamartRecordToPayload({ UNIQUE_QUERY_ID: "1", SENDER_NAME: "x" })).toBeNull();
  });

  it("formats IndiaMART times in IST as d-MMM-yyyyHH:mm:ss", () => {
    expect(indiamartTime(new Date("2026-09-04T20:15:30Z"))).toBe("05-Sep-202601:45:30");
  });
});

describe("sheet URLs", () => {
  it("turns a Google Sheets edit link into its CSV export", () => {
    expect(toCsvUrl("https://docs.google.com/spreadsheets/d/AbC123/edit#gid=77")).toBe(
      "https://docs.google.com/spreadsheets/d/AbC123/export?format=csv&gid=77",
    );
  });

  it("refuses non-https and private addresses (the server fetches this URL)", () => {
    for (const bad of ["http://example.com/a.csv", "https://localhost/a.csv", "https://10.0.0.5/a.csv", "https://192.168.1.4/x", "https://169.254.169.254/latest"]) {
      expect(() => toCsvUrl(bad)).toThrow();
    }
  });

  it("gives a row the same id when only unmapped columns change", () => {
    const feed = { url: "https://example.com/leads.csv", label: "Leads" };
    const a = csvToLeadPayloads("Name,Phone,Status\nPriya,9876543210,New\n", feed).payloads[0]._id;
    const b = csvToLeadPayloads("Name,Phone,Status\nPriya,9876543210,Called\n", feed).payloads[0]._id;
    expect(a).toBe(b);
  });
});

describe("sheet feed auto-loading", () => {
  async function connectSheet(url = "https://example.com/leads.csv") {
    return prisma.integrationConnection.create({
      data: {
        organizationId: org.orgId,
        channel: "SHEET_FEED",
        label: "Sheets",
        status: "CONNECTED",
        encryptedConfig: encryptJson({ feeds: [{ id: "f1", label: "FB leads", url }] }),
        publicConfig: { feeds: [{ id: "f1", label: "FB leads", host: "example.com" }] },
      },
    });
  }

  it("creates leads through the normal pipeline, never twice, and throttles checks", async () => {
    const csv = "full_name,phone_number,email,service\nPriya Sharma,9876543210,priya@x.com,Website\nNo Contact,,,\nRahul,9811111111,,CRM\n";
    const conn = await connectSheet();

    const first = await pullSheetFeeds(conn, { fetchImpl: csvResponse(csv), force: true });
    expect(first).toMatchObject({ created: 2, duplicates: 0 });
    const leads = await prisma.lead.findMany({ where: { organizationId: org.orgId }, include: { contact: true } });
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.sourceChannel === "SHEET_FEED")).toBe(true);
    expect(leads.map((l) => l.contact.fullName).sort()).toEqual(["Priya Sharma", "Rahul"]);

    // Same sheet again (plus one new row): only the new row is loaded.
    const again = await pullSheetFeeds(await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } }), {
      fetchImpl: csvResponse(csv + "Meera,9822222222,,\n"),
      force: true,
    });
    expect(again).toMatchObject({ created: 1, duplicates: 2 });

    // Without force, a check within 2 minutes is skipped.
    const throttled = await pullSheetFeeds(await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } }), {
      fetchImpl: csvResponse(csv),
    });
    expect(throttled.skipped).toBe("throttled");
  });

  it("records a clear error when the sheet is not shared", async () => {
    const conn = await connectSheet();
    const r = await pullSheetFeeds(conn, {
      force: true,
      fetchImpl: (async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch,
    });
    expect(r.error).toMatch(/Anyone with the link/);
    const saved = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(saved.lastErrorText).toMatch(/FB leads/);
  });
});

describe("IndiaMART auto-pull", () => {
  const connect = () =>
    prisma.integrationConnection.create({
      data: {
        organizationId: org.orgId,
        channel: "INDIAMART",
        label: "IndiaMART",
        status: "CONNECTED",
        encryptedConfig: encryptJson({ apiKey: "test-indiamart-key" }),
        publicConfig: {},
      },
    });

  it("backfills 7 days on first pull, stores the cursor and dedupes by query id", async () => {
    let requested = "";
    const body = {
      CODE: 200,
      STATUS: "SUCCESS",
      TOTAL_RECORDS: 1,
      RESPONSE: [{ UNIQUE_QUERY_ID: "9001", QUERY_TYPE: "W", SENDER_NAME: "Kavita", SENDER_MOBILE: "+91-9800000001" }],
    };
    const fetchImpl = (async (url: URL) => {
      requested = String(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const now = new Date("2026-09-25T06:00:00Z");

    const r = await pullIndiaMart(await connect(), { now, fetchImpl });
    expect(r).toMatchObject({ created: 1 });
    expect(requested).toContain("glusr_crm_key=test-indiamart-key");
    const params = new URL(requested).searchParams;
    expect(params.get("start_time")).toBe(indiamartTime(new Date(now.getTime() - 7 * 86_400_000 + 60_000)));
    expect(params.get("end_time")).toBe(indiamartTime(now));

    const conn = await prisma.integrationConnection.findFirstOrThrow({ where: { channel: "INDIAMART" } });
    expect((conn.publicConfig as any).lastPulledAt).toBe(now.toISOString());

    // 11 minutes later the same record comes back in the overlap window: no duplicate lead.
    const later = await pullIndiaMart(conn, { now: new Date(now.getTime() + 11 * 60_000), fetchImpl });
    expect(later).toMatchObject({ created: 0, duplicates: 1 });
    expect(await prisma.lead.count({ where: { organizationId: org.orgId } })).toBe(1);
  });

  it("never calls IndiaMART twice within 5 minutes, even when forced", async () => {
    const conn = await connect();
    const now = new Date();
    await pullIndiaMart(conn, { now, fetchImpl: jsonResponse({ CODE: 204, RESPONSE: [] }) });
    const fresh = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    const r = await pullIndiaMart(fresh, { now: new Date(now.getTime() + 60_000), force: true, fetchImpl: jsonResponse({ CODE: 204 }) });
    expect(r.skipped).toBe("throttled");
  });

  it("marks the connection as errored on an invalid key", async () => {
    const conn = await connect();
    const r = await pullIndiaMart(conn, { fetchImpl: jsonResponse({ CODE: 401, STATUS: "FAILURE", MESSAGE: "Invalid key" }) });
    expect(r.error).toMatch(/rejected the API key/);
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("ERROR");
  });
});

describe("lead intake API", () => {
  async function withKey() {
    const { key, keyHash, keyPrefix } = newIntakeKey();
    await prisma.integrationConnection.create({
      data: { organizationId: org.orgId, channel: "LEAD_API", label: "API", status: "CONNECTED", publicConfig: { keyHash, keyPrefix } },
    });
    return key;
  }
  const post = (key: string | null, body: unknown) =>
    intake(
      new NextRequest("https://crm.test/api/public/leads", {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      }),
    );

  it("rejects missing or wrong keys", async () => {
    await withKey();
    expect((await post(null, { name: "x", phone: "9800000000" })).status).toBe(401);
    expect((await post(newIntakeKey().key, { name: "x", phone: "9800000000" })).status).toBe(401);
  });

  it("accepts a batch with loose field names, reports rejects and is idempotent with externalId", async () => {
    const key = await withKey();
    const res = await post(key, {
      leads: [
        { full_name: "Zapier Lead", mobile: "9876512345", source: "Zapier – Google Ads", externalId: "gads-1" },
        { name: "No details" },
      ],
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ accepted: 1, duplicates: 0, rejected: [{ index: 1 }] });
    const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: org.orgId }, include: { contact: true } });
    expect(lead.sourceChannel).toBe("LEAD_API");
    expect(lead.contact.fullName).toBe("Zapier Lead");

    const retry = await post(key, { full_name: "Zapier Lead", mobile: "9876512345", externalId: "gads-1" });
    expect(await retry.json()).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it("stops accepting a key after it is revoked", async () => {
    const key = await withKey();
    await prisma.integrationConnection.updateMany({ where: { channel: "LEAD_API" }, data: { status: "NOT_CONFIGURED" } });
    expect((await post(key, { name: "x", phone: "9800000000" })).status).toBe(401);
  });
});
