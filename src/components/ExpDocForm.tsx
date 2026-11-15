"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expDocAction } from "@/app/actions";
import { fmtNum } from "@/lib/format";
import { COMPANY } from "../lib/company";

type V = string | number | null;
export type DocLine = Record<string, V> & { id?: number };

export interface ExpDocFormProps {
  role: string;
  heads: { head: string; type: string | null }[];
  modes: string[];
  employees: string[];
  projects: string[];
  bookings: { id: string; client: string; emp: string; project: string }[];
  chqLists?: { purposes: string[]; paymentModes: string[]; banks: string[] };
  docBase?: string | null; // set when editing an existing document
  initial?: { header: Record<string, V>; lines: DocLine[] };
}

const HEADER_KEYS = ["payDate", "valueDate", "mode", "branch", "narration"] as const;
const DETAIL_KEYS = ["payDate", "valueDate", "branch", "project", "remarks", "purpose", "paymentMode", "chqBank", "instrNo", "instrDate"];
const isChq = (l: DocLine) => String(l.mode ?? "").toLowerCase() === "chq";

export function ExpDocForm(p: ExpDocFormProps) {
  const router = useRouter();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const editing = Boolean(p.docBase);
  const [header, setHeader] = useState<Record<string, V>>(p.initial?.header ?? { docNo: "", payDate: today, valueDate: today, mode: null, branch: null, narration: null });
  const [lines, setLines] = useState<DocLine[]>(
    p.initial?.lines ?? [{ payDate: today, valueDate: today, rp: "Receipt", head: null, mode: null, branch: null, gross: null, gst: null, tds: null, bkgId: null, emp: null, project: null, narration: null, remarks: null }],
  );
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const isMaster = p.role === "master";
  const bookingById = useMemo(() => new Map(p.bookings.map((b) => [b.id.toUpperCase(), b])), [p.bookings]);
  const typeOf = useMemo(() => new Map(p.heads.map((h) => [h.head, h.type ?? ""])), [p.heads]);

  // a header change flows into every line that still carries the old header value
  function setH(k: string, v: V) {
    const old = header[k];
    setHeader((h) => ({ ...h, [k]: v, ...(k === "payDate" && (!h.valueDate || h.valueDate === h.payDate) ? { valueDate: v } : {}) }));
    if ((HEADER_KEYS as readonly string[]).includes(k))
      setLines((ls) => ls.map((l) => {
        const n = { ...l };
        if ((l[k] ?? null) === (old ?? null)) n[k] = v;
        if (k === "payDate" && (l.valueDate ?? null) === (old ?? null)) n.valueDate = v;
        return n;
      }));
  }
  const setL = (i: number, k: string, v: V) =>
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const n = { ...l, [k]: v };
      if (k === "bkgId") {
        const b = bookingById.get(String(v ?? "").toUpperCase());
        if (b && !l.emp) n.emp = b.emp;
      }
      return n;
    }));
  const addLine = () =>
    setLines((ls) => {
      const last = ls[ls.length - 1];
      return [...ls, { payDate: last?.payDate ?? header.payDate, valueDate: last?.valueDate ?? header.valueDate, rp: last?.rp ?? "Receipt", head: last?.head ?? null, mode: last?.mode ?? header.mode, branch: last?.branch ?? header.branch, gross: null, gst: null, tds: null, bkgId: null, emp: null, project: null, narration: last?.narration ?? header.narration, remarks: null }];
    });
  const dupLine = (i: number) =>
    setLines((ls) => {
      const c: DocLine = { ...ls[i], instrNo: null };
      delete c.id; // a copy is a new line
      return [...ls.slice(0, i + 1), c, ...ls.slice(i + 1)];
    });
  const delLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const totals = useMemo(() => {
    let rec = 0, pay = 0;
    for (const l of lines) {
      const g = Number(l.gross) || 0;
      if (l.rp === "Payment") pay += g; else rec += g;
    }
    return { rec, pay, net: rec - pay };
  }, [lines]);

  function go(action: "create_doc" | "update_doc" | "delete_doc") {
    setMsg(null);
    if (action === "delete_doc" && !confirm(`Delete the whole document ${p.docBase} (${lines.length} lines)?${isMaster ? "" : " (Master must approve)"}`)) return;
    start(async () => {
      const r = await expDocAction(action, { docNo: header.docNo, lines }, p.docBase);
      if (!r.ok) {
        setErrors(r.errors ?? {});
        // open the detail row of any line whose error sits in a detail field
        const o = new Set(open);
        for (const k of Object.keys(r.errors ?? {})) { const m = /^line\.(\d+)\.(\w+)$/.exec(k); if (m && DETAIL_KEYS.includes(m[2])) o.add(Number(m[1])); }
        setOpen(o);
        setMsg({ ok: false, text: r.message ?? "Please fix the highlighted fields." });
        return;
      }
      if (r.applied) {
        setMsg({ ok: true, text: action === "delete_doc" ? "Deleted." : `Saved${r.ref ? ` as ${r.ref}` : ""}.` });
        router.push("/exp");
      } else router.push(`/changes/${r.id}`);
      router.refresh();
    });
  }

  const err = (i: number, k: string) => errors[`line.${i}.${k}`];
  const cell = (i: number, k: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={`input ${err(i, k) ? "border-red-500" : ""}`} value={String(lines[i][k] ?? "")} title={err(i, k) ?? undefined}
      onChange={(e) => setL(i, k, e.target.value === "" ? null : e.target.value)} {...extra} />
  );

  return (
    <div className="space-y-4">
      {msg && <div className={`card text-sm ${msg.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50 text-red-800"}`}>{msg.text}</div>}
      {errors.lines && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{errors.lines}</div>}

      <section className="card">
        <h2 className="h2">Document</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="docNo">Document number</label>
            {editing ? <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-sm font-medium">{p.docBase}</div> : (
              <input id="docNo" className="input" value={String(header.docNo ?? "")} onChange={(e) => setH("docNo", e.target.value)} placeholder="blank = automatic" />
            )}
            {errors.docNo && <p className="err">{errors.docNo}</p>}
          </div>
          <div><label className="label" htmlFor="payDate">Pay date</label><input id="payDate" type="date" className="input" value={String(header.payDate ?? "")} onChange={(e) => setH("payDate", e.target.value || null)} /></div>
          <div><label className="label" htmlFor="valueDate">Value date</label><input id="valueDate" type="date" className="input" value={String(header.valueDate ?? "")} onChange={(e) => setH("valueDate", e.target.value || null)} /></div>
          <div>
            <label className="label" htmlFor="mode">Mode (all lines)</label>
            <select id="mode" className="input" value={String(header.mode ?? "")} onChange={(e) => setH("mode", e.target.value || null)}>
              <option value="">— select —</option>{p.modes.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="branch">Branch (all lines)</label><input id="branch" className="input" value={String(header.branch ?? "")} onChange={(e) => setH("branch", e.target.value || null)} /></div>
          <div><label className="label" htmlFor="narration">Narration (all lines)</label><input id="narration" className="input" value={String(header.narration ?? "")} onChange={(e) => setH("narration", e.target.value || null)} /></div>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Lines are numbered {editing ? p.docBase : "BASE"}-01, -02 … A one-line document keeps just the base number. Changing a header field changes every line that still has the old value; each line can differ.
          {!editing && ` Leave the number blank for Chq-nnnnn (Chq) or RPnnnnn, or type your own such as NOC-0419.`}
        </p>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Lines ({lines.length})</h2>
        <table className="table min-w-[1100px]">
          <thead>
            <tr><th>#</th><th>Head</th><th>R/P</th><th>Mode</th><th className="text-right">Gross</th><th className="text-right">GST</th><th className="text-right">TDS</th><th>BkgID</th><th>Employee</th><th>Narration</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const showDetails = open.has(i) || isChq(l);
              const b = bookingById.get(String(l.bkgId ?? "").toUpperCase());
              return (
                <Fragment key={i}>
                  <tr className={err(i, "head") || err(i, "gross") ? "bg-red-50" : ""}>
                    <td className="text-xs text-[var(--muted)]">{i + 1}</td>
                    <td>
                      <select className={`input ${err(i, "head") ? "border-red-500" : ""}`} value={String(l.head ?? "")} title={err(i, "head") ?? undefined} onChange={(e) => setL(i, "head", e.target.value || null)}>
                        <option value="">—</option>{p.heads.map((h) => <option key={h.head} value={h.head}>{h.head}</option>)}
                      </select>
                      <div className="text-[10px] text-[var(--muted)]">{typeOf.get(String(l.head ?? "")) ?? ""}</div>
                    </td>
                    <td>
                      <select className="input" value={String(l.rp ?? "")} onChange={(e) => setL(i, "rp", e.target.value)}><option>Receipt</option><option>Payment</option></select>
                    </td>
                    <td>
                      <select className={`input ${err(i, "mode") ? "border-red-500" : ""}`} value={String(l.mode ?? "")} title={err(i, "mode") ?? undefined} onChange={(e) => setL(i, "mode", e.target.value || null)}>
                        <option value="">—</option>{p.modes.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td>{cell(i, "gross", { inputMode: "decimal", className: `input text-right ${err(i, "gross") ? "border-red-500" : ""}` })}</td>
                    <td>{cell(i, "gst", { inputMode: "decimal", className: "input w-20 text-right" })}</td>
                    <td>{cell(i, "tds", { inputMode: "decimal", className: "input w-20 text-right" })}</td>
                    <td>
                      {cell(i, "bkgId", { list: "bkg-list", placeholder: COMPANY.idExample })}
                      <div className="max-w-[150px] truncate text-[10px] text-[var(--muted)]">{b ? `${b.client} · ${b.project}` : err(i, "bkgId") ?? ""}</div>
                    </td>
                    <td>{cell(i, "emp", { list: "emp-list", placeholder: "Type to search" })}{err(i, "emp") && <div className="err">{err(i, "emp")}</div>}</td>
                    <td>{cell(i, "narration")}</td>
                    <td className="whitespace-nowrap">
                      <button type="button" className="btn" title="More fields" onClick={() => toggle(i)}>{showDetails ? "▴" : "▾"}</button>{" "}
                      <button type="button" className="btn" title="Duplicate line" onClick={() => dupLine(i)}>⧉</button>{" "}
                      <button type="button" className="btn btn-danger" title="Remove line" disabled={lines.length === 1} onClick={() => delLine(i)}>×</button>
                    </td>
                  </tr>
                  {showDetails && (
                    <tr className="bg-slate-50">
                      <td></td>
                      <td colSpan={10}>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                          <div><span className="label">Pay date</span>{cell(i, "payDate", { type: "date" })}</div>
                          <div><span className="label">Value date</span>{cell(i, "valueDate", { type: "date" })}</div>
                          <div><span className="label">Branch</span>{cell(i, "branch")}</div>
                          <div><span className="label">Project (if no booking)</span>{cell(i, "project", { list: "project-list", disabled: Boolean(b) })}</div>
                          <div><span className="label">Remarks</span>{cell(i, "remarks")}</div>
                          {isChq(l) && (
                            <>
                              <div><span className="label">Purpose *</span>{cell(i, "purpose", { list: "chq-purposes", placeholder: "Booking Amt, Part…" })}{err(i, "purpose") && <p className="err">{err(i, "purpose")}</p>}</div>
                              <div><span className="label">PaymentMode *</span>{cell(i, "paymentMode", { list: "chq-paymodes", placeholder: "Cheque, RTGS, UPI…" })}{err(i, "paymentMode") && <p className="err">{err(i, "paymentMode")}</p>}</div>
                              <div><span className="label">Bank Name</span>{cell(i, "chqBank", { list: "chq-banks" })}</div>
                              <div><span className="label">Chq / UTR No *</span>{cell(i, "instrNo")}{err(i, "instrNo") && <p className="err">{err(i, "instrNo")}</p>}</div>
                              <div><span className="label">Chq / UTR Date *</span>{cell(i, "instrDate", { type: "date" })}{err(i, "instrDate") && <p className="err">{err(i, "instrDate")}</p>}</div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <datalist id="bkg-list">{p.bookings.map((b) => <option key={b.id} value={b.id}>{b.client} · {b.project}</option>)}</datalist>
        <datalist id="emp-list">{p.employees.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="project-list">{p.projects.map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="chq-purposes">{(p.chqLists?.purposes ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="chq-paymodes">{(p.chqLists?.paymentModes ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="chq-banks">{(p.chqLists?.banks ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        <div className="mt-3"><button type="button" className="btn" onClick={addLine}>+ Add line</button></div>
      </section>

      <section className="card flex flex-wrap items-center gap-4">
        <span className="text-sm">Receipts <b>₹{fmtNum(totals.rec)}</b></span>
        <span className="text-sm">Payments <b>₹{fmtNum(totals.pay)}</b></span>
        <span className="text-sm text-[var(--muted)]">Net ₹{fmtNum(totals.net)} · {lines.length} line{lines.length === 1 ? "" : "s"}</span>
        <button className="btn btn-primary ml-auto" disabled={pending} onClick={() => go(editing ? "update_doc" : "create_doc")}>
          {pending ? "Saving…" : isMaster ? "Save document" : "Submit for Master approval"}
        </button>
        {editing && <button className="btn btn-danger" disabled={pending} onClick={() => go("delete_doc")}>Delete document</button>}
      </section>
    </div>
  );
}
