"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideAction, nudgeAction, superiorRequestAction } from "@/app/actions";

export function ActionPanel(p: {
  id: number;
  role: string;
  canDecide: boolean;
  canNudge: boolean;
  nudgeWaitMs: number;
  canAskSuperior: boolean;
  defaultSuperior: string;
  approveLabel: string;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [superior, setSuperior] = useState(p.defaultSuperior);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!p.canDecide && !p.canNudge && !p.canAskSuperior) return null;

  const run = (fn: () => Promise<{ ok: boolean; message?: string; errors?: Record<string, string>; bkgId?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: r.bkgId ? `Added to Bkg as ${r.bkgId}.` : okText });
        setComment("");
        router.refresh();
      } else setMsg({ ok: false, text: [r.message, ...Object.values(r.errors ?? {})].filter(Boolean).join(" · ") });
    });

  return (
    <section className="card space-y-3">
      {p.canDecide && (
        <>
          <label className="label" htmlFor="comment">Comment (required to send back or reject)</label>
          <textarea id="comment" className="input min-h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={pending} onClick={() => run(() => decideAction(p.id, "approve", comment), "Approved.")}>{p.approveLabel}</button>
            <button className="btn" disabled={pending} onClick={() => run(() => decideAction(p.id, "return", comment), "Sent back to the submitter.")}>Send back for changes</button>
            <button className="btn btn-danger" disabled={pending} onClick={() => run(() => decideAction(p.id, "reject", comment), "Rejected.")}>Reject</button>
          </div>
        </>
      )}
      {p.canAskSuperior && (
        <div className="flex flex-wrap items-end gap-2 border-t border-[var(--line)] pt-3">
          <div className="min-w-64 flex-1">
            <label className="label" htmlFor="sup">Ask my superior to approve (email)</label>
            <input id="sup" className="input" type="email" value={superior} onChange={(e) => setSuperior(e.target.value)} />
          </div>
          <button className="btn" disabled={pending || !superior} onClick={() => run(() => superiorRequestAction(p.id, superior, comment), `Approval request emailed to ${superior}.`)}>
            Send to superior
          </button>
        </div>
      )}
      {p.canNudge && (
        <div className="flex items-center gap-3 border-t border-[var(--line)] pt-3 text-sm">
          <button className="btn" disabled={pending || p.nudgeWaitMs > 0} onClick={() => run(() => nudgeAction(p.id), "Reminder sent to the approver.")}>
            Nudge approver
          </button>
          {p.nudgeWaitMs > 0 && <span className="text-[var(--muted)]">Next nudge possible in {Math.ceil(p.nudgeWaitMs / 3600_000)} h</span>}
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}
