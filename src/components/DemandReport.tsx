"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { DEMAND_COLUMNS, type DemandRow } from "@/lib/calc/demand";
import { fmtDate, fmtNum } from "@/lib/format";

type Tab = "due" | "cleared" | "all";
const TABS: [Tab, string][] = [["due", "Demand Due"], ["cleared", "Demand Cleared"], ["all", "All"]];
const SEARCH: [keyof DemandRow, string][] = [
  ["Director", "Director"], ["Builder", "Builder"], ["Project", "Project"], ["Client", "Client Name"], ["BkgID", "BkgID"], ["UnitNo", "UnitNo"],
];

const cell = (kind: string, v: unknown) =>
  kind === "date" ? fmtDate(v as number | null) : kind === "num" ? fmtNum(typeof v === "number" ? Math.round(v) : v) : kind === "int" ? String(v ?? "") : String(v ?? "");

export function DemandReport({ rows }: { rows: DemandRow[] }) {
  const [tab, setTab] = useState<Tab>("due");
  const [q, setQ] = useState<Record<string, string>>({});

  const counts = useMemo(() => ({
    due: rows.filter((r) => r.status === "due").length,
    cleared: rows.filter((r) => r.status === "cleared").length,
    all: rows.length,
  }), [rows]);

  const shown = useMemo(() => {
    const terms = SEARCH.map(([k]) => [k, (q[k] ?? "").trim().toLowerCase()] as const).filter(([, v]) => v);
    return rows
      .filter((r) => tab === "all" || r.status === tab)
      .filter((r) => terms.every(([k, v]) => String(r[k] ?? "").toLowerCase().includes(v)));
  }, [rows, tab, q]);

  const totals = useMemo(() => {
    const t: Partial<Record<keyof DemandRow, number>> = {};
    for (const [k, , kind] of DEMAND_COLUMNS)
      if (kind === "num" && !["BSPPSF", "AgreementRevisedPSF", "OtherChargesPSF", "TotalCostPSF"].includes(k))
        t[k] = shown.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return t;
  }, [shown]);

  function downloadCsv() {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [
      ["Status", ...DEMAND_COLUMNS.map(([, h]) => h)].join(","),
      ...shown.map((r) =>
        [r.status === "due" ? "Due" : r.status === "cleared" ? "Cleared" : "Costing missing",
          ...DEMAND_COLUMNS.map(([k, , kind]) => (kind === "date" ? fmtDate(r[k] as number | null) : kind === "num" ? String(Math.round(Number(r[k]) || 0)) : String(r[k] ?? "")))]
          .map(esc).join(","),
      ),
    ];
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

      <div className="card grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {SEARCH.map(([k, label]) => (
          <div key={k}>
            <label className="label" htmlFor={`s-${k}`}>{label}</label>
            <input id={`s-${k}`} className="input" placeholder="contains…" value={q[k] ?? ""} onChange={(e) => setQ((x) => ({ ...x, [k]: e.target.value }))} />
          </div>
        ))}
        {Object.values(q).some(Boolean) && (
          <button className="btn col-span-2 md:col-span-3 lg:col-span-6" onClick={() => setQ({})}>Clear search</button>
        )}
      </div>

      <p className="text-sm text-[var(--muted)]">
        {shown.length} booking(s) · Total net demand outstanding <b>₹{fmtNum(Math.round(totals.TotalOutstanding ?? 0))}</b> · 1st net demand incl. GST <b>₹{fmtNum(Math.round(totals.FirstNetDemandGST ?? 0))}</b>
        <span className="ml-3 inline-block h-3 w-3 rounded-sm bg-green-100 align-middle" /> cleared
        <span className="ml-3 inline-block h-3 w-3 rounded-sm bg-amber-100 align-middle" /> costing missing
      </p>

      <div className="card max-h-[70vh] overflow-auto p-0">
        <table className="table whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>{DEMAND_COLUMNS.map(([k, h, kind]) => <th key={k} className={kind === "num" || kind === "int" ? "text-right" : ""}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.BkgID} className={r.status === "cleared" ? "bg-green-50" : r.status === "nocost" ? "bg-amber-50" : ""}>
                {DEMAND_COLUMNS.map(([k, , kind]) => (
                  <td key={k} className={`${kind === "num" || kind === "int" ? "text-right" : ""} ${k === "DelayDays" && r.DelayDays > 0 ? "font-semibold text-red-700" : ""}`}>
                    {k === "BkgID" ? <Link className="text-[var(--brand)] underline" href={`/bookings/${r.BkgID}`}>{r.BkgID}</Link> : cell(kind, r[k])}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={DEMAND_COLUMNS.length} className="text-[var(--muted)]">No bookings match.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-100 font-semibold">
              <tr>
                {DEMAND_COLUMNS.map(([k, , kind], i) => (
                  <td key={k} className={kind === "num" ? "text-right" : ""}>{i === 0 ? "TOTAL" : totals[k] !== undefined ? fmtNum(Math.round(totals[k]!)) : ""}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
