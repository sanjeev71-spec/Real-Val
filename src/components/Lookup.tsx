"use client";
import { useEffect, useRef, useState } from "react";

export interface BkgHit { id: string; client: string; project: string; emp: string }

/**
 * A text box that suggests matches from the server as you type (instead of shipping thousands of options in the page).
 * kind "bkg" suggests bookings (BkgID, client or project); kind "emp" suggests employees. The typed text is always kept.
 */
export function Lookup({ kind, value, onChange, onPick, placeholder, className = "", title }: {
  kind: "bkg" | "emp";
  value: string;
  onChange: (v: string) => void;
  onPick?: (hit: BkgHit | string) => void;
  placeholder?: string;
  className?: string;
  title?: string;
}) {
  const [items, setItems] = useState<(BkgHit | string)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);

  function search(text: string) {
    clearTimeout(timer.current);
    if (!text.trim()) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      const my = ++seq.current;
      try {
        const r = await fetch(`/api/lookup?type=${kind}&q=${encodeURIComponent(text.trim())}`);
        if (!r.ok || my !== seq.current) return;
        setItems(await r.json());
        setActive(-1);
      } catch { /* offline: keep what was typed */ }
    }, 180);
  }

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, kind === "bkg" ? 340 : 260) });
    setOpen(true);
  }
  // the list is fixed-position, so it must close when the page or the table scrolls
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);

  const pick = (it: BkgHit | string) => {
    onChange(typeof it === "string" ? it : it.id);
    onPick?.(it);
    setOpen(false);
  };

  return (
    <>
      <input
        ref={ref} className={`input ${className}`} value={value} placeholder={placeholder} title={title} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); search(e.target.value); show(); }}
        onFocus={() => { if (value) { search(value); show(); } }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && box && items.length > 0 && (
        <ul className="fixed z-50 max-h-64 overflow-auto rounded-lg border border-[var(--line)] bg-white py-1 text-[13px] shadow-lg" style={{ left: box.left, top: box.top, width: box.width }}>
          {items.map((it, i) => (
            <li key={typeof it === "string" ? it : it.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(it); }} className={`block w-full px-3 py-1.5 text-left ${i === active ? "bg-slate-100" : "hover:bg-slate-50"}`}>
                {typeof it === "string" ? it : (
                  <><span className="font-semibold">{it.id}</span> <span className="text-slate-500">{it.client} · {it.project}</span></>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
