"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { DEMAND_COLUMNS, type DemandRow } from "@/lib/calc/demand";
import { fmtDate, fmtNum } from "@/lib/format";

type Tab = "due" | "cleared" | "nocost" | "all";
const TABS: [Tab, string][] = [["due", "Demand Due"], ["cleared", "Demand Cleared"], ["nocost", "Cost Missing"], ["all", "All"]];
const STATUS_TEXT: Record<string, string> = { due: "Due", cleared: "Cleared", nocost: "Cost Missing" };
const SEARCH: [keyof DemandRow, string][] = [
  ["Director", "Director"], ["Builder", "Builder"], ["Project", "Project"], ["Client", "Client Name"], ["BkgID", "BkgID"], ["UnitNo", "UnitNo"],
];
/** Per-sq-ft rates are not added up in subtotals. */
const NO_SUM = new Set(["BSPPSF", "AgreementRevisedPSF", "OtherChargesPSF", "TotalCostPSF"]);
const TOTAL_ROW = "bg-slate-100 font-bold [&>td]:border-y-2 [&>td]:border-slate-800";

const cell = (kind: string, v: unknown) =>
  kind === "date" ? fmtDate(v as number | null) : kind === "num" ? fmtNum(typeof v === "number" ? Math.round(v) : v) : String(v ?? "");

function sumRows(rows: DemandRow[]) {
  const t: Partial<Record<keyof DemandRow, number>> = {};
  for (const [k, , kind] of DEMAND_COLUMNS) if (kind === "num" && !NO_SUM.has(k)) t[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return t;
}

export function DemandReport({ rows }: { rows: DemandRow[] }) {
  const [tab, setTab] = useState<Tab>("due");
  const [q, setQ] = useState<Record<string, string>>({});

  const counts = useMemo(() => ({
    due: rows.filter((r) => r.status === "due").length,
    cleared: rows.filter((r) => r.status === "cleared").length,
    nocost: rows.filter((r) => r.status === "nocost").length,
    all: rows.length,
  }), [rows]);

  const shown = useMemo(() => {
    const terms = SEARCH.map(([k]) => [k, (q[k] ?? "").trim().toLowerCase()] as const).filter(([, v]) => v);
    return rows
      .filter((r) => tab === "all" || r.status === tab)
      .filter((r) => terms.every(([k, v]) => String(r[k] ?? "").toLowerCase().includes(v)));
  }, [rows, tab, q]);

  // rows arrive sorted by Director, so consecutive rows form each Director's group
  const groups = useMemo(() => {
    const g: { director: string; rows: DemandRow[] }[] = [];
    for (const r of shown) {
      const last = g[g.length - 1];
      if (last && last.director === r.Director) last.rows.push(r);
      else g.push({ director: r.Director, rows: [r] });
    }
    return g;
  }, [shown]);
  const grand = useMemo(() => sumRows(shown), [shown]);

  const totalCells = (label: string, t: Partial<Record<keyof DemandRow, number>>, n: number) =>
    DEMAND_COLUMNS.map(([k, , kind], i) => (
      <td key={k} className={kind === "num" ? "text-right" : ""}>
        {i === 0 ? `${label} (${n})` : t[k] !== undefined ? fmtNum(Math.round(t[k]!)) : ""}
      </td>
    ));

  function downloadCsv() {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const fmt = (r: DemandRow, k: keyof DemandRow, kind: string) =>
      kind === "date" ? fmtDate(r[k] as number | null) : kind === "num" ? String(Math.round(Number(r[k]) || 0)) : String(r[k] ?? "");
    const total = (label: string, t: Partial<Record<keyof DemandRow, number>>) =>
      ["", ...DEMAND_COLUMNS.map(([k], i) => (i === 0 ? label : t[k] !== undefined ? String(Math.round(t[k]!)) : ""))].map(esc).join(",");
    const lines = [["Status", ...DEMAND_COLUMNS.map(([, h]) => h)].join(",")];
    for (const g of groups) {
      for (const r of g.rows) lines.push([STATUS_TEXT[r.status], ...DEMAND_COLUMNS.map(([k, , kind]) => fmt(r, k, kind))].map(esc).join(","));
      lines.push(total(`Subtotal — ${g.director}`, sumRows(g.rows)));
    }
    lines.push(total("GRAND TOTAL", grand));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Demand-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([t, label]) => (
          <button key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
            {label} <span className="opacity-70">({counts[t]})</span>
          </button>
        ))}
        <button className="btn ml-auto" onClick={downloadCsv}>Download this view (.csv)</button>
      </div>

      <SearchBoxes fields={SEARCH as [string, string][]} q={q} setQ={setQ} />

      <p className="text-sm text-[var(--muted)]">
        {shown.length} booking(s) · Total net demand outstanding <b>₹{fmtNum(Math.round(grand.TotalOutstanding ?? 0))}</b> · 1st net demand incl. GST <b>₹{fmtNum(Math.round(grand.FirstNetDemandGST ?? 0))}</b>
        <span className="ml-3 inline-block h-3 w-3 rounded-sm bg-green-100 align-middle" /> cleared
        <span className="ml-3 inline-block h-3 w-3 rounded-sm bg-amber-100 align-middle" /> cost missing
      </p>

      <div className="card max-h-[70vh] overflow-auto p-0">
        <table className="table whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>{DEMAND_COLUMNS.map(([k, h, kind]) => <th key={k} className={kind === "num" || kind === "int" ? "text-right" : ""}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.director}>
                {g.rows.map((r) => (
                  <tr key={r.BkgID} className={r.status === "cleared" ? "bg-green-50" : r.status === "nocost" ? "bg-amber-50" : ""}>
                    {DEMAND_COLUMNS.map(([k, , kind]) => (
                      <td key={k} className={`${kind === "num" || kind === "int" ? "text-right" : ""} ${k === "DelayDays" && r.DelayDays > 0 ? "font-semibold text-red-700" : ""}`}>
                        {k === "BkgID" ? <Link className="text-[var(--brand)] underline" href={`/bookings/${r.BkgID}`}>{r.BkgID}</Link> : cell(kind, r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className={TOTAL_ROW}>{totalCells(`Subtotal — ${g.director}`, sumRows(g.rows), g.rows.length)}</tr>
              </Fragment>
            ))}
            {groups.length > 0 && <tr className={`${TOTAL_ROW} bg-slate-200`}>{totalCells("GRAND TOTAL", grand, shown.length)}</tr>}
            {!shown.length && <tr><td colSpan={DEMAND_COLUMNS.length} className="text-[var(--muted)]">No bookings match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Row of partial-text search boxes (shared with the Bkg page). */
export function SearchBoxes({ fields, q, setQ }: { fields: [string, string][]; q: Record<string, string>; setQ: (f: (x: Record<string, string>) => Record<string, string>) => void }) {
  return (
    <div className="card grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {fields.map(([k, label]) => (
        <div key={k}>
          <label className="label" htmlFor={`s-${k}`}>{label}</label>
          <input id={`s-${k}`} className="input" placeholder="contains…" value={q[k] ?? ""} onChange={(e) => setQ((x) => ({ ...x, [k]: e.target.value }))} />
        </div>
      ))}
      {Object.values(q).some(Boolean) && (
        <button className="btn col-span-2 md:col-span-3 lg:col-span-6" onClick={() => setQ(() => ({}))}>Clear search</button>
      )}
    </div>
  );
}
