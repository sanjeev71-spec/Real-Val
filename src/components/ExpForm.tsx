"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expRequestAction } from "@/app/actions";
import { fmtNum } from "@/lib/format";

export interface ExpFormProps {
  role: string;
  heads: { head: string; type: string | null }[];
  modes: string[];
  employees: string[];
  projects: string[];
  bookings: { id: string; client: string; emp: string; project: string }[];
  initial?: Record<string, string | number | null>;
  targetId?: number;
}

export function ExpForm(p: ExpFormProps) {
  const router = useRouter();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [d, setD] = useState<Record<string, string | number | null>>(p.initial ?? { payDate: today, valueDate: today, rp: "Receipt" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const isMaster = p.role === "master";

  const booking = useMemo(() => p.bookings.find((b) => b.id.toUpperCase() === String(d.bkgId ?? "").toUpperCase()), [d.bkgId, p.bookings]);
  const type = p.heads.find((h) => h.head === d.head)?.type ?? "";
  const set = (k: string, v: string | number | null) =>
    setD((x) => {
      const n = { ...x, [k]: v };
      if (k === "bkgId") {
        const b = p.bookings.find((y) => y.id.toUpperCase() === String(v ?? "").toUpperCase());
        if (b) n.emp = b.emp; // default Emp from the booking; still editable
      }
      if (k === "payDate" && (!x.valueDate || x.valueDate === x.payDate)) n.valueDate = v;
      return n;
    });

  const input = (k: string, type = "text", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={k} className="input" type={type} value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value === "" ? null : e.target.value)} {...extra} />
  );

  function go(action: "create" | "update" | "delete") {
    setMsg(null);
    if (action === "delete" && !confirm("Delete this Exp entry?" + (isMaster ? "" : " (Master must approve)"))) return;
    start(async () => {
      const r = await expRequestAction(action, d, p.targetId);
      if (!r.ok) {
        setErrors(r.errors ?? {});
        setMsg({ ok: false, text: r.message ?? "Please fix the highlighted fields." });
        return;
      }
      if (r.applied) {
        setMsg({ ok: true, text: action === "delete" ? "Deleted." : `Saved${r.ref ? ` as ${r.ref}` : ""}.` });
        router.push("/exp");
      } else {
        router.push(`/changes/${r.id}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {msg && <div className={`card text-sm ${msg.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50 text-red-800"}`}>{msg.text}</div>}
      <section className="card">
        <h2 className="h2">Entry</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field errors={errors} k="payDate" label="Pay date" req>{input("payDate", "date")}</Field>
          <Field errors={errors} k="valueDate" label="Value date" req>{input("valueDate", "date")}</Field>
          <Field errors={errors} k="rp" label="Receipt / Payment" req>
            <select id="rp" className="input" value={String(d.rp ?? "")} onChange={(e) => set("rp", e.target.value)}>
              <option>Receipt</option><option>Payment</option>
            </select>
          </Field>
          <Field errors={errors} k="head" label={`Head${type ? ` (${type})` : ""}`} req>
            <select id="head" className="input" value={String(d.head ?? "")} onChange={(e) => set("head", e.target.value || null)}>
              <option value="">— select —</option>
              {p.heads.map((h) => <option key={h.head} value={h.head}>{h.head}</option>)}
            </select>
          </Field>
          <Field errors={errors} k="mode" label="Mode" req>
            <select id="mode" className="input" value={String(d.mode ?? "")} onChange={(e) => set("mode", e.target.value || null)}>
              <option value="">— select —</option>
              {p.modes.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field errors={errors} k="branch" label="Branch">{input("branch")}</Field>
          <Field errors={errors} k="gross" label="Gross (Rs)" req>{input("gross", "text", { inputMode: "decimal", className: "input text-right" })}</Field>
          <Field errors={errors} k="gst" label="GST (Rs)">{input("gst", "text", { inputMode: "decimal", className: "input text-right" })}</Field>
          <Field errors={errors} k="tds" label="TDS (Rs)">{input("tds", "text", { inputMode: "decimal", className: "input text-right" })}</Field>
        </div>
      </section>

      <section className="card">
        <h2 className="h2">Booking / employee</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field errors={errors} k="bkgId" label="BkgID (optional)">
            <input id="bkgId" className="input" list="bkg-list" value={String(d.bkgId ?? "")} onChange={(e) => set("bkgId", e.target.value || null)} placeholder="RV0001" />
            <datalist id="bkg-list">{p.bookings.map((b) => <option key={b.id} value={b.id}>{b.client} · {b.project}</option>)}</datalist>
          </Field>
          <div>
            <span className="label">Client / project (from booking)</span>
            <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">{booking ? `${booking.client} · ${booking.project}` : "—"}</div>
          </div>
          {!booking ? (
            <Field errors={errors} k="project" label="Project (if not tied to a booking)">
              <select id="project" className="input" value={String(d.project ?? "")} onChange={(e) => set("project", e.target.value || null)}>
                <option value="">—</option>
                {p.projects.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
          ) : <div />}
          <Field errors={errors} k="emp" label="Employee (defaults from booking, changeable)" req>
            <input id="emp" className="input" list="emp-list2" value={String(d.emp ?? "")} onChange={(e) => set("emp", e.target.value || null)} placeholder="Type to search" />
            <datalist id="emp-list2">{p.employees.map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <Field errors={errors} k="narration" label="Narration">{input("narration")}</Field>
          <Field errors={errors} k="remarks" label="Remarks">{input("remarks")}</Field>
        </div>
      </section>

      <section className="card flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--muted)]">Net: ₹{fmtNum((Number(d.gross) || 0) + (Number(d.gst) || 0) - (Number(d.tds) || 0))}</span>
        <button className="btn btn-primary ml-auto" disabled={pending} onClick={() => go(p.targetId ? "update" : "create")}>
          {pending ? "Saving…" : isMaster ? "Save" : "Submit for Master approval"}
        </button>
        {p.targetId && <button className="btn btn-danger" disabled={pending} onClick={() => go("delete")}>Delete</button>}
      </section>
    </div>
  );
}

function Field({ k, label, req, errors, children }: { k: string; label: string; req?: boolean; errors: Record<string, string>; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={k}>{label}{req && <span className="text-red-600"> *</span>}</label>
      {children}
      {errors[k] && <p className="err">{errors[k]}</p>}
    </div>
  );
}
