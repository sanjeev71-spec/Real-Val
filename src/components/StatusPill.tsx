import { STATUS_LABEL } from "@/lib/format";

const COLOR: Record<string, string> = {
  pending_admin: "bg-amber-100 text-amber-800",
  pending_master: "bg-blue-100 text-blue-800",
  returned: "bg-orange-100 text-orange-800",
  rejected: "bg-red-100 text-red-800",
  approved: "bg-green-100 text-green-800",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${COLOR[status] ?? "bg-slate-100"}`}>{STATUS_LABEL[status] ?? status}</span>;
}
