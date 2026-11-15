"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface AttachmentRow { id: number; filename: string; mime: string; size: number; uploadedBy: number; uploadedByName: string; createdAt: string }

const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** Files attached to an Exp document: cheque images, NOC copies, bank slips. */
export function AttachmentsPanel({ base, items, userId, isMaster }: { base: string; items: AttachmentRow[]; userId: number; isMaster: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMsg(null);
    for (const f of Array.from(files)) {
      if (f.size > 3_000_000) { setMsg(`${f.name}: a file can be up to 3 MB`); continue; }
      const fd = new FormData();
      fd.set("base", base); fd.set("file", f);
      try {
        const r = await fetch("/api/attachments", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) setMsg(`${f.name}: ${j.message ?? "could not upload"}`);
      } catch { setMsg(`${f.name}: could not upload`); }
    }
    if (input.current) input.current.value = "";
    setBusy(false);
    router.refresh();
  }
  async function remove(id: number, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    const r = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).message ?? "Could not remove");
    router.refresh();
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="h2 mb-0">Attachments ({items.length})</h2>
        <span className="text-xs text-[var(--muted)]">PDF, images, Excel, Word, CSV or text — up to 3 MB each.</span>
        <label className={`btn ml-auto cursor-pointer ${busy ? "opacity-60" : ""}`}>
          {busy ? "Uploading…" : "+ Attach file"}
          <input ref={input} type="file" multiple className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      {msg && <p className="err mt-2">{msg}</p>}
      {items.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">Nothing attached yet.</p> : (
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <a className="link font-medium" href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.filename}</a>
              <span className="text-xs text-[var(--muted)]">{kb(a.size)} · {a.uploadedByName} · {a.createdAt.slice(0, 10)}</span>
              {(isMaster || a.uploadedBy === userId) && <button type="button" className="btn btn-danger ml-auto h-7 px-2" onClick={() => remove(a.id, a.filename)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
