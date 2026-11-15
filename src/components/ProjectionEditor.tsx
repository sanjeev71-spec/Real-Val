"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProjectionAction } from "@/app/actions";

interface Row { empCode: string; manMonths: string; bkgCount: string; directorRevenue: string; remarks: string }

const toNum = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,\s]/g, "")));

export function ProjectionEditor({ year, years, initial, people }: { year: number; years: number[]; initial: Row[]; people: { code: string; name: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const nameOf = (code: string) => people.find((p) => p.code.toLowerCase() === code.trim().toLowerCase())?.name ?? "";
  const set = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const sum = (k: "manMonths" | "bkgCount" | "directorRevenue") => rows.reduce((s, r) => s + (toNum(r[k]) ?? 0), 0);

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveProjectionAction(year, rows.filter((x) => x.empCode.trim()).map((x) => ({
        empCode: x.empCode.trim(), manMonths: toNum(x.manMonths), bkgCount: toNum(x.bkgCount), directorRevenue: toNum(x.directorRevenue), remarks: x.remarks || null,
      })));
      setMsg({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {[...new Set([...years, year])].sort().map((y) => (
          <a key={y} className={`btn ${y === year ? "btn-primary" : ""}`} href={`/admin/projection?year=${y}`}>{y}</a>
        ))}
        <a className="btn" href={`/admin/projection?year=${Math.max(...years, year) + 1}`}>+ New year</a>
      </div>
      {msg && <div className={`card text-sm ${msg.ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50 text-red-800"}`}>{msg.text}</div>}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Employee code</th><th>Name</th><th className="text-right">Man-months (year)</th><th className="text-right">Booking count (year)</th><th className="text-right">DirectorRevenue (year)</th><th>Remarks</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className="input w-28" list="proj-codes" value={r.empCode} onChange={(e) => set(i, "empCode", e.target.value)} /></td>
                <td className="text-sm">{nameOf(r.empCode) || <span className="text-red-600">{r.empCode ? "not in Emp" : ""}</span>}</td>
                <td><input className="input w-28 text-right" inputMode="decimal" value={r.manMonths} onChange={(e) => set(i, "manMonths", e.target.value)} /></td>
                <td><input className="input w-28 text-right" inputMode="decimal" value={r.bkgCount} onChange={(e) => set(i, "bkgCount", e.target.value)} /></td>
                <td><input className="input w-40 text-right" inputMode="decimal" value={r.directorRevenue} onChange={(e) => set(i, "directorRevenue", e.target.value)} /></td>
                <td><input className="input w-32" value={r.remarks} onChange={(e) => set(i, "remarks", e.target.value)} /></td>
                <td><button className="btn btn-danger" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2}>Total ({rows.length} rows)</td>
              <td className="text-right">{sum("manMonths").toLocaleString("en-IN")}</td><td className="text-right">{sum("bkgCount").toLocaleString("en-IN")}</td>
              <td className="text-right">{sum("directorRevenue").toLocaleString("en-IN")}</td><td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
        <datalist id="proj-codes">{people.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</datalist>
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={() => setRows((r) => [...r, { empCode: "", manMonths: "", bkgCount: "", directorRevenue: "", remarks: "" }])}>+ Add row</button>
        <button className="btn btn-primary ml-auto" disabled={pending} onClick={save}>{pending ? "Saving…" : `Save ${year}`}</button>
      </div>
    </div>
  );
}
