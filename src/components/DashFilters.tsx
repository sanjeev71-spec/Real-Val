"use client";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  from: string; to: string; director: string; builder: string; project: string; by: string;
  directors: { name: string; active: boolean }[]; builders: string[]; projects: { name: string; builder: string }[];
}

/** Period and Director / Builder / Project pickers; changing any of them reloads the dashboard at once. */
export default function DashFilters(p: Props) {
  const router = useRouter();
  const path = usePathname();
  const [v, setV] = useState({ from: p.from, to: p.to, director: p.director, builder: p.builder, project: p.project });
  const go = (next: typeof v) => {
    setV(next);
    const q = new URLSearchParams();
    if (next.from) q.set("from", next.from);
    if (next.to) q.set("to", next.to);
    if (next.director) q.set("director", next.director);
    if (next.builder) q.set("builder", next.builder);
    if (next.project) q.set("project", next.project);
    if (p.by) q.set("by", p.by);
    router.push(`${path}?${q.toString()}`);
  };
  const projects = p.projects.filter((x) => !v.builder || x.builder.toLowerCase() === v.builder.toLowerCase());
  const sel = "input !h-8 min-w-[10rem]";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="from">From</label><input id="from" type="date" className="input" value={v.from} onChange={(e) => go({ ...v, from: e.target.value })} /></div>
      <div><label className="label" htmlFor="to">To</label><input id="to" type="date" className="input" value={v.to} onChange={(e) => go({ ...v, to: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="dir">Director</label>
        <select id="dir" className={sel} value={v.director} onChange={(e) => go({ ...v, director: e.target.value })}>
          <option value="">All Directors</option>
          {p.directors.map((d) => <option key={d.name} value={d.name} style={d.active ? undefined : { color: "#dc2626" }}>{d.name.split("~")[0]}{d.active ? "" : " (inactive)"}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="bld">Builder</label>
        <select id="bld" className={sel} value={v.builder} onChange={(e) => go({ ...v, builder: e.target.value, project: "" })}>
          <option value="">All Builders</option>
          {p.builders.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="prj">Project</label>
        <select id="prj" className={sel} value={v.project} onChange={(e) => go({ ...v, project: e.target.value })}>
          <option value="">All Projects</option>
          {projects.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
      </div>
      {(v.director || v.builder || v.project) && <button type="button" className="btn" onClick={() => go({ ...v, director: "", builder: "", project: "" })}>Clear</button>}
    </div>
  );
}
