import Link from "next/link";

/** The two dashboards as tabs; the picked period / Director / Builder / Project travel with the link. */
export default function DashTabs({ active, href }: { active: "perf" | "rec"; href: (path: string) => string }) {
  const t = (key: "perf" | "rec", label: string, path: string) => (
    <Link key={key} href={href(path)} className={`btn ${active === key ? "btn-primary" : ""}`}>{label}</Link>
  );
  return <div className="mt-2 flex gap-2">{t("perf", "Performance & P&L", "/dashboard")}{t("rec", "Receivables & Collections", "/dashboard/receivables")}</div>;
}
