"use client";
import { useState, useTransition } from "react";
import { saveUserAction } from "@/app/actions";
import type { Role } from "@/lib/auth";

type U = { id?: number; email: string; name: string; role: Role; empCode: string; active: boolean };

export function UserEditor({ users, empNames, meId }: { users: U[]; empNames: string[]; meId: number }) {
  const blank: U = { email: "", name: "", role: "sales", empCode: "", active: true };
  return (
    <div className="card overflow-x-auto">
      <datalist id="emp-names">{empNames.map((n) => <option key={n} value={n} />)}</datalist>
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Emp (Name~Code)</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => <Row key={u.id} initial={u} isMe={u.id === meId} />)}
          <Row key="new" initial={blank} isMe={false} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ initial, isMe }: { initial: U; isMe: boolean }) {
  const [u, setU] = useState<U>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isNew = !initial.id;
  return (
    <tr>
      <td><input className="input" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} placeholder={isNew ? "New user name" : ""} /></td>
      <td><input className="input" type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></td>
      <td>
        <select className="input" value={u.role} disabled={isMe} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
          <option value="sales">Sales user</option>
          <option value="admin">Admin</option>
          <option value="hr">HR</option>
          {isMe && <option value="master">Master</option>}
        </select>
      </td>
      <td><input className="input" list="emp-names" value={u.empCode} onChange={(e) => setU({ ...u, empCode: e.target.value })} /></td>
      <td><input type="checkbox" checked={u.active} disabled={isMe} onChange={(e) => setU({ ...u, active: e.target.checked })} /></td>
      <td className="whitespace-nowrap">
        <button className="btn" disabled={pending} onClick={() => start(async () => {
          const r = await saveUserAction(u);
          setMsg(r.ok ? "Saved" : r.message ?? "Error");
          if (r.ok && isNew) setU(initial);
        })}>{isNew ? "Add" : "Save"}</button>
        {msg && <span className="ml-2 text-xs text-[var(--muted)]">{msg}</span>}
      </td>
    </tr>
  );
}
