"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDraftAction, expDocAction, saveDraftAction } from "@/app/actions";
import { parsePaste } from "@/lib/pasteLines";
import { fmtNum } from "@/lib/format";
import { COMPANY } from "../lib/company";
import { Lookup, type BkgHit } from "@/components/Lookup";

type V = string | number | null;
export type DocLine = Record<string, V> & { id?: number };

export interface ExpDocFormProps {
  role: string;
  heads: { head: string; type: string | null }[];
  modes: string[];
  projects: string[];
  knownBookings?: BkgHit[]; // bookings already used by the lines of this document (the rest are searched on demand)
  chqLists?: { purposes: string[]; paymentModes: string[]; banks: string[] };
  docBase?: string | null; // set when editing an existing document
  draftId?: number | null; // set when a saved draft was opened
  initial?: { header: Record<string, V>; lines: DocLine[] };
}

const HEADER_KEYS = ["payDate", "valueDate", "mode", "branch", "narration"] as const;
const isChq = (l: DocLine) => String(l.mode ?? "").toLowerCase() === "chq";

/** Every field of a line, in one row. width = minimum column width in px. */
const COLS: { k: string; label: string; w: number; right?: boolean }[] = [
  { k: "head", label: "Head", w: 170 }, { k: "rp", label: "R/P", w: 110 }, { k: "mode", label: "Mode", w: 130 },
  { k: "gross", label: "Gross", w: 120, right: true }, { k: "gst", label: "GST", w: 90, right: true }, { k: "tds", label: "TDS", w: 90, right: true },
  { k: "bkgId", label: "BkgID", w: 120 }, { k: "_who", label: "Client · Project (from booking)", w: 230 },
  { k: "emp", label: "Employee", w: 230 }, { k: "project", label: "Project (no booking)", w: 170 },
  { k: "narration", label: "Narration", w: 240 }, { k: "remarks", label: "Remarks", w: 180 },
  { k: "payDate", label: "Pay date", w: 140 }, { k: "valueDate", label: "Value date", w: 140 }, { k: "branch", label: "Branch", w: 120 },
  { k: "purpose", label: "Purpose *", w: 150 }, { k: "paymentMode", label: "PaymentMode *", w: 140 }, { k: "chqBank", label: "Bank", w: 160 },
  { k: "instrNo", label: "Chq / UTR No *", w: 170 }, { k: "instrDate", label: "Chq / UTR Date *", w: 150 },
];
const CHQ_KEYS = new Set(["purpose", "paymentMode", "chqBank", "instrNo", "instrDate"]);

export function ExpDocForm(p: ExpDocFormProps) {
  const router = useRouter();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const editing = Boolean(p.docBase);
  const [header, setHeader] = useState<Record<string, V>>(p.initial?.header ?? { docNo: "", payDate: today, valueDate: today, mode: null, branch: null, narration: null });
  const [lines, setLines] = useState<DocLine[]>(
    p.initial?.lines ?? [{ payDate: today, valueDate: today, rp: "Receipt", head: null, mode: null, branch: null, gross: null, gst: null, tds: null, bkgId: null, emp: null, project: null, narration: null, remarks: null }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [draftId, setDraftId] = useState<number | null>(p.draftId ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteWarn, setPasteWarn] = useState<string[]>([]);
  const isMaster = p.role === "master";
  const [bk, setBk] = useState<Map<string, BkgHit>>(() => new Map((p.knownBookings ?? []).map((b) => [b.id.toUpperCase(), b])));
  const bookingById = bk;
  const remember = (h: BkgHit) => setBk((m) => new Map(m).set(h.id.toUpperCase(), h));
  // a BkgID typed by hand: look it up once so the client / project show and Employee can default
  async function resolveBkg(i: number, id: string) {
    const key = id.trim().toUpperCase();
    if (!key) return;
    let hit = bk.get(key);
    if (!hit) {
      try {
        const r = await fetch(`/api/lookup?type=bkg&id=${encodeURIComponent(key)}`);
        hit = r.ok ? ((await r.json()) as BkgHit[])[0] : undefined;
      } catch { hit = undefined; }
      if (hit) remember(hit);
    }
    if (hit && hit.emp) setLines((ls) => ls.map((l, j) => (j === i && !l.emp ? { ...l, emp: hit!.emp } : l)));
  }
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
      return { ...l, [k]: v };
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

  const totals = useMemo(() => {
    let rec = 0, pay = 0;
    for (const l of lines) {
      const g = Number(l.gross) || 0;
      if (l.rp === "Payment") pay += g; else rec += g;
    }
    return { rec, pay, net: rec - pay };
  }, [lines]);

  /** Adds the pasted lines (from Excel) under the existing ones; header values fill whatever the paste leaves blank. */
  function applyPaste() {
    const r = parsePaste(pasteText, 300);
    if (!r.lines.length) { setPasteWarn(r.warnings); return; }
    const blank = lines.length === 1 && !lines[0].head && !lines[0].gross && !lines[0].bkgId;
    const made: DocLine[] = r.lines.map((x) => ({
      payDate: header.payDate, valueDate: header.valueDate, rp: "Receipt", head: null, mode: header.mode, branch: header.branch, gross: null, gst: null, tds: null,
      bkgId: null, emp: null, project: null, narration: header.narration, remarks: null, ...x,
    }));
    setLines((ls) => (blank ? made : [...ls, ...made]).slice(0, 300));
    setPasteWarn(r.warnings);
    setPasteText("");
    if (!r.warnings.length) setPasteOpen(false);
    setMsg({ ok: true, text: `${made.length} line(s) added from the pasted text.${r.warnings.length ? " Check the notes below the paste box." : ""}` });
  }

  function saveDraft() {
    setMsg(null);
    start(async () => {
      const title = String(header.docNo || lines.find((l) => l.narration)?.narration || lines[0]?.head || "Draft");
      const r = await saveDraftAction(draftId, title, { header, lines });
      if (r.ok) { setDraftId(r.id); setMsg({ ok: true, text: "Draft saved. Open it later from New Exp document → My drafts." }); }
      else setMsg({ ok: false, text: r.message ?? "Could not save the draft" });
    });
  }

  function go(action: "create_doc" | "update_doc" | "delete_doc") {
    setMsg(null);
    if (action === "delete_doc" && !confirm(`Delete the whole document ${p.docBase} (${lines.length} lines)?${isMaster ? "" : " (Master must approve)"}`)) return;
    start(async () => {
      const r = await expDocAction(action, { docNo: header.docNo, lines }, p.docBase);
      if (!r.ok) {
        setErrors(r.errors ?? {});
        setMsg({ ok: false, text: r.message ?? "Please fix the highlighted fields." });
        return;
      }
      if (draftId) await deleteDraftAction(draftId);
      if (r.applied) {
        setMsg({ ok: true, text: action === "delete_doc" ? "Deleted." : `Saved${r.ref ? ` as ${r.ref}` : ""}.` });
        router.push("/exp");
      } else router.push(`/changes/${r.id}`);
      router.refresh();
    });
  }

  const err = (i: number, k: string) => errors[`line.${i}.${k}`];
  const labelOf = (k: string) => COLS.find((c) => c.k === k)?.label.replace(" *", "") ?? k;
  const lineErrors = Object.entries(errors)
    .filter(([k]) => k.startsWith("line."))
    .map(([k, v]) => { const m = /^line\.(\d+)\.(\w+)$/.exec(k); return m ? { i: Number(m[1]), k: m[2], v } : null; })
    .filter((x): x is { i: number; k: string; v: string } => x !== null)
    .sort((a, b) => a.i - b.i);

  const input = (i: number, k: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={`input ${err(i, k) ? "border-red-500 bg-red-50" : ""}`} value={String(lines[i][k] ?? "")} title={err(i, k) ?? undefined}
      onChange={(e) => setL(i, k, e.target.value === "" ? null : e.target.value)} {...extra} />
  );

  function cell(i: number, c: (typeof COLS)[number]) {
    const l = lines[i];
    const chqOff = CHQ_KEYS.has(c.k) && !isChq(l);
    const off = chqOff ? { disabled: true, placeholder: "Chq only" } : {};
    switch (c.k) {
      case "head":
        return (
          <select className={`input ${err(i, "head") ? "border-red-500 bg-red-50" : ""}`} value={String(l.head ?? "")} title={err(i, "head") ?? (typeOf.get(String(l.head ?? "")) || undefined)} onChange={(e) => setL(i, "head", e.target.value || null)}>
            <option value="">—</option>{p.heads.map((h) => <option key={h.head} value={h.head}>{h.head}</option>)}
          </select>
        );
      case "rp":
        return <select className="input" value={String(l.rp ?? "")} onChange={(e) => setL(i, "rp", e.target.value)}><option>Receipt</option><option>Payment</option></select>;
      case "mode":
        return (
          <select className={`input ${err(i, "mode") ? "border-red-500 bg-red-50" : ""}`} value={String(l.mode ?? "")} title={err(i, "mode") ?? undefined} onChange={(e) => setL(i, "mode", e.target.value || null)}>
            <option value="">—</option>{p.modes.map((m) => <option key={m}>{m}</option>)}
          </select>
        );
      case "gross": case "gst": case "tds":
        return input(i, c.k, { inputMode: "decimal", className: `input text-right ${err(i, c.k) ? "border-red-500 bg-red-50" : ""}` });
      case "bkgId":
        return (
          <div onBlur={() => resolveBkg(i, String(lines[i].bkgId ?? ""))}>
            <Lookup kind="bkg" value={String(l.bkgId ?? "")} placeholder={COMPANY.idExample} className={err(i, "bkgId") ? "border-red-500 bg-red-50" : ""} title={err(i, "bkgId") ?? undefined}
              onChange={(v) => setL(i, "bkgId", v === "" ? null : v)}
              onPick={(it) => { if (typeof it !== "string") { remember(it); if (!lines[i].emp && it.emp) setL(i, "emp", it.emp); } }} />
          </div>
        );
      case "_who": {
        const b = bookingById.get(String(l.bkgId ?? "").toUpperCase());
        return <div className="truncate rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600" title={b ? `${b.client} · ${b.project}` : undefined}>{b ? `${b.client} · ${b.project}` : <span className="text-slate-400">—</span>}</div>;
      }
      case "emp":
        return <Lookup kind="emp" value={String(l.emp ?? "")} placeholder="Type to search" className={err(i, "emp") ? "border-red-500 bg-red-50" : ""} title={err(i, "emp") ?? undefined} onChange={(v) => setL(i, "emp", v === "" ? null : v)} />;
      case "project": return input(i, "project", { list: "project-list", disabled: Boolean(bookingById.get(String(l.bkgId ?? "").toUpperCase())) });
      case "payDate": case "valueDate": case "instrDate": return input(i, c.k, { type: "date", ...off });
      case "purpose": return input(i, "purpose", { list: "chq-purposes", ...off });
      case "paymentMode": return input(i, "paymentMode", { list: "chq-paymodes", ...off });
      case "chqBank": return input(i, "chqBank", { list: "chq-banks", ...off });
      default: return input(i, c.k, off);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <div className={`card text-sm ${msg.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50 text-red-800"}`}>{msg.text}</div>}
      {errors.lines && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{errors.lines}</div>}

      <section className="card">
        <h2 className="h2">Document</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="docNo">Document number</label>
            {editing ? <div className="flex h-8 items-center rounded-lg bg-slate-50 px-2.5 text-[13px] font-semibold">{p.docBase}</div> : (
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
          {!editing && " Leave the number blank for Chq-nnnnn (Chq) or RPnnnnn, or type your own such as NOC-0419."}
        </p>
      </section>

      <section className="card p-0">
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <h2 className="h2 mb-0">Lines ({lines.length})</h2>
          <span className="text-xs text-[var(--muted)]">Every field of a line is in one row — scroll sideways for the rest. Cheque / UTR columns are for Mode Chq.</span>
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn" onClick={() => setPasteOpen((o) => !o)}>Paste from Excel</button>
            <button type="button" className="btn" onClick={addLine}>+ Add line</button>
          </span>
        </div>
        {pasteOpen && (
          <div className="mx-5 mt-3 rounded-lg border border-[var(--line)] bg-slate-50 p-3">
            <p className="text-xs text-[var(--muted)]">
              Copy the rows in Excel and paste them here (up to 300 lines). With a header row (Head, R/P, Gross, GST, TDS, BkgID, Employee, Narration, Remarks, Project, Mode, Pay date, Branch, Purpose, PaymentMode, Bank, Chq/UTR No, Chq/UTR Date) the columns are matched by name.
              Without one, the order is: Head, R/P, Gross, GST, TDS, BkgID, Employee, Narration, Remarks.
            </p>
            <textarea className="input mt-2 h-32 w-full font-mono text-xs" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste here" />
            {pasteWarn.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">{pasteWarn.map((w, n) => <li key={n}>{w}</li>)}</ul>}
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-primary" disabled={!pasteText.trim()} onClick={applyPaste}>Add these lines</button>
              <button type="button" className="btn" onClick={() => { setPasteOpen(false); setPasteWarn([]); }}>Close</button>
            </div>
          </div>
        )}
        <div className="mt-3 max-h-[60vh] overflow-auto border-t border-[var(--line)]">
          <table className="table border-separate" style={{ minWidth: 70 + COLS.reduce((s, c) => s + c.w, 0) + 130 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-[3] w-[70px] min-w-[70px] bg-slate-50">#</th>
                {COLS.map((c) => <th key={c.k} className={c.right ? "text-right" : ""} style={{ minWidth: c.w }}>{c.label}</th>)}
                <th className="sticky right-0 z-[3] min-w-[130px] bg-slate-50 text-right">Line</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="sticky left-0 z-[1] bg-white text-xs text-[var(--muted)]">{i + 1}{l.id === undefined && editing ? <span className="ml-1 text-emerald-600" title="new line">●</span> : null}</td>
                  {COLS.map((c) => <td key={c.k} style={{ minWidth: c.w }} className={err(i, c.k) ? "bg-red-50" : ""}>{cell(i, c)}</td>)}
                  <td className="sticky right-0 z-[1] whitespace-nowrap bg-white text-right">
                    <button type="button" className="btn h-7 px-2" title="Duplicate line" onClick={() => dupLine(i)}>⧉ Copy</button>{" "}
                    <button type="button" className="btn btn-danger h-7 px-2" title="Remove line" disabled={lines.length === 1} onClick={() => delLine(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="project-list">{p.projects.map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="chq-purposes">{(p.chqLists?.purposes ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="chq-paymodes">{(p.chqLists?.paymentModes ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="chq-banks">{(p.chqLists?.banks ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        {lineErrors.length > 0 && (
          <div className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
            <b>Please fix:</b>
            <ul className="mt-1 list-disc pl-5">
              {lineErrors.slice(0, 12).map((e, n) => <li key={n}>Line {e.i + 1} · {labelOf(e.k)}: {e.v}</li>)}
              {lineErrors.length > 12 && <li>…and {lineErrors.length - 12} more</li>}
            </ul>
          </div>
        )}
      </section>

      <section className="card flex flex-wrap items-center gap-4 py-3">
        <span className="text-sm">Receipts <b>₹{fmtNum(totals.rec)}</b></span>
        <span className="text-sm">Payments <b>₹{fmtNum(totals.pay)}</b></span>
        <span className="text-sm text-[var(--muted)]">Net ₹{fmtNum(totals.net)} · {lines.length} line{lines.length === 1 ? "" : "s"}</span>
        <button className="btn btn-primary ml-auto" disabled={pending} onClick={() => go(editing ? "update_doc" : "create_doc")}>
          {pending ? "Saving…" : isMaster ? "Save document" : "Submit for Master approval"}
        </button>
        {!editing && <button className="btn" disabled={pending} onClick={saveDraft} title="Keep what you have typed and finish later">{draftId ? "Update draft" : "Save draft"}</button>}
        {editing && <button className="btn btn-danger" disabled={pending} onClick={() => go("delete_doc")}>Delete document</button>}
      </section>
    </div>
  );
}
