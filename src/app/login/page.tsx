"use client";
import { useState, useTransition } from "react";
import { sendCodeAction, verifyCodeAction } from "../actions";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mx-auto mt-16 max-w-sm card">
      <h1 className="h1 mb-1">Sign in</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        {step === "email" ? "Enter your registered email. We'll send you a 6-digit code." : `Enter the code sent to ${email}. It expires in 10 minutes.`}
      </p>
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await sendCodeAction(email);
              if (r.ok) { setStep("code"); setMsg(null); } else setMsg(r.message ?? "Error");
            });
          }}
        >
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoFocus className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary mt-4 w-full" disabled={pending}>{pending ? "Sending…" : "Send code"}</button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await verifyCodeAction(email, code);
              if (r && !r.ok) setMsg(r.message ?? "Error");
            });
          }}
        >
          <label className="label" htmlFor="code">Code</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className="input tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-primary mt-4 w-full" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
          <button type="button" className="mt-2 w-full text-xs text-[var(--muted)] underline" onClick={() => { setStep("email"); setCode(""); setMsg(null); }}>
            Use a different email / resend code
          </button>
        </form>
      )}
      {msg && <p className="err mt-3">{msg}</p>}
    </div>
  );
}
