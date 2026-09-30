"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  previewImportAction,
  commitImportAction,
  IMPORT_FIELDS,
  type PreviewRow,
} from "@/app/(app)/leads/import/actions";
import { Upload, AlertTriangle, CheckCircle2, CopyX } from "lucide-react";

type Step = "upload" | "map" | "preview" | "done";

const AUTO_MAP: Record<string, string[]> = {
  fullName: ["name", "full name", "full_name", "contact", "lead name"],
  company: ["company", "organisation", "organization", "business"],
  phone: ["phone", "mobile", "whatsapp", "contact number", "phone number"],
  email: ["email", "e-mail", "email address"],
  interestedService: ["service", "interest", "product", "requirement"],
  estimatedValue: ["value", "deal value", "amount", "budget"],
  campaignName: ["campaign", "source campaign", "utm_campaign"],
  priority: ["priority"],
};

export function CsvImport() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [stats, setStats] = useState({ valid: 0, errors: 0, duplicates: 0 });
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields ?? [];
        setHeaders(hs);
        setRows(res.data);
        // Best-effort automatic mapping by header name.
        const m: Record<string, string> = {};
        for (const f of IMPORT_FIELDS) {
          const candidates = AUTO_MAP[f.key] ?? [];
          const hit = hs.find((h) => candidates.includes(h.trim().toLowerCase()));
          if (hit) m[f.key] = hit;
        }
        setMapping(m);
        setStep("map");
      },
      error: (e) => setErr(e.message),
    });
  }

  return (
    <div className="space-y-4">
      <Steps step={step} />

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>1 · Upload a CSV</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              The file is parsed in your browser. Nothing is written until you confirm the preview.
            </p>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-champagne-50 px-6 py-12 text-center hover:border-gold">
              <Upload className="size-6 text-gold-700" />
              <span className="text-sm font-medium text-espresso-700">Choose a .csv file</span>
              <span className="text-[11px] text-muted-foreground">
                First row must contain column headers. Up to 2,000 rows per import.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </label>
            {err && <p className="mt-3 text-xs text-danger-600">{err}</p>}
          </CardContent>
        </Card>
      )}

      {step === "map" && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Map columns</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {rows.length} rows found. We guessed the mapping from your headers — correct anything
              that&apos;s wrong.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label>
                    {f.label}
                    {"required" in f && f.required && <span className="text-danger"> *</span>}
                  </Label>
                  <Select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {err && <p className="text-xs text-danger-600">{err}</p>}
            <div className="flex gap-2">
              <Button
                disabled={pending || !mapping.fullName}
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const res = await previewImportAction(rows, mapping);
                    if (res.ok) {
                      setPreview(res.rows);
                      setStats({
                        valid: res.validCount,
                        errors: res.errorCount,
                        duplicates: res.duplicateCount,
                      });
                      // Skip errored and duplicate rows by default.
                      setSkip(
                        new Set(
                          res.rows
                            .filter((r) => r.errors.length || r.duplicateOf)
                            .map((r) => r.index),
                        ),
                      );
                      setStep("preview");
                    } else setErr(res.error);
                  })
                }
              >
                {pending ? "Validating…" : "Validate & preview"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("upload")}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle>3 · Review before importing</CardTitle>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="success">
                <CheckCircle2 className="size-3" /> {stats.valid} ready
              </Badge>
              <Badge variant="gold">
                <CopyX className="size-3" /> {stats.duplicates} possible duplicates
              </Badge>
              <Badge variant="danger">
                <AlertTriangle className="size-3" /> {stats.errors} with errors
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Duplicates are matched on normalised E.164 phone or lowercased email — never on name
              alone. Untick a row to import it anyway.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 p-0">
            <div className="max-h-[460px] overflow-y-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-10">Skip</TH>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Phone (E.164)</TH>
                    <TH>Email</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {preview.slice(0, 300).map((r) => (
                    <TR key={r.index}>
                      <TD>
                        <input
                          type="checkbox"
                          className="accent-gold"
                          checked={skip.has(r.index)}
                          disabled={r.errors.length > 0}
                          onChange={(e) => {
                            const n = new Set(skip);
                            e.target.checked ? n.add(r.index) : n.delete(r.index);
                            setSkip(n);
                          }}
                        />
                      </TD>
                      <TD className="text-xs">{r.values.fullName || "—"}</TD>
                      <TD className="text-xs text-muted-foreground">{r.values.company || "—"}</TD>
                      <TD className="font-mono text-[11px]">{r.normalisedPhone ?? r.values.phone ?? "—"}</TD>
                      <TD className="text-[11px] text-muted-foreground">{r.values.email || "—"}</TD>
                      <TD>
                        {r.errors.length > 0 ? (
                          <span className="text-[11px] text-danger-600">{r.errors.join("; ")}</span>
                        ) : r.duplicateOf ? (
                          <span className="text-[11px] text-gold-700">
                            Matches{" "}
                            {r.duplicateOf.leadId ? (
                              <Link
                                href={`/leads/${r.duplicateOf.leadId}`}
                                className="underline"
                                target="_blank"
                              >
                                {r.duplicateOf.contactName}
                              </Link>
                            ) : (
                              r.duplicateOf.contactName
                            )}{" "}
                            on {r.duplicateOf.reason}
                          </span>
                        ) : (
                          <Badge variant="success">Ready</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {preview.length > 300 && (
              <p className="px-5 text-[11px] text-muted-foreground">
                Showing the first 300 of {preview.length} rows. All rows will be imported according
                to the rules above.
              </p>
            )}
            {err && <p className="px-5 text-xs text-danger-600">{err}</p>}
            <div className="flex gap-2 px-5 pb-5">
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const res = await commitImportAction(preview, [...skip]);
                    if (res.ok) {
                      setResult({ created: res.created, skipped: res.skipped });
                      setStep("done");
                      router.refresh();
                    } else setErr(res.error);
                  })
                }
              >
                {pending
                  ? "Importing…"
                  : `Import ${preview.filter((r) => !skip.has(r.index) && !r.errors.length).length} leads`}
              </Button>
              <Button variant="ghost" onClick={() => setStep("map")}>
                Back to mapping
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && result && (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <CheckCircle2 className="mx-auto size-8 text-emerald-600" />
            <p className="text-sm font-semibold text-espresso">
              Imported {result.created} lead{result.created === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground">
              {result.skipped} row{result.skipped === 1 ? "" : "s"} skipped. Assignment and
              first-follow-up automations ran for each new lead.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Link href="/leads">
                <Button size="sm">Go to leads</Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setResult(null);
                  setRows([]);
                  setPreview([]);
                }}
              >
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items = [
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map fields" },
    { key: "preview", label: "Validate & dedupe" },
    { key: "done", label: "Done" },
  ];
  const idx = items.findIndex((i) => i.key === step);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[11px]">
      {items.map((i, n) => (
        <li key={i.key} className="flex items-center gap-2">
          <span
            className={
              "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold " +
              (n <= idx ? "bg-gold text-white" : "bg-champagne-100 text-espresso-300")
            }
          >
            {n + 1}
          </span>
          <span className={n <= idx ? "text-espresso-700" : "text-muted-foreground"}>{i.label}</span>
          {n < items.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
