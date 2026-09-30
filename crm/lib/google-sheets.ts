/**
 * Google Sheets call logging service.
 * Appends call records to a configured Google Sheet.
 *
 * Uses the googleapis library with a service account.
 * The service account JSON path is set via GOOGLE_SERVICE_ACCOUNT_JSON env var.
 */

import { google, type sheets_v4 } from "googleapis";
import { env } from "./env";

let _sheetsClient: sheets_v4.Sheets | null = null;

async function getSheetsClient(): Promise<sheets_v4.Sheets | null> {
  if (_sheetsClient) return _sheetsClient;
  if (!env.callLogging.serviceAccountJson || !env.callLogging.sheetId) return null;

  try {
    const fs = await import("fs");
    const path = await import("path");

    const jsonPath = path.resolve(env.callLogging.serviceAccountJson);
    const credentials = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    _sheetsClient = google.sheets({ version: "v4", auth });
    return _sheetsClient;
  } catch (e) {
    console.error("[sheets] Failed to initialize Google Sheets client:", e);
    return null;
  }
}

export interface CallLogRow {
  timestamp: string;
  customer: string;
  phone: string;
  direction: string;
  status: string;
  duration: string;
  language: string;
  summary: string;
  nextAction: string;
  transcript: string;
}

/** Tab the rows go to; must already exist in the spreadsheet. */
const CALLS_TAB = process.env.GOOGLE_SHEET_CALLS_TAB || "calls";
/** Google Sheets rejects cells longer than 50,000 characters. */
const MAX_CELL = 45_000;

/**
 * Append a call log row to the configured Google Sheet.
 * Columns match the sheet's "calls" tab:
 * Time | Customer | Phone | Direction | Status | Duration | Language | Summary | Next action | Transcript
 */
export async function logCallToSheet(row: CallLogRow): Promise<{ logged: boolean; error?: string }> {
  const sheets = await getSheetsClient();
  if (!sheets) {
    return { logged: false, error: "Google Sheets not configured" };
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.callLogging.sheetId,
      range: `'${CALLS_TAB}'!A:J`,
      // RAW, not USER_ENTERED: a transcript line starting with "=" must never become a formula.
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [
            row.timestamp,
            row.customer,
            row.phone,
            row.direction,
            row.status,
            row.duration,
            row.language,
            row.summary,
            row.nextAction,
            row.transcript.slice(0, MAX_CELL),
          ],
        ],
      },
    });
    return { logged: true };
  } catch (e: any) {
    console.error("[sheets] Failed to log call:", e.message);
    return { logged: false, error: e.message };
  }
}

/**
 * Append a bulk batch of call logs.
 */
export async function logCallsToSheet(rows: CallLogRow[]): Promise<{ logged: number; errors: string[] }> {
  const sheets = await getSheetsClient();
  if (!sheets) {
    return { logged: 0, errors: ["Google Sheets not configured"] };
  }

  const errors: string[] = [];
  let logged = 0;

  for (const row of rows) {
    const result = await logCallToSheet(row);
    if (result.logged) logged++;
    else errors.push(result.error ?? "Unknown error");
  }

  return { logged, errors };
}
