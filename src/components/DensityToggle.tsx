"use client";
import { useEffect, useState } from "react";

/** Compact (most rows on screen) or comfortable table spacing; remembered in this browser. */
export function DensityToggle() {
  const [d, setD] = useState<"compact" | "comfortable">("compact");
  useEffect(() => {
    try {
      const v = localStorage.getItem("density");
      if (v === "comfortable" || v === "compact") setD(v);
    } catch { /* storage blocked: keep the default */ }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.density = d;
    try { localStorage.setItem("density", d); } catch { /* ignore */ }
  }, [d]);
  return (
    <button type="button" className="rounded-md px-2 py-1 text-[12px] text-white/70 transition hover:bg-white/10 hover:text-white" title="Table row spacing" onClick={() => setD(d === "compact" ? "comfortable" : "compact")}>
      {d === "compact" ? "Compact" : "Comfortable"}
    </button>
  );
}
