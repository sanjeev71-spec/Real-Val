import { DATE_KEYS, NUMBER_KEYS, PERCENT_KEYS } from "./fields";

export function fmtDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString();
    return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  }
  return String(v);
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const fmtNum = (v: unknown) => (typeof v === "number" ? inr.format(v) : v === null || v === undefined ? "" : String(v));

export function fmtCell(key: string, v: unknown): string {
  if (DATE_KEYS.has(key)) return fmtDate(v);
  if (PERCENT_KEYS.has(key) && typeof v === "number") return `${(v * 100).toFixed(1)}%`;
  if (typeof v === "number") return fmtNum(v);
  if (NUMBER_KEYS.has(key)) return fmtNum(v);
  return v === null || v === undefined ? "" : String(v);
}

export const STATUS_LABEL: Record<string, string> = {
  pending_admin: "Waiting for Admin",
  pending_master: "Waiting for Master",
  returned: "Sent back",
  rejected: "Rejected",
  approved: "Approved",
};

export const ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted",
  submitted_and_approved: "Entered by Master",
  resubmitted: "Resubmitted",
  edited: "Edited",
  admin_approved: "Approved by Admin",
  master_approved: "Validated by Master — added to Bkg",
  sent_back: "Sent back",
  rejected: "Rejected",
  nudged: "Nudged",
  superior_requested: "Sent to superior",
  superior_approved: "Superior approved",
  superior_rejected: "Superior rejected",
};
