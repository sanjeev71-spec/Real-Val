"use client";
import { useMemo, useState } from "react";
import type { OrgNode } from "@/lib/data";
import { fmtDate } from "@/lib/format";

type Mode = "active" | "inactive" | "all";
interface TreeNode extends OrgNode {
  children: TreeNode[];
  via: string[]; // inactive managers skipped over (Active view)
  dim: boolean; // shown only to connect a match to the top
}

const ACTIVE_BG = "bg-[#dcf5e3] border-[#86c99a]";
const INACTIVE_BG = "bg-[#ffe3d3] border-[#f0b48f]";

export function OrgChart({ nodes, partners }: { nodes: OrgNode[]; partners: string[] }) {
  const [mode, setMode] = useState<Mode>("active");
  const [term, setTerm] = useState("");

  const { roots, partnerNodes, matchCount } = useMemo(() => build(nodes, partners, mode, term.trim().toLowerCase()), [nodes, partners, mode, term]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label" htmlFor="org-name">Name</label>
          <input id="org-name" className="input" placeholder="Type part of a name…" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {(["active", "inactive", "all"] as Mode[]).map((m) => (
            <button key={m} className={`btn capitalize ${mode === m ? "btn-primary" : ""}`} onClick={() => setMode(m)}>{m}</button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span><span className={`inline-block h-3 w-3 rounded-sm border align-middle ${ACTIVE_BG}`} /> active</span>
          <span><span className={`inline-block h-3 w-3 rounded-sm border align-middle ${INACTIVE_BG}`} /> inactive</span>
          <span><b className="text-slate-800">Bold</b> = carries RevShare</span>
        </div>
      </div>

      {!term && (
        <section className="card text-center">
          <h2 className="h2">Partners — profit shared equally ({partnerNodes.length ? Math.round(100 / partnerNodes.length) : 0}% each)</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {partnerNodes.map((p) => (
              <div key={p.code} className="min-w-36 rounded-md border-2 border-[#b6752e] bg-[#f6e7d6] px-3 py-2 text-sm font-semibold">{p.name}</div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">Below: the operational reporting chain from Emp (used for RevShare and headcount) — not the ownership structure.</p>
        </section>
      )}

      {term && <p className="text-sm text-[var(--muted)]">{matchCount} match(es). Grey boxes are shown only to connect the matches to the top.</p>}

      {roots.map((root) => (
        <section key={root.code} className="card overflow-x-auto">
          <div className="flex justify-center"><Box n={root} /></div>
          {root.children.length > 0 && (
            <div className="mt-3 flex flex-wrap items-start justify-center gap-4 border-t border-[var(--line)] pt-3">
              {root.children.map((c) => (
                <div key={c.code} className="min-w-48">
                  <Box n={c} />
                  <Branch nodes={c.children} />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      {!roots.length && <p className="card text-sm text-[var(--muted)]">Nobody matches.</p>}
    </div>
  );
}

function Branch({ nodes }: { nodes: TreeNode[] }) {
  if (!nodes.length) return null;
  return (
    <ul className="ml-3 border-l border-slate-300 pl-3">
      {nodes.map((n) => (
        <li key={n.code} className="relative mt-2 before:absolute before:-left-3 before:top-4 before:w-3 before:border-t before:border-slate-300">
          <Box n={n} />
          <Branch nodes={n.children} />
        </li>
      ))}
    </ul>
  );
}

function Box({ n }: { n: TreeNode }) {
  return (
    <div className={`inline-block rounded-md border px-2.5 py-1.5 text-sm ${n.active ? ACTIVE_BG : INACTIVE_BG} ${n.revShare ? "border-2 font-semibold" : ""} ${n.dim ? "opacity-45" : ""}`}>
      <div>{n.name}</div>
      <div className="text-[11px] font-normal text-slate-600">
        {[n.designation, n.branch].filter(Boolean).join(" · ")}
        {!n.active && n.leftOn ? ` · left ${fmtDate(n.leftOn)}` : ""}
      </div>
      {n.via.length > 0 && <div className="text-[11px] font-normal italic text-slate-500">via inactive {n.via.join(", ")}</div>}
    </div>
  );
}

function build(all: OrgNode[], partnerEmps: string[], mode: Mode, term: string) {
  const byCode = new Map(all.map((n) => [n.code, n]));
  const partnerCodes = new Set(partnerEmps.map((e) => e.split("~")[1]));
  const partnerNodes = partnerEmps.map((e) => byCode.get(e.split("~")[1]!)).filter(Boolean) as OrgNode[];

  // Parent of each node. Active view skips over inactive managers ("via inactive …").
  const parentOf = new Map<string, { parent: string | null; via: string[] }>();
  for (const n of all) {
    let h = n.headCode;
    const via: string[] = [];
    const seen = new Set([n.code]);
    if (mode === "active") {
      while (h && byCode.has(h) && !byCode.get(h)!.active && !seen.has(h)) {
        seen.add(h);
        via.push(byCode.get(h)!.name);
        h = byCode.get(h)!.headCode;
      }
    }
    parentOf.set(n.code, { parent: h && h !== n.code && byCode.has(h) ? h : null, via });
  }
  const childrenOf = new Map<string, string[]>();
  for (const [c, { parent }] of parentOf) if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), c]);

  const inMode = (n: OrgNode) => (mode === "all" ? true : mode === "active" ? n.active : !n.active);
  const base = new Set(all.filter(inMode).map((n) => n.code));
  const matches = new Set(term ? [...base].filter((c) => byCode.get(c)!.name.toLowerCase().includes(term)) : base);

  const visible = new Set<string>(matches);
  const dim = new Set<string>();
  // ancestors connect each match to the top
  for (const c of matches) {
    let p = parentOf.get(c)?.parent ?? null;
    const guard = new Set<string>();
    while (p && !guard.has(p)) {
      guard.add(p);
      if (!visible.has(p)) { visible.add(p); dim.add(p); }
      p = parentOf.get(p)?.parent ?? null;
    }
  }
  // when searching, also show the matches' teams
  if (term) {
    const stack = [...matches];
    while (stack.length) {
      const c = stack.pop()!;
      for (const k of childrenOf.get(c) ?? []) if (base.has(k) && !visible.has(k)) { visible.add(k); stack.push(k); }
    }
  }

  const make = (code: string, depth = 0): TreeNode => {
    const n = byCode.get(code)!;
    const kids = depth > 12 ? [] : (childrenOf.get(code) ?? []).filter((k) => visible.has(k));
    const children = kids
      .map((k) => make(k, depth + 1))
      // partners appear in the partner row, so drop them from the chain unless they have a visible team
      .filter((k) => !(partnerCodes.has(k.code) && !k.children.length && !term))
      .sort((a, b) => Number(b.revShare) - Number(a.revShare) || b.children.length - a.children.length || a.name.localeCompare(b.name));
    return { ...n, children, via: parentOf.get(code)?.via ?? [], dim: dim.has(code) };
  };
  const roots = [...visible]
    .filter((c) => !parentOf.get(c)?.parent)
    .map((c) => make(c))
    .filter((r) => !(partnerCodes.has(r.code) && !r.children.length && !term))
    .sort((a, b) => b.children.length - a.children.length);
  return { roots, partnerNodes, matchCount: term ? matches.size : 0 };
}
