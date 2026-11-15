"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string }
export interface NavGroup { label: string; items: NavItem[] }

/** Top navigation: a few direct links plus grouped menus, with the current page highlighted. */
export function NavBar({ direct, groups }: { direct: NavItem[]; groups: NavGroup[] }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const base = "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition";
  const on = "bg-white/15 text-white";
  const off = "text-white/75 hover:bg-white/10 hover:text-white";
  return (
    <nav ref={ref} className="flex flex-wrap items-center gap-1">
      {direct.map((l) => <Link key={l.href} href={l.href} className={`${base} ${isActive(l.href) ? on : off}`}>{l.label}</Link>)}
      {groups.map((g) => {
        const active = g.items.some((i) => isActive(i.href));
        return (
          <div key={g.label} className="relative">
            <button type="button" aria-expanded={open === g.label} onClick={() => setOpen(open === g.label ? null : g.label)} className={`${base} ${active ? on : off}`}>
              {g.label} <span className="ml-0.5 text-[10px] opacity-70">▾</span>
            </button>
            {open === g.label && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-[var(--line)] bg-white py-1 shadow-lg">
                {g.items.map((i) => (
                  <Link key={i.href} href={i.href} className={`block px-3.5 py-2 text-[13px] ${isActive(i.href) ? "bg-slate-100 font-semibold text-[var(--brand)]" : "text-slate-700 hover:bg-slate-50"}`}>{i.label}</Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
