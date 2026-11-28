// Colourful SVG charts with the values written on them (server-rendered, no script). Used by both dashboards.
import Link from "next/link";

export const PALETTE = ["#2563eb", "#16a34a", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444", "#84cc16", "#f97316", "#14b8a6", "#6366f1", "#d946ef"];

/** ₹ in crore / lakh, the long form for tiles. */
export const cr = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a < 0.5) return "₹0";
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(1)} L` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
};
/** The short form written on the charts. */
export const short = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a < 0.5) return "0";
  return a >= 1e7 ? `${s}${(a / 1e7).toFixed(2)}cr` : a >= 1e5 ? `${s}${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${s}${(a / 1e3).toFixed(0)}k` : `${s}${Math.round(a)}`;
};

/** % change from the previous figure (null when there is nothing to compare with). */
export const change = (now: number, before: number): number | null => (Math.abs(before) < 0.5 ? null : (now - before) / Math.abs(before));

export function Tile({ label, value, sub, href, colour = "#2563eb", delta, lowerIsBetter = false, deltaLabel = "vs previous period" }: {
  label: string; value: string; sub?: string; href?: string; colour?: string;
  /** change against the previous period (0.18 = +18%); undefined = not shown, null = no previous figure */
  delta?: number | null; lowerIsBetter?: boolean; deltaLabel?: string;
}) {
  const up = (delta ?? 0) > 0.0005, down = (delta ?? 0) < -0.0005;
  const good = lowerIsBetter ? down : up, bad = lowerIsBetter ? up : down;
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xl font-semibold leading-tight" style={{ color: colour }}>{value}</span>
        {delta !== undefined && (
          <span className={`text-[11px] font-semibold ${good ? "text-green-600" : bad ? "text-red-600" : "text-[var(--muted)]"}`} title={deltaLabel}>
            {delta === null ? "new" : `${up ? "▲" : down ? "▼" : "■"} ${Math.abs(delta * 100).toFixed(0)}%`}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] leading-snug text-[var(--muted)]">{sub}</div>}
    </>
  );
  const style = { borderLeft: `4px solid ${colour}` };
  return href
    ? <Link href={href} style={style} className="card block !p-3 transition hover:shadow-md" title="Open the records">{body}</Link>
    : <div className="card !p-3" style={style}>{body}</div>;
}

/** A thin strip of warning chips (only the ones with something to show); each opens the records. */
export function AlertStrip({ items }: { items: { label: string; count: number; href?: string; tone?: "red" | "amber" | "blue" }[] }) {
  const shown = items.filter((i) => i.count > 0);
  const TONE = { red: "border-red-200 bg-red-50 text-red-800", amber: "border-amber-200 bg-amber-50 text-amber-800", blue: "border-blue-200 bg-blue-50 text-blue-800" };
  if (!shown.length) return <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800">✓ Nothing needs attention: no missing slabs, data exceptions or waiting approvals.</div>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Needs attention</span>
      {shown.map((i) => {
        const cls = `rounded-full border px-3 py-1 text-xs font-medium ${TONE[i.tone ?? "amber"]}`;
        const body = <><b>{i.count}</b> {i.label}</>;
        return i.href ? <Link key={i.label} href={i.href} className={`${cls} hover:shadow-sm`}>{body} →</Link> : <span key={i.label} className={cls}>{body}</span>;
      })}
    </div>
  );
}

/** Two or three lines over time (e.g. cash in, cash out, net), with the value written on the last point of each line. */
export function LineChart({ title, labels, series, fmt = short, note }: { title: string; labels: string[]; series: { name: string; colour: string; values: number[]; dashed?: boolean }[]; fmt?: (v: number) => string; note?: string }) {
  const W = 440, H = 150, padL = 20, padR = 50, padT = 12, padB = 20, n = labels.length;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1;
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + ((max - v) / span) * H;
  const every = Math.max(1, Math.ceil(n / 8)); // at most ~8 month labels
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-4">
        <h2 className="h2 !mb-1">{title}</h2>
        {series.map((s) => <span key={s.name} className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]"><i className="inline-block h-0.5 w-3" style={{ background: s.colour }} />{s.name}</span>)}
      </div>
      {!n && <p className="text-sm text-[var(--muted)]">No data.</p>}
      {n > 0 && (
        <svg viewBox={`0 0 ${W} ${H + padT + padB}`} className="w-full" role="img" aria-label={title}>
          <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="currentColor" opacity={0.3} />
          {series.map((s) => {
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
            const last = s.values.length - 1;
            return (
              <g key={s.name}>
                <polyline points={pts} fill="none" stroke={s.colour} strokeWidth={2.2} strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinejoin="round" />
                {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={s.colour}><title>{`${labels[i]} - ${s.name}: ${fmt(v)}`}</title></circle>)}
                {last >= 0 && <text x={x(last) + 5} y={y(s.values[last]) + 3.5} fontSize="10.5" fontWeight="700" fill={s.values[last] < 0 ? "#dc2626" : s.colour}>{fmt(s.values[last])}</text>}
              </g>
            );
          })}
          {labels.map((l, i) => (i % every === 0 || i === n - 1) && <text key={i} x={x(i)} y={H + padT + 15} textAnchor="middle" fontSize="10" fill="currentColor" opacity={0.65}>{l}</text>)}
        </svg>
      )}
      {note && <p className="text-[11px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}

interface Pt { label: string; v: number; href?: string; colour?: string }

/** One series of columns (negative values hang below the line). Every column carries its value. */
export function ColumnChart({ title, data, colour = "#2563eb", fmt = short, note }: { title: string; data: Pt[]; colour?: string; fmt?: (v: number) => string; note?: string }) {
  const W = 560, H = 150, padT = 16, n = Math.max(1, data.length);
  const max = Math.max(0, ...data.map((d) => d.v)), min = Math.min(0, ...data.map((d) => d.v));
  const padB = min < 0 ? 36 : 22;
  const span = max - min || 1;
  const y0 = padT + (max / span) * H; // zero line
  const slot = (W - 10) / n, bw = Math.min(40, slot - 6);
  return (
    <div className="card">
      <h2 className="h2">{title}</h2>
      <svg viewBox={`0 0 ${W} ${H + padT + padB}`} className="w-full" role="img" aria-label={title}>
        {data.map((p, i) => {
          const h = Math.max(p.v !== 0 ? 1.5 : 0, (Math.abs(p.v) / span) * H);
          const x = 5 + i * slot + (slot - bw) / 2;
          const y = p.v >= 0 ? y0 - h : y0;
          const c = p.colour ?? colour;
          const bar = (
            <g>
              <rect x={x} y={y} width={bw} height={h} rx={3} fill={c} opacity={0.92}><title>{`${p.label}: ${fmt(p.v)}`}</title></rect>
              <text x={x + bw / 2} y={p.v >= 0 ? y - 3 : y + h + 9} textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor">{fmt(p.v)}</text>
            </g>
          );
          return (
            <g key={i}>
              {p.href ? <a href={p.href} style={{ cursor: "pointer" }}>{bar}</a> : bar}
              <text x={x + bw / 2} y={H + padT + (min < 0 ? 28 : 14)} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.65}>{p.label}</text>
            </g>
          );
        })}
        <line x1="0" y1={y0} x2={W} y2={y0} stroke="currentColor" opacity={0.25} />
      </svg>
      {note && <p className="text-[11px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}

/** Several series per label, side by side (or stacked). Values are written above each column (rotated), the legend names the colours. */
export function GroupedChart({ title, labels, series, stacked = false, fmt = short, note }: { title: string; labels: string[]; series: { name: string; colour: string; values: number[] }[]; stacked?: boolean; fmt?: (v: number) => string; note?: string }) {
  const W = 560, H = 140, padT = 34, padB = 22, n = Math.max(1, labels.length);
  const tops = labels.map((_, i) => (stacked ? series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0) : Math.max(0, ...series.map((x) => x.values[i] ?? 0))));
  const bots = labels.map((_, i) => (stacked ? series.reduce((s, x) => s + Math.min(0, x.values[i] ?? 0), 0) : Math.min(0, ...series.map((x) => x.values[i] ?? 0))));
  const max = Math.max(0, ...tops), min = Math.min(0, ...bots), span = max - min || 1;
  const y0 = padT + (max / span) * H;
  const slot = (W - 10) / n, gw = Math.min(46, slot - 4), bw = stacked ? gw : gw / series.length;
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-4">
        <h2 className="h2 !mb-1">{title}</h2>
        {series.map((s) => <span key={s.name} className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.colour }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H + padT + padB}`} className="w-full" role="img" aria-label={title}>
        {labels.map((lab, i) => {
          const gx = 5 + i * slot + (slot - gw) / 2;
          let up = 0, down = 0;
          return (
            <g key={i}>
              {series.map((s, k) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(v !== 0 ? 1.5 : 0, (Math.abs(v) / span) * H);
                let x = gx + (stacked ? 0 : k * bw), y: number;
                if (stacked) { y = v >= 0 ? y0 - ((up += Math.max(0, v)) / span) * H : y0 + (-(down += v) / span) * H - h; }
                else y = v >= 0 ? y0 - h : y0;
                return (
                  <g key={s.name}>
                    <rect x={x} y={y} width={bw - (stacked ? 0 : 1)} height={h} rx={2} fill={s.colour} opacity={0.92}><title>{`${lab} - ${s.name}: ${fmt(v)}`}</title></rect>
                    {!stacked && v !== 0 && <text transform={`translate(${x + bw / 2 + 3},${v >= 0 ? y - 3 : y + h + 3}) rotate(-90)`} fontSize="7.5" fontWeight="600" textAnchor={v >= 0 ? "start" : "end"} fill="currentColor">{fmt(v)}</text>}
                  </g>
                );
              })}
              {stacked && <text x={gx + bw / 2} y={y0 - (tops[i] / span) * H - 3} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="currentColor">{fmt(tops[i])}</text>}
              <text x={gx + gw / 2} y={H + padT + 14} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.65}>{lab}</text>
            </g>
          );
        })}
        <line x1="0" y1={y0} x2={W} y2={y0} stroke="currentColor" opacity={0.25} />
      </svg>
      {note && <p className="text-[11px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}

/**
 * Horizontal bars, several series per row (one row per quarter / Director). Values are written at the end of each bar.
 * Negative values grow to the LEFT of a bold zero line, on a light red band, with the value in red - so a loss reads at a glance.
 * `badge` is a small figure in front of the row (e.g. "12 bkgs"); `red` writes the row label in red (inactive Director).
 */
export function HGroupedChart({ title, rows, series, fmt = short, note, hrefOf }: {
  title: string; rows: { label: string; badge?: string; red?: boolean; values: number[] }[]; series: { name: string; colour: string }[];
  fmt?: (v: number) => string; note?: string; hrefOf?: (label: string) => string | undefined;
}) {
  const W = 440, labW = 112, valPad = 44, barH = 14, gap = 3, rowPad = 7; // a narrow drawing, so the text stays large on a half-width card
  const rowH = series.length * (barH + gap) - gap + rowPad * 2;
  const all = rows.flatMap((r) => r.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1;
  const plotX = labW + (min < 0 ? valPad : 4), plotW = W - plotX - valPad;
  const x0 = plotX + (-min / span) * plotW; // the zero line
  const H = rows.length * rowH + 4;
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-4">
        <h2 className="h2 !mb-1">{title}</h2>
        {series.map((s) => <span key={s.name} className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.colour }} />{s.name}</span>)}
      </div>
      {!rows.length && <p className="text-sm text-[var(--muted)]">No data.</p>}
      {rows.length > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
          {min < 0 && <rect x={plotX - 2} y={0} width={x0 - plotX + 2} height={H} fill="#ef4444" opacity={0.06} />}
          {rows.map((r, i) => {
            const y = 2 + i * rowH, href = hrefOf?.(r.label);
            const label = r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label;
            const inner = (
              <g>
                {i > 0 && <line x1={0} y1={y} x2={W} y2={y} stroke="currentColor" opacity={0.07} />}
                <text x={labW - 6} y={y + rowH / 2 + (r.badge ? -1 : 3.5)} textAnchor="end" fontSize="12" fontWeight="600" fill={r.red ? "#dc2626" : "currentColor"}>{label}<title>{r.red ? `${r.label} (inactive)` : r.label}</title></text>
                {r.badge && <text x={labW - 6} y={y + rowH / 2 + 11} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.6}>{r.badge}</text>}
                {series.map((s, k) => {
                  const v = r.values[k] ?? 0;
                  const w = Math.max(v !== 0 ? 1.5 : 0, (Math.abs(v) / span) * plotW);
                  const by = y + rowPad + k * (barH + gap);
                  const bx = v >= 0 ? x0 : x0 - w;
                  return (
                    <g key={s.name}>
                      <rect x={bx} y={by} width={w} height={barH} rx={2} fill={s.colour} opacity={0.92}><title>{`${r.label} - ${s.name}: ${fmt(v)}`}</title></rect>
                      <text x={v >= 0 ? bx + w + 4 : bx - 4} y={by + barH - 2} textAnchor={v >= 0 ? "start" : "end"} fontSize="11" fontWeight="700" fill={v < 0 ? "#dc2626" : "currentColor"}>{fmt(v)}</text>
                    </g>
                  );
                })}
              </g>
            );
            return <g key={r.label}>{href ? <a href={href} style={{ cursor: "pointer" }}>{inner}</a> : inner}</g>;
          })}
          <line x1={x0} y1={0} x2={x0} y2={H} stroke="currentColor" strokeWidth={1.2} opacity={0.55} />
        </svg>
      )}
      {note && <p className="text-[11px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}

/** Ranked horizontal bars, every row in its own colour with the value at the end. */
export function HBarChart({ title, rows, fmt = cr, note, hrefOf, wide = false, isRed }: { title: string; rows: { name: string; v: number; extra?: string }[]; fmt?: (v: number) => string; note?: string; hrefOf?: (name: string) => string | undefined; wide?: boolean; isRed?: (name: string) => boolean }) {
  // the value and the other figures of the row are written after the bar, separated by |
  const text = (r: { v: number; extra?: string }) => (r.extra ? `${fmt(r.v)} | ${r.extra}` : fmt(r.v));
  const W = wide ? 960 : 560, rowH = 24, labW = 150, n = rows.length;
  const valW = Math.min(W * 0.62, Math.max(...rows.map((r) => text(r).length), 6) * 5.6 + 10);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className="card">
      <h2 className="h2">{title}</h2>
      {!n && <p className="text-sm text-[var(--muted)]">No data.</p>}
      {n > 0 && (
        <svg viewBox={`0 0 ${W} ${n * rowH + 4}`} className="w-full" role="img" aria-label={title}>
          {rows.map((r, i) => {
            const w = Math.max(r.v !== 0 ? 2 : 0, (Math.abs(r.v) / max) * (W - labW - valW - 10));
            const y = 2 + i * rowH, href = hrefOf?.(r.name);
            const label = r.name.length > 24 ? `${r.name.slice(0, 23)}…` : r.name;
            const inner = (
              <g>
                <text x={labW - 6} y={y + 15} textAnchor="end" fontSize="10.5" fontWeight={isRed?.(r.name) ? 600 : undefined} fill={isRed?.(r.name) ? "#dc2626" : "currentColor"}>{label}</text>
                <rect x={labW} y={y + 3} width={w} height={rowH - 8} rx={3} fill={r.v < 0 ? "#ef4444" : PALETTE[i % PALETTE.length]} opacity={0.92}><title>{`${r.name}: ${text(r)}`}</title></rect>
                <text x={labW + w + 5} y={y + 15} fontSize="10" fontWeight="600" fill="currentColor">{text(r)}</text>
              </g>
            );
            return <g key={r.name}>{href ? <a href={href} style={{ cursor: "pointer" }}>{inner}</a> : inner}</g>;
          })}
        </svg>
      )}
      {note && <p className="text-[11px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}

/** Share of a total as a ring with the legend (label, value and %). */
export function Donut({ title, slices, fmt = (v: number) => String(Math.round(v)), centre, note, hrefOf }: { title: string; slices: { label: string; v: number; colour?: string; red?: boolean }[]; fmt?: (v: number) => string; centre?: string; note?: string; hrefOf?: (label: string) => string | undefined }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.v), 0);
  const R = 52, r = 32, C = 60;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const frac = total ? Math.max(0, s.v) / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const full = frac > 0.9999;
    const d = full
      ? `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${C - r},${C} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0`
      : `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`;
    a0 = a1;
    return frac > 0 ? { d, colour: s.colour ?? PALETTE[i % PALETTE.length], label: s.label, v: s.v, frac } : null;
  });
  return (
    <div className="card">
      <h2 className="h2">{title}</h2>
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img" aria-label={title}>
          {arcs.map((a, i) => a && <path key={i} d={a.d} fill={a.colour} fillRule="evenodd"><title>{`${a.label}: ${fmt(a.v)} (${(a.frac * 100).toFixed(0)}%)`}</title></path>)}
          <text x={C} y={C + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">{centre ?? fmt(total)}</text>
        </svg>
        <ul className="space-y-1 text-sm">
          {slices.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <i className="inline-block h-3 w-3 rounded-sm" style={{ background: s.colour ?? PALETTE[i % PALETTE.length] }} />
              {hrefOf?.(s.label)
                ? <Link href={hrefOf(s.label)!} className={`hover:underline ${s.red ? "font-semibold text-red-600" : ""}`} title={s.red ? "Inactive" : undefined}>{s.label}</Link>
                : <span className={s.red ? "font-semibold text-red-600" : ""} title={s.red ? "Inactive" : undefined}>{s.label}</span>}
              <b>{fmt(s.v)}</b>
              <span className="text-[var(--muted)]">{total ? `${((Math.max(0, s.v) / total) * 100).toFixed(0)}%` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
      {note && <p className="mt-1 text-[11px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}
