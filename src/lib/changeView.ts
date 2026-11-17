// Display helpers for Exp/Emp change requests (safe for browser and server).

export const CHANGE_STATUS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-slate-100",
};

export function describeChange(entity: string, d: Record<string, unknown>) {
  if (Array.isArray(d.creates) || Array.isArray(d.updates)) return `Upload ${d.fileName ?? ""}: ${(d.creates as unknown[] | undefined)?.length ?? 0} new, ${(d.updates as unknown[] | undefined)?.length ?? 0} changed`;
  if (entity === "exp" && Array.isArray(d.lines)) {
    const ls = d.lines as { rp?: string; gross?: number | string }[];
    const net = ls.reduce((a, l) => a + (l.rp === "Receipt" ? 1 : -1) * (Number(l.gross) || 0), 0);
    return `Document ${d.docBase ?? "(new)"} · ${ls.length} lines · net ₹${net}`;
  }
  if (entity === "exp") return `${d.head ?? ""} · ${d.mode ?? ""} · ${d.rp ?? ""} ₹${d.gross ?? ""} · ${d.bkgId ?? ""} ${d.emp ?? ""}`;
  return String(d.emp ?? "");
}
