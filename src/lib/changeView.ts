// Display helpers for Exp/Emp change requests (safe for browser and server).

export const CHANGE_STATUS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-slate-100",
};

export function describeChange(entity: string, d: Record<string, unknown>) {
  if (entity === "exp") return `${d.head ?? ""} · ${d.mode ?? ""} · ${d.rp ?? ""} ₹${d.gross ?? ""} · ${d.bkgId ?? ""} ${d.emp ?? ""}`;
  return String(d.emp ?? "");
}
