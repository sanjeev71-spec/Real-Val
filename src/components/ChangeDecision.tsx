"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideChangeAction, nudgeChangeAction, withdrawChangeAction } from "@/app/actions";

export function ChangeDecision({ id, isMaster, isRequester, nudgeWaitMs }: { id: number; isMaster: boolean; isRequester: boolean; nudgeWaitMs: number }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!isMaster && !isRequester) return null;
  const run = (fn: () => Promise<{ ok: boolean; message?: string; errors?: Record<string, string>; ref?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: r.ref ? `${okText} (${r.ref})` : okText });
        router.refresh();
      } else setMsg({ ok: false, text: [r.message, ...Object.values(r.errors ?? {})].filter(Boolean).join(" · ") });
    });
  return (
    <section className="card space-y-3">
      {isMaster && (
        <>
          <label className="label" htmlFor="cmt">Comment (required to reject)</label>
          <textarea id="cmt" className="input min-h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={pending} onClick={() => run(() => decideChangeAction(id, true, comment), "Approved and applied")}>Approve & apply</button>
            <button className="btn btn-danger" disabled={pending} onClick={() => run(() => decideChangeAction(id, false, comment), "Rejected")}>Reject</button>
          </div>
        </>
      )}
      {isRequester && !isMaster && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button className="btn" disabled={pending || nudgeWaitMs > 0} onClick={() => run(() => nudgeChangeAction(id), "Reminder sent to the Master")}>Nudge Master</button>
          {nudgeWaitMs > 0 && <span className="text-[var(--muted)]">Next nudge in {Math.ceil(nudgeWaitMs / 3600_000)} h</span>}
          <button className="btn btn-danger" disabled={pending} onClick={() => run(() => withdrawChangeAction(id), "Withdrawn")}>Withdraw</button>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}
