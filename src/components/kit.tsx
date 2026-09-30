"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/client";

/** Shared pieces for the workspace pages. */

export function Modal({ children, title, onClose, wide = false }: { children: ReactNode; title: string; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export async function post<T = any>(url: string, payload: Record<string, unknown>): Promise<T> {
  return api<T>(url, { body: payload });
}

/** GET a JSON view, optionally re-polling while the tab is visible. */
export function useData<T>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api<T>(url));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const t = setInterval(() => document.visibilityState === "visible" && void reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  return { data, error, reload };
}

/** Run an action, toast the result, reload. */
export function useAction(notify: (m: string) => void, reload: () => unknown) {
  const [busy, setBusy] = useState(false);
  const cb = useRef({ notify, reload });
  cb.current = { notify, reload };
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string | ((r: any) => string | void)) => {
    setBusy(true);
    try {
      const r = await fn();
      const msg = typeof ok === "function" ? ok(r) : ok;
      if (msg) cb.current.notify(msg);
      await cb.current.reload();
      return r;
    } catch (e) {
      cb.current.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const day = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const time = (d: string | null | undefined) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const formObj = (f: HTMLFormElement) => Object.fromEntries(new FormData(f)) as Record<string, string>;

export function Stats({ items }: { items: [string, ReactNode][] }) {
  return (
    <section className="stats-grid">
      {items.map(([k, v]) => (
        <div className="panel lead-stat" key={k}>
          <small>{k}</small>
          <strong>{v}</strong>
        </div>
      ))}
    </section>
  );
}

export function Panel({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="filter-controls">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="lead-empty">{children}</p>;

/** Read an image/PDF file as a data URL, shrinking photos so they stay small. */
export async function fileToDataUrl(file: File, maxSide = 1280): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return new Promise((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = bad;
      r.readAsDataURL(file);
    });
  }
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}

export function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((ok, bad) => {
    if (!navigator.geolocation) return bad(new Error("This device has no location service."));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => bad(new Error("Allow location access to clock in.")),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

export const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
