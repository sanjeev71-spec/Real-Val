"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { empRequestAction } from "@/app/actions";
import { CORRECT_FIELDS, PERIOD_FIELDS, PERSON_FIELDS, type EmpField } from "@/lib/empFields";

type Val = string | number | null;
type Mode = "create" | "change" | "correct" | "exit";

export function EmpEditor(p: {
  mode: Mode;
  role: string;
  employees: string[];
  current?: Record<string, Val>; // the current period (for change / correct / exit)
  reportees?: string[]; // people reporting to this employee now (for exit)
}) {
  const router = useRouter();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const init: Record<string, Val> =
    p.mode === "create" ? { type: "Sales", applicable: "Y", company: "RV", status: "Active", doj: today } : { ...(p.current ?? {}) };
  if (p.mode === "change") init.effectiveFrom = today;
  if (p.mode === "exit") init.exitDate = today;
  const [d, setD] = useState<Record<string, Val>>(init);
  const [reassign, setReassign] = useState<Record<string, string>>(
    Object.fromEntries((p.reportees ?? []).map((r) => [r, String(p.current?.reportingHead ?? "")])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, v: Val) => setD((x) => ({ ...x, [k]: v }));

  const fields: EmpField[] =
    p.mode === "create" ? [...PERIOD_FIELDS.filter((f) => f.key !== "status"), ...PERSON_FIELDS]
    : p.mode === "change" ? PERIOD_FIELDS
    : p.mode === "correct" ? CORRECT_FIELDS
    : [];

  function submit() {
    setMsg(null);
    const payload: Record<string, unknown> = { ...d };
    if (p.mode !== "create") payload.code = String(p.current?.emp ?? "").split("~")[1];
    if (p.mode === "exit") payload.reassign = Object.entries(reassign).map(([emp, newHead]) => ({ emp, newHead }));
    start(async () => {
      const r = await empRequestAction(p.mode, payload);
      if (!r.ok) {
        setErrors(r.errors ?? {});
        setMsg(r.message ?? Object.values(r.errors ?? {})[0] ?? "Please fix the highlighted fields.");
        return;
      }
      if (r.applied) {
        const code = p.mode === "create" ? String(d.code ?? "") : String(p.current?.emp ?? "").split("~")[1];
        router.push(`/emp/${encodeURIComponent(code)}`);
      } else router.push(`/changes/${r.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {msg && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{msg}</div>}

      {p.mode === "create" && (
        <section className="card">
          <h2 className="h2">Employee</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field k="name" label="Name" req errors={errors}><Input k="name" d={d} set={set} /></Field>
            <Field k="code" label="Employee code" req errors={errors}><Input k="code" d={d} set={set} /></Field>
          </div>
        </section>
      )}
      {p.mode === "change" && (
        <section className="card">
          <h2 className="h2">Effective from</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field k="effectiveFrom" label="New values apply from" req errors={errors}><Input k="effectiveFrom" type="date" d={d} set={set} /></Field>
            <p className="text-sm text-[var(--muted)] md:col-span-2">The current period closes the day before; bookings before this date keep the old hierarchy.</p>
          </div>
        </section>
      )}
      {p.mode === "exit" && (
        <section className="card space-y-3">
          <h2 className="h2">Exit</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field k="exitDate" label="Last working day" req errors={errors}><Input k="exitDate" type="date" d={d} set={set} /></Field>
          </div>
          {(p.reportees ?? []).length > 0 ? (
            <>
              <p className="text-sm">These people report to {String(p.current?.emp)}. From the day after the exit they will report to:</p>
              <table className="table">
                <thead><tr><th>Employee</th><th>New reporting head</th></tr></thead>
                <tbody>
                  {(p.reportees ?? []).map((r) => (
                    <tr key={r}>
                      <td>{r}</td>
                      <td>
                        <input className="input" list="emp-all" value={reassign[r] ?? ""} onChange={(e) => setReassign((x) => ({ ...x, [r]: e.target.value }))} />
                        {errors[`reassign:${r}`] && <p className="err">{errors[`reassign:${r}`]}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="text-sm text-[var(--muted)]">Nobody reports to this employee.</p>}
        </section>
      )}

      {fields.length > 0 && (
        <section className="card">
          <h2 className="h2">{p.mode === "correct" ? "Correct details (no new period)" : "Details"}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {fields.map((f) => (
              <Field key={f.key} k={f.key} label={f.label} errors={errors} hint={f.hint} req={p.mode === "create" && ["reportingHead", "doj"].includes(f.key)}>
                {f.type === "select" ? (
                  <select id={f.key} className="input" value={String(d[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value || null)}>
                    <option value="">—</option>
                    {f.options!.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : f.type === "emp" ? (
                  <input id={f.key} className="input" list="emp-all" value={String(d[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value || null)} placeholder="Type to search" />
                ) : (
                  <Input k={f.key} type={f.type === "date" ? "date" : "text"} d={d} set={set} num={f.type === "number"} />
                )}
              </Field>
            ))}
          </div>
        </section>
      )}
      <datalist id="emp-all">{p.employees.map((n) => <option key={n} value={n} />)}</datalist>

      <section className="card">
        <button className="btn btn-primary" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : p.role === "master" ? "Save" : "Submit for Master approval"}
        </button>
      </section>
    </div>
  );
}

function Input({ k, d, set, type = "text", num }: { k: string; d: Record<string, Val>; set: (k: string, v: Val) => void; type?: string; num?: boolean }) {
  return (
    <input
      id={k}
      className={`input ${num ? "text-right" : ""}`}
      type={type}
      inputMode={num ? "decimal" : undefined}
      value={String(d[k] ?? "")}
      onChange={(e) => set(k, e.target.value === "" ? null : num && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value)}
    />
  );
}

function Field({ k, label, req, hint, errors, children }: { k: string; label: string; req?: boolean; hint?: string; errors: Record<string, string>; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={k}>{label}{req && <span className="text-red-600"> *</span>}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>}
      {errors[k] && <p className="err">{errors[k]}</p>}
    </div>
  );
}
