"use client";
import { useState, useTransition } from "react";
import { superiorDecideAction } from "@/app/actions";

export function SuperiorDecision({ token }: { token: string }) {
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) return <div className="card border-green-300 bg-green-50">{done}</div>;
  const go = (d: "approved" | "rejected") =>
    start(async () => {
      const r = await superiorDecideAction(token, d, comment);
      setDone(r.ok ? `Thank you — your decision (${d}) was sent to the Master.` : r.message ?? "Error");
    });
  return (
    <section className="card space-y-3">
      <label className="label" htmlFor="c">Comment (optional)</label>
      <textarea id="c" className="input min-h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending} onClick={() => go("approved")}>Approve</button>
        <button className="btn btn-danger" disabled={pending} onClick={() => go("rejected")}>Reject</button>
      </div>
    </section>
  );
}
